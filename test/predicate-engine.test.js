const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  IMPLEMENTED_PREDICATES,
  evaluateRules,
  stableStringify,
  validateRule,
} = require('../src/predicate-engine');

function node(overrides = {}) {
  return {
    id: '1:1',
    parentId: null,
    childIds: [],
    order: 0,
    path: 'Test / Button',
    name: '[D] Button',
    type: 'INSTANCE',
    visible: true,
    bounds: { x: 0, y: 0, width: 120, height: 40 },
    component: {
      key: 'button-key',
      identity: 'web-core.button',
      lifecycle: 'active',
      properties: { View: 'Primary', Size: '40' },
    },
    layout: {},
    appearance: {},
    bindings: {},
    baseline: {},
    overrides: [],
    unknownFacts: [],
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  const testNode = overrides.testNode || node();
  return {
    schemaVersion: 'apollo.predicate-snapshot.v2',
    auditId: 'predicate-audit-1',
    generatedAt: '2026-08-22T00:00:00.000Z',
    context: {
      fileKey: 'file-key',
      pageId: '0:1',
      platform: 'desktop',
      pageType: 'form',
    },
    release: {
      knowledgeSource: 'design-system_ab',
      revision: 'test-release',
      checksum: 'test-checksum',
    },
    selection: [testNode.id],
    nodes: [testNode],
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'testNode')),
  };
}

function rule(predicate, actual, expected, overrides = {}) {
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: `rule:test.${predicate}`,
    revision: 1,
    source: { path: 'fixtures/rules.json', checksum: 'rule-checksum' },
    authority: { status: 'active', provenance: 'design-system-author' },
    effect: 'require',
    scope: { platform: ['desktop'], pageType: ['form'] },
    select: { from: 'selection-root', traverse: 'self', where: [] },
    assert: {
      predicate,
      actual: { fact: actual },
      ...(expected === undefined ? {} : { expected: { literal: expected } }),
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
    ...overrides,
  };
}

function evaluate(testSnapshot, testRule) {
  return evaluateRules({
    snapshot: testSnapshot,
    rules: [testRule],
    ruleRelease: 'predicate-tests-v1',
  }).evaluations[0];
}

test('product scope is evaluated against the explicit snapshot Product', () => {
  const productRule = rule('equals', 'component.properties.View', 'Primary', {
    scope: { platform: ['desktop'], pageType: ['form'], product: ['ab'] },
  });
  const matching = snapshot({
    context: { fileKey: 'file-key', pageId: '0:1', platform: 'desktop', pageType: 'form', product: 'ab' },
  });
  const different = snapshot({
    context: { fileKey: 'file-key', pageId: '0:1', platform: 'desktop', pageType: 'form', product: 'ao' },
  });
  const missing = snapshot();

  assert.equal(evaluate(matching, productRule).classification, 'compliant');
  const differentResult = evaluate(different, productRule);
  const missingResult = evaluate(missing, productRule);
  assert.equal(differentResult.classification, 'not-applicable');
  assert.equal(differentResult.trace.reason, 'rule product scope does not apply');
  assert.equal(differentResult.trace.actual, 'ao');
  assert.deepEqual(differentResult.trace.expected, ['ab']);
  assert.deepEqual(differentResult.trace.factPaths, ['page.context.product']);
  assert.equal(missingResult.classification, 'not-evaluable');
  assert.equal(missingResult.applicability, 'unknown');
  assert.equal(missingResult.trace.actual.state, 'absent');
});

test('every scope dimension uses three-valued applicability', () => {
  for (const dimension of ['platform', 'product', 'channel', 'pageType']) {
    const scoped = rule('equals', 'component.properties.View', 'Primary', {scope: {[dimension]: ['matching']}});
    for (const value of [undefined, null, '', 42, ['matching']]) {
      const result = evaluate(snapshot({context: {[dimension]: value}}), scoped);
      assert.equal(result.classification, 'not-evaluable', `${dimension}: ${JSON.stringify(value)}`);
      assert.equal(result.trace.truth, 'unknown');
    }
    assert.equal(evaluate(snapshot({context: {[dimension]: 'matching'}}), scoped).classification, 'compliant');
    assert.equal(evaluate(snapshot({context: {[dimension]: 'different'}}), scoped).classification, 'not-applicable');
    const unknown = evaluate(snapshot({context: {[dimension]: 'different', unknownFacts: [dimension]}}), scoped);
    assert.equal(unknown.applicability, 'unknown');
    assert.equal(unknown.trace.actual.state, 'unknown');
  }
});

