const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  evaluatePredicatePilotRequest,
} = require('../src/predicate-engine/pilot-service');

const designSystemRoot = path.resolve(__dirname, '../../../shared/design-system_ab');
const BUTTONS_GROUP_KEY = 'f05915599f71e822fd8b46a2b2509a2e395005cf';
const BUTTON_KEY = '0012e7a5e420b87136b910b29578a4d06e6dd30c';
const TITLE_VIEW_KEY = '3bfd179dc3b4c996f58db4cbcd26687a356fb3b7';
const BACKGROUND_PLATE_KEY = '01b744c9f1d5183cd25aa5ac48759857487931b7';
const STATUS_PRESET_KEY = '26b847ef2dadd62ff9728ab50c728f6c7dcef455';
const TITLE_STATUS_KEY = '5ab19e9a08ebee710f399db7e0dc2160b1dd124c';
const BENEFITS_KEY = '0b1fd301e14ae7dab9eb62de83c8f4b8d9eab376';
const BENEFIT_CARD_KEY = '0fb58a88030651af939c278b544143643cdd1223';
const TABLE_VIEW_HORIZONTAL_KEY = '6e9a72189d150779165acb1dde3a800b92daa2f9';
const TABLE_VIEW_HEADER_ROW_KEY = 'af607289bf050cc8236b882039cf787d32296383';
const TABLE_VIEW_COLUMN_KEY = 'af59b50bbe31bfad10b6f9fe6decb9798b465771';
const BACKGROUND_PLATE_SLOT_KEY = '6d5d4dda10be00621991e9b5a0152db4e47f4e2f';
const ISLE_BLOCK_KEY = '9dd86bd040376734e605227c0d849d1328e62d76';
const ACCOUNT_SELECT_PUBLIC_ROOT_KEY = '1043a9208a949b1af3f708637de5fd13721a4519';
const ACCOUNT_SELECT_INTERNAL_ITEM_KEY = '1e8647f2b51a623083755fdad5c677fc38770e3e';
const PROPERTY_PRESET_KEY = '55c7b3a923bfb246c0f8ce6f85558f78ec702a53';
const CORE_STATUS_RECTANGULAR_KEY = 'a410d666446afa4beb01cd6c35e9e6642e9b28be';
const CORE_STATUS_ROUNDED_KEY = 'a54fc8de49f424f46ddb87e1f14103cda8a5456e';

function component(key, name, properties) {
  return {
    key,
    name,
    variantProperties: properties,
    componentProperties: properties,
    directOverrides: [],
  };
}

function evidenceNode(overrides) {
  return Object.assign({
    nodeId: '1:0',
    parentNodeId: null,
    childNodeIds: [],
    childOrder: 0,
    depth: 0,
    path: 'ButtonsGroup',
    type: 'INSTANCE',
    name: 'ButtonsGroup',
    visible: true,
    bounds: { x: 0, y: 0, width: 400, height: 56 },
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
    variableBindings: [],
  }, overrides);
}

