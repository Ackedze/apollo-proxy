const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateRules, validateRule } = require('../src/predicate-engine');
const {
  baselineRule,
  baselineSetRules,
  bindingSetRules,
  breakpointMapRule,
  compileContourRule,
  coLocatedUnderlayRule,
  contextMapRule,
  derivedGeometryRule,
  distanceRule,
  factDomainRule,
  factAssertionRule,
  ownedPeerPropertyEqualityRule,
  platformMatchRule,
  publicRootRule,
  queryCountRule,
  queryUniqueRule,
  sizingRule,
  uniformAllowedCollectionRule,
  uniformCollectionPropertiesRule,
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

test('public-root standalone mode ignores internal component families owned by another DS component', () => {
  const rule = publicRootRule(Object.assign(options('contour:public-root-standalone'), {
    identity: 'demo.icon-view',
    allowedFamilies: ['icon-view'],
    standaloneOnly: true,
  }));
  const internalComponent = component('demo.icon-view', {}, 'content');
  const standalone = node({
    component: internalComponent,
    ownership: {
      contour: {
        identity: 'demo.icon-view',
        rootNodeId: 'root',
        isRoot: true,
        root: { component: internalComponent },
        ancestorNodeIds: [],
      },
    },
  });
  const nested = node({
    component: internalComponent,
    ownership: {
      contour: {
        identity: 'demo.icon-view',
        rootNodeId: 'root',
        isRoot: true,
        root: { component: internalComponent },
        ancestorNodeIds: [],
        host: {
          nodeId: 'status-badge',
          component: component('demo.status-badge', {}, 'status-badge'),
        },
      },
    },
  });

  assertClassification(snapshot([standalone]), rule, 'violation');
  assertClassification(snapshot([nested]), rule, 'not-applicable');
});

test('context mapping preserves typed numeric source values', () => {
  const rule = contextMapRule(Object.assign(options('contour:typed-context-map'), {
    identity: 'demo.capacity-owner',
    contextFact: 'composition.capacity',
    targetFact: 'composition.visibleItemCount',
    mappingEntries: [{ context: 3, target: 3 }, { context: 4, target: 4 }],
  }));
  const pass = node({
    component: component('demo.capacity-owner'),
    composition: { capacity: 3, visibleItemCount: 3 },
  });
  const fail = node({
    component: component('demo.capacity-owner'),
    composition: { capacity: 4, visibleItemCount: 3 },
  });
  const unmapped = node({
    component: component('demo.capacity-owner'),
    composition: { capacity: null, visibleItemCount: 3 },
  });

  assertClassification(snapshot([pass]), rule, 'compliant');
  assertClassification(snapshot([fail]), rule, 'violation');
  assertClassification(snapshot([unmapped]), rule, 'not-applicable');
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

test('uniform collection properties compare arbitrary member facts without component code', () => {
  const rule = uniformCollectionPropertiesRule(Object.assign(
    options('contour:uniform-properties'),
    {
      identity: 'demo.list',
      memberIdentity: 'demo.row',
      traverse: 'direct-children',
      propertyFacts: [
        'component.properties.Media',
        'component.properties.Axis',
      ],
    },
  ));
  const fixture = (rows) => {
    const root = node({
      component: component('demo.list'),
      childIds: rows.map((_row, index) => `row-${index}`),
    });
    return [root, ...rows.map((properties, index) => node({
      id: `row-${index}`,
      parentId: root.id,
      order: index + 1,
      name: 'Row',
      component: component('demo.row', properties),
    }))];
  };

  assertClassification(
    snapshot(fixture([
      { Media: 'Icon', Axis: 'Top' },
      { Media: 'Icon', Axis: 'Top' },
    ])),
    rule,
    'compliant',
  );
  const withUnrelatedUnknownInstance = fixture([
    { Media: 'Icon', Axis: 'Top' },
    { Media: 'Icon', Axis: 'Top' },
  ]);
  withUnrelatedUnknownInstance[1].name = 'Renamed row';
  withUnrelatedUnknownInstance[1].childIds = ['nested-icon'];
  withUnrelatedUnknownInstance.push(node({
    id: 'nested-icon',
    parentId: withUnrelatedUnknownInstance[1].id,
    order: 1,
    name: 'Icon',
    component: component(null),
    unknownFacts: ['component.identity'],
  }));
  assertClassification(snapshot(withUnrelatedUnknownInstance), rule, 'compliant');
  assertClassification(
    snapshot(fixture([
      { Media: 'Icon', Axis: 'Top' },
      { Media: 'Image', Axis: 'Left' },
    ])),
    rule,
    'violation',
  );
  const unknownNodes = fixture([
    { Media: 'Icon', Axis: 'Top' },
    { Media: 'Icon' },
  ]);
  unknownNodes[2].unknownFacts = ['component.properties.Axis'];
  assertClassification(snapshot(unknownNodes), rule, 'not-evaluable');
  assertClassification(notApplicableSnapshot(fixture([{ Media: 'Icon', Axis: 'Top' }])[0]), rule, 'not-applicable');
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

test('fact-domain contour accepts only source-declared values with four-state semantics', () => {
  const rule = factDomainRule(Object.assign(options('contour:fact-domain'), {
    select: {
      from: 'selection-root',
      traverse: 'self',
      where: [],
    },
    actual: { fact: 'composition.position' },
    allowedValues: ['single', 'first'],
  }));
  const pass = node({ composition: { position: 'single' } });
  const fail = node({ composition: { position: 'last' } });
  const absent = node({ composition: {} });
  const unknown = node({ unknownFacts: ['composition.position'] });

  assertClassification(snapshot([pass]), rule, 'compliant');
  assertClassification(snapshot([fail]), rule, 'violation');
  assertClassification(snapshot([absent]), rule, 'not-evaluable');
  assertClassification(snapshot([unknown]), rule, 'not-evaluable');
  assertClassification(notApplicableSnapshot(fail), rule, 'not-applicable');
  assert.equal(rule.presentation, null);
});

test('platform-match compares the selected channel with contract platform metadata', () => {
  const rule = platformMatchRule(Object.assign(options('contour:platform-match'), {
    identity: 'demo.dual-platform',
    publicRootOnly: true,
    publicFamilies: ['public-root'],
    supportedPlatforms: ['desktop', 'mobile-web'],
    scope: { platform: ['desktop', 'mobile-web'], pageType: ['form'] },
  }));
  const subject = node({
    component: Object.assign(component('demo.dual-platform', {}, 'public-root'), {
      platform: 'desktop',
    }),
    ownership: {
      contour: {
        isRoot: true,
      },
    },
  });

  assertClassification(snapshot([subject], { platform: 'desktop' }), rule, 'compliant');
  assertClassification(snapshot([subject], { platform: 'mobile-web' }), rule, 'violation');
  assert.equal(rule.presentation.targetFact, undefined);
  assert.equal(rule.presentation.causalRole, 'platform-root');

  const universal = node({
    component: Object.assign(component('demo.dual-platform', {}, 'public-root'), {
      platform: 'universal',
    }),
    ownership: {
      contour: {
        isRoot: true,
      },
    },
  });
  assertClassification(snapshot([universal], { platform: 'desktop' }), rule, 'compliant');
  assertClassification(snapshot([universal], { platform: 'mobile-web' }), rule, 'compliant');

  const unknown = node({
    component: Object.assign(component('demo.dual-platform', {}, 'public-root'), {
      platform: null,
    }),
    ownership: {
      contour: {
        isRoot: true,
      },
    },
    unknownFacts: ['component.platform'],
  });
  assertClassification(snapshot([unknown]), rule, 'not-evaluable');
});

test('platform-match fails closed when publicRootOnly has no public family boundary', () => {
  assert.throws(
    () => platformMatchRule(Object.assign(options('contour:platform-without-public-family'), {
      identity: 'demo.desktop-only',
      publicRootOnly: true,
      supportedPlatforms: ['desktop'],
    })),
    /publicRootOnly requires a non-empty publicFamilies list/,
  );
});

test('platform-match evaluates a forbidden channel instead of filtering it by scope', () => {
  const rule = platformMatchRule(Object.assign(options('contour:platform-desktop-only'), {
    identity: 'demo.desktop-only',
    publicRootOnly: true,
    publicFamilies: ['desktop-root'],
    supportedPlatforms: ['desktop'],
    scope: { platform: ['desktop'], pageType: ['form'] },
  }));
  const subject = node({
    name: 'PASS · Renamed desktop component',
    component: Object.assign(component('demo.desktop-only', {}, 'desktop-root'), {
      platform: 'desktop',
    }),
    ownership: {
      contour: {
        isRoot: true,
      },
    },
  });

  assertClassification(snapshot([subject], { platform: 'desktop' }), rule, 'compliant');
  assertClassification(snapshot([subject], { platform: 'mobile-web' }), rule, 'violation');
  assertClassification(notApplicableSnapshot(subject), rule, 'not-applicable');

  const universalContract = node({
    component: Object.assign(component('demo.desktop-only', {}, 'desktop-root'), {
      platform: 'universal',
    }),
    ownership: {
      contour: {
        isRoot: true,
      },
    },
  });
  assertClassification(
    snapshot([universalContract], { platform: 'desktop' }),
    rule,
    'compliant',
  );
  assertClassification(
    snapshot([universalContract], { platform: 'mobile-web' }),
    rule,
    'violation',
  );
});

test('wrong-channel roots suppress only descendant violations that depend on page platform', () => {
  const platformRule = platformMatchRule(Object.assign(options('contour:platform-cause'), {
    identity: 'demo.desktop-only',
    publicRootOnly: true,
    publicFamilies: ['desktop-root'],
    supportedPlatforms: ['desktop'],
  }));
  const dependentRule = contextMapRule(Object.assign(options('contour:platform-dependent'), {
    scope: { platform: ['desktop', 'mobile-web'], pageType: ['form'] },
    identity: 'demo.status-label',
    contextFact: 'page.context.platform',
    targetFact: 'component.properties.Uppercase',
    mappingEntries: [{ context: 'desktop', target: true }, { context: 'mobile-web', target: false }],
  }));
  const independentRule = factDomainRule(Object.assign(options('contour:independent'), {
    scope: { platform: ['desktop', 'mobile-web'], pageType: ['form'] },
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'component.identity' },
        expected: { literal: 'demo.status-label' },
      }],
    },
    actual: { fact: 'component.properties.Shape' },
    allowedValues: ['Rounded'],
  }));
  const root = node({
    id: 'desktop-root',
    childIds: ['nested-label'],
    component: Object.assign(component('demo.desktop-only', {}, 'desktop-root'), { platform: 'universal' }),
    ownership: { contour: { isRoot: true } },
  });
  const child = node({
    id: 'nested-label',
    parentId: 'desktop-root',
    order: 1,
    component: component('demo.status-label', { Uppercase: true, Shape: 'Rectangular' }),
  });
  const result = evaluateRules({
    snapshot: snapshot([root, child], { platform: 'mobile-web' }),
    rules: [platformRule, dependentRule, independentRule].map(validateRule),
    ruleRelease: 'causal-suppression-v1',
  });
  const byRule = new Map(result.evaluations.map((item) => [item.ruleId, item]));
  assert.equal(byRule.get('contour:platform-cause').classification, 'violation');
  assert.equal(byRule.get('contour:platform-dependent').classification, 'not-applicable');
  assert.equal(
    byRule.get('contour:platform-dependent').suppressedByRuleId,
    'contour:platform-cause',
  );
  assert.equal(byRule.get('contour:independent').classification, 'violation');
});

test('platform-match ignores mutable instance names and nested hosted contour roots', () => {
  const rule = platformMatchRule(Object.assign(options('contour:platform-source-selector'), {
    publicRootOnly: true,
    publicFamilies: ['desktop-root'],
    supportedPlatforms: ['desktop'],
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'component.identity' },
        expected: { literal: 'demo.desktop-only' },
      }, {
        predicate: 'equals',
        actual: { fact: 'ownership.contour.isRoot' },
        expected: { literal: true },
      }, {
        predicate: 'one-of',
        actual: { fact: 'component.name' },
        expected: { literal: ['[D] Original name'] },
      }],
    },
    scope: { platform: ['desktop'] },
  }));
  const standalone = node({
    name: 'FAIL · Renamed fixture',
    component: Object.assign(component('demo.desktop-only', {}, 'desktop-root'), {
      name: 'FAIL · Renamed fixture',
      platform: 'desktop',
    }),
    ownership: {
      contour: {
        isRoot: true,
      },
    },
  });
  assertClassification(snapshot([standalone], { platform: 'mobile-web' }), rule, 'violation');

  const internalStandalone = node({
    id: 'internal',
    name: 'FAIL · Internal fixture',
    component: Object.assign(component('demo.desktop-only', {}, 'icon-button'), {
      platform: 'universal',
    }),
    ownership: {
      contour: {
        isRoot: true,
      },
    },
  });
  assertClassification(
    snapshot([internalStandalone], { platform: 'mobile-web' }),
    rule,
    'not-applicable',
    'internal',
  );

  const host = node({
    id: 'host',
    childIds: ['nested'],
    component: Object.assign(component('demo.host'), { platform: 'universal' }),
  });
  const nested = node({
    id: 'nested',
    parentId: 'host',
    order: 1,
    name: '[D] Original name',
    component: Object.assign(component('demo.desktop-only', {}, 'desktop-root'), {
      name: '[D] Original name',
      platform: 'desktop',
    }),
    ownership: {
      contour: {
        isRoot: true,
        host: {
          nodeId: 'host',
          component: component('demo.host'),
        },
      },
    },
  });
  assertClassification(snapshot([host, nested], { platform: 'mobile-web' }), rule, 'not-applicable', 'host');
});

