'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const pilot = require('../src/reports/component-pattern-pilot'), base = require('../src/reports/progressbar-pilot');
const link = require('../src/reports/link-pattern-context');
const {fixture, payload, answer, updateEvidence} = require('./helpers/component-patterns');
const clone = value => JSON.parse(JSON.stringify(value));
const prepare = (f, entries = [{contract:'link.universal'}], context) => base.preparePilot(payload(f.capture(entries), pilot.LINK_PILOT, context), f.options);

test('Link v3 loads every contextual source rule and preserves an explicit route for all fifteen source rules', async t => {
  const f = await fixture(t, pilot.LINK_PILOT), packet = await prepare(f);
  assert.deepEqual(packet.requestedRuleIds, link.RULES.map(rule => rule.id));
  assert.equal(packet.subjects[0].kind, 'Link'); assert.equal(packet.subjects[0].ruleIds.length, 8);
  const source = packet.sources.find(s => s.sourceId === 'canonical-link');
  assert.equal(source.coverage.routing.length, 15); assert.equal(source.coverage.kind, 'contextual-only');
  assert.ok(source.documentExcerpt.includes('checkType: contextual')); assert.ok(source.documentExcerpt.includes('checkType: dictionary'));
  assert.equal(packet.sources.some(s => s.sourceId === 'hub-link'), false);
  assert.equal(base.resultSchemaFor(packet), pilot.LINK_RESULT_SCHEMA); assert.equal(base.schemaFileFor(packet), 'link-pattern-pilot.schema.json');
  const result = base.validatePilotResponse(answer(packet), packet);
  assert.equal(result.scope.ruleResults.length, 8); assert.equal(result.deterministicFindingsIncluded, false);
  assert.deepEqual(result.declaredContext, packet.declaredContext);
});
test('all source context is pinned; a new or removed Link rule cannot silently escape the full contextual inventory', async t => {
  const f = await fixture(t, pilot.LINK_PILOT), packet = await prepare(f), file = path.join(f.options.designSystemRoot, link.PROFILE.path);
  await fs.appendFile(file, '\nChanged unnumbered context.\n');
  await assert.rejects(base.assertSourceCurrent(packet, f.options), /SOURCE_STALE/);
  await fs.appendFile(file, '\n### Rule 40: New context\n- ruleId: rule:components.link.new-context\n');
  await assert.rejects(prepare(f), /COVERAGE_CHANGED/);
});
test('declared platform/channel are scoped and pinned: unknown is inconclusive, known non-applicability never becomes a false Link violation', async t => {
  const f = await fixture(t, pilot.LINK_PILOT);
  for (const [context, outcome] of [
    [{basis:'audit-settings',channel:'ab',platform:null}, 'insufficient-data'],
    [{basis:'audit-settings',channel:null,platform:'desktop'}, 'insufficient-data'],
    [{basis:'audit-settings',channel:'ab',platform:'mobile-web'}, 'not-applicable'],
    [{basis:'audit-settings',channel:'other',platform:null}, 'not-applicable'],
  ]) {
    const packet = await prepare(f, undefined, context), valid = answer(packet), invalid = answer(packet);
    assert.throws(() => base.validatePilotResponse(invalid, packet), /CONTEXT_SCOPE_INVALID/);
    for (const item of valid.assessments) { item.outcome = outcome; for (const rule of item.ruleResults) rule.outcome = outcome; }
    assert.doesNotThrow(() => base.validatePilotResponse(valid, packet));
  }
  const input = payload(f.capture([{contract:'link.universal'}]), pilot.LINK_PILOT), packet = await base.preparePilot(input, f.options);
  input.report.phase = 'run'; input.report.sourcePin = packet.sourcePin; input.report.context.platform = 'mobile-web';
  await assert.rejects(base.preparePilot(input, f.options), /SOURCE_STALE/);
  input.report.context = {basis:'layer-name',channel:'ab',platform:'desktop'};
  await assert.rejects(base.preparePilot(input, f.options), /REQUEST_INVALID/);
});
test('telephone and ordinary Link keep separate per-occurrence results; another Link cannot supply intent evidence', async t => {
  const f = await fixture(t, pilot.LINK_PILOT), packet = await prepare(f, [
    {contract:'link.universal',text:'8 800 000 00 00'}, {contract:'link.universal',text:'Тарифы'},
  ]), result = answer(packet), ordinary = result.assessments[1];
  ordinary.ruleResults.find(r => r.ruleId.endsWith('no-underline-exception')).outcome = 'violation'; ordinary.outcome = 'violation';
  const checked = base.validatePilotResponse(result, packet);
  assert.equal(checked.assessments[0].outcome, 'compliant'); assert.equal(checked.assessments[1].severity, 'error');
  const wrong = clone(result); wrong.assessments[0].ruleResults[0].evidenceNodeIds.push(packet.subjects[1].nodeId); updateEvidence(wrong.assessments[0]);
  assert.throws(() => base.validatePilotResponse(wrong, packet), /FOREIGN_CONTEXT/);
});
test('a public nested Link remains a subject and may reference its captured host, while service Amount/Button nesting stays governed', async t => {
  const f = await fixture(t, pilot.LINK_PILOT), packet = await prepare(f, [
    {contract:'button.desktop'}, {contract:'link.universal',parent:'1:10'},
  ]);
  assert.deepEqual(packet.subjects.map(s => s.family), ['button','link']);
  const result = answer(packet), item = result.assessments[1];
  item.ruleResults[0].evidenceNodeIds.push('1:10','1:11'); updateEvidence(item);
  assert.doesNotThrow(() => base.validatePilotResponse(result, packet));
});
test('all eight outcomes, exact source pins and warning severity survive validation; missing or forged parts refuse', async t => {
  const f = await fixture(t, pilot.LINK_PILOT), packet = await prepare(f);
  for (const change of [
    r => r.assessments[0].ruleResults.pop(),
    r => r.assessments[0].ruleResults.push(r.assessments[0].ruleResults[0]),
    r => r.assessments[0].ruleIds.pop(),
    r => {r.assessments[0].ruleResults[0].ruleId = 'rule:components.link.url-format';},
    r => {r.assessments[0].sourceRefs[0].sha256 = 'f'.repeat(64);},
    r => {r.assessments[0].ruleResults[0].outcome = 'violation';},
  ]) { const result = answer(packet); change(result); assert.throws(() => base.validatePilotResponse(result, packet), /PATTERN_RESPONSE_/); }
  const result = answer(packet); result.assessments[0].outcome = 'violation';
  result.assessments[0].ruleResults.find(r => r.ruleId.endsWith('punctuation')).outcome = 'violation';
  assert.equal(base.validatePilotResponse(result, packet).assessments[0].severity, 'warning');
});
test('Link prompt preserves context-only scope, uncertainty, punctuation exceptions, host routing and source rules', async t => {
  const f = await fixture(t, pilot.LINK_PILOT), packet = await prepare(f), prompt = base.promptForPilot(packet);
  assert.match(prompt, /восемь/); assert.match(prompt, /exact token identity/); assert.match(prompt, /пунктуации/);
  assert.match(prompt, /Core вариант None/); assert.match(prompt, /не видны по одному PNG/);
  assert.match(prompt, /Имя слоя/); assert.match(prompt, /declaredContext/);
  for (const rule of link.RULES) assert.ok(prompt.includes(rule.id));
  const schema = JSON.parse(await fs.readFile(path.join(__dirname, '../src/reports/link-pattern-pilot.schema.json')));
  assert.equal(schema.properties.assessments.items.properties.ruleResults.maxItems, 8);
});
test('oversized full Link checks fail before agent work rather than truncating the rule list', async t => {
  const f = await fixture(t, pilot.LINK_PILOT);
  await assert.rejects(prepare(f, Array.from({length:9},()=>({contract:'link.universal'}))), /CONTEXT_LIMIT/);
});


