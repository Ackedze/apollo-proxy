const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { auditMigrationWave } = require('../src/predicate-engine/migration-wave-audit');

const designSystemRoot = path.resolve(__dirname, '../../../shared/design-system_ab');

test('migration wave audit exposes freshness and production closure without changing runtime', () => {
  const audit = auditMigrationWave(designSystemRoot);
  assert.equal(audit.schemaVersion, 'apollo.predicate-migration-audit.v1');
  assert.equal(audit.waveId, 'wave-1-no-new-operators');
  assert.equal(audit.packages.length, 6);
  assert.equal(audit.packages.every((entry) => entry.contractFresh), true);
  assert.equal(audit.packages.every((entry) => !entry.duplicateSourceRuleIds.length), true);

  const benefits = audit.packages.find((entry) => entry.packageId === 'web-corp-promo.benefits');
  const backgroundPlate = audit.packages.find((entry) => entry.packageId === 'web-corp.background-plate');
  const buttonStack = audit.packages.find((entry) => entry.packageId === 'web-corp.button-stack');
  assert.equal(benefits.runtimeStatus, 'production-closed');
  assert.equal(backgroundPlate.runtimeStatus, 'production-closed');
  assert.equal(buttonStack.runtimeStatus, 'production-closed');
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
  assert.equal(benefits.missingRoutes.length, 0);
  assert.equal(buttonStack.missingRoutes.length, 0);
  assert.equal(backgroundPlate.sourceRuleCount, 27);
  assert.equal(backgroundPlate.missingRoutes.length, 0);
  assert.equal(audit.safeToPromote, false);
});
