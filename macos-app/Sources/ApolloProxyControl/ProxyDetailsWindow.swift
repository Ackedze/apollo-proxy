import AppKit

struct ProxyDetailsSnapshot {
    var version = ""
    var status = ""
    var provider: CLIProvider = .codex
    var authorization = ""
    var authorizationHelp = ""
    var loginTitle = "Войти"
    var canLogin = false
    var canCheckAccess = false
    var canChangeAgent = true
    var cliMissing = false
    var authorizationBusy = false
    var model = ""
    var modelChoices: [AgentModelChoice] = []
    var modelMessage = "Модель применяется к новым запросам."
    var modelLoading = false
    var canRefreshModels = false
    var knowledgeSource = "ds-ai-hub"
    var knowledgeStatus = ""
    var knowledgeVersion = ""
    var sourceCommits = ""
    var canUpdate = false
    var canRollback = false
    var canCheckKnowledge = true
    var apolloURL = ""
}

@MainActor
final class ProxyDetailsWindowController: NSWindowController {
    private final class DocumentView: NSView {
        override var isFlipped: Bool { true }
    }
    enum Action: Hashable { case login, checkAccess, installCLI, checkKnowledge, updateKnowledge, rollbackKnowledge,
                      editURL, resetURL, editModel, refreshModels, openConfiguration, openLogs, openFolder }
    var onAction: ((Action) -> Void)?
    var onProviderChange: ((CLIProvider) -> Void)?
    var onModelChange: ((String) -> Void)?
    var onKnowledgeSourceChange: ((String) -> Void)?

