const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const service = require('../src/contracts/service');
const { runtimePath } = require('./fixtures/supported-contract-v4');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);

function fixture(t, dependency = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-contract-v4-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = require('./fixtures/supported-contract-v4');
  const nested = dependency ? sources.nested() : null;
  const source = nested ? nested.source : sources.source(), api = require(runtimePath);
  const authored = api.loadAuthoringSource(source), document = authored.contract;
  const bytes = Buffer.from(JSON.stringify(source)), cache = Buffer.from(JSON.stringify(document)), runtime = fs.readFileSync(runtimePath);
  const entry = { id: document.package.id, family: 'Test', file: 'contract.json', sha256: sha(bytes),
    componentId: document.package.componentId, revision: document.rules[0].revision, dependencies: api.collectContractDependencies(document),
    contractHash: sha(stable(document)), manualSourceHash: document.package.manualSourceHash,
    sourceHash: authored.sourceHash, generatedFactsHash: document.package.generatedFactsHash, compiledCache: { file: 'contract-cache.json', sha256: sha(cache) },
    keys: Array.from(api.collectContractKeys(document)), scope: nested ? 'component-with-dependencies' : 'standalone-component', published: false };
  const manifest = { schemaVersion: 'apollo.contract-release.v1-experimental', channel: 'local-pilot', published: false,
    sourceSchema: api.SOURCE_SCHEMA, runtime: { file: 'runtime.cjs', sha256: sha(runtime), version: require(runtimePath).RUNTIME_VERSION }, contracts: [entry] };
  function save() { delete manifest.id; manifest.id = sha(JSON.stringify(manifest)); fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest)); }
  fs.writeFileSync(path.join(root, 'contract.json'), bytes); fs.writeFileSync(path.join(root, 'contract-cache.json'), cache);
  fs.writeFileSync(path.join(root, 'runtime.cjs'), runtime); save();
  if (nested) {
    const childBytes = Buffer.from(JSON.stringify(nested.childSource)), childCache = Buffer.from(JSON.stringify(nested.child));
    fs.writeFileSync(path.join(root, 'child.json'), childBytes);
    fs.writeFileSync(path.join(root, 'child-cache.json'), childCache);
    manifest.contracts.push({ id: nested.child.package.id, componentId: nested.child.package.componentId, revision: 1, dependencies: [],
      family: 'Child', file: 'child.json', sha256: sha(childBytes), contractHash: api.contractHash(nested.child), manualSourceHash: nested.child.package.manualSourceHash,
      sourceHash: api.contractHash(nested.childSource), generatedFactsHash: nested.child.package.generatedFactsHash, compiledCache: { file: 'child-cache.json', sha256: sha(childCache) },
      keys: Array.from(api.collectContractKeys(nested.child)), scope: 'standalone-component', published: false });
    save();
  }
  const release = service.readRelease(root).contracts[0].release;
  return { root, entry, manifest, save, document, body: { auditId: 'b'.repeat(64), release, snapshot: nested ? nested.snapshot : sources.snapshot() } };
}

test('missing pilot is unavailable and cannot fall back to legacy knowledge', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-contract-v4-empty-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => service.readRelease(root), error => error.code === 'CONTRACT_V4_NOT_INSTALLED');
});

test('verified release checkpoint detects changes in every source and derived artifact', t => {
  const f = fixture(t, true), loaded = service.readRelease(f.root);
  loaded.assertCurrent();
  for (const name of ['manifest.json', 'runtime.cjs', 'contract.json', 'contract-cache.json', 'child.json', 'child-cache.json']) {
    const file = path.join(f.root, name), bytes = fs.readFileSync(file);
    try {
      fs.appendFileSync(file, ' ');
      assert.throws(() => loaded.assertCurrent(), error => error.code === 'CONTRACT_V4_RELEASE_CHANGED', name);
    } finally { fs.writeFileSync(file, bytes); }
    loaded.assertCurrent();
  }
});

