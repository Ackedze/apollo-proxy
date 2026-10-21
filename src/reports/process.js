'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {runClaudeProcess}=require('../cli-agent');
const {CLI_PROVIDER, CLI_AGENT_BIN, CODEX_IDLE_TIMEOUT_MS, CODEX_MAX_RUNTIME_MS, APOLLO_CODEX_SKILL_ROOT, CODEX_WORKSPACE, CODEX_BIN, CODEX_PROGRESS_STAGES}=require('../config');


function runCodexProcess(
  args,
  prompt,
  outputPath,
  onProgress,
  analysisStage = 'analyzing_layout',
  telemetryContext = {},
  outputFormat = 'json'
) {
  if (CLI_PROVIDER === 'claude') {
    return runClaudeProcess({ binary: CLI_AGENT_BIN, codexArgs: args, prompt, outputPath,
      outputFormat, idleTimeoutMs: CODEX_IDLE_TIMEOUT_MS, maxRuntimeMs: CODEX_MAX_RUNTIME_MS,
      onProgress: stage => emitCodexProgress(onProgress, stage), analysisStage,
      model: process.env.CLAUDE_MODEL || '', skillRoot: APOLLO_CODEX_SKILL_ROOT });
  }
  return new Promise((resolve, reject) => {
    const workingDirectory =
      typeof telemetryContext.workingDirectory === 'string' &&
      telemetryContext.workingDirectory
        ? telemetryContext.workingDirectory
        : CODEX_WORKSPACE;
    const child = spawn(CODEX_BIN, args, {
      cwd: workingDirectory,
      env: buildCodexEnvironment(),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stdoutLineBuffer = '';
    let stderr = '';
    let lastAgentMessage = '';
    let settled = false;

    let idleTimeout = null;
    const maxRuntimeTimeout = setTimeout(() => {
      if (settled) return;
      child.kill('SIGTERM');
      const err = new Error(
        `Codex validation exceeded the maximum runtime of ${CODEX_MAX_RUNTIME_MS} ms.`
      );
      err.status = 504;
      err.code = 'CODEX_MAX_RUNTIME_EXCEEDED';
      settled = true;
      if (idleTimeout) clearTimeout(idleTimeout);
      reject(err);
    }, CODEX_MAX_RUNTIME_MS);

    const refreshIdleTimeout = () => {
      if (settled) return;
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        if (settled) return;
        child.kill('SIGTERM');
        const err = new Error(
          `Codex validation produced no output for ${CODEX_IDLE_TIMEOUT_MS} ms.`
        );
        err.status = 504;
        err.code = 'CODEX_IDLE_TIMEOUT';
        settled = true;
        clearTimeout(maxRuntimeTimeout);
        reject(err);
      }, CODEX_IDLE_TIMEOUT_MS);
    };
    refreshIdleTimeout();

    child.stdout.on('data', (chunk) => {
      refreshIdleTimeout();
      const text = chunk.toString('utf8');
      if (stdout.length < 2 * 1024 * 1024) stdout += text;
      stdoutLineBuffer += text;
      const lines = stdoutLineBuffer.split(/\r?\n/);
      stdoutLineBuffer = lines.pop() || '';
      for (const line of lines) {
        const event = parseCodexJsonEvent(line);
        if (!event) continue;
        if (typeof telemetryContext.onEvent === 'function') telemetryContext.onEvent(event);
        if (event.type === 'turn.completed') {
          console.info('[Apollo][codex] turn usage', {
            runId: telemetryContext.runId || null,
            mode: telemetryContext.mode || null,
            model: telemetryContext.model || 'codex-default',
            reasoningEffort: telemetryContext.reasoningEffort || null,
            usage: event.usage || null,
          });
        }
        const item = event.item;
        if (
          event.type === 'item.completed' &&
          item &&
          item.type === 'agent_message' &&
          typeof item.text === 'string'
        ) {
          lastAgentMessage = item.text;
        }
        const progressStage = mapCodexEventToProgressStage(
          event,
          analysisStage
        );
        if (progressStage) emitCodexProgress(onProgress, progressStage);
      }
    });
    child.stderr.on('data', (chunk) => {
      refreshIdleTimeout();
      if (stderr.length < 2 * 1024 * 1024) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (settled) return;
      if (idleTimeout) clearTimeout(idleTimeout);
      clearTimeout(maxRuntimeTimeout);
      settled = true;
      const err = new Error(`Failed to start Codex: ${error.message}`);
      err.status = 503;
      reject(err);
    });
    child.on('close', async (code) => {
      if (settled) return;
      if (idleTimeout) clearTimeout(idleTimeout);
      clearTimeout(maxRuntimeTimeout);
      settled = true;
      if (code !== 0) {
        reject(buildCodexProcessExitError(code, stderr, stdout));
        return;
      }

      try {
        const fileOutput = await fsp.readFile(outputPath, 'utf8').catch(() => '');
        const raw = fileOutput.trim() || lastAgentMessage.trim();
        if (outputFormat === 'text') {
          if (!raw) {
            const err = new Error('Codex returned an empty dialogue response.');
            err.status = 502;
            reject(err);
            return;
          }
          resolve(raw);
          return;
        }
        resolve(JSON.parse(raw));
      } catch (error) {
        const err = new Error('Codex returned invalid JSON output.');
        err.status = 502;
        err.details = {
          message: error?.message || null,
          stdout: stdout.trim().slice(-1000) || null,
          stderr: stderr.trim().slice(-1000) || null,
        };
        reject(err);
      }
    });

    child.stdin.end(prompt);
  });
}


