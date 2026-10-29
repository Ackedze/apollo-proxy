import AppKit

@MainActor
final class EditingProbe: NSResponder {
    var commands: [String] = []
    @objc func cut(_ sender: Any?) { commands.append("x") }
    @objc func copy(_ sender: Any?) { commands.append("c") }
    @objc func paste(_ sender: Any?) { commands.append("v") }
    override func selectAll(_ sender: Any?) { commands.append("a") }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let probe = EditingProbe()
app.nextResponder = probe
func key(_ value: String) -> NSEvent {
    NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command, timestamp: 0,
        windowNumber: 0, context: nil, characters: value, charactersIgnoringModifiers: value,
        isARepeat: false, keyCode: 0)!
}
assert(app.mainMenu == nil)
AppEditingMenu.install()
let edit = app.mainMenu!.items.last!.submenu!
assert(edit.items.map(\.keyEquivalent) == ["x", "c", "v", "a"])
assert(edit.items.allSatisfy { $0.target == nil && $0.keyEquivalentModifierMask == .command })
for command in ["v", "a", "c", "x"] { assert(edit.performKeyEquivalent(with: key(command))) }
assert(probe.commands == ["v", "a", "c", "x"])

let prior = NSMenu()
prior.addItem(NSMenuItem(title: "Existing", action: nil, keyEquivalent: ""))
app.mainMenu = prior
assert(!prior.performKeyEquivalent(with: key("v")))
AppEditingMenu.install()
assert(app.mainMenu === prior && prior.items.first?.title == "Existing")

let controller = DataActivationWindowController()
let window = controller.window!
@MainActor func descendants(_ view: NSView) -> [NSView] { [view] + view.subviews.flatMap(descendants) }
let field = descendants(window.contentView!).compactMap { $0 as? NSSecureTextField }.first!
assert((field.cell as! NSSecureTextFieldCell).echosBullets)
assert(window.makeFirstResponder(field))
let editor = field.currentEditor() as! NSTextView
let board = NSPasteboard.withUniqueName()
defer { board.releaseGlobally() }
let secret = String(repeating: "Long+paste/Пример=", count: 8)
board.setString(secret, forType: .string)
assert(editor.readSelection(from: board, type: .string))
editor.selectAll(nil)
board.clearContents(); board.setString(secret + "replacement", forType: .string)
assert(editor.readSelection(from: board, type: .string))
window.endEditing(for: field)
assert(field.stringValue == secret + "replacement")
let button = descendants(window.contentView!).compactMap { $0 as? NSButton }.first!
var submitted: String?
controller.onActivate = { submitted = $0 }
button.performClick(nil)
assert(submitted == secret + "replacement")
assert(field.stringValue.isEmpty && !field.isEnabled && !button.isEnabled)
controller.showError("Retry")
assert(field.isEnabled && button.isEnabled)
window.close()
print("editing shortcuts PASS")
