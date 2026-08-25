const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateRules, validateRule } = require('../src/predicate-engine');
const {
  baselineRule,
  breakpointMapRule,
  compileContourRule,
  contextMapRule,
  derivedGeometryRule,
  publicRootRule,
  queryCountRule,
  sizingRule,
  uniformAllowedCollectionRule,
} = require('../src/predicate-engine/contour-rules');

function component(identity, properties = {}, family = 'public') {
  return {
    key: `${identity}-key`,
    identity,
    family,
    lifecycle: 'active',
    properties,
  };
}

function node(overrides = {}) {
  return Object.assign({
    id: 'root',
    parentId: null,
    childIds: [],
    order: 0,
    path: 'Fixture / Root',
    name: 'Root',
    type: 'INSTANCE',
    visible: true,
    bounds: { x: 0, y: 0, width: 100, height: 40 },
    component: component('demo.subject'),
    layout: {},
    appearance: {},
    bindings: {},
    baseline: {},
    composition: {},
    ownership: null,
    overrides: [],
    overrideProperties: [],
    unknownFacts: [],
  }, overrides);
}

function snapshot(nodes, context = {}) {
  return {
    schemaVersion: 'apollo.predicate-snapshot.v2',
    auditId: 'universal-contour-test',
    generatedAt: '2026-08-25T00:00:00.000Z',
    context: Object.assign({
      fileKey: 'file-key',
      pageId: 'page',
      platform: 'desktop',
      pageType: 'form',
      viewportWidth: 1280,
      unknownFacts: [],
    }, context),
    release: {
      knowledgeSource: 'design-system_ab',
      revision: 'test-release',
      checksum: 'test-release-checksum',
    },
    selection: [nodes[0].id],
    nodes,
  };
}

function options(ruleId) {
  return {
    ruleId,
    sourcePath: 'fixtures/universal-rules.json',
    sourceChecksum: 'fixture-checksum',
    scope: { platform: ['desktop'], pageType: ['form'] },
  };
}

function evaluation(testSnapshot, rule) {
  return evaluateRules({
    snapshot: testSnapshot,
    rules: [validateRule(rule)],
    ruleRelease: 'universal-contours-v1',
  }).evaluations[0];
}

function assertClassification(testSnapshot, rule, classification, focusNodeId = 'root') {
  const result = evaluation(testSnapshot, rule);
  assert.equal(result.classification, classification);
  assert.equal(result.focusNodeId, focusNodeId);
  return result;
}

function notApplicableSnapshot(testNode) {
  return snapshot([testNode], { pageType: 'landing' });
}

