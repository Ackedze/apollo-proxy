const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { auditMigrationWave } = require('../src/predicate-engine/migration-wave-audit');

const designSystemRoot = process.env.DESIGN_SYSTEM_AB_ROOT
  ? path.resolve(process.env.DESIGN_SYSTEM_AB_ROOT)
  : path.resolve(__dirname, '../../../shared/design-system_ab');

test('migration wave audit exposes freshness and production closure without changing runtime', () => {
  const audit = auditMigrationWave(designSystemRoot);
  assert.equal(audit.schemaVersion, 'apollo.predicate-migration-audit.v1');
  assert.equal(audit.waveId, 'wave-1-no-new-operators');
  assert.equal(audit.packages.length, 8);
  assert.equal(audit.packages.every(entry => entry.contractPath.startsWith('experiments/')), true);
  assert.equal(audit.packages.every((entry) => entry.contractFresh), true);
  assert.equal(audit.packages.every((entry) => !entry.duplicateSourceRuleIds.length), true);

  const benefits = audit.packages.find((entry) => entry.packageId === 'web-corp-promo.benefits');
  const backgroundPlate = audit.packages.find((entry) => entry.packageId === 'web-corp.background-plate');
  const buttonStack = audit.packages.find((entry) => entry.packageId === 'web-corp.button-stack');
  const statusProperty = audit.packages.find((entry) => entry.packageId === 'web-corp.status-property');
  const titleView = audit.packages.find((entry) => entry.packageId === 'web-corp.title-view');
  const amount = audit.packages.find((entry) => entry.packageId === 'web-core.amount');
  const tagGroup = audit.packages.find((entry) => entry.packageId === 'web-core.tag-group');
  const paymentMaskedNumber = audit.packages.find(
    (entry) => entry.packageId === 'web-corp.payment-masked-number',
  );
  assert.equal(benefits.runtimeStatus, 'production-closed');
  assert.equal(backgroundPlate.runtimeStatus, 'production-closed');
  assert.equal(buttonStack.runtimeStatus, 'production-closed');
  assert.equal(statusProperty.runtimeStatus, 'production-closed');
  assert.equal(titleView.runtimeStatus, 'production-closed');
  assert.equal(amount.runtimeStatus, 'production-closed');
  assert.equal(tagGroup.runtimeStatus, 'production-closed');
  assert.equal(paymentMaskedNumber.runtimeStatus, 'production-closed');
  assert.deepEqual(benefits.routes, {
    predicate: 3,
    composition: 0,
    delegated: 4,
    policy: 4,
    contextOnly: 8,
  });
  assert.deepEqual(buttonStack.routes, {
    predicate: 0,
    composition: 0,
    delegated: 5,
    policy: 5,
    contextOnly: 5,
  });
  assert.deepEqual(amount.routes, {
    predicate: 2,
    composition: 0,
    delegated: 0,
    policy: 0,
    contextOnly: 0,
  });
  assert.deepEqual(tagGroup.routes, {
    predicate: 1,
    composition: 0,
    delegated: 0,
    policy: 1,
    contextOnly: 0,
  });
  assert.deepEqual(paymentMaskedNumber.routes, {
    predicate: 9,
    composition: 0,
    delegated: 0,
    policy: 1,
    contextOnly: 2,
  });
  assert.equal(benefits.missingRoutes.length, 0);
  assert.equal(buttonStack.missingRoutes.length, 0);
  assert.equal(backgroundPlate.sourceRuleCount, 19);
  assert.equal(backgroundPlate.missingRoutes.length, 0);
  assert.deepEqual(backgroundPlate.productionPredicateBridgeRuleIds, []);
  assert.deepEqual(backgroundPlate.invalidProductionPredicateBridgeRuleIds, []);
  assert.deepEqual(backgroundPlate.blockingUnsupportedRuleIds, []);
  assert.equal(audit.safeToPromote, true);
});

const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

function syntheticMigration(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-migration-path-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'source');
  const rules = { manual: { rules: [], executionPolicy: {} } };
  const entry = { packageId: 'synthetic', sourcePath: 'JSONS/synthetic', contractPath: 'synthetic/compiled/component-contract.v2.json' };
  const manifest = { schemaVersion: 'apollo.contract-v2-migration-wave.v1', waveId: 'synthetic', status: 'draft', readyPackages: [entry], supportingPackages: [] };
  const manifestPath = path.join(root, 'experiments/migration-wave-1.json');
  const rulesPath = path.join(root, entry.sourcePath, 'rules.json');
  const contractPath = path.join(root, 'experiments', entry.contractPath);
  for (const f of [manifestPath, rulesPath, contractPath]) fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(rulesPath, JSON.stringify(rules));
  fs.writeFileSync(contractPath, JSON.stringify({ package: { sourceFiles: [{ file: 'JSONS/synthetic/rules.json', sha256: crypto.createHash('sha256').update(fs.readFileSync(rulesPath)).digest('hex') }] } }));
  const writeManifest = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  writeManifest();
  return { root, temporary, manifestPath, rulesPath, contractPath, manifest, entry, writeManifest };
}

