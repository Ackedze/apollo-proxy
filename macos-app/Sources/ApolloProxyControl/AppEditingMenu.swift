import AppKit

@MainActor
enum AppEditingMenu {
    static func install() {
        let main = NSApp.mainMenu ?? NSMenu()
        let edit = NSMenu(title: "Правка")
        for (title, action, key) in [
            ("Вырезать", #selector(NSText.cut(_:)), "x"),
            ("Копировать", #selector(NSText.copy(_:)), "c"),
            ("Вставить", #selector(NSText.paste(_:)), "v"),
            ("Выделить всё", #selector(NSText.selectAll(_:)), "a")
        ] {
            edit.addItem(withTitle: title, action: action, keyEquivalent: key)
        }
        let item = NSMenuItem(title: edit.title, action: nil, keyEquivalent: "")
        item.submenu = edit
        main.addItem(item)
        NSApp.mainMenu = main
    }
}
