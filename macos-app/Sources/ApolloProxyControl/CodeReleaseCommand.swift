import Foundation

struct CodeReleaseVersion: Decodable, Sendable {
    let id: String
    let version: String
    var label: String { version.replacingOccurrences(of: "-bootstrap", with: " (встроенная)") }
}
struct CodeReleaseFailure: Decodable, Sendable { let id: String; let code: String }
struct CodeReleaseStatus: Decodable, Sendable {
    let current: CodeReleaseVersion
    let previous: CodeReleaseVersion?
    let pending: CodeReleaseVersion?
    let available: CodeReleaseVersion?
    let updateAvailable: Bool?
    let restartRequired: Bool?
    let checkError: String?
    let lastFailure: CodeReleaseFailure?
    let appUpdateLease: String?
}
enum CodeReleaseAction { case update, rollback, dismiss }
struct CodeReleasePresentation {
    let status: CodeReleaseStatus
    var title: String { status.pending != nil ? "Обновление подготовлено" : status.updateAvailable == true ? "Доступно обновление прокси" : "Обновление кода прокси" }
    var summary: String {
        if let pending = status.pending { return "Версия \(pending.label) подготовлена. Запустите прокси для завершения." }
        if let error = status.checkError { return codeReleaseMessage(error) }
        if status.updateAvailable == true, let available = status.available {
            return "Доступна версия \(available.label) (установлена \(status.current.label))."
        }
        return "Установлена актуальная версия \(status.current.label)."
    }
    var message: String {
        var text = "Текущая версия кода: \(status.current.label)."
        if let pending = status.pending { text += "\nВерсия \(pending.label) подготовлена. Запустите прокси, чтобы завершить обновление." }
        else if let error = status.checkError { text += "\n\n" + codeReleaseMessage(error) }
        else if status.updateAvailable == true, let version = status.available { text += "\nДоступна версия \(version.label).\n\nПрокси перезапустится. Настройки, история и знания сохранятся." }
        else { text += "\nУстановлена актуальная версия." }
        if let previous = status.previous, status.pending == nil { text += "\n\nМожно вернуться к версии \(previous.label)." }
        return text
    }
    var actions: [CodeReleaseAction] {
        if status.pending != nil { return [.dismiss] }
        var result: [CodeReleaseAction] = status.updateAvailable == true && status.checkError == nil ? [.update, .dismiss] : [.dismiss]
        if status.previous != nil { result.append(.rollback) }
        return result
    }
}
func codeReleaseMessage(_ code: String) -> String {
    switch code {
    case "CODE_GIT_HTTP_404": return "Релиз пока недоступен в Git. Можно продолжать работу с текущей версией."
    case "CODE_GIT_HTTP_401", "CODE_GIT_HTTP_403": return "Нет доступа к релизу в Git. Проверьте доступ к репозиторию."
    case "CODE_INCOMPATIBLE": return "Релиз требует другого окружения. Текущая версия сохранена."
    case "CODE_PROXY_BUSY", "CODE_UPDATE_BUSY": return "Прокси выполняет задачу. Дождитесь её завершения и повторите обновление."
    case "CODE_EXTERNAL_PROXY": return "Прокси запущен вне миниаппа. Запустите его через миниапп, затем повторите обновление."
    case "CODE_UPDATE_PENDING": return "Обновление уже подготовлено. Запустите прокси, чтобы завершить его."
    case "CODE_ROLLBACK_UNAVAILABLE": return "Предыдущей версии для отката пока нет."
    case "CODE_ARCHIVE_INTEGRITY", "CODE_MANIFEST_INVALID", "CODE_PAYLOAD_EXTRA_FILE": return "Проверка пакета не пройдена. Текущая версия сохранена."
    default: return "Не удалось выполнить обновление (\(code)). Текущая версия сохранена."
    }
}
struct CodeReleaseCommandRunner {
    let nodeURL: URL
    let homeURL: URL
    let environment: [String: String]

    func run(_ command: String, completion: @escaping @Sendable (Result<CodeReleaseStatus, Error>) -> Void) throws -> Process {
        let task = Process(), output = Pipe(), errors = Pipe()
        let stdout = LockedDataBuffer(), stderr = LockedDataBuffer()
        task.executableURL = nodeURL
        task.arguments = [homeURL.appendingPathComponent("scripts/code-release-cli.js").path, command]
        task.currentDirectoryURL = homeURL
        task.environment = environment
        task.standardOutput = output; task.standardError = errors
        output.fileHandleForReading.readabilityHandler = { stdout.append($0.availableData) }
        errors.fileHandleForReading.readabilityHandler = { stderr.append($0.availableData) }
        task.terminationHandler = { finished in
            output.fileHandleForReading.readabilityHandler = nil; errors.fileHandleForReading.readabilityHandler = nil
            stdout.append(output.fileHandleForReading.readDataToEndOfFile()); stderr.append(errors.fileHandleForReading.readDataToEndOfFile())
            do {
                let data = stdout.snapshot()
                if finished.terminationStatus != 0 {
                    let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                    throw KnowledgeCommandError.failed(codeReleaseMessage(body?["code"] as? String ?? "CODE_COMMAND_FAILED"))
                }
                completion(.success(try JSONDecoder().decode(CodeReleaseStatus.self, from: data)))
            } catch { completion(.failure(error)) }
        }
        try task.run(); return task
    }
}
