const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { evaluateRules } = require('../src/predicate-engine');
const { buildPredicateSnapshotV2 } = require('../src/predicate-engine/snapshot-adapter');
const { compileContourRule, publicRootRule } = require('../src/predicate-engine/contour-rules');
const {
  loadPatternContourDefinitions,
  loadPredicateRelease,
} = require('../src/predicate-engine/release-loader');
const { compilePredicateReleaseRules } = require('../src/predicate-engine/release-service');

const designSystemRoot = process.env.DESIGN_SYSTEM_AB_ROOT
  ? path.resolve(process.env.DESIGN_SYSTEM_AB_ROOT)
  : path.resolve(__dirname, '../../../shared/design-system_ab');
const BUTTONS_GROUP_KEY = 'f05915599f71e822fd8b46a2b2509a2e395005cf';

function buttonsGroupReleaseRules() {
  return compilePredicateReleaseRules(
    loadPredicateRelease(designSystemRoot, [BUTTONS_GROUP_KEY]),
  ).filter((rule) => rule.ruleId.startsWith('component:web-corp.buttons-group.'));
}

function formEightFourLayoutReleaseRule() {
  const definition = loadPatternContourDefinitions(designSystemRoot).find((candidate) => (
    candidate.ruleId === 'rule:forms.construction-rules.layout-8-4'
  ));
  assert.ok(definition, 'form 8+4 contour must be available in the source release');
  return compileContourRule(definition);
}

function desktopButtonSafeVariantsContourRule() {
  const definition = loadPatternContourDefinitions(designSystemRoot).find((candidate) => (
    candidate.ruleId === 'rule:controls.buttons-and-button-groups.desktop-safe-variants'
  ));
  assert.ok(definition, 'desktop Button pattern contour must be available');
  return compileContourRule(definition);
}

function benefitsCapacityContourRule() {
  return compileContourRule({
    kind: 'context-map',
    ruleId: 'component:web.benefits.capacity-matches-card-count',
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp-promo/Benefits/rules.json',
    sourceChecksum: 'benefits-rules-checksum',
    sourceAnchor: 'rules/component:web.benefits.capacity-matches-card-count',
    revision: 2,
    scope: { platform: ['desktop', 'mobile-web'] },
    identity: 'web.benefits',
    contextFact: 'composition.capacity',
    targetFact: 'composition.visibleBenefitCardCount',
    mappingEntries: [{ context: 3, target: 3 }, { context: 4, target: 4 }],
  });
}

function tableViewHorizontalHeaderContourRule() {
  return compileContourRule({
    kind: 'fact-domain',
    ruleId: 'component:web-corp.table-view.horizontal-multi-column-header-required',
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/TableView/rules.json',
    sourceChecksum: 'table-view-rules-checksum',
    sourceAnchor: 'rules/component:web-corp.table-view.horizontal-multi-column-header-required',
    revision: 2,
    scope: { platform: ['desktop', 'mobile-web'] },
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'type' },
        expected: { literal: 'INSTANCE' },
      }, {
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
    actual: { fact: 'composition.visibleHeaderRowCount' },
    allowedValues: [1],
  });
}

function tableViewHorizontalCompactOneColumnContourRule() {
  return compileContourRule({
    kind: 'fact-domain',
    ruleId: 'component:web-corp.table-view.horizontal-compact-one-column',
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/TableView/rules.json',
    sourceChecksum: 'table-view-rules-checksum',
    sourceAnchor: 'rules/component:web-corp.table-view.horizontal-compact-one-column',
    revision: 2,
    scope: { platform: ['desktop', 'mobile-web'] },
    select: {
      from: 'selection-root',
      traverse: 'descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'type' },
        expected: { literal: 'INSTANCE' },
      }, {
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
    actual: { fact: 'composition.visibleDataColumnCount' },
    allowedValues: [1],
  });
}

function benefitsUniformityContourRule() {
  return compileContourRule({
    kind: 'uniform-collection-properties',
    ruleId: 'component:web.benefits.nested-card-settings-are-uniform',
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp-promo/Benefits/rules.json',
    sourceChecksum: 'benefits-rules-checksum',
    sourceAnchor: 'rules/component:web.benefits.nested-card-settings-are-uniform',
    revision: 4,
    scope: { platform: ['desktop', 'mobile-web'] },
    identity: 'web.benefits',
    memberIdentity: 'web.benefit-card',
    traverse: 'direct-children',
    propertyFacts: [
      'component.properties.Background',
      'component.properties.CardAxis',
      'component.properties.Compact',
      'component.properties.GraphicPosition',
    ],
  });
}

function formMediumTitleOnePerPlateContourRule() {
  return compileContourRule({
    kind: 'fact-domain',
    ruleId: 'rule:forms.construction-rules.title-medium-one-per-plate',
    sourcePath: 'design-system_ab/patterns/p_form-construction-rules.md',
    sourceChecksum: 'form-pattern-checksum',
    sourceAnchor: 'rules/rule:forms.construction-rules.title-medium-one-per-plate',
    revision: 2,
    scope: { platform: ['desktop', 'mobile-web'], pageType: ['form'] },
    select: {
      from: 'selection-root',
      traverse: 'descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'type' },
        expected: { literal: 'INSTANCE' },
      }, {
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
    actual: { fact: 'composition.formFirstLevelSurface.mediumTitlePosition' },
    allowedValues: ['single', 'first'],
  });
}

function titleViewTypographyContourRule() {
  return compileContourRule({
    kind: 'baseline',
    ruleId: 'component:web-corp.title-view.title-and-subtitle-typography-is-fixed',
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/TitleView/rules.json',
    sourceChecksum: 'title-view-rules-checksum',
    sourceAnchor: 'rules/component:web-corp.title-view.title-and-subtitle-typography-is-fixed',
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
    pairs: [{
      actualFact: 'appearance.styles.textStyle',
      baselineFact: 'baseline.effective.appearance.styles.textStyle',
      required: true,
    }],
  });
}

function formFirstLevelBlockSpacingContourRule() {
  return compileContourRule({
    kind: 'distance',
    ruleId: 'rule:forms.construction-rules.block-spacing.first-level',
    sourcePath: 'design-system_ab/patterns/p_form-construction-rules.md',
    sourceChecksum: 'form-pattern-checksum',
    sourceAnchor: 'rules/rule:forms.construction-rules.block-spacing.first-level',
    revision: 4,
    scope: { platform: ['desktop', 'mobile-web'], pageType: ['form'] },
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'exists',
        actual: { fact: 'composition.previousFormFirstLevelBlock.bounds' },
      }],
    },
    actual: { fact: 'bounds' },
    target: { fact: 'composition.previousFormFirstLevelBlock.bounds' },
    expected: { literal: 24 },
    axis: 'vertical',
    tolerance: 0,
  });
}

function formSecondLevelActionSpacingContourRule() {
  return compileContourRule({
    kind: 'distance',
    ruleId: 'rule:forms.construction-rules.block-spacing.second-level-actions',
    sourcePath: 'design-system_ab/patterns/p_form-construction-rules.md',
    sourceChecksum: 'form-pattern-checksum',
    sourceAnchor: 'rules/rule:forms.construction-rules.block-spacing.second-level-actions',
    revision: 3,
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
    actual: { fact: 'bounds' },
    target: { fact: 'composition.previousFormContent.bounds' },
    expected: { literal: 32 },
    axis: 'vertical',
    tolerance: 0,
  });
}

function formTitleContentGapContourRule() {
  return compileContourRule({
    kind: 'distance',
    ruleId: 'rule:forms.construction-rules.inner-padding-standard.title-to-content',
    sourcePath: 'design-system_ab/patterns/p_form-construction-rules.md',
    sourceChecksum: 'form-pattern-checksum',
    sourceAnchor: 'rules/rule:forms.construction-rules.inner-padding-standard.title-to-content',
    revision: 1,
    scope: { platform: ['desktop', 'mobile-web'], pageType: ['form'] },
    select: {
      from: 'selection-root',
      traverse: 'descendants',
      where: [{
        predicate: 'exists',
        actual: { fact: 'composition.previousFormMediumTitle.bounds' },
      }],
    },
    actual: { fact: 'bounds' },
    target: { fact: 'composition.previousFormMediumTitle.bounds' },
    expected: { literal: 24 },
    axis: 'vertical',
    tolerance: 0,
  });
}

function formStandardContentInsetsContourRule() {
  return compileContourRule({
    kind: 'derived-geometry',
    ruleId: 'rule:forms.construction-rules.inner-padding-standard.content-insets',
    sourcePath: 'design-system_ab/patterns/p_form-construction-rules.md',
    sourceChecksum: 'form-pattern-checksum',
    sourceAnchor: 'rules/rule:forms.construction-rules.inner-padding-standard.content-insets',
    revision: 1,
    scope: { platform: ['desktop', 'mobile-web'], pageType: ['form'] },
    select: {
      from: 'selection-root',
      traverse: 'self-and-descendants',
      where: [{
        predicate: 'exists',
        actual: { fact: 'composition.formFirstLevelSurface.contentInsets' },
      }],
    },
    checks: ['top', 'right', 'bottom', 'left'].map((side) => ({
      actual: { fact: `composition.formFirstLevelSurface.contentInsets.${side}` },
      expected: { literal: 32 },
      tolerance: 0,
    })),
  });
}

function backgroundPlatePaddingBindingContourRules() {
  return compileContourRule({
    kind: 'binding-set',
    ruleId: 'component:web-corp.background-plate.padding-uses-spacing-tokens',
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/BackgroundPlate/rules.json',
    sourceChecksum: 'background-plate-rules-checksum',
    sourceAnchor: 'rules/component:web-corp.background-plate.padding-uses-spacing-tokens',
    identity: 'web-corp.background-plate',
    where: [{
      predicate: 'equals',
      actual: { fact: 'component.family' },
      expected: { literal: 'background-plate-slot' },
    }],
    publicRootOnly: true,
    paths: ['top', 'right', 'bottom', 'left'].map((side) => ({
      suffix: side,
      label: side,
      valueFact: `layout.padding.${side}`,
      bindingFact: `bindings.padding.${side}`,
    })),
    expectedBinding: { bound: true, collection: 'Spacing' },
    scope: { platform: ['desktop', 'mobile-web'] },
  });
}

function evidenceNode(overrides) {
  return Object.assign({
    nodeId: '1:0',
    parentNodeId: null,
    childNodeIds: [],
    childOrder: 0,
    depth: 0,
    path: 'Test',
    type: 'FRAME',
    name: 'Test',
    visible: true,
    bounds: { x: 0, y: 0, width: 400, height: 100 },
    layout: {
      mode: 'HORIZONTAL',
      positioning: 'AUTO',
      wrap: 'NO_WRAP',
      sizingHorizontal: 'HUG',
      sizingVertical: 'HUG',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'CENTER',
      padding: null,
      itemSpacing: 8,
      clipsContent: false,
    },
    component: null,
    componentOwner: null,
    text: null,
    styles: {
      fillStyleId: null,
      strokeStyleId: null,
      textStyleId: null,
      effectStyleId: null,
    },
    appearance: {
      opacity: 1,
      radius: 0,
      fill: null,
    },
    variableBindings: [],
  }, overrides);
}

function bundle(secondButtonProperties = { View: 'Secondary', Size: '56', SingleIcon: 'True' }) {
  const owner = {
    nodeId: '1:0',
    componentKey: 'buttons-group-key',
    name: '[D] ButtonsGroup',
    path: '[D] ButtonsGroup',
    relativePath: '',
    variantProperties: { Size: '56' },
    componentProperties: { Size: '56', Overflow: 'true' },
  };
  return {
    schemaVersion: 2,
    documentType: 'apollo-audit-evidence-bundle',
    reportId: 'report-1:evidence',
    sourceReportId: 'report-1',
    generatedAt: '2026-08-22T10:00:00.000Z',
    context: {
      fileKey: 'figma-file-key',
      pageId: '0:1',
      platform: 'desktop',
      channel: 'web-corp',
      pageType: 'form',
      viewportWidth: 120,
      selectionNodeIds: ['1:0'],
    },
    graph: {
      nodes: [
        evidenceNode({
          nodeId: '1:0',
          childNodeIds: ['1:1', '1:2'],
          path: '[D] ButtonsGroup',
          name: '[D] ButtonsGroup',
          type: 'INSTANCE',
          component: {
            key: 'buttons-group-key',
            name: '[D] ButtonsGroup',
            variantProperties: { Size: '56' },
            componentProperties: { Size: '56', Overflow: 'true' },
            directOverrides: [],
          },
        }),
        evidenceNode({
          nodeId: '1:1',
          parentNodeId: '1:0',
          childOrder: 0,
          depth: 1,
          path: '[D] ButtonsGroup / Primary',
          name: '[D] Button',
          type: 'INSTANCE',
          component: {
            key: 'button-key',
            name: '[D] Button',
            variantProperties: { View: 'Primary', Size: '56', SingleIcon: 'False' },
            componentProperties: { View: 'Primary', Size: '56', SingleIcon: 'False' },
            directOverrides: [],
          },
          componentOwner: owner,
        }),
        evidenceNode({
          nodeId: '1:2',
          parentNodeId: '1:0',
          childOrder: 1,
          depth: 1,
          path: '[D] ButtonsGroup / Secondary',
          name: '[D] Button',
          type: 'INSTANCE',
          component: {
            key: 'button-key',
            name: '[D] Button',
            variantProperties: secondButtonProperties,
            componentProperties: secondButtonProperties,
            directOverrides: [],
          },
          componentOwner: owner,
        }),
      ],
      relations: [],
    },
    baselines: [],
    changes: [],
    ruleCandidates: [],
    coverage: {
      visibleNodeCount: 3,
      excludedHiddenNodeCount: 0,
      excludedDecorativeNodeCount: 0,
      componentNodeCount: 3,
      textNodeCount: 0,
      baselineChangeCount: 0,
      limitations: [],
    },
  };
}

