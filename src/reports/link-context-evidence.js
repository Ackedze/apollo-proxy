'use strict';
const SCHEMA = 'apollo.link-context-evidence.v1';
const COLOR_PATH = 'JSONS/tokens/001 _ Interface Dynamic Colors.json';
const HOST_PATHS = [
  'web-core/notification/Notification', 'web-core/notification/Plate', 'web-core/core/Tooltip',
  'web-core/core/Checkbox', 'web-corp/TitleView', 'web-corp/IsleBlock', 'web-corp/FAQ', 'web-corp/BackgroundPlate',
].map(path => 'JSONS/web/components/' + path + '/contract.generated.json');
const COLOR_NAMES = ['text/info', 'text/primary', 'text/secondary', 'text_inverted/primary'];
const SUPPORTING_PATTERNS = [
  { path: 'patterns/p_islands.md', id: 'ptrn:layout.islands', rules: ['rule:layout.islands.footer-actions','rule:layout.islands.pseudo-links'] },
  { path: 'patterns/p_faq.md', id: 'ptrn:components.faq', rules: ['rule:components.faq.links-only-in-answer'] },
  { path: 'patterns/p_tooltip_hint.md', id: 'ptrn:controls.tooltip-hint', section: '## Section 5:' },
];
const record = x => !!x && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => record(x) && Object.keys(x).sort().join(',') === keys.split(',').sort().join(',');
const text = (x, max = 1000) => typeof x === 'string' && x.length <= max;
const key = x => typeof x === 'string' && /^[a-f0-9]{40}$/i.test(x);
const unit = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
const color = (x, alpha = false) => exact(x, alpha ? 'r,g,b,a' : 'r,g,b') && unit(x.r) && unit(x.g) && unit(x.b) && (!alpha || unit(x.a));
const list = (x, max, fn) => Array.isArray(x) && x.length <= max && x.every(fn);
const status = (x, fn) => exact(x, 'status,value') && (x.status === 'available' ? fn(x.value)
  : ['unavailable', 'not-supported'].includes(x.status) && x.value === null);
const nodeId = x => typeof x === 'string' && /^I?\d+:\d+(?:;\d+:\d+)*$/.test(x);
function validBinding(x) {
  if (!exact(x, 'id,status,chain') || !text(x.id, 300) || !x.id) return false;
  if (x.status === 'unavailable') return Array.isArray(x.chain) && !x.chain.length;
  if (x.status !== 'available' || !list(x.chain, 16, v => exact(v, 'id,key,name,remote,collection,aliasId,color')
    && text(v.id, 300) && key(v.key) && text(v.name) && typeof v.remote === 'boolean'
    && exact(v.collection, 'id,key,name,modeId,modeName') && text(v.collection.id, 300) && key(v.collection.key)
    && text(v.collection.name) && text(v.collection.modeId, 300) && text(v.collection.modeName)
    && (v.aliasId === null ? color(v.color, true) : text(v.aliasId, 300) && v.color === null))) return false;
  return x.chain.length > 0 && new Set(x.chain.map(v => v.id)).size === x.chain.length
    && x.chain[0].id === x.id && x.chain.every((v, i) => v.aliasId === (x.chain[i + 1]?.id || null));
}
const paints = x => status(x, value => list(value, 16, p => exact(p, 'type,visible,opacity,color,binding')
  && ['SOLID','GRADIENT_LINEAR','GRADIENT_RADIAL','GRADIENT_ANGULAR','GRADIENT_DIAMOND','IMAGE','VIDEO','PATTERN'].includes(p.type)
  && typeof p.visible === 'boolean' && unit(p.opacity) && (p.type === 'SOLID' ? color(p.color) : p.color === null)
  && (p.binding === null || p.type === 'SOLID' && validBinding(p.binding))));