test('known false scope or condition dominates missing context in conjunction', () => {
  const scoped = rule('equals', 'component.properties.View', 'Primary', {scope: {product: ['ab'], channel: ['adaptive']}});
  assert.equal(evaluate(snapshot({context: {channel: 'desktop'}}), scoped).classification, 'not-applicable');
  scoped.when = {predicate: 'equals', actual: {fact: 'component.properties.View'}, expected: {literal: 'Text'}, missingPolicy: 'unknown'};
  assert.equal(evaluate(snapshot({context: {}}), scoped).classification, 'not-applicable');
});

test('empty scope means all, not missing evidence', () => {
  const unscoped = rule('equals', 'component.properties.View', 'Primary', {scope: {product: [], channel: []}});
  assert.equal(evaluate(snapshot({context: {}}), unscoped).classification, 'compliant');
});

test('fact-present distinguishes a known null from an absent or unknown fact', () => {
  const testRule = rule('fact-present', 'baseline.effective.appearance.stroke.value');

  const knownNull = evaluate(snapshot({
    testNode: node({
      baseline: { effective: { appearance: { stroke: { value: null } } } },
    }),
  }), testRule);
  assert.equal(knownNull.classification, 'compliant');
  assert.equal(knownNull.trace.truth, 'true');
  assert.equal(knownNull.trace.actual, null);

  const absent = evaluate(snapshot({ testNode: node() }), testRule);
  assert.equal(absent.classification, 'violation');
  assert.equal(absent.trace.truth, 'false');

  const unknown = evaluate(snapshot({
    testNode: node({
      unknownFacts: ['baseline.effective.appearance.stroke.value'],
    }),
  }), testRule);
  assert.equal(unknown.classification, 'not-evaluable');
  assert.equal(unknown.trace.truth, 'unknown');
});

for (const fixture of [
  {
    predicate: 'exists',
    actual: 'component.properties.View',
    expected: undefined,
    passNode: node(),
    failNode: node({ component: { key: 'button-key', identity: 'web-core.button', lifecycle: 'active', properties: {} } }),
  },
  {
    predicate: 'equals',
    actual: 'component.properties.View',
    expected: 'Primary',
    passNode: node(),
    failNode: node({ component: { key: 'button-key', identity: 'web-core.button', lifecycle: 'active', properties: { View: 'Secondary' } } }),
  },
  {
    predicate: 'one-of',
    actual: 'component.properties.View',
    expected: ['Primary', 'Secondary'],
    passNode: node(),
    failNode: node({ component: { key: 'button-key', identity: 'web-core.button', lifecycle: 'active', properties: { View: 'Accent' } } }),
  },
  {
    predicate: 'not-equals',
    actual: 'component.properties.View',
    expected: 'Accent',
    passNode: node(),
    failNode: node({ component: { key: 'button-key', identity: 'web-core.button', lifecycle: 'active', properties: { View: 'Accent' } } }),
  },
  {
    predicate: 'none-of',
    actual: 'component.properties.View',
    expected: ['Accent', 'Text'],
    passNode: node(),
    failNode: node({ component: { key: 'button-key', identity: 'web-core.button', lifecycle: 'active', properties: { View: 'Accent' } } }),
  },
]) {
  test(`${fixture.predicate} has PASS, FAIL, UNKNOWN and NOT-APPLICABLE semantics`, () => {
    const testRule = rule(fixture.predicate, fixture.actual, fixture.expected);

    const pass = evaluate(snapshot({ testNode: fixture.passNode }), testRule);
    assert.equal(pass.applicability, 'applicable');
    assert.equal(pass.classification, 'compliant');
    assert.equal(pass.trace.truth, 'true');
    assert.equal(pass.focusNodeId, fixture.passNode.id);

    const fail = evaluate(snapshot({ testNode: fixture.failNode }), testRule);
    assert.equal(fail.applicability, 'applicable');
    assert.equal(fail.classification, 'violation');
    assert.equal(fail.trace.truth, 'false');

    const unknownNode = node({ unknownFacts: ['component.properties.View'] });
    const unknown = evaluate(snapshot({ testNode: unknownNode }), testRule);
    assert.equal(unknown.applicability, 'applicable');
    assert.equal(unknown.classification, 'not-evaluable');
    assert.equal(unknown.trace.truth, 'unknown');

    const notApplicableSnapshot = snapshot({
      testNode: fixture.passNode,
      context: {
        fileKey: 'file-key',
        pageId: '0:1',
        platform: 'desktop',
        pageType: 'landing',
      },
    });
    const notApplicable = evaluate(notApplicableSnapshot, testRule);
    assert.equal(notApplicable.applicability, 'not-applicable');
    assert.equal(notApplicable.classification, 'not-applicable');
  });
}

