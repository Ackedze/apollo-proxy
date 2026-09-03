import AppKit
import Darwin
import Foundation

private let defaultApolloURL = "https://aiflowteam3.aiflow-test.moscow.alfaintra.net/api/v1/run/f89d7dbf-8602-4495-8735-952e0ac2028b"

final class PasteFriendlyTextField: NSTextField {
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard event.modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.command),
              let key = event.charactersIgnoringModifiers?.lowercased() else {
            return super.performKeyEquivalent(with: event)
        }

        if key == "v" {
            pasteFromPasteboard()
            return true
        }

        if key == "a" {
            currentEditor()?.selectAll(nil)
            return true
        }

        return super.performKeyEquivalent(with: event)
    }

    private func pasteFromPasteboard() {
        guard let value = NSPasteboard.general.string(forType: .string) else {
            return
        }

        if let editor = currentEditor() {
            editor.insertText(value)
        } else {
            stringValue = value
        }
    }
}

enum ProxyStatus: Equatable {
    case stopped
    case starting
    case running
    case error(String)
}

enum CodexAuthStatus: Equatable {
    case checking
    case notConfigured
    case binaryMissing
    case unauthorized
    case authorizing
    case authorized(method: String?)
    case error(String)
}

enum KnowledgeUpdateStatus: Equatable {
    case idle
    case checking
    case updateAvailable(String)
    case downloading
    case validating
    case ready(String)
    case failed(String)
    case upToDate(String)
}