test('P21 public API and ownership contour is tri-state and identity-agnostic', () => {
  const rule = publicRootRule(Object.assign(options('contour:p21.public-root'), {
    identity: 'demo.account-select',
    allowedFamilies: ['public-root'],
  }));
  const passComponent = component('demo.account-select', {}, 'public-root');
  const failComponent = component('demo.account-select', {}, 'internal-part');
  const pass = node({
    component: passComponent,
    ownership: {
      contour: {
        identity: 'demo.account-select',
        rootNodeId: 'root',
        isRoot: true,
        root: { component: passComponent },
        ancestorNodeIds: [],
      },
    },
  });
  const fail = node({
    component: failComponent,
    ownership: {
      contour: {
        identity: 'demo.account-select',
        rootNodeId: 'root',
        isRoot: true,
        root: { component: failComponent },
        ancestorNodeIds: [],
      },
    },
  });
  const unknown = node({
    component: component('demo.account-select', {}, null),
    ownership: {
      contour: {
        identity: 'demo.account-select',
        rootNodeId: null,
        isRoot: true,
        root: null,
        ancestorNodeIds: [],
      },
    },
    unknownFacts: ['ownership.contour.root.component.family'],
  });
  const publicOwner = node({
    id: 'public-owner',
    childIds: ['nested-internal'],
    component: passComponent,
    ownership: {
      contour: {
        identity: 'demo.account-select',
        rootNodeId: 'public-owner',
        isRoot: true,
        root: { component: passComponent },
        ancestorNodeIds: [],
      },
    },
  });
  const nestedInternal = node({
    id: 'nested-internal',
    parentId: 'public-owner',
    component: failComponent,
    ownership: {
      ownerNodeId: 'public-owner',
      owner: { component: component('demo.account-select', {}, 'public-root') },
      contour: {
        identity: 'demo.account-select',
        rootNodeId: 'public-owner',
        isRoot: false,
        root: { component: passComponent },
        ancestorNodeIds: ['public-owner'],
      },
    },
  });
  const foreignOwner = node({
    id: 'foreign-owner',
    childIds: ['foreign-owned-internal'],
    component: component('demo.other', {}, 'other-root'),
  });
  const foreignOwnedInternal = node({
    id: 'foreign-owned-internal',
    parentId: 'foreign-owner',
    component: failComponent,
    ownership: {
      ownerNodeId: 'foreign-owner',
      owner: { component: component('demo.other', {}, 'other-root') },
      contour: {
        identity: 'demo.account-select',
        rootNodeId: 'foreign-owned-internal',
        isRoot: true,
        root: { component: failComponent },
        ancestorNodeIds: [],
      },
    },
  });

  assertClassification(snapshot([pass]), rule, 'compliant');
  assertClassification(snapshot([fail]), rule, 'violation');
  assertClassification(snapshot([unknown]), rule, 'not-evaluable');
  const nestedResult = evaluateRules({
    snapshot: snapshot([publicOwner, nestedInternal]),
    rules: [rule],
  });
  assert.equal(nestedResult.evaluations.length, 1);
  assert.equal(nestedResult.evaluations[0].classification, 'compliant');
  assert.equal(nestedResult.evaluations[0].focusNodeId, 'public-owner');
  assertClassification(
    snapshot([foreignOwner, foreignOwnedInternal]),
    rule,
    'violation',
    'foreign-owned-internal',
  );
  assertClassification(notApplicableSnapshot(pass), rule, 'not-applicable');
});

test('P22 conditional context mapping evaluates mappings without component-specific code', () => {
  const rule = contextMapRule(Object.assign(options('contour:p22.context-map'), {
    identity: 'demo.summary',
    contextFact: 'component.properties.Type',
    targetFact: 'component.properties.Preset',
    mapping: { Sum: 'Sum', Count: 'Count' },
  }));
  const pass = node({ component: component('demo.summary', { Type: 'Sum', Preset: 'Sum' }) });
  const fail = node({ component: component('demo.summary', { Type: 'Sum', Preset: 'Count' }) });
  const unknown = node({
    component: component('demo.summary', { Type: 'Sum' }),
    unknownFacts: ['component.properties.Preset'],
  });

  assertClassification(snapshot([pass]), rule, 'compliant');
  assertClassification(snapshot([fail]), rule, 'violation');
  assertClassification(snapshot([unknown]), rule, 'not-evaluable');
  assertClassification(notApplicableSnapshot(pass), rule, 'not-applicable');
});

function collectionFixture(values, unknownIndex = -1) {
  const root = node({
    component: component('demo.list'),
    childIds: values.map((_value, index) => `row-${index}`),
  });
  const rows = values.map((value, index) => node({
    id: `row-${index}`,
    parentId: root.id,
    order: index + 1,
    path: `Fixture / Row ${index + 1}`,
    component: component('demo.row', { Media: value }),
    unknownFacts: index === unknownIndex ? ['component.properties.Media'] : [],
  }));
  return [root, ...rows];
}