for (const fixture of [
  {
    predicate: 'contains',
    actualFact: 'bounds',
    targetFact: 'layout.targetBounds',
    passNode: node({ bounds: { x: 0, y: 0, width: 100, height: 100 }, layout: { targetBounds: { x: 10, y: 10, width: 40, height: 40 } } }),
    failNode: node({ bounds: { x: 0, y: 0, width: 100, height: 100 }, layout: { targetBounds: { x: 80, y: 80, width: 40, height: 40 } } }),
    extra: {},
  },
  {
    predicate: 'overlaps',
    actualFact: 'bounds',
    targetFact: 'layout.targetBounds',
    passNode: node({ bounds: { x: 0, y: 0, width: 100, height: 100 }, layout: { targetBounds: { x: 80, y: 80, width: 40, height: 40 } } }),
    failNode: node({ bounds: { x: 0, y: 0, width: 100, height: 100 }, layout: { targetBounds: { x: 120, y: 120, width: 40, height: 40 } } }),
    extra: {},
  },
  {
    predicate: 'aligned',
    actualFact: 'bounds',
    targetFact: 'layout.targetBounds',
    passNode: node({ bounds: { x: 0, y: 0, width: 100, height: 100 }, layout: { targetBounds: { x: 1, y: 120, width: 40, height: 40 } } }),
    failNode: node({ bounds: { x: 0, y: 0, width: 100, height: 100 }, layout: { targetBounds: { x: 8, y: 120, width: 40, height: 40 } } }),
    extra: { axis: 'left', tolerance: 2 },
  },
  {
    predicate: 'distance',
    actualFact: 'bounds',
    targetFact: 'layout.targetBounds',
    passNode: node({ bounds: { x: 0, y: 0, width: 100, height: 100 }, layout: { targetBounds: { x: 0, y: 132, width: 100, height: 40 } } }),
    failNode: node({ bounds: { x: 0, y: 0, width: 100, height: 100 }, layout: { targetBounds: { x: 0, y: 148, width: 100, height: 40 } } }),
    extra: { axis: 'vertical', expected: { literal: 32 } },
  },
]) {
  test(`${fixture.predicate} has PASS, FAIL, UNKNOWN and NOT-APPLICABLE semantics`, () => {
    const expression = {
      predicate: fixture.predicate,
      actual: { fact: fixture.actualFact },
      target: { fact: fixture.targetFact },
      ...fixture.extra,
    };
    const testRule = rule(fixture.predicate, fixture.actualFact, undefined, { assert: expression });
    assert.equal(evaluate(snapshot({ testNode: fixture.passNode }), testRule).classification, 'compliant');
    assert.equal(evaluate(snapshot({ testNode: fixture.failNode }), testRule).classification, 'violation');
    assert.equal(evaluate(snapshot({ testNode: node({ unknownFacts: [fixture.targetFact] }) }), testRule).classification, 'not-evaluable');
    assert.equal(evaluate(snapshot({
      testNode: fixture.passNode,
      context: { fileKey: 'file-key', pageId: '0:1', platform: 'desktop', pageType: 'landing' },
    }), testRule).classification, 'not-applicable');
  });
}

for (const fixture of [
  {
    predicate: 'component-api-valid',
    fact: 'component.api',
    expected: undefined,
    passNode: node({ component: { api: { valid: true } } }),
    failNode: node({ component: { api: { valid: false, reason: 'unsupported-property' } } }),
  },
  {
    predicate: 'matches-effective-baseline',
    fact: 'appearance.fill',
    expected: { fact: 'baseline.effective.appearance.fill' },
    passNode: node({ appearance: { fill: 'text/primary' }, baseline: { effective: { appearance: { fill: 'text/primary' } } } }),
    failNode: node({ appearance: { fill: 'text/secondary' }, baseline: { effective: { appearance: { fill: 'text/primary' } } } }),
  },
  {
    predicate: 'binding-satisfies',
    fact: 'bindings.padding.top',
    expected: { literal: { collection: 'Spacing', token: '32' } },
    passNode: node({ bindings: { padding: { top: { collection: 'Spacing', token: '32', variableId: 'v:32' } } } }),
    failNode: node({ bindings: { padding: { top: { collection: 'Spacing', token: '24', variableId: 'v:24' } } } }),
  },
  {
    predicate: 'paint-state-satisfies',
    fact: 'appearance.fillState',
    expected: { literal: { visible: false, tokenized: false } },
    passNode: node({ appearance: { fillState: { visible: false, tokenized: false, paints: [] } } }),
    failNode: node({ appearance: { fillState: { visible: true, tokenized: true, paints: ['base-bg/primary'] } } }),
  },
]) {
  test(`${fixture.predicate} has PASS, FAIL, UNKNOWN and NOT-APPLICABLE semantics`, () => {
    const expression = {
      predicate: fixture.predicate,
      actual: { fact: fixture.fact },
      ...(fixture.expected ? { expected: fixture.expected } : {}),
    };
    const testRule = rule(fixture.predicate, fixture.fact, undefined, { assert: expression });
    assert.equal(evaluate(snapshot({ testNode: fixture.passNode }), testRule).classification, 'compliant');
    assert.equal(evaluate(snapshot({ testNode: fixture.failNode }), testRule).classification, 'violation');
    assert.equal(evaluate(snapshot({ testNode: node({ unknownFacts: [fixture.fact] }) }), testRule).classification, 'not-evaluable');
    assert.equal(evaluate(snapshot({
      testNode: fixture.passNode,
      context: { fileKey: 'file-key', pageId: '0:1', platform: 'desktop', pageType: 'landing' },
    }), testRule).classification, 'not-applicable');
  });
}