test('frozen packet is recomputed by the same runtime, without accepting a caller verdict', t => {
  const f = fixture(t); f.body.result = { engine: { evaluations: [{ classification: 'compliant' }] } };
  f.body.snapshot.nodes[0].appearance.opacity = .2;
  const packet = service.buildExplanationPacket(f.body, f.root);
  assert.equal(packet.deterministicResult.engine.evaluations[0].classification, 'violation');
  const prompt = service.buildExplanationPrompt(packet);
  assert.ok(prompt.includes(f.entry.contractHash)); assert.ok(prompt.includes('Не меняй deterministic classifications'));
  assert.equal(packet.contract.schemaVersion, 'apollo.component-contract.v2.1-experimental');
  const projected = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)).contract;
  assert.equal(projected.sourceSchemaVersion, packet.contract.schemaVersion);
  assert.equal(projected.projection.executable, false);
});

for (const [label, mutate, expected] of [
  ['contract bytes', f => fs.appendFileSync(path.join(f.root, 'contract.json'), ' '), /checksum mismatch/],
  ['runtime bytes', f => fs.appendFileSync(path.join(f.root, 'runtime.cjs'), ' '), /checksum mismatch/],
  ['manifest identity', f => { f.manifest.id = 'bad'; fs.writeFileSync(path.join(f.root, 'manifest.json'), JSON.stringify(f.manifest)); }, /Incompatible/],
  ['path traversal', f => { f.entry.file = '../contract.json'; f.save(); }, /artifact path/],
  ['routing keys', f => { f.entry.keys = ['invented']; f.save(); }, /key index mismatch/],
  ['authoring identity', f => { f.entry.sourceHash = 'd'.repeat(64); f.save(); }, /source checksum/],
  ['compiled cache', f => fs.appendFileSync(path.join(f.root, 'contract-cache.json'), ' '), /cache mismatch/],
]) {
  test(`corrupt ${label} fails closed`, t => { const f = fixture(t); mutate(f); assert.throws(() => service.readRelease(f.root), expected); });
}

test('stale release, foreign component and forged snapshot hash never reach Codex', t => {
  const f = fixture(t), clone = value => JSON.parse(JSON.stringify(value));
  const stale = clone(f.body); stale.release.id = 'c'.repeat(64); assert.throws(() => service.buildExplanationPacket(stale, f.root), error => error.status === 409);
  const foreign = clone(f.body); foreign.snapshot.source.componentKey = 'foreign'; assert.throws(() => service.buildExplanationPacket(foreign, f.root), /not covered/);
  const forged = clone(f.body); forged.snapshot.snapshotHash = 'c'.repeat(64); assert.throws(() => service.buildExplanationPacket(forged, f.root), /frozen/);
  const source = clone(f.body); source.release.sourceHash = 'c'.repeat(64); assert.throws(() => service.buildExplanationPacket(source, f.root), error => error.status === 409);
});

test('agent references must match deterministic evaluation and RuleID', t => {
  const f = fixture(t), packet = service.buildExplanationPacket(f.body, f.root), evaluation = packet.deterministicResult.engine.evaluations[0];
  const valid = { summary: 'Проверено', findings: [{ evaluationId: evaluation.evaluationId, ruleId: evaluation.ruleId, explanation: 'Значение соответствует требованию.' }] };
  assert.equal(service.validateExplanation(valid, packet), valid);
  for (const invalid of [
    { summary: 'x', findings: [{ evaluationId: 'invented', ruleId: evaluation.ruleId, explanation: 'x' }] },
    { summary: 'x', findings: [{ evaluationId: evaluation.evaluationId, ruleId: 'invented', explanation: 'x' }] },
    { summary: 'x', findings: [], verdict: 'compliant' },
  ]) assert.throws(() => service.validateExplanation(invalid, packet), error => error.status === 502);
});

