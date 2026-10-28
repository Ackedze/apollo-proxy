'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { fetch } = require('../src/http-fetch');

test('large non-keepalive response is drained before disk writes without a paused-parser process crash', async t => {
  const net = require('node:net'), { spawn } = require('node:child_process'), path = require('node:path');
  const payload = Buffer.alloc(1024 * 1024, 97);
  const server = net.createServer(socket => socket.once('data', () => {
    socket.end(Buffer.concat([Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: ' + payload.length + '\r\nConnection: close\r\n\r\n'), payload]));
  }));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => server.close());
  const script = `const {fetch,readBytes}=require(${JSON.stringify(path.resolve(__dirname,'../src/http-fetch'))});(async()=>{const r=await fetch('http://127.0.0.1:${server.address().port}/');const b=await readBytes(r,1048576);if(b.length!==1048576)throw Error('short response');console.log('complete');})().catch(e=>{console.error(e.code);process.exitCode=1});`;
  const child = spawn(process.execPath,['-e',script],{env:{...process.env,HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',http_proxy:'',https_proxy:'',NO_PROXY:'127.0.0.1',no_proxy:'127.0.0.1'}});
  let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const exit = await new Promise(resolve=>child.once('exit',resolve));
  assert.equal(exit,0,stderr);assert.match(stdout,/complete/);
});

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
