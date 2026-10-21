const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('native health reader identifies Apollo, rejects foreign/error replies and preserves busy/package state', {
  skip: process.platform !== 'darwin', timeout: 30000,
}, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-proxy-health-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binary = path.join(root, 'health-test');
  execFileSync('/usr/bin/swiftc', [
    path.join(__dirname, '../macos-app/Sources/ApolloProxyControl/ProxyHealthSnapshot.swift'),
    path.join(__dirname, 'fixtures/proxy-health/main.swift'), '-o', binary,
  ], { timeout: 20000 });
  assert.match(execFileSync(binary, { encoding: 'utf8' }), /regression cases PASS/);
});
