// Proxy-owned synthetic test fixtures. No design-system manual is reconstructed here.
// The original three synthetic fixture bodies are retained; every hash and compilation
// uses this one pinned, released 0.4.0 runtime, independently of the current v4 build.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const runtimePath = path.resolve(__dirname, '../../../../projects/Apollo-v3/apps/apollo-v4/dist/pilot-release/runtime.cjs');
const bytes = fs.readFileSync(runtimePath);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), '29ff531ef75eb937464381704dabb807bf5a34a6e8d9bc44161cd6f855634e56', 'Supported fixture runtime bytes changed');
const runtime = require(runtimePath);
assert.equal(runtime.RUNTIME_VERSION, '0.4.0', 'Supported fixture runtime profile changed');

const legacy = (() => {
function contract() {
  const hash = 'a'.repeat(64);
  return {
    schemaVersion: 'apollo.component-contract.v2.1-experimental', documentType: 'component-contract', status: 'ready',
    package: { id: 'test.component', componentId: 'test.component', manualSourceHash: hash, snapshotProfile: 'component-facts-v2' },
    facts: {
      component: { componentId: 'test.component', componentKey: 'test-key', family: 'Test', platform: 'desktop' },
      representations: [{ id: 'figma', kind: 'figma', platform: 'desktop', status: 'verified', locator: { componentKey: 'test-key' } }],
      targets: [{ id: 'root', semanticRole: 'root', nameHint: 'Test', pathHint: 'Test', lineage: [], resolution: 'resolved' }],
      semanticApi: [], semantics: {}, controlPorts: [], documentation: [], examples: [], decisions: [], generation: [],
    },
    customizationPolicy: [{ id: 'source.rule', status: 'reviewed', permission: 'constrained', capability: '', controlPaths: [], execution: { route: 'predicate' } }],
    rules: [{
      schemaVersion: 'apollo.rule-ir.v1', ruleId: 'source.rule.1', revision: 1,
      source: { anchor: 'source.rule', path: 'contract.manual.json', checksum: hash },
      authority: { status: 'active', provenance: 'test-author' }, effect: 'require', scope: {},
      select: { from: 'selection-root', traverse: 'self' },
      assert: { predicate: 'equals', actual: { fact: 'appearance.opacity' }, expected: { literal: 1 }, missingPolicy: 'unknown' },
      severity: 'error', unknownPolicy: 'human-review', presentation: { title: 'Root opacity must equal 1.' },
    }],
    nonExecutableRules: [], capabilities: { selectors: [], facts: [], operators: [], remediations: [] },
    coverage: { sourceRules: 1, policyRules: 1, policyOnlyRules: 0, compiledRules: 1, nonExecutableRules: 0 },
    runtimePolicy: { engine: 'apollo-predicate-engine', unknownPolicy: 'fail-closed', compiledIsSourceOfTruth: false },
  };
}

function snapshot() {
  return {
    schemaVersion: 'apollo.predicate-snapshot.v2', generatedAt: '2026-10-01T00:00:00.000Z',
    source: { componentKey: 'test-key', rootNodeId: 'root', truncated: false }, selection: ['root'],
    context: { platform: 'desktop', modes: {} },
    nodes: [{ id: 'root', name: 'Test', type: 'INSTANCE', visible: true, order: 0, parentId: null, childIds: [],
      semantic: { role: 'root' }, component: { key: 'test-key', properties: {} }, appearance: { opacity: 1 } }],
  };
}

return { contract, snapshot };

})();