const componentIndex = {
  'buttons-group-key': {
    identity: 'web-corp.buttons-group',
    family: 'buttons-group',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'button-key': {
    identity: 'web-core.button',
    family: 'button',
    library: 'Web _ Core Components',
    lifecycle: 'active',
  },
  'title-view-key': {
    identity: 'web-corp.title-view',
    family: 'title-view',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'status-preset-key': {
    identity: 'web-corp.status-property',
    family: 'status-property',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'title-status-key': {
    identity: 'web-corp.title-view',
    family: 'title-view',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'background-plate-key': {
    identity: 'web-corp.background-plate',
    family: 'background-plate',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'background-plate-slot-key': {
    identity: 'web-corp.background-plate',
    family: 'background-plate-slot',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'isle-block-key': {
    identity: 'web-corp.isle-block',
    family: 'isle-block',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'onboarding-tooltip-key': {
    identity: 'web-corp.onboarding-tooltip',
    family: 'onboarding-tooltip',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'benefits-key': {
    identity: 'web.benefits',
    family: 'benefits',
    library: 'Web _ Corp Promo',
    lifecycle: 'active',
  },
  'benefit-card-key': {
    identity: 'web.benefit-card',
    family: 'benefit-card',
    library: 'Web _ Corp Promo',
    lifecycle: 'active',
  },
  'table-view-horizontal-key': {
    identity: 'web-corp.table-view',
    family: 'table-view-horizontal',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'table-view-row-key': {
    identity: 'web-corp.table-view',
    family: 'row',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'table-view-side-panel-key': {
    identity: 'web-corp.table-view',
    family: 'table-view-horizontal-side-panel',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'table-view-row-side-panel-key': {
    identity: 'web-corp.table-view',
    family: 'row-side-panel',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'table-view-column-key': {
    identity: 'web-corp.table-view',
    family: 'column',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'table-view-spacing-key': {
    identity: 'web-core.spacing',
    family: 'spacing-vertical',
    library: 'Web _ Core Components',
    lifecycle: 'active',
  },
  'account-select-public-key': {
    identity: 'web-corp.account-select',
    family: 'account-option-list-content',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'account-select-item-key': {
    identity: 'web-corp.account-select',
    family: 'account-item',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'account-select-info-key': {
    identity: 'web-corp.account-select',
    family: 'account-info-sum',
    library: 'Web _ Corp Components',
    lifecycle: 'active',
  },
  'account-select-wrapper-key': {
    identity: 'web-core.option-cell',
    family: 'option-cell',
    library: 'Web _ Core Components',
    lifecycle: 'active',
  },
};

function adapt(evidenceBundle, options = {}) {
  return buildPredicateSnapshotV2({
    evidenceBundle,
    auditId: 'predicate-field-packet-1',
    pageType: 'form',
    release: {
      knowledgeSource: 'design-system_ab',
      revision: 'release-1',
      checksum: 'release-checksum-1',
    },
    componentIndex,
    contourDefinitions: options.contourDefinitions,
  });
}

test('Snapshot v2 projects a direct raw-layer override onto its affected node', () => {
  const evidenceBundle = bundle();
  evidenceBundle.graph.nodes[0].childNodeIds.push('1:gap');
  evidenceBundle.graph.nodes[0].component.directOverrides = [{
    nodeId: '1:gap',
    fields: ['boundVariables', 'itemSpacing'],
  }];
  evidenceBundle.graph.nodes.push(evidenceNode({
    nodeId: '1:gap',
    parentNodeId: '1:0',
    childOrder: 2,
    depth: 1,
    path: '[D] ButtonsGroup / Raw gap',
    name: 'Raw gap',
    componentOwner: {
      nodeId: '1:0',
      componentKey: 'buttons-group-key',
      name: '[D] ButtonsGroup',
      path: '[D] ButtonsGroup',
      relativePath: '',
      variantProperties: { Size: '56' },
      componentProperties: { Size: '56', Overflow: 'true' },
    },
  }));

  const snapshot = adapt(evidenceBundle);
  const rawGap = snapshot.nodes.find((node) => node.id === '1:gap');
  assert.equal(rawGap.directOverride.ownerNodeId, '1:0');
  assert.equal(rawGap.directOverride.fields.itemSpacing, true);
  assert.equal(rawGap.directOverride.fields.boundVariables, true);
});

test('Snapshot v2 adapter preserves exact ButtonsGroup ownership facts', () => {
  const snapshot = adapt(bundle());
  const button = snapshot.nodes.find((node) => node.id === '1:2');
  assert.equal(button.component.name, '[D] Button');
  assert.equal(button.component.identity, 'web-core.button');
  assert.equal(button.component.properties.View, 'Secondary');
  assert.equal(button.ownership.owner.component.identity, 'web-corp.buttons-group');
  assert.equal(button.ownership.owner.component.properties.Size, '56');
  assert.deepEqual(button.composition.siblingNodeIds, ['1:1', '1:2']);
  assert.deepEqual(
    button.composition.siblingPropertyValues.SingleIcon,
    ['False', 'True'],
  );
  assert.equal(button.composition.position, 'last');
  assert.equal(button.composition.parent.nodeId, '1:0');
  assert.equal(
    button.composition.parent.component.identity,
    'web-corp.buttons-group',
  );
  assert.equal(button.ownership.contour.identity, 'web-core.button');
  assert.equal(button.ownership.contour.rootNodeId, '1:2');
  assert.equal(button.ownership.contour.isRoot, true);
  assert.equal(
    button.ownership.contour.root.component.family,
    'button',
  );
  assert.equal(snapshot.snapshotHash.length, 64);
});

test('Snapshot v2 propagates component contour and semantic host to nested layers', () => {
  const evidenceBundle = bundle();
  evidenceBundle.graph.nodes.find((node) => node.nodeId === '1:1').childNodeIds = ['1:1:1'];
  evidenceBundle.graph.nodes.push(evidenceNode({
    nodeId: '1:1:1',
    parentNodeId: '1:1',
    childOrder: 0,
    depth: 2,
    path: '[D] ButtonsGroup / Primary / Label',
    name: 'Label',
    type: 'TEXT',
    component: null,
    componentOwner: {
      nodeId: '1:1',
      componentKey: 'button-key',
      name: '[D] Button',
      path: '[D] ButtonsGroup / Primary',
      relativePath: 'Label',
      variantProperties: { View: 'Primary', Size: '56', SingleIcon: 'False' },
      componentProperties: { View: 'Primary', Size: '56', SingleIcon: 'False' },
    },
    text: { characters: 'Продолжить', length: 10, textStyleId: 'button-label' },
  }));
  evidenceBundle.coverage.visibleNodeCount += 1;
  evidenceBundle.coverage.textNodeCount += 1;

  const snapshot = adapt(evidenceBundle);
  const label = snapshot.nodes.find((node) => node.id === '1:1:1');
  assert.equal(label.ownership.contour.identity, 'web-core.button');
  assert.equal(label.ownership.contour.rootNodeId, '1:1');
  assert.equal(label.ownership.contour.isRoot, false);
  assert.equal(
    label.ownership.contour.host.component.identity,
    'web-corp.buttons-group',
  );
  assert.equal(label.ownership.contour.host.nodeId, '1:0');
});

test('P21 groups same-identity descendants under one public-root contour', () => {
  const evidenceBundle = bundle();
  const publicOwner = {
    nodeId: '21:0',
    componentKey: 'account-select-public-key',
    name: '[D] AccountOptionListContent',
    path: '[D] AccountOptionListContent',
    relativePath: '',
    variantProperties: {},
    componentProperties: {},
  };
  const itemOwner = {
    nodeId: '21:1',
    componentKey: 'account-select-item-key',
    name: 'AccountItem',
    path: '[D] AccountOptionListContent / AccountItem',
    relativePath: 'AccountItem',
    variantProperties: { Type: 'Sum' },
    componentProperties: { Type: 'Sum' },
  };
  const wrapperOwner = {
    nodeId: '21:wrapper',
    componentKey: 'account-select-wrapper-key',
    name: 'OptionCell',
    path: '[D] AccountOptionListContent / OptionCell',
    relativePath: 'OptionCell',
    variantProperties: {},
    componentProperties: {},
  };
  const standaloneOwner = Object.assign({}, itemOwner, {
    nodeId: '22:0',
    path: 'AccountItem',
    relativePath: '',
  });
  evidenceBundle.context.selectionNodeIds = ['21:0', '22:0'];
  evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '21:0',
      childNodeIds: ['21:wrapper'],
      path: '[D] AccountOptionListContent',
      name: '[D] AccountOptionListContent',
      type: 'INSTANCE',
      component: {
        key: 'account-select-public-key',
        name: '[D] AccountOptionListContent',
        variantProperties: {},
        componentProperties: {},
        directOverrides: [],
      },
    }),
    evidenceNode({
      nodeId: '21:wrapper',
      parentNodeId: '21:0',
      childNodeIds: ['21:1'],
      depth: 1,
      path: '[D] AccountOptionListContent / OptionCell',
      name: 'OptionCell',
      type: 'INSTANCE',
      component: {
        key: 'account-select-wrapper-key',
        name: 'OptionCell',
        variantProperties: {},
        componentProperties: {},
        directOverrides: [],
      },
      componentOwner: publicOwner,
    }),
    evidenceNode({
      nodeId: '21:1',
      parentNodeId: '21:wrapper',
      childNodeIds: ['21:2'],
      depth: 2,
      path: '[D] AccountOptionListContent / AccountItem',
      name: 'AccountItem',
      type: 'INSTANCE',
      component: {
        key: 'account-select-item-key',
        name: 'AccountItem',
        variantProperties: { Type: 'Sum' },
        componentProperties: { Type: 'Sum' },
        directOverrides: [],
      },
      componentOwner: wrapperOwner,
    }),
    evidenceNode({
      nodeId: '21:2',
      parentNodeId: '21:1',
      depth: 3,
      path: '[D] AccountOptionListContent / AccountItem / AccountInfo',
      name: 'AccountInfo',
      type: 'INSTANCE',
      component: {
        key: 'account-select-info-key',
        name: 'AccountInfo',
        variantProperties: {},
        componentProperties: {},
        directOverrides: [],
      },
      componentOwner: itemOwner,
    }),
    evidenceNode({
      nodeId: '22:0',
      childNodeIds: ['22:1'],
      path: 'AccountItem',
      name: 'AccountItem',
      type: 'INSTANCE',
      component: {
        key: 'account-select-item-key',
        name: 'AccountItem',
        variantProperties: { Type: 'Sum' },
        componentProperties: { Type: 'Sum' },
        directOverrides: [],
      },
    }),
    evidenceNode({
      nodeId: '22:1',
      parentNodeId: '22:0',
      depth: 1,
      path: 'AccountItem / AccountInfo',
      name: 'AccountInfo',
      type: 'INSTANCE',
      component: {
        key: 'account-select-info-key',
        name: 'AccountInfo',
        variantProperties: {},
        componentProperties: {},
        directOverrides: [],
      },
      componentOwner: standaloneOwner,
    }),
  ];
  evidenceBundle.coverage.visibleNodeCount = 6;
  evidenceBundle.coverage.componentNodeCount = 6;

  const snapshot = adapt(evidenceBundle);
  assert.equal(
    snapshot.nodes.find((node) => node.id === '21:2').ownership.contour.rootNodeId,
    '21:0',
  );
  assert.equal(
    snapshot.nodes.find((node) => node.id === '22:1').ownership.contour.rootNodeId,
    '22:0',
  );

  const rule = publicRootRule({
    ruleId: 'component:web-corp.account-select.public-roots-only',
    identity: 'web-corp.account-select',
    allowedFamilies: ['account-option-list-content'],
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/AccountSelect/rules.json',
    sourceChecksum: 'account-select-rules-checksum',
    scope: { platform: ['desktop', 'mobile-web'] },
  });
  const result = evaluateRules({ snapshot, rules: [rule] });
  assert.equal(result.evaluations.length, 2);
  assert.deepEqual(
    result.evaluations.map((item) => ({
      focusNodeId: item.focusNodeId,
      classification: item.classification,
    })),
    [
      { focusNodeId: '21:0', classification: 'compliant' },
      { focusNodeId: '22:0', classification: 'violation' },
    ],
  );
});

test('Snapshot v2 adapter treats unavailable Developer VM fileKey as an explicit unknown', () => {
  const evidenceBundle = bundle({ View: 'Accent', Size: '40' });
  evidenceBundle.context.fileKey = null;
  const snapshot = adapt(evidenceBundle);

  assert.equal(snapshot.context.fileKey, null);
  assert.equal(snapshot.context.viewportWidth, 120);
  assert.deepEqual(snapshot.context.unknownFacts, ['fileKey']);

  const result = evaluateRules({
    snapshot,
    rules: buttonsGroupReleaseRules(),
    ruleRelease: 'pilot-1',
  });
  assert.equal(result.coverage.byClassification.violation, 2);
  assert.equal(result.coverage.unclassified, 0);
});

test('Snapshot v2 adapter exposes actual and effective baseline on the same generic property path', () => {
  const evidenceBundle = bundle();
  evidenceBundle.changes = [
    {
      id: 'change-radius',
      nodeId: '1:0',
      property: 'appearance.radius',
      baselineReferenceId: 'baseline-radius',
      baseline: { value: 16, resourceName: null },
      actual: { value: 20, resourceName: null },
      bindingStatus: null,
      mapping: { method: 'apollo-effective-baseline-diff', quality: 'exact' },
    },
    {
      id: 'change-view',
      nodeId: '1:0',
      property: 'variant.View',
      baselineReferenceId: 'baseline-view',
      baseline: { value: 'Primary', resourceName: null },
      actual: { value: 'Secondary', resourceName: null },
      bindingStatus: null,
      mapping: { method: 'apollo-effective-baseline-diff', quality: 'exact' },
    },
  ];

  const snapshot = adapt(evidenceBundle);
  const root = snapshot.nodes.find((item) => item.id === '1:0');
  assert.equal(root.appearance.radius, 20);
  assert.equal(root.baseline.effective.appearance.radius, 16);
  assert.equal(root.component.properties.View, 'Secondary');
  assert.equal(root.baseline.effective.component.properties.View, 'Primary');
});

test('C19 exposes text-style binding and baseline facts for a non-TitleView component', () => {
  const buildTooltip = ({ actualStyleId, actualStyleName, changed }) => {
    const textNodeId = '2:text';
    const evidenceBundle = bundle();
    evidenceBundle.context.selectionNodeIds = ['2:tooltip'];
    evidenceBundle.graph.nodes = [
      evidenceNode({
        nodeId: '2:tooltip',
        childNodeIds: [textNodeId],
        path: 'Onboarding Tooltip [D]',
        name: 'Onboarding Tooltip [D]',
        type: 'INSTANCE',
        component: {
          key: 'onboarding-tooltip-key',
          name: 'Onboarding Tooltip [D]',
          variantProperties: {},
          componentProperties: {},
          directOverrides: changed ? [{ nodeId: textNodeId, fields: ['textStyleId'] }] : [],
        },
      }),
      evidenceNode({
        nodeId: textNodeId,
        parentNodeId: '2:tooltip',
        childOrder: 0,
        depth: 1,
        path: 'Onboarding Tooltip [D] / Title',
        name: 'Title',
        type: 'TEXT',
        text: {
          characters: 'Подсказка',
          length: 9,
          textStyleId: actualStyleId,
        },
        styles: {
          fillStyleId: null,
          strokeStyleId: null,
          textStyleId: actualStyleId,
          effectStyleId: null,
        },
        componentOwner: {
          nodeId: '2:tooltip',
          componentKey: 'onboarding-tooltip-key',
          name: 'Onboarding Tooltip [D]',
          path: 'Onboarding Tooltip [D]',
          relativePath: 'Title',
          variantProperties: {},
          componentProperties: {},
        },
      }),
    ];
    evidenceBundle.graph.relations = [];
    evidenceBundle.changes = changed ? [{
      id: 'change-tooltip-title-style',
      nodeId: textNodeId,
      nodeName: 'Title',
      nodePath: 'Onboarding Tooltip [D] / Title',
      property: 'styles.text',
      kind: 'text-style',
      ownerComponentKey: 'onboarding-tooltip-key',
      baselineReferenceId: 'baseline-tooltip-title-style',
      baseline: {
        value: 'Paragraph/16',
        resourceType: 'style',
        resourceName: 'Paragraph/16',
      },
      actual: {
        value: actualStyleName,
        resourceType: actualStyleId ? 'style' : null,
        resourceName: actualStyleName,
      },
      mapping: { method: 'apollo-effective-baseline-diff', quality: 'exact' },
    }] : [];
    return adapt(evidenceBundle);
  };

  const canonical = buildTooltip({
    actualStyleId: 'style-paragraph-16',
    actualStyleName: 'Paragraph/16',
    changed: false,
  }).nodes.find((node) => node.id === '2:text');
  assert.deepEqual(canonical.bindings.styles.text, {
    bound: true,
    kind: 'text-style',
    value: 'style-paragraph-16',
    styleId: 'style-paragraph-16',
  });
  assert.equal(
    canonical.baseline.effective.appearance.styles.textStyle,
    'style-paragraph-16',
  );

  const wrong = buildTooltip({
    actualStyleId: 'style-paragraph-14',
    actualStyleName: 'Paragraph/14',
    changed: true,
  }).nodes.find((node) => node.id === '2:text');
  assert.equal(wrong.bindings.styles.text.bound, true);
  assert.equal(wrong.appearance.styles.textStyle, 'Paragraph/14');
  assert.equal(
    wrong.baseline.effective.appearance.styles.textStyle,
    'Paragraph/16',
  );

  const raw = buildTooltip({
    actualStyleId: null,
    actualStyleName: null,
    changed: true,
  }).nodes.find((node) => node.id === '2:text');
  assert.deepEqual(raw.bindings.styles.text, {
    bound: false,
    kind: 'text-style',
    value: null,
    styleId: null,
  });
  assert.equal(raw.appearance.styles.textStyle, null);
  assert.equal(
    raw.baseline.effective.appearance.styles.textStyle,
    'Paragraph/16',
  );
});

test('C16 preserves canonical fill pairs and their effective baseline provenance', () => {
  const evidenceBundle = bundle();
  evidenceBundle.context.selectionNodeIds = ['2:fill'];
  evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '2:fill',
    path: 'Onboarding Tooltip / Surface',
    name: 'Surface',
    appearance: {
      opacity: 1,
      radius: 16,
      fill: {
        value: 'base-bg/primary',
        resourceType: 'token',
        resourceId: 'actual-token-key',
        resourceName: 'base-bg/primary',
        bindingName: 'base-bg/primary',
        bindingCollection: 'Interface Dynamic',
        styleId: null,
        visible: true,
        paintCount: 1,
        paintTypes: ['SOLID'],
      },
    },
  })];
  evidenceBundle.baselines = [{
    id: 'baseline-tooltip-fill',
    componentKey: 'onboarding-tooltip-key',
    nestedOwnerComponentKey: 'onboarding-tooltip-key',
    nestedOwnerRelativePath: 'Surface',
    variantProperties: { View: 'Primary', Direction: 'Top' },
  }];
  evidenceBundle.changes = [{
    id: 'change-tooltip-fill',
    nodeId: '2:fill',
    nodeName: 'Surface',
    nodePath: 'Onboarding Tooltip / Surface',
    property: 'fill',
    kind: 'paint',
    ownerComponentKey: 'onboarding-tooltip-key',
    baselineReferenceId: 'baseline-tooltip-fill',
    baseline: {
      value: '#FFFFFF',
      resourceType: 'token',
      resourceName: 'base-bg/secondary',
      bindingName: 'base-bg/secondary',
      bindingCollection: 'Interface Dynamic',
    },
    actual: {
      value: '#FFFFFF',
      resourceType: 'token',
      resourceName: 'base-bg/primary',
      bindingName: 'base-bg/primary',
      bindingCollection: 'Interface Dynamic',
    },
    bindingStatus: 'different-binding',
    mapping: {
      method: 'apollo-effective-baseline-diff',
      quality: 'exact',
      referenceOrigin: 'nested-component',
      nestedOwnerRelativePath: 'Surface',
    },
    candidateRuleIds: [],
  }];

  const snapshot = adapt(evidenceBundle);
  const fillNode = snapshot.nodes[0];
  assert.equal(fillNode.appearance.fill.value, 'base-bg/primary');
  assert.equal(
    fillNode.baseline.effective.appearance.fill.value,
    'base-bg/secondary',
  );
  assert.deepEqual(
    fillNode.baseline.origins.appearance.fill.variantProperties,
    { View: 'Primary', Direction: 'Top' },
  );
  assert.equal(
    fillNode.baseline.origins.appearance.fill.mapping.referenceOrigin,
    'nested-component',
  );
  assert.equal(
    fillNode.baseline.origins.appearance.fill.bindingCollection,
    'Interface Dynamic',
  );
});

test('C16 derives unchanged fill baseline only when fill has no direct override', () => {
  const evidenceBundle = bundle();
  evidenceBundle.context.selectionNodeIds = ['2:fill-pass'];
  evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '2:fill-pass',
    path: 'Onboarding Tooltip / Surface',
    name: 'Surface',
    type: 'INSTANCE',
    component: {
      key: 'button-key',
      name: 'Surface',
      variantProperties: {},
      componentProperties: {},
      directOverrides: [],
    },
    appearance: {
      opacity: 1,
      radius: 16,
      fill: {
        value: 'base-bg/secondary',
        resourceType: 'token',
        resourceId: 'baseline-token-key',
        resourceName: 'base-bg/secondary',
        bindingName: 'base-bg/secondary',
        bindingCollection: 'Interface Dynamic',
        styleId: null,
        visible: true,
        paintCount: 1,
        paintTypes: ['SOLID'],
      },
    },
  })];

  const snapshot = adapt(evidenceBundle);
  assert.equal(snapshot.nodes[0].appearance.fill.value, 'base-bg/secondary');
  assert.equal(
    snapshot.nodes[0].baseline.effective.appearance.fill.value,
    'base-bg/secondary',
  );
});

test('C17 preserves canonical stroke pairs, effective baseline provenance and binding facts', () => {
  const evidenceBundle = bundle();
  evidenceBundle.context.selectionNodeIds = ['2:stroke'];
  evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '2:stroke',
    path: 'TabsView / Divider',
    name: 'Divider',
    appearance: {
      opacity: 1,
      radius: 0,
      fill: null,
      stroke: {
        value: 'border/secondary',
        resourceType: 'token',
        resourceId: 'stroke-actual-key',
        resourceName: 'border/secondary',
        bindingName: 'border/secondary',
        bindingCollection: 'Interface Dynamic',
        styleId: null,
        visible: true,
        paintCount: 1,
        paintTypes: ['SOLID'],
      },
    },
    variableBindings: [{
      property: 'strokes',
      variableIds: ['VariableID:stroke-actual'],
      variables: [{
        id: 'VariableID:stroke-actual',
        key: 'stroke-actual-key',
        name: 'border/secondary',
        collectionId: 'collection:interface-dynamic',
        collectionName: 'Interface Dynamic',
      }],
    }],
  })];
  evidenceBundle.baselines = [{
    id: 'baseline-tabs-stroke',
    componentKey: 'tabs-view-key',
    nestedOwnerComponentKey: 'tabs-view-key',
    nestedOwnerRelativePath: 'Divider',
    variantProperties: { View: 'Primary' },
  }];
  evidenceBundle.changes = [{
    id: 'change-tabs-stroke',
    nodeId: '2:stroke',
    nodeName: 'Divider',
    nodePath: 'TabsView / Divider',
    property: 'stroke',
    kind: 'paint',
    ownerComponentKey: 'tabs-view-key',
    baselineReferenceId: 'baseline-tabs-stroke',
    baseline: {
      value: '#D2D3D9',
      resourceType: 'token',
      resourceName: 'border/primary',
      bindingName: 'border/primary',
      bindingCollection: 'Interface Dynamic',
    },
    actual: {
      value: '#B8BAC2',
      resourceType: 'token',
      resourceName: 'border/secondary',
      bindingName: 'border/secondary',
      bindingCollection: 'Interface Dynamic',
    },
    bindingStatus: 'different-binding',
    mapping: {
      method: 'apollo-effective-baseline-diff',
      quality: 'exact',
      referenceOrigin: 'nested-component',
      nestedOwnerRelativePath: 'Divider',
    },
    candidateRuleIds: [],
  }];

  const snapshot = adapt(evidenceBundle);
  const strokeNode = snapshot.nodes[0];
  assert.equal(strokeNode.appearance.stroke.value, 'border/secondary');
  assert.equal(
    strokeNode.baseline.effective.appearance.stroke.value,
    'border/primary',
  );
  assert.equal(
    strokeNode.baseline.origins.appearance.stroke.mapping.referenceOrigin,
    'nested-component',
  );
  assert.deepEqual(strokeNode.bindings.strokes, {
    bound: true,
    value: null,
    variableIds: ['VariableID:stroke-actual'],
    variables: [{
      id: 'VariableID:stroke-actual',
      key: 'stroke-actual-key',
      name: 'border/secondary',
      collectionId: 'collection:interface-dynamic',
      collectionName: 'Interface Dynamic',
    }],
    collection: 'Interface Dynamic',
    token: 'border/secondary',
    variableId: 'VariableID:stroke-actual',
  });
});

test('C17 materializes a visible raw stroke as an explicit unbound fact', () => {
  const evidenceBundle = bundle();
  evidenceBundle.context.selectionNodeIds = ['2:raw-stroke'];
  evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '2:raw-stroke',
    path: 'BackgroundPlate / Style Level 1',
    name: '[D] Style Level 1',
    appearance: {
      opacity: 1,
      radius: 0,
      fill: null,
      stroke: {
        value: '#747474',
        resourceType: 'paint',
        resourceId: null,
        resourceName: null,
        bindingName: null,
        bindingCollection: null,
        styleId: null,
        visible: true,
        paintCount: 1,
        paintTypes: ['SOLID'],
      },
    },
    variableBindings: [],
  })];

  const snapshot = adapt(evidenceBundle);
  assert.deepEqual(snapshot.nodes[0].bindings.strokes, {
    bound: false,
    value: '#747474',
    variableIds: [],
    variables: [],
    collection: null,
    token: null,
    variableId: null,
  });
});

