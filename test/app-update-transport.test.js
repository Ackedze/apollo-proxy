'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { startTransport } = require('../scripts/app-update-transport');
const feedURL = 'https://github.com/example/apollo/releases/latest/download/appcast.xml';
const archiveURL = 'https://github.com/example/apollo/releases/download/v2/app.zip';

test('Sparkle relay preserves archive bytes and ZIP filename, follows approved HTTPS redirects and carries no credentials', async t => {
  const archive = Buffer.from([0,255,42,16]), calls = [];
  const relay = await startTransport({ feedURL, request: async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url) === feedURL) return new Response('<rss/>');
    if (String(url) === archiveURL) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset.zip?signature=example' } });
    return new Response(archive);
  } });
  t.after(() => relay.close());
  assert.equal(await (await fetch(relay.baseURL + '/feed')).text(), '<rss/>');
  const response = await fetch(relay.baseURL + '/archive?url=' + encodeURIComponent(archiveURL));
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="app.zip"');
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), archive);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.options.redirect === 'manual' && !c.options.headers.Authorization));
  assert.equal((await fetch(relay.baseURL.replace(/[^/]+$/, 'wrong') + '/feed')).status, 404);
  const before = calls.length;
  assert.equal((await fetch(relay.baseURL + '/archive?url=' + encodeURIComponent('https://github.com/other/repo/releases/download/v2/app.zip'))).status, 502);
  assert.equal(calls.length, before);
  assert.equal((await fetch(relay.baseURL + '/archive?url=' + encodeURIComponent(archiveURL.replace('app.zip','bad%22name.zip')))).status, 502);
  assert.equal(calls.length, before);
});

test('Sparkle relay refuses unsafe feeds, redirects and archives', async t => {
  for (const url of ['http://github.com/example/apollo/releases/latest/download/appcast.xml', feedURL + '?token=secret', 'https://token@github.com/example/apollo/releases/latest/download/appcast.xml'])
    await assert.rejects(startTransport({ feedURL: url }));
  for (const location of ['http://github.com/example/apollo/releases/download/v2/app.zip','https://example.invalid/app.zip','https://token@release-assets.githubusercontent.com/asset.zip']) {
    const relay = await startTransport({ feedURL, request: async () => new Response(null, { status: 302, headers: { location } }) });
    try { assert.equal((await fetch(relay.baseURL + '/feed')).status, 502); }
    finally { relay.close(); }
  }
  const relay = await startTransport({ feedURL, request: async () => new Response(null, { status: 404 }) });
  t.after(() => relay.close());
  assert.equal((await fetch(relay.baseURL + '/feed')).status, 404);
});

test('Sparkle receives ZIP bytes while the upstream download is still in progress', async t => {
  let finish;
  const remainder = new Promise(resolve => { finish = resolve; });
  const archive = Buffer.from([1,2,3,4,5,6,7,8]);
  let finished = false;
  const relay = await startTransport({ feedURL, request: async () => new Response(new ReadableStream({
    async start(controller) {
      controller.enqueue(archive.subarray(0,4));
      await remainder;
      finished = true;
      controller.enqueue(archive.subarray(4));
      controller.close();
    }
  }), { headers: { 'Content-Length': String(archive.length) } }) });
  t.after(() => { finish(); relay.close(); });
  const response = await fetch(relay.baseURL + '/archive?url=' + encodeURIComponent(archiveURL), {
    signal: AbortSignal.timeout(1000)
  });
  assert.equal(response.headers.get('content-length'), String(archive.length));
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.deepEqual(Buffer.from(first.value), archive.subarray(0,4));
  assert.equal(finished, false);
  finish();
  const chunks = [first.value];
  for (;;) { const item = await reader.read(); if (item.done) break; chunks.push(item.value); }
  assert.deepEqual(Buffer.concat(chunks), archive);
});

test('Sparkle relay rejects an oversized declared archive before forwarding its body', async t => {
  const relay = await startTransport({ feedURL, request: async () => new Response('too large', {
    headers: { 'Content-Length': String(512 * 1024 * 1024 + 1) }
  }) });
  t.after(() => relay.close());
  assert.equal((await fetch(relay.baseURL + '/archive?url=' + encodeURIComponent(archiveURL))).status, 502);
});

test('Sparkle relay does not complete a truncated archive as a successful download', async t => {
  const relay = await startTransport({ feedURL, request: async () => new Response('part', {
    headers: { 'Content-Length': '8' }
  }) });
  t.after(() => relay.close());
  await assert.rejects(async () => {
    const response = await fetch(relay.baseURL + '/archive?url=' + encodeURIComponent(archiveURL));
    await response.arrayBuffer();
  });
});

test('cancelling the Sparkle download aborts the upstream request', async t => {
  let aborted;
  const upstreamAborted = new Promise(resolve => { aborted = resolve; });
  const relay = await startTransport({ feedURL, request: async (url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from('first'));
      signal.addEventListener('abort', () => { controller.error(signal.reason); aborted(); }, { once: true });
    }
  })) });
  t.after(() => relay.close());
  const response = await fetch(relay.baseURL + '/archive?url=' + encodeURIComponent(archiveURL), {
    signal: AbortSignal.timeout(1000)
  });
  const reader = response.body.getReader();
  assert.equal(Buffer.from((await reader.read()).value).toString(), 'first');
  await reader.cancel();
  await upstreamAborted;
});