test('query-unique contour checks a projected collection with four-state semantics', () => {
  const rule = queryUniqueRule(Object.assign(options('contour:query-unique'), {
    select: {
      from: 'selection-root',
      traverse: 'self',
      where: [],
    },
    query: {
      from: 'subject',
      traverse: 'descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'type' },
        expected: { literal: 'TEXT' },
      }],
      project: { fact: 'text.characters' },
    },
  }));
  const owner = node({ childIds: ['label-1', 'label-2'] });
  const label = (id, order, characters, unknownFacts = []) => node({
    id,
    parentId: 'root',
    order,
    type: 'TEXT',
    name: 'Label',
    component: null,
    text: { characters },
    unknownFacts,
  });

  assertClassification(snapshot([
    owner,
    label('label-1', 0, 'Обзор'),
    label('label-2', 1, 'История'),
  ]), rule, 'compliant');
  const violation = assertClassification(snapshot([
    owner,
    label('label-1', 0, 'Обзор'),
    label('label-2', 1, 'Обзор'),
  ]), rule, 'violation');
  assert.deepEqual(violation.trace.actual, ['Обзор', 'Обзор']);
  assertClassification(snapshot([
    owner,
    label('label-1', 0, 'Обзор'),
    label('label-2', 1, undefined, ['text.characters']),
  ]), rule, 'not-evaluable');
  assertClassification(notApplicableSnapshot(owner), rule, 'not-applicable');
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
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: 'Radius differs',
      observed: '{{expected}} -> {{actual}}',
      expectation: 'Use baseline',
      action: 'Reset radius',
    },
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
  assert.equal(rule.presentation.targetFact, 'appearance.radius');
});