function relationNodes() {
  return [
    node({ id: '1:0', childIds: ['1:1', '1:2'], name: 'Root', path: 'Root', order: 0 }),
    node({ id: '1:1', parentId: '1:0', childIds: ['1:3'], name: 'A', path: 'Root / A', order: 1 }),
    node({ id: '1:2', parentId: '1:0', name: 'B', path: 'Root / B', order: 2 }),
    node({ id: '1:3', parentId: '1:1', name: 'C', path: 'Root / A / C', order: 3 }),
  ];
}

for (const fixture of [
  { predicate: 'direct-parent', actualId: '1:1', passExpectedId: '1:0', failExpectedId: '1:2' },
  { predicate: 'ancestor', actualId: '1:3', passExpectedId: '1:0', failExpectedId: '1:2' },
  { predicate: 'direct-child', actualId: '1:0', passExpectedId: '1:1', failExpectedId: '1:3' },
  { predicate: 'descendant', actualId: '1:1', passExpectedId: '1:3', failExpectedId: '1:2' },
  { predicate: 'before', actualId: '1:1', passExpectedId: '1:2', failExpectedId: '1:3' },
  { predicate: 'after', actualId: '1:2', passExpectedId: '1:1', failExpectedId: '1:3' },
  { predicate: 'adjacent', actualId: '1:1', passExpectedId: '1:2', failExpectedId: '1:3' },
]) {
  test(`${fixture.predicate} has PASS, FAIL, UNKNOWN and NOT-APPLICABLE semantics`, () => {
    const testRule = rule(fixture.predicate, 'id', fixture.passExpectedId);
    const nodes = relationNodes();
    const passSnapshot = snapshot({ selection: [fixture.actualId], nodes });
    assert.equal(evaluate(passSnapshot, testRule).classification, 'compliant');

    const failRule = rule(fixture.predicate, 'id', fixture.failExpectedId);
    assert.equal(evaluate(passSnapshot, failRule).classification, 'violation');

    const unknownNodes = relationNodes().map((item) => (
      item.id === fixture.actualId ? { ...item, unknownFacts: ['id'] } : item
    ));
    assert.equal(evaluate(snapshot({ selection: [fixture.actualId], nodes: unknownNodes }), testRule).classification, 'not-evaluable');

    assert.equal(evaluate(snapshot({
      selection: [fixture.actualId],
      nodes,
      context: { fileKey: 'file-key', pageId: '0:1', platform: 'desktop', pageType: 'landing' },
    }), testRule).classification, 'not-applicable');
  });
}

test('compare has PASS, FAIL, UNKNOWN and NOT-APPLICABLE semantics', () => {
  const testRule = rule('compare', 'layout.itemSpacing', 24, {
    assert: {
      predicate: 'compare',
      actual: { fact: 'layout.itemSpacing' },
      operator: 'gte',
      expected: { literal: 24 },
    },
  });
  assert.equal(evaluate(snapshot({ testNode: node({ layout: { itemSpacing: 32 } }) }), testRule).classification, 'compliant');
  assert.equal(evaluate(snapshot({ testNode: node({ layout: { itemSpacing: 12 } }) }), testRule).classification, 'violation');
  assert.equal(evaluate(snapshot({ testNode: node({ layout: { itemSpacing: '32' } }) }), testRule).classification, 'not-evaluable');
  assert.equal(evaluate(snapshot({
    testNode: node({ layout: { itemSpacing: 32 } }),
    context: { fileKey: 'file-key', pageId: '0:1', platform: 'desktop', pageType: 'landing' },
  }), testRule).classification, 'not-applicable');
});

