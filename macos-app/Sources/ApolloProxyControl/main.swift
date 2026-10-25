import AppKit
import Darwin
import Foundation

private let defaultApolloURL = CLIProvider.defaultAlfaGenURL

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
    private let statusIndicator = StatusItemIndicator()
    private let menu = NSMenu()
    private let statusLineItem = NSMenuItem(title: "Прокси выключен", action: nil, keyEquivalent: "")
    private let updateKnowledgeItem = NSMenuItem(title: "Обновить знания", action: #selector(updateKnowledgeAction), keyEquivalent: "")
    private let startItem = NSMenuItem(title: "Запустить прокси", action: #selector(toggleProxyAction), keyEquivalent: "")
    private let authorizeAgentItem = NSMenuItem(title: "Войти в Codex…", action: #selector(authorizeAgentAction), keyEquivalent: "")
    private let aboutItem = NSMenuItem(title: "О прокси…", action: #selector(showProxyDetailsAction), keyEquivalent: ",")
    private let tokensItem = NSMenuItem(title: "Токенцы…", action: #selector(showTokenJournalAction), keyEquivalent: "")
    private let checkUpdatesItem = NSMenuItem(title: "Проверить обновление", action: #selector(checkUpdatesAction), keyEquivalent: "")
    private let quitItem = NSMenuItem(title: "Завершить", action: #selector(quitAction), keyEquivalent: "q")

    private var process: Process?
    private var agentAuthProcess: Process?
    private let codexInstaller = CodexCLIInstaller()
    private var outputPipe: Pipe?
    private var lifetimePipe: Pipe?
    private var healthTimer: Timer?
    private var knowledgeTimer: Timer?
    private var status: ProxyStatus = .stopped {
        didSet { refreshUI() }
    }
    private var agentAuthStatus: AgentAuthStatus = .checking {
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
    private var cachedAgentExecutableURL: URL?
    private var cachedAgentLookupKey = ""
    private var claudeLoginTimer: Timer?
    private var authCheckTimer: Timer?
    private var proxyHasActiveWork = false
    private var healthSnapshot: ProxyHealthSnapshot?
    private var startRequest = ProxyStartRequest()
    private var isExternalProxyRunning: Bool { process == nil && status == .running }
    private var detailsController: ProxyDetailsWindowController?
    private var tokenJournalController: TokenJournalWindowController?
    private var modelCatalogProcess: Process?
    private var modelCatalogTimer: Timer?
    private var codexModelChoices: [AgentModelChoice] = []
    private var modelCatalogError = ""
    private var isStoppingIntentionally = false
    private var pendingRestartAfterStop = false
    private var pendingProxyStartAfterAuthorization = false
    private var knowledgeRuntime: KnowledgeCommandStatus?
    private var knowledgeCommandRunning = false
    private let updateCheck = ProxyUpdateCheck()
    private var codeReleaseStatus: CodeReleaseStatus?
    private var codeCheckError: String?
    private var codeCommandProcess: Process?
    private var codeCommandRunning = false
    private var codeRestartPending = false
    private var expectedCodeReleaseID: String?
    private var pendingKnowledgeRestart = false
    private var isQuitting = false

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
        checkForUpdates()
        checkAgentAuthorization(startProxyWhenReady: autoStartProxy)
    }

    private func configureMenu() {
        menu.autoenablesItems = false
        statusLineItem.isEnabled = false
        menu.addItem(statusLineItem)
        startItem.target = self
        menu.addItem(startItem)
        menu.addItem(.separator())
        authorizeAgentItem.target = self
        menu.addItem(authorizeAgentItem)
        updateKnowledgeItem.target = self
        menu.addItem(updateKnowledgeItem)
        checkUpdatesItem.target = self
        menu.addItem(checkUpdatesItem)
        menu.addItem(.separator())
        aboutItem.target = self
        menu.addItem(aboutItem)
        tokensItem.target = self
        menu.addItem(tokensItem)
        quitItem.target = self
        menu.addItem(quitItem)
    }

    private func refreshUI() {
        let provider = selectedProvider
        var snapshot = ProxyDetailsSnapshot()
        snapshot.provider = provider
        snapshot.model = configuredModel
        snapshot.modelChoices = provider == .codex ? codexModelChoices : provider.modelChoices
        snapshot.modelLoading = modelCatalogProcess != nil
        if snapshot.modelLoading { snapshot.modelMessage = "Загружаем список моделей…" }
        else if provider == .codex && !modelCatalogError.isEmpty { snapshot.modelMessage = modelCatalogError }
        snapshot.version = formattedProxyVersionForMenu().replacingOccurrences(of: "Proxy: ", with: "")
        snapshot.apolloURL = readConfiguredApolloURL() ?? defaultApolloURL
        snapshot.knowledgeSource = readConfiguredKnowledgeSource()
        snapshot.knowledgeVersion = (isExternalProxyRunning ? healthSnapshot?.knowledgeVersion : nil)
            ?? knowledgeRuntime?.current?.contentVersion ?? "Встроенный пакет"
        let sourceCommits: [String: String?]? = isExternalProxyRunning
            ? healthSnapshot?.sourceCommits?.mapValues { Optional($0) }
            : knowledgeRuntime?.current?.sourceCommits
        if let commits = sourceCommits {
            snapshot.sourceCommits = commits.sorted(by: { $0.key < $1.key }).compactMap { key, value in
                value.map { "\(key): \($0)" }
            }.joined(separator: "\n")
        }
        switch knowledgeUpdateStatus {
        case .idle: snapshot.knowledgeStatus = "Проверка обновлений ещё не выполнена"
        case .checking: snapshot.knowledgeStatus = "Проверяем обновления…"
        case .updateAvailable: snapshot.knowledgeStatus = "Доступно обновление знаний"
        case .downloading: snapshot.knowledgeStatus = "Загружаем знания…"
        case .validating: snapshot.knowledgeStatus = "Проверяем пакет знаний…"
        case .ready: snapshot.knowledgeStatus = "Знания обновлены"
        case .failed(let message): snapshot.knowledgeStatus = "Ошибка обновления: \(message)"
        case .upToDate: snapshot.knowledgeStatus = "Установлена актуальная версия знаний"
        }
        if isExternalProxyRunning { snapshot.knowledgeStatus = "Пакет отдельного запуска. Обновление выполняется вне миниаппа." }
        if case .updateAvailable = knowledgeUpdateStatus { snapshot.canUpdate = !knowledgeCommandRunning && !isExternalProxyRunning }
        snapshot.canRollback = !knowledgeCommandRunning && knowledgeRuntime?.previous != nil && !isExternalProxyRunning
        snapshot.canCheckUpdates = !knowledgeCommandRunning && !isExternalProxyRunning
        snapshot.canUpdate = snapshot.canUpdate && !codeCommandRunning && !codeRestartPending
        snapshot.canRollback = snapshot.canRollback && !codeCommandRunning && !codeRestartPending
        snapshot.canCheckUpdates = snapshot.canCheckUpdates && !codeCommandRunning && !codeRestartPending
            && !updateCheck.isRunning && !pendingKnowledgeRestart && status != .starting && agentAuthProcess == nil && !codexInstaller.isRunning
        snapshot.checkingUpdates = updateCheck.isRunning
        snapshot.codeStatus = codeCheckError ?? codeReleaseStatus.map { CodeReleasePresentation(status: $0).summary }
            ?? "Проверка ещё не выполнена"
        if updateCheck.isRunning {
            snapshot.codeStatus = "Проверяем обновления…"
            snapshot.knowledgeStatus = "Проверяем обновления…"
        } else if codeCommandRunning { snapshot.codeStatus = "Обновляем код прокси…" }
        let canManageUpdates = snapshot.canCheckUpdates && !proxyHasActiveWork && !pendingKnowledgeRestart
        if let value = codeReleaseStatus, codeCheckError == nil {
            let actions = CodeReleasePresentation(status: value).actions
            snapshot.canUpdateCode = canManageUpdates && actions.contains(.update)
            snapshot.canRollbackCode = canManageUpdates && actions.contains(.rollback)
        }
        snapshot.canUpdate = snapshot.canUpdate && canManageUpdates
        snapshot.canRollback = snapshot.canRollback && canManageUpdates
        snapshot.canChangeAgent = agentAuthProcess == nil && !codexInstaller.isRunning && !proxyHasActiveWork && !knowledgeCommandRunning && !codeCommandRunning && !updateCheck.isRunning && !codeRestartPending && status != .starting && !isExternalProxyRunning
        if case .authorized = agentAuthStatus { snapshot.canRefreshModels = snapshot.canChangeAgent }
        snapshot.cliMissing = agentAuthStatus == .binaryMissing
        let canInstall = provider.canInstall(configured: readEnvMap()?[provider.binaryKey] ?? "")
        snapshot.canLogin = agentAuthProcess == nil && !codexInstaller.isRunning && (canInstall || claudeLoginTimer != nil || resolveAgentExecutableURL() != nil)
        snapshot.canCheckAccess = agentAuthProcess == nil && !codexInstaller.isRunning
        snapshot.loginTitle = claudeLoginTimer != nil ? "Отменить ожидание" : "Войти в \(provider.name)…"
        snapshot.authorizationHelp = provider == .claude
            ? "Вход выполняется в Claude Code через Terminal. Нужен Claude Code 2.1.248 или новее."
            : "Вход выполняется через официальный Codex CLI и ваш аккаунт."
        switch agentAuthStatus {
        case .checking: snapshot.authorization = "Проверяем вход…"
        case .notConfigured: snapshot.authorization = "Локальный AI-агент не настроен"
        case .binaryMissing: snapshot.authorization = "\(provider.name) CLI не найден"
        case .installing: snapshot.authorization = "Загружаем и устанавливаем Codex…"
        case .unauthorized: snapshot.authorization = "Войдите в \(provider.name), чтобы использовать агент"
        case .authorizing: snapshot.authorization = "Ожидаем завершения входа в \(provider.name)…"
        case .authorized(let method):
            snapshot.authorization = method.map { "Вход выполнен через \($0)" } ?? "Вход выполнен"
            snapshot.loginTitle = "Сменить аккаунт…"
        case .error(let message): snapshot.authorization = message
        }
        if canInstall && resolveAgentExecutableURL() == nil {
            snapshot.loginTitle = "Установить и войти…"
            snapshot.authorizationHelp = "Apollo установит официальный Codex CLI и откроет вход в браузере. Нужен интернет."
        } else if snapshot.cliMissing && provider == .codex {
            snapshot.authorizationHelp = "CLI не найден по указанному пути. Проверьте путь в «Конфигурация…»."
        }
        if agentAuthStatus == .installing { snapshot.loginTitle = "Установка…" }
        snapshot.authorizationBusy = agentAuthStatus == .checking || agentAuthStatus == .installing || agentAuthStatus == .authorizing
        authorizeAgentItem.title = snapshot.loginTitle
        authorizeAgentItem.isHidden = !provider.usesCLI || (agentAuthStatus != .unauthorized && agentAuthStatus != .binaryMissing)
        authorizeAgentItem.isEnabled = snapshot.canLogin
        updateKnowledgeItem.isEnabled = snapshot.canUpdate
        updateKnowledgeItem.isHidden = !snapshot.canUpdate && !knowledgeCommandRunning
        updateKnowledgeItem.title = knowledgeCommandRunning ? snapshot.knowledgeStatus : "Обновить знания"
        checkUpdatesItem.isEnabled = snapshot.canCheckUpdates
        checkUpdatesItem.title = updateCheck.isRunning ? "Проверяем обновления…" : "Проверить обновление"
        switch status {
        case .stopped:
            setStatusItemTitle("AP:Off")
            snapshot.status = "Прокси выключен"
            startItem.title = "Запустить прокси"
            startItem.isEnabled = true
        case .starting:
            setStatusItemTitle("AP:...")
            snapshot.status = "Прокси запускается…"
            startItem.title = "Остановить прокси"
            startItem.isEnabled = process != nil || startRequest.pending || pendingProxyStartAfterAuthorization
        case .running:
            setStatusItemTitle("AP:On")
            snapshot.status = "Прокси работает · порт \(readPort())" + (isExternalProxyRunning ? " · отдельный запуск" : "")
            startItem.title = isExternalProxyRunning ? "Запущен вне миниаппа" : "Остановить прокси"
            startItem.isEnabled = !isExternalProxyRunning
        case .error(let message):
            setStatusItemTitle("AP:Err")
            snapshot.status = "Ошибка прокси: \(message)"
            startItem.title = process == nil ? "Запустить прокси" : "Остановить прокси"
            startItem.isEnabled = true
        }
        // The menu stays compact even when a diagnostic contains a long path.
        if codeCommandRunning || updateCheck.isRunning { startItem.isEnabled = false }
        if case .error = status { statusLineItem.title = "Ошибка прокси · подробнее в «О прокси»" }
        else { statusLineItem.title = snapshot.status }
        detailsController?.update(snapshot)
    }

    private func setStatusItemTitle(_ base: String) {
        guard let button = statusItem.button else { return }
        button.title = base
        switch status {
        case .stopped:
            statusIndicator.apply(to: button, mode: .hidden, description: "Proxy выключен.")
            return
        case .starting:
            statusIndicator.apply(to: button, mode: .busy, description: "Proxy запускается.")
            return
        case .error:
            statusIndicator.apply(to: button, mode: .error, description: "Ошибка Proxy. Подробности в меню.")
            return
        case .running:
            break
        }
        if isExternalProxyRunning {
            statusIndicator.apply(to: button, mode: healthSnapshot?.knowledgeReady == false ? .error : .active,
                                  description: healthSnapshot?.knowledgeReady == false ? "Ошибка знаний работающего Proxy." : "Proxy работает. Отдельный запуск.")
            return
        }
        if updateCheck.isRunning || codeCommandRunning {
            statusIndicator.apply(to: button, mode: .busy, description: "Проверка или установка обновления прокси.")
            return
        }
        if codeCheckError != nil || codeReleaseStatus?.checkError != nil {
            statusIndicator.apply(to: button, mode: .error, description: "Ошибка проверки кода прокси. Подробности в «О прокси».")
            return
        }
        if case .failed = knowledgeUpdateStatus {
            statusIndicator.apply(to: button, mode: .error, description: "Ошибка обновления знаний. Подробности в «О прокси».")
            return
        }
        if codeReleaseStatus?.updateAvailable == true, codeReleaseStatus?.pending == nil {
            statusIndicator.apply(to: button, mode: .updateAvailable, description: "Доступно обновление кода прокси. Откройте «О прокси».")
            return
        }
        switch knowledgeUpdateStatus {
        case .idle:
            statusIndicator.apply(to: button, mode: .active, description: "Proxy работает.")
        case .checking:
            statusIndicator.apply(to: button, mode: .busy, description: "Проверка обновления знаний.")
        case .updateAvailable:
            statusIndicator.apply(to: button, mode: .updateAvailable,
                                  description: "Доступно обновление знаний. Выберите «Обновить знания» в меню.")
        case .downloading:
            statusIndicator.apply(to: button, mode: .busy, description: "Загрузка знаний.")
        case .validating:
            statusIndicator.apply(to: button, mode: .busy, description: "Проверка пакета знаний.")
        case .ready:
            statusIndicator.apply(to: button, mode: .active, description: "Proxy работает. Знания обновлены.")
        case .failed:
            statusIndicator.apply(to: button, mode: .error, description: "Ошибка обновления знаний. Подробности в меню.")
        case .upToDate:
            statusIndicator.apply(to: button, mode: .active, description: "Proxy работает. Знания актуальны.")
        }
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
                self?.checkForUpdates()
            }
        }
    }

    private func checkHealth(completion: (@MainActor @Sendable (Bool) -> Void)? = nil) {
        let observedProcess = process
        let port = readPort()
        guard let url = URL(string: "http://127.0.0.1:\(port)/health") else {
            status = .error("Invalid health URL")
            completion?(false)
            return
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 1.5

        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            Task { @MainActor in
                guard let self, !self.isQuitting else { return }
                guard self.process === observedProcess else { completion?(false); return }
                guard !self.isStoppingIntentionally else { completion?(false); return }
                let http = response as? HTTPURLResponse
                guard let health = ProxyHealthSnapshot.decode(data, statusCode: http?.statusCode) else {
                    self.healthSnapshot = nil
                    self.proxyHasActiveWork = false
                    if self.status == .running { self.status = self.process == nil ? .stopped : .starting }
                    completion?(false)
                    return
                }
                self.healthSnapshot = health
                self.proxyHasActiveWork = health.busy
                if self.status != .running, observedProcess == nil {
                    self.appendLog("=== \(Date()) Connected to existing Apollo proxy on port \(port); no child started ===\n")
                }
                self.status = .running
                self.refreshUI()
                completion?(true)
                if self.codeRestartPending && !self.codeCommandRunning {
                    self.runCodeCommand("status") { value in
                        guard value.pending == nil else { return }
                        self.codeRestartPending = false
                        if value.lastFailure?.id == self.expectedCodeReleaseID {
                            self.showError("Обновление не запустилось", "Прокси вернулся к версии \(value.current.label). Настройки и история сохранены.")
                        }
                        self.expectedCodeReleaseID = nil
                        self.refreshUI()
                    }
                }
                if self.pendingKnowledgeRestart,
                   self.process != nil,
                   health.activeRequests == 0,
                   !self.proxyHasActiveWork {
                    self.pendingKnowledgeRestart = false
                    self.stopManagedProxy(restart: true)
                }
            }
        }.resume()
    }

    private func configuredKnowledgeDescriptorURL() -> String? {
        if FileManager.default.fileExists(atPath: proxyInstallURL.appendingPathComponent("runtime/seed/manifest.json").path) {
            if let configured = readEnvMap()?["APOLLO_DATA_DESCRIPTOR_URL"], !configured.isEmpty { return configured }
            let settings = appSupportURL.appendingPathComponent("portable-settings.json")
            if let bytes = try? Data(contentsOf: settings),
               let value = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
               let url = value["dataDescriptorUrl"] as? String, !url.isEmpty { return url }
            return (Bundle.main.object(forInfoDictionaryKey: "ApolloDataDescriptorURL") as? String).flatMap { $0.isEmpty ? nil : $0 }
        }
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
        if let token = readEnvMap()?["APOLLO_DATA_TOKEN"], !token.isEmpty { environment["APOLLO_DATA_TOKEN"] = token }
        return environment
    }

    private func knowledgeCommandRunner() throws -> KnowledgeCommandRunner {
        guard let nodeURL = resolveNodeExecutableURL() else {
            throw KnowledgeCommandError.failed("Bundled Node runtime is unavailable.")
        }
        let releaseSeed = proxyInstallURL.appendingPathComponent("runtime/seed", isDirectory: true)
        let portable = FileManager.default.fileExists(atPath: releaseSeed.appendingPathComponent("manifest.json").path)
        let cliURL = proxyInstallURL
            .appendingPathComponent("scripts", isDirectory: true)
            .appendingPathComponent(portable ? "data-release-cli.js" : "knowledge-package-cli.js", isDirectory: false)
        guard FileManager.default.fileExists(atPath: cliURL.path) else {
            throw KnowledgeCommandError.failed("Knowledge updater is missing from embedded proxy.")
        }
        guard let seedURL = portable ? releaseSeed : Bundle.main.resourceURL?
            .appendingPathComponent("knowledge-seed", isDirectory: true)
            .appendingPathComponent("package", isDirectory: true),
              FileManager.default.fileExists(atPath: seedURL.path) else {
            throw KnowledgeCommandError.failed("Embedded knowledge seed is missing.")
        }
        var runner = KnowledgeCommandRunner(
            nodeURL: nodeURL,
            cliURL: cliURL,
            storeURL: portable ? appSupportURL.appendingPathComponent("data-releases") : knowledgeStoreURL,
            seedURL: portable ? releaseSeed : seedURL,
            descriptorURL: configuredKnowledgeDescriptorURL(),
            environment: knowledgeCommandEnvironment()
        )
        if portable { runner.runtimeURL = proxyInstallURL.appendingPathComponent("runtime/apollo") }
        return runner
    }

    private func checkForUpdates() {
        guard !knowledgeCommandRunning, !codeCommandRunning, !codeRestartPending,
              !pendingKnowledgeRestart, !isExternalProxyRunning else { return }
        updateCheck.run(code: { done in
            self.codeCheckError = nil
            self.runCodeCommand("check", onFailure: { error in
                self.codeCheckError = error.localizedDescription
                done()
            }) { _ in done() }
        }, knowledge: { done in
            self.checkForKnowledgeUpdate(completion: done)
        }, completion: {
            self.refreshUI()
            if self.startRequest.pending { self.startProxyAction() }
        })
        refreshUI()
    }

    private func checkForKnowledgeUpdate(completion: @escaping @MainActor () -> Void) {
        guard !knowledgeCommandRunning, !codeCommandRunning, !codeRestartPending, !isExternalProxyRunning else { completion(); return }
        guard configuredKnowledgeDescriptorURL() != nil else {
            knowledgeUpdateStatus = .idle
            completion()
            return
        }
        knowledgeCommandRunning = true
        knowledgeUpdateStatus = .checking
        do {
            let task = try knowledgeCommandRunner().run("check", phase: { _ in }) { [weak self] result in
                Task { @MainActor in
                    guard let self else { return }
                    defer { self.finishKnowledgeCommand("check"); completion() }
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
            appendLog("=== \(Date()) Knowledge check started (pid \(task.processIdentifier)) ===\n")
        } catch {
            defer { finishKnowledgeCommand("check"); completion() }
            knowledgeUpdateStatus = .failed(error.localizedDescription)
        }
    }

    private func finishKnowledgeCommand(_ command: String) {
        knowledgeCommandRunning = false
        appendLog("=== \(Date()) Knowledge \(command) finished ===\n")
        if startRequest.pending && !updateCheck.isRunning { startProxyAction() }
        else { refreshUI() }
    }

    private func applyUpdatedKnowledgeRuntime() {
        guard process != nil else { return }
        pendingKnowledgeRestart = true
        appendLog("=== \(Date()) Knowledge update waits for active audit before proxy restart ===\n")
        checkHealth()
    }

    @objc private func updateKnowledgeAction() {
        guard !knowledgeCommandRunning, !codeCommandRunning, !updateCheck.isRunning, !codeRestartPending,
              !pendingKnowledgeRestart, !proxyHasActiveWork, !isExternalProxyRunning else { return }
        knowledgeCommandRunning = true
        knowledgeUpdateStatus = .downloading
        do {
            let task = try knowledgeCommandRunner().run("update", phase: { [weak self] phase in
                Task { @MainActor in
                    if phase == "validating" { self?.knowledgeUpdateStatus = .validating }
                    if phase == "downloading" { self?.knowledgeUpdateStatus = .downloading }
                }
            }) { [weak self] result in
                Task { @MainActor in
                    guard let self else { return }
                    defer { self.finishKnowledgeCommand("update") }
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
            appendLog("=== \(Date()) Knowledge update started (pid \(task.processIdentifier)) ===\n")
        } catch {
            defer { finishKnowledgeCommand("update") }
            knowledgeUpdateStatus = .failed(error.localizedDescription)
        }
    }

    @objc private func rollbackKnowledgeAction() {
        guard !knowledgeCommandRunning, !codeCommandRunning, !updateCheck.isRunning, !codeRestartPending,
              !pendingKnowledgeRestart, !proxyHasActiveWork, !isExternalProxyRunning else { return }
        knowledgeCommandRunning = true
        knowledgeUpdateStatus = .validating
        do {
            let task = try knowledgeCommandRunner().run("rollback", phase: { _ in }) { [weak self] result in
                Task { @MainActor in
                    guard let self else { return }
                    defer { self.finishKnowledgeCommand("rollback") }
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
            appendLog("=== \(Date()) Knowledge rollback started (pid \(task.processIdentifier)) ===\n")
        } catch {
            defer { finishKnowledgeCommand("rollback") }
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
        if let provider = env["APOLLO_CLI_PROVIDER"], CLIProvider(rawValue: provider) == nil {
            return "Укажите codex, claude или alfagen в APOLLO_CLI_PROVIDER либо выберите агент в окне «О прокси»."
        }
        if selectedProvider.usesCLI && !CLIProvider.validModel(configuredModel) {
            return "Некорректный ID модели. Выберите модель в окне «О прокси»."
        }

        if selectedProvider == .alfagen {
            return validateApolloURLInput(readConfiguredApolloURL() ?? defaultApolloURL)
        }
        let agentBinary = resolveAgentExecutableURL()
        if agentBinary == nil && !selectedProvider.canInstall(configured: env[selectedProvider.binaryKey] ?? "") {
            return "Установите выбранный AI-агент в окне «О прокси»."
        }

        return nil
    }

    private var selectedProvider: CLIProvider {
        CLIProvider(rawValue: readEnvMap()?["APOLLO_CLI_PROVIDER"] ?? "codex") ?? .codex
    }

    private var configuredModel: String {
        selectedProvider.usesCLI ? (readEnvMap()?[selectedProvider.modelKey] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) : ""
    }

    private func isAgentConfigured() -> Bool {
        let env = readEnvMap() ?? [:]
        guard selectedProvider.usesCLI else { return false }
        return selectedProvider == .claude || env["APOLLO_CLI_PROVIDER"] != nil || !(env["CODEX_BIN"] ?? "").isEmpty
    }

    private func buildAgentEnvironment() -> [String: String] {
        let common = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL",
                      "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
                      "https_proxy", "http_proxy", "no_proxy"]
        let claude = ["CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN",
                      "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
                      "AWS_PROFILE", "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
                      "AWS_SESSION_TOKEN", "AWS_BEARER_TOKEN_BEDROCK", "GOOGLE_APPLICATION_CREDENTIALS",
                      "ANTHROPIC_VERTEX_PROJECT_ID", "CLOUD_ML_REGION", "ANTHROPIC_FOUNDRY_RESOURCE",
                      "ANTHROPIC_FOUNDRY_BASE_URL", "ANTHROPIC_FOUNDRY_API_KEY"]
        let allowed = common + (selectedProvider == .claude ? claude : ["CODEX_HOME", "CODEX_CA_CERTIFICATE"])
        var environment = ProcessInfo.processInfo.environment.filter { allowed.contains($0.key) }
        let config = readEnvMap() ?? [:]
        for key in allowed { if let value = config[key], !value.isEmpty { environment[key] = value } }
        return environment
    }

    private func resolveAgentExecutableURL() -> URL? {
        let provider = selectedProvider
        guard provider.usesCLI else { return nil }
        let configured = readEnvMap()?[provider.binaryKey]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let key = provider.rawValue + ":" + configured
        let fm = FileManager.default
        if cachedAgentLookupKey == key, let cachedAgentExecutableURL, fm.isExecutableFile(atPath: cachedAgentExecutableURL.path) {
            return cachedAgentExecutableURL
        }
        cachedAgentLookupKey = key
        cachedAgentExecutableURL = nil
        let home = buildAgentEnvironment()["HOME"] ?? fm.homeDirectoryForCurrentUser.path
        for candidate in provider.candidates(configured: configured, home: home) where fm.isExecutableFile(atPath: candidate) {
            let url = URL(fileURLWithPath: candidate)
            cachedAgentExecutableURL = url
            return url
        }
        if configured.hasPrefix("/"), provider != .codex || configured != CLIProvider.legacyCodexBinary { return nil }
        let lookup = Process()
        lookup.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        lookup.arguments = [configured.isEmpty || configured == CLIProvider.legacyCodexBinary ? provider.rawValue : configured]
        lookup.environment = buildAgentEnvironment()
        let output = Pipe()
        lookup.standardOutput = output; lookup.standardError = Pipe()
        do {
            try lookup.run(); lookup.waitUntilExit()
            let raw = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if lookup.terminationStatus == 0, raw.hasPrefix("/"), fm.isExecutableFile(atPath: raw) {
                let url = URL(fileURLWithPath: raw); cachedAgentExecutableURL = url; return url
            }
        } catch { return nil }
        return nil
    }

    private func checkAgentAuthorization(startProxyWhenReady: Bool = false, showResult: Bool = false) {
        if startProxyWhenReady { pendingProxyStartAfterAuthorization = true }
        guard agentAuthProcess == nil, !codexInstaller.isRunning, !isQuitting else { return }
        do { try ensureProxyInstalled() } catch { agentAuthStatus = .error("Не удалось подготовить прокси."); return }
        if !selectedProvider.usesCLI {
            pendingProxyStartAfterAuthorization = false
            agentAuthStatus = .authorized(method: nil)
            if startProxyWhenReady { startProxyAction() }
            return
        }
        guard isAgentConfigured() else { agentAuthStatus = .notConfigured; return }
        guard let binary = resolveAgentExecutableURL() else {
            agentAuthStatus = .binaryMissing
            if showResult { showProxyDetailsAction() }
            return
        }
        let provider = selectedProvider
        if claudeLoginTimer == nil { agentAuthStatus = .checking }
        let task = Process(), output = Pipe(), errors = Pipe()
        task.executableURL = binary
        task.arguments = provider.statusArguments
        task.environment = buildAgentEnvironment()
        task.standardOutput = output; task.standardError = errors
        errors.fileHandleForReading.readabilityHandler = { _ = $0.availableData }
        task.terminationHandler = { [weak self] finished in
            let data = output.fileHandleForReading.readDataToEndOfFile()
            errors.fileHandleForReading.readabilityHandler = nil
            let text = String(data: data, encoding: .utf8) ?? ""
            Task { @MainActor in
                guard let self, self.agentAuthProcess === finished else { return }
                self.authCheckTimer?.invalidate(); self.authCheckTimer = nil
                self.agentAuthProcess = nil
                guard !self.isQuitting, self.selectedProvider == provider else { return }
                let result = AgentCLI.authenticationStatus(provider: provider, exitCode: finished.terminationStatus, output: text)
                if case .authorized = result {
                    self.claudeLoginTimer?.invalidate(); self.claudeLoginTimer = nil
                    self.agentAuthStatus = result
                    self.appendLog("=== \(Date()) \(provider.name) authorization check succeeded ===\n")
                    if self.detailsController != nil { self.refreshModelCatalog() }
                    if self.pendingProxyStartAfterAuthorization {
                        self.pendingProxyStartAfterAuthorization = false
                        self.startProxyAction()
                    }
                } else if self.claudeLoginTimer == nil {
                    self.agentAuthStatus = result
                } else if case .error = result {
                    self.claudeLoginTimer?.invalidate(); self.claudeLoginTimer = nil
                    self.agentAuthStatus = result
                } else { self.refreshUI() }
                if showResult { self.showProxyDetailsAction() }
            }
        }
        do {
            agentAuthProcess = task; try task.run()
            authCheckTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self, weak task] _ in
                Task { @MainActor in
                    guard let self, let task, self.agentAuthProcess === task, task.isRunning else { return }
                    task.terminate()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { if task.isRunning { Darwin.kill(task.processIdentifier, SIGKILL) } }
                }
            }
        } catch {
            errors.fileHandleForReading.readabilityHandler = nil
            agentAuthProcess = nil; agentAuthStatus = .error("Не удалось запустить проверку входа.")
        }
    }

    @objc private func checkAgentAccessAction() { checkAgentAuthorization(showResult: true) }

    @objc private func authorizeAgentAction() {
        guard selectedProvider.usesCLI else { return }
        cancelModelCatalog()
        if selectedProvider == .codex { codexModelChoices = [] }
        if let timer = claudeLoginTimer {
            timer.invalidate(); claudeLoginTimer = nil
            pendingProxyStartAfterAuthorization = false
            agentAuthStatus = .unauthorized
            return
        }
        guard agentAuthProcess == nil, !codexInstaller.isRunning, !isQuitting else { return }
        guard let binary = resolveAgentExecutableURL() else {
            if selectedProvider.canInstall(configured: readEnvMap()?[selectedProvider.binaryKey] ?? "") {
                installCodexAndLogin()
            } else { agentAuthStatus = .binaryMissing; showProxyDetailsAction() }
            return
        }
        let provider = selectedProvider
        agentAuthStatus = .authorizing
        if provider == .claude {
            let command = AgentCLI.claudeLoginCommand(binary: binary, configDirectory: buildAgentEnvironment()["CLAUDE_CONFIG_DIR"])
            var error: NSDictionary?
            let result = NSAppleScript(source: AgentCLI.terminalAppleScript(command: command))?.executeAndReturnError(&error)
            guard result != nil, error == nil else {
                agentAuthStatus = .error("Не удалось открыть Terminal. Выполните claude auth login в Terminal и нажмите «Проверить вход».")
                showProxyDetailsAction(); return
            }
            let deadline = Date().addingTimeInterval(600)
            claudeLoginTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    guard !self.isQuitting, self.selectedProvider == .claude else {
                        self.claudeLoginTimer?.invalidate(); self.claudeLoginTimer = nil; return
                    }
                    if Date() >= deadline {
                        self.claudeLoginTimer?.invalidate(); self.claudeLoginTimer = nil
                        self.agentAuthStatus = .unauthorized
                    } else { self.checkAgentAuthorization() }
                }
            }
            refreshUI()
            return
        }
        let task = Process(), output = Pipe()
        task.executableURL = binary; task.arguments = provider.loginArguments
        task.environment = buildAgentEnvironment()
        task.standardOutput = output; task.standardError = output
        output.fileHandleForReading.readabilityHandler = { _ = $0.availableData }
        task.terminationHandler = { [weak self] finished in
            output.fileHandleForReading.readabilityHandler = nil
            Task { @MainActor in
                guard let self, self.agentAuthProcess === finished, !self.isQuitting else { return }
                self.agentAuthProcess = nil
                if finished.terminationStatus == 0 { self.checkAgentAuthorization() }
                else { self.agentAuthStatus = .unauthorized; self.pendingProxyStartAfterAuthorization = false }
            }
        }
        do { agentAuthProcess = task; try task.run() }
        catch { output.fileHandleForReading.readabilityHandler = nil; agentAuthProcess = nil; agentAuthStatus = .error("Не удалось начать вход в Codex.") }
    }

    private func installCodexAndLogin() {
        codexInstaller.install(environment: buildAgentEnvironment()) { [weak self] result in
            guard let self, !self.isQuitting else { return }
            self.cachedAgentExecutableURL = nil
            switch result {
            case .success:
                self.agentAuthStatus = .unauthorized
                self.authorizeAgentAction()
            case .failure(let error):
                self.pendingProxyStartAfterAuthorization = false
                self.agentAuthStatus = .error(error.localizedDescription)
            }
        }
        if codexInstaller.isRunning { agentAuthStatus = .installing }
        showProxyDetailsAction()
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
        // Replace only the former shipped default; keep every custom address.
        if readConfiguredApolloURL() == CLIProvider.legacyApolloURL {
            try writeEnvValue(defaultApolloURL, forKey: "APOLLO_AGENT_URL", to: overridesURL)
            try writeEnvValue(defaultApolloURL, forKey: "APOLLO_AGENT_URL", to: envURL)
        }

        if !fm.fileExists(atPath: logURL.path) {
            fm.createFile(atPath: logURL.path, contents: Data())
        }
    }

    private func installEmbeddedProxy() throws {
        let embeddedURL = Bundle.main.resourceURL?.appendingPathComponent("embedded-proxy", isDirectory: true)
        guard let embeddedURL else {
            throw NSError(
                domain: "ApolloProxyControl",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "embedded-proxy is missing in app resources"]
            )
        }

        try ProxyRuntimeInstaller.install(source: embeddedURL, destination: proxyInstallURL)
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
            return "Укажите полный адрес AlfaGen."
        }

        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil, url.user == nil, url.password == nil,
              url.fragment == nil, !value.contains(where: { $0.isWhitespace }) else {
            return "Укажите полный http:// или https:// адрес без пробелов, логина и пароля."
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

    private func applyAlfaGenURL(_ value: String) {
        guard selectedProvider == .alfagen, !proxyHasActiveWork, !isExternalProxyRunning,
              agentAuthProcess == nil, !knowledgeCommandRunning, status != .starting else { return }
        do {
            try saveApolloURL(value)
            refreshUI()
            if process != nil {
                stopManagedProxy(restart: true)
            }
        } catch {
            showError("Не удалось сохранить адрес AlfaGen", error.localizedDescription)
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
        guard !isQuitting, process == nil else { return }
        let alreadyPending = startRequest.pending
        let token = startRequest.request(knowledgeRunning: knowledgeCommandRunning || codeCommandRunning || updateCheck.isRunning)
        status = .starting
        if knowledgeCommandRunning && !alreadyPending {
            appendLog("=== \(Date()) Proxy start queued until own knowledge operation finishes ===\n")
        }
        guard let token else { return }
        checkHealth { [weak self] running in
            guard let self else { return }
            guard self.startRequest.checked(token, running: running, knowledgeRunning: self.knowledgeCommandRunning || self.codeCommandRunning || self.updateCheck.isRunning),
                  !self.isQuitting, self.process == nil else { return }
            self.launchManagedProxy()
        }
    }

    private func launchManagedProxy() {
        guard !isQuitting, process == nil else { return }

        do {
            try ensureProxyInstalled()
            knowledgeRuntime = try knowledgeCommandRunner().runSynchronously("ensure")
        } catch {
            status = .error("Setup failed")
            appendLog("=== \(Date()) Proxy preparation failed: \(error.localizedDescription) ===\n")
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

        if isAgentConfigured() {
            guard case .authorized = agentAuthStatus else {
                pendingProxyStartAfterAuthorization = true
                if agentAuthStatus != .checking && agentAuthStatus != .authorizing && agentAuthStatus != .installing { showProxyDetailsAction() }
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
        task.arguments = ["scripts/code-launcher.js"]
        task.currentDirectoryURL = proxyInstallURL
        task.standardOutput = pipe
        task.standardError = pipe
        var environment = ProcessInfo.processInfo.environment
        for key in ["CODEX_MODEL", "CLAUDE_MODEL"] { environment[key] = readEnvMap()?[key] ?? "" }
        if let binary = resolveAgentExecutableURL() { environment[selectedProvider.binaryKey] = binary.path }
        if let runtime = knowledgeRuntime,
           let current = runtime.current,
           let designSystemRoot = runtime.designSystemRoot,
           let dsAiHubRoot = runtime.dsAiHubRoot {
            environment["CODEX_DESIGN_SYSTEM"] = designSystemRoot
            environment["CODEX_DS_AI_HUB"] = dsAiHubRoot
            environment["APOLLO_KNOWLEDGE_CONTENT_VERSION"] = current.knowledgeVersion ?? current.contentVersion
            if let root = runtime.dataRoot { environment["APOLLO_DATA_ROOT"] = root }
            if let root = runtime.releaseRoot { environment["APOLLO_RELEASE_ROOT"] = root }
            if let commit = current.sourceCommits?["design-system_ab"] ?? nil {
                environment["APOLLO_KNOWLEDGE_DESIGN_SYSTEM_COMMIT"] = commit
            }
            if let commit = current.sourceCommits?["ds-ai-hub"] ?? nil {
                environment["APOLLO_KNOWLEDGE_DS_AI_HUB_COMMIT"] = commit
            }
        }
        let bundledData = proxyInstallURL.appendingPathComponent("runtime/data", isDirectory: true)
        let bundledProject = proxyInstallURL.appendingPathComponent("runtime/apollo", isDirectory: true)
        if FileManager.default.fileExists(atPath: bundledData.appendingPathComponent("manifest.json").path),
           FileManager.default.fileExists(atPath: bundledProject.appendingPathComponent("dist/runtime.cjs").path) {
            let config = readEnvMap() ?? [:]
            for (key, fallback) in [("APOLLO_DATA_ROOT", bundledData.path), ("APOLLO_PROJECT_ROOT", bundledProject.path)] {
                if environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false,
                   config[key]?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
                    environment[key] = fallback
                }
            }
        }
        task.environment = environment
        let lifetime = ProxyProcessLifecycle.connectParentLifetime(to: task)
        lifetimePipe = lifetime
        task.terminationHandler = { [weak self] process in
            Task { @MainActor in
                guard let self, self.process === process else { return }
                self.outputPipe?.fileHandleForReading.readabilityHandler = nil
                self.outputPipe = nil
                try? self.lifetimePipe?.fileHandleForWriting.close()
                self.lifetimePipe = nil
                self.process = nil
                let intentionalStop = self.isStoppingIntentionally
                self.isStoppingIntentionally = false
                let shouldRestart = !self.isQuitting && intentionalStop && self.pendingRestartAfterStop
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
                    self.codeRestartPending = false
                    self.expectedCodeReleaseID = nil
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
            try? lifetime.fileHandleForWriting.close()
            lifetimePipe = nil
            process = nil
        }
    }

    @objc private func stopProxyAction() {
        stopManagedProxy()
    }

    private func runCodeCommand(_ command: String, onFailure: (@MainActor (Error) -> Void)? = nil, completion: @escaping @MainActor (CodeReleaseStatus) -> Void) {
        guard !codeCommandRunning, !knowledgeCommandRunning, let node = resolveNodeExecutableURL() else {
            onFailure?(KnowledgeCommandError.failed("Не удалось запустить проверку кода. Повторите позже."))
            return
        }
        codeCommandRunning = true
        refreshUI()
        var environment = ProcessInfo.processInfo.environment
        if let token = readEnvMap()?["APOLLO_CODE_TOKEN"], !token.isEmpty { environment["APOLLO_CODE_TOKEN"] = token }
        do {
            codeCommandProcess = try CodeReleaseCommandRunner(nodeURL: node, homeURL: proxyInstallURL, environment: environment).run(command) { [weak self] result in
                Task { @MainActor in
                    guard let self, !self.isQuitting else { return }
                    self.codeCommandProcess = nil; self.codeCommandRunning = false
                    self.refreshUI()
                    switch result {
                    case .success(let value):
                        self.codeReleaseStatus = value
                        self.codeCheckError = nil
                        completion(value)
                    case .failure(let error):
                        self.codeRestartPending = false
                        if let onFailure { onFailure(error) }
                        else { self.showError("Не удалось обновить код прокси", error.localizedDescription) }
                    }
                    self.refreshUI()
                    if self.startRequest.pending && !self.updateCheck.isRunning { self.startProxyAction() }
                }
            }
        } catch {
            codeCommandRunning = false
            refreshUI()
            if let onFailure { onFailure(error) }
            else { showError("Не удалось обновить код прокси", error.localizedDescription) }
        }
    }

    private func applyCodeUpdate(_ command: String) {
        guard !isExternalProxyRunning, status != .starting, agentAuthProcess == nil, !codexInstaller.isRunning,
              !updateCheck.isRunning, !codeCommandRunning, !knowledgeCommandRunning,
              !codeRestartPending, !pendingKnowledgeRestart, let value = codeReleaseStatus else { return }
        let action: CodeReleaseAction = command == "rollback" ? .rollback : .update
        guard CodeReleasePresentation(status: value).actions.contains(action), codeCheckError == nil else { return }
        guard !proxyHasActiveWork else {
            showError("Прокси занят", codeReleaseMessage("CODE_PROXY_BUSY")); return
        }
        if action == .rollback {
            let alert = NSAlert()
            alert.messageText = "Откатить код прокси?"
            alert.informativeText = "Прокси вернётся к версии \(value.previous?.label ?? ""). Настройки, история и знания сохранятся."
            alert.addButton(withTitle: "Откатить"); alert.addButton(withTitle: "Отмена")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        runCodeCommand(command) { result in
            guard result.restartRequired == true else { return }
            self.codeRestartPending = true; self.expectedCodeReleaseID = result.pending?.id
            if self.process != nil { self.stopManagedProxy(restart: true) }
            else { self.startProxyAction() }
        }
    }

    private func stopManagedProxy(restart: Bool = false) {
        startRequest.cancel()
        pendingRestartAfterStop = restart && process != nil
        pendingProxyStartAfterAuthorization = false
        pendingKnowledgeRestart = false
        guard let process else {
            status = .stopped
            return
        }
        isStoppingIntentionally = true
        appendLog("=== \(Date()) Stopping proxy ===\n")
        ProxyProcessLifecycle.requestStop(process, lifetime: lifetimePipe)

        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
            // Only force-stop the process for which termination was requested.
            // A knowledge update may already have launched its replacement by
            // the time this timeout fires.
            if process.isRunning {
                Darwin.kill(process.processIdentifier, SIGKILL)
            }
        }
    }

    @objc private func toggleProxyAction() {
        if process != nil || status == .starting { stopProxyAction() } else { startProxyAction() }
    }

    @objc private func checkUpdatesAction() {
        showProxyDetailsAction()
        checkForUpdates()
    }

    @objc func showTokenJournalAction() {
        if tokenJournalController == nil {
            let state = readEnvMap()?["APOLLO_STATE_ROOT"].flatMap { $0.isEmpty ? nil : $0 }
            let root = state.map { URL(fileURLWithPath: $0) } ?? proxyInstallURL.appendingPathComponent(".local")
            tokenJournalController = TokenJournalWindowController(root: root.appendingPathComponent("token-journal"))
        }
        tokenJournalController?.present()
    }

    @objc func showProxyDetailsAction() {
        if detailsController == nil {
            let controller = ProxyDetailsWindowController()
            controller.onAction = { [weak self] action in
                guard let self else { return }
                switch action {
                case .login: self.authorizeAgentAction()
                case .checkAccess: self.checkAgentAccessAction()
                case .installCLI: NSWorkspace.shared.open(self.selectedProvider.installationURL)
                case .checkUpdates: self.checkForUpdates()
                case .updateCode: self.applyCodeUpdate("update")
                case .rollbackCode: self.applyCodeUpdate("rollback")
                case .updateKnowledge: self.updateKnowledgeAction()
                case .rollbackKnowledge: self.rollbackKnowledgeAction()
                case .editURL: self.editApolloURLAction()
                case .resetURL: self.applyAlfaGenURL(defaultApolloURL)
                case .editModel: self.editModelAction()
                case .refreshModels: self.refreshModelCatalog()
                case .openConfiguration: self.openEnvAction()
                case .openLogs: self.openLogsAction()
                case .openFolder: self.openProxyFolderAction()
                }
            }
            controller.onProviderChange = { [weak self] provider in self?.selectAgent(provider) }
            controller.onModelChange = { [weak self] model in self?.selectModel(model) }
            controller.onKnowledgeSourceChange = { [weak self] source in
                guard let self, source != self.readConfiguredKnowledgeSource() else { return }
                self.switchKnowledgeSourceAction()
                self.refreshUI()
            }
            detailsController = controller
        }
        refreshUI()
        detailsController?.present()
        refreshModelCatalog()
    }

    private func cancelModelCatalog() {
        modelCatalogTimer?.invalidate(); modelCatalogTimer = nil
        if let task = modelCatalogProcess, task.isRunning { task.terminate() }
        modelCatalogProcess = nil
    }

    private func refreshModelCatalog() {
        guard selectedProvider == .codex, modelCatalogProcess == nil, !isQuitting,
              case .authorized = agentAuthStatus else { return }
        guard let binary = resolveAgentExecutableURL(), let node = resolveNodeExecutableURL() else { return }
        let task = Process(), output = Pipe(), errors = Pipe(), buffer = LockedDataBuffer()
        task.executableURL = node
        task.arguments = [proxyInstallURL.appendingPathComponent("scripts/list-agent-models.js").path, binary.path]
        task.environment = buildAgentEnvironment()
        task.standardOutput = output; task.standardError = errors
        output.fileHandleForReading.readabilityHandler = { buffer.append($0.availableData) }
        errors.fileHandleForReading.readabilityHandler = { _ = $0.availableData }
        task.terminationHandler = { [weak self] finished in
            output.fileHandleForReading.readabilityHandler = nil
            errors.fileHandleForReading.readabilityHandler = nil
            buffer.append(output.fileHandleForReading.readDataToEndOfFile())
            let data = buffer.snapshot()
            Task { @MainActor in
                guard let self, self.modelCatalogProcess === finished else { return }
                self.modelCatalogTimer?.invalidate(); self.modelCatalogTimer = nil
                self.modelCatalogProcess = nil
                struct Catalog: Decodable { let models: [AgentModelChoice] }
                if finished.terminationStatus == 0,
                   let catalog = try? JSONDecoder().decode(Catalog.self, from: data),
                   catalog.models.count <= 1000,
                   catalog.models.allSatisfy({ !$0.id.isEmpty && CLIProvider.validModel($0.id) }) {
                    self.codexModelChoices = catalog.models
                    self.modelCatalogError = ""
                } else {
                    self.modelCatalogError = "Не удалось обновить список. Повторите попытку или укажите ID модели."
                }
                self.refreshUI()
            }
        }
        do {
            modelCatalogProcess = task; try task.run()
            modelCatalogTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak task] _ in
                if let task, task.isRunning { task.terminate() }
            }
            refreshUI()
        } catch {
            output.fileHandleForReading.readabilityHandler = nil
            errors.fileHandleForReading.readabilityHandler = nil
            modelCatalogProcess = nil
            modelCatalogError = "Не удалось обновить список. Повторите попытку или укажите ID модели."
            refreshUI()
        }
    }

    private func selectModel(_ rawValue: String) {
        guard selectedProvider.usesCLI else { return }
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard CLIProvider.validModel(value) else {
            showError("Некорректный ID модели", "Укажите ID модели без пробелов и переносов строк.")
            refreshUI(); return
        }
        guard value != configuredModel else { refreshUI(); return }
        guard agentAuthProcess == nil, !codexInstaller.isRunning, !knowledgeCommandRunning,
              !proxyHasActiveWork, !isExternalProxyRunning, status != .starting else { refreshUI(); return }
        do {
            try ensureProxyInstalled()
            let key = selectedProvider.modelKey
            try writeEnvValue(value, forKey: key, to: overridesURL)
            try writeEnvValue(value, forKey: key, to: proxyInstallURL.appendingPathComponent(".env"))
            if process != nil {
                stopManagedProxy(restart: true)
            }
            refreshUI()
        } catch { showError("Не удалось сохранить модель", error.localizedDescription); refreshUI() }
    }

    private func editModelAction() {
        guard selectedProvider.usesCLI else { return }
        let input = PasteFriendlyTextField(frame: NSRect(x: 0, y: 0, width: 420, height: 28))
        input.stringValue = configuredModel
        input.placeholderString = "ID модели"
        let alert = NSAlert()
        alert.messageText = "Модель для \(selectedProvider.name)"
        alert.informativeText = "Укажите ID модели из документации провайдера. Пустое поле вернёт настройку по умолчанию. Работающий прокси перезапустится."
        alert.accessoryView = input
        alert.addButton(withTitle: "Сохранить"); alert.addButton(withTitle: "Отмена")
        if alert.runModal() == .alertFirstButtonReturn { selectModel(input.stringValue) }
        else { refreshUI() }
    }

    private func selectAgent(_ provider: CLIProvider) {
        guard provider != selectedProvider else { return }
        guard agentAuthProcess == nil, !codexInstaller.isRunning, !knowledgeCommandRunning, !proxyHasActiveWork, !isExternalProxyRunning, status != .starting else {
            refreshUI()
            return
        }
        claudeLoginTimer?.invalidate(); claudeLoginTimer = nil
        cancelModelCatalog()
        pendingProxyStartAfterAuthorization = false
        do {
            try ensureProxyInstalled()
            try writeEnvValue(provider.rawValue, forKey: "APOLLO_CLI_PROVIDER", to: overridesURL)
            try writeEnvValue(provider.rawValue, forKey: "APOLLO_CLI_PROVIDER",
                              to: proxyInstallURL.appendingPathComponent(".env", isDirectory: false))
            cachedAgentExecutableURL = nil
            agentAuthStatus = .checking
            let wasRunning = process != nil
            checkAgentAuthorization(startProxyWhenReady: wasRunning)
            if wasRunning {
                stopManagedProxy(restart: true)
            }
            refreshUI()
        } catch { showError("Не удалось сменить агент", error.localizedDescription); refreshUI() }
    }

    @objc private func editApolloURLAction() {
        guard selectedProvider == .alfagen, !proxyHasActiveWork, !isExternalProxyRunning else { return }
        do {
            try ensureProxyInstalled()
        } catch {
            showError("Не удалось открыть настройки AlfaGen", error.localizedDescription)
            return
        }

        let currentValue = readConfiguredApolloURL() ?? defaultApolloURL
        let inputField = PasteFriendlyTextField(frame: NSRect(x: 0, y: 0, width: 720, height: 28))
        inputField.placeholderString = "https://…/api/v1/run/…"
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
        alert.messageText = "Адрес AlfaGen"
        alert.informativeText = "Адрес сохраняется на этом Mac. Работающий прокси перезапустится, чтобы применить изменение."
        alert.accessoryView = accessoryView
        alert.addButton(withTitle: "Сохранить")
        alert.addButton(withTitle: "Отмена")
        NSApp.activate(ignoringOtherApps: true)

        guard alert.runModal() == .alertFirstButtonReturn else {
            return
        }

        let newValue = inputField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if let validationError = validateApolloURLInput(newValue) {
            showError("Некорректный адрес AlfaGen", validationError)
            return
        }

        applyAlfaGenURL(newValue)
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
                stopManagedProxy(restart: true)
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

    func prepareForTermination() {
        guard !isQuitting else { return }
        isQuitting = true
        startRequest.cancel()
        let modelTask = modelCatalogProcess
        cancelModelCatalog()
        codexInstaller.cancel()
        healthTimer?.invalidate()
        knowledgeTimer?.invalidate()
        claudeLoginTimer?.invalidate()
        authCheckTimer?.invalidate()
        detailsController?.close()
        tokenJournalController?.close()
        pendingRestartAfterStop = false
        pendingProxyStartAfterAuthorization = false
        pendingKnowledgeRestart = false
        isStoppingIntentionally = true
        try? lifetimePipe?.fileHandleForWriting.close()
        let children = [process, agentAuthProcess, modelTask, codeCommandProcess].compactMap { $0 }
        if !ProxyProcessLifecycle.stopAndWait(children) {
            appendLog("=== \(Date()) A child process did not exit after SIGKILL ===\n")
        }
        outputPipe?.fileHandleForReading.readabilityHandler = nil
        outputPipe = nil
        lifetimePipe = nil
        process = nil
        agentAuthProcess = nil
    }

    @objc private func quitAction() {
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
        if CommandLine.arguments.contains("--show-about") { manager.showProxyDetailsAction() }
        if CommandLine.arguments.contains("--show-tokens") { manager.showTokenJournalAction() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationWillTerminate(_ notification: Notification) {
        manager?.prepareForTermination()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
