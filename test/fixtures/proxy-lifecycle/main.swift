import Foundation

let child = Process()
child.executableURL = URL(fileURLWithPath: CommandLine.arguments[1])
child.arguments = [CommandLine.arguments[2]]
child.standardOutput = FileHandle.standardOutput
child.standardError = FileHandle.standardError
let lifetime = ProxyProcessLifecycle.connectParentLifetime(to: child)
try child.run()
withExtendedLifetime(lifetime) {
    _ = FileHandle.standardInput.readDataToEndOfFile()
    try? lifetime.fileHandleForWriting.close()
    // Shorten only the test's native fallback timeout.
    let stopped = ProxyProcessLifecycle.stopAndWait([child], gracePeriod: 0.2)
    print("NATIVE_STOPPED=\(stopped)")
}