const dependencyFixtures = (() => {
// Synthetic components only; no design-system policies or user reports.
const fixture = legacy;
const { contractHash } = runtime;
const clone = value => JSON.parse(JSON.stringify(value));

function componentContract(id, key) {
  const contract = fixture.contract();
  contract.package.id = id; contract.package.componentId = id; contract.package.manualRevision = 1;
  contract.facts.component.componentId = id; contract.facts.component.componentKey = key;
  contract.facts.representations[0].locator.componentKey = key;
  contract.customizationPolicy[0].id = id + '.opacity';
  contract.rules[0].ruleId = id + '.opacity.1'; contract.rules[0].source.anchor = id + '.opacity';
  return contract;
}
function reference(snapshot) {
  const nodeProperties = {};
  const nodes = snapshot.nodes.map(node => {
    const path = node.parentId === null ? '' : node.semantic.path.split(' / ').slice(1).join(' / ');
    nodeProperties[path] = { properties: clone(node.component.properties), propertyTypes: clone(node.component.propertyTypes),
      propertyReferences: [], identity: clone(node.component.identity) };
    return { path, type: path ? node.type : 'ROOT' };
  }).sort((a, b) => a.path.localeCompare(b.path) || a.type.localeCompare(b.type));
  const root = snapshot.nodes[0];
  return { componentKey: snapshot.source.componentKey, componentSetKey: snapshot.source.componentSetKey || '', complete: true,
    nodes, properties: clone(root.component.properties), propertyTypes: clone(root.component.propertyTypes), propertyReferences: [], nodeProperties };
}
function dependencyFixture() {
  const child = componentContract('test.child', 'child-key'), host = componentContract('test.host', 'host-key');
  host.package.snapshotProfile = 'dependency-facts-v5';
  host.runtimePolicy.dependencyCompletionVersion = 1;
  const snapshot = fixture.snapshot(); snapshot.source.componentKey = 'host-key'; snapshot.source.captureTopology = { complete: true, issues: [] };
  snapshot.nodes = [];
  function node(id, name, type, parentId, path, key, set = '') {
    const n = { id, name, type, parentId, childIds: [], order: 0, visible: true, semantic: { path }, resolvedModes: {},
      component: { properties: {}, propertyTypes: {}, propertyReferences: [], identity: key ? { componentKey: key, componentSetKey: set } : {} }, appearance: { opacity: 1 } };
    snapshot.nodes.push(n);
    if (parentId) snapshot.nodes.find(entry => entry.id === parentId).childIds.push(id);
    return n;
  }
  node('root', 'Test', 'INSTANCE', null, 'Test', 'host-key');
  const bindings = [];
  for (const side of ['left', 'right']) {
    const name = side === 'left' ? 'Left' : 'Right';
    node(side, name, 'FRAME', 'root', `Test / ${name}`);
    const owner = node(side + '-owner', 'Owner', 'INSTANCE', side, `Test / ${name} / Owner`, 'owner-key', 'owner-set');
    owner.component.properties.Type = 'Child'; owner.component.propertyTypes.Type = 'VARIANT';
    node(side + '-child', 'Child', 'INSTANCE', side + '-owner', `Test / ${name} / Owner / Child`, 'child-key');
    host.facts.targets.push({ id: side, semanticRole: side, pathHint: `Test / ${name}`, resolution: 'resolved' });
    bindings.push({ id: side, targetRole: side, relativePath: 'Owner', childPath: 'Child', ownerComponentSetKeys: ['owner-set'], activeVariant: { property: 'Type', values: ['Child'] } });
  }
  snapshot.variantReference = reference(snapshot);
  const shape = snapshot.variantReference.nodes, structureId = contractHash(shape);
  host.facts.variantEvidence = { schemaVersion: 'apollo.variant-anatomy.v1', sourceHash: 'c'.repeat(64), structures: { [structureId]: shape },
    variants: [{ componentKey: 'host-key', componentSetKey: 'host-key', structureId, properties: {} }] };
  host.componentDependencies = [{ id: 'child', componentId: child.package.componentId, revision: 1, manualSourceHash: child.package.manualSourceHash,
    compiledHash: contractHash(child), contract: child, bindings }];
  snapshot.componentDependencyCaptures = [];
  for (const side of ['left', 'right']) {
    const actual = clone(snapshot.nodes.find(n => n.id === side + '-child'));
    actual.id = 'local'; actual.name = 'Test'; actual.parentId = null; actual.semantic = { path: 'Test', role: 'root' };
    const captured = fixture.snapshot(); captured.source.componentKey = 'child-key'; captured.nodes = [actual]; captured.selection = ['local']; captured.source.rootNodeId = 'local';
    captured.variantReference = reference(captured);
    snapshot.componentDependencyCaptures.push({ nodeId: side + '-child', nodeMap: { local: side + '-child' }, snapshot: captured });
  }
  return { host, child, snapshot };
}
function syncCapture(snapshot, side) {
  const host = snapshot.nodes.find(n => n.id === side + '-child');
  const captured = snapshot.componentDependencyCaptures.find(c => c.nodeId === host.id).snapshot.nodes[0];
  captured.component = clone(host.component); captured.appearance = clone(host.appearance);
}
return { dependencyFixture, componentContract, reference, syncCapture };

})();