test('HTTP pilot load and explanation preserve release pins and validated references', async t => {
  const f = fixture(t), app = express(); app.use(express.json());
  let calls = 0;
  service.mountContractRoutes(app, { releaseRoot: f.root, explain: async prompt => {
    calls++; const packet = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
    const engine = packet.deterministicResult.engine;
    const entry = engine.evaluations[0] || Object.fromEntries(engine.resolvedEvaluations.columns.map((name, i) => [name, engine.resolvedEvaluations.rows[0][i]]));
    return { summary: 'Проверка завершена.', findings: [{ evaluationId: entry.evaluationId, ruleId: entry.ruleId, explanation: 'Объяснение.' }] };
  } });
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const index = await fetch(base + '/v2/contracts').then(res => res.json()); assert.equal(index.contracts[0].id, f.entry.id);
  const loaded = await fetch(base + '/v2/contracts/' + f.entry.id).then(res => res.json()); assert.deepEqual(loaded.release, f.body.release);
  assert.equal(loaded.contract, undefined); assert.equal(loaded.source.manual.documentType, 'component-contract-manual');
  const resolve = await fetch(base + '/v2/contracts/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ components: [{ componentKey: 'test-key' }, { componentKey: 'missing' }] }) });
  assert.equal(resolve.status, 200); const batch = await resolve.json();
  assert.equal(batch.contracts.length, 1); assert.deepEqual(batch.contracts[0].release, f.body.release);
  assert.deepEqual(batch.resolutions.map(item => item.status), ['resolved', 'not-found']);
  const changed = await fetch(base + '/v2/contracts/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ components: [], releaseId: 'c'.repeat(64) }) });
  assert.equal(changed.status, 409); assert.equal(calls, 0);
  const response = await fetch(base + '/v2/contracts/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f.body) });
  assert.equal(response.status, 200); const explanation = await response.json(); assert.equal(explanation.auditId, f.body.auditId); assert.equal(explanation.references[0].ruleId, f.document.rules[0].ruleId);
  f.body.release.id = 'bad';
  const stale = await fetch(base + '/v2/contracts/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f.body) });
  assert.equal(stale.status, 409); assert.equal(calls, 1);
});

test('proxy recomputes child violations and checks their own RuleID and occurrence evidence', t => {
  const f = fixture(t, true);
  f.body.snapshot.nodes.find(n => n.id === 'left-child').appearance.opacity = .3;
  require('./fixtures/supported-contract-v4').syncCapture(f.body.snapshot, 'left');
  const packet = service.buildExplanationPacket(f.body, f.root);
  const violation = packet.deterministicResult.engine.evaluations.find(e => e.dependency && e.classification === 'violation');
  assert.equal(violation.ruleId, 'test.child.opacity.1.1'); assert.equal(violation.subjectNodeId, 'left-child');
  const finding = { evaluationId: violation.evaluationId, ruleId: violation.ruleId, explanation: 'Нарушение вложенного компонента.' };
  assert.equal(service.validateExplanation({ summary: 'Проверено', findings: [finding] }, packet).findings[0], finding);
  assert.throws(() => service.validateExplanation({ summary: 'x', findings: [Object.assign({}, finding, { ruleId: 'test.host.opacity.1' })] }, packet), /inconsistent evidence/);
  f.body.snapshot.componentDependencyCaptures = [];
  assert.equal(service.buildExplanationPacket(f.body, f.root).deterministicResult.coverage.executionComplete, false);
});

for (const [label, mutate, expected] of [
  ['scope', f => { f.entry.scope = 'standalone-component'; }, /dependency index/],
  ['dependency pin index', f => { f.entry.dependencies[0].compiledHash = 'd'.repeat(64); }, /dependency index/],
  ['missing released child', f => { f.manifest.contracts.pop(); }, /release closure/],
  ['runtime profile', f => { f.manifest.runtime.version = '0.1.0'; }, /profile version/],
  ['child revision', f => { f.manifest.contracts[1].revision = 2; }, /revision index/],
]) test(`corrupt dependency ${label} fails closed`, t => {
  const f = fixture(t, true); mutate(f); f.save(); assert.throws(() => service.readRelease(f.root), expected);
});

test('agent projection bounds variant catalogs while retaining all source rules and child pins', t => {
  const f = fixture(t, true), packet = service.buildExplanationPacket(f.body, f.root);
  packet.contract.facts.variantEvidence.assetCatalogs = { unrelated: 'x'.repeat(950000) };
  packet.contract.facts.variantEvidence.variants.push({ componentKey: 'unselected', componentSetKey: 'other', structureId: 'other', properties: {} });
  packet.release.contractHash = require(runtimePath).contractHash(packet.contract);
  packet.snapshot.nodes[0].baseline = { effective: { appearance: { opacity: 1 } } };
  packet.snapshot.transitionBefore = JSON.parse(JSON.stringify(packet.snapshot));
  packet.snapshot.transitionBefore.nodes[0].baseline = { effective: { appearance: { opacity: 1 } } };
  const before = JSON.stringify(packet);
  const prompt = service.buildExplanationPrompt(packet); assert.ok(prompt.length < 900000);
  const projected = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
  assert.deepEqual(projected.contract.rules, packet.contract.rules);
  assert.deepEqual(projected.contract.customizationPolicy, packet.contract.customizationPolicy);
  assert.deepEqual(projected.contract.componentDependencies[0].contract.rules, packet.contract.componentDependencies[0].contract.rules);
  assert.equal(projected.contract.compiledHash, packet.release.contractHash);
  assert.equal(projected.contract.componentDependencies[0].contract.compiledHash, packet.contract.componentDependencies[0].compiledHash);
  assert.equal(projected.contract.facts.variantEvidence.assetCatalogs, undefined);
  assert.equal(projected.contract.facts.variantEvidence.variants.length, 1);
  assert.deepEqual(projected.snapshot.nodes, packet.snapshot.nodes.map(node => { const actual = Object.assign({}, node); delete actual.baseline; return actual; }));
  assert.equal(projected.snapshot.componentDependencyCaptures[0].snapshot, undefined);
  assert.equal(projected.snapshot.componentDependencyCaptures[0].snapshotIndex.nodeCount, 1);
  assert.equal(projected.snapshot.transitionBefore.nodes[0].baseline, undefined);
  assert.deepEqual(projected.snapshot.transitionBefore.nodes[0].component, packet.snapshot.transitionBefore.nodes[0].component);
  assert.ok(projected.snapshot.transitionBefore.projection.omitted.includes('node baselines'));
  const engine = projected.deterministicResult.engine;
  const resolved = engine.resolvedEvaluations.rows.map(row => {
    const e = Object.fromEntries(engine.resolvedEvaluations.columns.map((name, i) => [name, row[i]]));
    e.dependency = e.dependencyEvidenceIndex === null ? undefined : engine.dependencyEvidence[e.dependencyEvidenceIndex];
    return e;
  });
  assert.deepEqual(resolved.map(e => [e.evaluationId, e.ruleId, e.classification, e.subjectNodeId, e.focusNodeId, e.dependency]),
    packet.deterministicResult.engine.evaluations.map(e => [e.evaluationId, e.ruleId, e.classification, e.subjectNodeId, e.focusNodeId, e.dependency]));
  assert.equal(engine.evaluations.length, 0);
  assert.equal(JSON.stringify(packet), before);
  f.body.snapshot.nodes.find(n => n.id === 'left-child').appearance.opacity = .3;
  require('./fixtures/supported-contract-v4').syncCapture(f.body.snapshot, 'left');
  const failurePacket = service.buildExplanationPacket(f.body, f.root), failurePrompt = service.buildExplanationPrompt(failurePacket);
  const failureProjection = JSON.parse(failurePrompt.slice(failurePrompt.indexOf('\n') + 1));
  const failure = failurePacket.deterministicResult.engine.evaluations.find(e => e.classification === 'violation');
  assert.deepEqual(failureProjection.deterministicResult.engine.evaluations.find(e => e.evaluationId === failure.evaluationId), JSON.parse(JSON.stringify(failure)));
});

test('batch key resolution deduplicates identities and packages, includes bound sources and preserves missing keys', t => {
  const f = fixture(t, true);
  const result = service.resolveContracts({ components: [
    { componentKey: 'host-key' }, { componentKey: 'host-key' },
    { componentKey: 'new-variant', componentSetKey: 'host-key' },
    { componentKey: 'child-key' }, { componentKey: 'missing', name: 'Host' },
  ] }, f.root);
  assert.equal(result.releaseId, f.manifest.id); assert.equal(result.contracts.length, 2);
  assert.equal(result.resolutions.length, 4);
  assert.deepEqual(result.resolutions.map(item => item.status), ['resolved', 'resolved', 'resolved', 'not-found']);
  const host = result.contracts.find(item => item.release.contractId === f.entry.id);
  assert.equal(host.source.dependencies.length, 1);
  assert.equal(host.release.sourceHash, f.entry.sourceHash);
  assert.equal(result.resolutions[1].contractId, f.entry.id);
  assert.equal(result.contracts.some(item => item.contract), false);
});

test('conflicting main and set keys cannot choose one normative source silently', t => {
  const f = fixture(t, true);
  const result = service.resolveContracts({ components: [{ componentKey: 'host-key', componentSetKey: 'child-key' }] }, f.root);
  assert.deepEqual(result.contracts, []); assert.equal(result.resolutions[0].status, 'identity-conflict');
});

test('empty key batch verifies one release identity and rejects mixed revisions', t => {
  const f = fixture(t);
  const result = service.resolveContracts({ components: [], releaseId: f.manifest.id }, f.root);
  assert.deepEqual(result.contracts, []); assert.deepEqual(result.resolutions, []);
  assert.throws(() => service.resolveContracts({ components: [], releaseId: 'c'.repeat(64) }, f.root), error => error.status === 409);
});

test('invalid, oversized and missing component-key requests fail before resolution', t => {
  const f = fixture(t);
  for (const body of [null, {}, { components: 'all' }, { components: [{}] }, { components: [null] },
    { components: [{ componentKey: ['test-key'] }] }, { components: [{ componentKey: '../contract' }] },
    { components: [{ componentKey: 'a'.repeat(129) }] }, { components: Array.from({ length: 1001 }, () => ({ componentKey: 'test-key' })) },
    { components: [], releaseId: 'bad' }]) assert.throws(() => service.resolveContracts(body, f.root), error => error.status === 400);
});

function currentAuthoringRuntimeFixture(t) {
  const f = fixture(t);
  const runtimeFile = path.resolve(__dirname, '../../../projects/Apollo/dist/runtime.cjs');
  const bytes = fs.readFileSync(runtimeFile), api = require(runtimeFile);
  assert.equal(api.RUNTIME_VERSION, '0.4.1');
  const source = JSON.parse(fs.readFileSync(path.join(f.root, f.entry.file))), loaded = api.loadAuthoringSource(source);
  const cache = Buffer.from(JSON.stringify(loaded.contract));
  fs.writeFileSync(path.join(f.root, f.entry.compiledCache.file), cache);
  Object.assign(f.entry, { sourceHash: loaded.sourceHash, contractHash: api.contractHash(loaded.contract),
    manualSourceHash: loaded.contract.package.manualSourceHash, generatedFactsHash: loaded.contract.package.generatedFactsHash,
    revision: loaded.contract.package.manualRevision || loaded.contract.rules[0].revision,
    dependencies: api.collectContractDependencies(loaded.contract), compiledCache: { file: f.entry.compiledCache.file, sha256: sha(cache) } });
  fs.writeFileSync(path.join(f.root, 'runtime.cjs'), bytes);
  f.manifest.runtime = { file: 'runtime.cjs', sha256: sha(bytes), version: api.RUNTIME_VERSION };
  f.manifest.sourceSchema = api.SOURCE_SCHEMA; f.save();
  const identity = Object.assign({}, f.manifest); delete identity.id;
  assert.equal(f.manifest.id, sha(JSON.stringify(identity)));
  assert.equal(sha(fs.readFileSync(path.join(f.root, 'runtime.cjs'))), f.manifest.runtime.sha256);
  return { f, loaded, source };
}
test('current real 0.4.1 authoring runtime preserves source and compiled identity', t => {
  const { f, loaded, source } = currentAuthoringRuntimeFixture(t), result = service.readRelease(f.root);
  assert.equal(result.manifest.runtime.version, '0.4.1');
  assert.deepEqual(result.contracts[0].source, source); assert.deepEqual(result.contracts[0].contract, loaded.contract);
  assert.equal(result.contracts[0].release.sourceHash, loaded.sourceHash);
});
test('unsupported declared profile fails closed despite valid manifest and runtime checksums', t => {
  const { f } = currentAuthoringRuntimeFixture(t);
  f.manifest.runtime.version = '0.9.0'; f.save();
  assert.equal(sha(fs.readFileSync(path.join(f.root, 'runtime.cjs'))), f.manifest.runtime.sha256);
  assert.throws(() => service.readRelease(f.root), error => error.status === 503
    && error.code === 'CONTRACT_V4_INVALID' && error.message === 'Incompatible local contract release');
});