test('required baseline pairs reject a missing actual value without component-specific logic', () => {
  const rule = baselineRule(Object.assign(options('contour:required-baseline'), {
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'type' },
        expected: { literal: 'TEXT' },
      }],
    },
    pairs: [{
      actualFact: 'appearance.styles.textStyle',
      baselineFact: 'baseline.effective.appearance.styles.textStyle',
      required: true,
    }],
  }));
  const pass = node({
    type: 'TEXT',
    component: null,
    appearance: { styles: { textStyle: 'Headline/Large' } },
    baseline: { effective: { appearance: { styles: { textStyle: 'Headline/Large' } } } },
  });
  const missing = node({
    type: 'TEXT',
    component: null,
    appearance: { styles: {} },
    baseline: { effective: { appearance: { styles: { textStyle: 'Headline/Large' } } } },
  });

  assertClassification(snapshot([pass]), rule, 'compliant');
  assertClassification(snapshot([missing]), rule, 'violation');
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

test('P28 derived geometry can combine several formulas into one atomic evaluation', () => {
  const rule = derivedGeometryRule(Object.assign(options('contour:p28.multi-check'), {
    identity: 'demo.two-column-layout',
    checks: [{
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
    }, {
      actual: {
        derive: {
          operator: 'add',
          args: [{
            derive: {
              operator: 'multiply',
              args: [
                { fact: 'composition.asideWidth' },
                { literal: 2 },
              ],
            },
          }, { fact: 'composition.gutter' }],
        },
      },
      expected: { fact: 'composition.mainWidth' },
      tolerance: 0.5,
    }],
  }));
  const pass = node({
    component: component('demo.two-column-layout'),
    composition: { mainWidth: 624, asideWidth: 300, gutter: 24, contentWidth: 948 },
  });
  const fail = node({
    component: component('demo.two-column-layout'),
    composition: { mainWidth: 600, asideWidth: 324, gutter: 24, contentWidth: 948 },
  });

  assert.equal(rule.assert.predicate, 'all');
  assert.equal(rule.assert.args.length, 2);
  assertClassification(snapshot([pass]), rule, 'compliant');
  assertClassification(snapshot([fail]), rule, 'violation');
});

