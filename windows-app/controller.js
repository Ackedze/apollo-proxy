'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { fork } = require('node:child_process');
const { once } = require('node:events');

const error = code => Object.assign(new Error(code), { code });
function workerEnvironment(source, { stateRoot, proxyRoot, runtimeRoot, python, data, key, id, port }) {
  const allowed = ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA',
    'TEMP', 'TMP', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS'];
  return { ...Object.fromEntries(allowed.filter(k => typeof source[k] === 'string').map(k => [k, source[k]])),
    HOST: '127.0.0.1', PORT: String(port), APOLLO_STATE_ROOT: stateRoot, APOLLO_PROXY_HOME: proxyRoot,
    APOLLO_PROJECT_ROOT: runtimeRoot, APOLLO_RELEASE_ROOT: data.releaseRoot, APOLLO_DATA_ROOT: data.dataRoot,
    CODEX_DESIGN_SYSTEM: data.designSystemRoot, CODEX_DS_AI_HUB: data.dsAiHubRoot,
    APOLLO_KNOWLEDGE_CONTENT_VERSION: data.current.knowledgeVersion, APOLLO_CLI_PROVIDER: 'codex',
    CODEX_BIN: path.join(stateRoot, 'unavailable-cli.exe'), CODEX_WORKSPACE: path.join(stateRoot, 'workspace'),
    APOLLO_CODEX_DEBUG_ROOT: path.join(stateRoot, 'history', 'validation'),
    APOLLO_UX_WRITER_OPENROUTER: '1', APOLLO_UX_WRITER_PYTHON: python,
    APOLLO_CODE_RELEASE_ID: id, APOLLO_CODE_VERSION: 'windows-texts-preview.1',
    APOLLO_CODE_UPDATE_KEY: key, APOLLO_CODE_SUPERVISOR_PID: String(process.pid), APOLLO_PROXY_MANAGED: '1' };
}

function createLog(root, limit = 5 * 1024 * 1024) {
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'proxy.log'), previous = path.join(root, 'proxy.previous.log');
  return bytes => {
    const text = bytes.toString().replace(/sk-or-[A-Za-z0-9_-]+/g, '[redacted]');
    if (Buffer.byteLength(text) > limit) return;
    if ((fs.existsSync(file) ? fs.statSync(file).size : 0) + Buffer.byteLength(text) > limit) {
      fs.rmSync(previous, { force: true }); fs.renameSync(file, previous);
    }
    fs.appendFileSync(file, text, { mode: 0o600 });
  };
}

async function freePort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', e => reject(error(e.code === 'EADDRINUSE' ? 'WINDOWS_PORT_BUSY' : 'WINDOWS_PORT_UNAVAILABLE'))).listen(port, '127.0.0.1', resolve));
  await new Promise(resolve => server.close(resolve));
}

function createController(options) {
  const { proxyRoot, stateRoot, runtimeRoot, seedRoot, descriptor, python, id, port = 3001 } = options;
  const releases = options.releases || require(path.join(proxyRoot, 'src/data-release'));
  const dataCommand = options.dataCommand || require(path.join(proxyRoot, 'scripts/git-data-cli')).runCommand;
  const router = options.router || require(path.join(proxyRoot, 'src/skills/ux-writer/openrouter'));
  const fetcher = options.fetcher || fetch, launch = options.launch || fork;
  const log = options.log || createLog(path.join(stateRoot, 'logs'));
  const key = crypto.randomBytes(32).toString('hex');
  let child = null, release = null, busy = false;
  const settings = { store: path.join(stateRoot, 'data-releases'), seed: seedRoot, runtime: runtimeRoot, descriptor };

  async function health() {
    if (!child || child.exitCode !== null) return { running: false };
    const response = await fetcher('http://127.0.0.1:' + port + '/health', { signal: AbortSignal.timeout(3000) });
    const h = await response.json();
    if (!response.ok || h.ok !== true || h.proxy?.name !== 'apollo-proxy' || h.proxy.codeId !== id || h.proxy.codeSupervisorPid !== process.pid) throw error('WINDOWS_PROXY_IDENTITY_CHANGED');
    return { running: true, busy: Boolean(h.agent?.busy || h.activeRequests),
      data: h.compatibility?.data, approval: h.openRouterApproval || null, failure: h.openRouterFailure || null };
  }
  async function post(route, body, headers = {}) {
    const response = await fetcher('http://127.0.0.1:' + port + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Apollo-Code-Key': key, ...headers },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw error(response.status === 409 ? 'WINDOWS_PROXY_BUSY' : 'WINDOWS_CONTROL_FAILED');
  }
  function emergencyStop() { if (child?.exitCode === null) child.kill(); }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    await health();
    await post('/code-update/prepare', {}, { 'X-Apollo-Code-Lease': crypto.randomUUID() });
    const owned = child, exited = once(owned, 'exit');
    owned.kill();
    await Promise.race([exited, new Promise((_, reject) => { const timer = setTimeout(() => reject(error('WINDOWS_STOP_TIMEOUT')), 5000); timer.unref(); })]);
  }
  async function start() {
    if (child?.exitCode === null) return health();
    const data = await dataCommand('ensure', settings);
    if (!data.current) throw error('DATA_ACTIVATION_REQUIRED');
    await releases.validateRelease(data.releaseRoot, { runtimeRoot });
    await (options.checkPort || freePort)(port);
    release = await releases.retainRelease(data.releaseRoot);
    const environment = workerEnvironment(process.env, { stateRoot, proxyRoot, runtimeRoot, python, data, key, id, port });
    fs.mkdirSync(path.join(stateRoot, 'workspace'), { recursive: true });
    let owned;
    try { owned = launch(path.join(proxyRoot, 'server.js'), [], { cwd: stateRoot, env: environment, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] }); }
    catch { release?.(); release = null; throw error('WINDOWS_START_FAILED'); }
    child = owned;
    owned.stdout?.on('data', log); owned.stderr?.on('data', log);
    owned.once('exit', () => { release?.(); release = null; if (child === owned) child = null; });
    owned.once('error', () => { if (owned.exitCode === null) owned.kill(); release?.(); release = null; if (child === owned) child = null; });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { clean(); reject(error('WINDOWS_START_TIMEOUT')); }, 60000);
        const clean = () => { clearTimeout(timer); owned.removeListener('message', ready); owned.removeListener('exit', died); owned.removeListener('error', failed); };
        const died = () => { clean(); reject(error('WINDOWS_START_FAILED')); };
        const failed = () => { clean(); reject(error('WINDOWS_START_FAILED')); };
        const ready = async message => {
          if (message?.type !== 'apollo-proxy-ready' || message.id !== id || message.port !== port) return;
          try {
            const h = await health();
            if (!h.running || owned.exitCode !== null) throw error('WINDOWS_START_FAILED');
            owned.send({ type: 'apollo-code-confirmed', id }); clean(); resolve();
          } catch (e) { clean(); reject(e); }
        };
        owned.on('message', ready); owned.once('exit', died); owned.once('error', failed);
      });
      return health();
    } catch (e) { emergencyStop(); throw e; }
  }
  async function dispatch(message) {
    if (message.action === 'health') return health();
    if (busy) throw error('WINDOWS_COMMAND_BUSY');
    busy = true;
    try {
      switch (message.action) {
        case 'status': return await dataCommand('status', settings);
        case 'checkKey': await router.checkKey(message.key); return { connected: true };
        case 'approve':
          if (!(await health()).running) throw error('WINDOWS_PROXY_STOPPED');
          await post('/ux-writer/openrouter/approval', { runId: message.runId, key: message.key ?? null }); return { approved: message.key != null };
        case 'start': return await start();
        case 'stop': await stop(); return { running: false };
        case 'activate': case 'update': case 'rollback': case 'check': {
          // Stop only an owned, idle worker before the data reader can alter its release.
          if (message.action !== 'check') await stop();
          const access = message.action === 'activate' ? { password: message.password } : message.access || {};
          return await dataCommand(message.action, { ...settings, access });
        }
        default: throw error('WINDOWS_COMMAND_INVALID');
      }
    } finally { busy = false; }
  }
  return { dispatch, emergencyStop };
}

