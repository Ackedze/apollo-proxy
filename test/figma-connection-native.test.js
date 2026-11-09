'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
test('native Figma settings show independent states; owned login supports cancellation and retry', {skip:process.platform!=='darwin',timeout:60000},t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'figma-native-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const sources=path.resolve(__dirname,'../macos-app/Sources/ApolloProxyControl'),fixture=path.join(root,'Fixture.swift'),binary=path.join(root,'fixture'),script=path.join(root,'fake-auth.js');
 fs.writeFileSync(script,`const fs=require('node:fs'),mode=process.argv.at(-1);if(mode==='/hold'){fs.writeFileSync(process.env.FIXTURE_READY,String(process.pid));process.stdin.resume();}else{process.exitCode=mode==='/success'?0:1;const value={state:'connected',server:'apollo_figma_mcp',fileAccessVerified:false};if(mode!=='/success'&&mode!=='/nonzero-connected'){value.state='unknown';value.reason='CODE_UPDATE_REQUIRED';}if(mode==='/wrong-server')value.server='other';if(mode==='/wrong-state')value.state='invalid';if(mode==='/oversized')value.padding='x'.repeat(8193);console.log(mode==='/malformed'?'{':JSON.stringify(value));}`);
 fs.writeFileSync(fixture,String.raw`
import AppKit
@main @MainActor struct Fixture {
 static func wait(_ test: () -> Bool) async throws {
  for _ in 0..<250 { if test() { return }; try await Task.sleep(for: .milliseconds(20)) }
  fatalError("Native fixture timed out")
 }
 static func read(_ state: String, reason: String = "") -> FigmaConnectionState {
  FigmaConnectionState.read(Data("{\"server\":\"apollo_figma_mcp\",\"state\":\"\(state)\",\"reason\":\"\(reason)\"}".utf8))
 }
 static func views(_ view: NSView) -> [NSView] { [view] + view.subviews.flatMap(views) }
 static func main() async throws {
  assert(read("connected") == .connected)
  assert(read("not_connected") == .notConnected)
  assert(read("reauthentication_required") == .reconnect)
  assert(read("cancelled") == .cancelled)
  assert(read("config_conflict") == .configurationConflict)
  assert(read("unknown", reason: "CHECK_TIMEOUT").title.contains("Проверьте сеть"))
  assert(FigmaConnectionState.read(Data("{\"state\":\"connected\"}".utf8)) != .connected)
  let _ = NSApplication.shared
  let details = ProxyDetailsWindowController()
  guard let content = details.window?.contentView else { fatalError("Missing native settings") }
  var snapshot = ProxyDetailsSnapshot(); snapshot.provider = .codex; snapshot.canConnectFigma = true
  for state: FigmaConnectionState in [.notChecked, .notConnected, .connecting, .connected, .reconnect, .cancelled, .configurationConflict, .unknown("Проверьте сеть")] {
   snapshot.figmaState = state; snapshot.figmaBusy = state == .connecting
   details.update(snapshot); content.layoutSubtreeIfNeeded()
   let all = views(content), buttons = all.compactMap { $0 as? NSButton }
   let connect = buttons.first { ["Подключить Figma", "Подключить повторно"].contains($0.title) }!
   let cancel = buttons.first { $0.title == "Отменить" }!
   assert(connect.isEnabled == !snapshot.figmaBusy)
   assert(cancel.isHidden == !snapshot.figmaBusy)
   let status = all.compactMap { $0 as? NSTextField }.first { $0.stringValue == state.title }!
   assert(status.frame.width <= 512)
   assert(connect.fittingSize.width + buttons.first { $0.title == "Проверить подключение" }!.fittingSize.width + cancel.fittingSize.width + 16 <= 472)
  }
  let args = CommandLine.arguments, runner = FigmaConnectionController(), node = URL(fileURLWithPath: args[1]), script = URL(fileURLWithPath: args[2]), marker = args[3]
  var environment = ProcessInfo.processInfo.environment; environment["FIXTURE_READY"] = marker
  runner.start(node: node, script: script, binary: URL(fileURLWithPath: "/hold"), environment: environment, login: true)
  assert(runner.state == .connecting)
  try await wait { FileManager.default.fileExists(atPath: marker) }
  runner.cancel(); try await wait { !runner.isRunning }; assert(runner.state == .cancelled)
  runner.start(node: node, script: script, binary: URL(fileURLWithPath: "/success"), environment: environment, login: false)
  try await wait { !runner.isRunning }; assert(runner.state == .connected)
  for mode in ["code-update-required", "nonzero-connected", "malformed", "wrong-server", "wrong-state", "oversized"] {
   runner.start(node: node, script: script, binary: URL(fileURLWithPath: "/" + mode), environment: environment, login: false)
   try await wait { !runner.isRunning }
   if mode == "code-update-required" { assert(runner.state == read("unknown", reason: "CODE_UPDATE_REQUIRED")) }
   else { assert(runner.state == .unknown("Не удалось проверить подключение. Повторите проверку.")) }
  }
  details.close(); print("NATIVE_FIGMA_STATES_LAYOUT_LIFETIME_RETRY_PASS")
 }
}
`);
 execFileSync('/usr/bin/swiftc',['-swift-version','6','-module-cache-path',path.join(root,'cache'),...['AgentCLI.swift','ProxyProcessLifecycle.swift','FigmaConnection.swift','ProxyDetailsWindow.swift'].map(n=>path.join(sources,n)),fixture,'-o',binary],{timeout:40000,stdio:['ignore','pipe','pipe']});
 const out=execFileSync(binary,[process.execPath,script,path.join(root,'ready')],{encoding:'utf8',timeout:15000});assert.match(out,/NATIVE_FIGMA_STATES_LAYOUT_LIFETIME_RETRY_PASS/);
});
