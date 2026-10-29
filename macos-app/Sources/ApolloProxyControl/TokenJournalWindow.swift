import AppKit

struct TokenJournalRecord: Decodable, Sendable {
    let schemaVersion: String
    let id: String
    let operation: String
    let startedAt: String
    let durationMs: Int64?
    let status: String
    let provider: String?
    let model: String?
    let timeSource: String?
    let usageMode: String?
    let inputTokens: Int64
    let outputTokens: Int64
    let totalTokens: Int64?

    var knownTokens: Int64 { inputTokens.addingReportingOverflow(outputTokens).overflow ? 0 : inputTokens + outputTokens }
    var valid: Bool {
        schemaVersion == "apollo.token-operation.v1" && UUID(uuidString: id) != nil && !operation.isEmpty && operation.count <= 120
            && ["running", "completed", "failed", "cancelled", "interrupted"].contains(status)
            && (usageMode == nil || ["none", "separate"].contains(usageMode!))
            && inputTokens >= 0 && outputTokens >= 0 && !inputTokens.addingReportingOverflow(outputTokens).overflow
            && (totalTokens == nil || totalTokens == knownTokens) && (durationMs == nil || durationMs! >= 0)
    }
}

struct TokenJournalSnapshot: Sendable {
    var records: [TokenJournalRecord] = []
    var unreadable = 0
    var error: String?

    static func read(_ root: URL) -> TokenJournalSnapshot {
        var result = TokenJournalSnapshot()
        do {
            if !FileManager.default.fileExists(atPath: root.path) { return result }
            let files = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            for file in files where file.pathExtension == "json" {
                do {
                    let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
                    guard values.isRegularFile == true, values.isSymbolicLink != true, (values.fileSize ?? 16385) <= 16384 else { throw CocoaError(.fileReadCorruptFile) }
                    let record = try JSONDecoder().decode(TokenJournalRecord.self, from: Data(contentsOf: file))
                    guard record.valid, file.deletingPathExtension().lastPathComponent == record.id else { throw CocoaError(.fileReadCorruptFile) }
                    result.records.append(record)
                } catch { result.unreadable += 1 }
            }
            result.records.sort { $0.startedAt == $1.startedAt ? $0.id > $1.id : $0.startedAt > $1.startedAt }
        } catch { result.error = "Не удалось прочитать журнал. Нажмите «Обновить», чтобы повторить." }
        return result
    }
}

@MainActor
final class TokenJournalWindowController: NSWindowController, NSTableViewDataSource, NSTableViewDelegate, NSWindowDelegate {
    private final class ContentView: NSView {
        override var isOpaque: Bool { true }
        override func draw(_ dirtyRect: NSRect) {
            NSColor.windowBackgroundColor.setFill()
            dirtyRect.fill()
        }
    }
    private let root: URL
    private let table = NSTableView()
    private let total = NSTextField(labelWithString: "Загружаем журнал…")
    private let summary = NSTextField(wrappingLabelWithString: "")
    private let empty = NSTextField(wrappingLabelWithString: "Здесь появятся новые операции: вопросы, проверки и навыки.")
    private let refreshButton = NSButton(title: "Обновить", target: nil, action: nil)
    private var records: [TokenJournalRecord] = []
    private var timer: Timer?
    private var loading = false
    private let integer: NumberFormatter = { let f = NumberFormatter(); f.numberStyle = .decimal; return f }()
    private let date: DateFormatter = { let f = DateFormatter(); f.dateFormat = "dd.MM.yyyy, HH:mm:ss"; return f }()
    private let iso: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()