test('unmanaged text from a different card cannot prove the purpose of this Link',async t=>{
 const f=await fixture(t,pilot.LINK_PILOT),input=payload(f.capture([{contract:'link.universal'}]),pilot.LINK_PILOT);
 const c=input.report.capture;c.nodes.push({id:'1:200',parentId:c.rootId,type:'FRAME',name:'Other area',visible:true},{id:'1:201',parentId:'1:200',type:'TEXT',name:'Text',text:'Телефон поддержки',visible:true});
 delete c.fingerprint;c.fingerprint=base.sha(base.stable(c));const packet=await base.preparePilot(input,f.options),result=answer(packet);
 result.assessments[0].ruleResults[0].evidenceNodeIds.push('1:201');updateEvidence(result.assessments[0]);
 assert.throws(()=>base.validatePilotResponse(result,packet),/FOREIGN_CONTEXT/);
});


test('V3 resolves all eight Link rules and refuses unresolved standalone or nested Link identities', async t => {
  const f = await fixture(t, pilot.LINK_PILOT);
  assert.equal((await prepare(f)).subjects[0].ruleIds.length, 8);
  for (const entries of [[{contract:'link.universal'}],[{contract:'button.desktop'},{contract:'link.universal',parent:'1:10'}]]) {
    const input = payload(f.capture(entries), pilot.LINK_PILOT);
    const node = input.report.capture.nodes.find(node => node.component?.name === 'link');
    node.component.setKey = 'f'.repeat(40);
    delete input.report.capture.fingerprint; input.report.capture.fingerprint = base.sha(base.stable(input.report.capture));
    await assert.rejects(base.preparePilot(input, f.options), /PATTERN_IDENTITY_UNRESOLVED/);
  }
});

test('V3 prompt and validator allow only the captured ancestor host exception, rejecting sibling and other-Link evidence', async t => {
  const f = await fixture(t, pilot.LINK_PILOT), packet = await prepare(f, [
    {contract:'button.desktop'}, {contract:'link.universal',parent:'1:10'},
    {contract:'button.desktop'}, {contract:'link.universal'},
  ]);
  const prompt = base.promptForPilot(packet);
  assert.match(prompt, /Исключение Link:/);
  assert.match(prompt, /ancestor-host/);
  assert.match(prompt, /subject.contextNodeIds/);
  assert.match(prompt, /sibling-subject и другой Link/);
  assert.doesNotMatch(prompt, /единственное исключение — другие Amount/);
  const valid = answer(packet), item = valid.assessments.find(item => item.nodeId === '1:20');
  item.ruleResults[0].evidenceNodeIds.push('1:10','1:11'); updateEvidence(item);
  assert.doesNotThrow(() => base.validatePilotResponse(valid, packet));
  for (const foreign of ['1:30','1:31','1:40','1:41']) {
    const wrong = clone(valid), current = wrong.assessments.find(item => item.nodeId === '1:20');
    current.ruleResults[0].evidenceNodeIds.push(foreign); updateEvidence(current);
    assert.throws(() => base.validatePilotResponse(wrong, packet), /PATTERN_RESPONSE_FOREIGN_CONTEXT/);
  }
});
