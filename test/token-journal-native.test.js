const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createTokenJournal, mountJournalRoutes } = require('../src/token-journal');
test('native token window reads durable records, shows unknown/zero distinctly and remains usable at both sizes', { skip: process.platform !== 'darwin', timeout: 60000 }, t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-token-ui-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let time = Date.now() - 10000;
  const directory = path.join(root, 'journal'), journal = createTokenJournal(directory, { now: () => time });
  for (const [operation, tokens] of [['Спросить', 1200], ['Проверить', 0], ['Навык · Переименовать слои', null]]) {
    const row = journal.begin(operation);
    journal.within(row, () => {
      if (tokens !== 0) { const call = journal.call({ provider: 'codex' }); if (tokens) call.event({ type: 'turn.completed', usage: { input_tokens: 1000, output_tokens: 200 } }); call.end(); }
    });
    time += 2345; journal.finish(row, tokens === null ? 'failed' : 'completed'); time += 1;
  }
  let local;mountJournalRoutes({get(){},post:(name,fn)=>{local=fn;}},journal);
  const insert=body=>local({body},{status(){return this;},json(value){assert.equal(value.success,true);}});
  insert({id:'hybrid',operation:'pattern-check',startedAt:new Date(time).toISOString(),durationMs:123,status:'completed',usageMode:'separate'});
  insert({id:'running',operation:'reglyph-scan',startedAt:new Date(time+1).toISOString(),durationMs:null,status:'running',usageMode:'none'});
  const fixture = path.join(root, 'main.swift'), binary = path.join(root, 'native');
  fs.writeFileSync(fixture, String.raw`
import AppKit
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let root = URL(fileURLWithPath: CommandLine.arguments[1])
let snapshot = TokenJournalSnapshot.read(root)
assert(snapshot.records.count == 5 && snapshot.unreadable == 0 && snapshot.error == nil)
assert(snapshot.records.contains { $0.totalTokens == 0 } && snapshot.records.contains { $0.totalTokens == nil })
let controller = TokenJournalWindowController(root: root)
controller.update(snapshot)
let window = controller.window!, content = window.contentView!
@MainActor func descendants(_ v: NSView) -> [NSView] { [v] + v.subviews.flatMap(descendants) }
let table = descendants(content).compactMap { $0 as? NSTableView }.first!
assert(table.tableColumns.map(\.title) == ["Операция", "Время запуска", "Длительность", "Потрачено токенов"])
assert(table.numberOfRows == 5)
assert(window.title == "Статистика")
for row in 0..<5 {
 let view = controller.tableView(table, viewFor: table.tableColumns[3], row: row) as! NSTableCellView
 let value = view.textField!.stringValue
 if snapshot.records[row].totalTokens == nil { assert(value == "Нет данных") }
 if snapshot.records[row].totalTokens == 0 { assert(value == "0") }
 if snapshot.records[row].usageMode == "separate" { assert(view.toolTip!.contains("Токены учтены в отдельных запросах")) }
}
let total = descendants(content).compactMap { $0 as? NSTextField }.first { $0.accessibilityIdentifier() == "token-total" }!
assert(total.stringValue.contains("200"))
window.orderFrontRegardless()
for appearance in [NSAppearance.Name.aqua, .darkAqua] {
 window.appearance = NSAppearance(named: appearance)
 for width in [760, 1000] {
  window.setContentSize(NSSize(width: width, height: 520))
  content.layoutSubtreeIfNeeded(); RunLoop.current.run(until: Date().addingTimeInterval(0.1))
  assert(table.tableColumns.count == 4 && !total.hasAmbiguousLayout)
  if let capture = ProcessInfo.processInfo.environment["APOLLO_TOKEN_UI_CAPTURE_ROOT"] {
   let bitmap = content.bitmapImageRepForCachingDisplay(in: content.bounds)!
   content.cacheDisplay(in: content.bounds, to: bitmap)
   let file = URL(fileURLWithPath: capture).appendingPathComponent("tokens-\(width)-\(appearance.rawValue).png")
   try bitmap.representation(using: .png, properties: [:])!.write(to: file)
  }
 }
}
controller.update(TokenJournalSnapshot())
assert(table.numberOfRows == 0 && total.stringValue.contains("0"))
controller.update(TokenJournalSnapshot(error: "Не удалось прочитать журнал"))
assert(total.stringValue == "Расход недоступен")
window.close()
print("token UI PASS")
`);
  const sources = path.resolve(__dirname, '../macos-app/Sources/ApolloProxyControl');
  execFileSync('/usr/bin/swiftc', ['-swift-version', '6', '-module-cache-path', path.join(root, 'cache'), path.join(sources, 'TokenJournalWindow.swift'), fixture, '-o', binary], { timeout: 40000 });
  assert.match(execFileSync(binary, [directory], { encoding: 'utf8', timeout: 15000 }), /token UI PASS/);
});
