import Darwin
import Foundation

let args = CommandLine.arguments
let root = URL(fileURLWithPath: args[4]), mode = args[5]
var runner = KnowledgeCommandRunner(nodeURL: URL(fileURLWithPath: args[1]), cliURL: URL(fileURLWithPath: args[2]),
    storeURL: root.appendingPathComponent("store"), seedURL: root.appendingPathComponent("seed"),
    descriptorURL: nil, environment: ProcessInfo.processInfo.environment)
runner.managedCommandURL = URL(fileURLWithPath: args[3])
runner.privateInput = Data("{\"fixture\":\"private-input\"}".utf8)
runner.commandTimeout = mode == "timeout" ? 0.5 : 10
if mode == "oversized" {
    runner.privateInput = Data(repeating: 120, count: 5000)
    do { _ = try runner.runSynchronously("success"); preconditionFailure("Oversized native input accepted") }
    catch { precondition(error.localizedDescription == "DATA_ACTIVATION_INPUT_INVALID") }
    print("INPUT_REJECTED")
} else if mode == "success" {
    _ = try runner.runSynchronously("success")
    print("RELAUNCH_OK")
} else {
    let completed = DispatchSemaphore(value: 0), errors = LockedDataBuffer()
    let task = try runner.run("hold", phase: { _ in }) { result in
        if case .failure(let error) = result { errors.append(Data(error.localizedDescription.utf8)) }
        completed.signal()
    }
    let deadline = Date().addingTimeInterval(5)
    while !FileManager.default.fileExists(atPath: root.appendingPathComponent("held.json").path), Date() < deadline {
        Thread.sleep(forTimeInterval: 0.01)
    }
    precondition(task.isRunning)
    FileHandle.standardOutput.write(Data("READY \(task.processIdentifier)\n".utf8))
    if mode == "timeout" {
        precondition(completed.wait(timeout: .now() + 5) == .success)
        precondition(!task.isRunning)
        precondition(String(data: errors.snapshot(), encoding: .utf8) == "DATA_RELEASE_TIMEOUT")
        print("TIMEOUT_OK")
    } else {
        _ = readLine()
        precondition(ProxyProcessLifecycle.stopAndWait([task]))
        precondition(completed.wait(timeout: .now() + 2) == .success)
        print("OWNED_CHILD_STOPPED")
    }
}
