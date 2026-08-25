const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const registry = require(path.join(
  __dirname,
  '..',
  'schemas',
  'apollo-predicate-capabilities.v1.json',
));
const { IMPLEMENTED_PREDICATES } = require('../src/predicate-engine');

test('predicate MVP registry is closed, unique and agent-independent', () => {
  assert.equal(registry.schemaVersion, 'apollo.predicate-capabilities.v1');
  assert.equal(registry.status, 'mvp');
  assert.equal(registry.semantics.unknownPolicy, 'fail-closed');
  assert.equal(registry.semantics.agentMayChangeVerdict, false);

  for (const key of ['selectors', 'factFamilies', 'predicates', 'gates', 'terminalClassifications']) {
    assert.ok(Array.isArray(registry[key]) && registry[key].length > 0, `${key} is required`);
  }

  const predicateIds = registry.predicates.map((predicate) => predicate.id);
  assert.equal(new Set(predicateIds).size, predicateIds.length);
  assert.equal(new Set(registry.selectors).size, registry.selectors.length);
  assert.equal(new Set(registry.factFamilies).size, registry.factFamilies.length);
  assert.deepEqual(
    new Set(predicateIds),
    IMPLEMENTED_PREDICATES,
    'every registered MVP predicate must be implemented and no private predicate may exist',
  );

  assert.deepEqual(
    new Set(registry.semantics.truthValues),
    new Set(['true', 'false', 'unknown']),
  );
  assert.deepEqual(
    new Set(registry.terminalClassifications),
    new Set(['violation', 'compliant', 'allowed', 'human-review', 'not-applicable', 'not-evaluable']),
  );
});

test('predicate MVP covers value, collection, relation, geometry and contract families', () => {
  const families = new Set(registry.predicates.map((predicate) => predicate.family));
  for (const family of ['logic', 'value', 'collection', 'relation', 'geometry', 'contract']) {
    assert.ok(families.has(family), `missing ${family} predicate family`);
  }
});