test('between has PASS, FAIL, UNKNOWN and NOT-APPLICABLE semantics', () => {
  const testRule = rule('between', 'layout.itemSpacing', undefined, {
    assert: {
      predicate: 'between',
      actual: { fact: 'layout.itemSpacing' },
      lower: { literal: 16 },
      upper: { literal: 32 },
      bounds: 'inclusive',
    },
  });
  assert.equal(evaluate(snapshot({ testNode: node({ layout: { itemSpacing: 24 } }) }), testRule).classification, 'compliant');
  assert.equal(evaluate(snapshot({ testNode: node({ layout: { itemSpacing: 48 } }) }), testRule).classification, 'violation');
  assert.equal(evaluate(snapshot({ testNode: node({ unknownFacts: ['layout.itemSpacing'] }) }), testRule).classification, 'not-evaluable');
  assert.equal(evaluate(snapshot({
    testNode: node({ layout: { itemSpacing: 24 } }),
    context: { fileKey: 'file-key', pageId: '0:1', platform: 'desktop', pageType: 'landing' },
  }), testRule).classification, 'not-applicable');
});

test('equals compares actual and owner facts without asking the agent to resolve ownership', () => {
  const testRule = rule('equals', 'component.properties.Size', undefined, {
    ruleId: 'component:web-corp.buttons-group.uniform-size',
    assert: {
      predicate: 'equals',
      actual: { fact: 'component.properties.Size' },
      expected: { fact: 'ownership.owner.component.properties.Size' },
    },
  });
  const button = node({
    component: { key: 'button-key', identity: 'web-core.button', lifecycle: 'active', properties: { View: 'Primary', Size: '40' } },
    ownership: {
      ownerNodeId: '1:0',
      owner: { component: { identity: 'web-corp.buttons-group', properties: { Size: '40' } } },
    },
  });
  const compliant = evaluate(snapshot({ testNode: button }), testRule);
  assert.equal(compliant.classification, 'compliant');
  assert.deepEqual(compliant.trace.factPaths, [
    'component.properties.Size',
    'ownership.owner.component.properties.Size',
  ]);

  const violation = evaluate(snapshot({
    testNode: {
      ...button,
      ownership: {
        ...button.ownership,
        owner: { component: { identity: 'web-corp.buttons-group', properties: { Size: '56' } } },
      },
    },
  }), testRule);
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.trace.actual, '40');
  assert.equal(violation.trace.expected, '56');
});

test('all, any and not use deterministic three-valued logic', () => {
  const expressionRule = rule('all', undefined, undefined, {
    assert: {
      predicate: 'all',
      args: [
        { predicate: 'equals', actual: { fact: 'component.properties.View' }, expected: { literal: 'Primary' } },
        { predicate: 'one-of', actual: { fact: 'component.properties.Size' }, expected: { literal: ['40', '56'] } },
      ],
    },
  });
  assert.equal(evaluate(snapshot({ testNode: node({
    component: { key: 'button-key', identity: 'web-core.button', lifecycle: 'active', properties: { View: 'Primary', Size: '40' } },
  }) }), expressionRule).trace.truth, 'true');
  assert.equal(evaluate(snapshot({ testNode: node({
    component: { key: 'button-key', identity: 'web-core.button', lifecycle: 'active', properties: { View: 'Secondary', Size: '40' } },
  }) }), expressionRule).trace.truth, 'false');
  assert.equal(evaluate(snapshot({ testNode: node({ unknownFacts: ['component.properties.Size'] }) }), expressionRule).trace.truth, 'unknown');

  const anyRule = {
    ...expressionRule,
    assert: { ...expressionRule.assert, predicate: 'any' },
  };
  assert.equal(evaluate(snapshot(), anyRule).trace.truth, 'true');

  const notRule = {
    ...expressionRule,
    assert: { predicate: 'not', args: [expressionRule.assert.args[0]] },
  };
  assert.equal(evaluate(snapshot(), notRule).trace.truth, 'false');
});