test('P26 derives unchanged appearance baseline only when no direct override exists', () => {
  const evidenceBundle = bundle();
  evidenceBundle.context.selectionNodeIds = ['2:0'];
  evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '2:0',
    path: '[D] TitleView',
    name: '[D] TitleView',
    type: 'INSTANCE',
    component: {
      key: 'title-view-key',
      name: '[D] TitleView',
      variantProperties: { View: 'xLarge' },
      componentProperties: { View: 'xLarge' },
      directOverrides: [],
    },
    appearance: { opacity: 1, radius: 0 },
  })];
  evidenceBundle.graph.relations = [];

  const snapshot = adapt(evidenceBundle);
  assert.equal(snapshot.nodes[0].baseline.effective.appearance.opacity, 1);
  assert.equal(snapshot.nodes[0].baseline.effective.appearance.radius, 0);
  assert.equal(
    snapshot.nodes[0].unknownFacts.includes(
      'baseline.effective.appearance.opacity',
    ),
    false,
  );
  assert.equal(
    snapshot.nodes[0].unknownFacts.includes(
      'baseline.effective.appearance.radius',
    ),
    false,
  );
});

test('P26 keeps an overridden appearance fact unknown without an exact baseline diff', () => {
  const evidenceBundle = bundle();
  evidenceBundle.context.selectionNodeIds = ['2:0'];
  evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '2:0',
    path: '[D] TitleView',
    name: '[D] TitleView',
    type: 'INSTANCE',
    component: {
      key: 'title-view-key',
      name: '[D] TitleView',
      variantProperties: { View: 'xLarge' },
      componentProperties: { View: 'xLarge' },
      directOverrides: [{ nodeId: '2:0', fields: ['opacity'] }],
    },
    appearance: { opacity: 0.5, radius: 0 },
  })];
  evidenceBundle.graph.relations = [];

  const snapshot = adapt(evidenceBundle);
  assert.equal(
    snapshot.nodes[0].baseline.effective.appearance.opacity,
    undefined,
  );
  assert.ok(snapshot.nodes[0].unknownFacts.includes(
    'baseline.effective.appearance.opacity',
  ));
  assert.equal(snapshot.nodes[0].baseline.effective.appearance.radius, 0);
});

test('P01, P02, P03 and P09 produce stable exact focus without an agent call', () => {
  const rules = buttonsGroupReleaseRules();
  assert.equal(
    rules[0].source.path,
    'design-system_ab/JSONS/web/components/web-corp/ButtonGroup [D]/composition-contract.json',
  );
  assert.equal(
    rules[0].source.anchor,
    'manual/contracts/buttons-group.desktop-composition/constraints/button-count',
  );
  assert.equal(
    rules[1].source.anchor,
    'manual/contracts/buttons-group.desktop-composition/constraints/allowed-views',
  );
  assert.equal(
    rules[2].source.anchor,
    'manual/contracts/buttons-group.desktop-composition/constraints/uniform-size',
  );
  assert.equal(
    rules.find((rule) => (
      rule.ruleId === 'component:web-corp.buttons-group.single-icon-position'
    )).source.anchor,
    'manual/contracts/buttons-group.desktop-composition/constraints/single-icon-position',
  );
  const pass = evaluateRules({ snapshot: adapt(bundle()), rules, ruleRelease: 'pilot-1' });
  assert.equal(pass.coverage.byClassification.compliant, 12);
  assert.equal(pass.coverage.unclassified, 0);

  const fail = evaluateRules({
    snapshot: adapt(bundle({ View: 'Accent', Size: '40', SingleIcon: 'True' })),
    rules,
    ruleRelease: 'pilot-1',
  });
  const violations = fail.evaluations.filter((item) => item.classification === 'violation');
  assert.equal(violations.length, 2);
  assert.deepEqual(new Set(violations.map((item) => item.focusNodeId)), new Set(['1:2']));
  assert.deepEqual(
    new Set(violations.map((item) => item.ruleId)),
    new Set([
      'component:web-corp.buttons-group.allowed-views',
      'component:web-corp.buttons-group.uniform-size',
    ]),
  );
  assert.equal(fail.coverage.unclassified, 0);
  assert.equal(fail.coverage.duplicateEvaluationIds, 0);
});

