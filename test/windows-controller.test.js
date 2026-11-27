'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createController, workerEnvironment, createLog, verifyBundle, executeMessage } = require('../windows-app/controller');

const data = { current: { knowledgeVersion: 'known' }, releaseRoot: '/data/current', dataRoot: '/data/contracts', designSystemRoot: '/data/ds', dsAiHubRoot: '/data/hub' };
test('oversized UTF-8 private input returns a correlated failure without dispatching', async () => {
  let calls = 0;
  const reply = await executeMessage(JSON.stringify({ id: '123', action: 'activate', password: 'я'.repeat(5000) }), { dispatch() { calls++; } });
  assert.deepEqual(reply, { id: '123', success: false, code: 'WINDOWS_COMMAND_INVALID' });
  assert.equal(calls, 0);
});
test('private IPC never reflects arbitrary exception messages or key material', async () => {
  const reply = await executeMessage('{"id":"1","action":"checkKey","key":"private-key"}', { dispatch() { throw Error('network error with private-key'); } });
  assert.deepEqual(reply, { id: '1', success: false, code: 'WINDOWS_COMMAND_FAILED' });
  assert.equal(JSON.stringify(reply).includes('private-key'), false);
});
function options(extra = {}) {
  return { proxyRoot: '/proxy', stateRoot: '/state', runtimeRoot: '/runtime', seedRoot: '/seed', descriptor: 'https://example.test/current.json', python: '/python', id: 'code',
    log() {}, releases: {}, router: {}, dataCommand: async () => ({ current: null }), ...extra };
}
test('worker receives chosen installed roots and no API keys or author overrides', () => {
  const env = workerEnvironment({ SystemRoot: 'C:\\Windows', PATH: 'bin', HTTP_PROXY: 'http://127.0.0.1:1', APOLLO_UX_WRITER_OPENROUTER_KEY: 'secret', ANTHROPIC_API_KEY: 'secret', APOLLO_DATA_PRODUCER_ROOT: '/author', NODE_OPTIONS: '--require evil.js' },
    { stateRoot: '/state', proxyRoot: '/proxy', runtimeRoot: '/runtime', python: '/python', data, key: 'control', id: 'accepted', port: 3001 });
  assert.equal(env.APOLLO_RELEASE_ROOT, data.releaseRoot);
  assert.equal(env.APOLLO_UX_WRITER_PYTHON, '/python');
  assert.equal(env.APOLLO_UX_WRITER_OPENROUTER, '1');
  assert.equal(env.HOST, '127.0.0.1');
  for (const key of ['APOLLO_UX_WRITER_OPENROUTER_KEY', 'ANTHROPIC_API_KEY', 'APOLLO_DATA_PRODUCER_ROOT', 'NODE_OPTIONS']) assert.equal(env[key], undefined);
});
test('concurrent data writes are refused until the first command settles', async () => {
  let resolve;
  const c = createController(options({ dataCommand: () => new Promise(done => { resolve = done; }) }));
  const first = c.dispatch({ action: 'activate', password: 'private' });
  await new Promise(setImmediate);
  await assert.rejects(c.dispatch({ action: 'activate', password: 'other' }), { code: 'WINDOWS_COMMAND_BUSY' });
  resolve({ current: null }); await first;
  assert.deepEqual(await c.dispatch({ action: 'health' }), { running: false });
});
test('no worker starts without activated and validated data', async () => {
  let launches = 0;
  const c = createController(options({ launch() { launches++; } }));
  await assert.rejects(c.dispatch({ action: 'start' }), { code: 'DATA_ACTIVATION_REQUIRED' });
  assert.equal(launches, 0);
});
test('activation access is private input and a health poll cannot send an API key', async () => {
  const calls = [];
  const c = createController(options({ dataCommand: async (action, settings) => { calls.push({ action, settings }); return {}; } }));
  await c.dispatch({ action: 'activate', password: 'private' });
  assert.deepEqual(calls[0].settings.access, { password: 'private' });
  await c.dispatch({ action: 'health', key: 'secret' });
  await assert.rejects(c.dispatch({ action: 'approve', runId: 'x', key: 'secret' }), { code: 'WINDOWS_PROXY_STOPPED' });
  assert.equal(calls.length, 1);
});
test('wrong process identity blocks consent, stopping and data replacement', async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'windows-controller-'));
  let killed = 0, writes = 0;
  const child = new EventEmitter(); child.exitCode = null; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => { killed++; child.exitCode = 0; child.emit('exit', 0); }; child.send = () => {};
  let foreign = false;
  const c = createController(options({ stateRoot: root, port: 0, checkPort: async () => {},
    releases: { async validateRelease() {}, async retainRelease() { return () => {}; } },
    dataCommand: async action => { if (action !== 'ensure') writes++; return data; },
    fetcher: async () => ({ ok: true, json: async () => ({ ok: true, proxy: { name: 'apollo-proxy', codeId: foreign ? 'other' : 'code', codeSupervisorPid: process.pid } }) }),
    launch() { setImmediate(() => child.emit('message', { type: 'apollo-proxy-ready', id: 'code', port: 0 })); return child; },
  }));
  try {
    await c.dispatch({ action: 'start' }); foreign = true;
    await assert.rejects(c.dispatch({ action: 'stop' }), { code: 'WINDOWS_PROXY_IDENTITY_CHANGED' });
    await assert.rejects(c.dispatch({ action: 'update' }), { code: 'WINDOWS_PROXY_IDENTITY_CHANGED' });
    await assert.rejects(c.dispatch({ action: 'approve', runId: 'x', key: 'secret' }), { code: 'WINDOWS_PROXY_IDENTITY_CHANGED' });
    assert.equal(killed, 0); assert.equal(writes, 0);
  } finally { c.emergencyStop(); fs.rmSync(root, { recursive: true, force: true }); }
});
test('logs rotate to two bounded files and redact OpenRouter keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-log-'));
  try {
    const log = createLog(root, 40); log('sk-or-private-key'); log('a'.repeat(35)); log('b'.repeat(35)); log('x'.repeat(41));
    const files = fs.readdirSync(root); assert.equal(files.length, 2);
    for (const file of files) { const bytes = fs.readFileSync(path.join(root, file)); assert.ok(bytes.length <= 40); assert.ok(!bytes.includes('sk-or-')); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('bootstrap refuses changed payloads and traversal before loading server code', async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'windows-bundle-'));
  const bytes = Buffer.from('accepted'), pin = { file: 'file.js', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  const save = files => fs.writeFileSync(path.join(root, 'bundle.json'), JSON.stringify({ schemaVersion: 'apollo.windows-texts.v1', files }));
  try {
    fs.writeFileSync(path.join(root, 'file.js'), bytes); save([pin]); await verifyBundle(root);
    fs.writeFileSync(path.join(root, 'file.js'), 'modified'); await assert.rejects(verifyBundle(root), { code: 'WINDOWS_BUNDLE_CHANGED' });
    save([{ ...pin, file: '../file.js' }]); await assert.rejects(verifyBundle(root), { code: 'WINDOWS_BUNDLE_INVALID' });
    save([{ ...pin, file: 'C:/file.js' }]); await assert.rejects(verifyBundle(root), { code: 'WINDOWS_BUNDLE_INVALID' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
