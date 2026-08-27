const BUTTONS_GROUP_CONTRACT_PATH = 'design-system_ab/JSONS/web/components/web-corp/ButtonGroup [D]/composition-contract.json';
const BENEFITS_RULES_PATH = 'design-system_ab/JSONS/web/components/web-corp-promo/Benefits/rules.json';
const TABLE_VIEW_RULES_PATH = 'design-system_ab/JSONS/web/components/web-corp/TableView/rules.json';
const FORM_PATTERN_PATH = 'design-system_ab/patterns/p_form-construction-rules.md';

function baseRule(ruleId, constraintId, assert, sourceChecksum, overrides = {}) {
  return Object.assign({
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId,
    revision: 2,
    source: {
      path: BUTTONS_GROUP_CONTRACT_PATH,
      checksum: sourceChecksum,
      anchor: `buttons-group.composition/constraints/${constraintId}`,
    },
    authority: { status: 'active', provenance: 'design-system-author' },
    effect: 'require',
    scope: { platform: ['desktop', 'mobile-web'] },
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [componentInstanceSelector(), {
        predicate: 'equals',
        actual: { fact: 'component.identity' },
        expected: { literal: 'web-core.button' },
      }, {
        predicate: 'equals',
        actual: { fact: 'ownership.owner.component.identity' },
        expected: { literal: 'web-corp.buttons-group' },
      }],
    },
    assert,
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  }, overrides);
}

function componentInstanceSelector() {
  return {
    predicate: 'equals',
    actual: { fact: 'type' },
    expected: { literal: 'INSTANCE' },
  };
}

function buttonsGroupPilotRules(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('ButtonsGroup pilot rules require a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return [
    {
      schemaVersion: 'apollo.rule-ir.v1',
      ruleId: 'component:web-corp.buttons-group.button-count',
      revision: 1,
      source: {
        path: BUTTONS_GROUP_CONTRACT_PATH,
        checksum: options.sourceChecksum,
        anchor: 'buttons-group.composition/constraints/button-count',
      },
      authority: { status: 'active', provenance: 'design-system-author' },
      effect: 'require',
      scope: { platform: ['desktop', 'mobile-web'] },
      select: {
        from: 'selection-root',
        traverse: 'self-and-descendants',
        where: [componentInstanceSelector(), {
          predicate: 'equals',
          actual: { fact: 'component.identity' },
          expected: { literal: 'web-corp.buttons-group' },
        }],
      },
      assert: {
        predicate: 'count-between',
        actual: { fact: 'composition.visibleButtonNodeIds' },
        lower: { literal: 2 },
        upper: { literal: 4 },
      },
      severity: 'error',
      unknownPolicy: 'not-evaluable',
      remediation: null,
    },
    baseRule('component:web-corp.buttons-group.allowed-views', 'allowed-views', {
      predicate: 'one-of',
      actual: { fact: 'component.properties.View' },
      expected: { literal: ['Primary', 'Secondary'] },
    }, options.sourceChecksum),
    baseRule('component:web-corp.buttons-group.uniform-size', 'uniform-size', {
      predicate: 'equals',
      actual: { fact: 'component.properties.Size' },
      expected: { fact: 'ownership.owner.component.properties.Size' },
    }, options.sourceChecksum),
    baseRule('component:web-corp.buttons-group.single-icon-position', 'single-icon-position', {
      predicate: 'all',
      args: [{
        predicate: 'equals',
        actual: { fact: 'ownership.owner.component.properties.Overflow' },
        expected: { literal: 'true' },
      }, {
        predicate: 'value-position',
        actual: { fact: 'composition.siblingPropertyValues.SingleIcon' },
        expected: { literal: 'True' },
        positions: ['last'],
        maxCount: 1,
      }],
    }, options.sourceChecksum, {
      when: {
        predicate: 'equals',
        actual: { fact: 'component.properties.SingleIcon' },
        expected: { literal: 'True' },
      },
    }),
  ];
}

function tableViewCompactConsistencyRule(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('TableView Compact consistency rule requires a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'component:web-corp.table-view.compact-is-consistent-across-rows',
    revision: 1,
    source: {
      path: TABLE_VIEW_RULES_PATH,
      checksum: options.sourceChecksum,
      anchor: 'manual/rules/component:web-corp.table-view.compact-is-consistent-across-rows',
    },
    authority: { status: 'active', provenance: 'design-system-author' },
    effect: 'require',
    scope: { platform: ['desktop', 'mobile-web'] },
    select: {
      from: 'selection-root',
      traverse: 'descendants',
      where: [componentInstanceSelector(), {
        predicate: 'equals',
        actual: { fact: 'component.identity' },
        expected: { literal: 'web-corp.table-view' },
      }, {
        predicate: 'equals',
        actual: { fact: 'component.family' },
        expected: { literal: 'row' },
      }, {
        predicate: 'equals',
        actual: { fact: 'composition.tableViewOwner.component.identity' },
        expected: { literal: 'web-corp.table-view' },
      }],
    },
    assert: {
      predicate: 'all',
      args: [{
        predicate: 'equals',
        actual: { fact: 'component.properties.Compact' },
        expected: { fact: 'composition.tableViewOwner.component.properties.Compact' },
      }, {
        predicate: 'equals',
        actual: { fact: 'composition.spacingVertical' },
        expected: { fact: 'composition.expectedRowSpacing' },
      }],
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  };
}

function formEightFourLayoutRule(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('Form 8+4 layout rule requires a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'rule:forms.construction-rules.layout-8-4.geometry',
    revision: 2,
    source: {
      path: FORM_PATTERN_PATH,
      checksum: options.sourceChecksum,
      anchor: 'rule:forms.construction-rules.layout-8-4',
    },
    authority: { status: 'active', provenance: 'design-system-author' },
    effect: 'require',
    scope: { platform: ['desktop'], pageType: ['form'] },
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'exists',
        actual: { fact: 'composition.formEightFourLayout' },
      }],
    },
    assert: {
      predicate: 'all',
      args: [{
        predicate: 'exists',
        actual: { fact: 'composition.formEightFourLayout.mainZoneNodeId' },
      }, {
        predicate: 'exists',
        actual: { fact: 'composition.formEightFourLayout.islandZoneNodeId' },
      }, {
        predicate: 'equals',
        actual: { fact: 'composition.formEightFourLayout.gutter' },
        expected: { fact: 'composition.formEightFourLayout.expectedGutter' },
      }, {
        predicate: 'equals',
        actual: { fact: 'composition.formEightFourLayout.mainWidth' },
        expected: { fact: 'composition.formEightFourLayout.expectedMainWidth' },
      }, {
        predicate: 'equals',
        actual: { fact: 'composition.formEightFourLayout.islandWidth' },
        expected: { fact: 'composition.formEightFourLayout.expectedIslandWidth' },
      }],
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  };
}

function predicateMvpRules(options) {
  return [
    tableViewCompactConsistencyRule({
      sourceChecksum: options?.tableViewRules,
    }),
  ];
}

module.exports = {
  buttonsGroupPilotRules,
  predicateMvpRules,
  tableViewCompactConsistencyRule,
  formEightFourLayoutRule,
};