test('P03 and SingleIcon dependency classify position and Overflow independently', () => {
  const rules = buttonsGroupReleaseRules();
  const rule = rules
    .find((item) => item.ruleId === 'component:web-corp.buttons-group.single-icon-position');
  const dependencyRule = rules.find((item) => (
    item.ruleId === 'component:web-corp.buttons-group.overflow-enables-last-single-icon'
  ));

  const pass = evaluateRules({ snapshot: adapt(bundle()), rules: [rule] });
  const passEvaluation = pass.evaluations.find((item) => item.classification === 'compliant');
  assert.equal(passEvaluation.focusNodeId, '1:2');

  const failBundle = bundle({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  failBundle.graph.nodes[1].component.variantProperties.SingleIcon = 'True';
  failBundle.graph.nodes[1].component.componentProperties.SingleIcon = 'True';
  const fail = evaluateRules({ snapshot: adapt(failBundle), rules: [rule] });
  const violation = fail.evaluations.find((item) => item.classification === 'violation');
  assert.equal(violation.focusNodeId, '1:1');
  assert.deepEqual(violation.trace.factPaths, [
    'composition.siblingPropertyValues.SingleIcon',
  ]);

  const overflowDisabledBundle = bundle();
  overflowDisabledBundle.graph.nodes[0].component.variantProperties.Overflow = 'false';
  overflowDisabledBundle.graph.nodes[0].component.componentProperties.Overflow = 'false';
  for (const node of overflowDisabledBundle.graph.nodes.slice(1)) {
    node.componentOwner.variantProperties.Overflow = 'false';
    node.componentOwner.componentProperties.Overflow = 'false';
  }
  const overflowDisabled = evaluateRules({
    snapshot: adapt(overflowDisabledBundle),
    rules: [rule, dependencyRule],
  });
  const overflowViolation = overflowDisabled.evaluations.find(
    (item) => (
      item.ruleId === dependencyRule.ruleId &&
      item.classification === 'violation'
    ),
  );
  assert.equal(overflowViolation.focusNodeId, '1:2');
  assert.equal(
    overflowDisabled.evaluations.find((item) => item.ruleId === rule.ruleId).classification,
    'not-applicable',
  );

  const unknownBundle = bundle();
  delete unknownBundle.graph.nodes[1].component.variantProperties.SingleIcon;
  delete unknownBundle.graph.nodes[1].component.componentProperties.SingleIcon;
  const unknown = evaluateRules({ snapshot: adapt(unknownBundle), rules: [rule] });
  const notEvaluable = unknown.evaluations.find(
    (item) => item.classification === 'not-evaluable',
  );
  assert.equal(notEvaluable.focusNodeId, '1:2');
});

test('unresolved component metadata becomes unknown instead of a guessed identity', () => {
  const snapshot = buildPredicateSnapshotV2({
    evidenceBundle: bundle(),
    auditId: 'predicate-field-packet-unknown',
    pageType: 'form',
    release: {
      knowledgeSource: 'design-system_ab',
      revision: 'release-1',
      checksum: 'release-checksum-1',
    },
    componentIndex: {},
  });
  assert.ok(snapshot.nodes[1].unknownFacts.includes('component.identity'));
  const result = evaluateRules({
    snapshot,
    rules: buttonsGroupReleaseRules(),
  });
  assert.equal(result.evaluations[0].classification, 'not-evaluable');
});

test('component selectors ignore non-instance nodes without producing unknown candidates', () => {
  const evidenceBundle = bundle();
  evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '1:0',
    path: 'Page frame',
    name: 'Page frame',
    type: 'FRAME',
  })];
  evidenceBundle.coverage.visibleNodeCount = 1;
  evidenceBundle.coverage.componentNodeCount = 0;
  const snapshot = buildPredicateSnapshotV2({
    evidenceBundle,
    auditId: 'predicate-non-instance-selector-guard',
    pageType: 'form',
    release: {
      knowledgeSource: 'design-system_ab',
      revision: 'release-1',
      checksum: 'release-checksum-1',
    },
    componentIndex: {},
  });
  const result = evaluateRules({
    snapshot,
    rules: buttonsGroupReleaseRules(),
  });
  assert.deepEqual(
    new Set(result.evaluations.map((item) => item.classification)),
    new Set(['not-applicable']),
  );
});

function titleViewBundle(options = {}) {
  const titleNodeId = '2:1';
  const changed = options.changed === true;
  const unresolvedOverride = options.unresolvedOverride === true;
  const directOverrides = changed || unresolvedOverride
    ? [{ nodeId: titleNodeId, fields: ['textStyleId'] }]
    : [];
  const evidenceBundle = bundle();
  evidenceBundle.context.selectionNodeIds = ['2:0'];
  evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '2:0',
      childNodeIds: [titleNodeId],
      path: '[D] TitleView',
      name: '[D] TitleView',
      type: 'INSTANCE',
      component: {
        key: 'title-view-key',
        name: '[D] TitleView',
        variantProperties: { View: 'xLarge' },
        componentProperties: { View: 'xLarge' },
        directOverrides,
      },
    }),
    evidenceNode({
      nodeId: titleNodeId,
      parentNodeId: '2:0',
      childOrder: 0,
      depth: 1,
      path: '[D] TitleView / Title',
      name: 'Title',
      type: 'TEXT',
      text: {
        characters: 'Заголовок',
        length: 9,
        textStyleId: changed ? 'style-actual' : 'style-baseline',
      },
      styles: {
        fillStyleId: null,
        strokeStyleId: null,
        textStyleId: changed ? 'style-actual' : 'style-baseline',
        effectStyleId: null,
      },
      componentOwner: {
        nodeId: '2:0',
        componentKey: 'title-view-key',
        name: '[D] TitleView',
        path: '[D] TitleView',
        relativePath: 'Title',
        variantProperties: { View: 'xLarge' },
        componentProperties: { View: 'xLarge' },
      },
    }),
  ];
  evidenceBundle.graph.relations = [];
  evidenceBundle.changes = changed
    ? [{
        id: 'change-title-style',
        nodeId: titleNodeId,
        nodeName: 'Title',
        nodePath: '[D] TitleView / Title',
        property: 'styles.text',
        kind: 'text-style',
        ownerComponentKey: 'title-view-key',
        baselineReferenceId: 'baseline-title-view',
        baseline: {
          value: 'Headline/40',
          resourceType: 'style',
          resourceName: 'Headline/40',
          bindingName: null,
          bindingCollection: null,
        },
        actual: {
          value: 'Headline/30',
          resourceType: 'style',
          resourceName: 'Headline/30',
          bindingName: null,
          bindingCollection: null,
        },
        bindingStatus: null,
        mapping: {
          method: 'apollo-effective-baseline-diff',
          quality: 'exact',
          referenceOrigin: 'host',
          nestedOwnerRelativePath: null,
        },
        candidateRuleIds: [
          'component:web-corp.title-view.title-and-subtitle-typography-is-fixed',
        ],
      }]
    : [];
  return evidenceBundle;
}

test('P04 matches-effective-baseline proves PASS and FAIL without guessing', () => {
  const rule = [titleViewTypographyContourRule()];
  const passSnapshot = adapt(titleViewBundle());
  const pass = evaluateRules({ snapshot: passSnapshot, rules: rule });
  assert.equal(pass.coverage.byClassification.compliant, 1);
  assert.equal(
    passSnapshot.nodes[1].baseline.effective.appearance.styles.textStyle,
    'style-baseline',
  );

  const failSnapshot = adapt(titleViewBundle({ changed: true }));
  const fail = evaluateRules({ snapshot: failSnapshot, rules: rule });
  const violation = fail.evaluations.find(
    (item) => item.classification === 'violation',
  );
  assert.equal(violation.focusNodeId, '2:1');
  const baselineTrace = violation.trace.children.find((child) => (
    child.predicate === 'matches-effective-baseline'
  ));
  assert.equal(baselineTrace.actual, 'Headline/30');
  assert.equal(baselineTrace.expected, 'Headline/40');
});

test('P04 proves a missing TitleView text style is a violation without guessing its baseline', () => {
  const missingStyle = titleViewBundle({ unresolvedOverride: true });
  missingStyle.graph.nodes[1].styles.textStyleId = null;
  missingStyle.graph.nodes[1].text.textStyleId = null;
  const evaluation = evaluateRules({
    snapshot: adapt(missingStyle),
    rules: [titleViewTypographyContourRule()],
  }).evaluations.find((item) => (
    item.ruleId === 'component:web-corp.title-view.title-and-subtitle-typography-is-fixed'
  ));
  assert.equal(evaluation.classification, 'violation');
  assert.equal(evaluation.trace.children[0].predicate, 'exists');
  assert.equal(evaluation.trace.children[0].truth, 'false');
});

test('desktop Button pattern rejects Accent inside TitleView', () => {
  const evidenceBundle = bundle();
  evidenceBundle.context.pageType = 'details';
  evidenceBundle.context.selectionNodeIds = ['2:0'];
  evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '2:0',
      childNodeIds: ['2:2'],
      path: '[D] TitleView',
      name: '[D] TitleView',
      type: 'INSTANCE',
      component: {
        key: 'title-view-key',
        name: '[D] TitleView',
        variantProperties: { View: 'xLarge' },
        componentProperties: { View: 'xLarge' },
        directOverrides: [],
      },
    }),
    evidenceNode({
      nodeId: '2:2',
      parentNodeId: '2:0',
      childOrder: 0,
      depth: 1,
      path: '[D] TitleView / Button group / [D] Button',
      name: '[D] Button',
      type: 'INSTANCE',
      component: {
        key: 'button-key',
        name: '[D] Button',
        variantProperties: { View: 'Accent', Size: '56' },
        componentProperties: { View: 'Accent', Size: '56' },
        directOverrides: [],
      },
      componentOwner: {
        nodeId: '2:0',
        componentKey: 'title-view-key',
        name: '[D] TitleView',
        path: '[D] TitleView',
        relativePath: 'Button group / [D] Button',
        variantProperties: { View: 'xLarge' },
        componentProperties: { View: 'xLarge' },
      },
    }),
  ];
  const evaluation = evaluateRules({
    snapshot: adapt(evidenceBundle),
    rules: [desktopButtonSafeVariantsContourRule()],
  }).evaluations[0];
  assert.equal(evaluation.classification, 'violation');
  assert.equal(evaluation.focusNodeId, '2:2');
});

test('P04 returns UNKNOWN when Figma reports an override but no exact baseline diff', () => {
  const snapshot = adapt(titleViewBundle({ unresolvedOverride: true }));
  assert.ok(
    snapshot.nodes[1].unknownFacts.includes(
      'baseline.effective.appearance.styles.textStyle',
    ),
  );
  const result = evaluateRules({
    snapshot,
    rules: [titleViewTypographyContourRule()],
  });
  const typography = result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.title-view.title-and-subtitle-typography-is-fixed'
  ));
  assert.equal(typography.classification, 'not-evaluable');
});

function titleViewStatusBundle(mode) {
  const evidenceBundle = bundle();
  const titleStatusProperties = mode === 'unknown' ? {} : {
    Type: mode === 'fail' ? 'Attention' : 'Approved',
  };
  evidenceBundle.context.selectionNodeIds = ['5:0'];
  evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '5:0',
      childNodeIds: mode === 'not-applicable' ? ['5:2'] : ['5:1', '5:2'],
      path: '[D] TitleView',
      name: '[D] TitleView',
      type: 'INSTANCE',
      component: {
        key: 'title-view-key',
        name: '[D] TitleView',
        variantProperties: { View: 'xLarge' },
        componentProperties: { View: 'xLarge' },
        directOverrides: [],
      },
    }),
    ...(mode === 'not-applicable' ? [] : [evidenceNode({
      nodeId: '5:1',
      parentNodeId: '5:0',
      childOrder: 0,
      depth: 1,
      path: '[D] TitleView / Status / StatusPreset',
      name: 'StatusPreset',
      type: 'INSTANCE',
      component: {
        key: 'status-preset-key',
        name: 'StatusPreset',
        variantProperties: { Type: 'Approved' },
        componentProperties: { Type: 'Approved' },
        directOverrides: [],
      },
    })]),
    evidenceNode({
      nodeId: '5:2',
      parentNodeId: '5:0',
      childOrder: 1,
      depth: 1,
      path: '[D] TitleView / [D] TitleStatus',
      name: '[D] TitleStatus',
      type: 'INSTANCE',
      component: {
        key: 'title-status-key',
        name: '[D] TitleStatus',
        variantProperties: titleStatusProperties,
        componentProperties: titleStatusProperties,
        directOverrides: [],
      },
    }),
  ];
  evidenceBundle.graph.relations = [];
  evidenceBundle.changes = [];
  return evidenceBundle;
}

function titleViewStatusContourDefinition() {
  return {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'owned-peer-property-equality',
    ruleId: 'component:web-corp.title-view.status-and-title-status-color-match',
    revision: 1,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/TitleView/rules.json',
    sourceChecksum: 'title-view-rules-checksum',
    sourceAnchor: 'rules/component:web-corp.title-view.status-and-title-status-color-match',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
    ownerIdentity: 'web-corp.title-view',
    target: {
      identity: 'web-corp.title-view',
      names: ['[D] TitleStatus', '[M] TitleStatus'],
    },
    members: [{
      role: 'Status',
      names: ['StatusPreset'],
      propertyFact: 'component.properties.Type',
    }, {
      role: 'TitleStatus',
      names: ['[D] TitleStatus', '[M] TitleStatus'],
      propertyFact: 'component.properties.Type',
    }],
    requiredRoles: ['Status', 'TitleStatus'],
    collectionKey: 'statusTypeConsistency',
    scope: { platform: ['desktop', 'mobile-web'] },
    unknownPolicy: 'not-evaluable',
  };
}

test('P07 owned peer equality focuses the mismatching target and preserves four states', () => {
  const definition = titleViewStatusContourDefinition();
  const rule = compileContourRule(definition);

  const passSnapshot = adapt(titleViewStatusBundle('pass'), {
    contourDefinitions: [definition],
  });
  const passTarget = passSnapshot.nodes.find((node) => node.id === '5:2');
  assert.deepEqual(
    passTarget.composition.peerCollections.statusTypeConsistency.roles,
    ['Status', 'TitleStatus'],
  );
  assert.deepEqual(
    passTarget.composition.peerCollections.statusTypeConsistency.values,
    ['Approved', 'Approved'],
  );
  assert.equal(evaluateRules({ snapshot: passSnapshot, rules: [rule] })
    .evaluations[0].classification, 'compliant');

  const fail = evaluateRules({
    snapshot: adapt(titleViewStatusBundle('fail'), { contourDefinitions: [definition] }),
    rules: [rule],
  }).evaluations[0];
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '5:2');
  assert.deepEqual(fail.trace.actual, ['Approved', 'Attention']);
  assert.deepEqual(
    fail.trace.factPaths,
    ['composition.peerCollections.statusTypeConsistency.values'],
  );

  const unknown = evaluateRules({
    snapshot: adapt(titleViewStatusBundle('unknown'), { contourDefinitions: [definition] }),
    rules: [rule],
  }).evaluations[0];
  assert.equal(unknown.classification, 'not-evaluable');

  const notApplicable = evaluateRules({
    snapshot: adapt(titleViewStatusBundle('not-applicable'), {
      contourDefinitions: [definition],
    }),
    rules: [rule],
  }).evaluations[0];
  assert.equal(notApplicable.classification, 'not-applicable');
});

function backgroundPlateBundle(bindingMode) {
  const evidenceBundle = bundle();
  evidenceBundle.context.selectionNodeIds = ['3:0'];
  evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '3:0',
    path: '[D] BackgroundPlateSlot',
    name: '[D] BackgroundPlateSlot',
    type: 'INSTANCE',
    layout: {
      mode: 'VERTICAL',
      wrap: 'NO_WRAP',
      sizingHorizontal: 'FILL',
      sizingVertical: 'HUG',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      padding: { top: 32, right: 32, bottom: 32, left: 32 },
      itemSpacing: 16,
      clipsContent: false,
    },
    component: {
      key: 'background-plate-slot-key',
      name: '[D] BackgroundPlateSlot',
      variantProperties: { Type: 'Primary' },
      componentProperties: { Type: 'Primary' },
      directOverrides: [],
    },
    variableBindings: ['top', 'right', 'bottom', 'left'].flatMap((side) => {
      if (bindingMode === 'raw' && side === 'right') return [];
      const variable = {
        id: `VariableID:spacing-${side}`,
        key: `spacing-${side}-key`,
        name: '32',
        collectionId: 'collection:spacing',
        collectionName: 'Spacing',
      };
      return [{
        property: `padding${side[0].toUpperCase()}${side.slice(1)}`,
        variableIds: [variable.id],
        variables: bindingMode === 'unknown' && side === 'top' ? [] : [variable],
      }];
    }),
  })];
  evidenceBundle.graph.relations = [];
  evidenceBundle.changes = ['top', 'right', 'bottom', 'left'].map((side) => ({
    id: `padding-${side}`,
    nodeId: '3:0',
    property: `layout.padding.${side}`,
    baseline: { value: 24 },
    actual: { value: 32 },
    bindingStatus: bindingMode === 'raw' && side === 'right'
      ? 'missing-actual-binding'
      : 'different-binding',
  }));
  return evidenceBundle;
}

