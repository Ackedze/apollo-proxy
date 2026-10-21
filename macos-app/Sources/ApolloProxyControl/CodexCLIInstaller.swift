import Foundation

@MainActor
final class CodexCLIInstaller {
    private let downloader: URL
    private let timeout: TimeInterval
    private var process: Process?
    private var timer: Timer?
    private var directory: URL?
    private var completion: ((Result<URL, Error>) -> Void)?
    var isRunning: Bool { completion != nil }

    init(downloader: URL = URL(fileURLWithPath: "/usr/bin/curl"), timeout: TimeInterval = 600) {
        self.downloader = downloader
        self.timeout = timeout
    }

    func install(environment: [String: String], completion: @escaping (Result<URL, Error>) -> Void) {
        guard !isRunning else { return }
        self.completion = completion
        let fm = FileManager.default
        let home = environment["HOME"] ?? fm.homeDirectoryForCurrentUser.path
        let binary = URL(fileURLWithPath: home).appendingPathComponent(".local/bin/codex")
        let temporary = fm.temporaryDirectory.appendingPathComponent("apollo-codex-install-" + UUID().uuidString)
        directory = temporary
        do { try fm.createDirectory(at: temporary, withIntermediateDirectories: false) }
        catch { finish(.failure(error)); return }
        let script = temporary.appendingPathComponent("install.sh")
        var installerEnvironment = environment
        installerEnvironment["CODEX_NON_INTERACTIVE"] = "1"
        installerEnvironment["CODEX_INSTALL_DIR"] = binary.deletingLastPathComponent().path
        timer = Timer.scheduledTimer(withTimeInterval: timeout, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.cancel(message: "Установка Codex заняла слишком много времени. Проверьте подключение и повторите вход.")
            }
        }
        run(downloader, arguments: ["--fail", "--silent", "--show-error", "--location", "--proto", "=https",
            "--proto-redir", "=https", "--connect-timeout", "20", "--max-time", "60",
            "https://chatgpt.com/codex/install.sh", "--output", script.path], environment: installerEnvironment,
            failure: "Не удалось скачать Codex. Проверьте подключение к интернету и повторите вход.") { [weak self] in
                self?.run(URL(fileURLWithPath: "/bin/sh"), arguments: [script.path], environment: installerEnvironment,
                    failure: "Не удалось установить Codex. Проверьте свободное место и подключение, затем повторите вход.") { [weak self] in
                        guard FileManager.default.isExecutableFile(atPath: binary.path) else {
                            self?.finish(.failure(Self.error("Установка завершилась, но Codex не найден. Повторите вход.")))
                            return
                        }
                        self?.finish(.success(binary))
                    }
            }
    }

    private func run(_ executable: URL, arguments: [String], environment: [String: String],
                     failure: String, success: @escaping @MainActor @Sendable () -> Void) {
        let task = Process()
        task.executableURL = executable
        task.arguments = arguments
        task.environment = environment
        task.standardInput = FileHandle.nullDevice
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice
        task.terminationHandler = { [weak self] finished in
            Task { @MainActor in
                guard let self, self.process === finished, self.isRunning else { return }
                self.process = nil
                if finished.terminationStatus == 0 { success() }
                else { self.finish(.failure(Self.error(failure))) }
            }
        }
        process = task
        do { try task.run() }
        catch { process = nil; finish(.failure(Self.error(failure))) }
    }

    func cancel(message: String = "Установка Codex отменена. Повторите вход, когда будете готовы.") {
        guard isRunning else { return }
        if let process { ProxyProcessLifecycle.stopAndWait([process]) }
        finish(.failure(Self.error(message)))
    }

    private func finish(_ result: Result<URL, Error>) {
        let callback = completion
        completion = nil
        process = nil
        timer?.invalidate(); timer = nil
        if let directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil
        callback?(result)
    }

    private static func error(_ message: String) -> NSError {
        NSError(domain: "ApolloProxyControl.CodexInstall", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