async function verifyBundle(root) {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'bundle.json'), 'utf8'));
  if (m.schemaVersion !== 'apollo.windows-texts.v1' || !Array.isArray(m.files)) throw error('WINDOWS_BUNDLE_INVALID');
  for (const pin of m.files) {
    if (typeof pin.file !== 'string' || !pin.file.split('/').every(part => part && part !== '.' && part !== '..') || /[\\:\x00-\x1f]/.test(pin.file)) throw error('WINDOWS_BUNDLE_INVALID');
    const file = path.join(root, pin.file), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== file || stat.size !== pin.bytes || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== pin.sha256) throw error('WINDOWS_BUNDLE_CHANGED');
  }
  return m;
}

async function executeMessage(line, controller) {
  let message;
  try {
    message = JSON.parse(line);
    if (Buffer.byteLength(line) > 8192 || typeof message?.id !== 'string' || !/^[0-9]{1,20}$/.test(message.id)) throw error('WINDOWS_COMMAND_INVALID');
    return { id: message.id, success: true, value: await controller.dispatch(message) };
  } catch (e) {
    const code = /^[A-Z][A-Z0-9_]{1,90}$/.test(e.code || e.message) ? e.code || e.message : 'WINDOWS_COMMAND_FAILED';
    return { id: typeof message?.id === 'string' && /^[0-9]{1,20}$/.test(message.id) ? message.id : null, success: false, code };
  }
}

async function main() {
  const root = fs.realpathSync(__dirname), manifest = await verifyBundle(root);
  if (process.platform !== 'win32' || process.arch !== 'x64') throw error('WINDOWS_X64_REQUIRED');
  const requestedState = path.join(process.env.LOCALAPPDATA, 'ApolloProxyControl');
  fs.mkdirSync(requestedState, { recursive: true });
  const stateRoot = fs.realpathSync(requestedState);
  const controller = createController({ proxyRoot: path.join(root, 'proxy'), stateRoot,
    runtimeRoot: path.join(root, 'proxy/runtime/apollo'), seedRoot: path.join(root, 'proxy/runtime/seed'),
    descriptor: manifest.dataDescriptorUrl, python: path.join(root, 'runtime/python/python.exe'), id: manifest.id,
    dataCommand: require('./frozen-data').createFrozenDataCommand({ proxyRoot: path.join(root, 'proxy'),
      indexFile: path.join(root, 'data/current.json'), archive: path.join(root, 'data/package.tgz') }) });
  process.once('exit', controller.emergencyStop);
  process.stdin.once('end', () => { controller.emergencyStop(); process.exit(0); });
  const lines = require('node:readline').createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', line => {
    void executeMessage(line, controller).then(reply => process.stdout.write(JSON.stringify(reply) + '\n'));
  });
  process.stdout.write(JSON.stringify({ event: 'ready', version: manifest.version, stateRoot }) + '\n');
}
if (require.main === module) main().catch(e => { process.stderr.write((/^[A-Z][A-Z0-9_]+$/.test(e.code || '') ? e.code : 'WINDOWS_BUNDLE_START_FAILED') + '\n'); process.exitCode = 1; });
module.exports = { createController, workerEnvironment, createLog, verifyBundle, executeMessage };