test('P23 collection invariants use graph query, membership and uniformity', () => {
  const rule = uniformAllowedCollectionRule(Object.assign(options('contour:p23.collection'), {
    identity: 'demo.list',
    allowedValues: ['None', 'Icon', 'Image'],
    query: {
      from: 'subject',
      traverse: 'descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'component.identity' },
        expected: { literal: 'demo.row' },
      }],
      project: { fact: 'component.properties.Media' },
    },
  }));

  assertClassification(snapshot(collectionFixture(['Icon', 'Icon'])), rule, 'compliant');
  assertClassification(snapshot(collectionFixture(['Icon', 'Image'])), rule, 'violation');
  assertClassification(snapshot(collectionFixture(['Icon', 'Icon'], 1)), rule, 'not-evaluable');
  assertClassification(notApplicableSnapshot(collectionFixture(['Icon'])[0]), rule, 'not-applicable');
});

test('P24 breakpoint and platform contour maps viewport context to a variant', () => {
  const rule = breakpointMapRule(Object.assign(options('contour:p24.breakpoint'), {
    identity: 'demo.responsive-card',
    targetFact: 'component.properties.Platform',
    ranges: [
      { lower: 0, upper: 767, expected: 'Mobile' },
      { lower: 768, expected: 'Desktop' },
    ],
  }));
  const pass = node({ component: component('demo.responsive-card', { Platform: 'Desktop' }) });
  const fail = node({ component: component('demo.responsive-card', { Platform: 'Mobile' }) });

  assertClassification(snapshot([pass]), rule, 'compliant');
  assertClassification(snapshot([fail]), rule, 'violation');
  assertClassification(snapshot([pass], {
    viewportWidth: null,
    unknownFacts: ['viewportWidth'],
  }), rule, 'not-evaluable');
  assertClassification(notApplicableSnapshot(pass), rule, 'not-applicable');
});

test('P25 sizing contour evaluates independent layout sizing contracts', () => {
  const rule = sizingRule(Object.assign(options('contour:p25.sizing'), {
    identity: 'demo.action-group',
    expectations: {
      'layout.sizingHorizontal': 'HUG',
      'layout.sizingVertical': 'HUG',
    },
  }));
  const pass = node({
    component: component('demo.action-group'),
    layout: { sizingHorizontal: 'HUG', sizingVertical: 'HUG' },
  });
  const fail = node({
    component: component('demo.action-group'),
    layout: { sizingHorizontal: 'FILL', sizingVertical: 'HUG' },
  });
  const unknown = node({
    component: component('demo.action-group'),
    layout: { sizingVertical: 'HUG' },
    unknownFacts: ['layout.sizingHorizontal'],
  });

  assertClassification(snapshot([pass]), rule, 'compliant');
  assertClassification(snapshot([fail]), rule, 'violation');
  assertClassification(snapshot([unknown]), rule, 'not-evaluable');
  assertClassification(notApplicableSnapshot(pass), rule, 'not-applicable');
});

test('P26 baseline contour compares arbitrary facts with effective baseline facts', () => {
  const rule = baselineRule(Object.assign(options('contour:p26.baseline'), {
    identity: 'demo.surface',
    pairs: [{
      actualFact: 'appearance.radius',
      baselineFact: 'baseline.effective.appearance.radius',
    }],
  }));
  const pass = node({
    component: component('demo.surface'),
    appearance: { radius: 16 },
    baseline: { effective: { appearance: { radius: 16 } } },
  });
  const fail = node({
    component: component('demo.surface'),
    appearance: { radius: 20 },
    baseline: { effective: { appearance: { radius: 16 } } },
  });
  const unknown = node({
    component: component('demo.surface'),
    appearance: { radius: 20 },
    baseline: { effective: {} },
    unknownFacts: ['baseline.effective.appearance.radius'],
  });

  assertClassification(snapshot([pass]), rule, 'compliant');
  assertClassification(snapshot([fail]), rule, 'violation');
  assertClassification(snapshot([unknown]), rule, 'not-evaluable');
  assertClassification(notApplicableSnapshot(pass), rule, 'not-applicable');
});

