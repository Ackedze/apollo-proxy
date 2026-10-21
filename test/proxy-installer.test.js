const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('app runtime replacement preserves own configuration, data/history and old install on preparation failure', {
  skip: process.platform !== 'darwin', timeout: 30000,
}, t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-install-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = path.join(root, 'main.swift');
  fs.writeFileSync(fixture, `
import Foundation
let fm = FileManager.default, root = URL(fileURLWithPath: CommandLine.arguments[1])
let source = root.appendingPathComponent("embedded"), old = root.appendingPathComponent("proxy")
func write(_ base: URL, _ name: String, _ body: String) throws {
 let file=base.appendingPathComponent(name)
 try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
 try body.write(to: file, atomically: true, encoding: .utf8)
}
try write(source,"server.js","new-code")
try write(old,"server.js","old-code")
let personal=[".env",".local/run-evals/a.json","codex-workspace/debug-runs/a.json","runtime/data/manifest.json","runtime/config/own.json"]
for name in personal { try write(old,name,"owned-"+name) }
do { try ProxyRuntimeInstaller.install(source: root.appendingPathComponent("missing"), destination: old); fatalError("missing source accepted") } catch {}
let oldCode = try String(contentsOf: old.appendingPathComponent("server.js"),encoding:.utf8)
assert(oldCode=="old-code")
try ProxyRuntimeInstaller.install(source:source,destination:old)
let newCode = try String(contentsOf: old.appendingPathComponent("server.js"),encoding:.utf8)
assert(newCode=="new-code")
for name in personal {
 let own = try String(contentsOf: old.appendingPathComponent(name),encoding:.utf8)
 assert(own=="owned-"+name)
}
print("configuration/history/data preservation PASS")
`);
  const binary = path.join(root, 'installer-test');
  execFileSync('/usr/bin/swiftc', ['-module-cache-path', path.join(root, 'module-cache'),
    path.resolve(__dirname, '../macos-app/Sources/ApolloProxyControl/ProxyRuntimeInstaller.swift'), fixture, '-o', binary], { timeout: 20000 });
  assert.match(execFileSync(binary, [root], { encoding: 'utf8' }), /preservation PASS/);
});
