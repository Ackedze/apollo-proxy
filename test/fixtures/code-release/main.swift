import Foundation
func status(_ extra: String) throws -> CodeReleaseStatus {
    let body = "{\"current\":{\"id\":\"a\",\"version\":\"1.4.0-bootstrap\"},\(extra)}"
    return try JSONDecoder().decode(CodeReleaseStatus.self, from: Data(body.utf8))
}
let latest = CodeReleasePresentation(status: try status("\"updateAvailable\":false"))
precondition(latest.actions == [.dismiss])
precondition(latest.summary.contains("актуальная версия"))
precondition(latest.message.contains("1.4.0 (встроенная)"))
let update = CodeReleasePresentation(status: try status("\"updateAvailable\":true,\"available\":{\"id\":\"b\",\"version\":\"1.4.1\"},\"previous\":{\"id\":\"c\",\"version\":\"1.3.0\"}"))
precondition(update.actions == [.update, .dismiss, .rollback])
precondition(update.summary.contains("Доступна версия 1.4.1"))
precondition(update.message.contains("1.4.1") && update.message.contains("1.3.0"))
let offline = CodeReleasePresentation(status: try status("\"checkError\":\"CODE_GIT_HTTP_404\",\"previous\":{\"id\":\"c\",\"version\":\"1.3.0\"}"))
precondition(offline.actions == [.dismiss, .rollback])
precondition(!offline.message.contains("актуальная версия"))
precondition(!offline.summary.contains("актуальная версия"))
let pending = CodeReleasePresentation(status: try status("\"pending\":{\"id\":\"d\",\"version\":\"1.4.1\"}"))
precondition(pending.actions == [.dismiss])
precondition(pending.message.contains("Запустите прокси"))
precondition(codeReleaseMessage("CODE_PROXY_BUSY").contains("Дождитесь"))
print("Code release native presentation PASS")
