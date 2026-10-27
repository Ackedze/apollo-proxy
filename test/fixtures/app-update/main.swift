import Foundation
import Sparkle

precondition(!AppUpdateState.unconfigured.canInstall)
precondition(AppUpdateState.available("2.0").canInstall)
precondition(AppUpdateState.checking.isBusy)
precondition(AppUpdateState.installing.isBusy)
precondition(!AppUpdateState.failed("offline").canInstall)
precondition(!AppUpdateState.current.canInstall)
precondition(AppUpdateState.available("2.0").summary.contains("2.0"))
let controller = SPUStandardUpdaterController(startingUpdater:false,updaterDelegate:nil,userDriverDelegate:nil)
let updater = AppUpdater()
updater.updaterDidNotFindUpdate(controller.updater)
updater.updater(controller.updater,didFinishUpdateCycleFor:.updateInformation,error:NSError(domain:SUSparkleErrorDomain,code:Int(SUError.noUpdateError.rawValue)))
precondition(updater.state == .current)
var released = false
updater.onAbortInstallation = { released = true }
updater.updater(controller.updater,didFinishUpdateCycleFor:.updates,error:NSError(domain:NSURLErrorDomain,code:-1009))
precondition(released)
if case .failed = updater.state {} else { preconditionFailure("Genuine error must remain visible") }

let fm = FileManager.default
let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
defer { try? fm.removeItem(at: root) }
let source = root.appendingPathComponent("new-app/embedded-proxy")
let home = root.appendingPathComponent("state/proxy")
@MainActor func put(_ base: URL, _ name: String, _ text: String) throws {
    let file = base.appendingPathComponent(name)
    try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try text.write(to: file, atomically: true, encoding: .utf8)
}
func expect(_ base: URL, _ name: String, _ text: String) throws {
    let actual = try String(contentsOf:base.appendingPathComponent(name),encoding:.utf8)
    precondition(actual == text)
}
for (name, value) in ["server.js":"new", "runtime/apollo/runtime":"new runtime", "node_modules/dependency":"new dependency", "scripts/code-release-cli.js":"new bootstrap", ".bundle-build-id":"new build"] { try put(source, name, value) }
for (name, value) in ["server.js":"old", ".env":"my account", ".local/token-journal/entry":"my tokens", "codex-workspace/debug-runs/report":"my report", "runtime/data/legacy":"old data", "runtime/config/settings":"my settings"] { try put(home, name, value) }
for (name, value) in ["credentials/account":"my credential", "history/chat":"my chat", "data-releases/state.json":"accepted data", "user-overrides.env":"my preferences"] { try put(root.appendingPathComponent("state"),name,value) }
try ProxyRuntimeInstaller.install(source: source, destination: home)
for (name, value) in ["server.js":"new", "runtime/apollo/runtime":"new runtime", "node_modules/dependency":"new dependency", "scripts/code-release-cli.js":"new bootstrap", ".env":"my account", ".local/token-journal/entry":"my tokens", "codex-workspace/debug-runs/report":"my report", "runtime/data/legacy":"old data", "runtime/config/settings":"my settings"] { try expect(home,name,value) }
for (name, value) in ["credentials/account":"my credential", "history/chat":"my chat", "data-releases/state.json":"accepted data", "user-overrides.env":"my preferences"] { try expect(root.appendingPathComponent("state"),name,value) }
print("App update state and install preservation PASS")
