const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function selectedCliProvider(value = process.env.APOLLO_CLI_PROVIDER) {
  if (!value || value === 'codex') return 'codex';
  if (value === 'claude') return 'claude';
  throw new Error('APOLLO_CLI_PROVIDER must be codex or claude.');
}

function resolveClaudeBinary(configured = '', environment = process.env) {
  if (configured) return configured;
  const candidates = [path.join(environment.HOME || os.homedir(), '.local/bin/claude'),
    '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  return candidates.find(file => { try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } }) || 'claude';
}

function buildClaudeEnvironment(source = process.env) {
  // Authentication stays inside the official CLI. Forward its supported inputs,
  // without passing Apollo's endpoint keys or Codex credentials to another agent.
  const keys = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL',
    'CLAUDE_CONFIG_DIR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'AWS_PROFILE', 'AWS_REGION',
    'AWS_DEFAULT_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
    'AWS_BEARER_TOKEN_BEDROCK', 'GOOGLE_APPLICATION_CREDENTIALS', 'ANTHROPIC_VERTEX_PROJECT_ID',
    'CLOUD_ML_REGION', 'ANTHROPIC_FOUNDRY_RESOURCE', 'ANTHROPIC_FOUNDRY_BASE_URL',
    'ANTHROPIC_FOUNDRY_API_KEY', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY',
    'https_proxy', 'http_proxy', 'no_proxy', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS'];
  return Object.fromEntries(keys.filter(key => typeof source[key] === 'string').map(key => [key, source[key]]));
}

function agentError(message, status, code) {
  return Object.assign(new Error(message), { status, code, details: null });
}

function claudeFailure(exitCode, stderr, result) {
  const errors = Array.isArray(result?.errors) ? result.errors : [result?.errors];
  const text = `${stderr || ''}\n${result?.result || ''}\n${errors.filter(value => typeof value === 'string').join(' ')}`.toLowerCase();
  if (/not logged in|login required|authentication|unauthorized|invalid api key|401|auth login/.test(text)) {
    return agentError('Выполните вход в Claude в окне «О прокси».', 401, 'CLAUDE_AUTH_REQUIRED');
  }
  if (/unknown option|unrecognized option|unsupported.*flag/.test(text)) {
    return agentError('Обновите Claude Code до версии 2.1.248 или новее.', 503, 'CLAUDE_CLI_OUTDATED');
  }
  return agentError(`Claude завершил запрос с ошибкой (код ${exitCode}).`, 502, 'CLAUDE_PROCESS_FAILED');
}

function buildClaudeInvocation(codexArgs, prompt, outputPath, { model = '', skillRoot } = {}) {
  const values = flag => codexArgs.flatMap((value, index) => value === flag ? [codexArgs[index + 1]] : []);
  const directories = new Set(values('--add-dir'));
  const images = values('--image');
  for (const image of images) directories.add(path.dirname(image));
  // Each request gets a private working directory, even when the Codex invocation
  // uses the shared workspace. Only the explicit knowledge roots are added.
  const cwd = path.dirname(outputPath);
  let adaptedPrompt = prompt;
  if (skillRoot && /^Используй \$apollo-design-validator\.(?:\r?\n|$)/.test(prompt)) {
    directories.add(skillRoot);
    adaptedPrompt = adaptedPrompt.replace('Используй $apollo-design-validator.',
      `Прочитай ${path.join(skillRoot, 'SKILL.md')} и используй этот Apollo skill как инструкцию для проверки.`);
  }
  adaptedPrompt += '\nДоступны только Read, Glob и Grep. Используй их для чтения JSON, документов и изображений вместо shell. Не изменяй файлы.';
  if (images.length) adaptedPrompt += `\nИзображения для визуальной проверки (прочитай через Read):\n${images.join('\n')}`;
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--restricted', '--safe-mode',
    '--no-session-persistence', '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep',
    '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];
  for (const directory of directories) if (directory !== cwd) args.push('--add-dir', directory);
  const schemaPath = values('--output-schema')[0];
  if (schemaPath) args.push('--json-schema', fs.readFileSync(schemaPath, 'utf8'));
  if (model) args.push('--model', model);
  return { args, prompt: adaptedPrompt, cwd };
}

function runClaudeProcess({ binary, codexArgs, prompt, outputPath, outputFormat = 'json',
  idleTimeoutMs = 300000, maxRuntimeMs = 900000, onProgress, analysisStage, model, skillRoot,
  environment = buildClaudeEnvironment() }) {
  const invocation = buildClaudeInvocation(codexArgs, prompt, outputPath, { model, skillRoot });
  return new Promise((resolve, reject) => {
    const child = spawn(binary, invocation.args, { cwd: invocation.cwd, env: environment,
      shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', stderr = '', result, failure, closed = false, forceTimer, idleTimer;
    const stop = error => {
      if (failure || closed) return;
      failure = error;
      child.kill('SIGTERM');
      forceTimer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 3000);
    };
    const refreshIdle = () => {
      clearTimeout(idleTimer);
      if (!failure) idleTimer = setTimeout(() => stop(agentError('Claude не отвечает. Повторите запрос.', 504, 'CLAUDE_IDLE_TIMEOUT')), idleTimeoutMs);
    };
    const maxTimer = setTimeout(() => stop(agentError('Превышено время выполнения Claude.', 504, 'CLAUDE_MAX_RUNTIME_EXCEEDED')), maxRuntimeMs);
    refreshIdle();
    const consume = line => {
      if (!line.trim()) return;
      let event; try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'result') result = event;
      if (event.type === 'assistant') {
        const reading = event.message?.content?.some(item => item.type === 'tool_use');
        onProgress?.(reading ? 'reading_design_system' : analysisStage);
      }
    };
    child.stdout.on('data', chunk => {
      refreshIdle(); buffer += chunk.toString('utf8');
      if (buffer.length > 2 * 1024 * 1024) { stop(agentError('Ответ Claude превышает допустимый размер.', 502, 'CLAUDE_OUTPUT_TOO_LARGE')); buffer = ''; return; }
      const lines = buffer.split(/\r?\n/); buffer = lines.pop(); lines.forEach(consume);
    });
    child.stderr.on('data', chunk => { refreshIdle(); if (stderr.length < 65536) stderr += chunk.toString('utf8'); });
    child.stdin.on('error', () => {}); // An early CLI exit is handled by close.
    child.on('error', () => { failure = agentError('Claude Code не найден. Установите CLI или задайте CLAUDE_BIN.', 503, 'CLAUDE_CLI_UNAVAILABLE'); });
    child.on('close', async code => {
      closed = true; clearTimeout(idleTimer); clearTimeout(maxTimer); clearTimeout(forceTimer);
      consume(buffer);
      if (failure) return reject(failure);
      if (code !== 0 || result?.is_error) return reject(claudeFailure(code, stderr, result));
      try {
        if (!result) throw Error('Missing result');
        const value = outputFormat === 'text' ? result.result : result.structured_output;
        if (outputFormat === 'text' ? typeof value !== 'string' || !value.trim()
          : !value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid result');
        await fsp.writeFile(outputPath, outputFormat === 'text' ? value : JSON.stringify(value), { mode: 0o600 });
        resolve(value);
      } catch { reject(agentError('Claude вернул некорректный ответ. Повторите запрос.', 502, 'CLAUDE_OUTPUT_INVALID')); }
    });
    child.stdin.end(invocation.prompt);
  });
}

module.exports = { selectedCliProvider, resolveClaudeBinary, buildClaudeEnvironment,
  buildClaudeInvocation, runClaudeProcess, claudeFailure };
