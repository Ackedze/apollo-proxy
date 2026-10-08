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
                      editURL, openConfiguration, openLogs, openFolder }
    var onAction: ((Action) -> Void)?
    var onProviderChange: ((CLIProvider) -> Void)?
    var onKnowledgeSourceChange: ((String) -> Void)?

    private let versionLabel = NSTextField(wrappingLabelWithString: "")
    private let statusLabel = NSTextField(wrappingLabelWithString: "")
    private let agentPicker = NSSegmentedControl(labels: ["Codex", "Claude"], trackingMode: .selectOne, target: nil, action: nil)
    private let authorizationLabel = NSTextField(wrappingLabelWithString: "")
    private let authorizationHelp = NSTextField(wrappingLabelWithString: "")
    private let knowledgePicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let knowledgeLabel = NSTextField(wrappingLabelWithString: "")
    private let knowledgeVersion = NSTextField(wrappingLabelWithString: "")
    private let sourceCommits = NSTextField(wrappingLabelWithString: "")
    private let urlLabel = NSTextField(wrappingLabelWithString: "")
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
        agentPicker.selectedSegment = state.provider == .codex ? 0 : 1
        agentPicker.isEnabled = state.canChangeAgent
        authorizationLabel.stringValue = state.authorization
        authorizationHelp.stringValue = state.authorizationHelp
        buttons[.login]?.title = state.loginTitle
        buttons[.login]?.isEnabled = state.canLogin
        buttons[.checkAccess]?.isEnabled = state.canCheckAccess
        buttons[.installCLI]?.isHidden = !state.cliMissing
        knowledgePicker.selectItem(withTitle: state.knowledgeSource)
        knowledgePicker.isEnabled = state.canCheckKnowledge && state.canChangeAgent
        knowledgeLabel.stringValue = state.knowledgeStatus
        knowledgeVersion.stringValue = "Версия: \(state.knowledgeVersion)"
        sourceCommits.stringValue = state.sourceCommits
        sourceCommits.isHidden = state.sourceCommits.isEmpty
        buttons[.checkKnowledge]?.isEnabled = state.canCheckKnowledge
        buttons[.updateKnowledge]?.isEnabled = state.canUpdate
        buttons[.rollbackKnowledge]?.isEnabled = state.canRollback
        urlLabel.stringValue = state.apolloURL.isEmpty ? "Адрес сервера Apollo не задан" : state.apolloURL
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
        section([heading("AI-агент"), agentPicker, authorizationLabel, authorizationHelp,
                 row([button("Войти", .login), button("Проверить вход", .checkAccess), button("Установить CLI…", .installCLI)])])
        knowledgePicker.addItems(withTitles: ["ds-ai-hub", "design-system_ab"])
        knowledgePicker.target = self; knowledgePicker.action = #selector(knowledgeSourceChanged)
        knowledgePicker.setAccessibilityLabel("Источник знаний")
        style(knowledgeLabel); style(knowledgeVersion, secondary: true, selectable: true)
        knowledgeVersion.lineBreakMode = .byCharWrapping
        style(sourceCommits, secondary: true, selectable: true)
        sourceCommits.lineBreakMode = .byCharWrapping
        section([heading("Знания"), knowledgePicker, knowledgeLabel, knowledgeVersion, sourceCommits,
                 row([button("Проверить обновления", .checkKnowledge), button("Обновить", .updateKnowledge), button("Откатить", .rollbackKnowledge)])])
        style(urlLabel, secondary: true, selectable: true)
        urlLabel.lineBreakMode = .byCharWrapping
        section([heading("Сервер Apollo"), urlLabel, button("Изменить адрес…", .editURL)])
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
    @objc private func providerChanged() { onProviderChange?(agentPicker.selectedSegment == 0 ? .codex : .claude) }
    @objc private func knowledgeSourceChanged() { if let value = knowledgePicker.titleOfSelectedItem { onKnowledgeSourceChange?(value) } }
}
