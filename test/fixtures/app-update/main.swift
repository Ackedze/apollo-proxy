import Foundation
import Sparkle

let defaultsName = "apollo-update-resume-test-" + UUID().uuidString
let defaults = UserDefaults(suiteName: defaultsName)!
defer { defaults.removePersistentDomain(forName: defaultsName) }
let intent = AppUpdateResumeIntent(defaults: defaults)
precondition(!intent.consume())
intent.prepare(managedRunning: true)
precondition(AppUpdateResumeIntent(defaults: defaults).consume())
precondition(!intent.consume(), "Resume must be one-shot")
intent.prepare(managedRunning: true)
intent.prepare(managedRunning: false)
precondition(!intent.consume(), "Stopped/external Proxy must remain stopped")
intent.prepare(managedRunning: true)
intent.cancel()
precondition(!intent.consume(), "Cancelled update must clear resume")

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

let handoff = AppUpdater()
var installed = false
released = false
handoff.onAbortInstallation = { released = true; intent.cancel() }
handoff.prepareInstallation = { completion in intent.prepare(managedRunning: true); completion(true) }
handoff.finishInstallation { installed = true }
handoff.updater(controller.updater, didFinishUpdateCycleFor: .updates, error: nil)
precondition(installed && !released, "Normal cycle finish after committed install must preserve resume and lease")
precondition(handoff.hasSession && handoff.state.isBusy, "Committed installation must stay busy until relaunch")
precondition(intent.consume())
handoff.finishInstallation {}
handoff.updater(controller.updater, didFinishUpdateCycleFor: .updates, error: NSError(domain: NSURLErrorDomain, code: -1009))
precondition(released && !intent.consume(), "Installation error must clear committed resume")
precondition(!handoff.hasSession && !handoff.state.isBusy)
released = false
handoff.prepareInstallation = { completion in intent.prepare(managedRunning: true); completion(false) }
handoff.finishInstallation { preconditionFailure("Denied preparation must not install") }
precondition(released && !intent.consume())
precondition(!handoff.hasSession && !handoff.state.isBusy)
released = false
handoff.updater(controller.updater, didFinishUpdateCycleFor: .updates, error: nil)
precondition(released, "Dismissed update without committed install must abort")

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