function validActions(actions, depth = 0) {
  return depth <= 8 && list(actions, 16, action => {
    const fields = ['type','url','openInNewTab','destinationId','navigation','variableId','variableCollectionId','variableModeId','mediaAction','branches'];
    return record(action) && Object.keys(action).every(k => fields.includes(k))
      && ['BACK','CLOSE','URL','NODE','SET_VARIABLE','SET_VARIABLE_MODE','CONDITIONAL','UPDATE_MEDIA_RUNTIME'].includes(action.type)
      && (action.url === undefined || text(action.url, 4000)) && (action.openInNewTab === undefined || typeof action.openInNewTab === 'boolean')
      && (action.destinationId == null || nodeId(action.destinationId))
      && (action.navigation === undefined || ['NAVIGATE','SWAP','OVERLAY','SCROLL_TO','CHANGE_TO'].includes(action.navigation))
      && ['variableId','variableCollectionId','variableModeId','mediaAction'].every(k => action[k] == null || text(action[k], 300))
      && (action.type === 'URL' ? typeof action.url === 'string' : action.url === undefined)
      && (action.type === 'NODE' ? Object.hasOwn(action, 'destinationId') && typeof action.navigation === 'string' : action.navigation === undefined)
      && (action.type === 'CONDITIONAL' ? list(action.branches, 16, b => exact(b, 'conditional,actions') && typeof b.conditional === 'boolean' && validActions(b.actions, depth + 1)) : action.branches === undefined);
  });
}
function validateEvidence(evidence, nodes) {
  if (!exact(evidence, 'schemaVersion,nodes') || evidence.schemaVersion !== SCHEMA || JSON.stringify(evidence).length > 500000
    || !Array.isArray(evidence.nodes) || evidence.nodes.length !== nodes.length) return false;
  const ids = new Set();
  return evidence.nodes.every((fact, i) => {
    const n = nodes[i];
    if (!exact(fact, 'nodeId,fills,propertyReferences,componentProperties,textSegments,reactions,annotations') || fact.nodeId !== n.id || ids.has(fact.nodeId)) return false;
    ids.add(fact.nodeId);
    return paints(fact.fills)
      && status(fact.propertyReferences, r => r === null || record(r) && Object.keys(r).every(k => ['visible','characters','mainComponent'].includes(k) && text(r[k], 300)))
      && status(fact.componentProperties, v => n.type === 'INSTANCE' && list(v, 64, p => exact(p, 'name,type,value') && text(p.name, 300)
        && ['BOOLEAN','TEXT','INSTANCE_SWAP','VARIANT'].includes(p.type) && (p.type === 'BOOLEAN' ? typeof p.value === 'boolean' : text(p.value, 4000)))
        && new Set(v.map(p => p.name)).size === v.length)
      && status(fact.textSegments, v => n.type === 'TEXT' && list(v, 64, s => exact(s, 'start,end,fills,hyperlink,textDecoration')
        && Number.isSafeInteger(s.start) && Number.isSafeInteger(s.end) && s.start >= 0 && s.end > s.start && s.end <= n.text.length
        && paints(s.fills) && ['NONE','UNDERLINE','STRIKETHROUGH'].includes(s.textDecoration)
        && (s.hyperlink === null || exact(s.hyperlink, 'type,value') && ['URL','NODE'].includes(s.hyperlink.type) && text(s.hyperlink.value, 4000)))
        && (n.text.length === 0 ? !v.length : v.length && v[0].start === 0 && v.at(-1).end === n.text.length && v.every((s, j) => j === 0 || s.start === v[j - 1].end)))
      && status(fact.reactions, v => list(v, 16, r => exact(r, 'trigger,actions') && (r.trigger === null || text(r.trigger, 100)) && validActions(r.actions)))
      && status(fact.annotations, v => list(v, 16, a => exact(a, 'label,labelMarkdown') && text(a.label, 4000) && text(a.labelMarkdown, 4000)));
  });
}
async function loadSources(options, readSource, capture) {
  const colors = await readSource(options.designSystemRoot, COLOR_PATH, 'link-color-tokens');
  let catalog;
  try { catalog = JSON.parse(colors.document); } catch { throw Error('PATTERN_COLOR_AUTHORITY_INVALID'); }
  const colorTokens = [];
  for (const name of COLOR_NAMES) {
    const matches = (catalog.collections || []).flatMap(c => (c.variables || []).filter(v => v.name === name && v.resolvedType === 'COLOR').map(v => ({ key: v.key, name: v.name, collectionKey: c.key })));
    if (matches.length !== 1 || !key(matches[0].key) || !key(matches[0].collectionKey)) throw Error('PATTERN_COLOR_AUTHORITY_INVALID');
    colorTokens.push(matches[0]);
  }
  const sources = [{ sourceId: colors.sourceId, path: colors.path, sha256: colors.sha256, colorTokens }], hosts = [];
  for (let i = 0; i < HOST_PATHS.length; i++) {
    const source = await readSource(options.designSystemRoot, HOST_PATHS[i], 'link-host-' + i, 8 * 1024 * 1024);
    let rows;
    try { rows = JSON.parse(source.document).contracts; } catch { throw Error('PATTERN_HOST_AUTHORITY_INVALID'); }
    if (!Array.isArray(rows)) throw Error('PATTERN_HOST_AUTHORITY_INVALID');
    const observed = new Set(capture.nodes.filter(n => n.component).map(n => n.component.setKey || n.component.key));
    const components = rows.filter(c => c.status === 'active' && observed.has(c.componentKey)).map(c => ({ id: c.id, name: c.name, componentKey: c.componentKey,
      variants: c.figma?.variants?.variantKeys?.map(v => ({ key: v.key, properties: v.properties })),
      anatomy: c.figma?.anatomy?.map(n => ({ name: n.name, type: n.type, path: n.path })) || [] }));
    if (components.some(c => !key(c.componentKey) || !Array.isArray(c.variants) || c.variants.some(v => !key(v.key)))) throw Error('PATTERN_HOST_AUTHORITY_INVALID');
    hosts.push(...components);
    // These are structural facts, never additional normative rules.
    sources.push({ sourceId: source.sourceId, path: source.path, sha256: source.sha256, components });
  }
  for (let i = 0; i < SUPPORTING_PATTERNS.length; i++) {
    const spec = SUPPORTING_PATTERNS[i], source = await readSource(options.designSystemRoot, spec.path, 'link-host-norm-' + i), doc = source.document;
    if (doc.split('- patternId: ' + spec.id + '\n').length !== 2 || !doc.includes('- status: active\n')) throw Error('PATTERN_HOST_NORM_INVALID');
    const blocks = spec.section ? [section(doc, spec.section)] : spec.rules.map(id => {
      const marker = '- ruleId: ' + id + '\n', position = doc.indexOf(marker);
      if (doc.split(marker).length !== 2) throw Error('PATTERN_HOST_NORM_INVALID');
      const start = doc.lastIndexOf('\n### Rule ', position) + 1;
      const ends = [doc.indexOf('\n### Rule ', position), doc.indexOf('\n## Section ', position)].filter(n => n >= 0);
      if (start <= 0 || !ends.length) throw Error('PATTERN_HOST_NORM_INVALID');
      return doc.slice(start, Math.min(...ends));
    });
    sources.push({ sourceId: source.sourceId, path: source.path, sha256: source.sha256,
      appliesToRuleIds: ['rule:components.link.component-context'], supportingRuleIds: spec.rules || [], documentExcerpt: blocks.join('\n\n') });
  }
  return { sources, hosts };
}
function section(doc, heading) {
  const start = doc.indexOf(heading), end = doc.indexOf('\n## Section ', start + heading.length);
  if (start < 0 || end < 0) throw Error('PATTERN_HOST_NORM_INVALID');
  return doc.slice(start, end);
}
function contextFor(subject, capture, hosts) {
  const byId = new Map(capture.nodes.map(n => [n.id, n])), facts = new Map(capture.contextEvidence.nodes.map(n => [n.nodeId, n]));
  const path = []; let node = byId.get(subject.nodeId);
  while (node) { path.push(node.id); node = byId.get(node.parentId); }
  const hostNodes = path.slice(1).map(id => byId.get(id)).filter(n => n.component);
  const host = hostNodes.find(n => hosts.some(c => c.componentKey === (n.component.setKey || n.component.key) && c.variants.some(v => v.key === n.component.key
    && Object.entries(v.properties).every(([k, value]) => n.component.variants[k] === value))));
  // Include host text through ordinary wrappers, never the contents of a sibling instance.
  if (host) for (const candidate of capture.nodes.filter(n => n.type === 'TEXT')) {
    let current = byId.get(candidate.parentId);
    while (current && current.id !== host.id && !current.component) current = byId.get(current.parentId);
    if (current?.id === host.id && !subject.contextNodeIds.includes(candidate.id)) subject.contextNodeIds.push(candidate.id);
  }
  const propertyOwners = id => {
    const refs = facts.get(id).propertyReferences, resolved = [];
    if (refs.status !== 'available' || !refs.value) return resolved;
    for (const [field, propertyName] of Object.entries(refs.value)) {
      let parent = byId.get(byId.get(id).parentId), ownerNodeId = null;
      while (parent) {
        const props = facts.get(parent.id).componentProperties;
        if (props.status === 'available' && props.value.some(p => p.name === propertyName)) { ownerNodeId = parent.id; break; }
        parent = byId.get(parent.parentId);
      }
      resolved.push({ field, propertyName, ownerNodeId });
    }
    return resolved;
  };
  return { hostNodeId: host?.id || null, nearestInstanceNodeId: hostNodes[0]?.id || null, pathNodeIds: path,
    slotPath: path.slice(0, host ? path.indexOf(host.id) : path.length).reverse().map(id => ({ nodeId: id, type: byId.get(id).type,
      propertyReferences: facts.get(id).propertyReferences, propertyOwners: propertyOwners(id) })) };
}
module.exports = { SCHEMA, COLOR_PATH, COLOR_NAMES, HOST_PATHS, SUPPORTING_PATTERNS, validateEvidence, loadSources, contextFor };
