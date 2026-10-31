'use strict';
const fs = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), zlib = require('node:zlib'), vm = require('node:vm');
const base = require('../../src/reports/progressbar-pilot'), pilot = require('../../src/reports/component-pattern-pilot');
const clone = value => JSON.parse(JSON.stringify(value)), key = value => crypto.createHash('sha1').update(value).digest('hex');
function png() {
  const crc = bytes => { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => { const b = Buffer.alloc(body.length + 12); b.writeUInt32BE(body.length); b.write(type, 4); body.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4); return b; };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
async function fixture(t, mode = pilot.PILOT) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-patterns-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { designSystemRoot: path.join(root, 'ds'), hubRoot: path.join(root, 'hub'), knowledgeRelease: { contentVersion: 'synthetic-v2', sourceCommits: {} } };
  const contracts = new Map();
  const write = async (file, content) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
  for (const profile of pilot.profilesFor(mode)) {
    const rules = pilot.rulesFor(mode).filter(rule => rule.profile === profile.id);
    const blocks = rules.map((rule, i) => '### Rule ' + (i + 1) + ': Synthetic normative rule\n- ruleId: ' + rule.id
      + '\n- checkType: ' + (rule.checkType || 'llm') + '\n- severity: ' + rule.severity + '\n\nComplete synthetic norm and exception.\n');
    if(profile.id==='link'){const selected=new Set(rules.map(rule=>rule.id));for(const entry of require('../../src/reports/link-pattern-context').ROUTING){if(!selected.has(entry.ruleId))blocks.push('### Rule 30: Other Link requirement\n- ruleId: '+entry.ruleId+'\n- checkType: deterministic\n- severity: warning\n\nSynthetic separate requirement.\n');}}
    const body = Array.from({ length: 10 }, (_, i) => '## Section ' + (i + 1) + ': Synthetic\n\n'
      + (i === 5 ? blocks.join('\n') + (profile.id==='link'?'':'\n### Rule 99: Unselected\n- ruleId: rule:unselected\n- checkType: deterministic\n- severity: error\nUnselected rule body.\n') : 'Synthetic context and exceptions.\n')).join('\n');
    await write(path.join(options.designSystemRoot, profile.path), '- patternId: ' + profile.patternId + '\n- status: active\n\n' + body);
    if(profile.hub)await write(path.join(options.hubRoot, profile.hub), '---\nid: ' + profile.patternId + '\nstatus: verified\n---\n\n'
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
function payload(capture, mode = pilot.PILOT, context = {basis:'audit-settings',channel:'ab',platform:'desktop'}) { const report={reportKind:'apollo-pattern-audit-report',pilot:mode,reportId:capture.captureId,phase:'prepare',capture,sourcePin:null};if(mode===pilot.LINK_PILOT)report.context=context;return {report}; }
function rehash(value) { delete value.fingerprint; value.fingerprint = base.sha(base.stable(value)); return value; }
function answer(packet) {
  return { schemaVersion: packet.transport.mode===pilot.LINK_PILOT?pilot.LINK_RESULT_SCHEMA:pilot.RESULT_SCHEMA, reportId: packet.reportId, captureId: packet.captureId, sourcePin: packet.sourcePin,
    assessments: packet.subjects.map(subject => ({ nodeId: subject.nodeId, outcome: 'compliant', observation: 'Synthetic declared observation.',
      reason: 'Protocol fixture, not a model evaluation.', evidenceNodeIds: [subject.nodeId], ruleIds: subject.ruleIds.slice(),
      ruleResults: subject.ruleIds.map(ruleId => ({ ruleId, outcome: 'compliant', reason: 'Synthetic declared result.', evidenceNodeIds: [subject.nodeId] })),
      sourceRefs: subject.ruleIds.map(ruleId => ({ ruleId, sourceId: 'canonical-' + subject.profile,
        sha256: packet.sources.find(source => source.sourceId === 'canonical-' + subject.profile).sha256 })) })) };
}
function updateEvidence(item) { item.evidenceNodeIds = Array.from(new Set(item.ruleResults.flatMap(rule => rule.evidenceNodeIds))); }

module.exports={fixture,payload,rehash,answer,updateEvidence,png};
