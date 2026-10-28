const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

test('one native check sequences both channels, preserves independent outcomes and requires explicit install actions', { skip: process.platform !== 'darwin', timeout: 30000 }, t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-updates-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const source = path.resolve(__dirname, '../macos-app/Sources/ApolloProxyControl');
  const binary = path.join(temporary, 'updates-test');
  const files = ['AgentCLI.swift', 'KnowledgeCommandRunner.swift', 'CodeReleaseCommand.swift', 'ProxyUpdateCheck.swift', 'ProxyDetailsWindow.swift', 'ProxyUpdatesWindow.swift'];
  execFileSync('/usr/bin/swiftc', [...files.map(file => path.join(source, file)), path.join(__dirname, 'fixtures/proxy-update-check/main.swift'), '-swift-version', '6', '-o', binary], { timeout: 20000 });
  assert.match(execFileSync(binary, { encoding: 'utf8' }), /Unified update check PASS/);
});
