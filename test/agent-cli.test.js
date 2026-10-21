const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('Codex discovery accepts standalone/user desktop installs and rejects non-executable files', () => {
  const config = path.resolve(__dirname, '../src/config.js');
  const code = `
    const fs = require('node:fs'), assert = require('node:assert/strict');
    const config = ${JSON.stringify(config)};
    const old = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
    const standalone = process.env.HOME + '/.local/bin/codex';
    let executable;
    fs.accessSync = p => { if (p !== executable) throw Error('not executable'); };
    function resolve(configured) {
      process.env.CODEX_BIN = configured;
      delete require.cache[config];
      return require(config).CODEX_BIN;
    }
    executable = standalone;
    assert.equal(resolve(old), standalone);
    assert.equal(resolve(''), standalone);
    executable = process.env.HOME + '/Applications/Codex.app/Contents/Resources/codex';
    assert.equal(resolve(old), executable);
    executable = '/custom/codex';
    assert.equal(resolve(executable), executable);
    executable = undefined;
    assert.equal(resolve(''), 'codex');
    console.log('PASS');
  `;
  assert.equal(execFileSync(process.execPath, ['-e', code], {
    env: { ...process.env, HOME: '/test designer' }, encoding: 'utf8',
  }).trim(), 'PASS');
  assert.match(fs.readFileSync(path.resolve(__dirname, '../.env.example'), 'utf8'), /^CODEX_BIN=$/m);
});

test('native Codex onboarding handles legacy defaults, installation failures, retry and cancellation', {
  skip: process.platform !== 'darwin', timeout: 60000,
}, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-cli-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = path.join(root, 'main.swift');
  fs.writeFileSync(fixture, String.raw`
import Foundation

let fm = FileManager.default
let root = URL(fileURLWithPath: CommandLine.arguments[1])
let home = root.appendingPathComponent("designer account")
try fm.createDirectory(at: home, withIntermediateDirectories: true)
let standalone = home.appendingPathComponent(".local/bin/codex")
let legacy = CLIProvider.legacyCodexBinary
let candidates = CLIProvider.codex.candidates(configured: legacy, home: home.path)
assert(candidates.contains(standalone.path))
assert(candidates.contains(home.path + "/Applications/Codex.app/Contents/Resources/codex"))
assert(CLIProvider.codex.candidates(configured: "/custom/codex", home: home.path) == ["/custom/codex"])
assert(CLIProvider.claude.candidates(configured: legacy, home: home.path) == [legacy])
assert(CLIProvider.codex.canInstall(configured: legacy))
assert(!CLIProvider.codex.canInstall(configured: "/custom/codex"))
assert(!CLIProvider.claude.canInstall(configured: ""))
assert(AgentCLI.authenticationStatus(provider: .codex, exitCode: 0, output: "Logged in using ChatGPT") == .authorized(method: "ChatGPT"))
assert(AgentCLI.authenticationStatus(provider: .codex, exitCode: 1, output: "") == .unauthorized)

let downloader = root.appendingPathComponent("fake-downloader")
let source = root.appendingPathComponent("fake-install.sh")
let marker = root.appendingPathComponent("installed")
let record = root.appendingPathComponent("download-arguments")
try """
#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_RECORD"
[ "$FAKE_DOWNLOAD_FAIL" != "1" ] || exit 22
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then /bin/cp "$FAKE_SCRIPT" "$2"; exit; fi
  shift
done
exit 2
""".write(to: downloader, atomically: true, encoding: .utf8)
try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: downloader.path)
var environment = ["HOME": home.path, "PATH": "/usr/bin:/bin", "FAKE_RECORD": record.path,
                   "FAKE_SCRIPT": source.path, "FAKE_MARKER": marker.path]
let installer = CodexCLIInstaller(downloader: downloader, timeout: 10)

@MainActor
func run(_ installer: CodexCLIInstaller, _ environment: [String: String]) -> Result<URL, Error> {
    var result: Result<URL, Error>?
    installer.install(environment: environment) { result = $0 }
    let deadline = Date().addingTimeInterval(15)
    while result == nil && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
    assert(result != nil && !installer.isRunning)
    return result!
}

try """
#!/bin/sh
[ "$CODEX_NON_INTERACTIVE" = "1" ] || exit 1
[ "$CODEX_INSTALL_DIR" = "$HOME/.local/bin" ] || exit 1
/usr/bin/touch "$FAKE_MARKER"
/bin/mkdir -p "$CODEX_INSTALL_DIR"
printf '#!/bin/sh\\nexit 0\\n' > "$CODEX_INSTALL_DIR/codex"
/bin/chmod +x "$CODEX_INSTALL_DIR/codex"
""".write(to: source, atomically: true, encoding: .utf8)
environment["FAKE_DOWNLOAD_FAIL"] = "1"
if case .success = run(installer, environment) { fatalError("download failure accepted") }
assert(!fm.fileExists(atPath: marker.path))
let failedDownload = try String(contentsOf: record, encoding: .utf8)
assert(failedDownload.contains("https://chatgpt.com/codex/install.sh"))
let failedDirectory = URL(fileURLWithPath: failedDownload.components(separatedBy: "\n").filter { $0.hasSuffix("/install.sh") }.last!).deletingLastPathComponent()
assert(!fm.fileExists(atPath: failedDirectory.path))

environment["FAKE_DOWNLOAD_FAIL"] = "0"
let installed = try run(installer, environment).get()
assert(installed == standalone && fm.isExecutableFile(atPath: installed.path))
let download = try String(contentsOf: record, encoding: .utf8)
assert(download.contains("--proto-redir\n=https"))
try fm.removeItem(at: standalone)

try "exit 9\n".write(to: source, atomically: true, encoding: .utf8)
if case .success = run(installer, environment) { fatalError("install failure accepted") }
try "exit 0\n".write(to: source, atomically: true, encoding: .utf8)
if case .success = run(installer, environment) { fatalError("missing binary accepted") }

try "while :; do :; done\n".write(to: source, atomically: true, encoding: .utf8)
let timedInstaller = CodexCLIInstaller(downloader: downloader, timeout: 0.2)
if case .success = run(timedInstaller, environment) { fatalError("timeout accepted") }
var cancelled = false
installer.install(environment: environment) { if case .failure = $0 { cancelled = true } }
installer.cancel()
assert(cancelled && !installer.isRunning)
print("native Codex onboarding regression cases PASS")
`);
  const sources = path.resolve(__dirname, '../macos-app/Sources/ApolloProxyControl');
  const binary = path.join(root, 'agent-test');
  execFileSync('/usr/bin/swiftc', ['-swift-version', '6',
    '-module-cache-path', path.join(root, 'module-cache'),
    path.join(sources, 'AgentCLI.swift'), path.join(sources, 'CodexCLIInstaller.swift'),
    path.join(sources, 'ProxyProcessLifecycle.swift'), fixture, '-o', binary,
  ], { timeout: 35000 });
  assert.match(execFileSync(binary, [root], { encoding: 'utf8', timeout: 20000 }), /regression cases PASS/);
});
