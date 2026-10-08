const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const proxyNode = process.env.APOLLO_LIFECYCLE_TEST_NODE || process.execPath;
const proxyEntry = process.env.APOLLO_LIFECYCLE_TEST_SERVER || path.join(root, 'server.js');
const fixture = path.join(__dirname, 'fixtures/proxy-lifecycle/server.js');

async function until(check, detail, timeout = 8000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await delay(25);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${detail}`);
}

function launch(t, executable, args, env = {}) {
  // An isolated cwd avoids reading the developer's .env.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-lifecycle-'));
  const child = spawn(executable, args, {
    cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const observed = { child, output: '', error: '', exit: null };
  child.stdout.on('data', data => { observed.output += data; });
  child.stderr.on('data', data => { observed.error += data; });
  observed.exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => { observed.exit = { code, signal }; resolve(observed.exit); });
  });
  t.after(async () => {
    if (!observed.exit) child.kill('SIGKILL');
    await observed.exited;
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  return observed;
}

function fixtureReady(observed) {
  return until(() => {
    const match = observed.output.match(/\{"pid":(\d+),"port":(\d+)\}/);
    if (match) return { pid: Number(match[1]), port: Number(match[2]) };
    if (observed.exit) throw new Error(observed.error || observed.output || 'Child exited before listening');
    return null;
  }, 'fixture listening');
}

function get(port, pathname = '/health') {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: pathname, agent: false }, response => {
      let body = '';
      response.on('data', data => { body += data; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.setTimeout(1500, () => request.destroy(new Error('HTTP timeout')));
    request.on('error', reject);
  });
}

async function bindPort(port = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const actualPort = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return actualPort;
}

async function assertPortReleased(port) {
  await until(async () => {
    try { await bindPort(port); return true; }
    catch (error) { if (error.code === 'EADDRINUSE') return false; throw error; }
  }, `port ${port} released`);
}

async function proxyReady(observed, port) {
  await until(async () => {
    if (observed.exit) throw new Error(observed.error || observed.output || 'Proxy exited before listening');
    try {
      const response = await get(port);
      return response.status === 200 && JSON.parse(response.body).ok === true;
    } catch { return false; }
  }, 'real proxy health');
}

async function assertExited(observed) {
  await until(() => observed.exit, 'child exit');
  assert.deepEqual(await observed.exited, { code: 0, signal: null });
}

test('desktop-managed proxy stops on parent EOF and restarts on the same port', async t => {
  const port = await bindPort();
  for (let cycle = 0; cycle < 2; cycle++) {
    const observed = launch(t, proxyNode, [proxyEntry], {
      APOLLO_PROXY_MANAGED: '1', HOST: '127.0.0.1', PORT: String(port),
    });
    await proxyReady(observed, port);
    observed.child.stdin.end();
    await assertExited(observed);
    await assertPortReleased(port);
  }
});

test('desktop-managed proxy stops on SIGTERM and SIGINT', async t => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const port = await bindPort();
    const observed = launch(t, proxyNode, [proxyEntry], {
      APOLLO_PROXY_MANAGED: '1', HOST: '127.0.0.1', PORT: String(port),
    });
    await proxyReady(observed, port);
    observed.child.kill(signal);
    await assertExited(observed);
    await assertPortReleased(port);
  }
});

test('standalone proxy keeps running when stdin closes', async t => {
  const port = await bindPort();
  const observed = launch(t, proxyNode, [proxyEntry], {
    APOLLO_PROXY_MANAGED: '0', HOST: '127.0.0.1', PORT: String(port),
  });
  await proxyReady(observed, port);
  observed.child.stdin.end();
  await delay(100);
  assert.equal(observed.exit, null);
  assert.equal(JSON.parse((await get(port)).body).ok, true);
  observed.child.kill('SIGTERM');
  await observed.exited;
  await assertPortReleased(port);
});

test('a stalled HTTP request cannot retain the managed port after parent exit', async t => {
  const observed = launch(t, proxyNode, [fixture], { APOLLO_PROXY_MANAGED: '1' });
  const { port } = await fixtureReady(observed);
  const stalled = http.get({ host: '127.0.0.1', port, path: '/stall', agent: false });
  stalled.on('error', () => {});
  t.after(() => stalled.destroy());
  await new Promise(resolve => stalled.once('response', response => {
    response.on('error', () => {});
    response.once('data', resolve);
  }));
  const start = Date.now();
  observed.child.stdin.end();
  await assertExited(observed);
  assert.ok(Date.now() - start < 4000, 'shutdown must be bounded');
  await assertPortReleased(port);
});

test('native launcher owns the port across normal exit, force quit, and stubborn children', {
  skip: process.platform !== 'darwin', timeout: 30000,
}, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-native-lifecycle-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const executable = path.join(temporary, 'launcher');
  execFileSync('/usr/bin/swiftc', [
    path.join(root, 'macos-app/Sources/ApolloProxyControl/ProxyProcessLifecycle.swift'),
    path.join(__dirname, 'fixtures/proxy-lifecycle/main.swift'),
    '-o', executable,
  ], { stdio: 'pipe', timeout: 20000 });

  for (const mode of ['normal', 'force-quit', 'stubborn']) {
    await t.test(mode, async t => {
      const observed = launch(t, executable, [proxyNode, fixture], {
        TEST_IGNORE_SHUTDOWN: mode === 'stubborn' ? '1' : '0',
      });
      const { pid, port } = await fixtureReady(observed);
      t.after(() => {
        try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      });
      assert.equal((await get(port, '/')).body, 'ok');
      if (mode === 'force-quit') {
        observed.child.kill('SIGKILL');
        await observed.exited;
      } else {
        observed.child.stdin.end();
        await assertExited(observed);
        assert.match(observed.output, /NATIVE_STOPPED=true/);
      }
      await assertPortReleased(port);
      await until(() => {
        try { process.kill(pid, 0); return false; }
        catch (error) { if (error.code === 'ESRCH') return true; throw error; }
      }, `${mode}: proxy process reaped`);
    });
  }
});
