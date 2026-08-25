const BUTTONS_GROUP_CONTRACT_PATH = 'design-system_ab/JSONS/web/components/web-corp/ButtonGroup [D]/composition-contract.json';
const TITLE_VIEW_RULES_PATH = 'design-system_ab/JSONS/web/components/web-corp/TitleView/rules.json';
const TITLE_VIEW_COMPOSITION_PATH = 'design-system_ab/JSONS/web/components/web-corp/TitleView/composition-contract.json';
const BACKGROUND_PLATE_RULES_PATH = 'design-system_ab/JSONS/web/components/web-corp/BackgroundPlate/rules.json';
const BENEFITS_RULES_PATH = 'design-system_ab/JSONS/web/components/web-corp-promo/Benefits/rules.json';
const TABLE_VIEW_RULES_PATH = 'design-system_ab/JSONS/web/components/web-corp/TableView/rules.json';
const FORM_PATTERN_PATH = 'design-system_ab/patterns/p_form-construction-rules.md';
const BUTTON_PATTERN_PATH = 'design-system_ab/patterns/p_buttons-and-buttons-group.md';

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

function publicInstanceRootSelector() {
  return {
    predicate: 'not',
    args: [{
      predicate: 'exists',
      actual: { fact: 'ownership.ownerNodeId' },
    }],
  };
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

function titleViewPilotRules(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('TitleView pilot rules require a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return [{
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'component:web-corp.title-view.title-and-subtitle-typography-is-fixed',
    revision: 2,
    source: {
      path: TITLE_VIEW_RULES_PATH,
      checksum: options.sourceChecksum,
      anchor: 'rules/component:web-corp.title-view.title-and-subtitle-typography-is-fixed',
    },
    authority: { status: 'active', provenance: 'design-system-author' },
    effect: 'require',
    scope: { platform: ['desktop', 'mobile-web'] },
    select: {
      from: 'selection-root',
      traverse: 'descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'type' },
        expected: { literal: 'TEXT' },
      }, {
        predicate: 'one-of',
        actual: { fact: 'name' },
        expected: { literal: ['Title', 'Subtitle'] },
      }, {
        predicate: 'equals',
        actual: { fact: 'ownership.owner.component.identity' },
        expected: { literal: 'web-corp.title-view' },
      }],
    },
    assert: {
      predicate: 'all',
      args: [{
        predicate: 'exists',
        actual: { fact: 'appearance.styles.textStyle' },
      }, {
        predicate: 'matches-effective-baseline',
        actual: { fact: 'appearance.styles.textStyle' },
        expected: { fact: 'baseline.effective.appearance.styles.textStyle' },
      }],
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  }, {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'component:web-corp.title-view.status-and-title-status-color-match',
    revision: 1,
    source: {
      path: TITLE_VIEW_RULES_PATH,
      checksum: options.sourceChecksum,
      anchor: 'rules/component:web-corp.title-view.status-and-title-status-color-match',
    },
    authority: { status: 'active', provenance: 'design-system-author' },
    effect: 'require',
    scope: { platform: ['desktop', 'mobile-web'] },
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [componentInstanceSelector(), {
        predicate: 'one-of',
        actual: { fact: 'name' },
        expected: { literal: ['[D] TitleStatus', '[M] TitleStatus'] },
      }, {
        predicate: 'equals',
        actual: { fact: 'component.identity' },
        expected: { literal: 'web-corp.title-view' },
      }],
    },
    when: {
      predicate: 'count-between',
      actual: { fact: 'composition.ownerVisibleStatusRoles' },
      lower: { literal: 2 },
      upper: { literal: 2 },
    },
    assert: {
      predicate: 'all-equal',
      actual: { fact: 'composition.ownerStatusTypeValues' },
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  }];
}

