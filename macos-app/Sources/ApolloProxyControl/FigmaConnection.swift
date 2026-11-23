import Foundation

enum FigmaConnectionState: Equatable {
    case notChecked, checking, connecting, cancelling, connected, notConnected, reconnect, cancelled, configurationConflict
    case unknown(String)

    var title: String {
        switch self {
        case .notChecked: return "Подключение не проверено"
        case .checking: return "Проверяем подключение…"
        case .connecting: return "Подтвердите подключение в браузере"
        case .cancelling: return "Отменяем подключение…"
        case .connected: return "Figma подключена"
        case .notConnected: return "Figma не подключена"
        case .reconnect: return "Требуется повторный вход в Figma"
        case .cancelled: return "Подключение отменено"
        case .configurationConflict: return "В Codex уже есть другие настройки Figma. Они сохранены; проверьте их в Codex и повторите проверку."
        case .unknown(let message): return message
        }
    }

    static func read(_ data: Data, exitCode: Int32 = 0) -> Self {
        guard data.count <= 8192,
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              value["server"] as? String == "apollo_figma_mcp",
              exitCode == 0 || ["unknown", "not_connected", "reauthentication_required", "cancelled", "config_conflict"].contains(value["state"] as? String ?? "") else { return .unknown("Не удалось проверить подключение. Повторите проверку.") }
        switch value["state"] as? String {
        case "connected": return .connected
        case "not_connected": return .notConnected
        case "reauthentication_required": return .reconnect
        case "cancelled": return .cancelled
        case "config_conflict": return .configurationConflict
        default:
            let reason = value["reason"] as? String
            if reason == "ENVIRONMENT_UNVERIFIED" { return .unknown("Не удалось определить профиль Codex. Проверьте настройки Proxy и повторите подключение.") }
            if reason == "CODE_UPDATE_REQUIRED" { return .unknown("Запустите или обновите Apollo Proxy, затем повторите проверку подключения Figma.") }
            if ["CODE_CHANGED", "CODE_SELECTION_BUSY"].contains(reason ?? "") { return .unknown("Код Proxy обновляется. Повторите проверку после обновления.") }
            if reason == "CONFIG_UNVERIFIED" { return .unknown("Не удалось прочитать настройки Figma в Codex. Проверьте настройки Codex и повторите проверку.") }
            if reason == "LOGIN_TIMEOUT" { return .unknown("Время ожидания входа истекло. Подключите Figma повторно.") }
            if reason == "LOGIN_FAILED" { return .unknown("Вход в Figma не завершён. Повторите подключение.") }
            if reason == "CLI_UNAVAILABLE" { return .unknown("Codex CLI недоступен. Проверьте вход в Codex.") }
            return .unknown("Не удалось проверить подключение. Проверьте сеть и повторите проверку.")
        }
    }
}

@MainActor
final class FigmaConnectionController {
    var onChange: (() -> Void)?
    private(set) var state: FigmaConnectionState = .notChecked { didSet { onChange?() } }
    private(set) var process: Process?
    private var lifetime: Pipe?
    var isRunning: Bool { process != nil }

    func start(node: URL, script: URL, binary: URL, environment: [String: String], login: Bool) {
        guard !isRunning else { return }
        let task = Process(), output = Pipe(), errors = Pipe()
        task.executableURL = node
        task.arguments = [script.path, login ? "login" : "check", "--binary", binary.path]
        task.environment = environment
        task.standardOutput = output; task.standardError = errors
        errors.fileHandleForReading.readabilityHandler = { _ = $0.availableData }
        lifetime = ProxyProcessLifecycle.connectParentLifetime(to: task)
        task.terminationHandler = { [weak self] finished in
            let data = output.fileHandleForReading.readDataToEndOfFile()
            errors.fileHandleForReading.readabilityHandler = nil
            Task { @MainActor in
                guard let self, self.process === finished else { return }
                let cancelled = self.state == .cancelling
                try? self.lifetime?.fileHandleForWriting.close()
                self.lifetime = nil; self.process = nil
                self.state = cancelled ? .cancelled : FigmaConnectionState.read(data, exitCode: finished.terminationStatus)
            }
        }
        process = task; state = login ? .connecting : .checking
        do { try task.run() }
        catch {
            errors.fileHandleForReading.readabilityHandler = nil
            try? lifetime?.fileHandleForWriting.close()
            lifetime = nil; process = nil
            state = .unknown("Не удалось запустить подключение. Проверьте доступность Codex CLI.")
        }
    }

    func cancel() {
        guard let process else { return }
        state = .cancelling
        try? lifetime?.fileHandleForWriting.close()
        if process.isRunning { process.terminate() }
    }
}