test('P05 binding-satisfies classifies tokenized, raw and unresolved padding', () => {
  const rules = backgroundPlatePaddingBindingContourRules();
  const pass = evaluateRules({
    snapshot: adapt(backgroundPlateBundle('bound')),
    rules,
  });
  assert.equal(pass.coverage.byClassification.compliant, 4);

  const fail = evaluateRules({
    snapshot: adapt(backgroundPlateBundle('raw')),
    rules,
  });
  const violation = fail.evaluations.find(
    (item) => item.classification === 'violation',
  );
  assert.equal(violation.focusNodeId, '3:0');
  assert.equal(
    violation.ruleId,
    'component:web-corp.background-plate.padding-uses-spacing-tokens.right',
  );
  assert.equal(violation.trace.children[0].actual, 32);
  assert.deepEqual(violation.trace.children[1].actual, {
    bound: false,
    value: 32,
    variableIds: [],
    variables: [],
    collection: null,
    token: null,
    variableId: null,
  });

  const unknown = evaluateRules({
    snapshot: adapt(backgroundPlateBundle('unknown')),
    rules,
  });
  assert.equal(unknown.coverage.byClassification['not-evaluable'], 1);

  const untouchedBundle = backgroundPlateBundle('raw');
  untouchedBundle.changes = [];
  const untouchedSnapshot = adapt(untouchedBundle);
  const untouched = evaluateRules({ snapshot: untouchedSnapshot, rules });
  assert.equal(untouched.coverage.byClassification.compliant, 3);
  assert.equal(untouched.coverage.byClassification.violation, 1);
  assert.deepEqual(untouchedSnapshot.nodes[0].overrideProperties, []);

  const notApplicable = evaluateRules({ snapshot: adapt(bundle()), rules });
  assert.equal(notApplicable.coverage.byClassification['not-applicable'], 4);

  const nestedBundle = backgroundPlateBundle('raw');
  nestedBundle.graph.nodes[0].componentOwner = {
    nodeId: '3:owner',
    componentKey: 'title-view-key',
    name: '[D] TitleView',
    path: '[D] TitleView',
    relativePath: 'Content / [D] BackgroundPlate',
    variantProperties: { View: 'Medium' },
    componentProperties: { View: 'Medium' },
  };
  const nested = evaluateRules({ snapshot: adapt(nestedBundle), rules });
  assert.equal(nested.coverage.byClassification['not-applicable'], 4);
  assert.equal(nested.coverage.byClassification.violation || 0, 0);
});

function backgroundPlateCompositionBundle(mode) {
  const evidenceBundle = bundle();
  const level2 = evidenceNode({
    nodeId: '4:2',
    parentNodeId: mode === 'unknown' ? null : '4:0',
    childOrder: 1,
    depth: mode === 'unknown' ? 0 : 1,
    path: 'Fixture Auto Layout / [D] BackgroundPlate Level 2',
    name: '[D] BackgroundPlate',
    type: 'INSTANCE',
    bounds: { x: 24, y: 24, width: 352, height: 252 },
    layout: {
      mode: 'VERTICAL',
      positioning: 'AUTO',
      wrap: 'NO_WRAP',
      sizingHorizontal: 'FILL',
      sizingVertical: 'HUG',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
      itemSpacing: 16,
      clipsContent: false,
    },
    component: {
      key: 'background-plate-key',
      name: '[D] BackgroundPlate',
      variantProperties: { Position: 'Level 2 (inner)' },
      componentProperties: { Position: 'Level 2 (inner)' },
      directOverrides: [],
    },
  });
  const level1 = evidenceNode({
    nodeId: '4:1',
    parentNodeId: '4:0',
    childOrder: 0,
    depth: 1,
    path: 'Fixture Auto Layout / [D] BackgroundPlate Level 1',
    name: '[D] BackgroundPlate',
    type: 'INSTANCE',
    bounds: mode === 'outside'
      ? { x: 0, y: 0, width: 20, height: 20 }
      : { x: 0, y: 0, width: 400, height: 300 },
    layout: {
      mode: 'VERTICAL',
      positioning: mode === 'wrong-positioning' ? 'AUTO' : 'ABSOLUTE',
      wrap: 'NO_WRAP',
      sizingHorizontal: 'FILL',
      sizingVertical: 'FILL',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      padding: { top: 32, right: 32, bottom: 32, left: 32 },
      itemSpacing: 16,
      clipsContent: false,
    },
    component: {
      key: 'background-plate-key',
      name: '[D] BackgroundPlate',
      variantProperties: { Position: 'Level 1 (outer)' },
      componentProperties: { Position: 'Level 1 (outer)' },
      directOverrides: [],
    },
  });
  evidenceBundle.context.selectionNodeIds = mode === 'unknown' ? ['4:2'] : ['4:0'];
  evidenceBundle.graph.nodes = mode === 'unknown'
    ? [level2]
    : [
        evidenceNode({
          nodeId: '4:0',
          childNodeIds: mode === 'fail' ? ['4:2'] : ['4:1', '4:2'],
          path: 'Fixture Auto Layout',
          name: 'Fixture Auto Layout',
          type: 'FRAME',
          bounds: { x: 0, y: 0, width: 400, height: 300 },
          layout: {
            mode: 'VERTICAL',
            positioning: 'AUTO',
            wrap: 'NO_WRAP',
            sizingHorizontal: 'FIXED',
            sizingVertical: 'FIXED',
            primaryAxisAlignItems: 'MIN',
            counterAxisAlignItems: 'MIN',
            padding: null,
            itemSpacing: 0,
            clipsContent: false,
          },
          component: null,
        }),
        ...(mode === 'fail' ? [] : [level1]),
        level2,
      ];
  evidenceBundle.graph.relations = [];
  evidenceBundle.changes = [];
  return evidenceBundle;
}

test('P06 overlay composition classifies valid, invalid, unavailable and absent composition', () => {
  const definition = backgroundPlateUnderlayContourDefinition();
  const rule = compileContourRule(definition);

  const passSnapshot = adapt(backgroundPlateCompositionBundle('pass'), {
    contourDefinitions: [definition],
  });
  assert.equal(
    passSnapshot.nodes.find((node) => node.id === '4:2')
      .composition.underlayRelations.level1Underlay.component.properties.Position,
    'Level 1 (outer)',
  );
  assert.equal(evaluateRules({ snapshot: passSnapshot, rules: [rule] })
    .evaluations[0].classification, 'compliant');

  const fail = evaluateRules({
    snapshot: adapt(backgroundPlateCompositionBundle('fail'), {
      contourDefinitions: [definition],
    }),
    rules: [rule],
  }).evaluations[0];
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '4:2');
  assert.equal(fail.trace.predicate, 'all');
  assert.equal(fail.trace.children[0].predicate, 'exists');
  assert.equal(fail.trace.children[0].truth, 'false');

  for (const invalidMode of ['wrong-positioning', 'outside']) {
    const invalid = evaluateRules({
      snapshot: adapt(backgroundPlateCompositionBundle(invalidMode), {
        contourDefinitions: [definition],
      }),
      rules: [rule],
    }).evaluations[0];
    assert.equal(invalid.classification, 'violation');
    assert.equal(invalid.focusNodeId, '4:2');
  }

  const unknown = evaluateRules({
    snapshot: adapt(backgroundPlateCompositionBundle('unknown'), {
      contourDefinitions: [definition],
    }),
    rules: [rule],
  }).evaluations[0];
  assert.equal(unknown.classification, 'not-evaluable');

  const notApplicable = evaluateRules({ snapshot: adapt(bundle()), rules: [rule] })
    .evaluations[0];
  assert.equal(notApplicable.classification, 'not-applicable');

  const nestedBundle = backgroundPlateCompositionBundle('fail');
  nestedBundle.graph.nodes.find((node) => node.nodeId === '4:2').componentOwner = {
    nodeId: '4:owner',
    componentKey: 'title-view-key',
    name: '[D] TitleView',
    path: '[D] TitleView',
    relativePath: 'Content / [D] BackgroundPlate',
    variantProperties: { View: 'Medium' },
    componentProperties: { View: 'Medium' },
  };
  const nested = evaluateRules({
    snapshot: adapt(nestedBundle, { contourDefinitions: [definition] }),
    rules: [rule],
  }).evaluations[0];
  assert.equal(nested.classification, 'not-applicable');
});

function backgroundPlateUnderlayContourDefinition() {
  return {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'co-located-underlay',
    ruleId: 'component:web-corp.background-plate.level-2-requires-level-1',
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/BackgroundPlate/rules.json',
    sourceChecksum: 'background-plate-rules-checksum',
    sourceAnchor: 'rules/component:web-corp.background-plate.level-2-requires-level-1',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
    subject: {
      identity: 'web-corp.background-plate',
      properties: { Position: 'Level 2 (inner)' },
      publicRootOnly: true,
    },
    underlay: {
      identity: 'web-corp.background-plate',
      properties: { Position: 'Level 1 (outer)' },
      positioning: 'ABSOLUTE',
    },
    host: { layoutModes: ['HORIZONTAL', 'VERTICAL'] },
    content: { positioning: 'AUTO', afterUnderlay: true },
    geometry: { underlayContainsSubject: true },
    relationKey: 'level1Underlay',
    scope: { platform: ['desktop', 'mobile-web'] },
    unknownPolicy: 'not-evaluable',
  };
}

test('P06 accepts Level 2 nested in content above an ancestor Level 1 underlay', () => {
  const evidenceBundle = backgroundPlateCompositionBundle('pass');
  const host = evidenceBundle.graph.nodes.find((node) => node.nodeId === '4:0');
  const level2 = evidenceBundle.graph.nodes.find((node) => node.nodeId === '4:2');
  level2.layout.positioning = 'ABSOLUTE';
  host.childNodeIds = ['4:1', '4:content'];
  level2.parentNodeId = '4:content';
  level2.depth = 2;
  evidenceBundle.graph.nodes.splice(2, 0, evidenceNode({
    nodeId: '4:content',
    parentNodeId: '4:0',
    childNodeIds: ['4:2'],
    childOrder: 1,
    depth: 1,
    path: 'Fixture Auto Layout / ContentCardWrapper',
    name: '[D] ContentCardWrapper',
    bounds: { x: 24, y: 24, width: 352, height: 252 },
    layout: Object.assign({}, evidenceNode({}).layout, { mode: 'VERTICAL' }),
  }));
  const definition = backgroundPlateUnderlayContourDefinition();
  const snapshot = adapt(evidenceBundle, { contourDefinitions: [definition] });
  const level2Node = snapshot.nodes.find((node) => node.id === '4:2');
  assert.equal(level2Node.composition.underlayRelations.level1Underlay.hostNodeId, '4:0');
  assert.equal(level2Node.layout.positioning, 'ABSOLUTE');
  assert.equal(
    level2Node.composition.underlayRelations.level1Underlay.contentLayout.positioning,
    'AUTO',
  );
  const evaluation = evaluateRules({
    snapshot,
    rules: [compileContourRule(definition)],
  }).evaluations[0];
  assert.equal(evaluation.classification, 'compliant');

  evidenceBundle.graph.nodes.find((node) => node.nodeId === '4:content')
    .layout.positioning = 'ABSOLUTE';
  const invalidContentBranch = evaluateRules({
    snapshot: adapt(evidenceBundle, { contourDefinitions: [definition] }),
    rules: [compileContourRule(definition)],
  }).evaluations[0];
  assert.equal(invalidContentBranch.classification, 'violation');
});

function benefitsBundle(capacity, cardCount, cardPropertyOverrides = {}) {
  const evidenceBundle = bundle();
  const cardIds = Array.from({ length: cardCount }, (_, index) => `10:${index + 1}`);
  evidenceBundle.context.selectionNodeIds = ['10:0'];
  evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '10:0',
      childNodeIds: cardIds,
      path: '🔒 [D] Benefits',
      name: '🔒 [D] Benefits',
      type: 'INSTANCE',
      component: {
        key: 'benefits-key',
        name: '🔒 [D] Benefits',
        variantProperties: { Capacity: String(capacity) },
        componentProperties: { Capacity: String(capacity) },
        directOverrides: [],
      },
    }),
    ...cardIds.map((nodeId, index) => evidenceNode({
      nodeId,
      parentNodeId: '10:0',
      childOrder: index,
      depth: 1,
      path: `🔒 [D] Benefits / [D] BenefitCard ${index + 1}`,
      name: '[D] BenefitCard',
      type: 'INSTANCE',
      component: {
        key: 'benefit-card-key',
        name: '[D] BenefitCard',
        variantProperties: Object.assign({
          Background: 'Primary',
          CardAxis: 'Vertical',
          Compact: 'False',
          GraphicPosition: 'Top',
        }, cardPropertyOverrides[index] || {}),
        componentProperties: Object.assign({
          Background: 'Primary',
          CardAxis: 'Vertical',
          Compact: 'False',
          GraphicPosition: 'Top',
        }, cardPropertyOverrides[index] || {}),
        directOverrides: [],
      },
    })),
  ];
  evidenceBundle.graph.relations = [];
  evidenceBundle.changes = [];
  return evidenceBundle;
}

function benefitsBundleWithInheritedCardIdentity(capacity, cardCount) {
  const evidenceBundle = benefitsBundle(capacity, cardCount);
  const cardNodes = evidenceBundle.graph.nodes.filter(
    (node) => node.component?.key === 'benefit-card-key',
  );
  for (const [cardIndex, card] of cardNodes.entries()) {
    const inheritedIds = [0, 1].map((index) => `10:${cardIndex + 1}:inherited:${index}`);
    card.childNodeIds = inheritedIds;
    evidenceBundle.graph.nodes.push(...inheritedIds.map((nodeId, index) => evidenceNode({
      nodeId,
      parentNodeId: card.nodeId,
      childOrder: index,
      depth: 2,
      path: `${card.path} / inherited ${index + 1}`,
      name: `Inherited ${index + 1}`,
      type: 'FRAME',
      component: {
        key: 'benefit-card-key',
        name: '[D] BenefitCard',
        variantProperties: {},
        componentProperties: {},
        directOverrides: [],
      },
    })));
  }
  return evidenceBundle;
}

test('P10 Benefits capacity facts preserve exact focus and tri-state semantics', () => {
  const rule = benefitsCapacityContourRule();
  const passSnapshot = adapt(benefitsBundle(3, 3));
  const passOwner = passSnapshot.nodes.find((node) => node.id === '10:0');
  assert.equal(passOwner.composition.capacity, 3);
  assert.deepEqual(passOwner.composition.visibleBenefitCardNodeIds, [
    '10:1',
    '10:2',
    '10:3',
  ]);
  assert.equal(passOwner.composition.visibleBenefitCardCount, 3);
  assert.equal(
    evaluateRules({ snapshot: passSnapshot, rules: [rule] }).evaluations[0].classification,
    'compliant',
  );

  const fail = evaluateRules({
    snapshot: adapt(benefitsBundle(4, 3)),
    rules: [rule],
  }).evaluations[0];
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '10:0');
  assert.equal(fail.trace.children[1].children[1].actual, 3);
  assert.equal(fail.trace.children[1].children[1].expected, 4);

  const inheritedIdentitySnapshot = adapt(benefitsBundleWithInheritedCardIdentity(3, 3));
  const inheritedIdentityOwner = inheritedIdentitySnapshot.nodes.find((node) => node.id === '10:0');
  assert.deepEqual(inheritedIdentityOwner.composition.visibleBenefitCardNodeIds, [
    '10:1',
    '10:2',
    '10:3',
  ]);
  assert.equal(inheritedIdentityOwner.composition.visibleBenefitCardCount, 3);
  assert.equal(
    evaluateRules({ snapshot: inheritedIdentitySnapshot, rules: [rule] })
      .evaluations[0].classification,
    'compliant',
  );

  const unresolved = benefitsBundle(4, 3);
  unresolved.graph.nodes[1].component.key = 'unknown-benefit-card-key';
  const unknown = evaluateRules({ snapshot: adapt(unresolved), rules: [rule] })
    .evaluations[0];
  assert.equal(unknown.classification, 'not-evaluable');

  const notApplicable = evaluateRules({ snapshot: adapt(bundle()), rules: [rule] })
    .evaluations[0];
  assert.equal(notApplicable.classification, 'not-applicable');
});

