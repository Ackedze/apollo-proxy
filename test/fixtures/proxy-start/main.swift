import Darwin
import Foundation

// Exercise callback races without sleeps or an AppKit launch.
var request = ProxyStartRequest()
let old = request.request(knowledgeRunning: false)!
assert(request.request(knowledgeRunning: false) == nil)
assert(!request.checked(old, running: false, knowledgeRunning: true) && request.pending)
let resumed = request.request(knowledgeRunning: false)!
request.cancel()
let replacement = request.request(knowledgeRunning: false)!
assert(!request.checked(resumed, running: false, knowledgeRunning: false))
assert(request.checked(replacement, running: false, knowledgeRunning: false) && !request.pending)
let external = request.request(knowledgeRunning: false)!
assert(!request.checked(external, running: true, knowledgeRunning: false) && !request.pending)
request.cancel()

let args = CommandLine.arguments
let root = URL(fileURLWithPath: args[3]), mode = args[4]
let store = root.appendingPathComponent("store"), lock = store.appendingPathComponent(".update.lock")
let runner = KnowledgeCommandRunner(nodeURL: URL(fileURLWithPath: args[1]), cliURL: URL(fileURLWithPath: args[2]),
    storeURL: store, seedURL: root.appendingPathComponent("seed"), descriptorURL: nil, environment: ProcessInfo.processInfo.environment)
_ = try runner.runSynchronously("ensure")
let before = try Data(contentsOf: store.appendingPathComponent("state.json"))
if mode == "foreign" {
    let bytes = Data("{\"pid\":\(getpid())}".utf8)
    try bytes.write(to: lock)
    let token = request.request(knowledgeRunning: false)!
    assert(request.checked(token, running: false, knowledgeRunning: false))
    do { _ = try runner.runSynchronously("ensure"); fatalError("Foreign lock was bypassed") }
    catch { assert(error.localizedDescription == "DATA_RELEASE_BUSY") }
    let retainedLock = try Data(contentsOf: lock)
    assert(!request.pending && retainedLock == bytes)
} else {
    if mode == "offline" { try Data().write(to: root.appendingPathComponent("offline")) }
    let completion = DispatchSemaphore(value: 0), errorBuffer = LockedDataBuffer()
    let child = try runner.run("check", phase: { _ in }) { result in
        if case .failure(let error) = result { errorBuffer.append(Data(error.localizedDescription.utf8)) }
        completion.signal()
    }
    defer { if child.isRunning { child.terminate() } }
    let deadline = Date().addingTimeInterval(10), held = root.appendingPathComponent("held.json")
    while !FileManager.default.fileExists(atPath: held.path), Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
    let owner = try JSONSerialization.jsonObject(with: Data(contentsOf: held)) as! [String: Any]
    assert(owner["pid"] as? Int == Int(child.processIdentifier))
    assert((owner["lock"] as? [String: Int])?["pid"] == Int(child.processIdentifier))
    assert(kill(child.processIdentifier, 0) == 0)
    // This is the pre-fix overlap: the real data-release guard rejects ensure.
    do { _ = try runner.runSynchronously("ensure"); fatalError("Overlap was not reproduced") }
    catch { assert(error.localizedDescription == "DATA_RELEASE_BUSY") }
    assert(request.request(knowledgeRunning: true) == nil && request.pending)
    assert(request.request(knowledgeRunning: true) == nil)
    if mode == "cancel" { request.cancel() }
    try Data().write(to: root.appendingPathComponent("release"))
    assert(completion.wait(timeout: .now() + 10) == .success)
    let error = String(data: errorBuffer.snapshot(), encoding: .utf8)!
    assert(error == (mode == "offline" ? "OFFLINE_CHECK_FIXTURE" : ""))
    if request.pending {
        let token = request.request(knowledgeRunning: false)!
        assert(request.checked(token, running: false, knowledgeRunning: false))
        _ = try runner.runSynchronously("ensure")
    } else { assert(mode == "cancel") }
    assert(!request.pending && !FileManager.default.fileExists(atPath: lock.path))
}
let after = try Data(contentsOf: store.appendingPathComponent("state.json"))
assert(after == before)
print("startup \(mode) PASS")