    init(root: URL) {
        self.root = root
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 540),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Статистика"
        window.minSize = NSSize(width: 760, height: 380)
        window.isReleasedWhenClosed = false
        window.contentView = ContentView(frame: NSRect(x: 0, y: 0, width: 900, height: 540))
        super.init(window: window)
        window.delegate = self
        buildContent()
        window.center()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func buildContent() {
        guard let content = window?.contentView else { return }
        total.font = .systemFont(ofSize: 16, weight: .semibold)
        total.setAccessibilityIdentifier("token-total")
        summary.font = .systemFont(ofSize: 12)
        summary.textColor = .secondaryLabelColor
        summary.setAccessibilityIdentifier("token-summary")
        refreshButton.target = self; refreshButton.action = #selector(refresh)
        refreshButton.bezelStyle = .rounded
        let header = NSStackView(views: [total, NSView(), refreshButton])
        header.orientation = .horizontal; header.spacing = 16
        for (id, title, width) in [("operation", "Операция", 240.0), ("started", "Время запуска", 180.0),
                                    ("duration", "Длительность", 115.0), ("tokens", "Потрачено токенов", 155.0)] {
            let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier(id))
            column.title = title; column.width = width; column.minWidth = id == "operation" ? 190 : width - 20
            table.addTableColumn(column)
        }
        table.columnAutoresizingStyle = .firstColumnOnlyAutoresizingStyle
        table.usesAlternatingRowBackgroundColors = true
        table.rowHeight = 46; table.intercellSpacing = NSSize(width: 12, height: 2)
        table.dataSource = self; table.delegate = self
        table.setAccessibilityLabel("Журнал расхода токенов")
        let scroll = NSScrollView()
        scroll.documentView = table; scroll.hasVerticalScroller = true; scroll.hasHorizontalScroller = true
        scroll.borderType = .bezelBorder; scroll.autohidesScrollers = true
        empty.alignment = .center; empty.textColor = .secondaryLabelColor
        empty.font = .systemFont(ofSize: 14)
        for view in [header, summary, scroll, empty] { view.translatesAutoresizingMaskIntoConstraints = false; content.addSubview(view) }
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: content.topAnchor, constant: 22),
            header.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            header.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            summary.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 8),
            summary.leadingAnchor.constraint(equalTo: header.leadingAnchor), summary.trailingAnchor.constraint(equalTo: header.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: summary.bottomAnchor, constant: 18),
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            scroll.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -24),
            empty.centerXAnchor.constraint(equalTo: scroll.centerXAnchor), empty.centerYAnchor.constraint(equalTo: scroll.centerYAnchor),
            empty.widthAnchor.constraint(lessThanOrEqualToConstant: 390),
        ])
    }

    func present() {
        showWindow(nil); NSApp.activate(ignoringOtherApps: true); window?.makeKeyAndOrderFront(nil)
        refresh()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    func windowWillClose(_ notification: Notification) { timer?.invalidate(); timer = nil }

    @objc func refresh() {
        guard !loading else { return }
        loading = true; refreshButton.isEnabled = false
        let root = root
        Task { [weak self] in
            let snapshot = await Task.detached { TokenJournalSnapshot.read(root) }.value
            guard let self else { return }
            self.loading = false; self.refreshButton.isEnabled = true
            self.update(snapshot)
        }
    }

    func update(_ snapshot: TokenJournalSnapshot) {
        records = snapshot.records
        var sum: Int64 = 0, overflow = false
        for record in records {
            let next = sum.addingReportingOverflow(record.knownTokens)
            if next.overflow { overflow = true; break }; sum = next.partialValue
        }
        total.stringValue = overflow ? "Расход превышает предел счётчика" : "Учтено \(number(sum)) токенов"
        let missing = records.filter { $0.totalTokens == nil && $0.status != "running" }.count
        let running = records.filter { $0.status == "running" }.count
        summary.stringValue = snapshot.error ?? "Операций: \(records.count) · Без полных данных: \(missing) · Без завершения: \(running). Кеш учтён один раз."
        if snapshot.unreadable > 0 { summary.stringValue += " Не удалось прочитать записей: \(snapshot.unreadable)." }
        empty.isHidden = !records.isEmpty
        empty.stringValue = snapshot.error == nil ? "Здесь появятся новые операции: вопросы, проверки и навыки." : "Журнал сейчас недоступен."
        if snapshot.error != nil { total.stringValue = "Расход недоступен" }
        table.reloadData()
    }

    func numberOfRows(in tableView: NSTableView) -> Int { records.count }
    private func number(_ n: Int64) -> String { integer.string(from: NSNumber(value: n)) ?? String(n) }
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        guard records.indices.contains(row), let id = tableColumn?.identifier.rawValue else { return nil }
        let record = records[row]
        let status = ["running": record.timeSource == "plugin" ? "Завершение не подтверждено" : "Выполняется", "completed": "Завершено", "failed": "Ошибка", "cancelled": "Отменено", "interrupted": "Прервано"][record.status] ?? record.status
        let text: String
        switch id {
        case "operation": text = record.status == "completed" ? record.operation : "\(status) · \(record.operation)"
        case "started": text = iso.date(from: record.startedAt).map { date.string(from: $0) } ?? record.startedAt
        case "duration":
            let ms = record.durationMs ?? (record.status == "running" && record.timeSource != "plugin" ? iso.date(from: record.startedAt).map { Int64(max(0, Date().timeIntervalSince($0) * 1000)) } : nil)
            text = ms.map { $0 < 1000 ? "\($0) мс" : $0 < 60000 ? "\($0 / 1000) с" : "\($0 / 60000) мин \($0 / 1000 % 60) с" } ?? "—"
        default: text = record.totalTokens.map(number) ?? (record.knownTokens > 0 ? "≥ \(number(record.knownTokens))" : record.status == "running" ? (record.timeSource == "plugin" ? "Не подтверждено" : "Выполняется…") : "Нет данных")
        }
        let cell = NSTableCellView()
        let label = NSTextField(labelWithString: text)
        label.font = id == "tokens" || id == "duration" ? .monospacedDigitSystemFont(ofSize: 13, weight: .regular) : .systemFont(ofSize: 13)
        label.lineBreakMode = .byTruncatingTail
        label.alignment = id == "tokens" ? .right : .left
        label.translatesAutoresizingMaskIntoConstraints = false
        cell.addSubview(label); cell.textField = label
        NSLayoutConstraint.activate([label.centerYAnchor.constraint(equalTo: cell.centerYAnchor), label.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 5), label.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -5)])
        let origin = record.timeSource == "plugin" ? (record.usageMode == "separate" ? "Итог запуска" : "Локально · без модели") : "\(record.provider ?? "Неизвестный агент") · \(record.model ?? "Модель по умолчанию")"
        let usage = record.usageMode == "separate" ? "Токены учтены в отдельных запросах агента; эта итоговая строка не добавляет расход повторно." : "Входные: \(number(record.inputTokens)), выходные: \(number(record.outputTokens))"
        cell.toolTip = "\(record.operation) · \(status)\n\(origin)\n\(usage)\(record.timeSource == "plugin" ? "\nДлительность измерена в плагине." : "")\(record.totalTokens == nil && record.usageMode != "separate" ? "\nСтатистика неполная; учтены только переданные агентом значения." : "")"
        return cell
    }
}
