const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');

test('native agent settings expose three providers and a readonly AlfaGen pane', {skip: process.platform !== 'darwin', timeout: 60000}, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-settings-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const fixture = path.join(root, 'main.swift');
  fs.writeFileSync(fixture, String.raw`
import AppKit
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let controller = ProxyDetailsWindowController()
@MainActor func descendants(_ view: NSView) -> [NSView] { [view] + view.subviews.flatMap(descendants) }
let content = controller.window!.contentView!
let views = descendants(content)
let picker = views.compactMap { $0 as? NSSegmentedControl }.first!
let modelPicker = views.compactMap { $0 as? NSPopUpButton }.first { $0.accessibilityLabel() == "Модель AI-агента" }!
let url = views.compactMap { $0 as? NSTextField }.first { $0.accessibilityLabel() == "Адрес AlfaGen" }!
let edit = views.compactMap { $0 as? NSButton }.first { $0.title == "Изменить адрес…" }!
let reset = views.compactMap { $0 as? NSButton }.first { $0.title == "По умолчанию" }!
let login = views.compactMap { $0 as? NSButton }.first { $0.title == "Войти" }!
assert(picker.segmentCount == 3 && picker.label(forSegment: 2) == "AlfaGen")
assert(!views.compactMap { $0 as? NSTextField }.contains { $0.stringValue == "Сервер Apollo" })
assert(CLIProvider.alfagen.candidates(configured: "/fixture/bin", home: "/fixture").isEmpty)
assert(CLIProvider.codex.modelKey == "CODEX_MODEL" && CLIProvider.claude.modelKey == "CLAUDE_MODEL")
assert(CLIProvider.codex.modelChoices.isEmpty && CLIProvider.claude.modelChoices.map(\.id) == ["sonnet", "opus", "haiku"])
for value in ["", "fixture-model", "claude-version@20261022", "sonnet[1m]", "arn:aws:bedrock:region:model/version"] { assert(CLIProvider.validModel(value)) }
for value in ["--model", "bad model", "sonnet\n", "x\ny", String(repeating: "a", count: 257)] { assert(!CLIProvider.validModel(value)) }
var state = ProxyDetailsSnapshot()
state.version = "v1.4.0 · build fixture"
state.status = "Прокси работает · порт 3001"
state.knowledgeVersion = String(repeating: "1234567890", count: 7)
state.knowledgeStatus = "Установлена актуальная версия знаний"
state.sourceCommits = "design-system_ab: " + String(repeating: "a", count: 40) + "\nds-ai-hub: " + String(repeating: "b", count: 40)
for provider in CLIProvider.allCases {
 state.provider = provider; state.apolloURL = CLIProvider.defaultAlfaGenURL
 state.modelChoices = provider.modelChoices
 state.authorization = "Вход выполнен"; state.authorizationHelp = "Вход выполняется через официальный CLI и ваш аккаунт."
 controller.update(state); content.layoutSubtreeIfNeeded()
 assert(picker.selectedSegment == CLIProvider.allCases.firstIndex(of: provider)!)
 assert(url.isHiddenOrHasHiddenAncestor == provider.usesCLI)
 assert(login.isHiddenOrHasHiddenAncestor == !provider.usesCLI)
 assert(modelPicker.isHiddenOrHasHiddenAncestor == !provider.usesCLI)
 assert(!url.isEditable && url.isSelectable)
 assert(edit.isEnabled && !reset.isEnabled)
}
state.provider = .alfagen; state.apolloURL = "https://example.test/api/v1/run/custom"; state.canChangeAgent = false
controller.update(state); assert(!picker.isEnabled && !edit.isEnabled && !reset.isEnabled)
state.canChangeAgent = true; controller.update(state); assert(edit.isEnabled && reset.isEnabled)
var actions = [ProxyDetailsWindowController.Action]()
controller.onAction = { actions.append($0) }; edit.performClick(nil); reset.performClick(nil)
assert(actions == [.editURL, .resetURL])
state.provider = .codex; state.modelChoices = [AgentModelChoice(id: "fixture-a", name: "Fixture model")]
state.model = "fixture-a"; controller.update(state)
assert(modelPicker.selectedItem?.representedObject as? String == "fixture-a")
var models = [String](); controller.onModelChange = { models.append($0) }
modelPicker.selectItem(at: 0); modelPicker.sendAction(modelPicker.action!, to: modelPicker.target)
assert(models == [""])
state.model = "fixture-custom"; controller.update(state)
assert(modelPicker.selectedItem?.representedObject as? String == "fixture-custom")
state.modelChoices = [AgentModelChoice(id: "fixture-a", name: "Same"), AgentModelChoice(id: "fixture-b", name: "Same")]
controller.update(state); assert(modelPicker.itemArray.filter { $0.title == "Same" }.count == 2)
state.modelLoading = true; controller.update(state); assert(!modelPicker.isEnabled)
state.modelLoading = false; state.canChangeAgent = false; controller.update(state); assert(!modelPicker.isEnabled)
state.canChangeAgent = true
state.provider = .alfagen; state.apolloURL = CLIProvider.defaultAlfaGenURL; controller.update(state)
for theme in [NSAppearance.Name.aqua, .darkAqua] {
 controller.window!.appearance = NSAppearance(named: theme)
 for width in [520, 760] {
  controller.window!.setContentSize(NSSize(width: width, height: 560))
  content.layoutSubtreeIfNeeded()
  assert(abs(url.frame.width - CGFloat(width - 48)) < 1)
  assert(url.frame.height >= 20 && picker.frame.width <= CGFloat(width - 48))
  assert(!url.hasAmbiguousLayout && !picker.hasAmbiguousLayout)
 }
}
print("native settings PASS")
`);
  const sources = path.resolve(__dirname, '../macos-app/Sources/ApolloProxyControl');
  const binary = path.join(root, 'settings-test');
  execFileSync('/usr/bin/swiftc', ['-swift-version', '6', '-module-cache-path', path.join(root, 'module-cache'),
    path.join(sources, 'AgentCLI.swift'), path.join(sources, 'ProxyDetailsWindow.swift'), fixture, '-o', binary], {timeout: 40000});
  assert.match(execFileSync(binary, {encoding: 'utf8', timeout: 15000}), /native settings PASS/);
});
