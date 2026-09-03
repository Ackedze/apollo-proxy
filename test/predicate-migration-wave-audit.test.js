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
  assert.equal(backgroundPlate.sourceRuleCount, 30);
  assert.equal(backgroundPlate.missingRoutes.length, 0);
  assert.deepEqual(backgroundPlate.productionPredicateBridgeRuleIds, [
    'component:web-corp.background-plate.platform-version-must-match',
    'component:web-corp.background-plate.slot-content-levels',
  ]);
  assert.deepEqual(backgroundPlate.invalidProductionPredicateBridgeRuleIds, []);
  assert.deepEqual(backgroundPlate.blockingUnsupportedRuleIds, []);
  assert.equal(audit.safeToPromote, true);
});
