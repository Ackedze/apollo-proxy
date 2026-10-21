import Foundation

enum CLIProvider: String, CaseIterable {
    case codex
    case claude

    var name: String { self == .codex ? "Codex" : "Claude" }
    var binaryKey: String { self == .codex ? "CODEX_BIN" : "CLAUDE_BIN" }
    var statusArguments: [String] { self == .codex ? ["login", "status"] : ["auth", "status"] }
    var loginArguments: [String] { self == .codex ? ["login"] : ["auth", "login"] }
    var installationURL: URL {
        URL(string: self == .claude ? "https://code.claude.com/docs/en/setup" : "https://learn.chatgpt.com/docs/codex/cli")!
    }

    static let legacyCodexBinary = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"

    func canInstall(configured: String) -> Bool {
        self == .codex && ["", "codex", Self.legacyCodexBinary].contains(configured)
    }

    func candidates(configured: String, home: String) -> [String] {
        // Older app bundles shipped this machine-specific path as the default.
        if configured.hasPrefix("/"), self != .codex || configured != Self.legacyCodexBinary { return [configured] }
        if self == .claude {
            return [home + "/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]
        }
        let desktop = ["/Applications", home + "/Applications"].flatMap { root in
            [root + "/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
             root + "/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
             root + "/ChatGPT.app/Contents/Resources/codex", root + "/Codex.app/Contents/Resources/codex"]
        }
        return desktop + [home + "/.local/bin/codex", "/opt/homebrew/bin/codex", "/usr/local/bin/codex"]
    }
}

enum AgentAuthStatus: Equatable {
    case checking, notConfigured, binaryMissing, installing, unauthorized, authorizing
    case authorized(method: String?)
    case error(String)
}

enum AgentCLI {
    static func authenticationStatus(provider: CLIProvider, exitCode: Int32, output: String) -> AgentAuthStatus {
        if exitCode == 1 { return .unauthorized }
        guard exitCode == 0 else { return .error("Не удалось проверить вход. Повторите проверку.") }
        if provider == .claude {
            guard let data = output.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let method = json["authMethod"] as? String else {
                return .error("Claude Code вернул неизвестный статус. Обновите CLI и повторите проверку.")
            }
            if method == "none" || json["loggedIn"] as? Bool == false { return .unauthorized }
            let names = ["claude.ai": "Claude", "oauth_token": "OAuth", "api_key": "API key",
                         "api_key_helper": "API key helper", "third_party": "Cloud provider"]
            guard let name = names[method] else { return .error("Неизвестный способ входа Claude Code.") }
            return .authorized(method: name)
        }
        let text = output.lowercased()
        let method = text.contains("chatgpt") ? "ChatGPT" : text.contains("api key") ? "API key" : nil
        return .authorized(method: method)
    }

    static func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    static func claudeLoginCommand(binary: URL, configDirectory: String?) -> String {
        var parts = ["/usr/bin/env"]
        if let configDirectory, !configDirectory.isEmpty {
            parts.append(shellQuote("CLAUDE_CONFIG_DIR=" + configDirectory))
        }
        parts += [shellQuote(binary.path), "auth", "login"]
        return parts.joined(separator: " ")
    }

    static func terminalAppleScript(command: String) -> String {
        let escaped = command.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n").replacingOccurrences(of: "\r", with: "\\r")
        return "tell application \"Terminal\"\nactivate\ndo script \"\(escaped)\"\nend tell"
    }
}