test('generic distance contour evaluates any declared geometry pair in four states', () => {
  const rule = distanceRule(Object.assign(options('contour:distance'), {
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'exists',
        actual: { fact: 'composition.previousBlock.bounds' },
      }],
    },
    actual: { fact: 'bounds' },
    target: { fact: 'composition.previousBlock.bounds' },
    expected: { literal: 24 },
    axis: 'vertical',
    tolerance: 0,
  }));
  const relationNode = (gap, unknown = false) => node({
    id: 'second-block',
    bounds: { x: 0, y: 100 + gap, width: 400, height: 100 },
    composition: {
      previousBlock: {
        bounds: { x: 0, y: 0, width: 400, height: 100 },
      },
    },
    unknownFacts: unknown ? ['composition.previousBlock.bounds'] : [],
  });

  assertClassification(snapshot([relationNode(24)]), rule, 'compliant', 'second-block');
  const fail = assertClassification(
    snapshot([relationNode(12)]),
    rule,
    'violation',
    'second-block',
  );
  assert.equal(fail.trace.expected.measured, 12);
  assertClassification(
    snapshot([relationNode(12, true)]),
    rule,
    'not-evaluable',
    'second-block',
  );
  assertClassification(
    notApplicableSnapshot(relationNode(12)),
    rule,
    'not-applicable',
    'second-block',
  );
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