function request(secondProperties) {
  const owner = {
    nodeId: '1:0',
    componentKey: BUTTONS_GROUP_KEY,
    name: '[D] ButtonsGroup',
    path: '[D] ButtonsGroup',
    relativePath: '',
    variantProperties: { Size: '56' },
    componentProperties: { Size: '56', Overflow: 'false' },
  };
  return {
    ruleSet: 'buttons-group-pilot',
    evidenceBundle: {
      schemaVersion: 2,
      documentType: 'apollo-audit-evidence-bundle',
      reportId: 'report-1:evidence',
      sourceReportId: 'report-1',
      generatedAt: '2026-08-22T12:00:00.000Z',
      context: {
        fileKey: 'figma-file-key',
        pageId: '0:1',
        platform: 'desktop',
        channel: 'Desktop',
        pageType: 'form',
        viewportWidth: 400,
        selectionNodeIds: ['1:0'],
      },
      graph: {
        nodes: [
          evidenceNode({
            childNodeIds: ['1:1', '1:2'],
            component: component(BUTTONS_GROUP_KEY, '[D] ButtonsGroup', {
              Size: '56',
              Overflow: 'false',
            }),
          }),
          evidenceNode({
            nodeId: '1:1',
            parentNodeId: '1:0',
            childOrder: 0,
            path: 'ButtonsGroup/Button 1',
            name: '[D] Button',
            component: component(BUTTON_KEY, '[D] Button', {
              View: 'Primary',
              Size: '56',
              SingleIcon: 'False',
            }),
            componentOwner: owner,
          }),
          evidenceNode({
            nodeId: '1:2',
            parentNodeId: '1:0',
            childOrder: 1,
            path: 'ButtonsGroup/Button 2',
            name: '[D] Button',
            component: component(BUTTON_KEY, '[D] Button', secondProperties),
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
    },
  };
}

test('isolated predicate endpoint service evaluates P01/P02/P03 without an agent', () => {
  const output = evaluatePredicatePilotRequest(
    request({ View: 'Accent', Size: '40' }),
    { designSystemRoot },
  );
  assert.equal(output.snapshot.context.pageId, '0:1');
  assert.equal(output.snapshot.release.knowledgeSource, 'design-system_ab');
  assert.deepEqual(output.repeatability, {
    runCount: 10,
    stable: true,
    resultHash: output.repeatability.resultHash,
  });
  assert.match(output.repeatability.resultHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    output.rules.map((rule) => rule.ruleId),
    [
      'component:web-corp.buttons-group.button-count',
      'component:web-corp.buttons-group.allowed-views',
      'component:web-corp.buttons-group.uniform-size',
      'component:web-corp.buttons-group.single-icon-position',
      'component:web-corp.title-view.title-and-subtitle-typography-is-fixed',
      'component:web-corp.title-view.status-and-title-status-color-match',
      'rule:controls.buttons-and-button-groups.desktop-safe-variants',
      'component:web-corp.title-view.visible-slots-follow-required-order',
      'component:web-corp.background-plate.padding-uses-spacing-tokens.top',
      'component:web-corp.background-plate.padding-uses-spacing-tokens.right',
      'component:web-corp.background-plate.padding-uses-spacing-tokens.bottom',
      'component:web-corp.background-plate.padding-uses-spacing-tokens.left',
      'component:web-corp.background-plate.level-2-requires-level-1',
      'component:web.benefits.capacity-matches-card-count',
      'component:web.benefits.nested-card-settings-are-uniform',
      'component:web-corp.table-view.horizontal-multi-column-header-required',
      'component:web-corp.table-view.compact-is-consistent-across-rows',
      'component:web-corp.table-view.horizontal-compact-one-column',
      'rule:forms.construction-rules.block-spacing.first-level',
      'rule:forms.construction-rules.block-spacing.second-level-actions',
      'rule:forms.construction-rules.title-medium-one-per-plate',
      'rule:forms.construction-rules.inner-padding-standard.title-to-content',
      'rule:forms.construction-rules.inner-padding-standard.content-insets',
      'rule:forms.construction-rules.layout-8-4.geometry',
    ],
  );
  assert.equal(
    output.rules[0].source.path,
    'design-system_ab/JSONS/web/components/web-corp/ButtonGroup [D]/composition-contract.json',
  );
  assert.equal(output.rules[0].source.checksum.length, 64);
  assert.equal(output.rules[0].scope.pageType, undefined);
  assert.deepEqual(
    output.rules.find(
      (rule) => rule.ruleId === 'rule:forms.construction-rules.layout-8-4.geometry',
    ).scope,
    { platform: ['desktop'], pageType: ['form'] },
  );
  assert.equal(output.result.coverage.byClassification.violation, 2);
  const violations = output.result.evaluations.filter(
    (item) => item.classification === 'violation',
  );
  assert.deepEqual(new Set(violations.map((item) => item.focusNodeId)), new Set(['1:2']));
  assert.equal(output.result.coverage.unclassified, 0);
  assert.equal(output.result.coverage.duplicateEvaluationIds, 0);
});

function accountSelectPublicRootRequest(componentKey, platform = 'desktop') {
  return {
    ruleSet: 'buttons-group-pilot',
    evidenceBundle: {
      schemaVersion: 2,
      documentType: 'apollo-audit-evidence-bundle',
      reportId: 'account-select-public-root:evidence',
      sourceReportId: 'account-select-public-root',
      generatedAt: '2026-08-25T12:00:00.000Z',
      context: {
        fileKey: 'figma-file-key',
        pageId: '0:1',
        platform,
        channel: platform === 'desktop' ? 'Desktop' : platform,
        pageType: null,
        viewportWidth: platform === 'desktop' ? 1440 : 390,
        selectionNodeIds: ['21:0'],
      },
      graph: {
        nodes: [evidenceNode({
          nodeId: '21:0',
          path: 'P21 / AccountSelect',
          name: componentKey === ACCOUNT_SELECT_PUBLIC_ROOT_KEY
            ? '[D] AccountOptionListContent'
            : 'AccountItem',
          component: component(componentKey, 'AccountSelect fixture', {}),
        })],
        relations: [],
      },
      baselines: [],
      changes: [],
      ruleCandidates: [],
      coverage: {
        visibleNodeCount: 1,
        excludedHiddenNodeCount: 0,
        excludedDecorativeNodeCount: 0,
        componentNodeCount: 1,
        textNodeCount: 0,
        baselineChangeCount: 0,
        limitations: [],
      },
    },
  };
}

test('P21 compiles AccountSelect public-root authority from requested rules.json', () => {
  const pass = evaluatePredicatePilotRequest(
    accountSelectPublicRootRequest(ACCOUNT_SELECT_PUBLIC_ROOT_KEY),
    { designSystemRoot },
  );
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.account-select.public-roots-only'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '21:0');
  assert.equal(
    pass.rules.find((rule) => (
      rule.ruleId === 'component:web-corp.account-select.public-roots-only'
    )).source.path,
    'design-system_ab/JSONS/web/components/web-corp/AccountSelect/rules.json',
  );

  const fail = evaluatePredicatePilotRequest(
    accountSelectPublicRootRequest(ACCOUNT_SELECT_INTERNAL_ITEM_KEY),
    { designSystemRoot },
  );
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.account-select.public-roots-only'
  ));
  const violationRule = fail.rules.find((item) => (
    item.ruleId === 'component:web-corp.account-select.public-roots-only'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '21:0');
  assert.equal(violation.trace.actual, 'account-item');
  assert.deepEqual(
    violation.trace.expected,
    ['account-option-list-content'],
  );
  assert.deepEqual(violationRule.presentation, {
    schemaVersion: 'apollo.predicate-presentation.v1',
    title: 'Служебный компонент AccountSelect используется отдельно',
    observed: '{{actual}} размещён как самостоятельный компонент.',
    expectation: 'Самостоятельно допускается использовать только {{expected}}.',
    action: 'Заменить {{actual}} на {{expected}}.',
    valueLabels: {
      'account-item': 'AccountItem',
      'account-option-list-content': 'AccountOptionListContent',
    },
    targetFact: 'ownership.contour.root.component.family',
  });

  const notApplicable = evaluatePredicatePilotRequest(
    accountSelectPublicRootRequest(ACCOUNT_SELECT_INTERNAL_ITEM_KEY, 'ios'),
    { designSystemRoot },
  );
  assert.equal(
    notApplicable.result.evaluations.find((item) => (
      item.ruleId === 'component:web-corp.account-select.public-roots-only'
    )).classification,
    'not-applicable',
  );
});

function statusShapeRequest({
  presetKey = STATUS_PRESET_KEY,
  presetName = '[D] StatusPreset',
  shape = 'Rounded',
  statusKey = CORE_STATUS_ROUNDED_KEY,
  unknown = false,
  platform = 'desktop',
} = {}) {
  const owner = {
    nodeId: '22:0',
    componentKey: presetKey,
    name: presetName,
    path: `P22 / ${presetName}`,
    relativePath: '',
    variantProperties: { Size: '24' },
    componentProperties: { Size: '24' },
  };
  return {
    ruleSet: 'buttons-group-pilot',
    collectionErrors: unknown
      ? [{ nodeId: '22:1', factPath: 'component.properties.Shape' }]
      : [],
    evidenceBundle: {
      schemaVersion: 2,
      documentType: 'apollo-audit-evidence-bundle',
      reportId: 'status-shape:evidence',
      sourceReportId: 'status-shape',
      generatedAt: '2026-08-25T12:00:00.000Z',
      context: {
        fileKey: 'figma-file-key',
        pageId: '0:1',
        platform,
        channel: platform === 'desktop' ? 'Desktop' : platform,
        pageType: null,
        viewportWidth: platform === 'desktop' ? 1440 : 390,
        selectionNodeIds: ['22:0'],
      },
      graph: {
        nodes: [evidenceNode({
          nodeId: '22:0',
          childNodeIds: ['22:1'],
          path: `P22 / ${presetName}`,
          name: presetName,
          component: component(presetKey, presetName, { Size: '24' }),
        }), evidenceNode({
          nodeId: '22:1',
          parentNodeId: '22:0',
          path: `P22 / ${presetName} / Status`,
          name: 'Status',
          component: component(statusKey, 'Status', { Size: '24', Shape: shape }),
          componentOwner: owner,
        })],
        relations: [],
      },
      baselines: [],
      changes: [],
      ruleCandidates: [],
      coverage: {
        visibleNodeCount: 2,
        excludedHiddenNodeCount: 0,
        excludedDecorativeNodeCount: 0,
        componentNodeCount: 2,
        textNodeCount: 0,
        baselineChangeCount: 0,
        limitations: [],
      },
    },
  };
}

test('P22 compiles preset-to-shape context mapping from Status & Property rules.json', () => {
  const passStatus = evaluatePredicatePilotRequest(
    statusShapeRequest(),
    { designSystemRoot },
  );
  const passStatusEvaluation = passStatus.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.status-property.shape-is-fixed-by-preset'
  ));
  assert.equal(passStatusEvaluation.classification, 'compliant');
  assert.equal(passStatusEvaluation.focusNodeId, '22:1');

  const passProperty = evaluatePredicatePilotRequest(
    statusShapeRequest({
      presetKey: PROPERTY_PRESET_KEY,
      presetName: '[D] PropertyPreset',
      shape: 'Rectangular',
      statusKey: CORE_STATUS_RECTANGULAR_KEY,
    }),
    { designSystemRoot },
  );
  assert.equal(
    passProperty.result.evaluations.find((item) => (
      item.ruleId === 'component:web-corp.status-property.shape-is-fixed-by-preset'
    )).classification,
    'compliant',
  );

  const fail = evaluatePredicatePilotRequest(
    statusShapeRequest({
      presetKey: PROPERTY_PRESET_KEY,
      presetName: '[D] PropertyPreset',
      shape: 'Rounded',
      statusKey: CORE_STATUS_ROUNDED_KEY,
    }),
    { designSystemRoot },
  );
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.status-property.shape-is-fixed-by-preset'
  ));
  const violationRule = fail.rules.find((item) => (
    item.ruleId === 'component:web-corp.status-property.shape-is-fixed-by-preset'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '22:1');
  assert.equal(violation.trace.children[1].children[1].actual, 'Rounded');
  assert.equal(violation.trace.children[1].children[1].expected, 'Rectangular');
  assert.deepEqual(violationRule.presentation, {
    schemaVersion: 'apollo.predicate-presentation.v1',
    title: 'Форма Status не соответствует preset',
    observed: 'Внутри {{contextLabel}} у Status выбран Shape={{actual}}.',
    expectation: 'Форма вложенного Status должна соответствовать preset: Shape={{expected}}.',
    action: 'Вернуть Shape={{expected}}.',
    contextLabels: {
      'status-preset': 'StatusPreset',
      'property-preset': 'PropertyPreset',
    },
    contextFact: 'ownership.owner.component.family',
    targetFact: 'component.properties.Shape',
  });

  const unknown = evaluatePredicatePilotRequest(
    statusShapeRequest({ unknown: true }),
    { designSystemRoot },
  );
  assert.equal(
    unknown.result.evaluations.find((item) => (
      item.ruleId === 'component:web-corp.status-property.shape-is-fixed-by-preset'
    )).classification,
    'not-evaluable',
  );

  const notApplicable = evaluatePredicatePilotRequest(
    statusShapeRequest({ platform: 'ios' }),
    { designSystemRoot },
  );
  assert.equal(
    notApplicable.result.evaluations.find((item) => (
      item.ruleId === 'component:web-corp.status-property.shape-is-fixed-by-preset'
    )).classification,
    'not-applicable',
  );
});