function pageFixture(islandCount, unknownIdentity = false) {
  const root = node({
    component: component('demo.page'),
    childIds: Array.from({ length: islandCount }, (_value, index) => `island-${index}`),
  });
  const islands = root.childIds.map((id, index) => node({
    id,
    parentId: root.id,
    order: index + 1,
    path: `Fixture / Island ${index + 1}`,
    component: component('demo.island'),
    unknownFacts: unknownIdentity && index === 0 ? ['component.identity'] : [],
  }));
  return [root, ...islands];
}

test('P27 page-wide aggregation counts graph matches without adapter-specific arrays', () => {
  const rule = queryCountRule(Object.assign(options('contour:p27.page-count'), {
    identity: 'demo.page',
    lower: 1,
    upper: 2,
    query: {
      from: 'subject',
      traverse: 'descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'component.identity' },
        expected: { literal: 'demo.island' },
      }],
    },
  }));

  assertClassification(snapshot(pageFixture(2)), rule, 'compliant');
  assertClassification(snapshot(pageFixture(3)), rule, 'violation');
  assertClassification(snapshot(pageFixture(1, true)), rule, 'not-evaluable');
  assertClassification(notApplicableSnapshot(pageFixture(1)[0]), rule, 'not-applicable');
});

test('P28 derived geometry performs arithmetic with an explicit tolerance', () => {
  const rule = derivedGeometryRule(Object.assign(options('contour:p28.derived-geometry'), {
    identity: 'demo.two-column-layout',
    actual: {
      derive: {
        operator: 'add',
        args: [
          { fact: 'composition.mainWidth' },
          { fact: 'composition.asideWidth' },
          { fact: 'composition.gutter' },
        ],
      },
    },
    expected: { fact: 'composition.contentWidth' },
    tolerance: 0.5,
  }));
  const pass = node({
    component: component('demo.two-column-layout'),
    composition: { mainWidth: 600, asideWidth: 300, gutter: 32, contentWidth: 932.25 },
  });
  const fail = node({
    component: component('demo.two-column-layout'),
    composition: { mainWidth: 600, asideWidth: 300, gutter: 32, contentWidth: 960 },
  });
  const unknown = node({
    component: component('demo.two-column-layout'),
    composition: { asideWidth: 300, gutter: 32, contentWidth: 932 },
    unknownFacts: ['composition.mainWidth'],
  });

  assertClassification(snapshot([pass]), rule, 'compliant');
  assertClassification(snapshot([fail]), rule, 'violation');
  assertClassification(snapshot([unknown]), rule, 'not-evaluable');
  assertClassification(notApplicableSnapshot(pass), rule, 'not-applicable');
});

test('query and derive capabilities fail closed when malformed', () => {
  const invalidQuery = uniformAllowedCollectionRule(Object.assign(options('invalid.query'), {
    identity: 'demo.list',
    allowedValues: ['A'],
    query: { from: 'network', traverse: 'descendants', project: { fact: 'name' } },
  }));
  assert.throws(() => validateRule(invalidQuery), { code: 'SELECTOR_UNKNOWN' });

  const invalidDerive = derivedGeometryRule(Object.assign(options('invalid.derive'), {
    identity: 'demo.layout',
    actual: { derive: { operator: 'divide', args: [{ fact: 'bounds.width' }] } },
    expected: { literal: 1 },
  }));
  assert.throws(() => validateRule(invalidDerive), { code: 'RULE_IR_INVALID' });
});

test('universal contour compiler accepts only the closed P21-P28 template set', () => {
  const compiled = compileContourRule(Object.assign(options('compiled.sizing'), {
    kind: 'sizing',
    identity: 'demo.card',
    expectations: { 'layout.sizingHorizontal': 'HUG' },
  }));
  assert.equal(compiled.ruleId, 'compiled.sizing');
  assert.equal(compiled.assert.predicate, 'all');
  assert.throws(
    () => compileContourRule({ kind: 'component-specific-javascript' }),
    /unsupported universal contour kind/,
  );
});