test('BackgroundPlate migration artifact is reproducible from its current source rules', t => {
  const { buildPackageExperiment } = require(path.join(
    designSystemRoot, 'scripts/build_component_contract_v2_capability_experiments',
  ));
  const { classifyPackage, waveEntry } = require(path.join(
    designSystemRoot, 'scripts/classify_component_contract_v2_rule_execution',
  ));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-bg-migration-'));
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));
  const built = buildPackageExperiment({
    sourceLibrary: 'web-corp', sourceName: 'BackgroundPlate',
    targetName: 'BackgroundPlate', packageId: 'web-corp.background-plate',
    compositionRuleSources: {},
  }, outputRoot);
  const current = JSON.parse(fs.readFileSync(path.join(
    designSystemRoot, 'experiments', built.contractPath,
  ), 'utf8'));
  assert.deepEqual(current, JSON.parse(JSON.stringify(built.contract)));
  const classified = classifyPackage(built, new Set([
    'JSONS/web/components/web-corp/BackgroundPlate',
  ]), outputRoot);
  const manifest = JSON.parse(fs.readFileSync(path.join(
    designSystemRoot, 'experiments/migration-wave-1.json',
  ), 'utf8'));
  assert.deepEqual(manifest.readyPackages.find(entry =>
    entry.packageId === built.packageId), waveEntry(classified));
});

for (const field of ['sourcePath', 'contractPath']) {
  for (const invalid of ['../outside.json', '/outside.json', 'C:\\outside.json', 'synthetic\\outside.json', 'synthetic/../outside.json']) {
    test(`migration rejects escaping ${field}: ${invalid}`, t => {
      const fixture = syntheticMigration(t);
      fixture.entry[field] = invalid;
      fixture.writeManifest();
      assert.throws(() => auditMigrationWave(fixture.root), error => error.code === 'MIGRATION_PATH_INVALID');
    });
  }
}

for (const field of ['sourcePath', 'contractPath']) {
  test(`migration rejects ${field} symlink escaping its allowed root`, t => {
    const fixture = syntheticMigration(t);
    const outside = path.join(fixture.temporary, 'outside');
    fs.mkdirSync(outside);
    const link = field === 'sourcePath' ? path.join(fixture.root, 'JSONS/escape') : path.join(fixture.root, 'experiments/escape');
    fs.symlinkSync(outside, link);
    if (field === 'sourcePath') {
      fixture.entry.sourcePath = 'JSONS/escape';
    } else {
      fs.copyFileSync(fixture.contractPath, path.join(outside, 'contract.json'));
      fixture.entry.contractPath = 'escape/contract.json';
    }
    fixture.writeManifest();
    assert.throws(() => auditMigrationWave(fixture.root), error => error.code === 'MIGRATION_PATH_INVALID');
  });
}

test('migration does not fall back to an obsolete manifest tree', t => {
  const fixture = syntheticMigration(t);
  const old = path.join(fixture.root, 'JSONS/experiments/component-contract-v2/migration-wave-1.json');
  fs.mkdirSync(path.dirname(old), { recursive: true });
  fs.copyFileSync(fixture.manifestPath, old);
  fs.rmSync(fixture.manifestPath);
  assert.throws(() => auditMigrationWave(fixture.root), error => error.code === 'ENOENT');
});

test('migration does not substitute an obsolete compiled contract', t => {
  const fixture = syntheticMigration(t);
  const old = path.join(fixture.root, 'JSONS/experiments/component-contract-v2', fixture.entry.contractPath);
  fs.mkdirSync(path.dirname(old), { recursive: true });
  fs.copyFileSync(fixture.contractPath, old);
  fs.rmSync(fixture.contractPath);
  assert.throws(() => auditMigrationWave(fixture.root), error => error.code === 'ENOENT');
});

test('migration rejects missing rules before computing freshness', t => {
  const fixture = syntheticMigration(t);
  fs.rmSync(fixture.rulesPath);
  assert.throws(() => auditMigrationWave(fixture.root), error => error.code === 'ENOENT');
});

test('migration preserves rules byte pin failure and default-off manifest status', t => {
  const fixture = syntheticMigration(t);
  fs.appendFileSync(fixture.rulesPath, '\n');
  const audit = auditMigrationWave(fixture.root);
  assert.equal(audit.packages[0].contractFresh, false);
  assert.equal(audit.safeToPromote, false);
  assert.equal(audit.manifestStatus, 'draft');
});