function benefitsRequest(capacity, cardCount, platform = 'desktop', cardPropertyOverrides = {}) {
  const cardIds = Array.from({ length: cardCount }, (_, index) => `10:${index + 1}`);
  return {
    ruleSet: 'buttons-group-pilot',
    evidenceBundle: {
      schemaVersion: 2,
      documentType: 'apollo-audit-evidence-bundle',
      reportId: 'benefits:evidence',
      sourceReportId: 'benefits',
      generatedAt: '2026-08-23T12:00:00.000Z',
      context: {
        fileKey: 'figma-file-key',
        pageId: '0:1',
        platform,
        channel: 'Desktop',
        pageType: 'form',
        selectionNodeIds: ['10:0'],
      },
      graph: {
        nodes: [
          evidenceNode({
            nodeId: '10:0',
            childNodeIds: cardIds,
            path: '🔒 [D] Benefits',
            name: '🔒 [D] Benefits',
            component: component(BENEFITS_KEY, '🔒 [D] Benefits', {
              Capacity: String(capacity),
            }),
          }),
          ...cardIds.map((nodeId, index) => evidenceNode({
            nodeId,
            parentNodeId: '10:0',
            childOrder: index,
            depth: 1,
            path: `🔒 [D] Benefits / [D] BenefitCard ${index + 1}`,
            name: '[D] BenefitCard',
            component: component(BENEFIT_CARD_KEY, '[D] BenefitCard', Object.assign({
              Background: 'Primary',
              CardAxis: 'Vertical',
              Compact: 'False',
              GraphicPosition: 'Top',
            }, cardPropertyOverrides[index] || {})),
          })),
        ],
        relations: [],
      },
      baselines: [],
      changes: [],
      ruleCandidates: [],
      coverage: {
        visibleNodeCount: cardCount + 1,
        excludedHiddenNodeCount: 0,
        excludedDecorativeNodeCount: 0,
        componentNodeCount: cardCount + 1,
        textNodeCount: 0,
        baselineChangeCount: 0,
        limitations: [],
      },
    },
  };
}

test('P10 evaluates Benefits Capacity against visible BenefitCard count', () => {
  const pass = evaluatePredicatePilotRequest(benefitsRequest(3, 3), { designSystemRoot });
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'component:web.benefits.capacity-matches-card-count'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '10:0');
  assert.equal(passEvaluation.trace.children[0].actual, 3);
  assert.equal(passEvaluation.trace.children[2].actual, 3);

  const fail = evaluatePredicatePilotRequest(benefitsRequest(4, 3), { designSystemRoot });
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'component:web.benefits.capacity-matches-card-count'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '10:0');
  assert.equal(violation.trace.children[2].actual, 3);
  assert.equal(violation.trace.children[2].expected, 4);

  const unknownInput = benefitsRequest(4, 3);
  unknownInput.collectionErrors = [
    {
      nodeId: '10:0',
      factPath: 'composition.visibleBenefitCardNodeIds',
      reason: 'Published instance children could not be collected',
    },
    {
      nodeId: '10:0',
      factPath: 'composition.visibleBenefitCardCount',
      reason: 'Published instance children could not be collected',
    },
  ];
  const unknown = evaluatePredicatePilotRequest(unknownInput, { designSystemRoot });
  assert.equal(
    unknown.result.evaluations.find((item) => (
      item.ruleId === 'component:web.benefits.capacity-matches-card-count'
    )).classification,
    'not-evaluable',
  );

  const notApplicable = evaluatePredicatePilotRequest(
    benefitsRequest(3, 3, 'ios'),
    { designSystemRoot },
  );
  assert.equal(
    notApplicable.result.evaluations.find((item) => (
      item.ruleId === 'component:web.benefits.capacity-matches-card-count'
    )).classification,
    'not-applicable',
  );
});

test('P13 evaluates uniform nested BenefitCard settings as one owner finding', () => {
  const pass = evaluatePredicatePilotRequest(
    benefitsRequest(3, 3),
    { designSystemRoot },
  );
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'component:web.benefits.nested-card-settings-are-uniform'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '10:0');

  const fail = evaluatePredicatePilotRequest(
    benefitsRequest(3, 3, 'desktop', {
      1: { Background: 'Secondary', GraphicPosition: 'Left' },
    }),
    { designSystemRoot },
  );
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'component:web.benefits.nested-card-settings-are-uniform'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '10:0');
  assert.deepEqual(violation.trace.children[0].actual, [
    'Primary',
    'Secondary',
    'Primary',
  ]);
  assert.deepEqual(violation.trace.children[3].actual, ['Top', 'Left', 'Top']);

  const unknownInput = benefitsRequest(3, 3);
  delete unknownInput.evidenceBundle.graph.nodes[2].component.variantProperties.CardAxis;
  delete unknownInput.evidenceBundle.graph.nodes[2].component.componentProperties.CardAxis;
  const unknown = evaluatePredicatePilotRequest(unknownInput, { designSystemRoot });
  assert.equal(
    unknown.result.evaluations.find((item) => (
      item.ruleId === 'component:web.benefits.nested-card-settings-are-uniform'
    )).classification,
    'not-evaluable',
  );
});