function desktopButtonSafeViewRule(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('Desktop Button safe-view rule requires a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'rule:controls.buttons-and-button-groups.desktop-safe-variants',
    revision: 1,
    source: {
      path: BUTTON_PATTERN_PATH,
      checksum: options.sourceChecksum,
      anchor: 'rule:controls.buttons-and-button-groups.desktop-safe-variants',
    },
    authority: { status: 'active', provenance: 'design-system-author' },
    effect: 'require',
    scope: { platform: ['desktop'] },
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [componentInstanceSelector(), {
        predicate: 'equals',
        actual: { fact: 'component.identity' },
        expected: { literal: 'web-core.button' },
      }, {
        predicate: 'not',
        args: [{
          predicate: 'equals',
          actual: { fact: 'ownership.owner.component.identity' },
          expected: { literal: 'web-corp.buttons-group' },
        }],
      }],
    },
    assert: {
      predicate: 'not',
      args: [{
        predicate: 'one-of',
        actual: { fact: 'component.properties.View' },
        expected: { literal: ['Accent', 'Outlined'] },
      }],
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  };
}

function titleViewSlotOrderRule(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('TitleView slot order rule requires a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'component:web-corp.title-view.visible-slots-follow-required-order',
    revision: 1,
    source: {
      path: TITLE_VIEW_COMPOSITION_PATH,
      checksum: options.sourceChecksum,
      anchor: 'manual/slotOrderPolicy',
    },
    authority: { status: 'active', provenance: 'design-system-author' },
    effect: 'require',
    scope: { platform: ['desktop', 'mobile-web'] },
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'slot.ownerComponentIdentity' },
        expected: { literal: 'web-corp.title-view' },
      }, {
        predicate: 'exists',
        actual: { fact: 'composition.expectedPreviousSlotNodeId' },
      }],
    },
    assert: {
      predicate: 'all',
      args: [{
        predicate: 'after',
        actual: { fact: 'id' },
        expected: { fact: 'composition.expectedPreviousSlotNodeId' },
      }, {
        predicate: 'exists',
        actual: { fact: 'slot.role' },
      }, {
        predicate: 'exists',
        actual: { fact: 'composition.expectedPreviousSlotRole' },
      }],
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  };
}

function backgroundPlatePilotRules(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('BackgroundPlate pilot rules require a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  const paddingRules = ['top', 'right', 'bottom', 'left'].map((side) => ({
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: `component:web-corp.background-plate.padding-uses-spacing-tokens.${side}`,
    revision: 2,
    source: {
      path: BACKGROUND_PLATE_RULES_PATH,
      checksum: options.sourceChecksum,
      anchor: 'rules/component:web-corp.background-plate.padding-uses-spacing-tokens',
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
        expected: { literal: 'web-corp.background-plate' },
      }, {
        predicate: 'equals',
        actual: { fact: 'component.family' },
        expected: { literal: 'background-plate-slot' },
      }, {
        predicate: 'exists',
        actual: { fact: `layout.padding.${side}` },
      }, publicInstanceRootSelector()],
    },
    assert: {
      predicate: 'binding-satisfies',
      actual: { fact: `bindings.padding.${side}` },
      expected: { literal: { bound: true, collection: 'Spacing' } },
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  }));
  return paddingRules;
}

function backgroundPlateLevel2OverlayRule(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('BackgroundPlate composition candidate requires a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'component:web-corp.background-plate.level-2-requires-level-1',
    revision: 4,
    source: {
      path: BACKGROUND_PLATE_RULES_PATH,
      checksum: options.sourceChecksum,
      anchor: 'rules/component:web-corp.background-plate.level-2-requires-level-1',
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
        expected: { literal: 'web-corp.background-plate' },
      }, {
        predicate: 'equals',
        actual: { fact: 'component.properties.Position' },
        expected: { literal: 'Level 2 (inner)' },
      }, publicInstanceRootSelector()],
    },
    assert: {
      predicate: 'all',
      args: [{
        predicate: 'exists',
        actual: { fact: 'composition.level1Underlay.nodeId' },
      }, {
        predicate: 'ancestor',
        actual: { fact: 'id' },
        expected: { fact: 'composition.level1Underlay.parentNodeId' },
      }, {
        predicate: 'one-of',
        actual: { fact: 'composition.level1Underlay.parentLayoutMode' },
        expected: { literal: ['HORIZONTAL', 'VERTICAL'] },
      }, {
        predicate: 'equals',
        actual: { fact: 'composition.level1Underlay.component.identity' },
        expected: { literal: 'web-corp.background-plate' },
      }, {
        predicate: 'equals',
        actual: { fact: 'composition.level1Underlay.component.properties.Position' },
        expected: { literal: 'Level 1 (outer)' },
      }, {
        predicate: 'equals',
        actual: { fact: 'composition.level1Underlay.layout.positioning' },
        expected: { literal: 'ABSOLUTE' },
      }, {
        predicate: 'equals',
        actual: { fact: 'composition.level1Underlay.contentLayout.positioning' },
        expected: { literal: 'AUTO' },
      }, {
        predicate: 'after',
        actual: { fact: 'composition.level1Underlay.contentNodeId' },
        expected: { fact: 'composition.level1Underlay.nodeId' },
      }, {
        predicate: 'contains',
        actual: { fact: 'composition.level1Underlay.bounds' },
        target: { fact: 'bounds' },
      }],
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  };
}

