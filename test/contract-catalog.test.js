'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const express = require('express');
const { sha } = require('../src/data-packages/artifacts');
const { buildStructureFromPatches, resolveStructure, readCatalogReference } = require('../src/contracts/catalog');

test('V3 patches preserve shallow replacement, order, ownership and immutable input', () => {
  const base = [{ id: 1, path: 'Base', layout: { width: 40, height: 30 }, referenceVariantOwnedProperties: ['visible'] },
    { id: 2, path: 'Base / Child', text: { characters: 'Old' } }, { id: 3, path: 'Base / Removed' }];
  const patches = [{ op: 'update', id: 1, value: { layout: { height: 64 }, opacity: null } },
    { op: 'remove', id: 3 }, { op: 'add', node: { id: 4, path: 'Base / Added', text: { characters: 'New' } } }];
  const original = JSON.stringify({ base, patches }), nodes = buildStructureFromPatches(base, patches);
  assert.deepEqual(nodes.map(node => node.id), [1, 2, 4]);
  assert.deepEqual(nodes[0].layout, { height: 64 });
  assert.deepEqual(nodes[0].referenceVariantOwnedProperties, ['layout.height', 'opacity', 'visible']);
  assert.deepEqual(nodes[2].referenceVariantOwnedProperties, ['text.characters']);
  assert.equal(JSON.stringify({ base, patches }), original);
});

test('V3 empty patches normalize root name and descendant paths', () => {
  const component = { structure: [{ id: 1, path: 'Base', name: 'Base' }, { id: 2, path: 'Base / Child' }, { id: 3, path: 'BaseLike / Foreign' }],
    variants: [{ key: 'v', name: ' Size=64 ' }], variantStructures: { v: [] } };
  const nodes = resolveStructure(component, 'v');
  assert.deepEqual(nodes.map(node => node.path), ['Size=64', 'Size=64 / Child', 'BaseLike / Foreign']);
  assert.equal(nodes[0].name, 'Base');
  assert.equal(component.structure[0].path, 'Base');
});

test('V3 duplicate add and absent update/remove retain original algorithm semantics', () => {
  const nodes = buildStructureFromPatches([{ id: 1, path: 'Base' }], [
    { op: 'update', id: 99, value: { visible: false } }, { op: 'remove', id: 99 },
    { op: 'add', node: { id: 1, path: 'Duplicate' } }, { op: 'update', id: 1, value: { visible: false } },
  ]);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].visible, false);
  assert.equal(nodes[1].visible, undefined);
  assert.equal(resolveStructure(null, 'missing'), null);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-raw-reference-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (file, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), bytes);
    return { file, sha256: sha(bytes), bytes: bytes.length };
  };
  const raw = { source: { exportVersion: 'synthetic-test', generatedAt: '2026-11-03T00:00:00Z' },
    components: [{ key: 'button-set', name: '[D] Button', platform: 'desktop', defaultVariant: 'default-variant',
      structure: [{ id: 1, parentId: null, path: 'Size=40', layout: { width: 40 } }, { id: 2, parentId: 1, path: 'Size=40 / Label' }],
      variants: [{ key: 'default-variant', name: 'Size=40' }, { key: 'size64', name: 'Size=64' }],
      variantStructures: { 'default-variant': [], size64: [{ op: 'update', id: 1, value: { layout: { width: 64 } } }] } },
    { key: 'unselected-set', name: 'Other', structure: [{ id: 100, path: 'Other' }] }],
    diagnostics: { warnings: [{ code: 'radius-preserved-from-previous-catalog', componentKey: 'button-set', variantKey: 'size64' },
      { code: 'unrelated', componentKey: 'unselected-set' }] } };
  const source = { manual: { component: { componentId: 'core.web.button', contractId: 'core.web.button' }, metadata: { revision: 31 },
    representations: [{ id: 'button.figma.desktop', kind: 'figma', locator: { componentSetKey: 'button-set' } },
      { id: 'button.code.desktop', kind: 'code', locator: { componentKey: 'button-set' } }],
    componentDependencies: [{ componentId: 'core.web.spinner', revision: 8 }] } };
  const rawPin = put('catalogs/raw.json', raw), sourcePin = put('sources/button.json', source);
  const index = { schemaVersion: 'apollo.data-index.v1', Ready: false,
    contracts: [{ id: 'core.web.button', componentId: 'core.web.button', revision: 31, ...sourcePin }],
    rawCatalogs: [{ contractId: 'core.web.button', componentId: 'core.web.button', revision: 31,
      representationIds: ['button.figma.desktop'], catalog: rawPin }] };
  function save() { delete index.id; index.id = sha(Buffer.from(JSON.stringify(index))); put('manifest.json', index); }
  save();
  const body = { releaseId: index.id, selection: { contractId: 'core.web.button', componentId: 'core.web.button', revision: 31,
    representationId: 'button.figma.desktop', componentKey: 'button-set', variantKey: 'size64' } };
  return { root, body, index, raw, source, rawPin, save, put };
}