function tableViewRequest(headerCount) {
  const headerIds = Array.from({ length: headerCount }, (_, index) => `11:${index + 1}`);
  const spacingIds = headerIds.flatMap((nodeId) => [
    `${nodeId}:spacing-top`,
    `${nodeId}:spacing-bottom`,
  ]);
  const output = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  output.evidenceBundle.reportId = 'table-view:evidence';
  output.evidenceBundle.sourceReportId = 'table-view';
  output.evidenceBundle.context.selectionNodeIds = ['11:0'];
  output.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '11:0',
      childNodeIds: headerIds,
      path: '[D] TableView :: Horizontal',
      name: '[D] TableView :: Horizontal',
      component: component(TABLE_VIEW_HORIZONTAL_KEY, '[D] TableView :: Horizontal', {
        Compact: 'False',
      }),
    }),
    ...headerIds.map((nodeId, index) => evidenceNode({
      nodeId,
      parentNodeId: '11:0',
      childNodeIds: [`${nodeId}:spacing-top`, `${nodeId}:spacing-bottom`],
      childOrder: index,
      depth: 1,
      path: `[D] TableView :: Horizontal / Row ${index + 1}`,
      name: 'Row',
      component: component(TABLE_VIEW_HEADER_ROW_KEY, 'Row', {
        Presets: 'Header', Compact: 'False', Skeleton: 'False',
      }),
    })),
    ...spacingIds.map((nodeId) => evidenceNode({
      nodeId,
      parentNodeId: nodeId.split(':spacing-')[0],
      depth: 2,
      path: '[D] TableView :: Horizontal / Row / ↕ SpacingVertical',
      name: '↕ SpacingVertical',
      component: component(TABLE_VIEW_HEADER_ROW_KEY, '↕ SpacingVertical', {
        Size: '16',
      }),
    })),
  ];
  output.evidenceBundle.coverage.visibleNodeCount = headerCount + 1;
  output.evidenceBundle.coverage.componentNodeCount = headerCount + 1;
  return output;
}

test('P11 evaluates required Header row in non-compact Horizontal TableView', () => {
  const pass = evaluatePredicatePilotRequest(tableViewRequest(1), { designSystemRoot });
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.table-view.horizontal-multi-column-header-required'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '11:0');
  assert.equal(passEvaluation.trace.actual, 1);

  const fail = evaluatePredicatePilotRequest(tableViewRequest(0), { designSystemRoot });
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.table-view.horizontal-multi-column-header-required'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '11:0');
  assert.equal(violation.trace.actual, 0);
  assert.equal(violation.trace.expected, 1);

  const unknownInput = tableViewRequest(1);
  unknownInput.collectionErrors = [{
    nodeId: '11:0',
    factPath: 'composition.visibleHeaderRowCount',
    reason: 'Published instance children could not be collected',
  }];
  const unknown = evaluatePredicatePilotRequest(unknownInput, { designSystemRoot });
  assert.equal(
    unknown.result.evaluations.find((item) => (
      item.ruleId === 'component:web-corp.table-view.horizontal-multi-column-header-required'
    )).classification,
    'not-evaluable',
  );
});

test('P12 evaluates Compact and canonical spacing on each direct TableView Row', () => {
  const passInput = tableViewRequest(1);
  const pass = evaluatePredicatePilotRequest(passInput, { designSystemRoot });
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.table-view.compact-is-consistent-across-rows'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '11:1');

  const failInput = tableViewRequest(1);
  failInput.evidenceBundle.graph.nodes[1].component = component(
    TABLE_VIEW_HEADER_ROW_KEY,
    'Row',
    { Presets: 'Header', Compact: 'True', Skeleton: 'False' },
  );
  for (const node of failInput.evidenceBundle.graph.nodes.slice(2)) {
    node.component = component(TABLE_VIEW_HEADER_ROW_KEY, '↕ SpacingVertical', {
      Size: '12',
    });
  }
  const fail = evaluatePredicatePilotRequest(failInput, { designSystemRoot });
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.table-view.compact-is-consistent-across-rows'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '11:1');
  assert.equal(violation.trace.children[0].actual, 'True');
  assert.equal(violation.trace.children[0].expected, 'False');
  assert.equal(violation.trace.children[1].actual, 12);
  assert.equal(violation.trace.children[1].expected, 16);
});

function compactTableViewColumnRequest(columnCount) {
  const output = tableViewRequest(1);
  output.evidenceBundle.graph.nodes[0].component = component(
    TABLE_VIEW_HORIZONTAL_KEY,
    '[D] TableView :: Horizontal',
    { Compact: 'True' },
  );
  output.evidenceBundle.graph.nodes[1].component = component(
    TABLE_VIEW_HEADER_ROW_KEY,
    'Row',
    { Presets: 'Body', Compact: 'True', Skeleton: 'False' },
  );
  for (const node of output.evidenceBundle.graph.nodes.slice(2)) {
    node.component = component(TABLE_VIEW_HEADER_ROW_KEY, '↕ SpacingVertical', {
      Size: '12',
    });
  }
  const columnIds = Array.from({ length: columnCount }, (_, index) => `11:column-${index + 1}`);
  output.evidenceBundle.graph.nodes[1].childNodeIds.push(...columnIds);
  output.evidenceBundle.graph.nodes.push(...columnIds.map((nodeId, index) => evidenceNode({
    nodeId,
    parentNodeId: '11:1',
    childOrder: index + 2,
    depth: 2,
    path: `[D] TableView :: Horizontal / Row / Cells / Column ${index + 1}`,
    name: 'Column',
    component: component(TABLE_VIEW_COLUMN_KEY, 'Column', { Skeleton: 'False' }),
  })));
  output.evidenceBundle.coverage.visibleNodeCount += columnCount;
  output.evidenceBundle.coverage.componentNodeCount += columnCount;
  return output;
}

test('P14 evaluates one data Column per Row in compact Horizontal TableView', () => {
  const pass = evaluatePredicatePilotRequest(compactTableViewColumnRequest(1), {
    designSystemRoot,
  });
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.table-view.horizontal-compact-one-column'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '11:1');
  assert.equal(passEvaluation.trace.actual, 1);

  const fail = evaluatePredicatePilotRequest(compactTableViewColumnRequest(2), {
    designSystemRoot,
  });
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.table-view.horizontal-compact-one-column'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '11:1');
  assert.equal(violation.trace.actual, 2);
});

function formFirstLevelSpacingRequest(gap) {
  const output = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  output.evidenceBundle.reportId = 'form-spacing:evidence';
  output.evidenceBundle.sourceReportId = 'form-spacing';
  output.evidenceBundle.context.selectionNodeIds = ['15:0'];
  output.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '15:0',
      childNodeIds: ['15:1', '15:2'],
      path: 'Form blocks',
      name: 'Form blocks',
      type: 'FRAME',
      bounds: { x: 0, y: 0, width: 600, height: 200 + gap },
    }),
    evidenceNode({
      nodeId: '15:1',
      parentNodeId: '15:0',
      childOrder: 0,
      depth: 1,
      path: 'Form blocks / Block 1',
      name: '[D] BackgroundPlate',
      component: component(BACKGROUND_PLATE_KEY, '[D] BackgroundPlate', {
        Position: 'Level 1 (outer)',
      }),
      bounds: { x: 0, y: 0, width: 600, height: 100 },
    }),
    evidenceNode({
      nodeId: '15:2',
      parentNodeId: '15:0',
      childOrder: 1,
      depth: 1,
      path: 'Form blocks / Block 2',
      name: '[D] BackgroundPlate',
      component: component(BACKGROUND_PLATE_KEY, '[D] BackgroundPlate', {
        Position: 'Level 1 (outer)',
      }),
      bounds: { x: 0, y: 100 + gap, width: 600, height: 100 },
    }),
  ];
  output.evidenceBundle.coverage.visibleNodeCount = 3;
  output.evidenceBundle.coverage.componentNodeCount = 2;
  return output;
}

test('P15 evaluates the vertical gap between form first-level blocks', () => {
  const pass = evaluatePredicatePilotRequest(formFirstLevelSpacingRequest(24), {
    designSystemRoot,
  });
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'rule:forms.construction-rules.block-spacing.first-level'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '15:2');

  const fail = evaluatePredicatePilotRequest(formFirstLevelSpacingRequest(12), {
    designSystemRoot,
  });
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'rule:forms.construction-rules.block-spacing.first-level'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '15:2');
  assert.equal(violation.trace.expected.measured, 12);
});

