const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const fixture = require('./fixtures/proxy-start/knowledge');

test('native start waits for own knowledge lock, coalesces, cancels and preserves foreign-busy errors', {
  skip: process.platform !== 'darwin', timeout: 60000,
}, t => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-start-')));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const sources = path.resolve(__dirname, '../macos-app/Sources/ApolloProxyControl');
  const binary = path.join(temporary, 'start-test');
  execFileSync('/usr/bin/swiftc', ['-swift-version', '6', '-module-cache-path', path.join(temporary, 'cache'),
    path.join(sources, 'ProxyProcessLifecycle.swift'), path.join(sources, 'KnowledgeCommandRunner.swift'),
    path.join(__dirname, 'fixtures/proxy-start/main.swift'), '-o', binary], { timeout: 40000 });
  for (const mode of ['success', 'offline', 'cancel', 'foreign']) {
    const root = path.join(temporary, mode); fixture.create(root);
    const output = execFileSync(binary, [process.execPath, path.join(__dirname, 'fixtures/proxy-start/knowledge.js'), root, mode], { encoding: 'utf8', timeout: 15000 });
    assert.match(output, new RegExp(`startup ${mode} PASS`));
    const events = fs.readFileSync(path.join(root, 'timeline.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.filter(e => e.command === 'ensure' && e.event === 'start').length, ['cancel', 'foreign'].includes(mode) ? 2 : 3);
    assert.equal(events.filter(e => e.command === 'ensure' && e.event === 'unlocked').length, ['cancel', 'foreign'].includes(mode) ? 1 : 2);
    if (mode !== 'foreign') {
      const held = JSON.parse(fs.readFileSync(path.join(root, 'held.json')));
      assert.equal(held.pid, held.lock.pid);
      const final = events.at(-1);
      assert.equal(final.event, 'unlocked');
      assert.equal(final.command, mode === 'cancel' ? 'check' : 'ensure');
      t.diagnostic(JSON.stringify({ mode, held, events }));
    } else {
      t.diagnostic(JSON.stringify({ mode, error: 'DATA_RELEASE_BUSY', retried: false, events }));
    }
  }
});
