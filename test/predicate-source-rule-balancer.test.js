const test = require('node:test');
const assert = require('node:assert/strict');

const {
  balanceSourceRules,
  compatibilityProfile,
} = require('../src/predicate-engine/source-rule-balancer');

function benefitsUniformity() {
  return {
    ruleId: 'component:web.benefits.nested-card-settings-are-uniform',
    kind: 'uniform-collection-properties',
    identity: 'web.benefits',
    memberIdentity: 'web.benefit-card',
    traverse: 'direct-children',
    propertyFacts: [
      'component.properties.Background',
      'component.properties.CardAxis',
      'component.properties.Compact',
      'component.properties.GraphicPosition',
    ],
  };
}

function tabsUniformity() {
  return {
    ruleId: 'component:web-corp.tabs-view.secondary-single-icon-is-uniform',
    kind: 'uniform-collection-properties',
    identity: 'web-core-navigation.tabs',
    memberIdentity: 'web-core.tag',
    memberWhere: [{
      predicate: 'equals',
      actual: { fact: 'component.family' },
      expected: { literal: 'tag-filled' },
    }],
    traverse: 'descendants',
    propertyFacts: ['component.properties.SingleIcon'],
    minimumCount: 2,
  };
}

test('source-rule balancer reuses a universal collection contour across component families', () => {
  const benefits = benefitsUniformity();
  const tabs = tabsUniformity();
  const output = balanceSourceRules([tabs], [tabs, benefits]);

  assert.deepEqual(output.definitions, [tabs]);
  assert.equal(output.traces.length, 1);
  const trace = output.traces[0];
  assert.equal(trace.ruleId, tabs.ruleId);
  assert.equal(trace.selectedContourId, 'uniform-collection-properties');
  assert.equal(trace.decision, 'reuse');
  assert.deepEqual(trace.matchedPrecedentRuleIds, [benefits.ruleId]);
  assert.deepEqual(trace.profile.propertyPathFamilies, ['component.properties.*']);
  assert.deepEqual(trace.profile.predicateSemantics, [
    'count-between',
    'all-equal-per-property',
  ]);
  assert.equal(trace.configured.identity, 'web-core-navigation.tabs');
  assert.equal(trace.configured.memberIdentity, 'web-core.tag');
  assert.deepEqual(trace.configured.propertyFacts, ['component.properties.SingleIcon']);
});

test('source-rule balancer does not confuse different predicate semantics', () => {
  const tabs = tabsUniformity();
  const exactDomain = {
    ruleId: 'component:web-corp.tabs-view.secondary-single-icon-forbidden',
    kind: 'fact-domain',
    actual: { fact: 'component.properties.SingleIcon' },
    allowedValues: ['False'],
  };
  const output = balanceSourceRules([tabs], [tabs, exactDomain]);

  assert.equal(output.traces[0].decision, 'registered-contour');
  assert.deepEqual(output.traces[0].matchedPrecedentRuleIds, []);
  assert.notDeepEqual(compatibilityProfile(tabs), compatibilityProfile(exactDomain));
});

test('source-rule compatibility traces are stable regardless of catalog order', () => {
  const benefits = benefitsUniformity();
  const tabs = tabsUniformity();
  const first = balanceSourceRules([tabs], [tabs, benefits]).traces[0];
  const second = balanceSourceRules([tabs], [benefits, tabs]).traces[0];

  assert.deepEqual(first, second);
  assert.match(first.compatibilitySignature, /^[a-f0-9]{64}$/u);
});