function formSecondLevelActionSpacingRequest(gap) {
  const output = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  output.evidenceBundle.reportId = 'form-action-spacing:evidence';
  output.evidenceBundle.sourceReportId = 'form-action-spacing';
  output.evidenceBundle.context.selectionNodeIds = ['20:0'];
  output.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '20:0',
      childNodeIds: ['20:1', '20:3'],
      path: 'Form main column',
      name: 'Form main column',
      type: 'FRAME',
      layout: {
        mode: 'VERTICAL',
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
      type: 'FRAME',
      layout: {
        mode: 'VERTICAL',
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
      component: component(BACKGROUND_PLATE_SLOT_KEY, '[D] BackgroundPlateSlot', {
        Type: 'Primary',
      }),
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
      type: 'FRAME',
      bounds: { x: 0, y: 200 + gap, width: 280, height: 56 },
    }),
    ...['20:4', '20:5'].map((nodeId, index) => evidenceNode({
      nodeId,
      parentNodeId: '20:3',
      childOrder: index,
      depth: 2,
      path: `Form main column / Actions / Button ${index + 1}`,
      name: '[D] Button',
      component: component(BUTTON_KEY, '[D] Button', {
        View: index === 0 ? 'Primary' : 'Secondary',
        Size: '56',
      }),
      bounds: { x: index * 140, y: 200 + gap, width: 124, height: 56 },
    })),
  ];
  output.evidenceBundle.coverage.visibleNodeCount = 6;
  output.evidenceBundle.coverage.componentNodeCount = 3;
  return output;
}

test('P20 evaluates the second-level gap before form primary actions', () => {
  const pass = evaluatePredicatePilotRequest(formSecondLevelActionSpacingRequest(32), {
    designSystemRoot,
  });
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'rule:forms.construction-rules.block-spacing.second-level-actions'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '20:3');

  const fail = evaluatePredicatePilotRequest(formSecondLevelActionSpacingRequest(48), {
    designSystemRoot,
  });
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'rule:forms.construction-rules.block-spacing.second-level-actions'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '20:3');
  assert.equal(violation.trace.expected.measured, 48);
});

function formMediumTitlesRequest(count) {
  const output = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  const titleIds = Array.from({ length: count }, (_, index) => `16:${index + 1}`);
  output.evidenceBundle.context.selectionNodeIds = ['16:0'];
  output.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '16:0',
      childNodeIds: titleIds,
      path: '[D] BackgroundPlateSlot',
      name: '[D] BackgroundPlateSlot',
      component: component(
        '6d5d4dda10be00621991e9b5a0152db4e47f4e2f',
        '[D] BackgroundPlateSlot',
        { Type: 'Primary', Skeleton: 'False' },
      ),
    }),
    ...titleIds.map((nodeId, index) => evidenceNode({
      nodeId,
      parentNodeId: '16:0',
      childOrder: index,
      depth: 1,
      path: `[D] BackgroundPlateSlot / TitleView ${index + 1}`,
      name: '[D] TitleView',
      component: component(
        '22c9df3a231be047e827af4f1625eca22ad9c26d',
        '[D] TitleView',
        { View: 'Medium', Skeleton: 'False' },
      ),
    })),
  ];
  output.evidenceBundle.coverage.visibleNodeCount = count + 1;
  output.evidenceBundle.coverage.componentNodeCount = count + 1;
  return output;
}

test('P16 focuses only extra TitleView Medium instances on a form plate', () => {
  const pass = evaluatePredicatePilotRequest(formMediumTitlesRequest(1), {
    designSystemRoot,
  });
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'rule:forms.construction-rules.title-medium-one-per-plate'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '16:1');

  const fail = evaluatePredicatePilotRequest(formMediumTitlesRequest(2), {
    designSystemRoot,
  });
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'rule:forms.construction-rules.title-medium-one-per-plate' &&
    item.classification === 'violation'
  ));
  assert.equal(violation.focusNodeId, '16:2');
  assert.equal(violation.trace.actual, 'last');
});

function formTitleContentGapRequest(gap) {
  const output = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  output.evidenceBundle.reportId = 'form-title-content-gap:evidence';
  output.evidenceBundle.sourceReportId = 'form-title-content-gap';
  output.evidenceBundle.context.selectionNodeIds = ['17:0'];
  output.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '17:0',
      childNodeIds: ['17:1'],
      path: '[D] BackgroundPlateSlot',
      name: '[D] BackgroundPlateSlot',
      component: component(
        '6d5d4dda10be00621991e9b5a0152db4e47f4e2f',
        '[D] BackgroundPlateSlot',
        { Type: 'Primary', Skeleton: 'False' },
      ),
      bounds: { x: 0, y: 0, width: 600, height: 180 + gap },
    }),
    evidenceNode({
      nodeId: '17:1',
      parentNodeId: '17:0',
      childNodeIds: ['17:2', '17:3'],
      childOrder: 0,
      depth: 1,
      path: '[D] BackgroundPlateSlot / Content',
      name: 'Content',
      type: 'FRAME',
      bounds: { x: 32, y: 32, width: 536, height: 116 + gap },
    }),
    evidenceNode({
      nodeId: '17:2',
      parentNodeId: '17:1',
      childOrder: 0,
      depth: 2,
      path: '[D] BackgroundPlateSlot / Content / [D] TitleView',
      name: '[D] TitleView',
      component: component(
        '22c9df3a231be047e827af4f1625eca22ad9c26d',
        '[D] TitleView',
        { View: 'Medium', Skeleton: 'False' },
      ),
      bounds: { x: 32, y: 32, width: 536, height: 52 },
    }),
    evidenceNode({
      nodeId: '17:3',
      parentNodeId: '17:1',
      childOrder: 1,
      depth: 2,
      path: '[D] BackgroundPlateSlot / Content / Fields',
      name: 'Fields',
      type: 'FRAME',
      bounds: { x: 32, y: 84 + gap, width: 536, height: 64 },
    }),
  ];
  output.evidenceBundle.coverage.visibleNodeCount = 4;
  output.evidenceBundle.coverage.componentNodeCount = 2;
  return output;
}

test('P17 focuses the first content block when the TitleView gap is wrong', () => {
  const pass = evaluatePredicatePilotRequest(formTitleContentGapRequest(24), {
    designSystemRoot,
  });
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'rule:forms.construction-rules.inner-padding-standard.title-to-content'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '17:3');

  const fail = evaluatePredicatePilotRequest(formTitleContentGapRequest(40), {
    designSystemRoot,
  });
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'rule:forms.construction-rules.inner-padding-standard.title-to-content'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '17:3');
  assert.equal(violation.trace.expected.measured, 40);
});

test('P18 focuses the form surface when a standard content inset is wrong', () => {
  const pass = evaluatePredicatePilotRequest(formTitleContentGapRequest(24), {
    designSystemRoot,
  });
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'rule:forms.construction-rules.inner-padding-standard.content-insets'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '17:0');

  const failInput = formTitleContentGapRequest(24);
  failInput.evidenceBundle.graph.nodes[1].bounds.width = 520;
  const fail = evaluatePredicatePilotRequest(failInput, {
    designSystemRoot,
  });
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'rule:forms.construction-rules.inner-padding-standard.content-insets'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '17:0');
  assert.equal(violation.trace.children[1].actual, 48);
});

