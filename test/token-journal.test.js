const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createTokenJournal, configure, wrapAgentService, mountJournalRoutes } = require('../src/token-journal');
const { claudeUsage } = require('../src/cli-agent');
const turn = (input = 100, output = 20, cached = 90) => ({ type: 'turn.completed', usage: { input_tokens: input, output_tokens: output, cached_input_tokens: cached } });
function setup(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-tokens-'))), errors = [];
  t.after(() => { configure(null); fs.rmSync(root, { recursive: true, force: true }); });
  const journal = createTokenJournal(path.join(root, 'journal'), { onError: e => errors.push(e) });
  return { root, journal, errors };
}
test('multi-pass operations sum input/output once, retain failures and separate concurrent contexts', async t => {
  const { journal } = setup(t);
  await Promise.all(['Спросить', 'Проверить'].map((label, i) => journal.operation(label, async () => {
    for (let pass = 0; pass < i + 1; pass++) {
      await new Promise(resolve => setImmediate(resolve));
      const call = journal.call({ provider: 'codex', model: 'fixture' });
      call.event(turn()); call.end(); call.end();
    }
  })));
  const rows = journal.read().records;
  assert.deepEqual(rows.map(r => [r.operation, r.totalTokens]).sort(), [['Проверить', 240], ['Спросить', 120]]);
  assert.equal(rows.find(r => r.operation === 'Проверить').cachedInputTokens, 180);
  const entry = journal.begin('Навык');
  journal.within(entry, () => { const call = journal.call(); call.event(turn()); call.event({ type: 'turn.started' }); call.event({ type: 'turn.failed' }); call.end(Error('failed')); });
  journal.finish(entry, 'failed');
  const failed = journal.read().records.find(r => r.operation === 'Навык');
  assert.equal(failed.totalTokens, null); assert.equal(failed.inputTokens + failed.outputTokens, 120);
});
test('zero-model work is zero, missing usage is unknown, running records survive a restart as interrupted', async t => {
  const { journal } = setup(t);
  await journal.operation('Локально', async () => {});
  const missing = journal.call({ provider: 'alfagen', operation: 'Спросить' }); missing.end();
  const ongoing = journal.call({ operation: 'Прерванная операция' }); ongoing.event(turn(10, 2, 5));
  const restored = createTokenJournal(journal.root);
  const rows = restored.read().records;
  assert.equal(rows.find(r => r.operation === 'Локально').totalTokens, 0);
  assert.equal(rows.find(r => r.operation === 'Спросить').totalTokens, null);
  const interrupted = rows.find(r => r.operation === 'Прерванная операция');
  assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.totalTokens, null);
  assert.equal(interrupted.durationMs, null); assert.equal(interrupted.inputTokens, 10);
  const file = path.join(journal.root, interrupted.id + '.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.writeFileSync(path.join(journal.root, 'a'.repeat(36) + '.json'), 'broken');
  assert.equal(restored.read().errors.length, 1);
});
test('journal write errors do not break model operations and raw content is never stored', async t => {
  const { journal, root } = setup(t);
  const call = journal.call(); call.event({ ...turn(), item: { text: 'SECRET_PROMPT_AND_REPLY' } }); call.end();
  assert(!fs.readFileSync(path.join(journal.root, fs.readdirSync(journal.root)[0]), 'utf8').includes('SECRET'));
  const file = path.join(root, 'file'); fs.writeFileSync(file, 'not a directory');
  const errors = [], unavailable = createTokenJournal(path.join(file, 'journal'), { onError: e => errors.push(e) });
  assert.equal(await unavailable.operation('Спросить', async () => { const c = unavailable.call(); c.event(turn()); c.end(); return 'answer'; }), 'answer');
  assert(errors.length > 0);
});
test('async service captures all model steps until job settlement and does not duplicate a replay', async t => {
  const { journal } = setup(t); configure(journal);
  let resolve, job, status = 'running';
  const service = wrapAgentService({
    start: async () => { job ||= (async () => { await new Promise(r => { resolve = r; }); const c = journal.call(); c.event(turn(9, 1, 0)); c.end(); status = 'completed'; })(); return { status }; },
    whenSettled: () => job, poll: async () => ({ status }),
  }, 'Генерация · MCP');
  await service.start({ identity: { runId: 'run' } }); await service.start({ identity: { runId: 'run' } });
  assert.equal(journal.read().records.length, 1); assert.equal(journal.read().records[0].status, 'running');
  resolve(); await job; await new Promise(r => setImmediate(r));
  assert.equal(journal.read().records[0].totalTokens, 10); assert.equal(journal.read().records[0].status, 'completed');
});
test('Claude result usage counts cache categories once and prefers whole-model totals', () => {
  assert.deepEqual(claudeUsage({ usage: { input_tokens: 2, output_tokens: 7, cache_read_input_tokens: 8, cache_creation_input_tokens: 3 } }), { input_tokens: 13, output_tokens: 7, cached_input_tokens: 8 });
  assert.deepEqual(claudeUsage({ modelUsage: { a: { inputTokens: 2, outputTokens: 4, cacheReadInputTokens: 3, cacheCreationInputTokens: 5 }, b: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } }, usage: { input_tokens: 999 } }), { input_tokens: 11, output_tokens: 6, cached_input_tokens: 3 });
  assert.deepEqual(claudeUsage({ usage: { input_tokens: 2, output_tokens: 7 } }), { input_tokens: null, output_tokens: 7, cached_input_tokens: null });
});
test('local check records accept only fixed zero-token telemetry; retries are idempotent', async t => {
  const { journal } = setup(t), express = require('express'), app = express();
  app.use(express.json()); mountJournalRoutes(app, journal);
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = body => fetch(base + '/usage/local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const body = { id: 'fixture:check', operation: 'check', startedAt: new Date().toISOString(), durationMs: 2345, status: 'completed' };
  assert.equal((await post(body)).status, 200); assert.equal((await post(body)).status, 200);
  assert.equal((await post({ ...body, totalTokens: 999 })).status, 400);
  assert.equal((await post({ ...body, operation: 'ask' })).status, 400);
  assert.equal((await post({ ...body, durationMs: 10 })).status, 409);
  const response = await (await fetch(base + '/usage')).json();
  assert.equal(response.records.length, 1); assert.equal(response.records[0].totalTokens, 0);
  assert.equal(response.records[0].durationMs, 2345); assert.equal(response.records[0].timeSource, 'plugin');
});