test('installed raw reference returns selected V3 variant and pins without claiming configured/native facts', t => {
  const f = fixture(t);
  Object.assign(f.body.selection, { config: { ShowIcon: false }, modes: { appearance: 'Level-0' }, hostContext: { width: 1600 } });
  const result = readCatalogReference(f.body, f.root);
  assert.equal(result.structure.length, 2);
  assert.equal(result.structure[0].layout.width, 64);
  assert.equal(result.structure[1].path, 'Size=64 / Label');
  assert.equal(result.provenance.catalog.sha256, f.rawPin.sha256);
  assert.equal(result.provenance.contract.sha256, f.index.contracts[0].sha256);
  assert.deepEqual(result.dependencies, [{ componentId: 'core.web.spinner', revision: 8 }]);
  assert.deepEqual(result.completeness, { structure: 'assembled', facts: 'partial', nativeCorrespondence: 'unproven',
    config: 'unresolved', modes: 'unresolved', hostContext: 'unresolved', configuredReference: false, issues: [] });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(JSON.stringify(result).includes('unselected-set'), false);
  assert.equal(result.referenceHash.length, 64);
});

test('actual variant identity is accepted but an unspecified/default or foreign variant never falls back', t => {
  const f = fixture(t);
  delete f.body.selection.variantKey;
  assert.throws(() => readCatalogReference(f.body, f.root), { code: 'CATALOG_VARIANT_REQUIRED' });
  f.body.selection.componentKey = 'size64';
  assert.equal(readCatalogReference(f.body, f.root).variant.key, 'size64');
  f.body.selection.variantKey = 'missing';
  assert.throws(() => readCatalogReference(f.body, f.root), { code: 'CATALOG_COMPONENT_MISMATCH' });
});

test('code representation, absent descriptors, wrong revision and changed release fail explicitly', t => {
  const f = fixture(t), body = structuredClone(f.body);
  body.selection.representationId = 'button.code.desktop';
  assert.throws(() => readCatalogReference(body, f.root), { code: 'CATALOG_REPRESENTATION_UNAVAILABLE' });
  body.selection = { ...f.body.selection, revision: 32 };
  assert.throws(() => readCatalogReference(body, f.root), { code: 'CATALOG_CONTRACT_UNAVAILABLE' });
  body.selection = f.body.selection; body.releaseId = 'a'.repeat(64);
  assert.throws(() => readCatalogReference(body, f.root), { code: 'CONTRACT_V4_RELEASE_CHANGED' });
  delete f.index.rawCatalogs; f.save(); delete f.body.releaseId;
  assert.throws(() => readCatalogReference(f.body, f.root), { code: 'CATALOG_REFERENCE_UNAVAILABLE' });
});

test('unknown patch coverage does not substitute base structure', t => {
  const f = fixture(t);
  delete f.raw.components[0].variantStructures.size64;
  Object.assign(f.rawPin, f.put(f.rawPin.file, f.raw)); f.save(); delete f.body.releaseId;
  assert.throws(() => readCatalogReference(f.body, f.root), { code: 'CATALOG_VARIANT_PATCH_UNAVAILABLE' });
});

test('immutable catalog hashes and safe reader paths remain enforced', t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, f.rawPin.file), ' ');
  assert.throws(() => readCatalogReference(f.body, f.root), { code: 'DATA_PACKAGE_STALE' });
  f.rawPin.file = '../outside.json'; f.save(); delete f.body.releaseId;
  assert.throws(() => readCatalogReference(f.body, f.root), { code: 'DATA_PACKAGE_INVALID' });
});

test('duplicate nodes and orphan topology are explicit incomplete reference evidence', t => {
  const f = fixture(t);
  f.raw.components[0].variantStructures.size64.push({ op: 'add', node: { id: 2, parentId: 999, path: 'Size=64 / Orphan' } });
  Object.assign(f.rawPin, f.put(f.rawPin.file, f.raw)); f.save(); delete f.body.releaseId;
  const result = readCatalogReference(f.body, f.root);
  assert.equal(result.structure.length, 3);
  assert.equal(result.completeness.structure, 'incomplete');
  assert.deepEqual(result.completeness.issues.map(issue => issue.code), ['DUPLICATE_NODE_ID', 'MISSING_PARENT']);
});