    private let versionLabel = NSTextField(wrappingLabelWithString: "")
    private let statusLabel = NSTextField(wrappingLabelWithString: "")
    private let agentPicker = NSSegmentedControl(labels: CLIProvider.allCases.map(\.name), trackingMode: .selectOne, target: nil, action: nil)
    private let cliSettings = NSStackView()
    private let alfaGenSettings = NSStackView()
    private let modelPicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let modelMessage = NSTextField(wrappingLabelWithString: "")
    private var displayedModels: [AgentModelChoice] = []
    private let authorizationLabel = NSTextField(wrappingLabelWithString: "")
    private let authorizationHelp = NSTextField(wrappingLabelWithString: "")
    private let authorizationProgress = NSProgressIndicator()
    private let knowledgePicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let knowledgeLabel = NSTextField(wrappingLabelWithString: "")
    private let knowledgeVersion = NSTextField(wrappingLabelWithString: "")
    private let sourceCommits = NSTextField(wrappingLabelWithString: "")
    private let urlField = NSTextField(wrappingLabelWithString: "")
    private var buttons: [Action: NSButton] = [:]

    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 720),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "О прокси"
        window.minSize = NSSize(width: 520, height: 560)
        window.isReleasedWhenClosed = false
        super.init(window: window)
        buildContent()
        window.center()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func present() {
        showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    func update(_ state: ProxyDetailsSnapshot) {
        versionLabel.stringValue = state.version
        statusLabel.stringValue = state.status
        agentPicker.selectedSegment = CLIProvider.allCases.firstIndex(of: state.provider) ?? 0
        agentPicker.isEnabled = state.canChangeAgent
        cliSettings.isHidden = !state.provider.usesCLI
        alfaGenSettings.isHidden = state.provider.usesCLI
        var choices = [AgentModelChoice(id: "", name: "По умолчанию (CLI)")] + state.modelChoices
        if !choices.contains(where: { $0.id == state.model }) {
            choices.append(AgentModelChoice(id: state.model, name: state.model))
        }
        if choices != displayedModels {
            displayedModels = choices
            modelPicker.removeAllItems()
            for choice in choices {
                let item = NSMenuItem(title: choice.name, action: nil, keyEquivalent: "")
                item.representedObject = choice.id
                item.toolTip = choice.id
                modelPicker.menu?.addItem(item)
            }
            modelPicker.menu?.addItem(.separator())
            modelPicker.addItem(withTitle: "Указать ID модели…")
        }
        modelPicker.select(modelPicker.itemArray.first { $0.representedObject as? String == state.model })
        modelPicker.isEnabled = state.canChangeAgent && !state.modelLoading
        modelPicker.toolTip = state.model.isEmpty ? "Модель по умолчанию в CLI" : state.model
        modelMessage.stringValue = state.modelMessage
        buttons[.refreshModels]?.isHidden = state.provider != .codex
        buttons[.refreshModels]?.isEnabled = state.canRefreshModels && !state.modelLoading
        authorizationLabel.stringValue = state.authorization
        authorizationHelp.stringValue = state.authorizationHelp
        if state.authorizationBusy { authorizationProgress.startAnimation(nil) }
        else { authorizationProgress.stopAnimation(nil) }
        buttons[.login]?.title = state.loginTitle
        buttons[.login]?.isEnabled = state.canLogin
        buttons[.checkAccess]?.isEnabled = state.canCheckAccess
        buttons[.installCLI]?.isHidden = !state.cliMissing || state.provider == .codex
        knowledgePicker.selectItem(withTitle: state.knowledgeSource)
        knowledgePicker.isEnabled = state.canCheckKnowledge && state.canChangeAgent
        knowledgeLabel.stringValue = state.knowledgeStatus
        knowledgeVersion.stringValue = "Версия: \(state.knowledgeVersion)"
        sourceCommits.stringValue = state.sourceCommits
        sourceCommits.isHidden = state.sourceCommits.isEmpty
        buttons[.checkKnowledge]?.isEnabled = state.canCheckKnowledge
        buttons[.updateKnowledge]?.isEnabled = state.canUpdate
        buttons[.rollbackKnowledge]?.isEnabled = state.canRollback
        urlField.stringValue = state.apolloURL
        buttons[.editURL]?.isEnabled = state.canChangeAgent
        buttons[.resetURL]?.isEnabled = state.canChangeAgent && state.apolloURL != CLIProvider.defaultAlfaGenURL
    }

    private func buildContent() {
        guard let content = window?.contentView else { return }
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(scroll)
        NSLayoutConstraint.activate([scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor), scroll.topAnchor.constraint(equalTo: content.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: content.bottomAnchor)])
        let document = DocumentView()
        document.translatesAutoresizingMaskIntoConstraints = false
        scroll.documentView = document
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 22
        stack.translatesAutoresizingMaskIntoConstraints = false
        document.addSubview(stack)
        NSLayoutConstraint.activate([document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            stack.leadingAnchor.constraint(equalTo: document.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: document.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: document.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: document.bottomAnchor, constant: -24)])
        func section(_ views: [NSView]) {
            let group = NSStackView(views: views)
            group.orientation = .vertical; group.alignment = .leading; group.spacing = 8
            stack.addArrangedSubview(group)
            group.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
            for label in views.compactMap({ $0 as? NSTextField }) {
                label.widthAnchor.constraint(equalTo: group.widthAnchor).isActive = true
            }
        }
        func heading(_ title: String, size: CGFloat = 13) -> NSTextField {
            let label = NSTextField(labelWithString: title)
            label.font = .systemFont(ofSize: size, weight: .semibold)
            return label
        }
        func style(_ label: NSTextField, secondary: Bool = false, selectable: Bool = false) {
            label.font = .systemFont(ofSize: secondary ? 12 : 13)
            label.textColor = secondary ? .secondaryLabelColor : .labelColor
            label.isSelectable = selectable
            label.maximumNumberOfLines = 0
            label.lineBreakMode = .byWordWrapping
            label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        }
        style(versionLabel, secondary: true, selectable: true)
        style(statusLabel)
        section([heading("Apollo Proxy", size: 22), versionLabel, statusLabel])
        agentPicker.target = self; agentPicker.action = #selector(providerChanged)
        agentPicker.setAccessibilityLabel("AI-агент")
        style(authorizationLabel); style(authorizationHelp, secondary: true)
        authorizationProgress.style = .spinning
        authorizationProgress.controlSize = .small
        authorizationProgress.isDisplayedWhenStopped = false
        authorizationProgress.setAccessibilityLabel("Подготовка AI-агента")
        let authorizationRow = row([authorizationProgress, authorizationLabel])
        modelPicker.target = self; modelPicker.action = #selector(modelChanged)
        modelPicker.setAccessibilityLabel("Модель AI-агента")
        modelPicker.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        modelPicker.setContentHuggingPriority(.defaultLow, for: .horizontal)
        style(modelMessage, secondary: true)
        let modelRow = row([modelPicker, button("Обновить список", .refreshModels)])
        for view in [heading("Модель"), modelRow, modelMessage, authorizationRow, authorizationHelp,
                     row([button("Войти", .login), button("Проверить вход", .checkAccess), button("Инструкция установки…", .installCLI)])] {
            cliSettings.addArrangedSubview(view)
        }
        style(urlField, selectable: true)
        urlField.isEditable = false
        urlField.isBezeled = true
        urlField.drawsBackground = true
        urlField.backgroundColor = .textBackgroundColor
        urlField.lineBreakMode = .byCharWrapping
        urlField.setAccessibilityLabel("Адрес AlfaGen")
        let alfaGenHelp = NSTextField(wrappingLabelWithString: "Корпоративный агент для «Спросить». Проверка макета и навыки с AI доступны через Codex или Claude.")
        style(alfaGenHelp, secondary: true)
        for view in [urlField, row([button("Изменить адрес…", .editURL), button("По умолчанию", .resetURL)]), alfaGenHelp] {
            alfaGenSettings.addArrangedSubview(view)
        }
        for group in [cliSettings, alfaGenSettings] {
            group.orientation = .vertical; group.alignment = .leading; group.spacing = 8
        }
        section([heading("AI-агент"), agentPicker, cliSettings, alfaGenSettings])
        for view in [cliSettings, alfaGenSettings, authorizationHelp, urlField, alfaGenHelp, modelRow, modelMessage] {
            view.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }
        authorizationRow.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        knowledgePicker.addItems(withTitles: ["ds-ai-hub", "design-system_ab"])
        knowledgePicker.target = self; knowledgePicker.action = #selector(knowledgeSourceChanged)
        knowledgePicker.setAccessibilityLabel("Источник знаний")
        style(knowledgeLabel); style(knowledgeVersion, secondary: true, selectable: true)
        knowledgeVersion.lineBreakMode = .byCharWrapping
        style(sourceCommits, secondary: true, selectable: true)
        sourceCommits.lineBreakMode = .byCharWrapping
        section([heading("Знания"), knowledgePicker, knowledgeLabel, knowledgeVersion, sourceCommits,
                 row([button("Проверить обновления", .checkKnowledge), button("Обновить", .updateKnowledge), button("Откатить", .rollbackKnowledge)])])
        section([heading("Диагностика"), row([button("Конфигурация…", .openConfiguration), button("Журнал…", .openLogs), button("Папка прокси…", .openFolder)])])
    }

    private func row(_ views: [NSView]) -> NSStackView {
        let row = NSStackView(views: views)
        row.orientation = .horizontal; row.spacing = 8
        return row
    }

    private func button(_ title: String, _ action: Action) -> NSButton {
        let button = NSButton(title: title, target: self, action: #selector(performAction(_:)))
        button.bezelStyle = .rounded
        button.font = .systemFont(ofSize: 13)
        buttons[action] = button
        return button
    }

    @objc private func performAction(_ sender: NSButton) {
        if let action = buttons.first(where: { $0.value === sender })?.key { onAction?(action) }
    }
    @objc private func providerChanged() {
        guard CLIProvider.allCases.indices.contains(agentPicker.selectedSegment) else { return }
        onProviderChange?(CLIProvider.allCases[agentPicker.selectedSegment])
    }
    @objc private func modelChanged() {
        if let model = modelPicker.selectedItem?.representedObject as? String { onModelChange?(model) }
        else { onAction?(.editModel) }
    }
    @objc private func knowledgeSourceChanged() { if let value = knowledgePicker.titleOfSelectedItem { onKnowledgeSourceChange?(value) } }
}