for (const fixture of [
  {
    predicate: 'all',
    expression: {
      predicate: 'all',
      args: [
        { predicate: 'equals', actual: { fact: 'component.properties.View' }, expected: { literal: 'Primary' } },
        { predicate: 'equals', actual: { fact: 'component.properties.Size' }, expected: { literal: '40' } },
      ],
    },
    passNode: node(),
    failNode: node({ component: { properties: { View: 'Secondary', Size: '40' } } }),
    unknownNode: node({ unknownFacts: ['component.properties.Size'] }),
  },
  {
    predicate: 'any',
    expression: {
      predicate: 'any',
      args: [
        { predicate: 'equals', actual: { fact: 'component.properties.View' }, expected: { literal: 'Primary' } },
        { predicate: 'equals', actual: { fact: 'component.properties.Size' }, expected: { literal: '56' } },
      ],
    },
    passNode: node(),
    failNode: node({ component: { properties: { View: 'Secondary', Size: '40' } } }),
    unknownNode: node({
      component: { properties: { View: 'Secondary', Size: '40' } },
      unknownFacts: ['component.properties.Size'],
    }),
  },
  {
    predicate: 'not',
    expression: {
      predicate: 'not',
      args: [
        { predicate: 'equals', actual: { fact: 'component.properties.View' }, expected: { literal: 'Accent' } },
      ],
    },
    passNode: node(),
    failNode: node({ component: { properties: { View: 'Accent', Size: '40' } } }),
    unknownNode: node({ unknownFacts: ['component.properties.View'] }),
  },
]) {
  test(`${fixture.predicate} has PASS, FAIL, UNKNOWN and NOT-APPLICABLE semantics`, () => {
    const testRule = rule(fixture.predicate, undefined, undefined, { assert: fixture.expression });
    assert.equal(evaluate(snapshot({ testNode: fixture.passNode }), testRule).classification, 'compliant');
    assert.equal(evaluate(snapshot({ testNode: fixture.failNode }), testRule).classification, 'violation');
    assert.equal(evaluate(snapshot({ testNode: fixture.unknownNode }), testRule).classification, 'not-evaluable');
    assert.equal(evaluate(snapshot({
      testNode: fixture.passNode,
      context: { fileKey: 'file-key', pageId: '0:1', platform: 'desktop', pageType: 'landing' },
    }), testRule).classification, 'not-applicable');
  });
}

for (const fixture of [
  {
    name: 'string-length-between',
    fact: 'text.characters',
    passValue: 'Назад',
    failValue: 'Слишком длинная подпись',
    expression: {
      predicate: 'string-length-between',
      actual: { fact: 'text.characters' },
      lower: { literal: 1 },
      upper: { literal: 8 },
    },
    nodeWith: (value) => node({ text: { characters: value } }),
  },
  {
    name: 'matches',
    fact: 'text.characters',
    passValue: 'Добавить',
    failValue: 'добавить',
    expression: {
      predicate: 'matches',
      actual: { fact: 'text.characters' },
      expected: { literal: '^[А-ЯЁ]' },
    },
    nodeWith: (value) => node({ text: { characters: value } }),
  },
  {
    name: 'every',
    fact: 'layout.values',
    passValue: ['Primary', 'Secondary'],
    failValue: ['Primary', 'Accent'],
    expression: {
      predicate: 'every',
      actual: { fact: 'layout.values' },
      expected: { literal: ['Primary', 'Secondary'] },
    },
  },
  {
    name: 'some',
    fact: 'layout.values',
    passValue: ['Secondary', 'Primary'],
    failValue: ['Secondary', 'Secondary'],
    expression: {
      predicate: 'some',
      actual: { fact: 'layout.values' },
      expected: { literal: ['Primary'] },
    },
  },
  {
    name: 'none',
    fact: 'layout.values',
    passValue: ['Primary', 'Secondary'],
    failValue: ['Primary', 'Accent'],
    expression: {
      predicate: 'none',
      actual: { fact: 'layout.values' },
      expected: { literal: ['Accent'] },
    },
  },
  {
    name: 'count-between',
    fact: 'layout.values',
    passValue: ['a', 'b', 'c'],
    failValue: ['a'],
    expression: {
      predicate: 'count-between',
      actual: { fact: 'layout.values' },
      lower: { literal: 2 },
      upper: { literal: 4 },
    },
  },
  {
    name: 'all-equal',
    fact: 'layout.values',
    passValue: ['40', '40', '40'],
    failValue: ['40', '56'],
    expression: {
      predicate: 'all-equal',
      actual: { fact: 'layout.values' },
    },
  },
  {
    name: 'unique',
    fact: 'layout.values',
    passValue: ['a', 'b', 'c'],
    failValue: ['a', 'b', 'a'],
    expression: {
      predicate: 'unique',
      actual: { fact: 'layout.values' },
    },
  },
  {
    name: 'sequence-equals',
    fact: 'layout.values',
    passValue: ['Primary', 'Secondary'],
    failValue: ['Secondary', 'Primary'],
    expression: {
      predicate: 'sequence-equals',
      actual: { fact: 'layout.values' },
      expected: { literal: ['Primary', 'Secondary'] },
    },
  },
  {
    name: 'value-position',
    fact: 'layout.values',
    passValue: ['Primary', 'Secondary', 'Secondary'],
    failValue: ['Secondary', 'Primary', 'Secondary'],
    expression: {
      predicate: 'value-position',
      actual: { fact: 'layout.values' },
      expected: { literal: 'Primary' },
      positions: ['first'],
      maxCount: 1,
    },
  },
]) {
  test(`${fixture.name} has PASS, FAIL, UNKNOWN and NOT-APPLICABLE semantics`, () => {
    const testRule = rule(fixture.name, fixture.fact, undefined, {
      assert: fixture.expression,
    });
    const nodeWith = fixture.nodeWith || ((value) => node({ layout: { values: value } }));
    assert.equal(evaluate(snapshot({ testNode: nodeWith(fixture.passValue) }), testRule).classification, 'compliant');
    assert.equal(evaluate(snapshot({ testNode: nodeWith(fixture.failValue) }), testRule).classification, 'violation');
    assert.equal(evaluate(snapshot({ testNode: node({ unknownFacts: [fixture.fact] }) }), testRule).classification, 'not-evaluable');
    assert.equal(evaluate(snapshot({
      testNode: nodeWith(fixture.passValue),
      context: { fileKey: 'file-key', pageId: '0:1', platform: 'desktop', pageType: 'landing' },
    }), testRule).classification, 'not-applicable');
  });
}

