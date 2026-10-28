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
let settings = ProxyDetailsWindowController()
let controller = ProxyUpdatesWindowController()
@MainActor func buttons(_ view: NSView) -> [NSButton] {
    (view as? NSButton).map { [$0] } ?? view.subviews.flatMap(buttons)
}
@MainActor func labels(_ view: NSView) -> [NSTextField] {
    (view as? NSTextField).map { [$0] } ?? view.subviews.flatMap(labels)
}
let settingsControls = buttons(settings.window!.contentView!)
precondition(settingsControls.contains { $0.title == "Обновления…" })
precondition(!settingsControls.contains { $0.title.hasPrefix("Проверить обновлен") || $0.title.hasPrefix("Обновить приложение") || $0.title == "Обновить знания" })
var settingsActions: [ProxyDetailsWindowController.Action] = []
settings.onAction = { settingsActions.append($0) }
settingsControls.first { $0.title == "Обновления…" }!.performClick(nil)
precondition(settingsActions == [.updates])
let controls = buttons(controller.window!.contentView!)
@MainActor func button(_ title: String) -> NSButton { controls.first { $0.title == title }! }
precondition(controls.filter { $0.title.hasPrefix("Проверить обновлен") }.count == 1)
precondition(button("Закрыть").keyEquivalent == "\u{1b}")
var invoked: [ProxyUpdatesWindowController.Action] = []
controller.onAction = { invoked.append($0) }
for (codeAvailable, knowledgeAvailable) in [(false, false), (true, false), (false, true), (true, true)] {
    var state = ProxyDetailsSnapshot()
    state.codeStatus = codeAvailable ? "Доступна версия 1.4.5" : "Установлена актуальная версия"
    state.knowledgeStatus = knowledgeAvailable ? "Доступно обновление знаний" : "Установлена актуальная версия знаний"
    state.canUpdateCode = codeAvailable
    state.canUpdate = knowledgeAvailable
    controller.update(state)
    precondition(button("Проверить обновления").isEnabled)
    precondition(button("Обновить приложение…").isEnabled == codeAvailable)
    precondition(button("Обновить знания").isEnabled == knowledgeAvailable)
    precondition(invoked.isEmpty) // Rendering/check results never start an installation.
}
var state = ProxyDetailsSnapshot()
state.version = "v1.4.4"
state.knowledgeVersion = String(repeating: "9ba5f193", count: 8)
settings.update(state)
precondition(state.displayedKnowledgeVersion == "9ba5f1939ba5")
precondition(labels(settings.window!.contentView!).contains { $0.stringValue == "Версия: 9ba5f1939ba5" && $0.toolTip == state.knowledgeVersion })
state.knowledgeVersion = "Данные ещё не загружены"
precondition(state.displayedKnowledgeVersion == state.knowledgeVersion)
state.knowledgeVersion = "9ba5f1939ba5"
state.codeStatus = "Нет доступа к релизу. Проверьте подключение и повторите проверку."
state.knowledgeStatus = "Доступно обновление знаний"
state.canUpdate = true; state.canRollback = true
controller.update(state)
precondition(!button("Обновить приложение…").isEnabled && button("Обновить знания").isEnabled && button("Откатить знания").isEnabled)
button("Обновить знания").performClick(nil)
button("Откатить знания").performClick(nil)
precondition(invoked == [.updateKnowledge, .rollbackKnowledge])
state.canUpdate = false; state.canRollback = false; state.canCheckUpdates = false; state.checkingUpdates = true
controller.update(state)
precondition(!button("Проверяем…").isEnabled && !button("Обновить знания").isEnabled && !button("Откатить знания").isEnabled)
// Closing/reopening the sheet doesn't install or cancel an ongoing check.
controller.present(attachedTo: settings.window!)
precondition(controller.window!.sheetParent === settings.window)
button("Закрыть").performClick(nil)
RunLoop.current.run(until: Date().addingTimeInterval(0.25))
precondition(settings.window!.attachedSheet == nil)
controller.present(attachedTo: settings.window!)
precondition(controller.window!.sheetParent === settings.window && !button("Проверяем…").isEnabled)
controller.close()
RunLoop.current.run(until: Date().addingTimeInterval(0.25))
precondition(invoked == [.updateKnowledge, .rollbackKnowledge])
state.checkingUpdates = false; state.canCheckUpdates = true
state.codeStatus = String(repeating: "Нет доступа к релизу. Проверьте подключение и повторите проверку. ", count: 4)
controller.update(state)
for appearance in [NSAppearance.Name.aqua, .darkAqua] {
    controller.window?.appearance = NSAppearance(named: appearance)
    for width in [500, 800] {
        controller.window?.setContentSize(NSSize(width: width, height: 400))
        controller.window?.contentView?.layoutSubtreeIfNeeded()
        let content = controller.window!.contentView!
        for control in controls {
            let frame = control.convert(control.bounds, to: content)
            precondition(frame.width > 40 && frame.minX >= 0 && frame.maxX <= content.bounds.width + 1)
        }
    }
}

settings.close()
print("Unified update check PASS")
