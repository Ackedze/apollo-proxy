'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MODEL, allowsLocalRequest, checkKey, complete, createApproval } = require('../src/skills/ux-writer/openrouter');

const key = 'test-openrouter-key';

test('connect and recheck only query the key endpoint and reject management credentials', async () => {
  await checkKey(key, async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/key');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer ' + key);
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    return Response.json({ data: { is_management_key: false } });
  });
  await assert.rejects(checkKey('', () => assert.fail('key missing')),
    { code: 'OPENROUTER_KEY_REQUIRED' });
  await assert.rejects(checkKey(key, () => Response.json({ data: { is_management_key: true } })),
    { code: 'OPENROUTER_KEY_REJECTED' });
});

test('completion sends the fixed model, output schema and provider restrictions, then records usage', async () => {
  let usage;
  const result = await complete({ key, prompt: 'Синтетический текст', onUsage: value => { usage = value; },
    transport(url, options) {
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
      const body = JSON.parse(options.body);
      assert.equal(body.model, MODEL);
      assert.equal(body.messages[0].content, 'Синтетический текст');
      for (const field of ['max_tokens', 'max_completion_tokens', 'max_output_tokens']) {
        assert.equal(Object.hasOwn(body, field), false, 'Proxy must not cap editorial output: ' + field);
      }
      assert.equal(body.response_format.json_schema.strict, true);
      assert.deepEqual(body.provider, { require_parameters: true, data_collection: 'deny', zdr: true });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"findings":[]}' } }],
        usage: { prompt_tokens: 20, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 12 } } });
    },
  });
  assert.deepEqual(result, { findings: [] });
  assert.equal(usage.input_tokens, 20);
  assert.equal(usage.output_tokens, 7);
  assert.equal(usage.cached_input_tokens, 12);
});

test('remote failures remain typed and do not expose the upstream response', async () => {
  for (const [status, expected] of [[401, 'OPENROUTER_KEY_REJECTED'],
    [402, 'OPENROUTER_CREDITS_REQUIRED'], [429, 'OPENROUTER_RATE_LIMIT'],
    [503, 'OPENROUTER_UNAVAILABLE']]) {
    await assert.rejects(complete({ key, prompt: 'fixture',
      transport: () => new Response('upstream echoed ' + key, { status }),
    }), error => {
      assert.equal(error.code, expected);
      assert.equal(error.message.includes(key), false);
      return true;
    });
  }
  await assert.rejects(complete({ key, prompt: 'fixture',
    transport: () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"findings":[]}' } }] }),
  }), { code: 'UX_WRITER_RESPONSE_INVALID' });
});

test('paid calls accept the Figma iframe on loopback and reject foreign host, peer and named origin', () => {
  const local = { hostname: 'localhost', socket: { remoteAddress: '127.0.0.1' }, headers: { origin: 'null' } };
  assert.equal(allowsLocalRequest(local), true);
  assert.equal(allowsLocalRequest({ ...local, hostname: 'other.example' }), false);
  assert.equal(allowsLocalRequest({ ...local, socket: { remoteAddress: '192.0.2.1' } }), false);
  assert.equal(allowsLocalRequest({ ...local, headers: { origin: 'https://other.example' } }), false);
});

function confirm(approval, runId, key, token = 'a'.repeat(64)) {
  let status = 200;
  const req = {hostname:'localhost',socket:{remoteAddress:'127.0.0.1'},headers:{},
    get:() => token,body:{runId,key}};
  const res = {status(value) { status = value; return this; },json() { return this; }};
  approval.respond(req,res);
  return status;
}

test('approval FIFO isolates keys and a cancelled queued request cannot cancel the current review', async () => {
  const approval = createApproval('a'.repeat(64),2000), controller = new AbortController();
  const first = approval.wait({runId:'texts',texts:1});
  const middle = approval.wait({runId:'cancelled-passport',kind:'task-passport',screens:1},controller.signal);
  const rejected = assert.rejects(middle,{name:'AbortError'});
  const last = approval.wait({runId:'passport',kind:'task-passport',screens:2});
  void last.catch(() => {});
  assert.equal(approval.current.runId,'texts');
  assert.equal(confirm(approval,'passport','wrong-recipient'),409);
  assert.equal(confirm(approval,'texts','wrong-control','b'.repeat(64)),403);
  controller.abort();await rejected;
  assert.equal(approval.current.runId,'texts');
  assert.equal(confirm(approval,'texts','text-key'),200);
  assert.equal(await first,'text-key');
  assert.equal(approval.current.runId,'passport');
  assert.equal(confirm(approval,'texts','reused-key'),409);
  assert.equal(confirm(approval,'passport','passport-key'),200);
  assert.equal(await last,'passport-key');
  assert.equal(approval.current,null);
});

test('cancelling the current approval promotes the next review; its own timeout still applies', async () => {
  const approval = createApproval('a'.repeat(64),30), controller = new AbortController();
  const first = approval.wait({runId:'first'},controller.signal);
  const cancelled = assert.rejects(first,{name:'AbortError'});
  const second = approval.wait({runId:'second'});
  const expired = assert.rejects(second,{code:'OPENROUTER_APPROVAL_REQUIRED'});
  controller.abort();await cancelled;
  assert.equal(approval.current.runId,'second');
  assert.equal(confirm(approval,'first','wrong-key'),409);
  await expired;
  assert.equal(approval.current,null);
  assert.equal(confirm(approval,'second','late-key'),409);
});
