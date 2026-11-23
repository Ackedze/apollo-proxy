import Foundation

final class LockedDataBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var storage = Data()

    func append(_ data: Data) {
        lock.lock()
        storage.append(data)
        lock.unlock()
    }

    func snapshot() -> Data {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

struct KnowledgeVersionSummary: Decodable {
    let contentVersion: String
    let packageVersion: String?
    let kind: String
    let path: String?
    let sourceCommits: [String: String?]?
    let knowledgeVersion: String?
}

struct KnowledgeCommandStatus: Decodable {
    let activationRequired: Bool?
    let runtimeMigrationRequired: Bool?
    let activationKeyID: String?
    var activationKey: String?
    let current: KnowledgeVersionSummary?
    let previous: KnowledgeVersionSummary?
    let designSystemRoot: String?
    let dsAiHubRoot: String?
    let updateAvailable: Bool?
    let recovered: Bool?
    let updated: Bool?
    let rolledBack: Bool?
    let descriptor: KnowledgeDescriptorSummary?
    let dataRoot: String?
    let releaseRoot: String?
}

struct KnowledgeDescriptorSummary: Decodable {
    let contentVersion: String
    let packageVersion: String?
}

enum KnowledgeCommandError: LocalizedError {
    case invalidOutput(String)
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .invalidOutput(let detail):
            return "Knowledge updater returned invalid output: \(detail)"
        case .failed(let detail):
            return detail
        }
    }
}

struct KnowledgeCommandRunner {
    let nodeURL: URL
    let cliURL: URL
    let storeURL: URL
    let seedURL: URL
    let descriptorURL: String?
    let environment: [String: String]
    var runtimeURL: URL? = nil
    var privateInput = Data("{}".utf8)
    var managedCommandURL: URL? = nil
    var commandTimeout: TimeInterval? = nil

    private func process(for command: String) throws -> (Process, Pipe, Pipe, Pipe) {
        guard privateInput.count <= 4096 else { throw KnowledgeCommandError.failed("DATA_ACTIVATION_INPUT_INVALID") }
        let task = Process()
        let stdout = Pipe()
        let stderr = Pipe()
        task.executableURL = nodeURL
        var arguments = [
            cliURL.path,
            command,
            "--store", storeURL.path,
            "--seed", seedURL.path,
            "--engine", "1.0.1",
        ]
        if let descriptorURL { arguments += ["--descriptor", descriptorURL] }
        if let runtimeURL { arguments += ["--runtime", runtimeURL.path] }
        if let managedCommandURL { arguments.insert(contentsOf: ["--require", managedCommandURL.path], at: 0) }
        task.arguments = arguments
        task.environment = environment.merging(["APOLLO_DATA_INPUT": "1"], uniquingKeysWith: { _, value in value })
        if managedCommandURL != nil {
            task.environment?["APOLLO_DATA_MANAGED"] = "1"
            let seconds = commandTimeout ?? (["update", "activate"].contains(command) ? 900 : 180)
            task.environment?["APOLLO_DATA_TIMEOUT_MS"] = String(Int(seconds * 1000))
        }
        let input = Pipe()
        task.standardInput = input
        input.fileHandleForWriting.write(privateInput + (managedCommandURL == nil ? Data() : Data("\n".utf8)))
        if managedCommandURL == nil { try? input.fileHandleForWriting.close() }
        task.standardOutput = stdout
        task.standardError = stderr
        return (task, stdout, stderr, input)
    }

    private func decode(stdout: Data, stderr: Data, exitCode: Int32) throws -> KnowledgeCommandStatus {
        let output = String(data: stdout, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if exitCode != 0 {
            if let object = try? JSONSerialization.jsonObject(with: stdout) as? [String: Any],
               let message = object["error"] as? String {
                throw KnowledgeCommandError.failed(message)
            }
            let detail = String(data: stderr, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw KnowledgeCommandError.failed(detail?.isEmpty == false ? detail! : output)
        }
        guard let data = output.data(using: .utf8) else {
            throw KnowledgeCommandError.invalidOutput("not UTF-8")
        }
        do {
            return try JSONDecoder().decode(KnowledgeCommandStatus.self, from: data)
        } catch {
            throw KnowledgeCommandError.invalidOutput(error.localizedDescription)
        }
    }

    func runSynchronously(_ command: String) throws -> KnowledgeCommandStatus {
        let (task, stdout, stderr, input) = try process(for: command)
        defer { try? input.fileHandleForWriting.close() }
        try task.run()
        task.waitUntilExit()
        return try decode(
            stdout: stdout.fileHandleForReading.readDataToEndOfFile(),
            stderr: stderr.fileHandleForReading.readDataToEndOfFile(),
            exitCode: task.terminationStatus
        )
    }

    @discardableResult
    func run(
        _ command: String,
        phase: @escaping @Sendable (String) -> Void,
        completion: @escaping @Sendable (Result<KnowledgeCommandStatus, Error>) -> Void
    ) throws -> Process {
        let (task, stdout, stderr, input) = try process(for: command)
        let stderrBuffer = LockedDataBuffer()
        stderr.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            stderrBuffer.append(data)
            guard let text = String(data: data, encoding: .utf8) else { return }
            for line in text.split(separator: "\n") {
                guard let lineData = String(line).data(using: .utf8),
                      let object = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                      let value = object["phase"] as? String else { continue }
                phase(value)
            }
        }
        task.terminationHandler = { finished in
            try? input.fileHandleForWriting.close()
            stderr.fileHandleForReading.readabilityHandler = nil
            let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
            let remainingError = stderr.fileHandleForReading.readDataToEndOfFile()
            stderrBuffer.append(remainingError)
            do {
                completion(.success(try decode(
                    stdout: stdoutData,
                    stderr: stderrBuffer.snapshot(),
                    exitCode: finished.terminationStatus
                )))
            } catch {
                completion(.failure(error))
            }
        }
        try task.run()
        return task
    }
}
