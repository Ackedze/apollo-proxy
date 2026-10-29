const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createTokenJournal, configure, wrapAgentService, mountJournalRoutes } = require('../src/token-journal');
const { claudeUsage } = require('../src/cli-agent');
const turn = (input = 100, output = 20, cached = 90) => ({ type: 'turn.completed', usage: { input_tokens: input, output_tokens: output, cached_input_tokens: cached } });
const sessionA = '01a1654b-fc1e-7092-918e-ee798befe820', sessionB = '01a1656f-2d23-72b0-b251-3af6871fe8ed';
function sessionCall(journal, operation, id = sessionA, resume = false) {
  const call = journal.call({ provider: 'codex', operation, cumulativeUsage: true, resumeSessionId: resume ? id : null });
  call.event({ type: 'thread.started', thread_id: id });
  call.event({ type: 'turn.started' });
  return call;
}
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
test('resumed CLI counters become exact per-call deltas, including cached and reasoning subsets', t => {
  const { journal } = setup(t);
  const raw = [[19869,691,10752,212],[46573,942,30464,301],[77992,1042,56960,301]];
  for (let i = 0; i < raw.length; i++) {
    const call = sessionCall(journal, 'batch-' + i, sessionA, i > 0), [input,output,cached,reasoning] = raw[i];
    call.event({ ...turn(input,output,cached), usage: { ...turn(input,output,cached).usage, reasoning_output_tokens: reasoning } });
    call.end(); call.end(); call.event(turn(999999,999999,0));
  }
  const rows = [0,1,2].map(i => journal.read().records.find(r => r.operation === 'batch-' + i));
  assert.deepEqual(rows.map(r => r.totalTokens), [20560,26955,31519]);
  assert.deepEqual(rows.map(r => r.inputTokens), [19869,26704,31419]);
  assert.deepEqual(rows.map(r => r.outputTokens), [691,251,100]);
  assert.deepEqual(rows.map(r => r.cachedInputTokens), [10752,19712,26496]);
  assert.deepEqual(rows.map(r => r.reasoningOutputTokens), [212,89,0]);
  assert.equal(rows.reduce((n,r) => n + r.totalTokens,0),79034);
  assert(rows.every(r => r.calls === 1));
});
test('session checkpoints stay separate and cumulative iterations and event replays count once', t => {
  const { journal } = setup(t);
  const a = sessionCall(journal,'A'), b = sessionCall(journal,'B',sessionB);
  a.event(turn(100,20,50)); b.event(turn(10,2,5));
  a.event({ type:'turn.started' }); a.event(turn(150,30,60)); a.event(turn(150,30,60));
  a.end(); b.end();
  const a2 = sessionCall(journal,'A2',sessionA,true); a2.event(turn(200,40,80)); a2.end();
  const b2 = sessionCall(journal,'B2',sessionB,true); b2.event(turn(20,4,10)); b2.end();
  const totals = Object.fromEntries(journal.read().records.map(r => [r.operation,r.totalTokens]));
  assert.deepEqual(totals,{ A:180,B:12,A2:60,B2:12 });
});
test('failed and cancelled usage gaps remain unknown and are not charged to the next batch', t => {
  const { journal } = setup(t);
  const first = sessionCall(journal,'first'); first.event(turn(100,20,50)); first.end();
  const failed = sessionCall(journal,'failed',sessionA,true); failed.event(turn(110,23,55));
  failed.event({ type:'turn.started' }); failed.event({ type:'turn.failed' }); failed.end(Error('cancelled'));
  const retry = sessionCall(journal,'retry',sessionA,true); retry.event(turn(200,40,80)); retry.end();
  const recovered = sessionCall(journal,'recovered',sessionA,true); recovered.event(turn(250,50,100)); recovered.end();
  const cancelled = sessionCall(journal,'cancelled',sessionA,true); cancelled.end(Error('cancelled'));
  const rows = Object.fromEntries(journal.read().records.map(r => [r.operation,r]));
  assert.equal(rows.failed.totalTokens,null); assert.equal(rows.failed.inputTokens + rows.failed.outputTokens,13);
  assert.equal(rows.retry.totalTokens,null); assert.equal(rows.recovered.totalTokens,60);
  assert.equal(rows.cancelled.totalTokens,null); assert.equal(rows.cancelled.cachedInputTokens,null);
});
test('counter resets, identity mismatches and missing fields never invent zero usage', t => {
  const { journal } = setup(t);
  const first = sessionCall(journal,'first'); first.event(turn(100,20,50)); first.end();
  const reset = sessionCall(journal,'reset',sessionA,true); reset.event(turn(10,2,5)); reset.end();
  const afterReset = sessionCall(journal,'after-reset',sessionA,true); afterReset.event(turn(30,6,10)); afterReset.end();
  const missing = sessionCall(journal,'missing',sessionA,true); missing.event({ type:'turn.completed',usage:{ input_tokens:40,output_tokens:8 } }); missing.end();
  const mismatch = sessionCall(journal,'mismatch',sessionA,true); mismatch.event({ type:'thread.started',thread_id:sessionB }); mismatch.event(turn(1000,200,500)); mismatch.end();
  const noIdentity = journal.call({ provider:'codex',operation:'no-identity',cumulativeUsage:true }); noIdentity.event(turn()); noIdentity.end();
  const rows = Object.fromEntries(journal.read().records.map(r => [r.operation,r]));
  assert.equal(rows.reset.totalTokens,null); assert.equal(rows['after-reset'].totalTokens,24);
  assert.equal(rows.missing.totalTokens,12); assert.equal(rows.missing.cachedInputTokens,null); assert.equal(rows.missing.reasoningOutputTokens,null);
  assert.equal(rows.mismatch.totalTokens,null); assert.equal(rows['no-identity'].totalTokens,null);
});
test('a restart does not guess a resumed baseline or rewrite completed history', t => {
  const { journal } = setup(t);
  const first = sessionCall(journal,'historical'); first.event(turn()); first.end();
  const historical = journal.read().records[0], file = path.join(journal.root,historical.id + '.json'), bytes = fs.readFileSync(file);
  const restored = createTokenJournal(journal.root);
  const resumed = sessionCall(restored,'after-restart',sessionA,true); resumed.event(turn(150,30,100)); resumed.end();
  assert.equal(restored.read().records.find(r => r.operation === 'after-restart').totalTokens,null);
  assert.deepEqual(fs.readFileSync(file),bytes);
});