function benefitsCapacityRule(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('Benefits capacity rule requires a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'component:web.benefits.capacity-matches-card-count',
    revision: 1,
    source: {
      path: BENEFITS_RULES_PATH,
      checksum: options.sourceChecksum,
      anchor: 'manual/rules/component:web.benefits.capacity-matches-card-count',
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
        expected: { literal: 'web.benefits' },
      }],
    },
    assert: {
      predicate: 'all',
      args: [{
        predicate: 'one-of',
        actual: { fact: 'composition.capacity' },
        expected: { literal: [3, 4] },
      }, {
        predicate: 'count-between',
        actual: { fact: 'composition.visibleBenefitCardNodeIds' },
        lower: { literal: 3 },
        upper: { literal: 4 },
      }, {
        predicate: 'equals',
        actual: { fact: 'composition.visibleBenefitCardCount' },
        expected: { fact: 'composition.capacity' },
      }],
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  };
}

function benefitsNestedCardSettingsUniformRule(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('Benefits nested card settings rule requires a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'component:web.benefits.nested-card-settings-are-uniform',
    revision: 1,
    source: {
      path: BENEFITS_RULES_PATH,
      checksum: options.sourceChecksum,
      anchor: 'manual/rules/component:web.benefits.nested-card-settings-are-uniform',
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
        expected: { literal: 'web.benefits' },
      }],
    },
    assert: {
      predicate: 'all',
      args: ['Background', 'CardAxis', 'Compact', 'GraphicPosition'].map(
        (propertyName) => ({
          predicate: 'all-equal',
          actual: { fact: `composition.benefitCardPropertyValues.${propertyName}` },
        }),
      ),
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  };
}

function tableViewHorizontalHeaderRule(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('TableView header rule requires a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'component:web-corp.table-view.horizontal-multi-column-header-required',
    revision: 1,
    source: {
      path: TABLE_VIEW_RULES_PATH,
      checksum: options.sourceChecksum,
      anchor: 'manual/rules/component:web-corp.table-view.horizontal-multi-column-header-required',
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
        expected: { literal: 'web-corp.table-view' },
      }, {
        predicate: 'equals',
        actual: { fact: 'component.family' },
        expected: { literal: 'table-view-horizontal' },
      }, {
        predicate: 'equals',
        actual: { fact: 'component.properties.Compact' },
        expected: { literal: 'False' },
      }],
    },
    assert: {
      predicate: 'equals',
      actual: { fact: 'composition.visibleHeaderRowCount' },
      expected: { literal: 1 },
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  };
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

function tableViewHorizontalCompactOneColumnRule(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('TableView compact column rule requires a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'component:web-corp.table-view.horizontal-compact-one-column',
    revision: 1,
    source: {
      path: TABLE_VIEW_RULES_PATH,
      checksum: options.sourceChecksum,
      anchor: 'manual/rules/component:web-corp.table-view.horizontal-compact-one-column',
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
        actual: { fact: 'component.properties.Presets' },
        expected: { literal: 'Body' },
      }, {
        predicate: 'equals',
        actual: { fact: 'composition.tableViewOwner.component.family' },
        expected: { literal: 'table-view-horizontal' },
      }, {
        predicate: 'equals',
        actual: { fact: 'composition.tableViewOwner.component.properties.Compact' },
        expected: { literal: 'True' },
      }],
    },
    assert: {
      predicate: 'count-between',
      actual: { fact: 'composition.visibleDataColumnNodeIds' },
      lower: { literal: 1 },
      upper: { literal: 1 },
      bounds: 'inclusive',
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  };
}

