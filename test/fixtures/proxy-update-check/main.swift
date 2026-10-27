import AppKit
import Foundation

let sequence = ProxyUpdateCheck()
var events: [String] = []
var finishCode: (@MainActor () -> Void)?
var finishKnowledge: (@MainActor () -> Void)?
sequence.run(code: { done in events.append("code.check"); finishCode = done }, knowledge: { done in
    events.append("knowledge.check"); finishKnowledge = done
}, completion: { events.append("finished") })
precondition(sequence.isRunning && events == ["code.check"])
sequence.run(code: { _ in preconditionFailure("duplicate check") }, knowledge: { _ in
    preconditionFailure("duplicate knowledge check")
}, completion: { preconditionFailure("duplicate completion") })
finishCode?()
precondition(sequence.isRunning && events == ["code.check", "knowledge.check"])
finishKnowledge?()
precondition(!sequence.isRunning && events == ["code.check", "knowledge.check", "finished"])
// Failures and missing descriptors also complete their step; the second channel still runs.
for codeFails in [true, false] {
    var results: [String] = []
    sequence.run(code: { done in results.append(codeFails ? "code.failed" : "code.available"); done() }, knowledge: { done in
        results.append(codeFails ? "knowledge.available" : "knowledge.failed"); done()
    }, completion: { results.append("finished") })
    precondition(results.count == 3 && results.last == "finished" && !sequence.isRunning)
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let controller = ProxyDetailsWindowController()
@MainActor func buttons(_ view: NSView) -> [NSButton] {
    (view as? NSButton).map { [$0] } ?? view.subviews.flatMap(buttons)
}
let controls = buttons(controller.window!.contentView!)
@MainActor func button(_ title: String) -> NSButton { controls.first { $0.title == title }! }
precondition(controls.filter { $0.title.hasPrefix("Проверить обновлен") }.count == 1)
var invoked: [ProxyDetailsWindowController.Action] = []
controller.onAction = { invoked.append($0) }
for (codeAvailable, knowledgeAvailable) in [(false, false), (true, false), (false, true), (true, true)] {
    var state = ProxyDetailsSnapshot()
    state.codeStatus = codeAvailable ? "Доступна версия 1.4.2" : "Установлена актуальная версия"
    state.knowledgeStatus = knowledgeAvailable ? "Доступно обновление знаний" : "Установлена актуальная версия знаний"
    state.canUpdateCode = codeAvailable
    state.canUpdate = knowledgeAvailable
    controller.update(state)
    precondition(button("Проверить обновление").isEnabled)
    precondition(button("Обновить приложение…").isEnabled == codeAvailable)
    precondition(button("Обновить знания").isEnabled == knowledgeAvailable)
    precondition(invoked.isEmpty) // Rendering/check results never start an installation.
}
var state = ProxyDetailsSnapshot()
state.codeStatus = "Нет доступа к релизу в Git. Проверьте доступ к репозиторию."
state.knowledgeStatus = "Доступно обновление знаний"
state.canUpdate = true
controller.update(state)
precondition(!button("Обновить приложение…").isEnabled && button("Обновить знания").isEnabled)
button("Обновить знания").performClick(nil)
precondition(invoked == [.updateKnowledge])
state.canUpdate = false; state.canCheckUpdates = false; state.checkingUpdates = true
controller.update(state)
precondition(!button("Проверить обновление").isEnabled && !button("Обновить знания").isEnabled)
state.codeStatus = String(repeating: "Нет доступа к релизу. Проверьте подключение и повторите проверку. ", count: 4)
controller.update(state)
for appearance in [NSAppearance.Name.aqua, .darkAqua] {
    controller.window?.appearance = NSAppearance(named: appearance)
    for width in [520, 800] {
        controller.window?.setContentSize(NSSize(width: width, height: 560))
        controller.window?.contentView?.layoutSubtreeIfNeeded()
        let scroll = controller.window!.contentView!.subviews.first as! NSScrollView
        let document = scroll.documentView!
        precondition(button("Откатить код…").isHidden)
        for title in ["Проверить обновление", "Обновить приложение…", "Обновить знания", "Откатить знания"] {
            let control = button(title)
            let frame = control.convert(control.bounds, to: document)
            precondition(frame.width > 60 && frame.minX >= 0 && frame.maxX <= document.bounds.width + 1)
        }
    }
}
print("Unified update check PASS")