test('local operation lifecycle retains start, strict receipts, separate unknown usage and all terminal outcomes', t => {
 const {journal}=setup(t),routes=new Map();mountJournalRoutes({get(){},post:(name,fn)=>routes.set(name,fn)},journal);
 const post=body=>{const response={code:200,status(code){this.code=code;return this;},json(value){this.body=value;return this;}};routes.get('/usage/local')({body},response);return response;};
 const base={id:'operation-1',operation:'reglyph-scan',startedAt:'2026-10-29T10:00:00.000Z',durationMs:null,status:'running',usageMode:'none'};
 assert.deepEqual(post(base).body,{success:true,id:base.id,status:'running'});assert.equal(journal.read().records[0].status,'running');
 const done={...base,status:'completed',durationMs:25};assert.deepEqual(post(done).body,{success:true,id:base.id,status:'completed'});assert.equal(post(done).code,200);assert.equal(journal.read().records.length,1);assert.equal(post({...done,status:'failed'}).code,409);assert.equal(post(base).code,409);
 for(const [i,operation]of ['check','recheck','reglyph-replace','layer-names-apply','layer-names-undo'].entries()){
  assert.equal(post({...done,id:'local-'+i,operation,status:i%2?'cancelled':'failed'}).code,200);
 }
 for(const operation of ['layer-names-run','pattern-check']){
  const start={...base,id:operation,operation};post(start);post({...start,usageMode:'separate'});assert.equal(post({...start,usageMode:'separate',status:'failed',durationMs:50}).code,200);
 }
 const records=journal.read().records;assert.ok(records.filter(r=>r.usageMode==='separate').every(r=>r.totalTokens===null));assert.ok(records.filter(r=>r.usageMode!=='separate').every(r=>r.totalTokens===0));assert.ok(records.some(r=>r.status==='cancelled'));
 for(const bad of [{...done,operation:'ask'},{...done,usageMode:'separate'},{...done,inputTokens:500},{...done,id:'../other'},{...done,status:'passed'}])assert.equal(post(bad).code,400);
});
test('local interrupted start can finish after Proxy restart without rewriting terminal history', t => {
 const {journal}=setup(t);let handler;const mount=j=>mountJournalRoutes({get(){},post:(name,fn)=>{handler=fn;}},j);
 const post=body=>{const response={code:200,status(code){this.code=code;return this;},json(value){this.body=value;}};handler({body},response);return response;};mount(journal);
 const base={id:'restart',operation:'reglyph-replace',startedAt:'2026-10-29T10:00:00.000Z',durationMs:null,status:'running',usageMode:'none'};post(base);
 const restored=createTokenJournal(journal.root);assert.equal(restored.read().records[0].status,'running');assert.equal(restored.read().records[0].durationMs,null);assert.equal(restored.read().records[0].totalTokens,0);mount(restored);
 assert.equal(post({...base,status:'completed',durationMs:30}).code,200);assert.equal(restored.read().records[0].status,'completed');
});
