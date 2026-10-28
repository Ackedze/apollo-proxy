import AppKit

@MainActor
final class ProxyUpdatesWindowController: NSWindowController, NSWindowDelegate {
    private final class DocumentView: NSView {
        override var isFlipped: Bool { true }
    }
    enum Action: Hashable { case check, updateApp, updateKnowledge, rollbackKnowledge }
    var onAction: ((Action) -> Void)?

    private let appVersion = NSTextField(wrappingLabelWithString: "")
    private let knowledgeVersion = NSTextField(wrappingLabelWithString: "")
    private let appStatus = NSTextField(wrappingLabelWithString: "")
    private let knowledgeStatus = NSTextField(wrappingLabelWithString: "")
    private let progress = NSProgressIndicator()
    private var buttons: [Action: NSButton] = [:]

    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 540, height: 450),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Обновления Apollo Proxy"
        window.minSize = NSSize(width: 500, height: 400)
        window.isReleasedWhenClosed = false
        super.init(window: window)
        window.delegate = self
        buildContent()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func present(attachedTo parent: NSWindow) {
        guard let window else { return }
        if window.sheetParent == nil { parent.beginSheet(window) }
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    override func close() {
        if let window, let parent = window.sheetParent { parent.endSheet(window) }
        super.close()
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool { close(); return false }

    func update(_ state: ProxyDetailsSnapshot) {
        appVersion.stringValue = "Установлена \(state.version)"
        knowledgeVersion.stringValue = "Версия: \(state.displayedKnowledgeVersion)"
        knowledgeVersion.toolTip = state.knowledgeVersion
        appStatus.stringValue = state.codeStatus
        knowledgeStatus.stringValue = state.knowledgeStatus
        buttons[.check]?.isEnabled = state.canCheckUpdates
        buttons[.check]?.title = state.checkingUpdates ? "Проверяем…" : "Проверить обновления"
        buttons[.updateApp]?.isEnabled = state.canUpdateCode
        buttons[.updateKnowledge]?.isEnabled = state.canUpdate
        buttons[.rollbackKnowledge]?.isEnabled = state.canRollback
        if state.checkingUpdates { progress.startAnimation(nil) }
        else { progress.stopAnimation(nil) }
    }

    private func buildContent() {
        guard let content = window?.contentView else { return }
        let closeButton = NSButton(title: "Закрыть", target: self, action: #selector(dismiss))
        closeButton.bezelStyle = .rounded
        closeButton.keyEquivalent = "\u{1b}"
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        progress.style = .spinning
        progress.controlSize = .small
        progress.isDisplayedWhenStopped = false
        progress.setAccessibilityLabel("Проверяем обновления приложения и знаний")
        let footer = NSStackView(views: [button("Проверить обновления", .check), progress, spacer, closeButton])
        footer.spacing = 8
        footer.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(footer)
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(scroll)
        NSLayoutConstraint.activate([
            footer.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            footer.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            footer.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -20),
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: content.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -16)])
        let document = DocumentView()
        document.translatesAutoresizingMaskIntoConstraints = false
        scroll.documentView = document
        let stack = NSStackView()
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 24
        stack.translatesAutoresizingMaskIntoConstraints = false
        document.addSubview(stack)
        NSLayoutConstraint.activate([
            document.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            stack.leadingAnchor.constraint(equalTo: document.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: document.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: document.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: document.bottomAnchor, constant: -20)])
        func section(_ title: String, version: NSTextField, status: NSTextField, actions: [NSButton]) {
            let heading = NSTextField(labelWithString: title)
            heading.font = .systemFont(ofSize: 15, weight: .semibold)
            version.font = .systemFont(ofSize: 12); version.textColor = .secondaryLabelColor
            status.font = .systemFont(ofSize: 13)
            for label in [version, status] {
                label.isSelectable = true; label.maximumNumberOfLines = 0
                label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            }
            let row = NSStackView(views: actions); row.spacing = 8
            let group = NSStackView(views: [heading, version, status, row])
            group.orientation = .vertical; group.alignment = .leading; group.spacing = 8
            stack.addArrangedSubview(group)
            group.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
            for label in [version, status] { label.widthAnchor.constraint(equalTo: group.widthAnchor).isActive = true }
        }
        section("Приложение", version: appVersion, status: appStatus,
                actions: [button("Обновить приложение…", .updateApp)])
        section("Знания", version: knowledgeVersion, status: knowledgeStatus,
                actions: [button("Обновить знания", .updateKnowledge), button("Откатить знания", .rollbackKnowledge)])
        let help = NSTextField(wrappingLabelWithString: "Обновления устанавливаются по вашему нажатию. При обновлении приложения Proxy перезапустится; настройки и история сохранятся.")
        help.font = .systemFont(ofSize: 12); help.textColor = .secondaryLabelColor
        help.maximumNumberOfLines = 0
        stack.addArrangedSubview(help)
        help.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
    }

    private func button(_ title: String, _ action: Action) -> NSButton {
        let control = NSButton(title: title, target: self, action: #selector(performAction(_:)))
        control.bezelStyle = .rounded
        buttons[action] = control
        return control
    }

    @objc private func dismiss() { close() }
    @objc private func performAction(_ sender: NSButton) {
        if let action = buttons.first(where: { $0.value === sender })?.key { onAction?(action) }
    }
}