test('P13 Benefits card settings expose ordered all-equal facts and unknown evidence', () => {
  const rule = benefitsUniformityContourRule();
  const passSnapshot = adapt(benefitsBundle(3, 3));
  const passOwner = passSnapshot.nodes.find((node) => node.id === '10:0');
  assert.deepEqual(passOwner.composition.benefitCardPropertyNodeIds, [
    '10:1',
    '10:2',
    '10:3',
  ]);
  assert.deepEqual(passOwner.composition.benefitCardPropertyValues, {
    Background: ['Primary', 'Primary', 'Primary'],
    CardAxis: ['Vertical', 'Vertical', 'Vertical'],
    Compact: ['False', 'False', 'False'],
    GraphicPosition: ['Top', 'Top', 'Top'],
  });
  const pass = evaluateRules({ snapshot: passSnapshot, rules: [rule] }).evaluations[0];
  assert.equal(pass.classification, 'compliant');
  assert.equal(pass.focusNodeId, '10:0');

  const fail = evaluateRules({
    snapshot: adapt(benefitsBundle(3, 3, {
      1: { CardAxis: 'Horizontal', Compact: 'True' },
    })),
    rules: [rule],
  }).evaluations[0];
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '10:0');
  assert.deepEqual(fail.trace.children[2].actual, [
    'Vertical',
    'Horizontal',
    'Vertical',
  ]);
  assert.deepEqual(fail.trace.children[3].actual, ['False', 'True', 'False']);

  const unresolved = benefitsBundle(3, 3);
  delete unresolved.graph.nodes[2].component.variantProperties.GraphicPosition;
  delete unresolved.graph.nodes[2].component.componentProperties.GraphicPosition;
  const unknown = evaluateRules({ snapshot: adapt(unresolved), rules: [rule] })
    .evaluations[0];
  assert.equal(unknown.classification, 'not-evaluable');

  const notApplicable = evaluateRules({ snapshot: adapt(bundle()), rules: [rule] })
    .evaluations[0];
  assert.equal(notApplicable.classification, 'not-applicable');
});

function tableViewBundle(headerCount) {
  const evidenceBundle = bundle();
  const headerIds = Array.from({ length: headerCount }, (_, index) => `11:${index + 1}`);
  const spacingIds = headerIds.flatMap((nodeId, index) => [
    `${nodeId}:spacing-top`,
    `${nodeId}:spacing-bottom`,
  ]);
  evidenceBundle.context.selectionNodeIds = ['11:0'];
  evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '11:0',
      childNodeIds: headerIds,
      path: '[D] TableView :: Horizontal',
      name: '[D] TableView :: Horizontal',
      type: 'INSTANCE',
      component: {
        key: 'table-view-horizontal-key',
        name: '[D] TableView :: Horizontal',
        variantProperties: { Compact: 'False' },
        componentProperties: { Compact: 'False' },
        directOverrides: [],
      },
    }),
    ...headerIds.map((nodeId, index) => evidenceNode({
      nodeId,
      parentNodeId: '11:0',
      childNodeIds: [`${nodeId}:spacing-top`, `${nodeId}:spacing-bottom`],
      childOrder: index,
      depth: 1,
      path: `[D] TableView :: Horizontal / Row Header ${index + 1}`,
      name: 'Row',
      type: 'INSTANCE',
      component: {
        key: 'table-view-row-key',
        name: 'Row',
        variantProperties: { Presets: 'Header', Compact: 'False', Skeleton: 'False' },
        componentProperties: { Presets: 'Header', Compact: 'False', Skeleton: 'False' },
        directOverrides: [],
      },
    })),
    ...spacingIds.map((nodeId) => evidenceNode({
      nodeId,
      parentNodeId: nodeId.split(':spacing-')[0],
      depth: 2,
      path: `[D] TableView :: Horizontal / Row / ↕ SpacingVertical`,
      name: '↕ SpacingVertical',
      type: 'INSTANCE',
      component: {
        key: 'table-view-spacing-key',
        name: '↕ SpacingVertical',
        variantProperties: { Size: '16' },
        componentProperties: { Size: '16' },
        directOverrides: [],
      },
    })),
  ];
  evidenceBundle.graph.relations = [];
  evidenceBundle.changes = [];
  return evidenceBundle;
}

test('P11 Horizontal TableView requires exactly one visible Header row', () => {
  const rule = tableViewHorizontalHeaderContourRule();
  const passSnapshot = adapt(tableViewBundle(1));
  const passOwner = passSnapshot.nodes.find((node) => node.id === '11:0');
  assert.deepEqual(passOwner.composition.visibleHeaderRowNodeIds, ['11:1']);
  assert.equal(passOwner.composition.visibleHeaderRowCount, 1);
  assert.equal(
    evaluateRules({ snapshot: passSnapshot, rules: [rule] }).evaluations[0].classification,
    'compliant',
  );

  const fail = evaluateRules({ snapshot: adapt(tableViewBundle(0)), rules: [rule] })
    .evaluations[0];
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '11:0');
  assert.equal(fail.trace.actual, 0);
  assert.deepEqual(fail.trace.expected, [1]);

  const unresolved = tableViewBundle(1);
  unresolved.graph.nodes[1].component.key = 'unknown-table-view-row-key';
  const unknown = evaluateRules({ snapshot: adapt(unresolved), rules: [rule] })
    .evaluations[0];
  assert.equal(unknown.classification, 'not-evaluable');

  const compact = tableViewBundle(1);
  compact.graph.nodes[0].component.variantProperties.Compact = 'True';
  compact.graph.nodes[0].component.componentProperties.Compact = 'True';
  assert.equal(
    evaluateRules({ snapshot: adapt(compact), rules: [rule] }).evaluations[0].classification,
    'not-applicable',
  );
});

function tableViewCompactBundle({
  ownerCompact = 'False',
  rowCompact = 'False',
  rowSpacing = 16,
} = {}) {
  const evidenceBundle = tableViewBundle(1);
  evidenceBundle.graph.nodes[0].component.variantProperties.Compact = ownerCompact;
  evidenceBundle.graph.nodes[0].component.componentProperties.Compact = ownerCompact;
  evidenceBundle.graph.nodes[1].component.variantProperties.Compact = rowCompact;
  evidenceBundle.graph.nodes[1].component.componentProperties.Compact = rowCompact;
  for (const node of evidenceBundle.graph.nodes.slice(2)) {
    const value = rowSpacing === null ? undefined : String(rowSpacing);
    node.component.variantProperties.Size = value;
    node.component.componentProperties.Size = value;
  }
  return evidenceBundle;
}

function tableViewCompactColumnBundle(columnCount = 1) {
  const evidenceBundle = tableViewCompactBundle({
    ownerCompact: 'True',
    rowCompact: 'True',
    rowSpacing: 12,
  });
  evidenceBundle.graph.nodes[1].component.variantProperties.Presets = 'Body';
  evidenceBundle.graph.nodes[1].component.componentProperties.Presets = 'Body';
  const columnIds = Array.from({ length: columnCount }, (_, index) => `11:column-${index + 1}`);
  evidenceBundle.graph.nodes[1].childNodeIds.push(...columnIds);
  evidenceBundle.graph.nodes.push(...columnIds.map((nodeId, index) => evidenceNode({
    nodeId,
    parentNodeId: '11:1',
    childOrder: index + 2,
    depth: 2,
    path: `[D] TableView :: Horizontal / Row / Cells / Column ${index + 1}`,
    name: 'Column',
    type: 'INSTANCE',
    component: {
      key: 'table-view-column-key',
      name: 'Column',
      variantProperties: { Skeleton: 'False' },
      componentProperties: { Skeleton: 'False' },
      directOverrides: [],
    },
  })));
  return evidenceBundle;
}

test('P14 compact Horizontal TableView requires exactly one data Column per Row', () => {
  const rule = tableViewHorizontalCompactOneColumnContourRule();
  const passSnapshot = adapt(tableViewCompactColumnBundle(1));
  const passRow = passSnapshot.nodes.find((node) => node.id === '11:1');
  assert.deepEqual(passRow.composition.visibleDataColumnNodeIds, ['11:column-1']);
  assert.equal(passRow.composition.visibleDataColumnCount, 1);
  assert.equal(
    evaluateRules({ snapshot: passSnapshot, rules: [rule] }).evaluations[0].classification,
    'compliant',
  );

  const fail = evaluateRules({
    snapshot: adapt(tableViewCompactColumnBundle(2)),
    rules: [rule],
  }).evaluations[0];
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '11:1');
  assert.equal(fail.trace.actual, 2);

  const unresolved = tableViewCompactColumnBundle(1);
  unresolved.graph.nodes.at(-1).component.key = 'unknown-table-view-column-key';
  assert.equal(
    evaluateRules({ snapshot: adapt(unresolved), rules: [rule] }).evaluations[0].classification,
    'not-evaluable',
  );

  const nonCompact = tableViewCompactColumnBundle(2);
  nonCompact.graph.nodes[0].component.variantProperties.Compact = 'False';
  nonCompact.graph.nodes[0].component.componentProperties.Compact = 'False';
  assert.equal(
    evaluateRules({ snapshot: adapt(nonCompact), rules: [rule] }).evaluations[0].classification,
    'not-applicable',
  );
});

test('TableView SidePanel exposes owner, row spacing and data-column facts on Row :: SidePanel', () => {
  const evidenceBundle = tableViewCompactColumnBundle(1);
  evidenceBundle.graph.nodes[0].name = '[D] TableView :: Horizontal SidePanel';
  evidenceBundle.graph.nodes[0].path = '[D] TableView :: Horizontal SidePanel';
  evidenceBundle.graph.nodes[0].component.key = 'table-view-side-panel-key';
  evidenceBundle.graph.nodes[1].name = 'Row :: SidePanel';
  evidenceBundle.graph.nodes[1].path = '[D] TableView :: Horizontal SidePanel / Row :: SidePanel';
  evidenceBundle.graph.nodes[1].component.key = 'table-view-row-side-panel-key';

  const snapshot = adapt(evidenceBundle);
  const row = snapshot.nodes.find((node) => node.id === '11:1');
  assert.equal(row.component.family, 'row-side-panel');
  assert.equal(
    row.composition.tableViewOwner.component.family,
    'table-view-horizontal-side-panel',
  );
  assert.equal(row.composition.expectedRowSpacing, 12);
  assert.equal(row.composition.spacingVertical, 12);
  assert.equal(row.composition.visibleDataColumnCount, 1);
  assert.deepEqual(row.composition.visibleDataColumnNodeIds, ['11:column-1']);
});

test('TableView spacing facts preserve mixed published spacing values without childNodeIds', () => {
  const evidenceBundle = tableViewCompactColumnBundle(1);
  const row = evidenceBundle.graph.nodes[1];
  row.childNodeIds = [];
  const spacingNodes = evidenceBundle.graph.nodes.slice(2, 4);
  spacingNodes[0].component.variantProperties.Size = '16';
  spacingNodes[0].component.componentProperties.Size = '16';
  spacingNodes[1].component.variantProperties.Size = '12';
  spacingNodes[1].component.componentProperties.Size = '12';

  const snapshot = adapt(evidenceBundle);
  const normalizedRow = snapshot.nodes.find((node) => node.id === '11:1');
  assert.deepEqual(normalizedRow.composition.spacingVerticalValues, [16, 12]);
  assert.deepEqual(normalizedRow.composition.expectedRowSpacingValues, [12]);
  assert.equal(normalizedRow.composition.spacingVertical, null);
  assert.equal(
    normalizedRow.unknownFacts.includes('composition.spacingVerticalValues'),
    false,
  );
});

test('TableView SidePanel derives compact spacing semantics without a public Compact property', () => {
  const evidenceBundle = tableViewCompactColumnBundle(1);
  evidenceBundle.graph.nodes[0].name = '[D] TableView :: Horizontal SidePanel';
  evidenceBundle.graph.nodes[0].path = '[D] TableView :: Horizontal SidePanel';
  evidenceBundle.graph.nodes[0].component.key = 'table-view-side-panel-key';
  evidenceBundle.graph.nodes[0].component.variantProperties = {};
  evidenceBundle.graph.nodes[0].component.componentProperties = {};
  evidenceBundle.graph.nodes[1].name = 'Row :: SidePanel';
  evidenceBundle.graph.nodes[1].path = '[D] TableView :: Horizontal SidePanel / Row :: SidePanel';
  evidenceBundle.graph.nodes[1].component.key = 'table-view-row-side-panel-key';
  evidenceBundle.graph.nodes[1].component.variantProperties = { Skeleton: 'False' };
  evidenceBundle.graph.nodes[1].component.componentProperties = { Skeleton: 'False' };
  evidenceBundle.graph.nodes[1].childNodeIds = [];
  evidenceBundle.graph.nodes[2].component.variantProperties.Size = '16';
  evidenceBundle.graph.nodes[2].component.componentProperties.Size = '16';
  evidenceBundle.graph.nodes[3].component.variantProperties.Size = '12';
  evidenceBundle.graph.nodes[3].component.componentProperties.Size = '12';

  const snapshot = adapt(evidenceBundle);
  const normalizedRow = snapshot.nodes.find((node) => node.id === '11:1');
  assert.equal(normalizedRow.composition.expectedRowSpacing, 12);
  assert.deepEqual(normalizedRow.composition.expectedRowSpacingValues, [12]);
  assert.deepEqual(normalizedRow.composition.spacingVerticalValues, [16, 12]);
  assert.equal(
    normalizedRow.unknownFacts.includes('component.properties.Compact'),
    false,
  );
  assert.equal(
    normalizedRow.unknownFacts.includes(
      'composition.tableViewOwner.component.properties.Compact',
    ),
    false,
  );
});

function formFirstLevelBlocksBundle(gap = 24) {
  const output = bundle();
  output.graph.nodes = [
    evidenceNode({
      nodeId: '15:0',
      childNodeIds: ['15:1', '15:2'],
      path: 'Form blocks',
      name: 'Form blocks',
      layout: {
        mode: 'VERTICAL',
        positioning: 'AUTO',
        wrap: 'NO_WRAP',
        sizingHorizontal: 'HUG',
        sizingVertical: 'HUG',
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'MIN',
        padding: null,
        itemSpacing: gap,
        clipsContent: false,
      },
      bounds: { x: 0, y: 0, width: 600, height: 200 + gap },
    }),
    evidenceNode({
      nodeId: '15:1',
      parentNodeId: '15:0',
      childOrder: 0,
      depth: 1,
      path: 'Form blocks / Block 1',
      name: '[D] BackgroundPlate',
      type: 'INSTANCE',
      bounds: { x: 0, y: 0, width: 600, height: 100 },
      component: {
        key: 'background-plate-key',
        name: '[D] BackgroundPlate',
        variantProperties: { Position: 'Level 1 (outer)' },
        componentProperties: { Position: 'Level 1 (outer)' },
        directOverrides: [],
      },
    }),
    evidenceNode({
      nodeId: '15:2',
      parentNodeId: '15:0',
      childOrder: 1,
      depth: 1,
      path: 'Form blocks / Block 2',
      name: '[D] BackgroundPlate',
      type: 'INSTANCE',
      bounds: { x: 0, y: 100 + gap, width: 600, height: 100 },
      component: {
        key: 'background-plate-key',
        name: '[D] BackgroundPlate',
        variantProperties: { Position: 'Level 1 (outer)' },
        componentProperties: { Position: 'Level 1 (outer)' },
        directOverrides: [],
      },
    }),
  ];
  output.context.selectionNodeIds = ['15:0'];
  return output;
}