test('allow and forbid effects do not share require semantics', () => {
  const testSnapshot = snapshot();
  const expressionRule = rule('equals', 'component.properties.View', 'Primary');

  assert.equal(evaluate(testSnapshot, { ...expressionRule, effect: 'allow' }).classification, 'allowed');
  assert.equal(evaluate(testSnapshot, { ...expressionRule, effect: 'forbid' }).classification, 'violation');
});

test('inactive authority fails closed before predicate evaluation', () => {
  const result = evaluate(snapshot(), {
    ...rule('equals', 'component.properties.View', 'Primary'),
    authority: { status: 'draft', provenance: 'design-system-author' },
  });
  assert.equal(result.applicability, 'unknown');
  assert.equal(result.classification, 'not-evaluable');
  assert.equal(result.trace.truth, 'unknown');
});

test('explicit source-rule causality groups violations without changing verdicts', () => {
  const rootRule = rule('equals', 'component.properties.View', 'Primary', {
    ruleId: 'rule:test.root-cause',
    causality: {
      causes: [{
        ruleId: 'rule:test.consequence',
        relation: 'same-subject',
        reason: 'the invalid root variant determines the dependent visual state',
      }],
    },
  });
  const consequenceRule = rule('equals', 'component.properties.Size', '56', {
    ruleId: 'rule:test.consequence',
  });
  const result = evaluateRules({
    snapshot: snapshot({
      testNode: node({
        component: {
          key: 'button-key',
          identity: 'web-core.button',
          lifecycle: 'active',
          properties: { View: 'Accent', Size: '40' },
        },
      }),
    }),
    rules: [consequenceRule, rootRule],
    ruleRelease: 'causal-grouping-v1',
  });
  const byRule = new Map(result.evaluations.map((item) => [item.ruleId, item]));
  const root = byRule.get(rootRule.ruleId);
  const consequence = byRule.get(consequenceRule.ruleId);

  assert.equal(root.classification, 'violation');
  assert.equal(consequence.classification, 'violation');
  assert.equal(root.rootFindingId, root.evaluationId);
  assert.deepEqual(root.derivedFindingIds, [consequence.evaluationId]);
  assert.equal(consequence.rootFindingId, root.evaluationId);
  assert.deepEqual(consequence.derivedFindingIds, []);
  assert.equal(
    consequence.causalGroupingReason,
    'the invalid root variant determines the dependent visual state',
  );
  assert.equal(result.coverage.byClassification.violation, 2);
});