const sources = (() => {
// Synthetic source norms only. Never reconstruct a real manual from RuleIR.
const clone = value => JSON.parse(JSON.stringify(value));
function fromContract(input, dependencies = []) {
  const id = input.package.componentId, component = Object.assign({ familyId: id, contractId: input.package.id,
    library: 'Synthetic', layer: 'core', platforms: ['desktop'], lifecycle: 'active' }, clone(input.facts.component));
  const manual = {
    schemaVersion: 'apollo.component-contract.manual.v2-experimental', documentType: 'component-contract-manual',
    component, semantics: { purpose: 'Synthetic component for source-authority tests.' },
    representations: clone(input.facts.representations), semanticApi: [], documentation: [], examples: [], decisions: [],
    generation: { profiles: [], instructions: [] }, source: { kind: 'manual-source', importedFiles: [], sourceHash: 'c'.repeat(64), importedAt: '2026-10-01T00:00:00Z' },
    targets: clone(input.facts.targets), controlPorts: [],
    rules: [{ id: input.customizationPolicy[0].id, targetId: 'root', targetScope: 'self', capability: 'appearance.opacity', permission: 'constrained',
      controlPaths: [], constraints: [{ type: 'propertyDomain', fact: 'appearance.opacity', values: [1] }],
      applicability: { variants: 'all', modes: 'all', platforms: ['desktop'] }, rationale: 'Synthetic root opacity requirement.',
      status: 'reviewed', execution: { route: 'predicate' }, owner: 'test-author' }],
    metadata: { revision: 1, owners: { generated: 'athena-cli', manual: 'test-author', runtime: 'apollo-runtime' }, updatedAt: '2026-10-01T00:00:00Z' },
  };
  if (input.runtimePolicy.dependencyCompletionVersion) manual.metadata.dependencyCompletionVersion = 1;
  if (dependencies.length) manual.componentDependencies = (input.componentDependencies || []).map((pin, i) => {
    const child = runtime.loadAuthoringSource(dependencies[i]).contract;
    return Object.assign({}, pin, { contract: undefined, manualSourceHash: child.package.manualSourceHash, compiledHash: runtime.contractHash(child) });
  });
  const shape = [{ path: '', type: 'ROOT' }], shapeId = runtime.contractHash(shape);
  const variantEvidence = input.facts.variantEvidence || { schemaVersion: 'apollo.variant-anatomy.v1', sourceHash: 'c'.repeat(64),
    structures: { [shapeId]: shape }, variants: [{ componentKey: component.componentKey, componentSetKey: component.componentKey, structureId: shapeId, properties: {} }] };
  return clone({ schemaVersion: runtime.SOURCE_SCHEMA, documentType: 'component-contract-source', manual, variantEvidence, dependencies });
}
function source() { return fromContract(legacy.contract()); }
function snapshot() {
  const s = legacy.snapshot(), root = s.nodes[0]; root.semantic.path = 'Test';
  root.component.identity = { componentKey: 'test-key', componentSetKey: '' }; root.component.propertyTypes = {}; root.component.propertyReferences = [];
  s.variantReference = dependencyFixtures.reference(s);
  return s;
}
function nested() {
  const f = dependencyFixtures.dependencyFixture();
  const childSource = fromContract(f.child), hostSource = fromContract(f.host, [childSource]);
  return Object.assign(f, { source: hostSource, childSource,
    host: runtime.loadAuthoringSource(hostSource).contract, child: runtime.loadAuthoringSource(childSource).contract });
}
return { source, snapshot, nested, fromContract };

})();

module.exports = { runtimePath, runtime, ...sources, syncCapture: dependencyFixtures.syncCapture };