function formFirstLevelBlockSpacingRule(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('Form first-level block spacing rule requires a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'rule:forms.construction-rules.block-spacing.first-level',
    revision: 3,
    source: {
      path: FORM_PATTERN_PATH,
      checksum: options.sourceChecksum,
      anchor: 'rule:forms.construction-rules.block-spacing',
    },
    authority: { status: 'active', provenance: 'design-system-author' },
    effect: 'require',
    scope: { platform: ['desktop', 'mobile-web'], pageType: ['form'] },
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'exists',
        actual: { fact: 'composition.previousFormFirstLevelBlock.bounds' },
      }],
    },
    assert: {
      predicate: 'distance',
      actual: { fact: 'bounds' },
      target: { fact: 'composition.previousFormFirstLevelBlock.bounds' },
      expected: { literal: 24 },
      axis: 'vertical',
      tolerance: 0,
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  };
}

function formSecondLevelActionSpacingRule(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('Form second-level action spacing rule requires a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'rule:forms.construction-rules.block-spacing.second-level-actions',
    revision: 2,
    source: {
      path: FORM_PATTERN_PATH,
      checksum: options.sourceChecksum,
      anchor: 'rule:forms.construction-rules.block-spacing',
    },
    authority: { status: 'active', provenance: 'design-system-author' },
    effect: 'require',
    scope: { platform: ['desktop', 'mobile-web'], pageType: ['form'] },
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'exists',
        actual: { fact: 'composition.previousFormContent.bounds' },
      }, {
        predicate: 'equals',
        actual: { fact: 'composition.previousFormContent.hierarchyLevel' },
        expected: { literal: 'second-level' },
      }],
    },
    assert: {
      predicate: 'distance',
      actual: { fact: 'bounds' },
      target: { fact: 'composition.previousFormContent.bounds' },
      expected: { literal: 32 },
      axis: 'vertical',
      tolerance: 0,
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  };
}

