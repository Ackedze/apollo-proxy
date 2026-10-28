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
