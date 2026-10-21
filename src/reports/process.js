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
  const signal=telemetryContext.signal, budget=telemetryContext.runtimeBudgetMs;
  if (signal?.aborted) return Promise.reject(Object.assign(Error('CLI request cancelled.'),{code:'CLI_CANCELLED',status:499}));
  if (budget!==undefined && (!Number.isSafeInteger(budget) || budget<1)) return Promise.reject(Object.assign(Error('CLI time budget exhausted.'),{code:'CLI_TIME_BUDGET_EXHAUSTED',status:504}));
  const maxRuntimeMs=budget===undefined ? CODEX_MAX_RUNTIME_MS : Math.min(budget,CODEX_MAX_RUNTIME_MS);
  if (CLI_PROVIDER === 'claude') {
    return runClaudeProcess({ binary: CLI_AGENT_BIN, codexArgs: args, prompt, outputPath,
      outputFormat, idleTimeoutMs: CODEX_IDLE_TIMEOUT_MS, maxRuntimeMs, signal,
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
      detached: Boolean((budget!==undefined || signal) && process.platform!=='win32'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stdoutLineBuffer = '';
    let stderr = '';
    let lastAgentMessage = '';
    let settled = false, failure = null, forceTimer;
    const onAbort=()=>stop(Object.assign(Error('CLI request cancelled.'),{code:'CLI_CANCELLED',status:499}));
    function kill(signalName) {
      try { if ((budget!==undefined || signal) && process.platform!=='win32' && child.pid) process.kill(-child.pid,signalName); else child.kill(signalName); }
      catch { child.kill(signalName); }
    }
    function stop(error) {
      if (settled || failure) return;
      failure=error; kill('SIGTERM');
      forceTimer=setTimeout(()=>{if(!settled)kill('SIGKILL');},3000);
    }
    function cleanup() {
      if (idleTimeout) clearTimeout(idleTimeout);
      clearTimeout(maxRuntimeTimeout);clearTimeout(forceTimer);
      signal?.removeEventListener('abort',onAbort);
    }

    let idleTimeout = null;
    const maxRuntimeTimeout = setTimeout(() => {
      if (settled) return;
      const err = new Error(
        `Codex validation exceeded the maximum runtime of ${maxRuntimeMs} ms.`
      );
      err.status = 504;
      err.code = 'CODEX_MAX_RUNTIME_EXCEEDED';
      if (budget!==undefined || signal) {stop(err);return;}
      child.kill('SIGTERM');
      settled = true;
      if (idleTimeout) clearTimeout(idleTimeout);
      reject(err);
    }, maxRuntimeMs);

    const refreshIdleTimeout = () => {
      if (settled) return;
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => {
        if (settled) return;
        const err = new Error(
          `Codex validation produced no output for ${CODEX_IDLE_TIMEOUT_MS} ms.`
        );
        err.status = 504;
        err.code = 'CODEX_IDLE_TIMEOUT';
        if (budget!==undefined || signal) {stop(err);return;}
        child.kill('SIGTERM');
        settled = true;
        clearTimeout(maxRuntimeTimeout);
        reject(err);
      }, CODEX_IDLE_TIMEOUT_MS);
    };
    refreshIdleTimeout();

    child.stdout.on('data', (chunk) => {
      if (failure) return;
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
      if (failure) return;
      refreshIdleTimeout();
      if (stderr.length < 2 * 1024 * 1024) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (settled) return;
      cleanup();
      settled = true;
      const err = new Error(`Failed to start Codex: ${error.message}`);
      err.status = 503;
      reject(err);
    });
    child.on('close', async (code) => {
      if (settled) return;
      cleanup();
      settled = true;
      if (failure) {reject(failure);return;}
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

    child.stdin.on('error',()=>{});
    signal?.addEventListener('abort',onAbort,{once:true});
    if (signal?.aborted) onAbort();
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
