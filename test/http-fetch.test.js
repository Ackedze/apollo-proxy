'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { fetch } = require('../src/http-fetch');

test('update fetch uses the configured proxy and respects NO_PROXY', async t => {
  const keys = ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) before[key] === undefined ? delete process.env[key] : process.env[key] = before[key]; });
  for (const key of keys) delete process.env[key];
  let routed = 0;
  const proxy = http.createServer();
  proxy.on('connect', (req, socket) => {
    routed++;
    assert.equal(req.url, 'apollo.invalid:80');
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied'));
  });
  const direct = http.createServer((req, res) => res.end('direct'));
  for (const server of [proxy, direct]) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
  }
  process.env.HTTP_PROXY = `http://127.0.0.1:${proxy.address().port}`;
  assert.equal(await (await fetch('http://apollo.invalid/update', { signal: AbortSignal.timeout(3000) })).text(), 'proxied');
  assert.equal(routed, 1);
  process.env.NO_PROXY = '127.0.0.1';
  assert.equal(await (await fetch(`http://127.0.0.1:${direct.address().port}`, { signal: AbortSignal.timeout(3000) })).text(), 'direct');
  assert.equal(routed, 1);
  delete process.env.HTTP_PROXY;
  assert.equal(await (await fetch(`http://127.0.0.1:${direct.address().port}`)).text(), 'direct');
});
