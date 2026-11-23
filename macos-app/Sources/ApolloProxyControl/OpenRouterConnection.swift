import Foundation
import LocalAuthentication
import Security

enum OpenRouterConnection {
    static let enabledPreference = "ux-writer.openrouter.enabled"
    static let enabledEnvironment = "APOLLO_UX_WRITER_OPENROUTER"
    static let legacyKeyEnvironment = "APOLLO_UX_WRITER_OPENROUTER_KEY"

    static func workerEnvironment(_ inherited: [String: String], enabled: Bool) -> [String: String] {
        var values = inherited
        values[enabledEnvironment] = enabled ? "1" : "0"
        values.removeValue(forKey: legacyKeyEnvironment)
        return values
    }

    private static var keychainQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "com.redpol.apollo-proxy-control") + ".ux-writer.openrouter",
            kSecAttrAccount as String: "active",
        ]
    }

    static func loadKey() -> String? {
        var query = keychainQuery
        query[kSecReturnData as String] = true
        let context = LAContext()
        context.interactionNotAllowed = true
        query[kSecUseAuthenticationContext as String] = context
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func saveKey(_ key: String) throws {
        let data = Data(key.utf8)
        let update = SecItemUpdate(keychainQuery as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecItemNotFound {
            var item = keychainQuery
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw Failure("KEYCHAIN") }
        } else if update != errSecSuccess {
            throw Failure("KEYCHAIN")
        }
    }

    struct Failure: LocalizedError {
        let code: String
        init(_ code: String) { self.code = code }
        var errorDescription: String? {
            switch code {
            case "KEYCHAIN": "Не удалось сохранить ключ в Связке ключей."
            case "OPENROUTER_KEY_REQUIRED": "Введите API-ключ OpenRouter."
            case "OPENROUTER_KEY_REJECTED": "OpenRouter отклонил ключ. Введите действующий API-ключ."
            case "OPENROUTER_CREDITS_REQUIRED": "Недостаточно средств или исчерпан лимит ключа."
            case "OPENROUTER_TIMEOUT": "OpenRouter не ответил вовремя. Повторите проверку."
            case "OPENROUTER_RATE_LIMIT": "Слишком много запросов. Повторите проверку позже."
            case "OPENROUTER_APPROVAL_REQUIRED": "Отправка текстов отменена."
            case "CODEX_INPUT_BUDGET_EXCEEDED": "Слишком много текста. Выберите область поменьше и повторите проверку."
            case "UX_WRITER_RESPONSE_INVALID": "OpenRouter вернул неполный ответ. Повторите проверку."
            default: "Не удалось проверить подключение к OpenRouter. Повторите попытку."
            }
        }
    }

    static func checkKey(_ key: String, node: URL, script: URL, environment: [String: String]) async throws {
        guard (1...512).contains(key.utf8.count), key.utf8.allSatisfy({ (33...126).contains($0) }) else {
            throw Failure("OPENROUTER_KEY_REQUIRED")
        }
        let task = Process()
        let input = Pipe(), output = Pipe()
        task.executableURL = node
        task.arguments = [script.path]
        var probeEnvironment = environment
        probeEnvironment.removeValue(forKey: legacyKeyEnvironment)
        task.environment = probeEnvironment
        task.standardInput = input
        task.standardOutput = output
        task.standardError = FileHandle.nullDevice
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            task.terminationHandler = { process in
                let data = output.fileHandleForReading.readDataToEndOfFile()
                let code = String(decoding: data, as: UTF8.self)
                if process.terminationStatus == 0 && code == "OK" { continuation.resume() }
                else { continuation.resume(throwing: Failure(code)) }
            }
            do {
                try task.run()
            } catch {
                task.terminationHandler = nil
                continuation.resume(throwing: Failure("OPENROUTER_UNAVAILABLE"))
                return
            }
            try? input.fileHandleForWriting.write(contentsOf: Data(key.utf8))
            try? input.fileHandleForWriting.close()
        }
    }

    private final class RejectRedirect: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }

    static func respond(runId: String, key: String?, port: Int, supervisor: Int, appSupport: URL) async throws {
        let control = appSupport.appendingPathComponent("code-releases/control.json")
        let contents = try Data(contentsOf: control)
        guard let descriptor = try JSONSerialization.jsonObject(with: contents) as? [String: Any],
              descriptor["pid"] as? Int == supervisor,
              let token = descriptor["key"] as? String, token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              let url = URL(string: "http://127.0.0.1:\(port)/ux-writer/openrouter/approval") else {
            throw Failure("OPENROUTER_UNAVAILABLE")
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.connectionProxyDictionary = [:]
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }
        var request = URLRequest(url: url, timeoutInterval: 5)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "X-Apollo-Code-Key")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["runId": runId, "key": key as Any? ?? NSNull()])
        let (_, response) = try await session.data(for: request, delegate: RejectRedirect())
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Failure("OPENROUTER_APPROVAL_REQUIRED") }
    }
}
