const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compileCompositionContract,
  compileSlotOrderPolicy,
} = require('../src/predicate-engine/composition-compiler');
const {
  addDeclaredCompositionFacts,
  addSlotOrderFacts,
} = require('../src/predicate-engine/snapshot-adapter');

function definition(overrides = {}) {
  return Object.assign({
    schemaVersion: 'apollo.composition-predicate-contract.v1',
    id: 'collection.composition',
    ruleKind: 'design-rule',
    authority: {
      status: 'active',
      provenance: 'design-system-author',
      revision: 3,
    },
    sourcePath: 'design-system_ab/JSONS/example/composition-contract.json',
    sourceChecksum: 'a'.repeat(64),
    scope: { platform: ['desktop'] },
    match: { hostComponentIdentities: ['example.collection'] },
    select: { nestedComponentIdentities: ['example.member'] },
    facts: {
      visibleMemberNodeIds: 'composition.visibleMemberNodeIds',
      siblingPropertyValuesPrefix: 'composition.siblingPropertyValues',
    },
    constraints: [{
      id: 'count',
      ruleId: 'component:example.collection.count',
      op: 'countBetween',
      min: 2,
      max: 4,
    }, {
      id: 'domain',
      ruleId: 'component:example.collection.domain',
      op: 'propertyDomain',
      property: 'View',
      values: ['Primary', 'Secondary'],
    }, {
      id: 'host',
      ruleId: 'component:example.collection.host',
      op: 'propertyEqualsHost',
      property: 'Size',
    }, {
      id: 'peer',
      ruleId: 'component:example.collection.peer',
      op: 'propertyEqualsFirst',
      property: 'Type',
    }, {
      id: 'position',
      ruleId: 'component:example.collection.position',
      op: 'valuePosition',
      property: 'SingleIcon',
      value: 'True',
      positions: ['last'],
      maxCount: 1,
      whenHostProperty: { property: 'Overflow', equals: 'true' },
    }],
  }, overrides);
}

test('composition compiler lowers supported source operations without component branches', () => {
  const rules = compileCompositionContract(definition());
  assert.equal(rules.length, 5);
  assert.equal(rules[0].assert.predicate, 'count-between');
  assert.equal(rules[0].assert.actual.fact, 'composition.visibleMemberNodeIds');
  assert.equal(rules[1].assert.predicate, 'one-of');
  assert.equal(rules[1].assert.actual.fact, 'component.properties.View');
  assert.equal(rules[2].assert.expected.fact, 'ownership.owner.component.properties.Size');
  assert.equal(rules[3].assert.predicate, 'all-equal');
  assert.equal(rules[3].assert.actual.fact, 'composition.siblingPropertyValues.Type');
  assert.equal(rules[4].assert.predicate, 'value-position');
  assert.equal(
    rules[4].assert.actual.fact,
    'composition.siblingPropertyValues.SingleIcon',
  );
  assert.equal(
    rules[4].when.actual.fact,
    'ownership.owner.component.properties.Overflow',
  );
  assert.deepEqual(
    rules[4].select.where[1].expected.literal,
    ['example.member'],
  );
  assert.equal(rules[4].source.checksum, 'a'.repeat(64));
});

test('declared composition contracts produce generic host and sibling facts', () => {
  const host = {
    id: 'host',
    type: 'INSTANCE',
    visible: true,
    order: 0,
    component: { identity: 'example.collection', properties: {} },
    ownership: {},
    unknownFacts: [],
  };
  const members = ['Primary', 'Secondary'].map((view, index) => ({
    id: `member-${index}`,
    type: 'INSTANCE',
    visible: true,
    order: index + 1,
    component: { identity: 'example.member', properties: { View: view } },
    ownership: { ownerNodeId: 'host' },
    unknownFacts: [],
  }));
  addDeclaredCompositionFacts([host, ...members], [definition()]);
  assert.deepEqual(host.composition.visibleMemberNodeIds, ['member-0', 'member-1']);
  assert.deepEqual(
    members[0].composition.siblingPropertyValues.View,
    ['Primary', 'Secondary'],
  );
  assert.equal(members[1].composition.position, 'last');
});

test('composition compiler rejects unsupported operations and incomplete authority', () => {
  const unsupported = definition({
    constraints: [{
      id: 'unknown',
      ruleId: 'component:example.collection.unknown',
      op: 'guessFromMessage',
    }],
  });
  assert.throws(
    () => compileCompositionContract(unsupported),
    /unsupported composition constraint op/,
  );
  assert.throws(
    () => compileCompositionContract(definition({
      authority: { status: 'draft', provenance: 'design-system-author' },
    })),
    /active design-rule authority/,
  );
});

function slotPolicy(overrides = {}) {
  return Object.assign({
    schemaVersion: 'apollo.slot-order-policy.v1',
    ruleId: 'component:example.panel.slot-order',
    ruleKind: 'design-rule',
    authority: {
      status: 'active',
      provenance: 'design-system-author',
      revision: 2,
    },
    sourcePath: 'design-system_ab/JSONS/example/composition-contract.json',
    sourceChecksum: 'b'.repeat(64),
    scope: { platform: ['desktop'] },
    ownerComponentIdentities: ['example.panel'],
    containerNames: ['Content'],
    required: true,
    order: ['Header', 'Body', 'Actions'],
  }, overrides);
}

test('slot order compiler and snapshot facts are identity-agnostic', () => {
  const policy = slotPolicy();
  const rule = compileSlotOrderPolicy(policy);
  assert.equal(rule.assert.args[0].predicate, 'after');
  assert.deepEqual(
    rule.select.where[0].expected.literal,
    ['example.panel'],
  );
  assert.equal(rule.source.checksum, 'b'.repeat(64));

  const nodes = addSlotOrderFacts([{
    id: '1:0',
    component: { identity: 'example.panel' },
    childIds: ['1:1'],
    unknownFacts: [],
  }, {
    id: '1:1',
    name: 'Content',
    childIds: ['1:2', '1:3'],
    unknownFacts: [],
  }, {
    id: '1:2',
    name: 'Body',
    visible: true,
    childIds: [],
    unknownFacts: [],
  }, {
    id: '1:3',
    name: 'Header',
    visible: true,
    childIds: [],
    unknownFacts: [],
  }], [policy]);
  const body = nodes.find((node) => node.id === '1:2');
  assert.equal(body.slot.ownerComponentIdentity, 'example.panel');
  assert.equal(body.composition.expectedPreviousSlotRole, 'Header');
  assert.equal(body.composition.expectedPreviousSlotNodeId, '1:3');
});

test('slot order compiler rejects prose-only or inactive policies', () => {
  assert.throws(
    () => compileSlotOrderPolicy(slotPolicy({ schemaVersion: undefined })),
    /unsupported schemaVersion/,
  );
  assert.throws(
    () => compileSlotOrderPolicy(slotPolicy({
      authority: { status: 'draft', provenance: 'design-system-author' },
    })),
    /active design-rule authority/,
  );
});