@MainActor
final class ProxyManager: NSObject {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private let statusLineItem = NSMenuItem(title: "Status: Stopped", action: nil, keyEquivalent: "")
    private let proxyVersionLineItem = NSMenuItem(title: "Proxy: unknown", action: nil, keyEquivalent: "")
    private let apolloURLLineItem = NSMenuItem(title: "APOLLO_AGENT_URL: not set", action: nil, keyEquivalent: "")
    private let codexStatusLineItem = NSMenuItem(title: "Codex: Checking...", action: nil, keyEquivalent: "")
    private let knowledgeSourceLineItem = NSMenuItem(title: "Knowledge: ds-ai-hub", action: nil, keyEquivalent: "")
    private let knowledgeUpdateLineItem = NSMenuItem(title: "Knowledge update: Initializing...", action: nil, keyEquivalent: "")
    private let updateKnowledgeItem = NSMenuItem(title: "Обновить знания", action: #selector(updateKnowledgeAction), keyEquivalent: "")
    private let rollbackKnowledgeItem = NSMenuItem(title: "Откатить знания", action: #selector(rollbackKnowledgeAction), keyEquivalent: "")
    private let startItem = NSMenuItem(title: "Start Proxy", action: #selector(startProxyAction), keyEquivalent: "")
    private let stopItem = NSMenuItem(title: "Stop Proxy", action: #selector(stopProxyAction), keyEquivalent: "")
    private let authorizeCodexItem = NSMenuItem(title: "Authorize Codex...", action: #selector(authorizeCodexAction), keyEquivalent: "")
    private let checkCodexAccessItem = NSMenuItem(title: "Check Codex Access", action: #selector(checkCodexAccessAction), keyEquivalent: "")
    private let editApolloURLItem = NSMenuItem(title: "Set Apollo URL...", action: #selector(editApolloURLAction), keyEquivalent: "")
    private let switchKnowledgeSourceItem = NSMenuItem(title: "Switch to design-system_ab...", action: #selector(switchKnowledgeSourceAction), keyEquivalent: "")
    private let openEnvItem = NSMenuItem(title: "Open .env", action: #selector(openEnvAction), keyEquivalent: "")
    private let openLogsItem = NSMenuItem(title: "Open Logs", action: #selector(openLogsAction), keyEquivalent: "")
    private let openProxyFolderItem = NSMenuItem(title: "Open Proxy Folder", action: #selector(openProxyFolderAction), keyEquivalent: "")
    private let quitItem = NSMenuItem(title: "Quit", action: #selector(quitAction), keyEquivalent: "q")

    private var process: Process?
    private var codexAuthProcess: Process?
    private var outputPipe: Pipe?
    private var healthTimer: Timer?
    private var knowledgeTimer: Timer?
    private var status: ProxyStatus = .stopped {
        didSet { refreshUI() }
    }
    private var codexAuthStatus: CodexAuthStatus = .checking {
        didSet { refreshUI() }
    }
    private var knowledgeUpdateStatus: KnowledgeUpdateStatus = .idle {
        didSet { refreshUI() }
    }

    private let appSupportURL: URL
    private let proxyInstallURL: URL
    private let knowledgeStoreURL: URL
    private let overridesURL: URL
    private let logURL: URL
    private let logQueue = DispatchQueue(label: "ApolloProxyControl.logQueue")
    private var cachedNodeExecutableURL: URL?
    private var cachedCodexExecutableURL: URL?
    private var isStoppingIntentionally = false
    private var pendingRestartAfterStop = false
    private var pendingProxyStartAfterAuthorization = false
    private var knowledgeRuntime: KnowledgeCommandStatus?
    private var knowledgeCommandRunning = false
    private var pendingKnowledgeRestart = false

    override init() {
        let fm = FileManager.default
        let appSupportRoot = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        appSupportURL = appSupportRoot.appendingPathComponent("ApolloProxyControl", isDirectory: true)
        proxyInstallURL = appSupportURL.appendingPathComponent("proxy", isDirectory: true)
        knowledgeStoreURL = appSupportURL.appendingPathComponent("knowledge", isDirectory: true)
        overridesURL = appSupportURL.appendingPathComponent("user-overrides.env", isDirectory: false)
        logURL = appSupportURL.appendingPathComponent("proxy.log", isDirectory: false)
        super.init()
        configureMenu()
        refreshUI()
        startHealthChecks()
        startKnowledgeChecks()
    }

    func setupStatusItem(autoStartProxy: Bool = false) {
        statusItem.button?.title = "AP:Off"
        statusItem.menu = menu
        do {
            try ensureProxyInstalled()
            knowledgeRuntime = try knowledgeCommandRunner().runSynchronously("ensure")
        } catch {
            knowledgeUpdateStatus = .failed(error.localizedDescription)
        }
        checkForKnowledgeUpdate()
        checkCodexAuthorization(startProxyWhenReady: autoStartProxy)
    }

    private func configureMenu() {
        statusLineItem.isEnabled = false
        proxyVersionLineItem.isEnabled = false
        apolloURLLineItem.isEnabled = false
        codexStatusLineItem.isEnabled = false
        knowledgeSourceLineItem.isEnabled = false
        knowledgeUpdateLineItem.isEnabled = false
        menu.addItem(statusLineItem)
        menu.addItem(proxyVersionLineItem)
        menu.addItem(apolloURLLineItem)
        menu.addItem(codexStatusLineItem)
        menu.addItem(knowledgeSourceLineItem)
        menu.addItem(knowledgeUpdateLineItem)
        menu.addItem(.separator())

        startItem.target = self
        menu.addItem(startItem)

        stopItem.target = self
        menu.addItem(stopItem)

        menu.addItem(.separator())

        authorizeCodexItem.target = self
        menu.addItem(authorizeCodexItem)

        checkCodexAccessItem.target = self
        menu.addItem(checkCodexAccessItem)

        menu.addItem(.separator())

        editApolloURLItem.target = self
        menu.addItem(editApolloURLItem)

        switchKnowledgeSourceItem.target = self
        menu.addItem(switchKnowledgeSourceItem)

        updateKnowledgeItem.target = self
        menu.addItem(updateKnowledgeItem)

        rollbackKnowledgeItem.target = self
        menu.addItem(rollbackKnowledgeItem)

        openEnvItem.target = self
        menu.addItem(openEnvItem)

        openLogsItem.target = self
        menu.addItem(openLogsItem)

        openProxyFolderItem.target = self
        menu.addItem(openProxyFolderItem)

        menu.addItem(.separator())

        quitItem.target = self
        menu.addItem(quitItem)
    }

    private func refreshUI() {
        proxyVersionLineItem.title = formattedProxyVersionForMenu()
        apolloURLLineItem.title = "APOLLO_AGENT_URL: \(formattedApolloURLForMenu())"
        let knowledgeSource = readConfiguredKnowledgeSource()
        knowledgeSourceLineItem.title = "Knowledge: \(knowledgeSource)"
        switchKnowledgeSourceItem.title = knowledgeSource == "ds-ai-hub"
            ? "Switch to design-system_ab..."
            : "Switch to ds-ai-hub..."
        let currentKnowledgeVersion = knowledgeRuntime?.current?.contentVersion ?? "seed"
        switch knowledgeUpdateStatus {
        case .idle:
            knowledgeUpdateLineItem.title = "Knowledge update: \(currentKnowledgeVersion)"
        case .checking:
            knowledgeUpdateLineItem.title = "Knowledge update: Checking..."
        case .updateAvailable(let version):
            knowledgeUpdateLineItem.title = "Knowledge update available: \(version)"
        case .downloading:
            knowledgeUpdateLineItem.title = "Knowledge update: Downloading..."
        case .validating:
            knowledgeUpdateLineItem.title = "Knowledge update: Validating..."
        case .ready(let version):
            knowledgeUpdateLineItem.title = "Knowledge update: Ready (\(version))"
        case .failed(let message):
            knowledgeUpdateLineItem.title = "Knowledge update: Failed (\(message.prefix(48)))"
        case .upToDate(let version):
            knowledgeUpdateLineItem.title = "Knowledge update: Up to date (\(version))"
        }
        if case .updateAvailable = knowledgeUpdateStatus {
            updateKnowledgeItem.isEnabled = !knowledgeCommandRunning
        } else {
            updateKnowledgeItem.isEnabled = false
        }
        rollbackKnowledgeItem.isEnabled = !knowledgeCommandRunning && knowledgeRuntime?.previous != nil

        switch codexAuthStatus {
        case .checking:
            codexStatusLineItem.title = "Codex: Checking..."
        case .notConfigured:
            codexStatusLineItem.title = "Codex: Not configured"
        case .binaryMissing:
            codexStatusLineItem.title = "Codex: CLI not found"
        case .unauthorized:
            codexStatusLineItem.title = "Codex: Authorization required"
        case .authorizing:
            codexStatusLineItem.title = "Codex: Authorizing..."
        case .authorized(let method):
            if let method, !method.isEmpty {
                codexStatusLineItem.title = "Codex: Authorized via \(method)"
            } else {
                codexStatusLineItem.title = "Codex: Authorized"
            }
        case .error(let message):
            codexStatusLineItem.title = "Codex: Error (\(message))"
        }

        let codexRequired = isCodexConfigured()
        let codexReady: Bool
        if codexRequired {
            if case .authorized = codexAuthStatus {
                codexReady = true
            } else {
                codexReady = false
            }
        } else {
            codexReady = true
        }
        authorizeCodexItem.isEnabled = codexRequired && codexAuthProcess == nil && resolveCodexExecutableURL() != nil
        authorizeCodexItem.title = codexAuthStatus == .unauthorized ? "Authorize Codex..." : "Reauthorize Codex..."
        checkCodexAccessItem.isEnabled = codexRequired && codexAuthProcess == nil

        switch status {
        case .stopped:
            setStatusItemTitle("AP:Off")
            statusLineItem.title = "Status: Stopped"
            startItem.isEnabled = codexReady
            stopItem.isEnabled = false
        case .starting:
            setStatusItemTitle("AP:...")
            statusLineItem.title = "Status: Starting..."
            startItem.isEnabled = false
            stopItem.isEnabled = true
        case .running:
            let port = readPort()
            setStatusItemTitle("AP:On")
            statusLineItem.title = "Status: Running on :\(port)"
            startItem.isEnabled = false
            stopItem.isEnabled = true
        case .error(let message):
            setStatusItemTitle("AP:Err")
            statusLineItem.title = "Status: Error (\(message))"
            startItem.isEnabled = codexReady
            stopItem.isEnabled = process != nil
        }
    }

    private func setStatusItemTitle(_ base: String) {
        switch knowledgeUpdateStatus {
        case .updateAvailable:
            statusItem.button?.title = "\(base) ↑"
        case .failed:
            statusItem.button?.title = "\(base) !"
        default:
            statusItem.button?.title = base
        }
    }

    private func formattedApolloURLForMenu() -> String {
        let value = readConfiguredApolloURL()?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !value.isEmpty else {
            return "not set"
        }
        if value.count <= 72 {
            return value
        }
        return "\(value.prefix(69))..."
    }

    private func readProxyPackageVersion(from directoryURL: URL) -> String? {
        let packageURL = directoryURL.appendingPathComponent("package.json", isDirectory: false)
        guard let data = try? Data(contentsOf: packageURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let version = json["version"] as? String else {
            return nil
        }
        let normalized = version.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }

    private func formattedProxyVersionForMenu() -> String {
        let embeddedURL = Bundle.main.resourceURL?
            .appendingPathComponent("embedded-proxy", isDirectory: true)
        let version = readProxyPackageVersion(from: proxyInstallURL)
            ?? embeddedURL.flatMap { readProxyPackageVersion(from: $0) }
            ?? "unknown"
        let buildMarker = readBuildMarker(from: proxyInstallURL)
            ?? embeddedURL.flatMap { readBuildMarker(from: $0) }
            ?? "unknown"
        return "Proxy: v\(version) · build \(buildMarker)"
    }

    private func startHealthChecks() {
        healthTimer?.invalidate()
        healthTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.checkHealth()
            }
        }
    }

    private func startKnowledgeChecks() {
        knowledgeTimer?.invalidate()
        knowledgeTimer = Timer.scheduledTimer(withTimeInterval: 2 * 60 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.checkForKnowledgeUpdate()
            }
        }
    }

    private func checkHealth() {
        guard process != nil else {
            if case .running = status {
                status = .stopped
            }
            return
        }

        let port = readPort()
        guard let url = URL(string: "http://127.0.0.1:\(port)/health") else {
            status = .error("Invalid health URL")
            return
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 1.5

        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            Task { @MainActor in
                guard let self else { return }
                guard let http = response as? HTTPURLResponse, http.statusCode == 200, let data else {
                    if case .starting = self.status {
                        return
                    }
                    if case .running = self.status {
                        self.status = .starting
                    }
                    return
                }

                if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let ok = json["ok"] as? Bool,
                   ok == true,
                   self.status != .running {
                    self.status = .running
                }
                if self.pendingKnowledgeRestart,
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let activeRequests = json["activeRequests"] as? Int,
                   let codex = json["codex"] as? [String: Any],
                   activeRequests == 0,
                   codex["busy"] as? Bool == false {
                    self.pendingKnowledgeRestart = false
                    self.pendingRestartAfterStop = true
                    self.stopProxyAction()
                }
            }
        }.resume()
    }

    private func configuredKnowledgeDescriptorURL() -> String? {
        if let configured = readEnvMap()?["APOLLO_KNOWLEDGE_DESCRIPTOR_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !configured.isEmpty {
            return configured
        }
        if let bundled = Bundle.main.object(forInfoDictionaryKey: "ApolloKnowledgeDescriptorURL") as? String,
           !bundled.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return bundled
        }
        return nil
    }

    private func knowledgeCommandEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        if let token = readEnvMap()?["APOLLO_KNOWLEDGE_TOKEN"], !token.isEmpty {
            environment["APOLLO_KNOWLEDGE_TOKEN"] = token
        }
        return environment
    }

    private func knowledgeCommandRunner() throws -> KnowledgeCommandRunner {
        guard let nodeURL = resolveNodeExecutableURL() else {
            throw KnowledgeCommandError.failed("Bundled Node runtime is unavailable.")
        }
        let cliURL = proxyInstallURL
            .appendingPathComponent("scripts", isDirectory: true)
            .appendingPathComponent("knowledge-package-cli.js", isDirectory: false)
        guard FileManager.default.fileExists(atPath: cliURL.path) else {
            throw KnowledgeCommandError.failed("Knowledge updater is missing from embedded proxy.")
        }
        guard let seedURL = Bundle.main.resourceURL?
            .appendingPathComponent("knowledge-seed", isDirectory: true)
            .appendingPathComponent("package", isDirectory: true),
              FileManager.default.fileExists(atPath: seedURL.path) else {
            throw KnowledgeCommandError.failed("Embedded knowledge seed is missing.")
        }
        return KnowledgeCommandRunner(
            nodeURL: nodeURL,
            cliURL: cliURL,
            storeURL: knowledgeStoreURL,
            seedURL: seedURL,
            descriptorURL: configuredKnowledgeDescriptorURL(),
            environment: knowledgeCommandEnvironment()
        )
    }

    private func checkForKnowledgeUpdate() {
        guard !knowledgeCommandRunning else { return }
        guard configuredKnowledgeDescriptorURL() != nil else {
            knowledgeUpdateStatus = .idle
            return
        }
        knowledgeCommandRunning = true
        knowledgeUpdateStatus = .checking
        do {
            try knowledgeCommandRunner().run("check", phase: { _ in }) { [weak self] result in
                Task { @MainActor in
                    guard let self else { return }
                    self.knowledgeCommandRunning = false
                    switch result {
                    case .success(let value):
                        self.knowledgeRuntime = value
                        let version = value.descriptor?.contentVersion ?? "unknown"
                        self.knowledgeUpdateStatus = value.updateAvailable == true
                            ? .updateAvailable(version)
                            : .upToDate(version)
                    case .failure(let error):
                        self.knowledgeUpdateStatus = .failed(error.localizedDescription)
                        self.appendLog("=== \(Date()) Knowledge check failed: \(error.localizedDescription) ===\n")
                    }
                }
            }
        } catch {
            knowledgeCommandRunning = false
            knowledgeUpdateStatus = .failed(error.localizedDescription)
        }
    }

    private func applyUpdatedKnowledgeRuntime() {
        guard process != nil else { return }
        pendingKnowledgeRestart = true
        appendLog("=== \(Date()) Knowledge update waits for active audit before proxy restart ===\n")
        checkHealth()
    }

    @objc private func updateKnowledgeAction() {
        guard !knowledgeCommandRunning else { return }
        knowledgeCommandRunning = true
        knowledgeUpdateStatus = .downloading
        do {
            try knowledgeCommandRunner().run("update", phase: { [weak self] phase in
                Task { @MainActor in
                    if phase == "validating" { self?.knowledgeUpdateStatus = .validating }
                    if phase == "downloading" { self?.knowledgeUpdateStatus = .downloading }
                }
            }) { [weak self] result in
                Task { @MainActor in
                    guard let self else { return }
                    self.knowledgeCommandRunning = false
                    switch result {
                    case .success(let value):
                        self.knowledgeRuntime = value
                        let version = value.current?.contentVersion ?? "unknown"
                        self.knowledgeUpdateStatus = .ready(version)
                        self.appendLog("=== \(Date()) Knowledge \(version) validated and activated ===\n")
                        self.applyUpdatedKnowledgeRuntime()
                    case .failure(let error):
                        self.knowledgeUpdateStatus = .failed(error.localizedDescription)
                        self.appendLog("=== \(Date()) Knowledge update failed; current retained: \(error.localizedDescription) ===\n")
                    }
                }
            }
        } catch {
            knowledgeCommandRunning = false
            knowledgeUpdateStatus = .failed(error.localizedDescription)
        }
    }

    @objc private func rollbackKnowledgeAction() {
        guard !knowledgeCommandRunning else { return }
        knowledgeCommandRunning = true
        knowledgeUpdateStatus = .validating
        do {
            try knowledgeCommandRunner().run("rollback", phase: { _ in }) { [weak self] result in
                Task { @MainActor in
                    guard let self else { return }
                    self.knowledgeCommandRunning = false
                    switch result {
                    case .success(let value):
                        self.knowledgeRuntime = value
                        let version = value.current?.contentVersion ?? "unknown"
                        self.knowledgeUpdateStatus = .ready(version)
                        self.appendLog("=== \(Date()) Knowledge rolled back to \(version) ===\n")
                        self.applyUpdatedKnowledgeRuntime()
                    case .failure(let error):
                        self.knowledgeUpdateStatus = .failed(error.localizedDescription)
                    }
                }
            }
        } catch {
            knowledgeCommandRunning = false
            knowledgeUpdateStatus = .failed(error.localizedDescription)
        }
    }

    private func readPort() -> Int {
        guard let env = readEnvMap() else {
            return 3001
        }
        if let raw = env["PORT"], let parsed = Int(raw), parsed > 0 {
            return parsed
        }
        return 3001
    }

    private func readEnvMap() -> [String: String]? {
        let envPath = proxyInstallURL.appendingPathComponent(".env", isDirectory: false)
        return readEnvMap(from: envPath)
    }

    private func readEnvMap(from envURL: URL) -> [String: String]? {
        guard let text = try? String(contentsOf: envURL, encoding: .utf8) else {
            return nil
        }
        var result: [String: String] = [:]
        for rawLine in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty || line.hasPrefix("#") {
                continue
            }
            let parts = line.split(separator: "=", maxSplits: 1).map(String.init)
            if parts.count == 2 {
                let key = parts[0].trimmingCharacters(in: .whitespaces)
                let value = normalizedEnvValue(parts[1].trimmingCharacters(in: .whitespaces))
                result[key] = value
            }
        }
        return result
    }

    private func normalizedEnvValue(_ rawValue: String) -> String {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            return trimmed
        }

        if (trimmed.hasPrefix("\"") && trimmed.hasSuffix("\"")) ||
            (trimmed.hasPrefix("'") && trimmed.hasSuffix("'")) {
            return String(trimmed.dropFirst().dropLast())
        }
        return trimmed
    }

    private func readConfiguredApolloURL() -> String? {
        let installedEnvURL = proxyInstallURL.appendingPathComponent(".env", isDirectory: false)
        if let value = readEnvMap(from: installedEnvURL)?["APOLLO_AGENT_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !value.isEmpty {
            return value
        }
        if let value = readEnvMap(from: overridesURL)?["APOLLO_AGENT_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !value.isEmpty {
            return value
        }
        if let bundledEnvURL = Bundle.main.resourceURL?
            .appendingPathComponent("embedded-proxy", isDirectory: true)
            .appendingPathComponent(".env", isDirectory: false),
           let value = readEnvMap(from: bundledEnvURL)?["APOLLO_AGENT_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !value.isEmpty {
            return value
        }
        return nil
    }

    private func readConfiguredKnowledgeSource() -> String {
        let configured = readEnvMap()?["APOLLO_CODEX_KNOWLEDGE_SOURCE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return configured == "design-system_ab" ? "design-system_ab" : "ds-ai-hub"
    }

    private func envLineMatchesKey(_ line: String, key: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !trimmed.hasPrefix("#") else {
            return false
        }

        let parts = trimmed.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
        guard let candidate = parts.first else {
            return false
        }
        return candidate.trimmingCharacters(in: .whitespaces) == key
    }

    private func writeEnvValue(_ value: String, forKey key: String, to envURL: URL) throws {
        let fm = FileManager.default
        let existing = (try? String(contentsOf: envURL, encoding: .utf8)) ?? ""
        let normalizedText = existing.replacingOccurrences(of: "\r\n", with: "\n")
        var lines = normalizedText.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var updated = false

        for index in lines.indices {
            if envLineMatchesKey(lines[index], key: key) {
                lines[index] = "\(key)=\(value)"
                updated = true
                break
            }
        }

        if !updated {
            if !lines.isEmpty, !(lines.last?.isEmpty ?? false) {
                lines.append("")
            }
            lines.append("\(key)=\(value)")
        }

        let serialized = lines.joined(separator: "\n")
        let finalText = serialized.hasSuffix("\n") ? serialized : "\(serialized)\n"
        try fm.createDirectory(
            at: envURL.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: nil
        )
        try finalText.write(to: envURL, atomically: true, encoding: .utf8)
    }

    private func applyUserOverridesIfNeeded() throws {
        guard let overrides = readEnvMap(from: overridesURL), !overrides.isEmpty else {
            return
        }

        let envURL = proxyInstallURL.appendingPathComponent(".env", isDirectory: false)
        for (key, value) in overrides {
            try writeEnvValue(value, forKey: key, to: envURL)
        }
    }

    private func validateEnvConfiguration() -> String? {
        guard let env = readEnvMap() else {
            return "The proxy configuration file is missing. Open .env and fill it in."
        }

        let apolloURL = env["APOLLO_AGENT_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let codexBinary = env["CODEX_BIN"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if apolloURL.isEmpty && codexBinary.isEmpty {
            return "Configure APOLLO_AGENT_URL for Langflow or CODEX_BIN for Apollo v2/v3, then start the proxy again."
        }

        return nil
    }

    private func isCodexConfigured() -> Bool {
        let configured = readEnvMap()?["CODEX_BIN"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !configured.isEmpty
    }

    private func buildCodexEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let allowedOverrides = [
            "HOME",
            "CODEX_HOME",
            "CODEX_CA_CERTIFICATE",
            "SSL_CERT_FILE",
            "HTTPS_PROXY",
            "HTTP_PROXY",
            "NO_PROXY",
            "https_proxy",
            "http_proxy",
            "no_proxy"
        ]
        if let env = readEnvMap() {
            for key in allowedOverrides {
                if let value = env[key], !value.isEmpty {
                    environment[key] = value
                }
            }
        }
        return environment
    }

    private func resolveCodexExecutableURL() -> URL? {
        if let cachedCodexExecutableURL,
           FileManager.default.isExecutableFile(atPath: cachedCodexExecutableURL.path) {
            return cachedCodexExecutableURL
        }

        let fm = FileManager.default
        let configured = readEnvMap()?["CODEX_BIN"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var candidates: [String] = []
        if configured.hasPrefix("/") {
            candidates.append(configured)
        }
        candidates.append(contentsOf: [
            "/Applications/ChatGPT.app/Contents/Resources/codex",
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex"
        ])

        for path in candidates where fm.isExecutableFile(atPath: path) {
            let url = URL(fileURLWithPath: path)
            cachedCodexExecutableURL = url
            return url
        }

        let lookupName = configured.isEmpty || configured.contains("/") ? "codex" : configured
        let lookup = Process()
        lookup.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        lookup.arguments = [lookupName]
        lookup.environment = buildCodexEnvironment()
        let output = Pipe()
        lookup.standardOutput = output
        lookup.standardError = Pipe()
        do {
            try lookup.run()
            lookup.waitUntilExit()
            let raw = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if lookup.terminationStatus == 0, raw.hasPrefix("/"), fm.isExecutableFile(atPath: raw) {
                let url = URL(fileURLWithPath: raw)
                cachedCodexExecutableURL = url
                return url
            }
        } catch {
            return nil
        }
        return nil
    }

    private func codexAuthMethod(from output: String) -> String? {
        let normalized = output.lowercased()
        if normalized.contains("chatgpt") {
            return "ChatGPT"
        }
        if normalized.contains("api key") {
            return "API key"
        }
        if normalized.contains("access token") {
            return "access token"
        }
        return nil
    }

    private func checkCodexAuthorization(startProxyWhenReady: Bool = false, showResult: Bool = false) {
        guard codexAuthProcess == nil else {
            if startProxyWhenReady {
                pendingProxyStartAfterAuthorization = true
            }
            return
        }

        do {
            try ensureProxyInstalled()
        } catch {
            codexAuthStatus = .error("setup failed")
            if showResult {
                showError("Cannot check Codex access", error.localizedDescription)
            }
            return
        }

        guard isCodexConfigured() else {
            codexAuthStatus = .notConfigured
            return
        }
        guard let codexURL = resolveCodexExecutableURL() else {
            codexAuthStatus = .binaryMissing
            if showResult {
                showError(
                    "Codex CLI is unavailable",
                    "Install ChatGPT Desktop with Codex or configure CODEX_BIN, then try again."
                )
            }
            return
        }

        codexAuthStatus = .checking
        let task = Process()
        let output = Pipe()
        task.executableURL = codexURL
        task.arguments = ["login", "status"]
        task.environment = buildCodexEnvironment()
        task.standardOutput = output
        task.standardError = output
        task.terminationHandler = { [weak self] finishedTask in
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let text = String(data: data, encoding: .utf8) ?? ""
            Task { @MainActor in
                guard let self else { return }
                self.codexAuthProcess = nil
                if finishedTask.terminationStatus == 0 {
                    self.codexAuthStatus = .authorized(method: self.codexAuthMethod(from: text))
                    self.appendLog("=== \(Date()) Codex authorization check succeeded ===\n")
                    if showResult {
                        self.showInfo("Codex is authorized", "Apollo can now use Codex for design validation.")
                    }
                    if startProxyWhenReady || self.pendingProxyStartAfterAuthorization {
                        self.pendingProxyStartAfterAuthorization = false
                        self.startProxyAction()
                    }
                } else {
                    self.codexAuthStatus = .unauthorized
                    self.pendingProxyStartAfterAuthorization = false
                    self.appendLog("=== \(Date()) Codex authorization check failed (exit \(finishedTask.terminationStatus)) ===\n")
                    if showResult {
                        self.showError("Codex authorization required", "Choose Authorize Codex and complete the browser sign-in.")
                    }
                }
            }
        }

        do {
            codexAuthProcess = task
            try task.run()
        } catch {
            codexAuthProcess = nil
            codexAuthStatus = .error("check failed")
            if showResult {
                showError("Cannot check Codex access", error.localizedDescription)
            }
        }
    }

    @objc private func checkCodexAccessAction() {
        checkCodexAuthorization(showResult: true)
    }

    @objc private func authorizeCodexAction() {
        guard codexAuthProcess == nil else {
            return
        }
        do {
            try ensureProxyInstalled()
        } catch {
            codexAuthStatus = .error("setup failed")
            showError("Cannot authorize Codex", error.localizedDescription)
            return
        }
        guard let codexURL = resolveCodexExecutableURL() else {
            codexAuthStatus = .binaryMissing
            showError(
                "Codex CLI is unavailable",
                "Install ChatGPT Desktop with Codex or configure CODEX_BIN, then try again."
            )
            return
        }

        codexAuthStatus = .authorizing
        appendLog("=== \(Date()) Codex authorization started ===\n")
        let task = Process()
        let output = Pipe()
        task.executableURL = codexURL
        task.arguments = ["login"]
        task.environment = buildCodexEnvironment()
        task.standardOutput = output
        task.standardError = output
        task.terminationHandler = { [weak self] finishedTask in
            output.fileHandleForReading.readabilityHandler = nil
            Task { @MainActor in
                guard let self else { return }
                self.codexAuthProcess = nil
                if finishedTask.terminationStatus == 0 {
                    self.appendLog("=== \(Date()) Codex authorization flow completed ===\n")
                    self.checkCodexAuthorization(
                        startProxyWhenReady: self.pendingProxyStartAfterAuthorization,
                        showResult: true
                    )
                } else {
                    self.codexAuthStatus = .unauthorized
                    self.pendingProxyStartAfterAuthorization = false
                    self.appendLog("=== \(Date()) Codex authorization failed (exit \(finishedTask.terminationStatus)) ===\n")
                    self.showError(
                        "Codex authorization was not completed",
                        "Try again or use Check Codex Access after signing in through ChatGPT Desktop."
                    )
                }
            }
        }
        output.fileHandleForReading.readabilityHandler = { handle in
            _ = handle.availableData
        }

        do {
            codexAuthProcess = task
            try task.run()
        } catch {
            output.fileHandleForReading.readabilityHandler = nil
            codexAuthProcess = nil
            codexAuthStatus = .error("login failed")
            showError("Cannot start Codex authorization", error.localizedDescription)
        }
    }

    private func readBuildMarker(from directoryURL: URL) -> String? {
        let markerURL = directoryURL.appendingPathComponent(".bundle-build-id", isDirectory: false)
        guard let raw = try? String(contentsOf: markerURL, encoding: .utf8) else {
            return nil
        }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private func shouldInstallEmbeddedProxy() -> Bool {
        let fm = FileManager.default
        let markerURL = proxyInstallURL.appendingPathComponent("server.js", isDirectory: false)
        guard fm.fileExists(atPath: markerURL.path) else {
            return true
        }

        guard let embeddedURL = Bundle.main.resourceURL?.appendingPathComponent("embedded-proxy", isDirectory: true) else {
            return false
        }

        guard let bundledBuildMarker = readBuildMarker(from: embeddedURL) else {
            return false
        }

        guard let installedBuildMarker = readBuildMarker(from: proxyInstallURL) else {
            return true
        }

        // Build markers are UTC timestamps (yyyyMMdd'T'HHmmss'Z'). Never let an
        // older development bundle replace a newer runtime in Application Support.
        return bundledBuildMarker > installedBuildMarker
    }

    private func ensureProxyInstalled() throws {
        let fm = FileManager.default
        try fm.createDirectory(at: appSupportURL, withIntermediateDirectories: true, attributes: nil)

        if shouldInstallEmbeddedProxy() {
            try installEmbeddedProxy()
        }

        let envURL = proxyInstallURL.appendingPathComponent(".env", isDirectory: false)
        if !fm.fileExists(atPath: envURL.path) {
            let envExampleURL = proxyInstallURL.appendingPathComponent(".env.example", isDirectory: false)
            if fm.fileExists(atPath: envExampleURL.path) {
                try fm.copyItem(at: envExampleURL, to: envURL)
            } else {
                let fallback = """
                HOST=127.0.0.1
                PORT=3001
                APOLLO_AGENT_URL=\(defaultApolloURL)
                APOLLO_AGENT_KEY=
                APOLLO_AGENT_INSECURE_TLS=1
                """
                try fallback.write(to: envURL, atomically: true, encoding: .utf8)
            }
        }

        try applyUserOverridesIfNeeded()

        if !fm.fileExists(atPath: logURL.path) {
            fm.createFile(atPath: logURL.path, contents: Data())
        }
    }

    private func installEmbeddedProxy() throws {
        let fm = FileManager.default
        let embeddedURL = Bundle.main.resourceURL?.appendingPathComponent("embedded-proxy", isDirectory: true)
        guard let embeddedURL else {
            throw NSError(
                domain: "ApolloProxyControl",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "embedded-proxy is missing in app resources"]
            )
        }

        let existingEnvURL = proxyInstallURL.appendingPathComponent(".env", isDirectory: false)
        let preservedEnv = try? Data(contentsOf: existingEnvURL)
        if fm.fileExists(atPath: proxyInstallURL.path) {
            try fm.removeItem(at: proxyInstallURL)
        }
        try fm.copyItem(at: embeddedURL, to: proxyInstallURL)
        if let preservedEnv {
            try preservedEnv.write(to: existingEnvURL, options: .atomic)
        }
    }

    private func appendLog(_ chunk: String) {
        logQueue.async { [logURL] in
            guard let data = chunk.data(using: .utf8) else {
                return
            }
            if !FileManager.default.fileExists(atPath: logURL.path) {
                FileManager.default.createFile(atPath: logURL.path, contents: Data())
            }
            do {
                let handle = try FileHandle(forWritingTo: logURL)
                defer {
                    try? handle.close()
                }
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            } catch {
                fputs("Failed to write logs: \(error)\n", stderr)
            }
        }
    }

    private func showError(_ title: String, _ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = title
        alert.informativeText = message
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    private func showInfo(_ title: String, _ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = title
        alert.informativeText = message
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    private func validateApolloURLInput(_ rawValue: String) -> String? {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty {
            return nil
        }

        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil else {
            return "Use a full http:// or https:// URL."
        }

        return nil
    }

    private func saveApolloURL(_ rawValue: String) throws {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        try ensureProxyInstalled()
        try writeEnvValue(value, forKey: "APOLLO_AGENT_URL", to: overridesURL)
        try writeEnvValue(value, forKey: "APOLLO_AGENT_URL", to: proxyInstallURL.appendingPathComponent(".env", isDirectory: false))
    }

    private func saveKnowledgeSource(_ value: String) throws {
        try ensureProxyInstalled()
        try writeEnvValue(
            value,
            forKey: "APOLLO_CODEX_KNOWLEDGE_SOURCE",
            to: overridesURL
        )
        try writeEnvValue(
            value,
            forKey: "APOLLO_CODEX_KNOWLEDGE_SOURCE",
            to: proxyInstallURL.appendingPathComponent(".env", isDirectory: false)
        )
    }

    private func promptForRestartIfNeeded() {
        guard process != nil else {
            if let url = readConfiguredApolloURL(), !url.isEmpty {
                showInfo("APOLLO_AGENT_URL saved", "The new URL is saved on this Mac and will be used on the next proxy start.")
            } else {
                showInfo("APOLLO_AGENT_URL cleared", "The value was cleared. Configure it again before starting the proxy.")
            }
            return
        }

        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = "Restart proxy now?"
        alert.informativeText = "The new APOLLO_AGENT_URL is saved. Restart the proxy now to apply it."
        alert.addButton(withTitle: "Restart Proxy")
        alert.addButton(withTitle: "Later")
        NSApp.activate(ignoringOtherApps: true)

        if alert.runModal() == .alertFirstButtonReturn {
            pendingRestartAfterStop = true
            stopProxyAction()
        }
    }

    private func resolveNodeExecutableURL() -> URL? {
        if let cachedNodeExecutableURL {
            return cachedNodeExecutableURL
        }

        let fm = FileManager.default
        if let bundledNodeURL = Bundle.main.resourceURL?
            .appendingPathComponent("runtime", isDirectory: true)
            .appendingPathComponent("bin", isDirectory: true)
            .appendingPathComponent("node", isDirectory: false),
           fm.isExecutableFile(atPath: bundledNodeURL.path) {
            cachedNodeExecutableURL = bundledNodeURL
            return bundledNodeURL
        }

        let explicitCandidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/opt/local/bin/node",
            "/usr/bin/node"
        ]

        for path in explicitCandidates where fm.isExecutableFile(atPath: path) {
            let resolved = URL(fileURLWithPath: path)
            cachedNodeExecutableURL = resolved
            return resolved
        }

        let shellCandidates = ["/bin/zsh", "/bin/bash"]
        for shellPath in shellCandidates where fm.isExecutableFile(atPath: shellPath) {
            let task = Process()
            task.executableURL = URL(fileURLWithPath: shellPath)
            task.arguments = ["-lc", "command -v node"]
            let output = Pipe()
            task.standardOutput = output
            task.standardError = Pipe()

            do {
                try task.run()
                task.waitUntilExit()
                if task.terminationStatus == 0 {
                    let data = output.fileHandleForReading.readDataToEndOfFile()
                    let raw = String(data: data, encoding: .utf8)?
                        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    if raw.hasPrefix("/"), fm.isExecutableFile(atPath: raw) {
                        let resolved = URL(fileURLWithPath: raw)
                        cachedNodeExecutableURL = resolved
                        return resolved
                    }
                }
            } catch {
                continue
            }
        }

        return nil
    }

    private func runNodeVersionCheck() -> Bool {
        guard let nodeURL = resolveNodeExecutableURL() else {
            return false
        }

        let task = Process()
        task.executableURL = nodeURL
        task.arguments = ["--version"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = pipe
        do {
            try task.run()
            task.waitUntilExit()
            return task.terminationStatus == 0
        } catch {
            return false
        }
    }

    @objc private func startProxyAction() {
        if process != nil {
            return
        }

        do {
            try ensureProxyInstalled()
            knowledgeRuntime = try knowledgeCommandRunner().runSynchronously("ensure")
        } catch {
            status = .error("Setup failed")
            showError("Cannot prepare proxy", error.localizedDescription)
            return
        }

        guard runNodeVersionCheck() else {
            status = .error("Node runtime missing")
            showError(
                "Node runtime is unavailable",
                "This app could not find its bundled Node runtime. Rebuild the app bundle or install Node.js on this Mac and try again."
            )
            return
        }

        if let validationError = validateEnvConfiguration() {
            status = .error("Invalid .env")
            showError("Proxy is not configured", validationError)
            return
        }

        if isCodexConfigured() {
            guard case .authorized = codexAuthStatus else {
                pendingProxyStartAfterAuthorization = true
                if codexAuthStatus == .checking || codexAuthStatus == .authorizing {
                    showInfo("Checking Codex access", "Apollo will start the proxy after Codex authorization is confirmed.")
                    return
                }

                let alert = NSAlert()
                alert.alertStyle = .informational
                alert.messageText = "Authorize Codex"
                alert.informativeText = "Apollo uses Codex under your account. Sign in through your ChatGPT workspace; Apollo does not receive or store your password or tokens."
                alert.addButton(withTitle: "Authorize Codex")
                alert.addButton(withTitle: "Cancel")
                NSApp.activate(ignoringOtherApps: true)
                if alert.runModal() == .alertFirstButtonReturn {
                    authorizeCodexAction()
                } else {
                    pendingProxyStartAfterAuthorization = false
                }
                return
            }
        }

        status = .starting
        appendLog("\n=== \(Date()) Starting proxy ===\n")

        let pipe = Pipe()
        outputPipe = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            guard let self else { return }
            let data = handle.availableData
            if data.isEmpty {
                return
            }
            let text = String(data: data, encoding: .utf8) ?? "<non-utf8 output>"
            Task { @MainActor in
                self.appendLog(text)
            }
        }

        guard let nodeURL = resolveNodeExecutableURL() else {
            status = .error("Node runtime missing")
            showError(
                "Node runtime is unavailable",
                "This app could not find its bundled Node runtime. Rebuild the app bundle or install Node.js on this Mac and try again."
            )
            return
        }

        let task = Process()
        task.executableURL = nodeURL
        task.arguments = ["server.js"]
        task.currentDirectoryURL = proxyInstallURL
        task.standardOutput = pipe
        task.standardError = pipe
        var environment = ProcessInfo.processInfo.environment
        if let runtime = knowledgeRuntime,
           let current = runtime.current,
           let designSystemRoot = runtime.designSystemRoot,
           let dsAiHubRoot = runtime.dsAiHubRoot {
            environment["CODEX_DESIGN_SYSTEM"] = designSystemRoot
            environment["CODEX_DS_AI_HUB"] = dsAiHubRoot
            environment["APOLLO_KNOWLEDGE_CONTENT_VERSION"] = current.contentVersion
            if let commit = current.sourceCommits?["design-system_ab"] ?? nil {
                environment["APOLLO_KNOWLEDGE_DESIGN_SYSTEM_COMMIT"] = commit
            }
            if let commit = current.sourceCommits?["ds-ai-hub"] ?? nil {
                environment["APOLLO_KNOWLEDGE_DS_AI_HUB_COMMIT"] = commit
            }
        }
        task.environment = environment
        task.terminationHandler = { [weak self] process in
            Task { @MainActor in
                guard let self else { return }
                self.outputPipe?.fileHandleForReading.readabilityHandler = nil
                self.outputPipe = nil
                self.process = nil
                let intentionalStop = self.isStoppingIntentionally
                self.isStoppingIntentionally = false
                let shouldRestart = intentionalStop && self.pendingRestartAfterStop
                self.pendingRestartAfterStop = false

                if shouldRestart {
                    self.status = .stopped
                    self.appendLog("=== \(Date()) Proxy stopped (restart requested) ===\n")
                    self.startProxyAction()
                    return
                }

                if process.terminationStatus == 0 || intentionalStop {
                    self.status = .stopped
                } else {
                    self.status = .error("Exit \(process.terminationStatus)")
                }
                self.appendLog("=== \(Date()) Proxy stopped (exit \(process.terminationStatus)) ===\n")
            }
        }

        do {
            try task.run()
            process = task
        } catch {
            status = .error("Start failed")
            showError("Cannot start proxy", error.localizedDescription)
            outputPipe?.fileHandleForReading.readabilityHandler = nil
            outputPipe = nil
            process = nil
        }
    }

    @objc private func stopProxyAction() {
        guard let process else {
            status = .stopped
            return
        }
        isStoppingIntentionally = true
        appendLog("=== \(Date()) Stopping proxy ===\n")
        process.terminate()

        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
            guard let self, let stillRunning = self.process else {
                return
            }
            if stillRunning.isRunning {
                Darwin.kill(stillRunning.processIdentifier, SIGKILL)
            }
        }
    }

    @objc private func editApolloURLAction() {
        do {
            try ensureProxyInstalled()
        } catch {
            showError("Cannot open APOLLO_AGENT_URL editor", error.localizedDescription)
            return
        }

        let currentValue = readConfiguredApolloURL() ?? defaultApolloURL
        let inputField = PasteFriendlyTextField(frame: NSRect(x: 0, y: 0, width: 720, height: 28))
        inputField.placeholderString = "https://your-apollo-host/api/v1/run/..."
        inputField.stringValue = currentValue
        inputField.usesSingleLineMode = true
        inputField.lineBreakMode = .byTruncatingMiddle
        inputField.isEditable = true
        inputField.isSelectable = true

        let accessoryView = NSView(frame: NSRect(x: 0, y: 0, width: 720, height: 28))
        inputField.autoresizingMask = [.width]
        accessoryView.addSubview(inputField)

        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = "Set APOLLO_AGENT_URL"
        alert.informativeText = "This value is saved locally on this Mac and does not require rebuilding the app."
        alert.accessoryView = accessoryView
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)

        guard alert.runModal() == .alertFirstButtonReturn else {
            return
        }

        let newValue = inputField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if let validationError = validateApolloURLInput(newValue) {
            showError("Invalid APOLLO_AGENT_URL", validationError)
            return
        }

        do {
            try saveApolloURL(newValue)
            refreshUI()
            promptForRestartIfNeeded()
        } catch {
            showError("Cannot save APOLLO_AGENT_URL", error.localizedDescription)
        }
    }

    @objc private func switchKnowledgeSourceAction() {
        do {
            try ensureProxyInstalled()
        } catch {
            showError("Cannot switch knowledge source", error.localizedDescription)
            return
        }

        let current = readConfiguredKnowledgeSource()
        let next = current == "ds-ai-hub" ? "design-system_ab" : "ds-ai-hub"
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = "Switch knowledge source to \(next)?"
        alert.informativeText = "Apollo v3 will resolve component rules from \(next). The setting is saved locally and can be changed back at any time."
        alert.addButton(withTitle: process == nil ? "Switch" : "Switch and Restart")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else {
            return
        }

        do {
            try saveKnowledgeSource(next)
            refreshUI()
            if process != nil {
                pendingRestartAfterStop = true
                stopProxyAction()
            } else {
                showInfo(
                    "Knowledge source changed",
                    "Apollo will use \(next) on the next proxy start."
                )
            }
        } catch {
            showError("Cannot save knowledge source", error.localizedDescription)
        }
    }

    @objc private func openEnvAction() {
        do {
            try ensureProxyInstalled()
            let envURL = proxyInstallURL.appendingPathComponent(".env", isDirectory: false)
            NSWorkspace.shared.open(envURL)
        } catch {
            showError("Cannot open .env", error.localizedDescription)
        }
    }

    @objc private func openLogsAction() {
        do {
            try ensureProxyInstalled()
            NSWorkspace.shared.open(logURL)
        } catch {
            showError("Cannot open logs", error.localizedDescription)
        }
    }

    @objc private func openProxyFolderAction() {
        do {
            try ensureProxyInstalled()
            NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: proxyInstallURL.path)
        } catch {
            showError("Cannot open folder", error.localizedDescription)
        }
    }

    @objc private func quitAction() {
        if let process {
            process.terminate()
        }
        if let codexAuthProcess {
            codexAuthProcess.terminate()
        }
        NSApp.terminate(nil)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var manager: ProxyManager?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let manager = ProxyManager()
        manager.setupStatusItem(
            autoStartProxy: CommandLine.arguments.contains("--start-proxy")
        )
        self.manager = manager
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