test('V3 paint/layout normalization precedes shallow patches and records normalized ownership', t => {
  const f = fixture(t);
  f.raw.components[0].structure[0].fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, tokenKey: 'base-red' }];
  Object.assign(f.raw.components[0].variantStructures.size64[0].value, {
    fills: [{ type: 'SOLID', visible: false, tokenKey: 'hidden-token', color: '#HIDDEN' },
      { type: 'SOLID', color: { r: 0, g: 0.5, b: 1, a: 0.456 } }],
    strokeWeight: 2, strokeAlign: 'INSIDE', strokes: [{ type: 'SOLID', color: '#000', boundVariables: { color: { variable: { key: 'stroke-key' } } } }],
    layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG',
  });
  Object.assign(f.rawPin, f.put(f.rawPin.file, f.raw)); f.save(); delete f.body.releaseId;
  const node = readCatalogReference(f.body, f.root).structure[0];
  assert.deepEqual(node.fill, { token: 'hidden-token', color: 'rgba(0,128,255,0.46)' });
  assert.deepEqual(node.stroke, { token: 'stroke-key', color: '#000', weight: 2, align: 'INSIDE' });
  assert.deepEqual(node.layout, { width: 64, sizing: { horizontal: 'FILL', vertical: 'HUG' } });
  for (const property of ['fill.color', 'fill.token', 'stroke.align', 'stroke.token', 'layout.sizing.horizontal']) {
    assert.ok(node.referenceVariantOwnedProperties.includes(property), property);
  }
});

test('native fact extensions and unknown raw fields survive resolution unchanged', t => {
  const f = fixture(t), component = f.raw.components[0];
  component.nativeAuditV1 = { schemaVersion: 'synthetic.v1', selected: { primaryAxis: 'HORIZONTAL' }, futureExtension: [1, 2] };
  component.structure[1].nativeAuditFactsV1 = { font: { family: 'Test' }, unknownFact: { a: 1 } };
  component.structure[1].unknownNodeExtension = ['retained'];
  Object.assign(f.rawPin, f.put(f.rawPin.file, f.raw)); f.save(); delete f.body.releaseId;
  const result = readCatalogReference(f.body, f.root);
  assert.deepEqual(result.component.nativeAuditV1, component.nativeAuditV1);
  assert.deepEqual(result.structure[1].nativeAuditFactsV1, component.structure[1].nativeAuditFactsV1);
  assert.deepEqual(result.structure[1].unknownNodeExtension, ['retained']);
  assert.equal(result.component.variantStructures, undefined);
  assert.equal(result.componentId, 'core.web.button');
  assert.equal(result.revision, 31);
});

test('ignored V3 patch operations remain visible as incomplete evidence', t => {
  const f = fixture(t);
  f.raw.components[0].variantStructures.size64.push({ op: 'update', id: 999, value: { visible: false } }, { op: 'future-operation' });
  Object.assign(f.rawPin, f.put(f.rawPin.file, f.raw)); f.save(); delete f.body.releaseId;
  const result = readCatalogReference(f.body, f.root);
  assert.equal(result.structure.length, 2);
  assert.equal(result.completeness.structure, 'incomplete');
  assert.deepEqual(result.completeness.issues.map(issue => issue.code), ['PATCH_TARGET_UNAVAILABLE', 'PATCH_OPERATION_UNSUPPORTED']);
});

test('catalog HTTP route uses only installed index, preserves selection and never calls model explanation', async t => {
  const f = fixture(t), app = express(); let modelCalls = 0;
  app.use(express.json());
  require('../src/contracts/service').mountContractRoutes(app, { releaseRoot: f.root, explain() { modelCalls++; throw Error('MODEL_MUST_NOT_RUN'); } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/v2/contracts/catalog-resolve`;
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f.body) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.equal(result.schemaVersion, 'apollo.catalog-reference.v1');
  assert.deepEqual(result.selection, f.body.selection);
  const bad = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f.body, selection: { ...f.body.selection, forged: true } }) });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'CATALOG_REQUEST_INVALID');
  assert.equal(modelCalls, 0);
});

test('catalog reader requires explicit installed root rather than a repository or legacy fallback', t => {
  const f = fixture(t);
  assert.throws(() => readCatalogReference(f.body), { code: 'CATALOG_REFERENCE_NOT_INSTALLED' });
  const catalog = path.join(f.root, f.rawPin.file), outside = path.join(f.root, 'outside.json');
  fs.renameSync(catalog, outside); fs.symlinkSync(outside, catalog);
  assert.throws(() => readCatalogReference(f.body, f.root), { code: 'DATA_PACKAGE_INVALID' });
});