test('binding-set contour compiles independent token rules and remains identity-agnostic', () => {
  const rules = bindingSetRules(Object.assign(options('contour:binding'), {
    identity: 'demo.card',
    where: [{
      predicate: 'equals',
      actual: { fact: 'component.family' },
      expected: { literal: 'public-slot' },
    }],
    publicRootOnly: true,
    paths: [{
      suffix: 'top',
      label: 'Top padding',
      valueFact: 'layout.padding.top',
      bindingFact: 'bindings.padding.top',
    }, {
      suffix: 'right',
      label: 'Right padding',
      valueFact: 'layout.padding.right',
      bindingFact: 'bindings.padding.right',
    }],
    expectedBinding: { bound: true, collection: 'Spacing' },
    presentation: {
      title: '{{property}} is raw',
      observed: '{{property}}: {{actual}}',
      expectation: '{{property}} must use Spacing',
      action: 'Bind {{property}}',
    },
  }));
  const pass = node({
    component: component('demo.card', {}, 'public-slot'),
    layout: { padding: { top: 24, right: 24 } },
    bindings: {
      padding: {
        top: { bound: true, collection: 'Spacing', token: '24' },
        right: { bound: true, collection: 'Spacing', token: '24' },
      },
    },
  });
  const fail = node({
    component: component('demo.card', {}, 'public-slot'),
    layout: { padding: { top: 24, right: 32 } },
    bindings: {
      padding: {
        top: { bound: true, collection: 'Spacing', token: '24' },
        right: { bound: false, collection: null, token: null },
      },
    },
  });
  const unknown = node({
    component: component('demo.card', {}, 'public-slot'),
    layout: { padding: { top: 24, right: 32 } },
    bindings: { padding: { top: { bound: true, collection: 'Spacing', token: '24' } } },
    unknownFacts: ['bindings.padding.right'],
  });

  assert.equal(rules.length, 2);
  assert.equal(rules[1].ruleId, 'contour:binding.right');
  assert.equal(rules[1].presentation.title, 'Right padding is raw');
  assertClassification(snapshot([pass]), rules[1], 'compliant');
  assertClassification(snapshot([fail]), rules[1], 'violation');
  assertClassification(snapshot([unknown]), rules[1], 'not-evaluable');
  assertClassification(notApplicableSnapshot(fail), rules[1], 'not-applicable');
  assert.throws(
    () => bindingSetRules(Object.assign(options('contour:duplicate'), {
      identity: 'demo.card',
      paths: [
        { suffix: 'top', valueFact: 'layout.padding.top', bindingFact: 'bindings.padding.top' },
        { suffix: 'top', valueFact: 'layout.padding.left', bindingFact: 'bindings.padding.left' },
      ],
      expectedBinding: { bound: true },
    })),
    /duplicate suffix/,
  );
});

