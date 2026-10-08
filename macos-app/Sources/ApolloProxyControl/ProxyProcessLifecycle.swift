import Darwin
import Foundation

enum ProxyProcessLifecycle {
    static func connectParentLifetime(to child: Process) -> Pipe {
        let lifetime = Pipe()
        child.standardInput = lifetime
        var environment = child.environment ?? ProcessInfo.processInfo.environment
        environment["APOLLO_PROXY_MANAGED"] = "1"
        child.environment = environment
        // The app owns the writer. Even SIGKILL closes it, letting Node detect
        // EOF and stop listening without relying on an AppKit callback.
        return lifetime
    }

    static func requestStop(_ child: Process, lifetime: Pipe? = nil) {
        try? lifetime?.fileHandleForWriting.close()
        if child.isRunning {
            child.terminate()
        }
    }

    @discardableResult
    static func stopAndWait(_ children: [Process], gracePeriod: TimeInterval = 3) -> Bool {
        for child in children {
            requestStop(child)
        }
        waitForExit(children, timeout: gracePeriod)
        for child in children where child.isRunning {
            // Only processes owned by this launcher may be force-stopped.
            Darwin.kill(child.processIdentifier, SIGKILL)
        }
        waitForExit(children, timeout: 1)
        return children.allSatisfy { !$0.isRunning }
    }

    private static func waitForExit(_ children: [Process], timeout: TimeInterval) {
        let deadline = ProcessInfo.processInfo.systemUptime + timeout
        while children.contains(where: { $0.isRunning }),
              ProcessInfo.processInfo.systemUptime < deadline {
            Thread.sleep(forTimeInterval: 0.02)
        }
    }
}