function formEightFourLayoutRequest(gap = 24) {
  const output = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  output.evidenceBundle.reportId = 'form-eight-four-layout:evidence';
  output.evidenceBundle.sourceReportId = 'form-eight-four-layout';
  output.evidenceBundle.context.selectionNodeIds = ['19:0'];
  output.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '19:0',
      childNodeIds: ['19:1'],
      path: 'P19 fixture',
      name: 'P19 fixture',
      type: 'FRAME',
      bounds: { x: 0, y: 0, width: 1092, height: 320 },
      layout: Object.assign({}, evidenceNode({}).layout, { mode: 'VERTICAL' }),
    }),
    evidenceNode({
      nodeId: '19:1',
      parentNodeId: '19:0',
      childNodeIds: ['19:2', '19:3'],
      childOrder: 0,
      depth: 1,
      path: 'P19 fixture / Body',
      name: 'Body',
      type: 'FRAME',
      bounds: { x: 0, y: 0, width: 1092, height: 320 },
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
      type: 'FRAME',
      bounds: { x: 0, y: 0, width: 720, height: 320 },
      layout: Object.assign({}, evidenceNode({}).layout, { mode: 'VERTICAL' }),
    }),
    evidenceNode({
      nodeId: '19:3',
      parentNodeId: '19:1',
      childOrder: 1,
      depth: 2,
      path: 'P19 fixture / Body / [D] IsleBlock',
      name: '[D] IsleBlock',
      bounds: { x: 720 + gap, y: 0, width: 348, height: 320 },
      component: component(ISLE_BLOCK_KEY, '[D] IsleBlock', {}),
    }),
    evidenceNode({
      nodeId: '19:4',
      parentNodeId: '19:2',
      childOrder: 0,
      depth: 3,
      path: 'P19 fixture / Body / Main / [D] BackgroundPlateSlot',
      name: '[D] BackgroundPlateSlot',
      bounds: { x: 0, y: 0, width: 720, height: 320 },
      component: component(BACKGROUND_PLATE_SLOT_KEY, '[D] BackgroundPlateSlot', {
        Type: 'Primary',
        Skeleton: 'False',
      }),
    }),
  ];
  output.evidenceBundle.coverage.visibleNodeCount = 5;
  output.evidenceBundle.coverage.componentNodeCount = 2;
  return output;
}

test('P19 focuses the shared horizontal form owner when its 8+4 grid is wrong', () => {
  const pass = evaluatePredicatePilotRequest(formEightFourLayoutRequest(24), {
    designSystemRoot,
  });
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'rule:forms.construction-rules.layout-8-4.geometry'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '19:1');

  const fail = evaluatePredicatePilotRequest(formEightFourLayoutRequest(12), {
    designSystemRoot,
  });
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'rule:forms.construction-rules.layout-8-4.geometry'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '19:1');
  const gapTrace = violation.trace.children.find((child) => (
    child.factPaths.includes('composition.formEightFourLayout.gutter')
  ));
  assert.equal(gapTrace.actual, 12);
  assert.equal(gapTrace.expected, 24);
  assert.equal(fail.repeatability.runCount, 10);
  assert.equal(fail.repeatability.stable, true);
  assert.match(fail.repeatability.resultHash, /^[a-f0-9]{64}$/);
});

test('P09 evaluates ButtonsGroup visible button count with tri-state outcomes', () => {
  const pass = evaluatePredicatePilotRequest(
    request({ View: 'Secondary', Size: '56', SingleIcon: 'False' }),
    { designSystemRoot },
  );
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.buttons-group.button-count'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '1:0');
  assert.equal(passEvaluation.trace.predicate, 'count-between');
  assert.equal(passEvaluation.trace.actual, 2);

  const failInput = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  failInput.evidenceBundle.graph.nodes = failInput.evidenceBundle.graph.nodes.slice(0, 2);
  failInput.evidenceBundle.graph.nodes[0].childNodeIds = ['1:1'];
  const fail = evaluatePredicatePilotRequest(failInput, { designSystemRoot });
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.buttons-group.button-count'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '1:0');
  assert.equal(violation.trace.actual, 1);
  assert.deepEqual(violation.trace.expected, {
    lower: 2,
    upper: 4,
    bounds: 'inclusive',
  });

  const unknownInput = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  unknownInput.collectionErrors = [{
    nodeId: '1:0',
    factPath: 'composition.visibleButtonNodeIds',
    reason: 'Published instance children could not be collected',
  }];
  const unknown = evaluatePredicatePilotRequest(unknownInput, { designSystemRoot });
  assert.equal(
    unknown.result.evaluations.find((item) => (
      item.ruleId === 'component:web-corp.buttons-group.button-count'
    )).classification,
    'not-evaluable',
  );

  const notApplicableInput = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  notApplicableInput.evidenceBundle.context.platform = 'ios';
  const notApplicable = evaluatePredicatePilotRequest(
    notApplicableInput,
    { designSystemRoot },
  );
  assert.equal(
    notApplicable.result.evaluations.find((item) => (
      item.ruleId === 'component:web-corp.buttons-group.button-count'
    )).classification,
    'not-applicable',
  );
});

function titleViewSlotRequest(slotNames, platform = 'desktop') {
  const slotIds = slotNames.map((_, index) => `8:${index + 2}`);
  return {
    ruleSet: 'buttons-group-pilot',
    evidenceBundle: {
      schemaVersion: 2,
      documentType: 'apollo-audit-evidence-bundle',
      reportId: 'title-view-slots:evidence',
      sourceReportId: 'title-view-slots',
      generatedAt: '2026-08-23T12:00:00.000Z',
      context: {
        fileKey: 'figma-file-key',
        pageId: '0:1',
        platform,
        channel: 'Desktop',
        pageType: 'form',
        selectionNodeIds: ['8:0'],
      },
      graph: {
        nodes: [
          evidenceNode({
            nodeId: '8:0',
            childNodeIds: ['8:1'],
            path: '[D] TitleView',
            name: '[D] TitleView',
            component: component(TITLE_VIEW_KEY, '[D] TitleView', {
              View: 'xLarge',
              Skeleton: 'False',
            }),
          }),
          evidenceNode({
            nodeId: '8:1',
            parentNodeId: '8:0',
            childNodeIds: slotIds,
            childOrder: 0,
            depth: 1,
            path: '[D] TitleView / MainContent',
            name: 'MainContent',
            type: 'FRAME',
          }),
          ...slotNames.map((name, index) => evidenceNode({
            nodeId: slotIds[index],
            parentNodeId: '8:1',
            childOrder: index,
            depth: 2,
            path: `[D] TitleView / MainContent / ${name}`,
            name,
            type: 'FRAME',
          })),
        ],
        relations: [],
      },
      baselines: [],
      changes: [],
      ruleCandidates: [],
      coverage: {
        visibleNodeCount: slotNames.length + 2,
        excludedHiddenNodeCount: 0,
        excludedDecorativeNodeCount: 0,
        componentNodeCount: 1,
        textNodeCount: 0,
        baselineChangeCount: 0,
        limitations: [],
      },
    },
  };
}