function isCodexAuthenticationFailure(stderr) {
  const normalized = typeof stderr === 'string' ? stderr.toLowerCase() : '';
  if (!normalized) return false;
  return [
    'not logged in',
    'login required',
    'authentication required',
    'authorization required',
    'unauthorized',
    'missing credentials',
    'no valid auth',
    'codex login',
    'http 401',
    'status 401',
  ].some((marker) => normalized.includes(marker));
}


function buildCodexProcessExitError(exitCode, stderr, stdout = '') {
  if (isCodexAuthenticationFailure(stderr)) {
    const err = new Error(
      'Codex authorization is required. Open ApolloProxyControl and choose Authorize Codex.'
    );
    err.status = 401;
    err.code = 'CODEX_AUTH_REQUIRED';
    err.details = null;
    return err;
  }

  const combinedOutput = `${stderr || ''}\n${stdout || ''}`;
  if (combinedOutput.includes('invalid_json_schema')) {
    const err = new Error(
      'Codex rejected the Apollo output schema. Update ApolloProxyControl.'
    );
    err.status = 502;
    err.code = 'CODEX_OUTPUT_SCHEMA_INVALID';
    err.details = {
      stderr: String(stderr || '').trim().slice(-2000) || null,
      stdout: String(stdout || '').trim().slice(-2000) || null,
    };
    return err;
  }

  const err = new Error(`Codex exited with code ${exitCode}.`);
  err.status = 502;
  err.code = 'CODEX_PROCESS_FAILED';
  err.details = {
    stderr: String(stderr || '').trim().slice(-2000) || null,
    stdout: String(stdout || '').trim().slice(-2000) || null,
  };
  return err;
}


function parseCodexJsonEvent(line) {
  const normalized = typeof line === 'string' ? line.trim() : '';
  if (!normalized) return null;
  try {
    const event = JSON.parse(normalized);
    return event && typeof event === 'object' ? event : null;
  } catch {
    return null;
  }
}


function mapCodexEventToProgressStage(
  event,
  analysisStage = 'analyzing_layout'
) {
  if (!event || typeof event !== 'object') return null;
  if (event.type === 'thread.started') return 'starting_agent';
  if (event.type === 'turn.started') return analysisStage;
  if (event.type === 'turn.completed') return 'finalizing';
  if (event.type !== 'item.started' && event.type !== 'item.completed') {
    return null;
  }

  const itemType = event.item?.type;
  if (
    itemType === 'command_execution' ||
    itemType === 'mcp_tool_call' ||
    itemType === 'web_search'
  ) {
    return 'reading_design_system';
  }
  return null;
}


function emitCodexProgress(onProgress, stage) {
  if (typeof onProgress !== 'function') return;
  const definition = CODEX_PROGRESS_STAGES[stage];
  if (!definition) return;
  onProgress({
    stage,
    progress: definition.progress,
    message: definition.message,
  });
}


function buildCodexEnvironment() {
  const allowedKeys = [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'CODEX_HOME',
  ];
  const environment = {};
  for (const key of allowedKeys) {
    if (typeof process.env[key] === 'string') {
      environment[key] = process.env[key];
    }
  }
  return environment;
}

module.exports = {runCodexProcess, isCodexAuthenticationFailure, buildCodexProcessExitError, parseCodexJsonEvent, mapCodexEventToProgressStage, emitCodexProgress, buildCodexEnvironment};