test('P15 form first-level BackgroundPlate siblings have a 24 px vertical gap', () => {
  const rule = formFirstLevelBlockSpacingContourRule();
  const passSnapshot = adapt(formFirstLevelBlocksBundle(24));
  const secondBlock = passSnapshot.nodes.find((node) => node.id === '15:2');
  assert.equal(secondBlock.composition.previousFormFirstLevelBlock.nodeId, '15:1');
  assert.equal(
    evaluateRules({ snapshot: passSnapshot, rules: [rule] }).evaluations[0].classification,
    'compliant',
  );

  const fail = evaluateRules({
    snapshot: adapt(formFirstLevelBlocksBundle(12)),
    rules: [rule],
  }).evaluations[0];
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '15:2');
  assert.equal(fail.trace.expected.measured, 12);
  assert.equal(fail.trace.expected.distance, 24);

  const notForm = formFirstLevelBlocksBundle(12);
  notForm.context.pageType = null;
  const notFormSnapshot = buildPredicateSnapshotV2({
    evidenceBundle: notForm,
    auditId: 'predicate-field-packet-1',
    release: {
      knowledgeSource: 'design-system_ab',
      revision: 'release-1',
      checksum: 'release-checksum-1',
    },
    componentIndex,
  });
  assert.equal(
    evaluateRules({ snapshot: notFormSnapshot, rules: [rule] }).evaluations[0].classification,
    'not-evaluable',
  );
  notFormSnapshot.context.pageType = 'landing';
  assert.equal(evaluateRules({ snapshot: notFormSnapshot, rules: [rule] }).evaluations[0].classification, 'not-applicable');
});

function formSecondLevelActionSpacingBundle(gap = 32, actionView = 'Primary') {
  const output = bundle();
  output.graph.nodes = [
    evidenceNode({
      nodeId: '20:0',
      childNodeIds: ['20:1', '20:3'],
      path: 'Form main column',
      name: 'Form main column',
      layout: {
        mode: 'VERTICAL',
        positioning: 'AUTO',
        wrap: 'NO_WRAP',
        sizingHorizontal: 'FILL',
        sizingVertical: 'HUG',
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'MIN',
        padding: null,
        itemSpacing: gap,
        clipsContent: false,
      },
      bounds: { x: 0, y: 0, width: 600, height: 256 + gap },
    }),
    evidenceNode({
      nodeId: '20:1',
      parentNodeId: '20:0',
      childNodeIds: ['20:2'],
      childOrder: 0,
      depth: 1,
      path: 'Form main column / Content',
      name: 'Content',
      layout: {
        mode: 'VERTICAL',
        positioning: 'AUTO',
        wrap: 'NO_WRAP',
        sizingHorizontal: 'FILL',
        sizingVertical: 'HUG',
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'MIN',
        padding: null,
        itemSpacing: 24,
        clipsContent: false,
      },
      bounds: { x: 0, y: 0, width: 600, height: 200 },
    }),
    evidenceNode({
      nodeId: '20:2',
      parentNodeId: '20:1',
      childOrder: 0,
      depth: 2,
      path: 'Form main column / Content / [D] BackgroundPlateSlot',
      name: '[D] BackgroundPlateSlot',
      type: 'INSTANCE',
      component: {
        key: 'background-plate-slot-key',
        name: '[D] BackgroundPlateSlot',
        variantProperties: { Type: 'Primary' },
        componentProperties: { Type: 'Primary' },
        directOverrides: [],
      },
      bounds: { x: 0, y: 0, width: 600, height: 200 },
    }),
    evidenceNode({
      nodeId: '20:3',
      parentNodeId: '20:0',
      childNodeIds: ['20:4', '20:5'],
      childOrder: 1,
      depth: 1,
      path: 'Form main column / Actions',
      name: 'Actions',
      bounds: { x: 0, y: 200 + gap, width: 280, height: 56 },
    }),
    ...['20:4', '20:5'].map((nodeId, index) => evidenceNode({
      nodeId,
      parentNodeId: '20:3',
      childOrder: index,
      depth: 2,
      path: `Form main column / Actions / Button ${index + 1}`,
      name: '[D] Button',
      type: 'INSTANCE',
      component: {
        key: 'button-key',
        name: '[D] Button',
        variantProperties: { View: index === 0 ? actionView : 'Secondary', Size: '56' },
        componentProperties: { View: index === 0 ? actionView : 'Secondary', Size: '56' },
        directOverrides: [],
      },
      bounds: { x: index * 140, y: 200 + gap, width: 124, height: 56 },
    })),
  ];
  output.context.selectionNodeIds = ['20:0'];
  return output;
}

test('P20 form second-level boundary keeps 32 px before primary actions', () => {
  const rule = formSecondLevelActionSpacingContourRule();
  const passSnapshot = adapt(formSecondLevelActionSpacingBundle(32));
  const actionGroup = passSnapshot.nodes.find((node) => node.id === '20:3');
  assert.equal(actionGroup.composition.previousFormContent.nodeId, '20:1');
  assert.equal(actionGroup.composition.previousFormContent.hierarchyLevel, 'second-level');
  assert.equal(
    evaluateRules({ snapshot: passSnapshot, rules: [rule] }).evaluations[0].classification,
    'compliant',
  );

  const fail = evaluateRules({
    snapshot: adapt(formSecondLevelActionSpacingBundle(48)),
    rules: [rule],
  }).evaluations[0];
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '20:3');
  assert.equal(fail.trace.expected.measured, 48);
  assert.equal(fail.trace.expected.distance, 32);

  const noActions = formSecondLevelActionSpacingBundle(48);
  noActions.graph.nodes = noActions.graph.nodes.filter((node) => node.nodeId !== '20:5');
  noActions.graph.nodes.find((node) => node.nodeId === '20:3').childNodeIds = [];
  assert.equal(
    evaluateRules({ snapshot: adapt(noActions), rules: [rule] }).evaluations[0].classification,
    'not-applicable',
  );
});

test('P20 treats an Accent M56 button group as primary form actions', () => {
  const rule = formSecondLevelActionSpacingContourRule();
  const evaluation = evaluateRules({
    snapshot: adapt(formSecondLevelActionSpacingBundle(48, 'Accent')),
    rules: [rule],
  }).evaluations[0];
  assert.equal(evaluation.classification, 'violation');
  assert.equal(evaluation.focusNodeId, '20:3');
  assert.equal(evaluation.trace.expected.measured, 48);
});

function formMediumTitlesBundle(count = 1) {
  const output = bundle();
  const titleIds = Array.from({ length: count }, (_, index) => `16:${index + 1}`);
  output.graph.nodes = [
    evidenceNode({
      nodeId: '16:0',
      childNodeIds: titleIds,
      path: '[D] BackgroundPlateSlot',
      name: '[D] BackgroundPlateSlot',
      type: 'INSTANCE',
      component: {
        key: 'background-plate-slot-key',
        name: '[D] BackgroundPlateSlot',
        variantProperties: { Type: 'Primary' },
        componentProperties: { Type: 'Primary' },
        directOverrides: [],
      },
    }),
    ...titleIds.map((nodeId, index) => evidenceNode({
      nodeId,
      parentNodeId: '16:0',
      childOrder: index,
      depth: 1,
      path: `[D] BackgroundPlateSlot / TitleView ${index + 1}`,
      name: '[D] TitleView',
      type: 'INSTANCE',
      component: {
        key: 'title-view-key',
        name: '[D] TitleView',
        variantProperties: { View: 'Medium' },
        componentProperties: { View: 'Medium' },
        directOverrides: [],
      },
    })),
  ];
  output.context.selectionNodeIds = ['16:0'];
  return output;
}

test('P16 allows only the first TitleView Medium on a form plate', () => {
  const rule = formMediumTitleOnePerPlateContourRule();
  const passSnapshot = adapt(formMediumTitlesBundle(1));
  const passTitle = passSnapshot.nodes.find((node) => node.id === '16:1');
  assert.equal(
    passTitle.composition.formFirstLevelSurface.mediumTitlePosition,
    'single',
  );
  assert.equal(
    evaluateRules({ snapshot: passSnapshot, rules: [rule] }).evaluations[0].classification,
    'compliant',
  );

  const fail = evaluateRules({
    snapshot: adapt(formMediumTitlesBundle(2)),
    rules: [rule],
  });
  const violation = fail.evaluations.find((item) => item.classification === 'violation');
  assert.equal(violation.focusNodeId, '16:2');
  assert.equal(violation.trace.actual, 'last');
  assert.deepEqual(violation.trace.expected, ['single', 'first']);

  const unknownBundle = formMediumTitlesBundle(2);
  unknownBundle.graph.nodes[2].component.key = 'unknown-title-view-key';
  const unknown = evaluateRules({ snapshot: adapt(unknownBundle), rules: [rule] });
  assert.ok(unknown.evaluations.some((item) => item.classification === 'not-evaluable'));

  const notForm = formMediumTitlesBundle(2);
  notForm.context.pageType = null;
  const notFormSnapshot = buildPredicateSnapshotV2({
    evidenceBundle: notForm,
    auditId: 'predicate-field-packet-1',
    release: {
      knowledgeSource: 'design-system_ab',
      revision: 'release-1',
      checksum: 'release-checksum-1',
    },
    componentIndex,
  });
  assert.equal(
    evaluateRules({ snapshot: notFormSnapshot, rules: [rule] }).evaluations[0].classification,
    'not-evaluable',
  );
  notFormSnapshot.context.pageType = 'landing';
  assert.equal(evaluateRules({ snapshot: notFormSnapshot, rules: [rule] }).evaluations[0].classification, 'not-applicable');
});

function formTitleContentGapBundle(gap = 24) {
  const output = bundle();
  output.graph.nodes = [
    evidenceNode({
      nodeId: '17:0',
      childNodeIds: ['17:1'],
      path: '[D] BackgroundPlateSlot',
      name: '[D] BackgroundPlateSlot',
      type: 'INSTANCE',
      bounds: { x: 0, y: 0, width: 600, height: 180 + gap },
      component: {
        key: 'background-plate-slot-key',
        name: '[D] BackgroundPlateSlot',
        variantProperties: { Type: 'Primary' },
        componentProperties: { Type: 'Primary' },
        directOverrides: [],
      },
    }),
    evidenceNode({
      nodeId: '17:1',
      parentNodeId: '17:0',
      childNodeIds: ['17:2', '17:3'],
      childOrder: 0,
      depth: 1,
      path: '[D] BackgroundPlateSlot / Content',
      name: 'Content',
      bounds: { x: 32, y: 32, width: 536, height: 116 + gap },
    }),
    evidenceNode({
      nodeId: '17:2',
      parentNodeId: '17:1',
      childOrder: 0,
      depth: 2,
      path: '[D] BackgroundPlateSlot / Content / [D] TitleView',
      name: '[D] TitleView',
      type: 'INSTANCE',
      bounds: { x: 32, y: 32, width: 536, height: 52 },
      component: {
        key: 'title-view-key',
        name: '[D] TitleView',
        variantProperties: { View: 'Medium' },
        componentProperties: { View: 'Medium' },
        directOverrides: [],
      },
    }),
    evidenceNode({
      nodeId: '17:3',
      parentNodeId: '17:1',
      childOrder: 1,
      depth: 2,
      path: '[D] BackgroundPlateSlot / Content / Fields',
      name: 'Fields',
      bounds: { x: 32, y: 84 + gap, width: 536, height: 64 },
    }),
  ];
  output.context.selectionNodeIds = ['17:0'];
  return output;
}

test('P17 measures the exact gap from TitleView Medium to first form content', () => {
  const rule = formTitleContentGapContourRule();
  const passSnapshot = adapt(formTitleContentGapBundle(24));
  const content = passSnapshot.nodes.find((node) => node.id === '17:3');
  assert.equal(content.composition.previousFormMediumTitle.nodeId, '17:2');
  assert.equal(content.composition.previousFormMediumTitle.surfaceNodeId, '17:0');
  assert.equal(
    evaluateRules({ snapshot: passSnapshot, rules: [rule] }).evaluations[0].classification,
    'compliant',
  );

  const fail = evaluateRules({
    snapshot: adapt(formTitleContentGapBundle(40)),
    rules: [rule],
  }).evaluations[0];
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '17:3');
  assert.equal(fail.trace.expected.measured, 40);
  assert.equal(fail.trace.expected.distance, 24);

  const unknownBundle = formTitleContentGapBundle(24);
  unknownBundle.graph.nodes[3].bounds = null;
  assert.equal(
    evaluateRules({ snapshot: adapt(unknownBundle), rules: [rule] }).evaluations[0].classification,
    'not-evaluable',
  );

  const notForm = formTitleContentGapBundle(40);
  notForm.context.pageType = null;
  const notFormSnapshot = buildPredicateSnapshotV2({
    evidenceBundle: notForm,
    auditId: 'predicate-field-packet-1',
    release: {
      knowledgeSource: 'design-system_ab',
      revision: 'release-1',
      checksum: 'release-checksum-1',
    },
    componentIndex,
  });
  assert.equal(
    evaluateRules({ snapshot: notFormSnapshot, rules: [rule] }).evaluations[0].classification,
    'not-evaluable',
  );
  notFormSnapshot.context.pageType = 'landing';
  assert.equal(evaluateRules({ snapshot: notFormSnapshot, rules: [rule] }).evaluations[0].classification, 'not-applicable');
});

test('P18 evaluates all standard content insets against the first-level form surface', () => {
  const rule = formStandardContentInsetsContourRule();
  const passSnapshot = adapt(formTitleContentGapBundle(24));
  const surface = passSnapshot.nodes.find((node) => node.id === '17:0');
  assert.deepEqual(
    surface.composition.formFirstLevelSurface.contentInsets,
    { top: 32, right: 32, bottom: 32, left: 32 },
  );
  assert.equal(
    evaluateRules({ snapshot: passSnapshot, rules: [rule] }).evaluations[0].classification,
    'compliant',
  );

  const failBundle = formTitleContentGapBundle(24);
  failBundle.graph.nodes[1].bounds.width = 520;
  const fail = evaluateRules({
    snapshot: adapt(failBundle),
    rules: [rule],
  }).evaluations[0];
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '17:0');
  assert.equal(fail.trace.children[1].actual, 48);
  assert.equal(fail.trace.children[1].expected.value, 32);
  assert.equal(fail.trace.children[1].expected.tolerance, 0);
  assert.equal(fail.trace.children[1].expected.difference, 16);

  const unknownBundle = formTitleContentGapBundle(24);
  unknownBundle.graph.nodes[1].bounds = null;
  assert.equal(
    evaluateRules({ snapshot: adapt(unknownBundle), rules: [rule] }).evaluations[0].classification,
    'not-evaluable',
  );

  const notForm = formTitleContentGapBundle(24);
  notForm.context.pageType = null;
  const notFormSnapshot = buildPredicateSnapshotV2({
    evidenceBundle: notForm,
    auditId: 'predicate-field-packet-1',
    release: {
      knowledgeSource: 'design-system_ab',
      revision: 'release-1',
      checksum: 'release-checksum-1',
    },
    componentIndex,
  });
  assert.equal(
    evaluateRules({ snapshot: notFormSnapshot, rules: [rule] }).evaluations[0].classification,
    'not-evaluable',
  );
  notFormSnapshot.context.pageType = 'landing';
  assert.equal(evaluateRules({ snapshot: notFormSnapshot, rules: [rule] }).evaluations[0].classification, 'not-applicable');
});