test('binding-set supports style bindings without requiring a scalar value fact', () => {
  const [rule] = bindingSetRules(Object.assign(options('contour:text-style-binding'), {
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'type' },
        expected: { literal: 'TEXT' },
      }, {
        predicate: 'equals',
        actual: { fact: 'ownership.owner.component.identity' },
        expected: { literal: 'demo.tooltip' },
      }],
    },
    paths: [{
      suffix: 'text-style',
      label: 'Text style',
      valueFact: 'appearance.styles.textStyle',
      bindingFact: 'bindings.styles.text',
      requireValue: false,
    }],
    expectedBinding: { bound: true, kind: 'text-style' },
  }));
  const ownership = {
    owner: { component: { identity: 'demo.tooltip' } },
  };
  const pass = node({
    id: 'pass-text',
    type: 'TEXT',
    component: null,
    ownership,
    appearance: { styles: { textStyle: 'Headline/32' } },
    bindings: {
      styles: {
        text: { bound: true, kind: 'text-style', styleId: 'style-headline-32' },
      },
    },
  });
  const fail = node({
    id: 'raw-text',
    type: 'TEXT',
    component: null,
    ownership,
    appearance: { styles: { textStyle: null } },
    bindings: {
      styles: {
        text: { bound: false, kind: 'text-style', styleId: null },
      },
    },
  });

  assertClassification(snapshot([pass]), rule, 'compliant', 'pass-text');
  assertClassification(snapshot([fail]), rule, 'violation', 'raw-text');
  assert.equal(evaluation(snapshot([fail]), rule).focusNodeId, 'raw-text');
});