test('TableView causal grouping keeps Compact, spacing and column count atomic', () => {
  const compactRule = rule('equals', 'component.properties.Compact', 'False', {
    ruleId: 'component:web-corp.table-view.compact-is-consistent-across-rows',
    causality: {
      causes: [{
        ruleId: 'component:web-corp.table-view.horizontal-compact-one-column',
        relation: 'same-subject',
        reason: 'row Compact mismatch is the root of its dependent column-count violation',
      }],
    },
  });
  const spacingRule = rule('equals', 'composition.spacingVertical', 16, {
    ruleId: 'component:web-corp.table-view.row-spacing-matches-compact',
  });
  const columnRule = rule('equals', 'composition.visibleDataColumnCount', 1, {
    ruleId: 'component:web-corp.table-view.horizontal-compact-one-column',
  });
  const tableViewSnapshot = (compact) => snapshot({
    testNode: node({
      component: {
        key: 'table-row-key',
        identity: 'web-corp.table-view',
        lifecycle: 'active',
        properties: { Compact: compact },
      },
      composition: {
        spacingVertical: 12,
        visibleDataColumnCount: 2,
      },
    }),
  });

  const grouped = evaluateRules({
    snapshot: tableViewSnapshot('True'),
    rules: [spacingRule, columnRule, compactRule],
    ruleRelease: 'table-view-causal-grouping-v1',
  });
  const groupedByRule = new Map(grouped.evaluations.map((item) => [item.ruleId, item]));
  const compactViolation = groupedByRule.get(compactRule.ruleId);
  const spacingViolation = groupedByRule.get(spacingRule.ruleId);
  const columnViolation = groupedByRule.get(columnRule.ruleId);

  assert.deepEqual(compactViolation.derivedFindingIds, [columnViolation.evaluationId]);
  assert.equal(columnViolation.rootFindingId, compactViolation.evaluationId);
  assert.equal(spacingViolation.rootFindingId, undefined);
  assert.equal(spacingViolation.causalGroupingReason, undefined);

  const spacingOnlyRootAbsent = evaluateRules({
    snapshot: tableViewSnapshot('False'),
    rules: [spacingRule, columnRule, compactRule],
    ruleRelease: 'table-view-causal-grouping-v1',
  });
  const independentByRule = new Map(
    spacingOnlyRootAbsent.evaluations.map((item) => [item.ruleId, item]),
  );
  assert.equal(independentByRule.get(compactRule.ruleId).classification, 'compliant');
  assert.equal(independentByRule.get(spacingRule.ruleId).classification, 'violation');
  assert.equal(independentByRule.get(columnRule.ruleId).classification, 'violation');
  assert.equal(independentByRule.get(columnRule.ruleId).rootFindingId, undefined);
});

test('causality rejects unsupported implicit relations', () => {
  assert.throws(
    () => validateRule(rule('equals', 'component.properties.View', 'Primary', {
      causality: {
        causes: [{
          ruleId: 'rule:test.consequence',
          relation: 'similar-component',
          reason: 'implicit similarity is not deterministic',
        }],
      },
    })),
    (error) => error.code === 'RULE_IR_INVALID',
  );
});

test('page context facts preserve explicit unknown state', () => {
  const testRule = rule('exists', 'page.context.fileKey', undefined);
  const result = evaluate(snapshot({
    context: {
      fileKey: null,
      pageId: '0:1',
      platform: 'desktop',
      pageType: 'form',
      unknownFacts: ['fileKey'],
    },
  }), testRule);

  assert.equal(result.classification, 'not-evaluable');
  assert.equal(result.trace.truth, 'unknown');
});

test('unknown predicates and invalid implemented shapes are rejected', () => {
  assert.throws(
    () => validateRule(rule('invented-predicate', 'component.properties.View', 'Primary')),
    (error) => error.code === 'PREDICATE_UNKNOWN',
  );
  assert.throws(
    () => validateRule(rule('compare', 'layout.itemSpacing', 24)),
    (error) => error.code === 'RULE_IR_INVALID',
  );
  assert.equal(IMPLEMENTED_PREDICATES.size, 37);
});

test('ten equivalent reruns produce byte-identical normalized results', () => {
  const testRule = rule('one-of', 'component.properties.View', ['Primary', 'Secondary']);
  const results = Array.from({ length: 10 }, (_, index) => evaluateRules({
    snapshot: snapshot({ generatedAt: `2026-08-22T00:00:${String(index).padStart(2, '0')}.000Z` }),
    rules: [testRule],
    ruleRelease: 'predicate-tests-v1',
  }));
  const normalized = results.map((result) => stableStringify(result));
  assert.equal(new Set(normalized).size, 1);
  assert.equal(results[0].coverage.unclassified, 0);
  assert.equal(results[0].coverage.duplicateEvaluationIds, 0);
});

test('all Predicate Engine contract files contain valid JSON', () => {
  for (const name of [
    'apollo-predicate-capabilities.v1.json',
    'apollo-predicate-snapshot-v2.schema.json',
    'apollo-rule-ir-v1.schema.json',
    'apollo-predicate-trace-v1.schema.json',
    'apollo-predicate-result-v1.schema.json',
  ]) {
    const filePath = path.join(__dirname, '..', 'schemas', name);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(filePath, 'utf8')), name);
  }
});