function formEightFourLayoutBundle(gap = 24, overrides = {}) {
  const output = bundle();
  const bodyBounds = overrides.bodyBounds === undefined
    ? { x: 0, y: 0, width: 1092, height: 320 }
    : overrides.bodyBounds;
  const mainBounds = overrides.mainBounds === undefined
    ? { x: 0, y: 0, width: 720, height: 320 }
    : overrides.mainBounds;
  const islandBounds = overrides.islandBounds === undefined
    ? { x: 720 + gap, y: 0, width: 348, height: 320 }
    : overrides.islandBounds;
  output.graph.nodes = [
    evidenceNode({
      nodeId: '19:0',
      childNodeIds: ['19:1'],
      path: 'P19 fixture',
      name: 'P19 fixture',
      layout: Object.assign({}, evidenceNode({}).layout, { mode: 'VERTICAL' }),
      bounds: { x: 0, y: 0, width: 1092, height: 320 },
    }),
    evidenceNode({
      nodeId: '19:1',
      parentNodeId: '19:0',
      childNodeIds: ['19:2', '19:3'],
      childOrder: 0,
      depth: 1,
      path: 'P19 fixture / Body',
      name: 'Body',
      bounds: bodyBounds,
      layout: Object.assign({}, evidenceNode({}).layout, {
        mode: 'HORIZONTAL',
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        itemSpacing: gap,
      }),
    }),
    evidenceNode({
      nodeId: '19:2',
      parentNodeId: '19:1',
      childNodeIds: ['19:4'],
      childOrder: 0,
      depth: 2,
      path: 'P19 fixture / Body / Main',
      name: 'Main',
      bounds: mainBounds,
      layout: Object.assign({}, evidenceNode({}).layout, { mode: 'VERTICAL' }),
    }),
    evidenceNode({
      nodeId: '19:3',
      parentNodeId: '19:1',
      childOrder: 1,
      depth: 2,
      path: 'P19 fixture / Body / IsleBlock',
      name: '[D] IsleBlock',
      type: 'INSTANCE',
      bounds: islandBounds,
      component: {
        key: 'isle-block-key',
        name: '[D] IsleBlock',
        variantProperties: {},
        componentProperties: {},
        directOverrides: [],
      },
    }),
    evidenceNode({
      nodeId: '19:4',
      parentNodeId: '19:2',
      childOrder: 0,
      depth: 3,
      path: 'P19 fixture / Body / Main / [D] BackgroundPlateSlot',
      name: '[D] BackgroundPlateSlot',
      type: 'INSTANCE',
      bounds: mainBounds,
      component: {
        key: 'background-plate-slot-key',
        name: '[D] BackgroundPlateSlot',
        variantProperties: { Type: 'Primary' },
        componentProperties: { Type: 'Primary' },
        directOverrides: [],
      },
    }),
  ];
  output.context.selectionNodeIds = ['19:0'];
  return output;
}

test('P19 evaluates the desktop form 8+4 grid and focuses its horizontal owner', () => {
  const rule = formEightFourLayoutReleaseRule();
  const passSnapshot = adapt(formEightFourLayoutBundle(24));
  const body = passSnapshot.nodes.find((node) => node.id === '19:1');
  assert.deepEqual(body.composition.formEightFourLayout, {
    nodeId: '19:1',
    mainZoneNodeId: '19:2',
    islandZoneNodeId: '19:3',
    contentWidth: 1092,
    gutter: 24,
    expectedGutter: 24,
    mainWidth: 720,
    expectedMainWidth: 720,
    islandWidth: 348,
    expectedIslandWidth: 348,
  });
  const pass = evaluateRules({ snapshot: passSnapshot, rules: [rule] }).evaluations[0];
  assert.equal(pass.classification, 'compliant');
  assert.equal(pass.focusNodeId, '19:1');

  const fail = evaluateRules({
    snapshot: adapt(formEightFourLayoutBundle(12)),
    rules: [rule],
  }).evaluations[0];
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '19:1');
  const gapTrace = fail.trace.children.find((child) => (
    child.factPaths.length === 1 &&
    child.factPaths[0] === 'composition.formEightFourLayout.gutter'
  ));
  assert.equal(gapTrace.actual, 12);
  assert.equal(gapTrace.expected.value, 24);

  const wrongProportions = evaluateRules({
    snapshot: adapt(formEightFourLayoutBundle(24, {
      mainBounds: { x: 0, y: 0, width: 760, height: 320 },
      islandBounds: { x: 784, y: 0, width: 308, height: 320 },
    })),
    rules: [rule],
  }).evaluations[0];
  assert.equal(wrongProportions.classification, 'violation');
  const mainWidthTrace = wrongProportions.trace.children.find((child) => (
    child.truth === 'false' &&
    child.factPaths.includes('composition.formEightFourLayout.mainWidth') &&
    child.factPaths.includes('composition.formEightFourLayout.islandWidth')
  ));
  assert.equal(mainWidthTrace.actual, 640);
  assert.equal(mainWidthTrace.expected.value, 760);

  const unknown = evaluateRules({
    snapshot: adapt(formEightFourLayoutBundle(24, { islandBounds: null })),
    rules: [rule],
  }).evaluations[0];
  assert.equal(unknown.classification, 'not-evaluable');

  const notForm = formEightFourLayoutBundle(12);
  notForm.context.pageType = null;
  const notFormSnapshot = buildPredicateSnapshotV2({
    evidenceBundle: notForm,
    auditId: 'predicate-field-packet-1',
    release: {
      knowledgeSource: 'design-system_ab',
      revision: 'release-1',
      checksum: 'release-checksum-1',
    },
    componentIndex,
  });
  assert.equal(
    evaluateRules({ snapshot: notFormSnapshot, rules: [rule] }).evaluations[0].classification,
    'not-evaluable',
  );
  notFormSnapshot.context.pageType = 'landing';
  assert.equal(evaluateRules({ snapshot: notFormSnapshot, rules: [rule] }).evaluations[0].classification, 'not-applicable');
});

function realFormOwnerUnderlayBundle(actionView = 'Primary') {
  const output = bundle();
  const verticalLayout = Object.assign({}, evidenceNode({}).layout, {
    mode: 'VERTICAL',
    counterAxisAlignItems: 'MIN',
  });
  const absoluteLayout = Object.assign({}, evidenceNode({}).layout, {
    mode: 'VERTICAL',
    positioning: 'ABSOLUTE',
  });
  const spacer = (nodeId, parentNodeId, y, height, childOrder) => evidenceNode({
    nodeId,
    parentNodeId,
    childOrder,
    depth: parentNodeId === '21:2' ? 3 : 4,
    path: `Real form / Spacer ${nodeId}`,
    name: '↕ Spacer',
    bounds: { x: 0, y, width: 1, height },
    layout: verticalLayout,
  });
  const underlay = (nodeId, parentNodeId, y, height) => evidenceNode({
    nodeId,
    parentNodeId,
    childOrder: 0,
    depth: 4,
    path: `Real form / ${parentNodeId} / [D] BackgroundPlate`,
    name: '[D] BackgroundPlate',
    type: 'INSTANCE',
    bounds: { x: 0, y, width: 868, height },
    layout: absoluteLayout,
    component: {
      key: 'background-plate-key',
      name: '[D] BackgroundPlate',
      variantProperties: { Position: 'Level 1 (outer)' },
      componentProperties: { Position: 'Level 1 (outer)' },
      directOverrides: [],
    },
  });
  const title = (nodeId, parentNodeId, y) => evidenceNode({
    nodeId,
    parentNodeId,
    childOrder: 1,
    depth: 4,
    path: `Real form / ${parentNodeId} / [D] TitleView`,
    name: '[D] TitleView',
    type: 'INSTANCE',
    bounds: { x: 32, y, width: 804, height: 24 },
    component: {
      key: 'title-view-key',
      name: '[D] TitleView',
      variantProperties: { View: 'Medium' },
      componentProperties: { View: 'Medium' },
      directOverrides: [],
    },
  });
  const field = (nodeId, parentNodeId, y, height) => evidenceNode({
    nodeId,
    parentNodeId,
    childOrder: 3,
    depth: 4,
    path: `Real form / ${parentNodeId} / Fields`,
    name: 'Fields',
    bounds: { x: 32, y, width: 804, height },
    layout: verticalLayout,
  });

  output.graph.nodes = [
    evidenceNode({
      nodeId: '21:0',
      childNodeIds: ['21:1'],
      path: 'Real form',
      name: 'Real form',
      bounds: { x: 0, y: 0, width: 1252, height: 468 },
      layout: verticalLayout,
    }),
    evidenceNode({
      nodeId: '21:1',
      parentNodeId: '21:0',
      childNodeIds: ['21:2', '21:15'],
      depth: 1,
      path: 'Real form / Body',
      name: 'Body',
      bounds: { x: 0, y: 0, width: 1252, height: 468 },
      layout: Object.assign({}, evidenceNode({}).layout, {
        mode: 'HORIZONTAL',
        itemSpacing: 24,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    }),
    evidenceNode({
      nodeId: '21:2',
      parentNodeId: '21:1',
      childNodeIds: ['21:3', '21:8', '21:9', '21:14'],
      depth: 2,
      path: 'Real form / Body / Main',
      name: 'Main',
      bounds: { x: 0, y: 0, width: 868, height: 468 },
      layout: verticalLayout,
    }),
    evidenceNode({
      nodeId: '21:3',
      parentNodeId: '21:2',
      childNodeIds: ['21:4', '21:5', '21:6', '21:7'],
      childOrder: 0,
      depth: 3,
      path: 'Real form / Body / Main / Surface 1',
      name: 'Surface 1',
      bounds: { x: 0, y: 0, width: 868, height: 180 },
      layout: verticalLayout,
    }),
    underlay('21:4', '21:3', 0, 180),
    title('21:5', '21:3', 32),
    spacer('21:6', '21:3', 56, 20, 2),
    field('21:7', '21:3', 76, 72),
    spacer('21:8', '21:2', 180, 24, 1),
    evidenceNode({
      nodeId: '21:9',
      parentNodeId: '21:2',
      childNodeIds: ['21:10', '21:11', '21:12', '21:13'],
      childOrder: 2,
      depth: 3,
      path: 'Real form / Body / Main / Surface 2',
      name: 'Surface 2',
      bounds: { x: 0, y: 204, width: 868, height: 184 },
      layout: verticalLayout,
    }),
    underlay('21:10', '21:9', 204, 184),
    title('21:11', '21:9', 236),
    spacer('21:12', '21:9', 260, 24, 2),
    field('21:13', '21:9', 284, 72),
    spacer('21:14', '21:2', 388, 24, 3),
    evidenceNode({
      nodeId: '21:15',
      parentNodeId: '21:1',
      childOrder: 1,
      depth: 2,
      path: 'Real form / Body / IsleBlock',
      name: '[D] IsleBlock',
      type: 'INSTANCE',
      bounds: { x: 892, y: 0, width: 360, height: 468 },
      component: {
        key: 'isle-block-key',
        name: '[D] IsleBlock',
        variantProperties: {},
        componentProperties: {},
        directOverrides: [],
      },
    }),
    evidenceNode({
      nodeId: '21:16',
      parentNodeId: '21:2',
      childOrder: 4,
      depth: 3,
      path: 'Real form / Body / Main / Primary action',
      name: '[D] Button',
      type: 'INSTANCE',
      bounds: { x: 0, y: 412, width: 160, height: 56 },
      component: {
        key: 'button-key',
        name: '[D] Button',
        variantProperties: { View: actionView, Size: '56' },
        componentProperties: { View: actionView, Size: '56' },
        directOverrides: [],
      },
    }),
  ];
  output.graph.nodes.find((node) => node.nodeId === '21:2').childNodeIds.push('21:16');
  output.context.selectionNodeIds = ['21:0'];
  return output;
}

test('Semantic Form Surface v2 evaluates absolute underlays, spacers and a standalone action', () => {
  const snapshot = adapt(realFormOwnerUnderlayBundle());
  const rules = [
    formFirstLevelBlockSpacingContourRule(),
    formSecondLevelActionSpacingContourRule(),
    formMediumTitleOnePerPlateContourRule(),
    formTitleContentGapContourRule(),
    formStandardContentInsetsContourRule(),
    formEightFourLayoutReleaseRule(),
  ];
  const result = evaluateRules({ snapshot, rules });

  const surface1 = snapshot.nodes.find((node) => node.id === '21:3');
  const surface2 = snapshot.nodes.find((node) => node.id === '21:9');
  const field1 = snapshot.nodes.find((node) => node.id === '21:7');
  const action = snapshot.nodes.find((node) => node.id === '21:16');
  assert.equal(surface1.composition.formFirstLevelSurface.model, 'owner-underlay');
  assert.equal(surface1.composition.formFirstLevelSurface.underlayNodeId, '21:4');
  assert.equal(surface2.composition.previousFormFirstLevelBlock.nodeId, '21:3');
  assert.deepEqual(
    surface1.composition.formFirstLevelSurface.contentInsets,
    { top: 32, right: 32, bottom: 32, left: 32 },
  );
  assert.equal(field1.composition.previousFormMediumTitle.nodeId, '21:5');
  assert.equal(action.composition.previousFormContent.nodeId, '21:9');

  const classifications = result.evaluations.reduce((accumulator, evaluation) => {
    if (!accumulator[evaluation.ruleId]) accumulator[evaluation.ruleId] = [];
    accumulator[evaluation.ruleId].push(evaluation.classification);
    return accumulator;
  }, {});
  assert.deepEqual(
    classifications['rule:forms.construction-rules.block-spacing.first-level'],
    ['compliant'],
  );
  assert.deepEqual(
    classifications['rule:forms.construction-rules.block-spacing.second-level-actions'],
    ['violation'],
  );
  assert.deepEqual(
    classifications['rule:forms.construction-rules.title-medium-one-per-plate'],
    ['compliant', 'compliant'],
  );
  assert.deepEqual(
    classifications['rule:forms.construction-rules.inner-padding-standard.title-to-content'].sort(),
    ['compliant', 'violation'],
  );
  assert.deepEqual(
    classifications['rule:forms.construction-rules.inner-padding-standard.content-insets'],
    ['compliant', 'compliant'],
  );
  assert.deepEqual(
    classifications['rule:forms.construction-rules.layout-8-4'],
    ['violation'],
  );
});

test('Semantic Form Surface v2 recognizes a standalone Accent M56 action', () => {
  const snapshot = adapt(realFormOwnerUnderlayBundle('Accent'));
  const action = snapshot.nodes.find((node) => node.id === '21:16');
  assert.equal(action.composition.previousFormContent.nodeId, '21:9');

  const evaluation = evaluateRules({
    snapshot,
    rules: [formSecondLevelActionSpacingContourRule()],
  }).evaluations[0];
  assert.equal(evaluation.classification, 'violation');
  assert.equal(evaluation.focusNodeId, '21:16');
});
