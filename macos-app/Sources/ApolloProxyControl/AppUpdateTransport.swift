import Foundation

@MainActor
final class AppUpdateTransport {
    struct Configuration: Equatable {
        let nodeURL: URL
        let scriptURL: URL
        let feedURL: String
        let environment: [String: String]
    }
    private var process: Process?
    private var input: Pipe?
    private var output: Pipe?
    private var configuration: Configuration?
    private var pending: ((Result<URL, Error>) -> Void)?
    private var bytes = Data()
    private var launchID = UUID()
    private(set) var baseURL: URL?
    var feedURL: String? { baseURL?.appendingPathComponent("feed").absoluteString }

    func archiveURL(for remote: URL) -> URL? {
        guard let baseURL else { return nil }
        var parts = URLComponents(url: baseURL.appendingPathComponent("archive"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "url", value: remote.absoluteString)]
        return parts.url
    }
    func start(_ config: Configuration, completion: @escaping (Result<URL, Error>) -> Void) {
        if configuration == config, process?.isRunning == true, let baseURL { completion(.success(baseURL)); return }
        stop()
        configuration = config
        pending = completion
        let id = UUID(); launchID = id
        let task = Process(), stdin = Pipe(), stdout = Pipe()
        task.executableURL = config.nodeURL
        task.arguments = [config.scriptURL.path, config.feedURL]
        task.environment = config.environment
        task.standardInput = stdin; task.standardOutput = stdout; task.standardError = FileHandle.nullDevice
        process = task; input = stdin; output = stdout
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            Task { @MainActor [weak self] in self?.receive(data, id: id) }
        }
        task.terminationHandler = { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.launchID == id else { return }
                self.fail("Загрузчик обновлений остановился.")
            }
        }
        do { try task.run() }
        catch { fail("Не удалось запустить загрузчик обновлений."); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self, self.launchID == id, self.pending != nil else { return }
            self.fail("Загрузчик обновлений не ответил.")
        }
    }
    private func receive(_ data: Data, id: UUID) {
        guard launchID == id, pending != nil else { return }
        bytes.append(data)
        guard bytes.count <= 4096 else { fail("Некорректный ответ загрузчика обновлений."); return }
        guard let end = bytes.firstIndex(of: 10) else { return }
        guard let value = try? JSONSerialization.jsonObject(with: bytes[..<end]) as? [String: String],
              let text = value["baseURL"], let url = URL(string: text),
              url.scheme == "http", url.host == "127.0.0.1", url.port != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.range(of: "^/[0-9a-f]{48}$", options: .regularExpression) != nil else {
            fail("Некорректный адрес загрузчика обновлений."); return
        }
        baseURL = url
        output?.fileHandleForReading.readabilityHandler = nil
        let done = pending; pending = nil; bytes.removeAll(); done?(.success(url))
    }
    private func fail(_ message: String) {
        let done = pending; pending = nil
        stop()
        done?(.failure(NSError(domain: "ApolloAppUpdate", code: 2, userInfo: [NSLocalizedDescriptionKey: message])))
    }
    func stop() {
        launchID = UUID()
        output?.fileHandleForReading.readabilityHandler = nil
        process?.terminationHandler = nil
        try? input?.fileHandleForWriting.close()
        if process?.isRunning == true { process?.terminate() }
        process = nil; input = nil; output = nil; configuration = nil; baseURL = nil; bytes.removeAll()
    }
}