test('P08 evaluates TitleView slot order with exact focus and tri-state outcomes', () => {
  const pass = evaluatePredicatePilotRequest(
    titleViewSlotRequest(['Status', 'Heading', '[D] TitleStatus']),
    { designSystemRoot },
  );
  const passEvaluations = pass.result.evaluations.filter((item) => (
    item.ruleId === 'component:web-corp.title-view.visible-slots-follow-required-order'
  ));
  assert.deepEqual(
    passEvaluations.map((item) => item.classification),
    ['compliant', 'compliant'],
  );

  const fail = evaluatePredicatePilotRequest(
    titleViewSlotRequest(['Heading', 'Status', '[D] TitleStatus']),
    { designSystemRoot },
  );
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.title-view.visible-slots-follow-required-order' &&
    item.classification === 'violation'
  ));
  assert.equal(violation.focusNodeId, '8:2');
  assert.equal(violation.trace.predicate, 'all');
  assert.equal(violation.trace.truth, 'false');
  assert.equal(violation.trace.children[0].predicate, 'after');
  assert.equal(violation.trace.children[1].actual, 'Heading');
  assert.equal(violation.trace.children[2].actual, 'Status');

  const unknown = evaluatePredicatePilotRequest(
    titleViewSlotRequest(['Status', 'Heading', 'Heading']),
    { designSystemRoot },
  );
  assert.equal(
    unknown.result.evaluations.find((item) => (
      item.ruleId === 'component:web-corp.title-view.visible-slots-follow-required-order'
    )).classification,
    'not-evaluable',
  );

  const notApplicable = evaluatePredicatePilotRequest(
    titleViewSlotRequest(['Status', 'Heading'], 'ios'),
    { designSystemRoot },
  );
  assert.equal(
    notApplicable.result.evaluations.find((item) => (
      item.ruleId === 'component:web-corp.title-view.visible-slots-follow-required-order'
    )).classification,
    'not-applicable',
  );
});

test('isolated predicate endpoint reports P03 on the exact non-last button', () => {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  input.evidenceBundle.graph.nodes[0].component.variantProperties.Overflow = 'true';
  input.evidenceBundle.graph.nodes[0].component.componentProperties.Overflow = 'true';
  input.evidenceBundle.graph.nodes[1].component.variantProperties.SingleIcon = 'True';
  input.evidenceBundle.graph.nodes[1].component.componentProperties.SingleIcon = 'True';
  input.evidenceBundle.graph.nodes[1].componentOwner.variantProperties.Overflow = 'true';
  input.evidenceBundle.graph.nodes[1].componentOwner.componentProperties.Overflow = 'true';
  input.evidenceBundle.graph.nodes[2].componentOwner.variantProperties.Overflow = 'true';
  input.evidenceBundle.graph.nodes[2].componentOwner.componentProperties.Overflow = 'true';

  const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
  const finding = output.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.buttons-group.single-icon-position' &&
    item.classification === 'violation'
  ));

  assert.equal(finding.focusNodeId, '1:1');
  assert.equal(output.result.coverage.unclassified, 0);
});

test('unknown nested components do not replace known button evaluations with a root fallback', () => {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  input.evidenceBundle.graph.nodes[0].component.variantProperties.Overflow = 'true';
  input.evidenceBundle.graph.nodes[0].component.componentProperties.Overflow = 'true';
  input.evidenceBundle.graph.nodes[1].component.variantProperties.SingleIcon = 'True';
  input.evidenceBundle.graph.nodes[1].component.componentProperties.SingleIcon = 'True';
  input.evidenceBundle.graph.nodes[1].componentOwner.variantProperties.Overflow = 'true';
  input.evidenceBundle.graph.nodes[1].componentOwner.componentProperties.Overflow = 'true';
  input.evidenceBundle.graph.nodes[2].componentOwner.variantProperties.Overflow = 'true';
  input.evidenceBundle.graph.nodes[2].componentOwner.componentProperties.Overflow = 'true';
  input.evidenceBundle.graph.nodes[1].childNodeIds = ['1:icon'];
  input.evidenceBundle.graph.nodes.push(evidenceNode({
    nodeId: '1:icon',
    parentNodeId: '1:1',
    childOrder: 0,
    depth: 2,
    path: 'ButtonsGroup/Button 1/Icon',
    name: 'Unindexed icon',
    component: component('unindexed-icon-key', 'Unindexed icon', {}),
    componentOwner: {
      nodeId: '1:1',
      componentKey: BUTTON_KEY,
      name: '[D] Button',
      path: 'ButtonsGroup/Button 1',
      relativePath: 'Icon',
      variantProperties: { View: 'Primary', Size: '56', SingleIcon: 'True' },
      componentProperties: { View: 'Primary', Size: '56', SingleIcon: 'True' },
    },
  }));

  const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
  const p03 = output.result.evaluations.filter((item) => (
    item.ruleId === 'component:web-corp.buttons-group.single-icon-position'
  ));

  assert.equal(
    p03.some((item) => item.classification === 'not-evaluable'),
    false,
  );
  assert.equal(
    p03.find((item) => item.classification === 'violation').focusNodeId,
    '1:1',
  );
});

test('isolated predicate endpoint rejects unregistered rule sets', () => {
  assert.throws(
    () => evaluatePredicatePilotRequest(
      { ruleSet: 'arbitrary-client-rules', evidenceBundle: request({ View: 'Secondary', Size: '56' }).evidenceBundle },
      { designSystemRoot },
    ),
    (error) => error.code === 'PREDICATE_RULE_SET_UNSUPPORTED',
  );
});

test('isolated predicate endpoint accepts a missing Developer VM fileKey', () => {
  const input = request({ View: 'Accent', Size: '40' });
  input.evidenceBundle.context.fileKey = null;

  const output = evaluatePredicatePilotRequest(input, { designSystemRoot });

  assert.equal(output.snapshot.context.fileKey, null);
  assert.deepEqual(output.snapshot.context.unknownFacts, ['fileKey']);
  assert.equal(output.result.coverage.byClassification.violation, 2);
});

test('isolated predicate endpoint evaluates P04 with exact TitleView focus', () => {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  input.evidenceBundle.context.selectionNodeIds = ['2:0'];
  input.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '2:0',
      childNodeIds: ['2:1'],
      path: '[D] TitleView',
      name: '[D] TitleView',
      component: component(TITLE_VIEW_KEY, '[D] TitleView', { View: 'xLarge' }),
    }),
    evidenceNode({
      nodeId: '2:1',
      parentNodeId: '2:0',
      childOrder: 0,
      depth: 1,
      path: '[D] TitleView / Title',
      type: 'TEXT',
      name: 'Title',
      text: {
        characters: 'Заголовок',
        length: 9,
        textStyleId: 'style-actual',
      },
      styles: {
        fillStyleId: null,
        strokeStyleId: null,
        textStyleId: 'style-actual',
        effectStyleId: null,
      },
      componentOwner: {
        nodeId: '2:0',
        componentKey: TITLE_VIEW_KEY,
        name: '[D] TitleView',
        path: '[D] TitleView',
        relativePath: 'Title',
        variantProperties: { View: 'xLarge' },
        componentProperties: { View: 'xLarge' },
      },
    }),
  ];
  input.evidenceBundle.graph.nodes[0].component.directOverrides = [{
    nodeId: '2:1',
    fields: ['textStyleId'],
  }];
  input.evidenceBundle.changes = [{
    id: 'change-title-style',
    nodeId: '2:1',
    nodeName: 'Title',
    nodePath: '[D] TitleView / Title',
    property: 'styles.text',
    kind: 'text-style',
    ownerComponentKey: TITLE_VIEW_KEY,
    baselineReferenceId: 'baseline-title-view',
    baseline: {
      value: 'Headline–System/40–48 Large',
      resourceType: 'style',
      resourceName: 'Headline–System/40–48 Large',
      bindingName: null,
      bindingCollection: null,
    },
    actual: {
      value: 'Headline–System/30–36 Medium',
      resourceType: 'style',
      resourceName: 'Headline–System/30–36 Medium',
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
  }];

  const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
  const violation = output.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.title-view.title-and-subtitle-typography-is-fixed' &&
    item.classification === 'violation'
  ));

  assert.equal(violation.focusNodeId, '2:1');
  const baselineTrace = violation.trace.children.find((child) => (
    child.predicate === 'matches-effective-baseline'
  ));
  assert.equal(baselineTrace.actual, 'Headline–System/30–36 Medium');
  assert.equal(baselineTrace.expected, 'Headline–System/40–48 Large');
  assert.equal(output.result.coverage.unclassified, 0);
});

