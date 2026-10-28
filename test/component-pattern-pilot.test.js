'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), zlib = require('node:zlib'), vm = require('node:vm');
const base = require('../src/reports/progressbar-pilot'), pilot = require('../src/reports/component-pattern-pilot');
const clone = value => JSON.parse(JSON.stringify(value)), key = value => crypto.createHash('sha1').update(value).digest('hex');
function png() {
  const crc = bytes => { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => { const b = Buffer.alloc(body.length + 12); b.writeUInt32BE(body.length); b.write(type, 4); body.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4); return b; };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-patterns-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { designSystemRoot: path.join(root, 'ds'), hubRoot: path.join(root, 'hub'), knowledgeRelease: { contentVersion: 'synthetic-v2', sourceCommits: {} } };
  const contracts = new Map();
  const write = async (file, content) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
  for (const profile of pilot.PROFILES) {
    const rules = pilot.RULES.filter(rule => rule.profile === profile.id);
    const blocks = rules.map((rule, i) => '### Rule ' + (i + 1) + ': Synthetic normative rule\n- ruleId: ' + rule.id
      + '\n- checkType: llm\n- severity: ' + rule.severity + '\n\nComplete synthetic norm and exception.\n');
    const body = Array.from({ length: 10 }, (_, i) => '## Section ' + (i + 1) + ': Synthetic\n\n'
      + (i === 5 ? blocks.join('\n') + '\n### Rule 99: Unselected\n- ruleId: rule:unselected\n- checkType: deterministic\n- severity: error\nUnselected rule body.\n' : 'Synthetic context and exceptions.\n')).join('\n');
    await write(path.join(options.designSystemRoot, profile.path), '- patternId: ' + profile.patternId + '\n- status: active\n\n' + body);
    await write(path.join(options.hubRoot, profile.hub), '---\nid: ' + profile.patternId + '\nstatus: verified\n---\n\n'
      + (profile.requiresSourcePath ? '- sourcePath: ' + profile.path + '\n\n' : '') + body);
    for (const identity of profile.identities) {
      const rows = identity.ids.map(id => {
        const normalizedName = id.split('.')[0], componentKey = key(id);
        const properties = normalizedName.startsWith('progress-bar') ? { State: 'First' } : normalizedName.startsWith('button') ? { SingleIcon: 'False' }
          : normalizedName.startsWith('icon-button') ? { Size: '56' } : {};
        const c = { id, normalizedName, componentKey, role: 'main', status: 'active', platform: id.split('.')[1], source: { library: 'Synthetic library' },
          figma: { variants: { variantKeys: [{ key: normalizedName === 'amount' ? componentKey : key(id + ':variant'), properties }] } } };
        contracts.set(id, c); return c;
      });
      await write(path.join(options.designSystemRoot, identity.path), JSON.stringify({ contracts: rows, opaqueCatalogBody: 'Never send catalog bodies to the model.' }));
    }
  }
  function capture(entries) {
    const nodes = [{ id: '1:1', parentId: null, type: 'FRAME', name: 'Synthetic area', visible: true },
      { id: '1:2', parentId: '1:1', type: 'TEXT', name: 'Context', visible: true, text: 'Сумма, ₽' }];
    entries.forEach((entry, i) => {
      const c = contracts.get(entry.contract), n = (i + 1) * 10;
      const variant = c.figma.variants.variantKeys[0], id = '1:' + n;
      nodes.push({ id, parentId: entry.parent || '1:1', type: 'INSTANCE', name: entry.name || 'Renamed layer', visible: true,
        component: { key: variant.key, setKey: c.normalizedName === 'amount' ? null : c.componentKey, name: c.normalizedName, variants: clone(variant.properties) } });
      nodes.push({ id: '1:' + (n + 1), parentId: id, type: 'TEXT', name: 'Label', visible: true, text: entry.text || 'Synthetic visible content' });
    });
    const value = { schemaVersion: 'apollo.progressbar-capture.v1', captureId: 'synthetic-v2-capture', capturedAt: new Date().toISOString(),
      pageId: '0:1', rootId: '1:1', fileKey: null, complete: true, excludedHidden: 0, nodes,
      screenshot: { nodeId: '1:1', mimeType: 'image/png', dataBase64: png().toString('base64') } };
    value.fingerprint = base.sha(base.stable(value)); return value;
  }
  return { root, options, contracts, capture, write };
}
function payload(capture) { return { report: { reportKind: 'apollo-pattern-audit-report', pilot: pilot.PILOT, reportId: capture.captureId, phase: 'prepare', capture, sourcePin: null } }; }
function rehash(value) { delete value.fingerprint; value.fingerprint = base.sha(base.stable(value)); return value; }
function answer(packet) {
  return { schemaVersion: pilot.RESULT_SCHEMA, reportId: packet.reportId, captureId: packet.captureId, sourcePin: packet.sourcePin,
    assessments: packet.subjects.map(subject => ({ nodeId: subject.nodeId, outcome: 'compliant', observation: 'Synthetic declared observation.',
      reason: 'Protocol fixture, not a model evaluation.', evidenceNodeIds: [subject.nodeId], ruleIds: subject.ruleIds,
      ruleResults: subject.ruleIds.map(ruleId => ({ ruleId, outcome: 'compliant', reason: 'Synthetic declared result.', evidenceNodeIds: [subject.nodeId] })),
      sourceRefs: subject.ruleIds.map(ruleId => ({ ruleId, sourceId: 'canonical-' + subject.profile,
        sha256: packet.sources.find(source => source.sourceId === 'canonical-' + subject.profile).sha256 })) })) };
}
function updateEvidence(item) { item.evidenceNodeIds = Array.from(new Set(item.ruleResults.flatMap(rule => rule.evidenceNodeIds))); }
const mixed = [
  { contract: 'progress-bar-goal.desktop' }, { contract: 'amount.universal' },
  { contract: 'button.desktop' }, { contract: 'icon-button.desktop' },
];
test('mixed v2 resolves all six exact rules from published identities and does not send raw catalogs or unrelated rule bodies', async t => {
  const f = await fixture(t), input = payload(f.capture(mixed)), original = clone(input), packet = await base.preparePilot(input, f.options);
  assert.equal(base.isProgressBarPilot(input), true); assert.equal(base.isPilotPacket(packet), true);
  assert.deepEqual(packet.subjects.map(s => s.family), ['progressbar', 'amount', 'button', 'icon-button']);
  assert.deepEqual(packet.subjects.map(s => s.ruleIds.length), [2, 2, 1, 1]); assert.equal(packet.requestedRuleIds.length, 6);
  assert.deepEqual(input, original); assert.equal(JSON.stringify(packet).includes('Never send catalog bodies'), false);
  assert.equal(JSON.stringify(packet).includes('Unselected rule body.'), false);
  assert.ok(packet.sources.some(s => s.documentExcerpt?.includes('Complete synthetic norm and exception.')));
  assert.ok(packet.sources.some(s => s.documentExcerpt?.includes('## Section 10:')));
  assert.ok(packet.sources.filter(s => s.sourceId.startsWith('hub-')).every(s => !s.document && s.equivalentRuleIds && !s.equivalentTo));
  const result = base.validatePilotResponse(answer(packet), packet);
  assert.equal(result.pilot, pilot.PILOT); assert.equal(result.assessments.length, 4); assert.equal(result.scope.ruleResults.length, 6);
  assert.equal(result.assessments[1].library, 'Synthetic library'); assert.equal(result.deterministicFindingsIncluded, false);
});
test('singleton Amount, all retained desktop/mobile identities and renamed layers use exact native keys and variants', async t => {
  const f = await fixture(t);
  for (const contract of f.contracts.keys()) {
    const packet = await base.preparePilot(payload(f.capture([{ contract, name: 'Not an identity hint' }])), f.options);
    assert.equal(packet.subjects.length, 1, contract); assert.equal(packet.subjects[0].contractId, contract);
    if (contract === 'amount.universal') assert.equal(packet.subjects[0].componentSetKey, null);
  }
  for (const mutate of [
    c => { c.nodes[2].component.key = 'f'.repeat(40); },
    c => { c.nodes[2].component.variants.SingleIcon = 'True'; },
    c => { c.nodes[2].component.setKey = null; },
  ]) {
    const c = f.capture([{ contract: 'button.desktop' }]); mutate(c);
    await assert.rejects(base.preparePilot(payload(rehash(c)), f.options), /PATTERN_.*UNRESOLVED/);
  }
  const unknown = f.capture([{ contract: 'amount.universal' }]); unknown.nodes[2].component.key = 'e'.repeat(40);
  await assert.rejects(base.preparePilot(payload(rehash(unknown)), f.options), /IDENTITY_UNRESOLVED/);
});
test('nested governed Amount/IconButton parts do not become duplicate semantic subjects', async t => {
  const f = await fixture(t), packet = await base.preparePilot(payload(f.capture([
    { contract: 'progress-bar-goal.desktop' }, { contract: 'amount.universal', parent: '1:10' },
    { contract: 'button.desktop' }, { contract: 'icon-button.desktop', parent: '1:30' },
  ])), f.options);
  assert.deepEqual(packet.subjects.map(s => s.family), ['progressbar', 'button']);
  assert.deepEqual(packet.requestedRuleIds, pilot.RULES.filter(rule => ['progressbar', 'button'].includes(rule.family)).map(rule => rule.id));
  assert.equal(packet.capture.nodes.length, 10);
});
test('Amount peer context is admitted only for the currency rule; Goal and action evidence stays within its subject/context', async t => {
  const f = await fixture(t), packet = await base.preparePilot(payload(f.capture([
    { contract: 'amount.universal' }, { contract: 'amount.universal' }, { contract: 'progress-bar-goal.desktop' }, { contract: 'progress-bar-limit.desktop' },
  ])), f.options);
  const allowed = answer(packet), currency = allowed.assessments[0].ruleResults.find(rule => rule.ruleId.endsWith('table-currency-not-duplicated'));
  currency.evidenceNodeIds.push('1:2', '1:20', '1:21'); updateEvidence(allowed.assessments[0]);
  assert.doesNotThrow(() => base.validatePilotResponse(allowed, packet));
  for (const [subjectIndex, ruleIndex, peer] of [[0, 0, '1:20'], [2, 0, '1:40'], [0, 1, '1:30']]) {
    const bad = answer(packet); bad.assessments[subjectIndex].ruleResults[ruleIndex].evidenceNodeIds.push(peer); updateEvidence(bad.assessments[subjectIndex]);
    assert.throws(() => base.validatePilotResponse(bad, packet), /FOREIGN_CONTEXT/);
  }
  const unknown = answer(packet); unknown.assessments[0].ruleResults[1].evidenceNodeIds.push('9:9'); updateEvidence(unknown.assessments[0]);
  assert.throws(() => base.validatePilotResponse(unknown, packet), /RESPONSE_INVALID/);
});
test('per-subject RuleIDs, per-rule evidence, source hashes and subject accounting remain closed', async t => {
  const f = await fixture(t), packet = await base.preparePilot(payload(f.capture(mixed)), f.options);
  for (const mutate of [
    r => { r.assessments.pop(); }, r => { r.assessments.push(clone(r.assessments[0])); },
    r => { r.assessments[1].ruleIds = packet.subjects[0].ruleIds; },
    r => { r.assessments[1].ruleResults.pop(); }, r => { r.assessments[1].ruleResults[0].evidenceNodeIds = ['1:2']; },
    r => { r.assessments[1].evidenceNodeIds.push('1:2'); },
    r => { r.assessments[1].sourceRefs[0].sourceId = 'canonical-buttons'; },
    r => { r.assessments[1].sourceRefs[0].sha256 = 'a'.repeat(64); },
    r => { r.assessments[1].ruleResults[0].outcome = 'violation'; },
    r => { r.assessments[1].severity = 'warning'; },
  ]) {
    const result = answer(packet); mutate(result);
    assert.throws(() => base.validatePilotResponse(result, packet), /PATTERN_RESPONSE_/);
  }
});
test('warning versus error comes from the selected canonical rule, not the model', async t => {
  const f = await fixture(t), packet = await base.preparePilot(payload(f.capture(mixed)), f.options), result = answer(packet);
  for (const i of [1, 3]) { result.assessments[i].outcome = 'violation'; result.assessments[i].ruleResults[0].outcome = 'violation'; }
  const checked = base.validatePilotResponse(result, packet);
  assert.equal(checked.assessments[1].severity, 'error'); assert.equal(checked.assessments[3].severity, 'warning');
});
test('only eligible norm documents are required; unselected mirror drift is not full-body equivalence', async t => {
  const f = await fixture(t), button = pilot.PROFILES.find(p => p.id === 'buttons');
  const mirror = path.join(f.options.hubRoot, button.hub);
  await fs.appendFile(mirror, '\nUnrelated mirror-only content.\n');
  const packet = await base.preparePilot(payload(f.capture([{ contract: 'button.desktop' }])), f.options);
  assert.deepEqual(packet.requestedRuleIds, [pilot.RULES.find(rule => rule.family === 'button').id]);
  assert.equal(packet.sources.find(s => s.sourceId === 'hub-buttons').equivalentRuleIds.length, 1);
  assert.equal(packet.sources.find(s => s.sourceId === 'hub-buttons').equivalentTo, undefined);
  await fs.writeFile(mirror, (await fs.readFile(mirror, 'utf8')).replace('Complete synthetic norm and exception.', 'Changed selected normative rule.'));
  await assert.rejects(base.preparePilot(payload(f.capture([{ contract: 'button.desktop' }])), f.options), /LINKED_RULE_DRIFT/);
  await fs.rm(path.join(f.options.designSystemRoot, button.path));
  assert.equal((await base.preparePilot(payload(f.capture([{ contract: 'amount.universal' }])), f.options)).subjects[0].family, 'amount');
});
test('prepare/run and post-model source checks pin all consumed bytes and the current knowledge revision', async t => {
  const f = await fixture(t), input = payload(f.capture(mixed)), packet = await base.preparePilot(input, f.options);
  const changed = Object.assign({}, f.options, { knowledgeRelease: { contentVersion: 'other-version' } });
  input.report.phase = 'run'; input.report.sourcePin = packet.sourcePin;
  await assert.rejects(base.preparePilot(input, changed), /SOURCE_STALE/);
  await assert.rejects(base.assertSourceCurrent(packet, changed), /SOURCE_STALE/);
  const file = path.join(f.options.designSystemRoot, pilot.PROFILES[1].identities[0].path);
  await fs.appendFile(file, '\n'); await assert.rejects(base.assertSourceCurrent(packet, f.options), /SOURCE_STALE/);
});
test('verified mirror identity is required; explicit wrong links and missing legacy ProgressBar links refuse', async t => {
  for (const kind of ['wrong-id', 'unverified', 'wrong-explicit-link', 'missing-progressbar-link']) {
    const f = await fixture(t), profile = pilot.PROFILES[kind === 'missing-progressbar-link' ? 0 : 1];
    const file = path.join(f.options.hubRoot, profile.hub); let source = await fs.readFile(file, 'utf8');
    if (kind === 'wrong-id') source = source.replace('id: ' + profile.patternId, 'id: ptrn:foreign');
    if (kind === 'unverified') source = source.replace('status: verified', 'status: draft');
    if (kind === 'wrong-explicit-link') source += '\n- sourcePath: patterns/foreign.md\n';
    if (kind === 'missing-progressbar-link') source = source.replace('- sourcePath: ' + profile.path + '\n', '');
    await fs.writeFile(file, source);
    const contract = kind === 'missing-progressbar-link' ? 'progress-bar-goal.desktop' : 'amount.universal';
    await assert.rejects(base.preparePilot(payload(f.capture([{ contract }])), f.options), /SOURCE_AUTHORITY_INVALID/);
  }
});
test('invalid capture and unavailable authority refuse before paid work; empty subjects have a separate v2 schema', async t => {
  const f = await fixture(t), bad = f.capture(mixed); bad.complete = false;
  await assert.rejects(base.preparePilot(payload(rehash(bad)), f.options), /CAPTURE_INCOMPLETE/);
  const c = f.capture([{ contract: 'amount.universal' }]); c.nodes[2].component = { key: 'e'.repeat(40), setKey: null, name: 'Other', variants: {} };
  const packet = await base.preparePilot(payload(rehash(c)), f.options); assert.equal(packet.subjects.length, 0);
  assert.deepEqual(packet.requestedRuleIds, []); assert.doesNotThrow(() => base.validatePilotResponse(answer(packet), packet));
  assert.equal(base.resultSchemaFor(packet), pilot.RESULT_SCHEMA); assert.equal(base.schemaFileFor(packet), 'component-pattern-pilot.schema.json');
  assert.equal(base.resultSchemaFor({ transport: { mode: base.PILOT } }), 'apollo.progressbar-assessment.v1');
  assert.equal(base.schemaFileFor({ transport: { mode: base.PILOT } }), 'progressbar-pilot.schema.json');
  await fs.mkdir(path.join(f.options.designSystemRoot, '.git'));
  await assert.rejects(base.preparePilot(payload(f.capture(mixed)), f.options), /CHECKOUT_KNOWLEDGE_FORBIDDEN/);
});
test('existing file preparation retains one actual PNG and the bounded read-only v2 prompt', async t => {
  const f = await fixture(t), dir = path.join(f.root, 'run'); await fs.mkdir(dir);
  const prepared = await base.preparePilotFiles(payload(f.capture(mixed)), dir, f.options);
  assert.equal(prepared.imagePaths.length, 1); assert.deepEqual(await fs.readFile(prepared.imagePaths[0]), png());
  const prompt = base.promptForPilot(prepared.requestDocument);
  assert.match(prompt, /untrustedComponentPatternData/); assert.match(prompt, /insufficient-data/);
  assert.match(prompt, /SingleIcon=True/); assert.match(prompt, /equivalentRuleIds/);
  assert.equal(JSON.stringify(prepared.requestDocument).includes('dataBase64'), false);
  const schema = JSON.parse(await fs.readFile(path.join(__dirname, '../src/reports', base.schemaFileFor(prepared.requestDocument)), 'utf8'));
  assert.equal(schema.properties.schemaVersion.const, pilot.RESULT_SCHEMA);
});
test('actual packet caller routes v1 and v2 through the fixed pilot prompt and keeps one model packet', async t => {
  const f = await fixture(t), packet = await base.preparePilot(payload(f.capture(mixed)), f.options);
  const box = { exports: {} }, stubs = new Set(['../config', './semantic', './request', './response', './process']);
  const load = id => { if (stubs.has(id)) return {}; if (id === './progressbar-pilot') return base; if (id.startsWith('node:')) return require(id); throw Error('Unexpected producer read: ' + id); };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../src/reports/packets.js'), 'utf8'), { module: box, exports: box.exports, require: load, Buffer });
  assert.equal(box.exports.buildPatternAuditPassPackets(packet).length, 1);
  assert.match(box.exports.buildCodexPrompt('owned-request.json', 'pattern-report', {}, {}, 'packet', packet), /untrustedComponentPatternData/);
  const legacy = { transport: { mode: base.PILOT } };
  assert.match(box.exports.buildCodexPrompt('owned-request.json', 'pattern-report', {}, {}, 'packet', legacy), /untrustedProgressBarData/);
  const unknown = { transport: { mode: 'unaccepted-pilot' } };
  assert.equal(base.isPilotPacket(unknown), false);
  assert.doesNotMatch(box.exports.buildCodexPrompt('owned-request.json', 'pattern-report', {}, {}, 'packet', unknown), /untrustedComponentPatternData|untrustedProgressBarData/);
  const invalid = payload(f.capture(mixed)); invalid.report.pilot = 'unaccepted-pilot';
  assert.notEqual(base.validatePilotRequest(invalid), null);
});
