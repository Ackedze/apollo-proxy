import AppKit
import Security

enum DataActivationKeychain {
    private static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "com.redpol.apollo-proxy-control") + ".data-access",
        kSecAttrAccount as String: "active"] }
    static func load() throws -> Data? {
        var request = query; request[kSecReturnData as String] = true
        // Startup must not wait invisibly for a system authentication dialog.
        request[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        var value: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &value)
        if status == errSecItemNotFound || status == errSecInteractionNotAllowed { return nil }
        guard status == errSecSuccess else { throw failure() }
        return value as? Data
    }
    static func save(key: String, keyID: String) throws -> Data {
        guard key.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              keyID.range(of: "^[a-f0-9-]{36}$", options: .regularExpression) != nil else { throw failure() }
        let bytes = try JSONSerialization.data(withJSONObject: ["key": key, "keyId": keyID])
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: bytes] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query; item[kSecValueData as String] = bytes
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw failure() }
        } else if status != errSecSuccess { throw failure() }
        return bytes
    }
    private static func failure() -> Error { NSError(domain: "ApolloDataAccess", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Не удалось сохранить доступ в «Связке ключей». Повторите активацию."]) }
}

@MainActor
final class DataActivationWindowController: NSWindowController {
    var onActivate: ((String) -> Void)?
    private let password = NSSecureTextField()
    private let message = NSTextField(wrappingLabelWithString: "")
    private let button = NSButton(title: "Активировать", target: nil, action: nil)
    private let progress = NSProgressIndicator()
    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 440, height: 300),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = "Активация Apollo"; window.isReleasedWhenClosed = false
        super.init(window: window)
        let title = NSTextField(labelWithString: "Активировать Apollo")
        title.font = .systemFont(ofSize: 20, weight: .semibold)
        let help = NSTextField(wrappingLabelWithString: "Введите корпоративный пароль, чтобы загрузить данные дизайн-системы. Получите пароль у владельца Apollo.")
        help.font = .systemFont(ofSize: 13); help.maximumNumberOfLines = 0
        password.placeholderString = "Корпоративный пароль"; password.setAccessibilityLabel("Корпоративный пароль")
        password.target = self; password.action = #selector(submit)
        message.font = .systemFont(ofSize: 12); message.maximumNumberOfLines = 0
        message.stringValue = "Пароль понадобится один раз. Доступ сохранится в «Связке ключей» этого Mac."
        message.textColor = .secondaryLabelColor
        button.target = self; button.action = #selector(submit); button.bezelStyle = .rounded; button.keyEquivalent = "\r"
        progress.style = .spinning; progress.controlSize = .small; progress.isDisplayedWhenStopped = false
        progress.setAccessibilityLabel("Загрузка данных Apollo")
        let actions = NSStackView(views: [progress, button]); actions.spacing = 12
        let stack = NSStackView(views: [title, help, password, message, actions])
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: window.contentView!.bottomAnchor, constant: -24),
            password.widthAnchor.constraint(equalTo: stack.widthAnchor),help.widthAnchor.constraint(equalTo: stack.widthAnchor),message.widthAnchor.constraint(equalTo: stack.widthAnchor)])
        window.center()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func present() { showWindow(nil); NSApp.activate(ignoringOtherApps: true); window?.makeKeyAndOrderFront(nil); window?.makeFirstResponder(password) }
    func showError(_ text: String) {
        password.isEnabled = true; button.isEnabled = true; progress.stopAnimation(nil)
        message.textColor = .systemRed; message.stringValue = text; window?.makeFirstResponder(password)
    }
    @objc private func submit() {
        guard button.isEnabled else { return }
        let secret = password.stringValue
        guard !secret.isEmpty else { showError("Введите корпоративный пароль."); return }
        password.stringValue = ""; password.isEnabled = false; button.isEnabled = false
        message.textColor = .secondaryLabelColor; message.stringValue = "Загружаем и проверяем данные…"; progress.startAnimation(nil)
        onActivate?(secret)
    }
}