test('isolated predicate endpoint evaluates P07 on the exact mismatching TitleStatus', () => {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  input.evidenceBundle.context.selectionNodeIds = ['5:0'];
  input.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '5:0',
      childNodeIds: ['5:1', '5:2'],
      path: '[D] TitleView',
      name: '[D] TitleView',
      component: component(TITLE_VIEW_KEY, '[D] TitleView', { View: 'xLarge' }),
    }),
    evidenceNode({
      nodeId: '5:1',
      parentNodeId: '5:0',
      childOrder: 0,
      depth: 1,
      path: '[D] TitleView / Status / StatusPreset',
      name: 'StatusPreset',
      component: component(STATUS_PRESET_KEY, 'StatusPreset', { Type: 'Approved' }),
    }),
    evidenceNode({
      nodeId: '5:2',
      parentNodeId: '5:0',
      childOrder: 1,
      depth: 1,
      path: '[D] TitleView / [D] TitleStatus',
      name: '[D] TitleStatus',
      component: component(TITLE_STATUS_KEY, '[D] TitleStatus', { Type: 'Attention' }),
    }),
  ];
  input.evidenceBundle.graph.relations = [];
  input.evidenceBundle.changes = [];

  const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
  const violation = output.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.title-view.status-and-title-status-color-match' &&
    item.classification === 'violation'
  ));

  assert.equal(violation.focusNodeId, '5:2');
  assert.deepEqual(violation.trace.actual, ['Approved', 'Attention']);
  assert.equal(output.result.coverage.unclassified, 0);
});

test('isolated predicate endpoint evaluates P05 without sending raw padding to an agent', () => {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  input.evidenceBundle.context.selectionNodeIds = ['3:0'];
  input.evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '3:0',
    path: '[D] BackgroundPlateSlot',
    name: '[D] BackgroundPlateSlot',
    component: component(BACKGROUND_PLATE_SLOT_KEY, '[D] BackgroundPlateSlot', {
      Type: 'Primary',
    }),
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
    variableBindings: ['top', 'bottom', 'left'].map((side) => ({
      property: `padding${side[0].toUpperCase()}${side.slice(1)}`,
      variableIds: [`VariableID:spacing-${side}`],
      variables: [{
        id: `VariableID:spacing-${side}`,
        key: `spacing-${side}-key`,
        name: '32',
        collectionId: 'collection:spacing',
        collectionName: 'Spacing',
      }],
    })),
  })];
  input.evidenceBundle.graph.relations = [];
  input.evidenceBundle.changes = ['top', 'right', 'bottom', 'left'].map((side) => ({
    id: `padding-${side}`,
    nodeId: '3:0',
    property: `layout.padding.${side}`,
    baseline: { value: 24 },
    actual: { value: 32 },
    bindingStatus: side === 'right' ? 'missing-actual-binding' : 'different-binding',
  }));

  const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
  const violations = output.result.evaluations.filter(
    (item) => item.classification === 'violation',
  );

  assert.equal(violations.length, 1);
  assert.equal(
    violations[0].ruleId,
    'component:web-corp.background-plate.padding-uses-spacing-tokens.right',
  );
  assert.equal(violations[0].focusNodeId, '3:0');
  assert.equal(output.result.coverage.unclassified, 0);
});

test('P05 does not apply padding token rules to legacy BackgroundPlate roots', () => {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  input.evidenceBundle.context.selectionNodeIds = ['3:legacy'];
  input.evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '3:legacy',
    path: '[D] BackgroundPlate',
    name: '[D] BackgroundPlate',
    component: component(BACKGROUND_PLATE_KEY, '[D] BackgroundPlate', {
      Position: 'Level 1 (outer)',
      Type: 'Primary',
    }),
    layout: {
      mode: 'VERTICAL',
      positioning: 'AUTO',
      wrap: 'NO_WRAP',
      sizingHorizontal: 'FILL',
      sizingVertical: 'HUG',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      itemSpacing: 0,
      clipsContent: false,
    },
    variableBindings: [],
  })];
  input.evidenceBundle.graph.relations = [];
  input.evidenceBundle.changes = [];

  const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
  const paddingEvaluations = output.result.evaluations.filter((item) => (
    item.ruleId.includes('padding-uses-spacing-tokens')
  ));

  assert.equal(paddingEvaluations.length, 4);
  assert.ok(paddingEvaluations.every((item) => item.classification === 'not-applicable'));
});

test('isolated predicate endpoint evaluates P06 from sibling overlay composition', () => {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  input.evidenceBundle.context.selectionNodeIds = ['4:0'];
  input.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '4:0',
      childNodeIds: ['4:1', '4:2'],
      path: 'BackgroundPlate overlay',
      name: 'BackgroundPlate overlay',
      type: 'FRAME',
      bounds: { x: 0, y: 0, width: 396, height: 304 },
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
    }),
    evidenceNode({
      nodeId: '4:1',
      parentNodeId: '4:0',
      childOrder: 0,
      depth: 1,
      path: 'BackgroundPlate overlay/Level 1',
      name: '[D] BackgroundPlate',
      bounds: { x: 0, y: 0, width: 396, height: 304 },
      layout: {
        mode: 'VERTICAL',
        positioning: 'ABSOLUTE',
        wrap: 'NO_WRAP',
        sizingHorizontal: 'FILL',
        sizingVertical: 'FILL',
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'MIN',
        padding: null,
        itemSpacing: 0,
        clipsContent: false,
      },
      component: component(BACKGROUND_PLATE_KEY, '[D] BackgroundPlate', {
        Position: 'Level 1 (outer)',
      }),
    }),
    evidenceNode({
      nodeId: '4:2',
      parentNodeId: '4:0',
      childOrder: 1,
      depth: 1,
      path: 'BackgroundPlate overlay/Level 2',
      name: '[D] BackgroundPlate',
      bounds: { x: 24, y: 24, width: 348, height: 256 },
      layout: {
        mode: 'VERTICAL',
        positioning: 'AUTO',
        wrap: 'NO_WRAP',
        sizingHorizontal: 'FILL',
        sizingVertical: 'HUG',
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'MIN',
        padding: null,
        itemSpacing: 0,
        clipsContent: false,
      },
      component: component(BACKGROUND_PLATE_KEY, '[D] BackgroundPlate', {
        Position: 'Level 2 (inner)',
      }),
    }),
  ];
  input.evidenceBundle.graph.relations = [];
  input.evidenceBundle.changes = [];

  const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
  const evaluation = output.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.background-plate.level-2-requires-level-1'
  ));

  assert.equal(evaluation.classification, 'compliant');
  assert.equal(evaluation.focusNodeId, '4:2');
  assert.equal(evaluation.trace.children[5].actual, 'ABSOLUTE');
  assert.equal(evaluation.trace.children[7].predicate, 'after');
  assert.equal(evaluation.trace.children[8].predicate, 'contains');
  assert.equal(output.result.coverage.unclassified, 0);
});