test('binding-set supports an independent selector extension for each atomic path', () => {
  const rules = bindingSetRules(Object.assign(options('contour:conditional-binding'), {
    identity: 'demo.surface',
    paths: [{
      suffix: 'fill',
      label: 'Fill',
      valueFact: 'appearance.fill.value',
      bindingFact: 'bindings.fills',
      where: [{
        predicate: 'equals',
        actual: { fact: 'component.properties.Type' },
        expected: { literal: 'Colored' },
      }],
    }, {
      suffix: 'stroke',
      label: 'Stroke',
      valueFact: 'appearance.stroke.value',
      bindingFact: 'bindings.strokes',
      where: [{
        predicate: 'equals',
        actual: { fact: 'component.properties.Type' },
        expected: { literal: 'Border' },
      }],
    }],
    expectedBinding: { bound: true },
  }));
  const colored = node({
    component: component('demo.surface', { Type: 'Colored' }),
    appearance: { fill: { value: '#f00' } },
    bindings: { fills: { bound: false } },
  });
  const border = node({
    component: component('demo.surface', { Type: 'Border' }),
    appearance: { stroke: { value: '#f00' } },
    bindings: { strokes: { bound: false } },
  });

  assertClassification(snapshot([colored]), rules[0], 'violation');
  assertClassification(snapshot([colored]), rules[1], 'not-applicable');
  assertClassification(snapshot([border]), rules[0], 'not-applicable');
  assertClassification(snapshot([border]), rules[1], 'violation');
});

test('owned peer equality compares declared member properties without component-specific code', () => {
  const rule = ownedPeerPropertyEqualityRule(Object.assign(options('contour:peer-equality'), {
    ownerIdentity: 'demo.owner',
    target: { identity: 'demo.member', names: ['Target'] },
    members: [{
      role: 'Reference',
      names: ['Reference'],
      propertyFact: 'component.properties.State',
    }, {
      role: 'Target',
      names: ['Target'],
      propertyFact: 'component.properties.State',
    }],
    requiredRoles: ['Reference', 'Target'],
    collectionKey: 'stateConsistency',
  }));
  const target = node({
    id: 'target',
    name: 'Target',
    component: component('demo.member', { State: 'Warning' }),
    composition: {
      peerCollections: {
        stateConsistency: {
          roles: ['Reference', 'Target'],
          values: ['Success', 'Warning'],
        },
      },
    },
  });
  const fail = assertClassification(snapshot([target]), rule, 'violation', 'target');
  assert.deepEqual(fail.trace.actual, ['Success', 'Warning']);

  const pass = Object.assign({}, target, {
    composition: {
      peerCollections: {
        stateConsistency: {
          roles: ['Reference', 'Target'],
          values: ['Success', 'Success'],
        },
      },
    },
  });
  assertClassification(snapshot([pass]), rule, 'compliant', 'target');

  const unknown = Object.assign({}, target, {
    unknownFacts: ['composition.peerCollections.stateConsistency.values'],
  });
  assertClassification(snapshot([unknown]), rule, 'not-evaluable', 'target');

  const absent = Object.assign({}, target, {
    composition: {
      peerCollections: {
        stateConsistency: { roles: ['Target'], values: ['Warning'] },
      },
    },
  });
  assertClassification(snapshot([absent]), rule, 'not-applicable', 'target');
});

test('co-located underlay contour validates generic stacking relations', () => {
  const rule = coLocatedUnderlayRule(Object.assign(options('contour:underlay'), {
    subject: {
      identity: 'demo.surface',
      properties: { Level: 'inner' },
      publicRootOnly: true,
    },
    underlay: {
      identity: 'demo.surface',
      properties: { Level: 'outer' },
      positioning: 'ABSOLUTE',
    },
    host: { layoutModes: ['VERTICAL'] },
    content: { positioning: 'AUTO', afterUnderlay: true },
    geometry: { underlayContainsSubject: true },
    relationKey: 'outerSurface',
  }));
  const relation = {
    nodeId: 'underlay',
    contentNodeId: 'content',
    hostNodeId: 'host',
    hostLayoutMode: 'VERTICAL',
    component: component('demo.surface', { Level: 'outer' }),
    layout: { positioning: 'ABSOLUTE' },
    contentLayout: { positioning: 'AUTO' },
    bounds: { x: 0, y: 0, width: 200, height: 120 },
  };
  const host = node({ id: 'host', type: 'FRAME', component: null, childIds: ['underlay', 'content'] });
  const underlay = node({ id: 'underlay', parentId: 'host', order: 0 });
  const content = node({ id: 'content', parentId: 'host', order: 1, childIds: ['subject'] });
  const subject = node({
    id: 'subject',
    parentId: 'content',
    bounds: { x: 24, y: 24, width: 152, height: 72 },
    component: component('demo.surface', { Level: 'inner' }),
    composition: { underlayRelations: { outerSurface: relation } },
  });
  assertClassification(snapshot([host, underlay, content, subject]), rule, 'compliant', 'subject');

  const missing = Object.assign({}, subject, {
    composition: { underlayRelations: { outerSurface: null } },
  });
  assertClassification(snapshot([host, underlay, content, missing]), rule, 'violation', 'subject');

  const unresolved = Object.assign({}, subject, {
    unknownFacts: ['composition.underlayRelations.outerSurface'],
  });
  assertClassification(snapshot([host, underlay, content, unresolved]), rule, 'not-evaluable', 'subject');

  const other = Object.assign({}, subject, {
    component: component('demo.surface', { Level: 'outer' }),
  });
  assertClassification(snapshot([host, underlay, content, other]), rule, 'not-applicable', 'host');
});

