import Foundation

enum ProxyRuntimeInstaller {
    static func install(source: URL, destination: URL) throws {
        let fm = FileManager.default
        let parent = destination.deletingLastPathComponent()
        let stage = parent.appendingPathComponent(".proxy-install-" + UUID().uuidString)
        let backup = parent.appendingPathComponent(".proxy-backup-" + UUID().uuidString)
        try fm.createDirectory(at: parent, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: stage) }
        try fm.copyItem(at: source, to: stage)
        // Existing installations can still keep mutable history/config/data under the old code root.
        for relative in [".env", ".local", "codex-workspace/debug-runs", "runtime/data", "runtime/config"] {
            let old = destination.appendingPathComponent(relative)
            guard fm.fileExists(atPath: old.path) else { continue }
            let preserved = stage.appendingPathComponent(relative)
            if fm.fileExists(atPath: preserved.path) { try fm.removeItem(at: preserved) }
            try fm.createDirectory(at: preserved.deletingLastPathComponent(), withIntermediateDirectories: true)
            try fm.copyItem(at: old, to: preserved)
        }
        let existed = fm.fileExists(atPath: destination.path)
        if existed { try fm.moveItem(at: destination, to: backup) }
        do { try fm.moveItem(at: stage, to: destination) }
        catch {
            if existed { try fm.moveItem(at: backup, to: destination) }
            throw error
        }
        if existed { try? fm.removeItem(at: backup) }
    }
}