function formMediumTitleOnePerPlateRule(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('Form Medium TitleView rule requires a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'rule:forms.construction-rules.title-medium-one-per-plate',
    revision: 1,
    source: {
      path: FORM_PATTERN_PATH,
      checksum: options.sourceChecksum,
      anchor: 'rule:forms.construction-rules.title-medium-one-per-plate',
    },
    authority: { status: 'active', provenance: 'design-system-author' },
    effect: 'require',
    scope: { platform: ['desktop', 'mobile-web'], pageType: ['form'] },
    select: {
      from: 'selection-root',
      traverse: 'descendants',
      where: [componentInstanceSelector(), {
        predicate: 'equals',
        actual: { fact: 'component.identity' },
        expected: { literal: 'web-corp.title-view' },
      }, {
        predicate: 'equals',
        actual: { fact: 'component.properties.View' },
        expected: { literal: 'Medium' },
      }, {
        predicate: 'exists',
        actual: { fact: 'composition.formFirstLevelSurface.mediumTitlePosition' },
      }],
    },
    assert: {
      predicate: 'one-of',
      actual: { fact: 'composition.formFirstLevelSurface.mediumTitlePosition' },
      expected: { literal: ['single', 'first'] },
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  };
}

function formTitleContentGapRule(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('Form title-to-content gap rule requires a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'rule:forms.construction-rules.inner-padding-standard.title-to-content',
    revision: 1,
    source: {
      path: FORM_PATTERN_PATH,
      checksum: options.sourceChecksum,
      anchor: 'rule:forms.construction-rules.inner-padding-standard',
    },
    authority: { status: 'active', provenance: 'design-system-author' },
    effect: 'require',
    scope: { platform: ['desktop', 'mobile-web'], pageType: ['form'] },
    select: {
      from: 'selection-root',
      traverse: 'descendants',
      where: [{
        predicate: 'exists',
        actual: { fact: 'composition.previousFormMediumTitle.bounds' },
      }],
    },
    assert: {
      predicate: 'distance',
      actual: { fact: 'bounds' },
      target: { fact: 'composition.previousFormMediumTitle.bounds' },
      expected: { literal: 24 },
      axis: 'vertical',
      tolerance: 0,
    },
    severity: 'error',
    unknownPolicy: 'not-evaluable',
    remediation: null,
  };
}

function formStandardContentInsetsRule(options) {
  if (!options || typeof options.sourceChecksum !== 'string' || !options.sourceChecksum) {
    const error = new Error('Form standard content insets rule requires a pinned source checksum');
    error.code = 'RULE_RELEASE_INVALID';
    throw error;
  }
  const insetFacts = ['top', 'right', 'bottom', 'left'];
  return {
    schemaVersion: 'apollo.rule-ir.v1',
    ruleId: 'rule:forms.construction-rules.inner-padding-standard.content-insets',
    revision: 1,
    source: {
      path: FORM_PATTERN_PATH,
      checksum: options.sourceChecksum,
      anchor: 'rule:forms.construction-rules.inner-padding-standard',
    },
    authority: { status: 'active', provenance: 'design-system-author' },
    effect: 'require',
    scope: { platform: ['desktop', 'mobile-web'], pageType: ['form'] },
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'exists',
        actual: { fact: 'composition.formFirstLevelSurface.contentInsets' },
      }],
    },
    assert: {
      predicate: 'all',
      args: insetFacts.map((side) => ({
        predicate: 'equals',
        actual: { fact: `composition.formFirstLevelSurface.contentInsets.${side}` },
        expected: { literal: 32 },
      })),
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
    ...buttonsGroupPilotRules({
      sourceChecksum: options?.buttonsGroupComposition,
    }),
    ...titleViewPilotRules({
      sourceChecksum: options?.titleViewRules,
    }),
    desktopButtonSafeViewRule({
      sourceChecksum: options?.buttonPattern,
    }),
    titleViewSlotOrderRule({
      sourceChecksum: options?.titleViewComposition,
    }),
    ...backgroundPlatePilotRules({
      sourceChecksum: options?.backgroundPlateRules,
    }),
    backgroundPlateLevel2OverlayRule({
      sourceChecksum: options?.backgroundPlateRules,
    }),
    benefitsCapacityRule({
      sourceChecksum: options?.benefitsRules,
    }),
    benefitsNestedCardSettingsUniformRule({
      sourceChecksum: options?.benefitsRules,
    }),
    tableViewHorizontalHeaderRule({
      sourceChecksum: options?.tableViewRules,
    }),
    tableViewCompactConsistencyRule({
      sourceChecksum: options?.tableViewRules,
    }),
    tableViewHorizontalCompactOneColumnRule({
      sourceChecksum: options?.tableViewRules,
    }),
    formFirstLevelBlockSpacingRule({
      sourceChecksum: options?.formPattern,
    }),
    formSecondLevelActionSpacingRule({
      sourceChecksum: options?.formPattern,
    }),
    formMediumTitleOnePerPlateRule({
      sourceChecksum: options?.formPattern,
    }),
    formTitleContentGapRule({
      sourceChecksum: options?.formPattern,
    }),
    formStandardContentInsetsRule({
      sourceChecksum: options?.formPattern,
    }),
    formEightFourLayoutRule({
      sourceChecksum: options?.formPattern,
    }),
  ];
}

module.exports = {
  backgroundPlateLevel2OverlayRule,
  buttonsGroupPilotRules,
  backgroundPlatePilotRules,
  benefitsCapacityRule,
  benefitsNestedCardSettingsUniformRule,
  predicateMvpRules,
  titleViewPilotRules,
  desktopButtonSafeViewRule,
  titleViewSlotOrderRule,
  tableViewHorizontalHeaderRule,
  tableViewCompactConsistencyRule,
  tableViewHorizontalCompactOneColumnRule,
  formFirstLevelBlockSpacingRule,
  formSecondLevelActionSpacingRule,
  formMediumTitleOnePerPlateRule,
  formTitleContentGapRule,
  formStandardContentInsetsRule,
  formEightFourLayoutRule,
};