test('universal contour compiler accepts only the closed registered template set', () => {
  const baselineRules = baselineSetRules(Object.assign(options('compiled.baseline-set'), {
    select: { from: 'selection-root', traverse: 'self', where: [] },
    paths: [{
      suffix: 'fill',
      actualFact: 'appearance.fill.value',
      baselineFact: 'baseline.effective.appearance.fill.value',
    }],
  }));
  assert.equal(baselineRules.length, 1);
  assert.equal(baselineRules[0].ruleId, 'compiled.baseline-set.fill');
  assert.equal(baselineRules[0].assert.predicate, 'matches-effective-baseline');
  const assertionRule = factAssertionRule(Object.assign(options('compiled.fact-assertion'), {
    select: { from: 'selection-root', traverse: 'self', where: [] },
    assert: {
      predicate: 'compare',
      actual: { fact: 'text.length' },
      expected: { literal: 120 },
      operator: 'lte',
    },
  }));
  assert.equal(assertionRule.assert.predicate, 'compare');
  const compiled = compileContourRule(Object.assign(options('compiled.sizing'), {
    kind: 'sizing',
    identity: 'demo.card',
    expectations: { 'layout.sizingHorizontal': 'HUG' },
  }));
  assert.equal(compiled.ruleId, 'compiled.sizing');
  assert.equal(compiled.assert.predicate, 'all');
  const bindingRules = compileContourRule(Object.assign(options('compiled.binding'), {
    kind: 'binding-set',
    identity: 'demo.card',
    paths: [{
      suffix: 'top',
      valueFact: 'layout.padding.top',
      bindingFact: 'bindings.padding.top',
    }],
    expectedBinding: { bound: true, collection: 'Spacing' },
  }));
  assert.equal(bindingRules.length, 1);
  assert.equal(bindingRules[0].assert.predicate, 'all');
  assert.deepEqual(
    bindingRules[0].assert.args.map((entry) => entry.predicate),
    ['exists', 'binding-satisfies'],
  );
  const peerRule = compileContourRule(Object.assign(options('compiled.peer-equality'), {
    kind: 'owned-peer-property-equality',
    ownerIdentity: 'demo.owner',
    target: { identity: 'demo.member', names: ['Target'] },
    members: [{
      role: 'Reference',
      names: ['Reference'],
      propertyFact: 'component.properties.State',
    }, {
      role: 'Target',
      names: ['Target'],
      propertyFact: 'component.properties.State',
    }],
    collectionKey: 'stateConsistency',
  }));
  assert.equal(peerRule.assert.predicate, 'all-equal');
  const underlayRule = compileContourRule(Object.assign(options('compiled.underlay'), {
    kind: 'co-located-underlay',
    subject: { identity: 'demo.surface', properties: { Level: 'inner' } },
    underlay: { identity: 'demo.surface', properties: { Level: 'outer' } },
    host: { layoutModes: ['HORIZONTAL', 'VERTICAL'] },
    relationKey: 'surfaceUnderlay',
  }));
  assert.equal(underlayRule.assert.predicate, 'all');
  assert.throws(
    () => compileContourRule({ kind: 'component-specific-javascript' }),
    /unsupported universal contour kind/,
  );
});
