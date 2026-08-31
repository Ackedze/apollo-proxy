const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  evaluatePredicateReleaseRequest,
} = require('../src/predicate-engine/release-service');
const evaluatePredicatePilotRequest = evaluatePredicateReleaseRequest;

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
const TABLE_VIEW_ROW_KEY = 'c65ca1d60347f0eecae4bf9acd8b89c417f6d648';
const TABLE_VIEW_SIDE_PANEL_KEY = '46fdafb593b319e287d29eb6bc875a951b812a5e';
const TABLE_VIEW_SIDE_PANEL_ROW_KEY = '37854b6b3fbb8818735970825a47f477600c19f1';
const TABLE_VIEW_COLUMN_KEY = 'af59b50bbe31bfad10b6f9fe6decb9798b465771';
const SPACING_VERTICAL_16_KEY = '452ccc2cfcaa139709c7538d175c592b00232332';
const SPACING_VERTICAL_12_KEY = 'e20ee33385ac041ce04e356b5ba698cad16e18d5';
const BACKGROUND_PLATE_SLOT_KEY = '6d5d4dda10be00621991e9b5a0152db4e47f4e2f';
const ISLE_BLOCK_KEY = '9dd86bd040376734e605227c0d849d1328e62d76';
const ACCOUNT_SELECT_PUBLIC_ROOT_KEY = '77938b4511abfbafdd13b13f6bb6f3fbe87cf2a2';
const ACCOUNT_SELECT_MOBILE_PUBLIC_ROOT_KEY = '1043a9208a949b1af3f708637de5fd13721a4519';
const ACCOUNT_SELECT_INTERNAL_ITEM_KEY = '1e8647f2b51a623083755fdad5c677fc38770e3e';
const ACCOUNT_SELECT_SUM_ITEM_KEY = '7b188529df2fdf9c6e93989b2173f6cc95fc77d6';
const ACCOUNT_SELECT_NUMBER_ITEM_KEY = 'b0e271a2c5e94e00b753d223c1bce95b87da95af';
const CARD_SWIPER_MOBILE_360_KEY = '0ccaf9d784aa8b603d6229a898f46433ee74b925';
const CARD_SWIPER_MOBILE_320_KEY = 'd115bb68174c21fe7475748dc31f651221db4558';
const PROPERTY_PRESET_KEY = '55c7b3a923bfb246c0f8ce6f85558f78ec702a53';
const CORE_STATUS_RECTANGULAR_KEY = 'a410d666446afa4beb01cd6c35e9e6642e9b28be';
const CORE_STATUS_ROUNDED_KEY = 'a54fc8de49f424f46ddb87e1f14103cda8a5456e';
const CORPORATE_SECTION_KEY = '2bbced82d96c1347fea71a3922cd11cf4c25ad6a';
const TABS_VIEW_KEY = '519118350c338878dff70f5c8e62cf9c7d53bffd';
const TABS_SECONDARY_KEY = 'd44e07075d37245006c02b03ca28fa9a8681fa1e';
const TAG_FILLED_KEY = 'da874fbc1750ce68c942384fc3f0c95d1660e2fc';
const TAG_GROUP_KEY = 'fd28f1f379a3724a09842273bce45f9bbccb9f4c';
const PAYMENT_MASKED_NUMBER_KEY = 'bd25bbd83bfc28176b42284659f21c8a7cd8e97b';
const PAYMENT_MASKED_NUMBER_MAJOR_KEY = 'e1f5bf7317b09ffcd37f011dcf88ceb2d346b5eb';
const CARD_IMAGE_XS_ACTIVE_KEY = 'acc0bda0cee8df12ef3be8b215b5858fbd19afcb';
const CARD_IMAGE_XS_INACTIVE_KEY = '54a5bac509c2fb21b12d21b5471b1e0d180a37c1';
const ONBOARDING_TOOLTIP_KEY = 'c9a8db25e3fb6bc7907464f81547a6295816c59b';
const BACKGROUND_PLATE_STYLE_LEVEL_1_KEY = 'adb65a62cde9ebedc5d0d41d2d77cd63e71e0745';
const BACKGROUND_PLATE_STYLE_LEVEL_2_KEY = '3db7b24d3047696007a36a13c8da09f9256014e0';
const BACKGROUND_PLATE_DESKTOP_ROOT_KEY = '2c7332d281570f4d5af6d334f8df378d24a1f235';
const BACKGROUND_PLATE_DESKTOP_SLOT_KEY = '5b6c5ac720154aff36be2f8a883bd058faa663cf';
const BACKGROUND_PLATE_MOBILE_ROOT_KEY = '4cfe3915785e5c37255190ae16314f6f2a1d05b3';
const BACKGROUND_PLATE_MOBILE_SLOT_KEY = '1745af83255e324781c2fbadfe0ad8cc7f13e0d8';
const BACKGROUND_PLATE_MOBILE_STYLE_LEVEL_1_KEY = 'efc528bd86582d96a824edeb2c257dc8b22a8f14';
const FILTER_COMPANY_SELECT_SINGLE_KEY = '7a0f566e36767d14d873e7ed22295ac0ac86fa69';
const FILTER_COMPANY_SELECT_INTERNAL_KEY = '646b38ca55ddc9c7b3837c11ed671c50d0a6d66a';
const ICON_VIEW_KEY = 'f188fb1de981b2f32966f4844a4b10cffdb81c35';
const ICON_VIEW_CONTENT_KEY = '913a526e98f177533ca3e4495d6658d0120e6afe';
const CORPORATE_SYSTEM_MESSAGE_KEY = '985497c1f5a102a52e4d4dc40b6953303db72f8e';
const HOLDING_PLATE_KEY = '064735a152a60b891ff5c29e89dbc3a5aae18165';
const SCENARIO_MODEL_INTERRUPTION_KEY = 'f7644c318f200ae2d63acba8f6def7a1aa3a749b';
const AMOUNT_HEADLINE_DESKTOP_KEY = '46d9453084998704a7c26aefd8c2d4427e3a4f5c';
const AMOUNT_HEADLINE_MOBILE_KEY = 'cee3a597980650c3d43dbe8bf283d2c4f6c1507e';
const AMOUNT_PARAGRAPH_KEY = '6276f825ec9ee2ceded5305171c715a7dd73637e';
const CORPORATE_APP_HEADER_DESKTOP_KEY = 'd187029a0a1af08dbb499e13b3ef2ac98efaaac2';
const CORPORATE_APP_HEADER_ICON_BUTTON_KEY = 'f2dfdad5655f459cc9ba62db6add21f440f47e5c';

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

function request(secondProperties, firstProperties = {
  View: 'Primary',
  Size: '56',
  SingleIcon: 'False',
}) {
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
            component: component(BUTTON_KEY, '[D] Button', firstProperties),
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

test('production predicate service evaluates only rules from the knowledge release', () => {
  const input = request({ View: 'Accent', Size: '40' });
  delete input.ruleSet;
  const output = evaluatePredicateReleaseRequest(input, { designSystemRoot });
  const ruleIds = new Set(output.rules.map((rule) => rule.ruleId));

  assert.equal(ruleIds.has('component:web-corp.buttons-group.allowed-views'), true);
  assert.equal(ruleIds.has('component:web-corp.buttons-group.uniform-size'), true);
  assert.equal(
    ruleIds.has('component:web-corp.table-view.compact-is-consistent-across-rows'),
    false,
  );
  assert.equal(
    output.result.evaluations.some((evaluation) => (
      evaluation.ruleId === 'component:web-corp.buttons-group.allowed-views'
      && evaluation.classification === 'violation'
    )),
    true,
  );
  assert.equal(output.repeatability.stable, true);
});

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
  const ruleIds = output.rules.map((rule) => rule.ruleId);
  assert.equal(new Set(ruleIds).size, ruleIds.length);
  for (const ruleId of [
    'component:web-corp.buttons-group.button-count',
    'component:web-corp.buttons-group.allowed-views',
    'component:web-corp.buttons-group.overflow-enables-last-single-icon',
    'component:web-corp.buttons-group.uniform-size',
    'component:web-corp.buttons-group.primary-position',
    'component:web-corp.buttons-group.single-icon-position',
    'component:web-core.button.desktop-hint-restricted',
    'component:web-core.button.label-text-style-locked',
    'component:web-core.button.manual-fill-is-layer-property.fill',
    'component:web-core.button.manual-layout-and-appearance-overrides-prohibited.radius',
    'rule:controls.buttons-and-button-groups.desktop-safe-variants',
    'rule:forms.construction-rules.layout-8-4',
  ]) {
    assert.ok(ruleIds.includes(ruleId), `missing compiled rule: ${ruleId}`);
  }
  assert.equal(
    output.rules[0].source.path,
    'design-system_ab/JSONS/web/components/web-corp/ButtonGroup [D]/composition-contract.json',
  );
  assert.equal(output.rules[0].source.checksum.length, 64);
  assert.equal(output.rules[0].scope.pageType, undefined);
  assert.deepEqual(
    output.rules.find(
      (rule) => rule.ruleId === 'rule:forms.construction-rules.layout-8-4',
    ).scope,
    { platform: ['desktop'], pageType: ['form'] },
  );
  const violations = output.result.evaluations.filter(
    (item) => item.classification === 'violation',
  );
  assert.equal(output.result.coverage.byClassification.violation, 2);
  assert.deepEqual(new Set(violations.map((item) => item.focusNodeId)), new Set(['1:2']));
  assert.equal(output.result.coverage.unclassified, 0);
  assert.equal(output.result.coverage.duplicateEvaluationIds, 0);
});

test('composition contract compiles Primary position from source data', () => {
  const output = evaluatePredicatePilotRequest(
    request(
      { View: 'Primary', Size: '56', SingleIcon: 'False' },
      { View: 'Secondary', Size: '56', SingleIcon: 'False' },
    ),
    { designSystemRoot },
  );
  const evaluation = output.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.buttons-group.primary-position'
  ));
  const rule = output.rules.find((item) => (
    item.ruleId === 'component:web-corp.buttons-group.primary-position'
  ));

  assert.equal(evaluation.classification, 'violation');
  assert.equal(evaluation.focusNodeId, '1:2');
  assert.equal(
    rule.source.path,
    'design-system_ab/JSONS/web/components/web-corp/ButtonGroup [D]/composition-contract.json',
  );
  assert.equal(rule.presentation.title, 'Primary-кнопка находится не на первом месте');
});

function accountSelectPublicRootRequest(componentKey, platform = 'desktop') {
  return {
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
            : componentKey === ACCOUNT_SELECT_MOBILE_PUBLIC_ROOT_KEY
              ? '[M] AccountOptionListContent'
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

function backgroundPlatePublicRootRequest(componentKey, platform = 'desktop') {
  return {
    evidenceBundle: {
      schemaVersion: 2,
      documentType: 'apollo-audit-evidence-bundle',
      reportId: 'background-plate-public-root:evidence',
      sourceReportId: 'background-plate-public-root',
      generatedAt: '2026-08-30T12:00:00.000Z',
      context: {
        fileKey: 'figma-file-key',
        pageId: '0:1',
        platform,
        channel: platform === 'desktop' ? 'Desktop' : 'MobileWeb',
        pageType: null,
        viewportWidth: platform === 'desktop' ? 1440 : 390,
        selectionNodeIds: ['21:20'],
      },
      graph: {
        nodes: [evidenceNode({
          nodeId: '21:20',
          path: 'C20 / renamed BackgroundPlate fixture',
          name: 'renamed fixture',
          component: component(componentKey, 'renamed fixture', {}),
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

function corporateSystemMessagePlatformRequest({
  platform = 'mobile-web',
  name = 'FAIL · renamed fixture',
  hosted = false,
} = {}) {
  const componentNode = evidenceNode({
    nodeId: hosted ? '22:1' : '22:0',
    parentNodeId: hosted ? '22:0' : null,
    depth: hosted ? 1 : 0,
    path: hosted ? 'Host / CorporateSystemMessage' : 'CorporateSystemMessage',
    name,
    component: component(CORPORATE_SYSTEM_MESSAGE_KEY, '[D] CorporateSystemMessage', {}),
  });
  const nodes = hosted
    ? [
      evidenceNode({
        nodeId: '22:0',
        childNodeIds: ['22:1'],
        path: 'Host',
        name: '[D] TitleView',
        component: component(TITLE_VIEW_KEY, '[D] TitleView', { View: 'xLarge' }),
      }),
      componentNode,
    ]
    : [componentNode];
  return {
    evidenceBundle: {
      schemaVersion: 2,
      documentType: 'apollo-audit-evidence-bundle',
      reportId: 'corporate-system-message-platform:evidence',
      sourceReportId: 'corporate-system-message-platform',
      generatedAt: '2026-08-28T12:00:00.000Z',
      context: {
        fileKey: 'figma-file-key',
        pageId: '0:1',
        platform,
        channel: platform === 'desktop' ? 'Desktop' : 'MobileWeb',
        pageType: null,
        viewportWidth: platform === 'desktop' ? 1440 : 390,
        selectionNodeIds: ['22:0'],
      },
      graph: { nodes, relations: [] },
      baselines: [],
      changes: [],
      ruleCandidates: [],
      coverage: {
        visibleNodeCount: nodes.length,
        excludedHiddenNodeCount: 0,
        excludedDecorativeNodeCount: 0,
        componentNodeCount: nodes.length,
        textNodeCount: 0,
        baselineChangeCount: 0,
        limitations: [],
      },
    },
  };
}

function platformComponentRequest(componentKey, name, platform = 'mobile-web') {
  const node = evidenceNode({
    nodeId: '22:10',
    path: name,
    name,
    component: component(componentKey, name, {}),
  });
  return {
    evidenceBundle: {
      schemaVersion: 2,
      documentType: 'apollo-audit-evidence-bundle',
      reportId: `${componentKey}:platform:evidence`,
      sourceReportId: `${componentKey}:platform`,
      generatedAt: '2026-08-28T12:00:00.000Z',
      context: {
        fileKey: 'figma-file-key',
        pageId: '0:1',
        platform,
        channel: platform === 'desktop' ? 'Desktop' : 'MobileWeb',
        pageType: null,
        viewportWidth: platform === 'desktop' ? 1440 : 390,
        selectionNodeIds: [node.nodeId],
      },
      graph: { nodes: [node], relations: [] },
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

test('AccountSelect platform-match covers D/M roots on both selected channels', () => {
  const ruleId = 'component:web-corp.account-select.platform-match';
  const evaluate = (componentKey, platform) => evaluatePredicatePilotRequest(
    accountSelectPublicRootRequest(componentKey, platform),
    { designSystemRoot },
  ).result.evaluations.find((item) => item.ruleId === ruleId);

  const desktopPass = evaluate(ACCOUNT_SELECT_PUBLIC_ROOT_KEY, 'desktop');
  assert.equal(desktopPass.classification, 'compliant');
  assert.equal(desktopPass.trace.actual, 'desktop');
  assert.equal(desktopPass.trace.expected, 'desktop');

  const mobilePass = evaluate(ACCOUNT_SELECT_MOBILE_PUBLIC_ROOT_KEY, 'mobile-web');
  assert.equal(mobilePass.classification, 'compliant');
  assert.equal(mobilePass.trace.actual, 'mobile-web');
  assert.equal(mobilePass.trace.expected, 'mobile-web');

  const mobileOnDesktop = evaluate(ACCOUNT_SELECT_MOBILE_PUBLIC_ROOT_KEY, 'desktop');
  assert.equal(mobileOnDesktop.classification, 'violation');
  assert.equal(mobileOnDesktop.focusNodeId, '21:0');
  assert.equal(mobileOnDesktop.trace.actual, 'desktop');
  assert.equal(mobileOnDesktop.trace.expected, 'mobile-web');

  const desktopOnMobile = evaluate(ACCOUNT_SELECT_PUBLIC_ROOT_KEY, 'mobile-web');
  assert.equal(desktopOnMobile.classification, 'violation');
  assert.equal(desktopOnMobile.focusNodeId, '21:0');
  assert.equal(desktopOnMobile.trace.actual, 'mobile-web');
  assert.equal(desktopOnMobile.trace.expected, 'desktop');
});

test('BackgroundPlate public-root rejects standalone Style Level and accepts published roots', () => {
  const ruleId = 'component:web-corp.background-plate.public-roots-only';
  const evaluate = (componentKey, platform = 'desktop') => evaluatePredicatePilotRequest(
    backgroundPlatePublicRootRequest(componentKey, platform),
    { designSystemRoot },
  ).result.evaluations.find((item) => item.ruleId === ruleId);

  for (const componentKey of [
    BACKGROUND_PLATE_DESKTOP_ROOT_KEY,
    BACKGROUND_PLATE_DESKTOP_SLOT_KEY,
  ]) {
    assert.equal(evaluate(componentKey).classification, 'compliant');
  }

  for (const componentKey of [
    BACKGROUND_PLATE_STYLE_LEVEL_1_KEY,
    BACKGROUND_PLATE_MOBILE_STYLE_LEVEL_1_KEY,
  ]) {
    const violation = evaluate(
      componentKey,
      componentKey === BACKGROUND_PLATE_STYLE_LEVEL_1_KEY ? 'desktop' : 'mobile-web',
    );
    assert.equal(violation.classification, 'violation');
    assert.equal(violation.focusNodeId, '21:20');
    assert.equal(violation.trace.actual, 'style-level-1');
    assert.deepEqual(violation.trace.expected, ['background-plate', 'background-plate-slot']);
  }
});

test('BackgroundPlate platform-match covers D/M roots on both selected channels', () => {
  const ruleId = 'component:web-corp.background-plate.platform-version-must-match';
  const evaluate = (componentKey, platform) => evaluatePredicatePilotRequest(
    backgroundPlatePublicRootRequest(componentKey, platform),
    { designSystemRoot },
  ).result.evaluations.find((item) => item.ruleId === ruleId);

  for (const componentKey of [
    BACKGROUND_PLATE_DESKTOP_ROOT_KEY,
    BACKGROUND_PLATE_DESKTOP_SLOT_KEY,
  ]) {
    assert.equal(evaluate(componentKey, 'desktop').classification, 'compliant');
    assert.equal(evaluate(componentKey, 'mobile-web').classification, 'violation');
  }

  for (const componentKey of [
    BACKGROUND_PLATE_MOBILE_ROOT_KEY,
    BACKGROUND_PLATE_MOBILE_SLOT_KEY,
  ]) {
    assert.equal(evaluate(componentKey, 'mobile-web').classification, 'compliant');
    assert.equal(evaluate(componentKey, 'desktop').classification, 'violation');
  }
});

test('platform-match uses the published key, evaluates MobileWeb, and skips hosted roots', () => {
  const ruleId = 'component:web-corp.corporate-system-message.platform-breakpoint';
  const evaluate = (options) => evaluatePredicatePilotRequest(
    corporateSystemMessagePlatformRequest(options),
    { designSystemRoot },
  ).result.evaluations.find((item) => item.ruleId === ruleId);

  const renamedDesktop = evaluate({ platform: 'desktop' });
  assert.equal(renamedDesktop.classification, 'compliant');

  const renamedMobile = evaluate({ platform: 'mobile-web' });
  assert.equal(renamedMobile.classification, 'violation');
  assert.equal(renamedMobile.focusNodeId, '22:0');
  assert.equal(renamedMobile.trace.actual, 'mobile-web');
  assert.equal(renamedMobile.trace.expected, 'desktop');

  const hostedMobile = evaluate({ platform: 'mobile-web', hosted: true });
  assert.equal(hostedMobile.classification, 'not-applicable');
});

for (const fixture of [{
  componentKey: HOLDING_PLATE_KEY,
  name: 'HoldingPlate',
  ruleId: 'component:web-corp.holding-plate.desktop-only',
}, {
  componentKey: SCENARIO_MODEL_INTERRUPTION_KEY,
  name: 'ScenarioModel ! interruption',
  ruleId: 'component:web-corp.scenario-model-interruption.desktop-only',
}]) {
  test(`${fixture.name} treats a universal generated contract as desktop-only authority`, () => {
    const evaluate = (platform) => evaluatePredicatePilotRequest(
      platformComponentRequest(fixture.componentKey, fixture.name, platform),
      { designSystemRoot },
    ).result.evaluations.find((item) => item.ruleId === fixture.ruleId);

    const desktop = evaluate('desktop');
    assert.equal(desktop.classification, 'compliant');
    assert.equal(desktop.trace.actual, 'desktop');
    assert.deepEqual(desktop.trace.expected, ['desktop']);

    const mobile = evaluate('mobile-web');
    assert.equal(mobile.classification, 'violation');
    assert.equal(mobile.focusNodeId, '22:10');
    assert.equal(mobile.trace.actual, 'mobile-web');
    assert.deepEqual(mobile.trace.expected, ['desktop']);
  });
}

test('AmountStyles platform rule distinguishes D, M and shared Paragraph presets', () => {
  const ruleId = 'component:web-corp.amount-styles.platform-preset-matches-channel';
  const evaluate = (componentKey, name, platform) => evaluatePredicatePilotRequest(
    platformComponentRequest(componentKey, name, platform),
    { designSystemRoot },
  ).result.evaluations.find((item) => item.ruleId === ruleId);

  assert.equal(evaluate(AMOUNT_HEADLINE_DESKTOP_KEY, '🔒 [D] AmountHeadline', 'desktop').classification, 'compliant');
  assert.equal(evaluate(AMOUNT_HEADLINE_DESKTOP_KEY, '🔒 [D] AmountHeadline', 'mobile-web').classification, 'violation');
  assert.equal(evaluate(AMOUNT_HEADLINE_MOBILE_KEY, '🔒 [M] AmountHeadline', 'mobile-web').classification, 'compliant');
  assert.equal(evaluate(AMOUNT_HEADLINE_MOBILE_KEY, '🔒 [M] AmountHeadline', 'desktop').classification, 'violation');
  assert.equal(evaluate(AMOUNT_PARAGRAPH_KEY, '🔒 AmountParagraph', 'desktop').classification, 'compliant');
  assert.equal(evaluate(AMOUNT_PARAGRAPH_KEY, '🔒 AmountParagraph', 'mobile-web').classification, 'compliant');
});

test('CorporateAppHeaderNew public root is desktop-only', () => {
  const ruleId = 'component:web-corp.corporate-app-header-new.desktop-only';
  const evaluate = (platform) => evaluatePredicatePilotRequest(
    platformComponentRequest(CORPORATE_APP_HEADER_DESKTOP_KEY, '[D] Header', platform),
    { designSystemRoot },
  ).result.evaluations.find((item) => item.ruleId === ruleId);

  assert.equal(evaluate('desktop').classification, 'compliant');
  const mobile = evaluate('mobile-web');
  assert.equal(mobile.classification, 'violation');
  assert.equal(mobile.focusNodeId, '22:10');
  const manifest = evaluatePredicatePilotRequest(
    platformComponentRequest(CORPORATE_APP_HEADER_DESKTOP_KEY, '[D] Header', 'mobile-web'),
    { designSystemRoot },
  ).rules.find((item) => item.ruleId === ruleId);
  assert.equal(manifest.presentation.targetFact, undefined);
  assert.equal(manifest.presentation.causalRole, 'platform-root');
});

test('CorporateAppHeaderNew platform rule ignores standalone internal families', () => {
  const ruleId = 'component:web-corp.corporate-app-header-new.desktop-only';
  const evaluation = evaluatePredicatePilotRequest(
    platformComponentRequest(
      CORPORATE_APP_HEADER_ICON_BUTTON_KEY,
      'FAIL · IconButton',
      'mobile-web',
    ),
    { designSystemRoot },
  ).result.evaluations.find((item) => item.ruleId === ruleId);

  assert.equal(evaluation.classification, 'not-applicable');
});

function filterCompanySelectRequest({
  componentKey = FILTER_COMPANY_SELECT_SINGLE_KEY,
  platform = 'desktop',
  showFirstCompany = 'False',
  radius = 12,
  baselineRadius = null,
  overridden = false,
} = {}) {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  const properties = componentKey === FILTER_COMPANY_SELECT_SINGLE_KEY
    ? { View: 'Select', ShowFirstCompany: showFirstCompany }
    : {};
  const root = evidenceNode({
    nodeId: 'c21:0',
    path: 'C21 / [D] FilterCompanySelect_Single',
    name: componentKey === FILTER_COMPANY_SELECT_SINGLE_KEY
      ? '[D] FilterCompanySelect_Single'
      : '[D] CompactTag',
    component: component(componentKey, 'FilterCompanySelect fixture', properties),
    appearance: {
      opacity: 1,
      radius,
    },
  });
  if (overridden) {
    root.component.directOverrides = [{
      nodeId: 'c21:0',
      fields: ['cornerRadius'],
    }];
  }
  input.evidenceBundle.reportId = 'filter-company-select:evidence';
  input.evidenceBundle.sourceReportId = 'filter-company-select';
  input.evidenceBundle.context.platform = platform;
  input.evidenceBundle.context.channel = platform === 'desktop' ? 'Desktop' : 'Mobile Web';
  input.evidenceBundle.context.viewportWidth = platform === 'desktop' ? 1440 : 390;
  input.evidenceBundle.context.selectionNodeIds = ['c21:0'];
  input.evidenceBundle.graph.nodes = [root];
  input.evidenceBundle.graph.relations = [];
  input.evidenceBundle.changes = baselineRadius === null ? [] : [{
    id: 'change-filter-company-select-radius',
    nodeId: 'c21:0',
    nodeName: '[D] FilterCompanySelect_Single',
    nodePath: 'C21 / [D] FilterCompanySelect_Single',
    property: 'appearance.radius',
    kind: 'radius',
    ownerComponentKey: FILTER_COMPANY_SELECT_SINGLE_KEY,
    baselineReferenceId: 'baseline-filter-company-select-radius',
    baseline: {
      value: baselineRadius,
      resourceType: null,
      resourceName: null,
      bindingName: null,
      bindingCollection: null,
    },
    actual: {
      value: radius,
      resourceType: null,
      resourceName: null,
      bindingName: null,
      bindingCollection: null,
    },
    bindingStatus: null,
    mapping: {
      method: 'apollo-effective-baseline-diff',
      quality: 'exact',
      referenceOrigin: 'host',
      nestedOwnerRelativePath: '',
    },
    candidateRuleIds: [
      'component:web-corp.filter-company-select.root-visuals-follow-effective-baseline',
    ],
  }];
  input.evidenceBundle.coverage.visibleNodeCount = 1;
  input.evidenceBundle.coverage.componentNodeCount = 1;
  input.evidenceBundle.coverage.baselineChangeCount = input.evidenceBundle.changes.length;
  return input;
}

test('C21 executes FilterCompanySelect public-root, platform, legacy property and root baseline rules', () => {
  const evaluate = (options = {}) => evaluatePredicatePilotRequest(
    filterCompanySelectRequest(options),
    { designSystemRoot },
  );
  const find = (output, ruleId) => output.result.evaluations.find(
    (item) => item.ruleId === ruleId,
  );
  const publicRootRule = 'component:web-corp.filter-company-select.public-roots-only';
  const platformRule = 'component:web-corp.filter-company-select.desktop-only';
  const legacyRule = 'component:web-corp.filter-company-select.show-first-company-forbidden';
  const radiusRule = 'component:web-corp.filter-company-select.root-visuals-follow-effective-baseline.radius';

  const pass = evaluate();
  assert.equal(find(pass, publicRootRule).classification, 'compliant');
  assert.equal(find(pass, platformRule).classification, 'compliant');
  assert.equal(find(pass, legacyRule).classification, 'compliant');
  assert.equal(find(pass, radiusRule).classification, 'compliant');

  const internalRoot = evaluate({ componentKey: FILTER_COMPANY_SELECT_INTERNAL_KEY });
  assert.equal(find(internalRoot, publicRootRule).classification, 'violation');
  assert.equal(find(internalRoot, publicRootRule).focusNodeId, 'c21:0');

  const mobileWeb = evaluate({ platform: 'mobile-web' });
  assert.equal(find(mobileWeb, platformRule).classification, 'violation');
  assert.equal(find(mobileWeb, platformRule).trace.actual, 'mobile-web');

  const legacyEnabled = evaluate({ showFirstCompany: 'True' });
  assert.equal(find(legacyEnabled, legacyRule).classification, 'violation');
  assert.equal(find(legacyEnabled, legacyRule).trace.actual, 'True');

  const changedRadius = evaluate({
    radius: 20,
    baselineRadius: 12,
    overridden: true,
  });
  assert.equal(find(changedRadius, radiusRule).classification, 'violation');
  assert.equal(find(changedRadius, radiusRule).trace.actual, 20);
  assert.equal(find(changedRadius, radiusRule).trace.expected, 12);
  assert.equal(changedRadius.result.coverage.unclassified, 0);
  assert.equal(changedRadius.repeatability.stable, true);
});

function accountSelectUniformListRequest(types, { platform = 'desktop', unknownIndex = -1 } = {}) {
  const publicOwner = {
    nodeId: '23:0',
    componentKey: ACCOUNT_SELECT_PUBLIC_ROOT_KEY,
    name: '[D] AccountOptionListContent',
    path: '[D] AccountOptionListContent',
    relativePath: '',
    variantProperties: {},
    componentProperties: {},
  };
  const rows = types.map((type, index) => {
    const componentKey = type === 'Number'
      ? ACCOUNT_SELECT_NUMBER_ITEM_KEY
      : type === 'Sum'
        ? ACCOUNT_SELECT_SUM_ITEM_KEY
        : ACCOUNT_SELECT_INTERNAL_ITEM_KEY;
    return evidenceNode({
      nodeId: `23:${index + 1}`,
      parentNodeId: '23:0',
      childOrder: index,
      depth: 1,
      path: `[D] AccountOptionListContent / AccountItem ${index + 1}`,
      name: 'AccountItem',
      component: component(
        componentKey,
        'AccountItem',
        index === unknownIndex ? {} : { Type: type },
      ),
      componentOwner: publicOwner,
    });
  });
  return {
    evidenceBundle: {
      schemaVersion: 2,
      documentType: 'apollo-audit-evidence-bundle',
      reportId: 'account-select-uniform-list:evidence',
      sourceReportId: 'account-select-uniform-list',
      generatedAt: '2026-08-25T12:00:00.000Z',
      context: {
        fileKey: 'figma-file-key',
        pageId: '0:1',
        platform,
        channel: platform === 'desktop' ? 'Desktop' : platform,
        pageType: null,
        viewportWidth: platform === 'desktop' ? 1440 : 390,
        selectionNodeIds: ['23:0'],
      },
      graph: {
        nodes: [
          evidenceNode({
            nodeId: '23:0',
            childNodeIds: rows.map((row) => row.nodeId),
            path: 'P23 / [D] AccountOptionListContent',
            name: '[D] AccountOptionListContent',
            component: component(
              ACCOUNT_SELECT_PUBLIC_ROOT_KEY,
              '[D] AccountOptionListContent',
              {},
            ),
          }),
          ...rows,
        ],
        relations: [],
      },
      baselines: [],
      changes: [],
      ruleCandidates: [],
      coverage: {
        visibleNodeCount: rows.length + 1,
        excludedHiddenNodeCount: 0,
        excludedDecorativeNodeCount: 0,
        componentNodeCount: rows.length + 1,
        textNodeCount: 0,
        baselineChangeCount: 0,
        limitations: [],
      },
    },
  };
}

test('P23 compiles AccountSelect row Type collection from requested rules.json', () => {
  const ruleId = 'component:web-corp.account-select.list-content-is-uniform';
  const evaluate = (types, options) => {
    const output = evaluatePredicatePilotRequest(
      accountSelectUniformListRequest(types, options),
      { designSystemRoot },
    );
    return {
      output,
      evaluation: output.result.evaluations.find((item) => item.ruleId === ruleId),
      manifest: output.rules.find((item) => item.ruleId === ruleId),
    };
  };

  assert.equal(evaluate(['Sum', 'Sum']).evaluation.classification, 'compliant');

  const mixed = evaluate(['Sum', 'Number']);
  assert.equal(mixed.evaluation.classification, 'violation');
  assert.equal(mixed.evaluation.focusNodeId, '23:0');
  assert.equal(mixed.evaluation.trace.children[2].predicate, 'all-equal');
  assert.deepEqual(mixed.evaluation.trace.children[2].actual, ['Sum', 'Number']);
  assert.deepEqual(mixed.manifest.presentation, {
    schemaVersion: 'apollo.predicate-presentation.v1',
    title: 'Строки AccountSelect используют разные или недопустимые типы',
    observed: 'В AccountSelect обнаружены значения AccountItem.Type: {{actual}}.',
    expectation: 'В списке должна быть хотя бы одна строка; все строки используют одинаковый Type=Sum или Type=Number.',
    action: 'Выбрать для всех строк один допустимый Type: Sum или Number.',
    targetFact: 'component.properties.Type',
  });

  assert.equal(evaluate(['SwapMe']).evaluation.classification, 'violation');
  assert.equal(
    evaluate(['Sum', 'Sum'], { unknownIndex: 1 }).evaluation.classification,
    'not-evaluable',
  );
  assert.equal(
    evaluate(['Sum'], { platform: 'ios' }).evaluation.classification,
    'not-applicable',
  );
});

function accountSelectRowBaselineRequest({ radius = 12, baselineRadius = null } = {}) {
  const input = accountSelectUniformListRequest(['Sum']);
  const row = input.evidenceBundle.graph.nodes.find((node) => node.nodeId === '23:1');
  row.appearance = {
    opacity: 1,
    radius,
  };
  if (baselineRadius !== null) {
    row.component.directOverrides = [{
      nodeId: row.nodeId,
      fields: ['cornerRadius'],
    }];
    input.evidenceBundle.changes = [{
      id: 'change-account-select-row-radius',
      nodeId: row.nodeId,
      nodeName: row.name,
      nodePath: row.path,
      property: 'appearance.radius',
      kind: 'radius',
      ownerComponentKey: ACCOUNT_SELECT_PUBLIC_ROOT_KEY,
      baselineReferenceId: 'baseline-account-select-row-radius',
      baseline: {
        value: baselineRadius,
        resourceType: null,
        resourceName: null,
        bindingName: null,
        bindingCollection: null,
      },
      actual: {
        value: radius,
        resourceType: null,
        resourceName: null,
        bindingName: null,
        bindingCollection: null,
      },
      bindingStatus: null,
      mapping: {
        method: 'apollo-effective-baseline-diff',
        quality: 'exact',
        referenceOrigin: 'host',
        nestedOwnerRelativePath: 'AccountItem',
      },
      candidateRuleIds: [
        'component:web-corp.account-select.row-visuals-follow-effective-baseline',
      ],
    }];
    input.evidenceBundle.coverage.baselineChangeCount = 1;
  }
  return input;
}

test('C22 applies the generic baseline-set contour to the exact AccountItem row', () => {
  const ruleId = 'component:web-corp.account-select.row-visuals-follow-effective-baseline.radius';
  const evaluate = (options = {}) => evaluatePredicatePilotRequest(
    accountSelectRowBaselineRequest(options),
    { designSystemRoot },
  );
  const find = (output) => output.result.evaluations.find(
    (item) => item.ruleId === ruleId,
  );

  assert.equal(find(evaluate()).classification, 'compliant');

  const fail = evaluate({ radius: 20, baselineRadius: 12 });
  const violation = find(fail);
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '23:1');
  assert.equal(violation.trace.actual, 20);
  assert.equal(violation.trace.expected, 12);
  assert.equal(fail.result.coverage.unclassified, 0);
  assert.equal(fail.repeatability.stable, true);
});

function iconViewBoundaryRequest({
  componentKey = ICON_VIEW_KEY,
  componentName = 'IconView',
  radius = 4,
  baselineRadius = null,
  unknownRadius = false,
  hostedByTitleView = false,
} = {}) {
  const changed = baselineRadius !== null;
  const owner = {
    nodeId: 'c23:host',
    componentKey: TITLE_VIEW_KEY,
    name: '[D] TitleView',
    path: '[D] TitleView',
    relativePath: '',
    variantProperties: { View: 'xLarge' },
    componentProperties: { View: 'xLarge' },
  };
  const iconNode = evidenceNode({
    nodeId: 'c23:0',
    parentNodeId: hostedByTitleView ? owner.nodeId : null,
    depth: hostedByTitleView ? 1 : 0,
    path: hostedByTitleView
      ? `[D] TitleView / ${componentName}`
      : `C23 / ${componentName}`,
    name: componentName,
    appearance: {
      opacity: 1,
      radius,
    },
    component: Object.assign(component(componentKey, componentName, {
      Size: '48',
    }), {
      directOverrides: changed || unknownRadius
        ? [{ nodeId: 'c23:0', fields: ['cornerRadius'] }]
        : [],
    }),
    componentOwner: hostedByTitleView ? owner : null,
  });
  const graphNodes = hostedByTitleView
    ? [
      evidenceNode({
        nodeId: owner.nodeId,
        childNodeIds: ['c23:0'],
        path: owner.path,
        name: owner.name,
        component: component(
          TITLE_VIEW_KEY,
          owner.name,
          owner.componentProperties,
        ),
      }),
      iconNode,
    ]
    : [iconNode];
  return {
    collectionErrors: unknownRadius
      ? [{ nodeId: 'c23:0', factPath: 'appearance.radius' }]
      : [],
    evidenceBundle: {
      schemaVersion: 2,
      documentType: 'apollo-audit-evidence-bundle',
      reportId: 'icon-view-boundary:evidence',
      sourceReportId: 'icon-view-boundary',
      generatedAt: '2026-08-27T18:00:00.000Z',
      context: {
        fileKey: 'figma-file-key',
        pageId: '0:1',
        platform: 'desktop',
        channel: 'Desktop',
        pageType: null,
        viewportWidth: 1440,
        selectionNodeIds: [hostedByTitleView ? owner.nodeId : 'c23:0'],
      },
      graph: {
        nodes: graphNodes,
        relations: [],
      },
      baselines: [],
      changes: changed ? [{
        id: 'change-icon-view-radius',
        nodeId: 'c23:0',
        nodeName: componentName,
        nodePath: `C23 / ${componentName}`,
        property: 'appearance.radius',
        kind: 'radius',
        ownerComponentKey: componentKey,
        baselineReferenceId: 'baseline-icon-view-radius',
        baseline: {
          value: baselineRadius,
          resourceType: null,
          resourceName: null,
          bindingName: null,
          bindingCollection: null,
        },
        actual: {
          value: radius,
          resourceType: null,
          resourceName: null,
          bindingName: null,
          bindingCollection: null,
        },
        bindingStatus: null,
        mapping: {
          method: 'apollo-effective-baseline-diff',
          quality: 'exact',
          referenceOrigin: 'component',
          nestedOwnerRelativePath: '',
        },
        candidateRuleIds: [
          'component:web-core.icon-view.layer-properties-use-effective-baseline',
        ],
      }] : [],
      ruleCandidates: [],
      coverage: {
        visibleNodeCount: graphNodes.length,
        excludedHiddenNodeCount: 0,
        excludedDecorativeNodeCount: 0,
        componentNodeCount: graphNodes.length,
        textNodeCount: 0,
        baselineChangeCount: changed ? 1 : 0,
        limitations: [],
      },
    },
  };
}

test('C23 evaluates the reusable IconView public boundary and effective baseline', () => {
  const evaluate = (options = {}) => evaluatePredicatePilotRequest(
    iconViewBoundaryRequest(options),
    { designSystemRoot },
  );
  const publicRootRule = 'component:web-core.icon-view.public-root-only';
  const radiusRule = 'component:web-core.icon-view.layer-properties-use-effective-baseline.radius';
  const find = (output, ruleId) => output.result.evaluations.find(
    (item) => item.ruleId === ruleId,
  );

  const pass = evaluate();
  assert.equal(find(pass, publicRootRule).classification, 'compliant');
  assert.equal(find(pass, radiusRule).classification, 'compliant');

  const internalRoot = evaluate({
    componentKey: ICON_VIEW_CONTENT_KEY,
    componentName: 'Content',
  });
  assert.equal(find(internalRoot, publicRootRule).classification, 'violation');
  assert.equal(find(internalRoot, publicRootRule).focusNodeId, 'c23:0');

  const hostedInternalRoot = evaluate({
    componentKey: ICON_VIEW_CONTENT_KEY,
    componentName: 'Content',
    hostedByTitleView: true,
  });
  assert.equal(
    find(hostedInternalRoot, publicRootRule).classification,
    'not-applicable',
  );

  const changedRadius = evaluate({ radius: 8, baselineRadius: 4 });
  const violation = find(changedRadius, radiusRule);
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, 'c23:0');
  assert.equal(violation.trace.actual, 8);
  assert.equal(violation.trace.expected, 4);
  assert.equal(changedRadius.result.coverage.unclassified, 0);
  assert.equal(changedRadius.repeatability.stable, true);

  assert.equal(
    find(evaluate({ unknownRadius: true }), radiusRule).classification,
    'not-evaluable',
  );
});

function cardSwiperBreakpointRequest({
  viewportWidth = 390,
  screenSize = '360+',
  platform = 'mobile-web',
  unknownViewport = false,
} = {}) {
  const componentKey = screenSize === '320-360'
    ? CARD_SWIPER_MOBILE_320_KEY
    : CARD_SWIPER_MOBILE_360_KEY;
  return {
    evidenceBundle: {
      schemaVersion: 2,
      documentType: 'apollo-audit-evidence-bundle',
      reportId: 'card-swiper-breakpoint:evidence',
      sourceReportId: 'card-swiper-breakpoint',
      generatedAt: '2026-08-25T12:00:00.000Z',
      context: {
        fileKey: 'figma-file-key',
        pageId: '0:1',
        platform,
        channel: platform,
        pageType: null,
        viewportWidth: unknownViewport ? null : viewportWidth,
        selectionNodeIds: ['24:0'],
      },
      graph: {
        nodes: [evidenceNode({
          nodeId: '24:0',
          path: 'P24 / CardSwiperMobile',
          name: 'CardSwiperMobile',
          component: component(componentKey, 'CardSwiperMobile', {
            'Screen Size': screenSize,
          }),
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

test('P24 compiles CardSwiperMobile viewport ranges from requested rules.json', () => {
  const ruleId = 'component:web-corp.card-swiper-mobile.screen-size-follows-viewport';
  const evaluate = (options) => {
    const output = evaluatePredicatePilotRequest(cardSwiperBreakpointRequest(options), {
      designSystemRoot,
    });
    return {
      output,
      evaluation: output.result.evaluations.find((item) => item.ruleId === ruleId),
      manifest: output.rules.find((item) => item.ruleId === ruleId),
    };
  };

  assert.equal(evaluate({ viewportWidth: 340, screenSize: '320-360' }).evaluation.classification, 'compliant');
  assert.equal(evaluate({ viewportWidth: 390, screenSize: '360+' }).evaluation.classification, 'compliant');

  const wrongNarrow = evaluate({ viewportWidth: 340, screenSize: '360+' });
  assert.equal(wrongNarrow.evaluation.classification, 'violation');
  assert.equal(wrongNarrow.evaluation.focusNodeId, '24:0');
  assert.equal(wrongNarrow.evaluation.trace.predicate, 'any');
  assert.deepEqual(wrongNarrow.manifest.presentation, {
    schemaVersion: 'apollo.predicate-presentation.v1',
    title: 'Screen Size не соответствует ширине страницы',
    observed: 'При ширине {{context}} px выбран Screen Size={{actual}}.',
    expectation: 'При ширине 320–359 px используется Screen Size=320-360; при ширине от 360 px — Screen Size=360+.',
    action: 'Выбрать Screen Size, соответствующий ширине страницы.',
    contextFact: 'page.context.viewportWidth',
    targetFact: 'component.properties.Screen Size',
  });

  assert.equal(
    evaluate({ viewportWidth: 390, screenSize: '320-360' }).evaluation.classification,
    'violation',
  );
  assert.equal(
    evaluate({ unknownViewport: true, screenSize: '360+' }).evaluation.classification,
    'not-evaluable',
  );
  assert.equal(
    evaluate({ viewportWidth: 390, screenSize: '360+', platform: 'desktop' }).evaluation.classification,
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

function statusNestedFillRequest({
  presetKey = STATUS_PRESET_KEY,
  presetName = '[D] StatusPreset',
  presetFamilyColor = null,
  statusKey = CORE_STATUS_ROUNDED_KEY,
  shape = 'Rounded',
  actualFill = 'text/info',
  baselineFill = 'static_text_inverted/primary',
} = {}) {
  const input = statusShapeRequest({
    presetKey,
    presetName,
    statusKey,
    shape,
  });
  const presetProperties = presetFamilyColor
    ? { Size: '24', Color: presetFamilyColor }
    : { Type: 'Approved', Style: 'Contrast', Size: '20' };
  const statusSize = presetProperties.Size;
  const changed = actualFill !== baselineFill;
  const preset = input.evidenceBundle.graph.nodes[0];
  const status = input.evidenceBundle.graph.nodes[1];
  preset.component.variantProperties = presetProperties;
  preset.component.componentProperties = presetProperties;
  preset.childNodeIds = ['22:1'];
  status.childNodeIds = ['22:2'];
  status.componentOwner.variantProperties = presetProperties;
  status.componentOwner.componentProperties = presetProperties;
  status.component.variantProperties.Size = statusSize;
  status.component.componentProperties.Size = statusSize;
  status.component.directOverrides = changed
    ? [{ nodeId: '22:2', fields: ['fills'] }]
    : [];
  input.evidenceBundle.graph.nodes.push(evidenceNode({
    nodeId: '22:2',
    parentNodeId: '22:1',
    childOrder: 0,
    depth: 2,
    path: `P22 / ${presetName} / Status / Label`,
    name: 'Label',
    type: 'TEXT',
    component: null,
    componentOwner: {
      nodeId: '22:1',
      componentKey: statusKey,
      name: 'Status',
      path: `P22 / ${presetName} / Status`,
      relativePath: 'Label',
      variantProperties: { Size: statusSize, Shape: shape },
      componentProperties: { Size: statusSize, Shape: shape },
    },
    text: { characters: 'Готово', length: 6, textStyleId: 'status-label' },
    appearance: {
      opacity: 1,
      radius: 0,
      fill: {
        value: actualFill,
        resourceType: 'token',
        resourceId: 'status-label-actual',
        resourceName: actualFill,
        bindingName: actualFill,
        bindingCollection: 'Interface Dynamic',
        styleId: null,
        visible: true,
        paintCount: 1,
        paintTypes: ['SOLID'],
      },
    },
  }));
  input.evidenceBundle.baselines = changed ? [{
    id: 'baseline-status-label-fill',
    componentKey: presetKey,
    nestedOwnerComponentKey: statusKey,
    nestedOwnerRelativePath: 'Status/Label',
    variantProperties: presetProperties,
  }] : [];
  input.evidenceBundle.changes = changed ? [{
    id: 'change-status-label-fill',
    nodeId: '22:2',
    nodeName: 'Label',
    nodePath: `P22 / ${presetName} / Status / Label`,
    property: 'fill',
    kind: 'paint',
    ownerComponentKey: statusKey,
    baselineReferenceId: 'baseline-status-label-fill',
    baseline: {
      value: baselineFill,
      resourceType: 'token',
      resourceName: baselineFill,
      bindingName: baselineFill,
      bindingCollection: 'Interface Static',
    },
    actual: {
      value: actualFill,
      resourceType: 'token',
      resourceName: actualFill,
      bindingName: actualFill,
      bindingCollection: 'Interface Dynamic',
    },
    bindingStatus: 'different-binding',
    mapping: {
      method: 'apollo-effective-baseline-diff',
      quality: 'exact',
      referenceOrigin: 'host',
      nestedOwnerRelativePath: 'Status/Label',
    },
    candidateRuleIds: [
      'component:web-corp.status-property.fill-follows-effective-baseline',
    ],
  }] : [];
  input.evidenceBundle.coverage.visibleNodeCount = 3;
  input.evidenceBundle.coverage.componentNodeCount = 2;
  input.evidenceBundle.coverage.textNodeCount = 1;
  input.evidenceBundle.coverage.baselineChangeCount = changed ? 1 : 0;
  return input;
}

test('StatusPreset nested Status fill follows baseline with exact focus and Custom exception', () => {
  const ruleId = 'component:web-corp.status-property.fill-follows-effective-baseline.fill';
  const passed = evaluatePredicatePilotRequest(statusNestedFillRequest({
    actualFill: 'static_text_inverted/primary',
  }), { designSystemRoot });
  assert.equal(
    passed.result.evaluations.find((item) => item.ruleId === ruleId).classification,
    'compliant',
  );

  const failed = evaluatePredicatePilotRequest(statusNestedFillRequest(), { designSystemRoot });
  const violation = failed.result.evaluations.find((item) => (
    item.ruleId === ruleId && item.classification === 'violation'
  ));
  assert.ok(violation);
  assert.equal(violation.focusNodeId, '22:2');
  assert.equal(violation.subjectNodeName, 'Label');
  assert.equal(violation.focusNodeName, 'Label');
  const baselineTrace = violation.trace;
  assert.equal(baselineTrace.predicate, 'matches-effective-baseline');
  assert.equal(baselineTrace.actual, 'text/info');
  assert.equal(baselineTrace.expected, 'static_text_inverted/primary');

  const customProperty = evaluatePredicatePilotRequest(statusNestedFillRequest({
    presetKey: PROPERTY_PRESET_KEY,
    presetName: '[D] PropertyPreset',
    presetFamilyColor: 'Custom',
    statusKey: CORE_STATUS_RECTANGULAR_KEY,
    shape: 'Rectangular',
  }), { designSystemRoot });
  assert.equal(
    customProperty.result.evaluations.some((item) => (
      item.ruleId === ruleId && item.classification === 'violation'
    )),
    false,
  );
});

function benefitsRequest(capacity, cardCount, platform = 'desktop', cardPropertyOverrides = {}) {
  const cardIds = Array.from({ length: cardCount }, (_, index) => `10:${index + 1}`);
  return {
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
  assert.equal(passEvaluation.trace.children[0].children[0].actual, 3);
  assert.equal(passEvaluation.trace.children[0].children[1].actual, 3);

  const fail = evaluatePredicatePilotRequest(benefitsRequest(4, 3), { designSystemRoot });
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'component:web.benefits.capacity-matches-card-count'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '10:0');
  assert.equal(violation.trace.children[1].children[1].actual, 3);
  assert.equal(violation.trace.children[1].children[1].expected, 4);

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

function benefitsSizingRequest(
  sizingHorizontal,
  sizingVertical,
  platform = 'desktop',
) {
  const output = benefitsRequest(3, 3, platform);
  const root = output.evidenceBundle.graph.nodes[0];
  root.layout = Object.assign({}, root.layout, {
    sizingHorizontal,
    sizingVertical,
  });
  if (sizingHorizontal === undefined) {
    delete root.layout.sizingHorizontal;
    root.unknownFacts = ['layout.sizingHorizontal'];
  }
  if (sizingVertical === undefined) {
    delete root.layout.sizingVertical;
    root.unknownFacts = [
      ...(root.unknownFacts || []),
      'layout.sizingVertical',
    ];
  }
  return output;
}

test('P25 compiles Benefits root sizing from requested rules.json', () => {
  const ruleId = 'component:web.benefits.fill-width-hug-height';
  const evaluate = (horizontal, vertical, platform = 'desktop') => {
    const output = evaluatePredicatePilotRequest(
      benefitsSizingRequest(horizontal, vertical, platform),
      { designSystemRoot },
    );
    return {
      evaluation: output.result.evaluations.find((item) => item.ruleId === ruleId),
      manifest: output.rules.find((item) => item.ruleId === ruleId),
    };
  };

  const pass = evaluate('FILL', 'HUG');
  assert.equal(pass.evaluation.classification, 'compliant');
  assert.equal(pass.evaluation.focusNodeId, '10:0');

  const wrongHorizontal = evaluate('HUG', 'HUG');
  assert.equal(wrongHorizontal.evaluation.classification, 'violation');
  assert.equal(wrongHorizontal.evaluation.focusNodeId, '10:0');
  assert.equal(wrongHorizontal.evaluation.trace.children[0].actual, 'HUG');
  assert.equal(wrongHorizontal.evaluation.trace.children[0].expected, 'FILL');

  const wrongVertical = evaluate('FILL', 'FILL');
  assert.equal(wrongVertical.evaluation.classification, 'violation');
  assert.equal(wrongVertical.evaluation.trace.children[1].actual, 'FILL');
  assert.equal(wrongVertical.evaluation.trace.children[1].expected, 'HUG');

  assert.equal(evaluate(undefined, 'HUG').evaluation.classification, 'not-evaluable');
  assert.equal(evaluate('FILL', 'HUG', 'ios').evaluation.classification, 'not-applicable');
  assert.deepEqual(wrongHorizontal.manifest.presentation, {
    schemaVersion: 'apollo.predicate-presentation.v1',
    title: 'Sizing компонента Benefits изменён',
    observed: 'Размер корня Benefits не соответствует контракту Fill по ширине и Hug по высоте.',
    expectation: 'Корень Benefits должен использовать Fill container по ширине и Hug contents по высоте.',
    action: 'Установить для Benefits ширину Fill и высоту Hug.',
  });
});

test('C02 reuses the generic sizing contour for ButtonsGroup HUG/HUG', () => {
  const ruleId = 'component:web-corp.buttons-group.root-sizing-is-hug-hug';
  const evaluate = (horizontal, vertical) => {
    const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
    input.evidenceBundle.graph.nodes[0].layout.sizingHorizontal = horizontal;
    input.evidenceBundle.graph.nodes[0].layout.sizingVertical = vertical;
    return evaluatePredicatePilotRequest(input, { designSystemRoot });
  };

  const pass = evaluate('HUG', 'HUG');
  const passEvaluation = pass.result.evaluations.find((item) => item.ruleId === ruleId);
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '1:0');

  const fail = evaluate('FILL', 'HUG');
  const failEvaluation = fail.result.evaluations.find((item) => item.ruleId === ruleId);
  assert.equal(failEvaluation.classification, 'violation');
  assert.equal(failEvaluation.focusNodeId, '1:0');
  assert.equal(failEvaluation.trace.children[0].actual, 'FILL');
  assert.equal(failEvaluation.trace.children[0].expected, 'HUG');
  assert.equal(fail.result.coverage.unclassified, 0);
  assert.equal(fail.repeatability.stable, true);
});

function titleViewOpacityRequest({
  actual = 1,
  baseline = null,
  overridden = false,
  platform = 'desktop',
} = {}) {
  const output = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  const root = evidenceNode({
    nodeId: '26:0',
    path: '[D] TitleView',
    name: '[D] TitleView',
    component: component(TITLE_VIEW_KEY, '[D] TitleView', { View: 'xLarge' }),
    appearance: {
      opacity: actual,
      radius: 0,
    },
  });
  if (overridden) {
    root.component.directOverrides = [{
      nodeId: '26:0',
      fields: ['opacity'],
    }];
  }
  output.evidenceBundle.reportId = 'title-view-opacity:evidence';
  output.evidenceBundle.sourceReportId = 'title-view-opacity';
  output.evidenceBundle.context.platform = platform;
  output.evidenceBundle.context.selectionNodeIds = ['26:0'];
  output.evidenceBundle.graph.nodes = [root];
  output.evidenceBundle.changes = baseline === null ? [] : [{
    id: 'change-title-view-opacity',
    nodeId: '26:0',
    nodeName: '[D] TitleView',
    nodePath: '[D] TitleView',
    property: 'appearance.opacity',
    kind: 'opacity',
    ownerComponentKey: TITLE_VIEW_KEY,
    baselineReferenceId: 'baseline-title-view-opacity',
    baseline: {
      value: baseline,
      resourceType: null,
      resourceName: null,
      bindingName: null,
      bindingCollection: null,
    },
    actual: {
      value: actual,
      resourceType: null,
      resourceName: null,
      bindingName: null,
      bindingCollection: null,
    },
    bindingStatus: null,
    mapping: {
      method: 'apollo-effective-baseline-diff',
      quality: 'exact',
      referenceOrigin: 'host',
      nestedOwnerRelativePath: '',
    },
    candidateRuleIds: [
      'component:web-corp.title-view.root-style-and-clickability-prohibited',
    ],
  }];
  output.evidenceBundle.coverage.visibleNodeCount = 1;
  output.evidenceBundle.coverage.componentNodeCount = 1;
  output.evidenceBundle.coverage.baselineChangeCount = output.evidenceBundle.changes.length;
  return output;
}

test('P26 compiles TitleView root opacity baseline from requested rules.json', () => {
  const ruleId = 'component:web-corp.title-view.root-style-and-clickability-prohibited.opacity';
  const evaluate = (input) => {
    const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
    return {
      evaluation: output.result.evaluations.find((item) => item.ruleId === ruleId),
      manifest: output.rules.find((item) => item.ruleId === ruleId),
    };
  };

  const pass = evaluate(titleViewOpacityRequest());
  assert.equal(pass.evaluation.classification, 'compliant');
  assert.equal(pass.evaluation.focusNodeId, '26:0');

  const fail = evaluate(titleViewOpacityRequest({
    actual: 0.5,
    baseline: 1,
    overridden: true,
  }));
  assert.equal(fail.evaluation.classification, 'violation');
  assert.equal(fail.evaluation.focusNodeId, '26:0');
  assert.equal(fail.evaluation.trace.actual, 0.5);
  assert.equal(fail.evaluation.trace.expected, 1);

  const unknown = evaluate(titleViewOpacityRequest({
    actual: 0.5,
    overridden: true,
  }));
  assert.equal(unknown.evaluation.classification, 'not-evaluable');

  const notApplicable = evaluate(titleViewOpacityRequest({ platform: 'ios' }));
  assert.equal(notApplicable.evaluation.classification, 'not-applicable');
  assert.deepEqual(fail.manifest.presentation, {
    schemaVersion: 'apollo.predicate-presentation.v1',
    title: 'Изменено оформление корня TitleView: Прозрачность',
    observed: 'Свойство «Прозрачность» изменено с {{expected}} на {{actual}}.',
    expectation: 'Свойство «Прозрачность» корня TitleView должно совпадать с effective baseline выбранного варианта.',
    action: 'Сбросить свойство «Прозрачность» корня TitleView к effective baseline.',
    targetFact: 'appearance.opacity',
  });
});

function backgroundPlateRadiusRequest({
  actual = 16,
  baseline = null,
  overridden = false,
  platform = 'desktop',
} = {}) {
  const output = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  const root = evidenceNode({
    nodeId: 'c03:0',
    path: '[D] BackgroundPlateSlot',
    name: '[D] BackgroundPlateSlot',
    component: component(BACKGROUND_PLATE_SLOT_KEY, '[D] BackgroundPlateSlot', {
      Type: 'Primary',
    }),
    appearance: {
      opacity: 1,
      radius: actual,
    },
  });
  if (overridden) {
    root.component.directOverrides = [{
      nodeId: 'c03:0',
      fields: ['cornerRadius'],
    }];
  }
  output.evidenceBundle.reportId = 'background-plate-radius:evidence';
  output.evidenceBundle.sourceReportId = 'background-plate-radius';
  output.evidenceBundle.context.platform = platform;
  output.evidenceBundle.context.selectionNodeIds = ['c03:0'];
  output.evidenceBundle.graph.nodes = [root];
  output.evidenceBundle.graph.relations = [];
  output.evidenceBundle.changes = baseline === null ? [] : [{
    id: 'change-background-plate-radius',
    nodeId: 'c03:0',
    nodeName: '[D] BackgroundPlateSlot',
    nodePath: '[D] BackgroundPlateSlot',
    property: 'appearance.radius',
    kind: 'radius',
    ownerComponentKey: BACKGROUND_PLATE_SLOT_KEY,
    baselineReferenceId: 'baseline-background-plate-radius',
    baseline: {
      value: baseline,
      resourceType: null,
      resourceName: null,
      bindingName: null,
      bindingCollection: null,
    },
    actual: {
      value: actual,
      resourceType: null,
      resourceName: null,
      bindingName: null,
      bindingCollection: null,
    },
    bindingStatus: null,
    mapping: {
      method: 'apollo-effective-baseline-diff',
      quality: 'exact',
      referenceOrigin: 'host',
      nestedOwnerRelativePath: '',
    },
    candidateRuleIds: [
      'component:web-corp.background-plate.radius-is-fixed-by-component-baseline',
    ],
  }];
  output.evidenceBundle.coverage.visibleNodeCount = 1;
  output.evidenceBundle.coverage.componentNodeCount = 1;
  output.evidenceBundle.coverage.baselineChangeCount = output.evidenceBundle.changes.length;
  return output;
}

test('C03 reuses the generic baseline contour for BackgroundPlate radius', () => {
  const ruleId = 'component:web-corp.background-plate.radius-is-fixed-by-component-baseline';
  const evaluate = (input) => {
    const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
    return {
      output,
      evaluation: output.result.evaluations.find((item) => item.ruleId === ruleId),
      manifest: output.rules.find((item) => item.ruleId === ruleId),
    };
  };

  const pass = evaluate(backgroundPlateRadiusRequest());
  assert.equal(pass.evaluation.classification, 'compliant');
  assert.equal(pass.evaluation.focusNodeId, 'c03:0');

  const fail = evaluate(backgroundPlateRadiusRequest({
    actual: 24,
    baseline: 16,
    overridden: true,
  }));
  assert.equal(fail.evaluation.classification, 'violation');
  assert.equal(fail.evaluation.focusNodeId, 'c03:0');
  assert.equal(fail.evaluation.trace.children[0].actual, 24);
  assert.equal(fail.evaluation.trace.children[0].expected, 16);
  assert.equal(fail.output.result.coverage.unclassified, 0);
  assert.equal(fail.output.repeatability.stable, true);

  const unknown = evaluate(backgroundPlateRadiusRequest({
    actual: 24,
    overridden: true,
  }));
  assert.equal(unknown.evaluation.classification, 'not-evaluable');

  const notApplicable = evaluate(backgroundPlateRadiusRequest({ platform: 'ios' }));
  assert.equal(notApplicable.evaluation.classification, 'not-applicable');
  assert.deepEqual(fail.manifest.presentation, {
    schemaVersion: 'apollo.predicate-presentation.v1',
    title: 'Изменено скругление BackgroundPlate',
    observed: 'Скругление изменено с {{expected}} на {{actual}}.',
    expectation: 'Скругление BackgroundPlate должно совпадать с effective baseline выбранного варианта.',
    action: 'Сбросить скругление BackgroundPlate к effective baseline.',
    targetFact: 'appearance.radius',
  });
});

function corporateSectionGutterRequest({
  bound = true,
  completeBindingMetadata = true,
  platform = 'desktop',
} = {}) {
  const output = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  output.evidenceBundle.reportId = 'corporate-section-gutter:evidence';
  output.evidenceBundle.sourceReportId = 'corporate-section-gutter';
  output.evidenceBundle.context.platform = platform;
  output.evidenceBundle.context.selectionNodeIds = ['c04:0'];
  output.evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: 'c04:0',
    path: '[D] Section',
    name: '[D] Section',
    component: component(CORPORATE_SECTION_KEY, '[D] Section', {
      Position: 'false',
      '👽 TabletIsle': 'false',
    }),
    layout: {
      mode: 'HORIZONTAL',
      positioning: 'AUTO',
      wrap: 'NO_WRAP',
      sizingHorizontal: 'FILL',
      sizingVertical: 'HUG',
      primaryAxisAlignItems: 'MIN',
      counterAxisAlignItems: 'MIN',
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      itemSpacing: 24,
      clipsContent: false,
    },
    variableBindings: bound ? [{
      property: 'itemSpacing',
      variableIds: ['VariableID:gutter'],
      variables: completeBindingMetadata ? [{
        id: 'VariableID:gutter',
        key: 'gutter-key',
        name: 'Grid/Gutter',
        collectionId: 'collection:grid-cols',
        collectionName: 'Grid & Cols',
      }] : [],
    }] : [],
  })];
  output.evidenceBundle.graph.relations = [];
  output.evidenceBundle.changes = [];
  output.evidenceBundle.coverage.visibleNodeCount = 1;
  output.evidenceBundle.coverage.componentNodeCount = 1;
  output.evidenceBundle.coverage.baselineChangeCount = 0;
  return output;
}

test('C04 reuses the generic binding-set contour for CorporateContent Section Gutter', () => {
  const ruleId = 'component:web-corp.corporate-content.section-gutter-required.gutter';
  const evaluate = (input) => {
    const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
    return {
      output,
      evaluation: output.result.evaluations.find((item) => item.ruleId === ruleId),
      manifest: output.rules.find((item) => item.ruleId === ruleId),
    };
  };

  const pass = evaluate(corporateSectionGutterRequest());
  assert.equal(pass.evaluation.classification, 'compliant');
  assert.equal(pass.evaluation.focusNodeId, 'c04:0');

  const fail = evaluate(corporateSectionGutterRequest({ bound: false }));
  assert.equal(fail.evaluation.classification, 'violation');
  assert.equal(fail.evaluation.focusNodeId, 'c04:0');
  assert.equal(fail.evaluation.trace.children[1].actual.bound, false);
  assert.deepEqual(fail.evaluation.trace.children[1].expected, {
    bound: true,
    token: 'Grid/Gutter',
  });
  assert.equal(fail.output.result.coverage.unclassified, 0);
  assert.equal(fail.output.result.coverage.duplicateEvaluationIds, 0);
  assert.equal(fail.output.repeatability.stable, true);

  const unknown = evaluate(corporateSectionGutterRequest({
    completeBindingMetadata: false,
  }));
  assert.equal(unknown.evaluation.classification, 'not-evaluable');

  const notApplicable = evaluate(corporateSectionGutterRequest({ platform: 'ios' }));
  assert.equal(notApplicable.evaluation.classification, 'not-applicable');
  assert.deepEqual(fail.manifest.presentation, {
    schemaVersion: 'apollo.predicate-presentation.v1',
    title: 'Gutter между Content и Isle задан без переменной Gutter',
    observed: 'Gutter между Content и Isle имеет значение {{actual}} px без привязки к переменной Gutter.',
    expectation: 'Отступ между Content и Isle в [D] Section должен быть привязан к переменной Gutter.',
    action: 'Привязать текущее значение itemSpacing к переменной Gutter.',
    targetFact: 'layout.itemSpacing',
  });
});

function titleViewPageCountRequest(count, {
  unknownViewIndex = -1,
  withNestedUnresolvedComponent = false,
} = {}) {
  const output = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  const titleIds = Array.from({ length: count }, (_value, index) => `27:${index + 1}`);
  const unresolvedId = '27:unresolved';
  output.evidenceBundle.reportId = 'title-view-page-count:evidence';
  output.evidenceBundle.sourceReportId = 'title-view-page-count';
  output.evidenceBundle.context.selectionNodeIds = ['27:0'];
  output.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '27:0',
      childNodeIds: titleIds,
      path: 'P27 / Page region',
      name: 'P27 / Page region',
      type: 'FRAME',
    }),
    ...titleIds.map((nodeId, index) => {
      const properties = index === unknownViewIndex ? {} : { View: 'xLarge' };
      const title = evidenceNode({
        nodeId,
        parentNodeId: '27:0',
        childNodeIds: withNestedUnresolvedComponent && index === 0 ? [unresolvedId] : [],
        childOrder: index,
        depth: 1,
        path: `P27 / Page region / TitleView ${index + 1}`,
        name: '[D] TitleView',
        component: component(TITLE_VIEW_KEY, '[D] TitleView', properties),
      });
      return title;
    }),
    ...(withNestedUnresolvedComponent ? [evidenceNode({
      nodeId: unresolvedId,
      parentNodeId: titleIds[0],
      childOrder: 0,
      depth: 2,
      path: 'P27 / Page region / TitleView 1 / unresolved nested instance',
      name: 'Unresolved nested instance',
      component: component('unindexed-nested-key', 'Unresolved nested instance', {}),
    })] : []),
  ];
  output.collectionErrors = unknownViewIndex < 0 ? [] : [{
    nodeId: titleIds[unknownViewIndex],
    factPath: 'component.properties.View',
    reason: 'Published component property could not be collected',
  }];
  output.evidenceBundle.coverage.visibleNodeCount = count + 1 + (withNestedUnresolvedComponent ? 1 : 0);
  output.evidenceBundle.coverage.componentNodeCount = count + (withNestedUnresolvedComponent ? 1 : 0);
  return output;
}

test('P27 compiles page-wide TitleView xLarge aggregation from Markdown authority', () => {
  const ruleId = 'rule:components.title-view.single-xlarge';
  const evaluate = (input) => {
    const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
    return {
      evaluation: output.result.evaluations.find((item) => item.ruleId === ruleId),
      manifest: output.rules.find((item) => item.ruleId === ruleId),
    };
  };

  const pass = evaluate(titleViewPageCountRequest(1));
  assert.equal(pass.evaluation.classification, 'compliant');
  assert.equal(pass.evaluation.focusNodeId, '27:0');
  assert.equal(pass.evaluation.trace.actual, 1);

  const passWithNestedUnresolvedComponent = evaluate(titleViewPageCountRequest(1, {
    withNestedUnresolvedComponent: true,
  }));
  assert.equal(passWithNestedUnresolvedComponent.evaluation.classification, 'compliant');
  assert.equal(passWithNestedUnresolvedComponent.evaluation.trace.actual, 1);

  const fail = evaluate(titleViewPageCountRequest(2));
  assert.equal(fail.evaluation.classification, 'violation');
  assert.equal(fail.evaluation.focusNodeId, '27:0');
  assert.equal(fail.evaluation.trace.actual, 2);
  assert.deepEqual(fail.evaluation.trace.expected, {
    lower: 0,
    upper: 1,
    bounds: 'inclusive',
  });

  const unknown = evaluate(titleViewPageCountRequest(1, { unknownViewIndex: 0 }));
  assert.equal(unknown.evaluation.classification, 'not-evaluable');

  const notApplicable = evaluate(titleViewPageCountRequest(0));
  assert.equal(notApplicable.evaluation.classification, 'not-applicable');
  assert.equal(fail.manifest.source.path, 'design-system_ab/patterns/p_title-view.md');
  assert.deepEqual(fail.manifest.presentation, {
    schemaVersion: 'apollo.predicate-presentation.v1',
    title: 'На странице несколько главных заголовков',
    observed: 'В выбранной области найдено {{actual}} TitleView с View=xLarge.',
    expectation: 'На одной странице допускается только один TitleView с View=xLarge.',
    action: 'Оставить один TitleView xLarge; остальные перевести на следующий уровень иерархии.',
  });
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
  assert.deepEqual(violation.trace.children[1].actual, [
    'Primary',
    'Secondary',
    'Primary',
  ]);
  assert.deepEqual(violation.trace.children[4].actual, ['Top', 'Left', 'Top']);

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
  assert.deepEqual(violation.trace.expected, [1]);
  assert.equal(violation.ruleRevision, 2);

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

function tableViewRowSpacingRequest({
  sidePanel = false,
  spacingValues = [12, 12],
  columnCount = 1,
  standalone = false,
} = {}) {
  const output = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  const rootId = '11:spacing-root';
  const rowId = '11:spacing-row';
  const spacingIds = spacingValues.map((_, index) => `11:spacing-${index + 1}`);
  const columnIds = Array.from({ length: columnCount }, (_, index) => `11:data-${index + 1}`);
  const rootKey = sidePanel ? TABLE_VIEW_SIDE_PANEL_KEY : TABLE_VIEW_HORIZONTAL_KEY;
  const rowKey = sidePanel ? TABLE_VIEW_SIDE_PANEL_ROW_KEY : TABLE_VIEW_ROW_KEY;
  const rootName = sidePanel
    ? '[D] TableView :: Horizontal SidePanel'
    : '[D] TableView :: Horizontal';
  const rowName = sidePanel ? 'Row :: SidePanel' : 'Row';
  const rootProperties = sidePanel ? {} : { Compact: 'True' };
  const rowProperties = sidePanel ? { Presets: 'Body' } : {
    Presets: 'Body', Compact: 'True', Skeleton: 'False',
  };
  const rowNode = evidenceNode({
    nodeId: rowId,
    parentNodeId: standalone ? null : rootId,
    childNodeIds: [],
    childOrder: 0,
    depth: standalone ? 0 : 1,
    path: `${rootName} / ${rowName}`,
    name: rowName,
    component: component(rowKey, rowName, rowProperties),
  });
  const descendantNodes = [
    ...spacingIds.map((nodeId, index) => evidenceNode({
      nodeId,
      parentNodeId: rowId,
      childOrder: index,
      depth: standalone ? 1 : 2,
      path: `${rootName} / ${rowName} / ↕ SpacingVertical ${index + 1}`,
      name: '↕ SpacingVertical',
      component: component(
        spacingValues[index] === 12 ? SPACING_VERTICAL_12_KEY : SPACING_VERTICAL_16_KEY,
        '↕ SpacingVertical',
        { Size: String(spacingValues[index]) },
      ),
    })),
    ...columnIds.map((nodeId, index) => evidenceNode({
      nodeId,
      parentNodeId: rowId,
      childOrder: spacingIds.length + index,
      depth: standalone ? 1 : 2,
      path: `${rootName} / ${rowName} / Column ${index + 1}`,
      name: 'Column',
      component: component(TABLE_VIEW_COLUMN_KEY, 'Column', { Skeleton: 'False' }),
    })),
  ];
  output.evidenceBundle.reportId = 'table-view-spacing:evidence';
  output.evidenceBundle.sourceReportId = 'table-view-spacing';
  output.evidenceBundle.context.selectionNodeIds = [standalone ? rowId : rootId];
  output.evidenceBundle.graph.nodes = standalone ? [rowNode, ...descendantNodes] : [
    evidenceNode({
      nodeId: rootId,
      childNodeIds: [rowId],
      path: rootName,
      name: rootName,
      component: component(rootKey, rootName, rootProperties),
    }),
    rowNode,
    ...descendantNodes,
  ];
  output.evidenceBundle.graph.relations = [];
  output.evidenceBundle.coverage.visibleNodeCount = output.evidenceBundle.graph.nodes.length;
  output.evidenceBundle.coverage.componentNodeCount = output.evidenceBundle.graph.nodes.length;
  return output;
}

test('TableView row spacing evaluates every published SpacingVertical value', () => {
  const ruleId = 'component:web-corp.table-view.row-spacing-matches-compact';
  const evaluate = (spacingValues) => evaluatePredicatePilotRequest(
    tableViewRowSpacingRequest({ spacingValues }),
    { designSystemRoot },
  ).result.evaluations.find((item) => item.ruleId === ruleId);

  const pass = evaluate([12, 12]);
  assert.equal(pass.classification, 'compliant');
  assert.equal(pass.focusNodeId, '11:spacing-row');

  const fail = evaluate([12, 16]);
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '11:spacing-row');
  assert.deepEqual(fail.trace.actual, [12, 16]);
  assert.deepEqual(fail.trace.expected, [12]);
  assert.equal(fail.ruleRevision, 2);
});

test('standalone TableView Row does not receive owner-dependent row findings', () => {
  const evaluations = evaluatePredicatePilotRequest(
    tableViewRowSpacingRequest({ standalone: true, spacingValues: [16, 12] }),
    { designSystemRoot },
  ).result.evaluations;
  const violations = evaluations.filter((item) => item.classification === 'violation');

  assert.ok(violations.some((item) => (
    item.ruleId === 'component:web-corp.table-view.internal-parts-not-standalone'
  )));
  assert.ok(!violations.some((item) => (
    item.ruleId === 'component:web-corp.table-view.compact-is-consistent-across-rows' ||
    item.ruleId === 'component:web-corp.table-view.row-spacing-matches-compact'
  )));
});

test('TableView SidePanel evaluates one data column and every 12 px spacing without Compact', () => {
  const ruleId = 'component:web-corp.table-view.horizontal-sidepanel-is-single-column-compact';
  const evaluate = (spacingValues, columnCount = 1) => evaluatePredicatePilotRequest(
    tableViewRowSpacingRequest({ sidePanel: true, spacingValues, columnCount }),
    { designSystemRoot },
  ).result.evaluations.find((item) => item.ruleId === ruleId);

  const pass = evaluate([12, 12]);
  assert.equal(pass.classification, 'compliant');
  assert.equal(pass.focusNodeId, '11:spacing-row');

  const spacingFail = evaluate([12, 16]);
  assert.equal(spacingFail.classification, 'violation');
  assert.deepEqual(spacingFail.trace.children[1].actual, [12, 16]);
  assert.deepEqual(spacingFail.trace.children[1].expected, [12]);

  const columnFail = evaluate([12, 12], 2);
  assert.equal(columnFail.classification, 'violation');
  assert.equal(columnFail.trace.children[0].actual, 2);
  assert.equal(columnFail.ruleRevision, 3);
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

test('P28 focuses the shared horizontal form owner when its derived 8+4 geometry is wrong', () => {
  const pass = evaluatePredicatePilotRequest(formEightFourLayoutRequest(24), {
    designSystemRoot,
  });
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'rule:forms.construction-rules.layout-8-4'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.focusNodeId, '19:1');

  const fail = evaluatePredicatePilotRequest(formEightFourLayoutRequest(12), {
    designSystemRoot,
  });
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'rule:forms.construction-rules.layout-8-4'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '19:1');
  const gapTrace = violation.trace.children.find((child) => (
    child.predicate === 'approximately-equals' &&
    child.factPaths.length === 1 &&
    child.factPaths[0] === 'composition.formEightFourLayout.gutter'
  ));
  assert.equal(gapTrace.actual, 12);
  assert.deepEqual(gapTrace.expected, {
    value: 24,
    tolerance: 1,
    difference: 12,
  });
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

test('ButtonsGroup applies the mobile-web limit independently from desktop', () => {
  const passInput = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  passInput.evidenceBundle.context.platform = 'mobile-web';
  const pass = evaluatePredicatePilotRequest(passInput, { designSystemRoot });
  const passEvaluation = pass.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.buttons-group.button-count.mobile'
  ));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.deepEqual(passEvaluation.trace.expected, {
    lower: 2,
    upper: 2,
    bounds: 'inclusive',
  });

  const failInput = structuredClone(passInput);
  failInput.evidenceBundle.graph.nodes[0].childNodeIds.push('1:3');
  failInput.evidenceBundle.graph.nodes.push(evidenceNode({
    nodeId: '1:3',
    parentNodeId: '1:0',
    childOrder: 2,
    path: 'ButtonsGroup/Button 3',
    name: '[M] Button',
    component: component(BUTTON_KEY, '[M] Button', {
      View: 'Secondary',
      Size: '56',
      SingleIcon: 'False',
    }),
    componentOwner: failInput.evidenceBundle.graph.nodes[1].componentOwner,
  }));
  failInput.evidenceBundle.coverage.visibleNodeCount = 4;
  failInput.evidenceBundle.coverage.componentNodeCount = 4;
  const fail = evaluatePredicatePilotRequest(failInput, { designSystemRoot });
  const violation = fail.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.buttons-group.button-count.mobile'
  ));
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '1:0');
  assert.equal(violation.trace.actual, 3);
});

function titleViewSlotRequest(slotNames, platform = 'desktop') {
  const slotIds = slotNames.map((_, index) => `8:${index + 2}`);
  return {
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

function titleViewStatusDependencyRequest({
  titleStatus = true,
  status,
  view = 'xLarge',
  platform = 'desktop',
} = {}) {
  const input = titleViewSlotRequest([], platform);
  const properties = {
    View: view,
    Skeleton: 'False',
    TitleStatus: titleStatus,
  };
  if (status !== undefined) properties.Status = status;
  input.evidenceBundle.graph.nodes[0].component = component(
    TITLE_VIEW_KEY,
    '[D] TitleView',
    properties,
  );
  return input;
}

test('source-driven TitleStatus dependency requires Status=true on the same TitleView', () => {
  const ruleId = 'component:web-corp.title-view.title-status-requires-status';

  const fail = evaluatePredicatePilotRequest(
    titleViewStatusDependencyRequest({ status: false }),
    { designSystemRoot },
  );
  const violation = fail.result.evaluations.find((item) => item.ruleId === ruleId);
  assert.equal(violation.classification, 'violation');
  assert.equal(violation.subjectNodeId, '8:0');
  assert.equal(violation.focusNodeId, '8:0');
  assert.equal(violation.trace.actual, false);
  assert.deepEqual(violation.trace.expected, [true]);

  const pass = evaluatePredicatePilotRequest(
    titleViewStatusDependencyRequest({ status: true }),
    { designSystemRoot },
  );
  assert.equal(
    pass.result.evaluations.find((item) => item.ruleId === ruleId).classification,
    'compliant',
  );

  const unavailable = evaluatePredicatePilotRequest(
    titleViewStatusDependencyRequest({ status: false, view: 'Medium' }),
    { designSystemRoot },
  );
  assert.equal(
    unavailable.result.evaluations.find((item) => item.ruleId === ruleId).classification,
    'not-applicable',
  );

  const unknown = evaluatePredicatePilotRequest(
    titleViewStatusDependencyRequest({ status: undefined }),
    { designSystemRoot },
  );
  assert.equal(
    unknown.result.evaluations.find((item) => item.ruleId === ruleId).classification,
    'not-evaluable',
  );

  const disabled = evaluatePredicatePilotRequest(
    titleViewStatusDependencyRequest({ titleStatus: false, status: false }),
    { designSystemRoot },
  );
  assert.equal(
    disabled.result.evaluations.find((item) => item.ruleId === ruleId).classification,
    'not-applicable',
  );

  const outOfScope = evaluatePredicatePilotRequest(
    titleViewStatusDependencyRequest({ status: false, platform: 'ios' }),
    { designSystemRoot },
  );
  assert.equal(
    outOfScope.result.evaluations.find((item) => item.ruleId === ruleId).classification,
    'not-applicable',
  );
});

function titleViewCompositionRequest({
  statusSize = '24',
  buttons = [
    { View: 'Primary', Size: '56', SingleIcon: 'False' },
    { View: 'Secondary', Size: '56', SingleIcon: 'True' },
  ],
  platform = 'desktop',
} = {}) {
  const input = titleViewSlotRequest([], platform);
  const owner = {
    nodeId: '30:0',
    componentKey: TITLE_VIEW_KEY,
    name: '[D] TitleView',
    path: '[D] TitleView',
    relativePath: '',
    variantProperties: { View: 'xLarge' },
    componentProperties: { View: 'xLarge' },
  };
  const buttonIds = buttons.map((_, index) => `30:${index + 2}`);
  input.evidenceBundle.reportId = 'title-view-composition:evidence';
  input.evidenceBundle.sourceReportId = 'title-view-composition';
  input.evidenceBundle.context.selectionNodeIds = ['30:0'];
  input.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '30:0',
      childNodeIds: ['30:1'].concat(buttonIds),
      path: '[D] TitleView',
      name: '[D] TitleView',
      component: component(TITLE_VIEW_KEY, '[D] TitleView', { View: 'xLarge' }),
    }),
    evidenceNode({
      nodeId: '30:1',
      parentNodeId: '30:0',
      childOrder: 0,
      depth: 1,
      path: '[D] TitleView / StatusPreset',
      name: 'StatusPreset',
    component: component(
      STATUS_PRESET_KEY,
      'StatusPreset',
      statusSize === null ? {} : { Size: statusSize },
    ),
      componentOwner: owner,
    }),
    ...buttons.map((properties, index) => evidenceNode({
      nodeId: buttonIds[index],
      parentNodeId: '30:0',
      childOrder: index + 1,
      depth: 1,
      path: `[D] TitleView / [D] Button ${index + 1}`,
      name: '[D] Button',
      component: component(BUTTON_KEY, '[D] Button', properties),
      componentOwner: owner,
    })),
  ];
  input.evidenceBundle.coverage.visibleNodeCount = input.evidenceBundle.graph.nodes.length;
  input.evidenceBundle.coverage.componentNodeCount = input.evidenceBundle.graph.nodes.length;
  return input;
}

test('TitleView production composition rules preserve PASS, FAIL, UNKNOWN and exact focus', () => {
  const evaluate = (input, ruleId) => evaluatePredicatePilotRequest(
    input,
    { designSystemRoot },
  ).result.evaluations.find((item) => item.ruleId === ruleId);

  const statusRuleId = 'component:web-corp.title-view.status-size-24';
  assert.equal(
    evaluate(titleViewCompositionRequest(), statusRuleId).classification,
    'compliant',
  );
  const invalidStatus = evaluate(
    titleViewCompositionRequest({ statusSize: '20' }),
    statusRuleId,
  );
  assert.equal(invalidStatus.classification, 'violation');
  assert.equal(invalidStatus.focusNodeId, '30:1');
  assert.equal(
    evaluate(titleViewCompositionRequest({ statusSize: null }), statusRuleId).classification,
    'not-evaluable',
  );

  const invalidButtons = titleViewCompositionRequest({
    buttons: [
      { View: 'Secondary', Size: '40', SingleIcon: 'True' },
      { View: 'Primary', Size: '56', SingleIcon: 'False' },
    ],
  });
  const cases = [
    ['component:web-corp.title-view.button-size-desktop', '30:2'],
    ['component:web-corp.title-view.button-group-single-primary-action', '30:3'],
    ['component:web-corp.title-view.button-group-single-icon-position', '30:2'],
  ];
  for (const [ruleId, focusNodeId] of cases) {
    const evaluation = evaluate(invalidButtons, ruleId);
    assert.equal(evaluation.classification, 'violation');
    assert.equal(evaluation.focusNodeId, focusNodeId);
  }
});

function titleViewTextRequest({ titleLength = 1, subtitleLength = 120 } = {}) {
  const input = titleViewSlotRequest([]);
  const owner = {
    nodeId: '31:0',
    componentKey: TITLE_VIEW_KEY,
    name: '[D] TitleView',
    path: '[D] TitleView',
    relativePath: '',
    variantProperties: { View: 'xLarge' },
    componentProperties: { View: 'xLarge' },
  };
  const textNode = (nodeId, name, length, childOrder) => evidenceNode({
    nodeId,
    parentNodeId: '31:0',
    childOrder,
    depth: 1,
    path: `[D] TitleView / ${name}`,
    type: 'TEXT',
    name,
    componentOwner: owner,
    text: length === null ? null : {
      characters: 'x'.repeat(length),
      length,
      textStyleId: `${name.toLowerCase()}-style`,
    },
  });
  input.evidenceBundle.reportId = 'title-view-text:evidence';
  input.evidenceBundle.sourceReportId = 'title-view-text';
  input.evidenceBundle.context.selectionNodeIds = ['31:0'];
  input.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '31:0',
      childNodeIds: ['31:1', '31:2'],
      path: '[D] TitleView',
      name: '[D] TitleView',
      component: component(TITLE_VIEW_KEY, '[D] TitleView', { View: 'xLarge' }),
    }),
    textNode('31:1', 'Title', titleLength, 0),
    textNode('31:2', 'Subtitle', subtitleLength, 1),
  ];
  input.evidenceBundle.coverage.visibleNodeCount = 3;
  input.evidenceBundle.coverage.componentNodeCount = 1;
  input.evidenceBundle.coverage.textNodeCount = 2;
  return input;
}

test('TitleView production text rules preserve boundaries, UNKNOWN and exact focus', () => {
  const evaluate = (input, ruleId) => evaluatePredicatePilotRequest(
    input,
    { designSystemRoot },
  ).result.evaluations.find((item) => item.ruleId === ruleId);
  const titleRuleId = 'component:web-corp.title-view.title-required-non-empty';
  const subtitleRuleId = 'component:web-corp.title-view.subtitle-max-120-characters';

  assert.equal(evaluate(titleViewTextRequest(), titleRuleId).classification, 'compliant');
  assert.equal(evaluate(titleViewTextRequest(), subtitleRuleId).classification, 'compliant');

  const emptyTitle = evaluate(titleViewTextRequest({ titleLength: 0 }), titleRuleId);
  assert.equal(emptyTitle.classification, 'violation');
  assert.equal(emptyTitle.focusNodeId, '31:1');

  const longSubtitle = evaluate(
    titleViewTextRequest({ subtitleLength: 121 }),
    subtitleRuleId,
  );
  assert.equal(longSubtitle.classification, 'violation');
  assert.equal(longSubtitle.focusNodeId, '31:2');

  assert.equal(
    evaluate(titleViewTextRequest({ titleLength: null }), titleRuleId).classification,
    'not-evaluable',
  );
});

function cardImageXsStateRequest({
  size = '24x16',
  state = 'Active',
} = {}) {
  const input = titleViewSlotRequest([]);
  const key = state === 'Active' ? CARD_IMAGE_XS_ACTIVE_KEY : CARD_IMAGE_XS_INACTIVE_KEY;
  input.evidenceBundle.reportId = 'card-image-xs-state:evidence';
  input.evidenceBundle.sourceReportId = 'card-image-xs-state';
  input.evidenceBundle.context.selectionNodeIds = ['11:0'];
  input.evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '11:0',
    path: 'CardImage',
    name: 'CardImage',
    component: component(key, 'CardImage', {
      Cover: 'Alfa Business',
      Size: size,
      State: state,
      Stack: 'false',
    }),
  })];
  input.evidenceBundle.coverage.visibleNodeCount = 1;
  input.evidenceBundle.coverage.componentNodeCount = 1;
  return input;
}

test('C15 source-driven CardImage property dependency allows only Active at 24x16', () => {
  const ruleId = 'component:web-corp.card-image.xs-active-only';
  const pass = evaluatePredicatePilotRequest(
    cardImageXsStateRequest({ state: 'Active' }),
    { designSystemRoot },
  );
  const fail = evaluatePredicatePilotRequest(
    cardImageXsStateRequest({ state: 'Inactive' }),
    { designSystemRoot },
  );
  const notApplicable = evaluatePredicatePilotRequest(
    cardImageXsStateRequest({ size: '44x28', state: 'Inactive' }),
    { designSystemRoot },
  );
  const passEvaluation = pass.result.evaluations.find((item) => item.ruleId === ruleId);
  const failEvaluation = fail.result.evaluations.find((item) => item.ruleId === ruleId);
  const notApplicableEvaluation = notApplicable.result.evaluations.find(
    (item) => item.ruleId === ruleId,
  );

  assert.ok(passEvaluation, JSON.stringify(pass.result.evaluations, null, 2));
  assert.ok(failEvaluation, JSON.stringify(fail.result.evaluations, null, 2));
  assert.ok(notApplicableEvaluation, JSON.stringify(notApplicable.result.evaluations, null, 2));
  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.subjectNodeId, '11:0');
  assert.equal(passEvaluation.focusNodeId, '11:0');
  assert.equal(failEvaluation.classification, 'violation');
  assert.equal(failEvaluation.subjectNodeId, '11:0');
  assert.equal(failEvaluation.focusNodeId, '11:0');
  assert.equal(failEvaluation.trace.actual, 'Inactive');
  assert.deepEqual(failEvaluation.trace.expected, ['Active']);
  assert.equal(notApplicableEvaluation.classification, 'not-applicable');
});

function tabsSecondarySingleIconRequest(singleIcon) {
  const tabsViewOwner = {
    nodeId: '12:0',
    componentKey: TABS_VIEW_KEY,
    name: '[D] TabsView',
    path: '[D] TabsView',
    relativePath: '',
    variantProperties: { TabsSecondary: true },
    componentProperties: { TabsSecondary: true },
  };
  const tabsSecondaryOwner = {
    nodeId: '12:1',
    componentKey: TABS_SECONDARY_KEY,
    name: '[D] TabsSecondary',
    path: '[D] TabsView / [D] TabsSecondary',
    relativePath: '[D] TabsSecondary',
    variantProperties: { Size: '40', Slider: false },
    componentProperties: { Size: '40', Slider: false },
  };
  const input = titleViewSlotRequest([]);
  input.evidenceBundle.reportId = 'tabs-secondary-single-icon:evidence';
  input.evidenceBundle.sourceReportId = 'tabs-secondary-single-icon';
  input.evidenceBundle.context.selectionNodeIds = ['12:0'];
  input.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '12:0',
      childNodeIds: ['12:1'],
      path: '[D] TabsView',
      name: '[D] TabsView',
      component: component(TABS_VIEW_KEY, '[D] TabsView', {
        TabsSecondary: true,
      }),
    }),
    evidenceNode({
      nodeId: '12:1',
      parentNodeId: '12:0',
      childNodeIds: ['12:2'],
      childOrder: 0,
      depth: 1,
      path: '[D] TabsView / [D] TabsSecondary',
      name: '[D] TabsSecondary',
      component: component(TABS_SECONDARY_KEY, '[D] TabsSecondary', {
        Size: '40',
        Slider: false,
      }),
      componentOwner: tabsViewOwner,
    }),
    evidenceNode({
      nodeId: '12:2',
      parentNodeId: '12:1',
      childOrder: 0,
      depth: 2,
      path: '[D] TabsView / [D] TabsSecondary / [D] Tag',
      name: '[D] Tag',
      component: component(TAG_FILLED_KEY, '[D] Tag', {
        View: 'Filled',
        SingleIcon: singleIcon,
      }),
      componentOwner: tabsSecondaryOwner,
    }),
  ];
  input.evidenceBundle.coverage.visibleNodeCount = 3;
  input.evidenceBundle.coverage.componentNodeCount = 3;
  return input;
}

test('source-driven TabsView rule checks SingleIcon on the exact Tag owned by TabsSecondary', () => {
  const ruleId = 'component:web-corp.tabs-view.secondary-single-icon-forbidden';
  const pass = evaluatePredicatePilotRequest(
    tabsSecondarySingleIconRequest('False'),
    { designSystemRoot },
  );
  const fail = evaluatePredicatePilotRequest(
    tabsSecondarySingleIconRequest('True'),
    { designSystemRoot },
  );
  const passEvaluation = pass.result.evaluations.find((item) => item.ruleId === ruleId);
  const failEvaluation = fail.result.evaluations.find((item) => item.ruleId === ruleId);

  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.subjectNodeId, '12:2');
  assert.equal(passEvaluation.focusNodeId, '12:2');
  assert.equal(failEvaluation.classification, 'violation');
  assert.equal(failEvaluation.subjectNodeId, '12:2');
  assert.equal(failEvaluation.focusNodeId, '12:2');
  assert.equal(failEvaluation.trace.actual, 'True');
  assert.deepEqual(failEvaluation.trace.expected, ['False']);
});

function tabsUniqueLabelsRequest(labels, singleIcons = labels.map(() => 'False')) {
  const tabsViewOwner = {
    nodeId: '13:0',
    componentKey: TABS_VIEW_KEY,
    name: '[D] TabsView',
    path: '[D] TabsView',
    relativePath: '',
    variantProperties: { TabsSecondary: true },
    componentProperties: { TabsSecondary: true },
  };
  const tabsSecondaryOwner = {
    nodeId: '13:1',
    componentKey: TABS_SECONDARY_KEY,
    name: '[D] TabsSecondary',
    path: '[D] TabsView / [D] TabsSecondary',
    relativePath: '[D] TabsSecondary',
    variantProperties: { Size: '40' },
    componentProperties: { Size: '40' },
  };
  const input = titleViewSlotRequest([]);
  input.evidenceBundle.reportId = 'tabs-unique-labels:evidence';
  input.evidenceBundle.sourceReportId = 'tabs-unique-labels';
  input.evidenceBundle.context.selectionNodeIds = ['13:0'];
  input.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '13:0',
      childNodeIds: ['13:1'],
      path: '[D] TabsView',
      name: '[D] TabsView',
      component: component(TABS_VIEW_KEY, '[D] TabsView', {
        TabsSecondary: true,
      }),
    }),
    evidenceNode({
      nodeId: '13:1',
      parentNodeId: '13:0',
      childNodeIds: labels.map((_, index) => `13:${index + 2}`),
      childOrder: 0,
      depth: 1,
      path: '[D] TabsView / [D] TabsSecondary',
      name: '[D] TabsSecondary',
      component: component(TABS_SECONDARY_KEY, '[D] TabsSecondary', {
        Size: '40',
      }),
      componentOwner: tabsViewOwner,
    }),
    ...labels.flatMap((characters, index) => {
      const tagNodeId = `13:${index + 2}`;
      const labelNodeId = `13:${index + 12}`;
      return [
        evidenceNode({
          nodeId: tagNodeId,
          parentNodeId: '13:1',
          childNodeIds: [labelNodeId],
          childOrder: index,
          depth: 2,
          path: `[D] TabsView / [D] TabsSecondary / [D] Tag ${index + 1}`,
          name: '[D] Tag',
          component: component(TAG_FILLED_KEY, '[D] Tag', {
            View: 'Filled',
            SingleIcon: singleIcons[index],
          }),
          componentOwner: tabsSecondaryOwner,
        }),
        evidenceNode({
          nodeId: labelNodeId,
          parentNodeId: tagNodeId,
          childOrder: 0,
          depth: 3,
          path: `[D] TabsView / [D] TabsSecondary / [D] Tag ${index + 1} / Label`,
          type: 'TEXT',
          name: 'Label',
          component: null,
          text: {
            characters,
            length: Array.from(characters).length,
            textStyleId: null,
          },
        }),
      ];
    }),
  ];
  input.evidenceBundle.coverage.visibleNodeCount = 2 + labels.length * 2;
  input.evidenceBundle.coverage.componentNodeCount = 2 + labels.length;
  input.evidenceBundle.coverage.textNodeCount = labels.length;
  return input;
}

test('source-rule balancer reuses Benefits uniformity semantics for TabsSecondary', () => {
  const ruleId = 'component:web-corp.tabs-view.secondary-single-icon-is-uniform';
  const pass = evaluatePredicatePilotRequest(
    tabsUniqueLabelsRequest(['Обзор', 'История'], ['False', 'False']),
    { designSystemRoot },
  );
  const failInput = tabsUniqueLabelsRequest(
    ['Обзор', 'История'],
    ['False', 'True'],
  );
  const changedTag = failInput.evidenceBundle.graph.nodes.find((node) => node.nodeId === '13:3');
  changedTag.childNodeIds.push('13:99');
  failInput.evidenceBundle.graph.nodes.push(evidenceNode({
    nodeId: '13:99',
    parentNodeId: '13:3',
    childOrder: 1,
    depth: 3,
    path: '[D] TabsView / [D] TabsSecondary / [D] Tag 2 / unresolved icon',
    name: 'unresolved icon',
    component: component('unresolved-icon-key', 'unresolved icon', {}),
    componentOwner: {
      nodeId: '13:3',
      componentKey: TAG_FILLED_KEY,
      name: '[D] Tag',
      path: '[D] TabsView / [D] TabsSecondary / [D] Tag 2',
      relativePath: '[D] Tag 2',
      variantProperties: { SingleIcon: 'True' },
      componentProperties: { SingleIcon: 'True' },
    },
  }));
  failInput.evidenceBundle.coverage.visibleNodeCount += 1;
  failInput.evidenceBundle.coverage.componentNodeCount += 1;
  const fail = evaluatePredicatePilotRequest(
    failInput,
    { designSystemRoot },
  );
  const passEvaluation = pass.result.evaluations.find((item) => item.ruleId === ruleId);
  const failEvaluation = fail.result.evaluations.find((item) => item.ruleId === ruleId);
  const trace = fail.sourceRuleBalance.traces.find((item) => item.ruleId === ruleId);

  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.subjectNodeId, '13:1');
  assert.equal(passEvaluation.focusNodeId, '13:1');
  assert.equal(
    failEvaluation.classification,
    'violation',
    JSON.stringify(failEvaluation.trace, null, 2),
  );
  assert.equal(failEvaluation.subjectNodeId, '13:1');
  assert.equal(failEvaluation.focusNodeId, '13:1');
  assert.equal(trace.decision, 'reuse');
  assert.equal(trace.selectedContourId, 'uniform-collection-properties');
  assert.equal(
    trace.matchedPrecedentRuleIds.includes(
      'component:web.benefits.nested-card-settings-are-uniform',
    ),
    true,
  );
});

test('source-driven TabsView rule checks unique visible labels per tab level', () => {
  const ruleId = 'component:web-corp.tabs-view.labels-are-unique-within-level';
  const pass = evaluatePredicatePilotRequest(
    tabsUniqueLabelsRequest(['Обзор', 'История']),
    { designSystemRoot },
  );
  const fail = evaluatePredicatePilotRequest(
    tabsUniqueLabelsRequest(['Обзор', 'Обзор']),
    { designSystemRoot },
  );
  const passEvaluation = pass.result.evaluations.find((item) => item.ruleId === ruleId);
  const failEvaluation = fail.result.evaluations.find((item) => item.ruleId === ruleId);

  assert.equal(passEvaluation.classification, 'compliant');
  assert.equal(passEvaluation.subjectNodeId, '13:1');
  assert.equal(passEvaluation.focusNodeId, '13:1');
  assert.equal(failEvaluation.classification, 'violation');
  assert.equal(failEvaluation.subjectNodeId, '13:1');
  assert.equal(failEvaluation.focusNodeId, '13:1');
  assert.deepEqual(failEvaluation.trace.actual, ['Обзор', 'Обзор']);
});

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

test('source rule requires Overflow=true whenever a nested Button uses SingleIcon=true', () => {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'True' });
  const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
  const finding = output.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.buttons-group.overflow-enables-last-single-icon'
    && item.classification === 'violation'
  ));

  assert.equal(finding.focusNodeId, '1:2');
  assert.deepEqual(finding.trace.factPaths, [
    'ownership.owner.component.properties.Overflow',
  ]);
  assert.equal(
    output.rules.find((rule) => rule.ruleId === finding.ruleId).presentation.title,
    'SingleIcon включён без Overflow',
  );
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

test('isolated predicate endpoint rejects client-supplied rules', () => {
  assert.throws(
    () => evaluatePredicatePilotRequest(
      {
        rules: [{ ruleId: 'client-rule' }],
        evidenceBundle: request({ View: 'Secondary', Size: '56' }).evidenceBundle,
      },
      { designSystemRoot },
    ),
    (error) => error.code === 'PREDICATE_CLIENT_RULES_FORBIDDEN',
  );
});

test('production predicate endpoint rejects a client-selected rule set', () => {
  assert.throws(
    () => evaluatePredicatePilotRequest(
      {
        ruleSet: 'buttons-group-pilot',
        evidenceBundle: request({ View: 'Secondary', Size: '56' }).evidenceBundle,
      },
      { designSystemRoot },
    ),
    (error) => error.code === 'PREDICATE_CLIENT_RULE_SET_FORBIDDEN',
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
  const compiledRule = output.rules.find((item) => (
    item.ruleId === 'component:web-corp.title-view.title-and-subtitle-typography-is-fixed'
  ));
  assert.equal(compiledRule.source.anchor, 'rules/component:web-corp.title-view.title-and-subtitle-typography-is-fixed');
  const violation = output.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.title-view.title-and-subtitle-typography-is-fixed' &&
    item.classification === 'violation'
  ));

  assert.equal(violation.focusNodeId, '2:1');
  const requiredTrace = violation.trace.children.find((child) => child.predicate === 'exists');
  assert.equal(requiredTrace.truth, 'true');
  const baselineTrace = violation.trace.children.find((child) => (
    child.predicate === 'matches-effective-baseline'
  ));
  assert.equal(baselineTrace.actual, 'Headline–System/30–36 Medium');
  assert.equal(baselineTrace.expected, 'Headline–System/40–48 Large');
  assert.equal(output.result.coverage.unclassified, 0);
});

test('source-driven TitleView color baseline rejects a recolored Title with exact focus', () => {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  input.evidenceBundle.context.selectionNodeIds = ['2:color-root'];
  input.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '2:color-root',
      childNodeIds: ['2:color-title'],
      path: '[D] TitleView',
      name: '[D] TitleView',
      component: component(TITLE_VIEW_KEY, '[D] TitleView', { View: 'xLarge' }),
    }),
    evidenceNode({
      nodeId: '2:color-title',
      parentNodeId: '2:color-root',
      childOrder: 0,
      depth: 1,
      path: '[D] TitleView / Title',
      type: 'TEXT',
      name: 'Title',
      text: {
        characters: 'Заголовок',
        length: 9,
        textStyleId: 'title-style',
      },
      appearance: {
        opacity: 1,
        radius: 0,
        fill: {
          value: 'text/secondary',
          resourceType: 'token',
          resourceId: 'text-secondary-key',
          resourceName: 'text/secondary',
          bindingName: 'text/secondary',
          bindingCollection: 'Interface Dynamic',
          styleId: null,
          visible: true,
          paintCount: 1,
          paintTypes: ['SOLID'],
        },
      },
      componentOwner: {
        nodeId: '2:color-root',
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
    nodeId: '2:color-title',
    fields: ['fills'],
  }];
  input.evidenceBundle.changes = [{
    id: 'change-title-color',
    nodeId: '2:color-title',
    nodeName: 'Title',
    nodePath: '[D] TitleView / Title',
    property: 'fill',
    kind: 'paint',
    ownerComponentKey: TITLE_VIEW_KEY,
    baselineReferenceId: 'baseline-title-view-color',
    baseline: {
      value: 'text/primary',
      resourceType: 'token',
      resourceName: 'text/primary',
      bindingName: 'text/primary',
      bindingCollection: 'Interface Dynamic',
    },
    actual: {
      value: 'text/secondary',
      resourceType: 'token',
      resourceName: 'text/secondary',
      bindingName: 'text/secondary',
      bindingCollection: 'Interface Dynamic',
    },
    bindingStatus: 'different-binding',
    mapping: {
      method: 'apollo-effective-baseline-diff',
      quality: 'exact',
      referenceOrigin: 'host',
      nestedOwnerRelativePath: 'Title',
    },
    candidateRuleIds: [
      'component:web-corp.title-view.title-and-subtitle-color-is-fixed',
    ],
  }];

  const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
  const compiledRule = output.rules.find((item) => (
    item.ruleId === 'component:web-corp.title-view.title-and-subtitle-color-is-fixed'
  ));
  assert.equal(
    compiledRule.source.anchor,
    'rules/component:web-corp.title-view.title-and-subtitle-color-is-fixed',
  );
  const violation = output.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.title-view.title-and-subtitle-color-is-fixed' &&
    item.classification === 'violation'
  ));
  assert.equal(violation.focusNodeId, '2:color-title');
  const baselineTrace = violation.trace.children.find((child) => (
    child.predicate === 'matches-effective-baseline'
  ));
  assert.equal(baselineTrace.actual, 'text/secondary');
  assert.equal(baselineTrace.expected, 'text/primary');
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

test('BackgroundPlateSlot padding no longer produces executable predicate findings', () => {
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
  const paddingEvaluations = output.result.evaluations.filter((item) => (
    item.ruleId.includes('padding-uses-spacing-tokens')
  ));

  assert.equal(paddingEvaluations.length, 0);
  assert.equal(output.result.coverage.unclassified, 0);
});

test('legacy BackgroundPlate roots do not load removed padding token rules', () => {
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

  assert.equal(paddingEvaluations.length, 0);
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

function onboardingTooltipFillRequest(mode) {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  const rootComponent = component(
    ONBOARDING_TOOLTIP_KEY,
    'Onboarding Tooltip [D]',
    { Direction: 'Top' },
  );
  if (mode === 'unknown') {
    rootComponent.directOverrides = [{ nodeId: '30:1', fields: ['fills'] }];
  }
  const owner = {
    nodeId: '30:0',
    componentKey: ONBOARDING_TOOLTIP_KEY,
    name: 'Onboarding Tooltip [D]',
    path: 'C16 / Onboarding Tooltip [D]',
    relativePath: 'Surface',
    variantProperties: { Direction: 'Top' },
    componentProperties: { Direction: 'Top' },
  };
  input.evidenceBundle.context.selectionNodeIds = ['30:0'];
  input.evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '30:0',
    childNodeIds: ['30:1'],
    path: 'C16 / Onboarding Tooltip [D]',
    name: 'Onboarding Tooltip [D]',
    component: rootComponent,
  }), evidenceNode({
    nodeId: '30:1',
    parentNodeId: '30:0',
    depth: 1,
    path: 'C16 / Onboarding Tooltip [D] / Surface',
    name: 'Surface',
    type: 'FRAME',
    component: null,
    componentOwner: owner,
    appearance: {
      opacity: 1,
      radius: 16,
      fill: {
        value: mode === 'fail' ? 'base-bg/primary' : 'base-bg/secondary',
        resourceType: 'token',
        resourceId: mode === 'fail' ? 'actual-token-key' : 'baseline-token-key',
        resourceName: mode === 'fail' ? 'base-bg/primary' : 'base-bg/secondary',
        bindingName: mode === 'fail' ? 'base-bg/primary' : 'base-bg/secondary',
        bindingCollection: 'Interface Dynamic',
        styleId: null,
        visible: true,
        paintCount: 1,
        paintTypes: ['SOLID'],
      },
    },
  })];
  input.evidenceBundle.graph.relations = [];
  input.evidenceBundle.baselines = mode === 'fail' ? [{
    id: 'baseline-tooltip-fill',
    componentKey: ONBOARDING_TOOLTIP_KEY,
    nestedOwnerComponentKey: ONBOARDING_TOOLTIP_KEY,
    nestedOwnerRelativePath: 'Surface',
    variantProperties: { Direction: 'Top' },
  }] : [];
  input.evidenceBundle.changes = mode === 'fail' ? [{
    id: 'change-tooltip-fill',
    nodeId: '30:1',
    nodeName: 'Surface',
    nodePath: 'C16 / Onboarding Tooltip [D] / Surface',
    property: 'fill',
    kind: 'paint',
    ownerComponentKey: ONBOARDING_TOOLTIP_KEY,
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
    candidateRuleIds: [
      'component:web-corp.onboarding-tooltip.visuals-follow-effective-baseline',
    ],
  }] : [];
  return input;
}

test('C16 compiles generic paint baseline PASS, FAIL and UNKNOWN from rules.json', () => {
  const ruleId = 'component:web-corp.onboarding-tooltip.visuals-follow-effective-baseline';
  const evaluate = (mode) => {
    const output = evaluatePredicatePilotRequest(onboardingTooltipFillRequest(mode), {
      designSystemRoot,
    });
    return output.result.evaluations.find((item) => item.ruleId === ruleId);
  };

  const pass = evaluate('pass');
  assert.equal(pass.classification, 'compliant');
  assert.equal(pass.focusNodeId, '30:1');

  const fail = evaluate('fail');
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '30:1');
  assert.equal(fail.trace.children[1].actual, 'base-bg/primary');
  assert.equal(fail.trace.children[1].expected, 'base-bg/secondary');

  const unknown = evaluate('unknown');
  assert.equal(unknown.classification, 'not-evaluable');
  assert.equal(unknown.focusNodeId, '30:1');
});

function onboardingTooltipTypographyRequest(mode) {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  const textNodeId = '30:text';
  const changed = mode !== 'pass';
  const actualStyleId = mode === 'raw' ? null : (
    mode === 'wrong-style' ? 'style-paragraph-14' : 'style-headline-18'
  );
  const actualStyleName = mode === 'raw' ? null : (
    mode === 'wrong-style' ? 'Paragraph/14–18 Component Secondary' : 'Headline/18–24 Small'
  );
  const rootComponent = component(
    ONBOARDING_TOOLTIP_KEY,
    'Onboarding Tooltip [D]',
    { Direction: 'Top' },
  );
  rootComponent.directOverrides = changed
    ? [{ nodeId: textNodeId, fields: ['textStyleId'] }]
    : [];
  const owner = {
    nodeId: '30:tooltip',
    componentKey: ONBOARDING_TOOLTIP_KEY,
    name: 'Onboarding Tooltip [D]',
    path: 'C19 / Onboarding Tooltip [D]',
    relativePath: 'Title',
    variantProperties: { Direction: 'Top' },
    componentProperties: { Direction: 'Top' },
  };
  input.evidenceBundle.context.selectionNodeIds = ['30:tooltip'];
  input.evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '30:tooltip',
    childNodeIds: [textNodeId],
    path: 'C19 / Onboarding Tooltip [D]',
    name: 'Onboarding Tooltip [D]',
    component: rootComponent,
  }), evidenceNode({
    nodeId: textNodeId,
    parentNodeId: '30:tooltip',
    depth: 1,
    path: 'C19 / Onboarding Tooltip [D] / Title',
    name: 'Title',
    type: 'TEXT',
    component: null,
    componentOwner: owner,
    text: {
      characters: 'Title 18–24',
      length: 11,
      textStyleId: actualStyleId,
    },
    styles: {
      fillStyleId: null,
      strokeStyleId: null,
      textStyleId: actualStyleId,
      effectStyleId: null,
    },
  })];
  input.evidenceBundle.graph.relations = [];
  input.evidenceBundle.baselines = changed ? [{
    id: 'baseline-tooltip-title-style',
    componentKey: ONBOARDING_TOOLTIP_KEY,
    nestedOwnerComponentKey: ONBOARDING_TOOLTIP_KEY,
    nestedOwnerRelativePath: 'Title',
    variantProperties: { Direction: 'Top' },
  }] : [];
  input.evidenceBundle.changes = changed ? [{
    id: 'change-tooltip-title-style',
    nodeId: textNodeId,
    nodeName: 'Title',
    nodePath: 'C19 / Onboarding Tooltip [D] / Title',
    property: 'styles.text',
    kind: 'text-style',
    ownerComponentKey: ONBOARDING_TOOLTIP_KEY,
    baselineReferenceId: 'baseline-tooltip-title-style',
    baseline: {
      value: 'Headline/18–24 Small',
      resourceType: 'style',
      resourceName: 'Headline/18–24 Small',
    },
    actual: {
      value: actualStyleName,
      resourceType: actualStyleId ? 'style' : null,
      resourceName: actualStyleName,
    },
    mapping: {
      method: 'apollo-effective-baseline-diff',
      quality: 'exact',
      referenceOrigin: 'nested-component',
      nestedOwnerRelativePath: 'Title',
    },
    candidateRuleIds: [
      'component:web-corp.onboarding-tooltip.typography-follows-effective-baseline',
      'component:web-corp.onboarding-tooltip.text-style-binding-required',
    ],
  }] : [];
  return input;
}

test('C19 separates wrong canonical Text Style from missing Text Style binding', () => {
  const evaluate = (mode) => evaluatePredicatePilotRequest(
    onboardingTooltipTypographyRequest(mode),
    { designSystemRoot },
  ).result.evaluations;
  const baselineId = 'component:web-corp.onboarding-tooltip.typography-follows-effective-baseline';
  const bindingId = 'component:web-corp.onboarding-tooltip.text-style-binding-required.text-style';

  const pass = evaluate('pass');
  assert.equal(pass.find((item) => item.ruleId === baselineId).classification, 'compliant');
  assert.equal(pass.find((item) => item.ruleId === bindingId).classification, 'compliant');

  const wrong = evaluate('wrong-style');
  assert.equal(wrong.find((item) => item.ruleId === baselineId).classification, 'violation');
  assert.equal(wrong.find((item) => item.ruleId === bindingId).classification, 'compliant');
  assert.equal(wrong.find((item) => item.ruleId === baselineId).focusNodeId, '30:text');

  const raw = evaluate('raw');
  assert.equal(raw.find((item) => item.ruleId === baselineId).classification, 'not-applicable');
  assert.equal(raw.find((item) => item.ruleId === bindingId).classification, 'violation');
  assert.equal(raw.find((item) => item.ruleId === bindingId).focusNodeId, '30:text');
});

function tabsViewStrokeRequest(mode) {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  const rootComponent = component(TABS_VIEW_KEY, '[D] TabsView', { View: 'Primary' });
  if (mode === 'unknown') {
    rootComponent.directOverrides = [{ nodeId: '31:1', fields: ['strokes'] }];
  }
  const owner = {
    nodeId: '31:0',
    componentKey: TABS_VIEW_KEY,
    name: '[D] TabsView',
    path: 'C17 / [D] TabsView',
    relativePath: 'Divider',
    variantProperties: { View: 'Primary' },
    componentProperties: { View: 'Primary' },
  };
  input.evidenceBundle.context.selectionNodeIds = ['31:0'];
  input.evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '31:0',
    childNodeIds: ['31:1'],
    path: 'C17 / [D] TabsView',
    name: '[D] TabsView',
    component: rootComponent,
  }), evidenceNode({
    nodeId: '31:1',
    parentNodeId: '31:0',
    depth: 1,
    path: 'C17 / [D] TabsView / Divider',
    name: 'Divider',
    type: 'FRAME',
    component: null,
    componentOwner: owner,
    appearance: {
      opacity: 1,
      radius: 0,
      fill: null,
      stroke: {
        value: mode === 'fail' ? 'border/secondary' : 'border/primary',
        resourceType: 'token',
        resourceId: mode === 'fail' ? 'stroke-actual-key' : 'stroke-baseline-key',
        resourceName: mode === 'fail' ? 'border/secondary' : 'border/primary',
        bindingName: mode === 'fail' ? 'border/secondary' : 'border/primary',
        bindingCollection: 'Interface Dynamic',
        styleId: null,
        visible: true,
        paintCount: 1,
        paintTypes: ['SOLID'],
      },
    },
  })];
  input.evidenceBundle.graph.relations = [];
  input.evidenceBundle.baselines = mode === 'fail' ? [{
    id: 'baseline-tabs-stroke',
    componentKey: TABS_VIEW_KEY,
    nestedOwnerComponentKey: TABS_VIEW_KEY,
    nestedOwnerRelativePath: 'Divider',
    variantProperties: { View: 'Primary' },
  }] : [];
  input.evidenceBundle.changes = mode === 'fail' ? [{
    id: 'change-tabs-stroke',
    nodeId: '31:1',
    nodeName: 'Divider',
    nodePath: 'C17 / [D] TabsView / Divider',
    property: 'stroke',
    kind: 'paint',
    ownerComponentKey: TABS_VIEW_KEY,
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
    candidateRuleIds: [
      'component:web-corp.tabs-view.manual-visual-overrides-forbidden',
    ],
  }] : [];
  return input;
}

test('C17 compiles generic stroke baseline PASS, FAIL and UNKNOWN from rules.json', () => {
  const ruleId = 'component:web-corp.tabs-view.manual-visual-overrides-forbidden';
  const evaluate = (mode) => {
    const output = evaluatePredicatePilotRequest(tabsViewStrokeRequest(mode), {
      designSystemRoot,
    });
    return output.result.evaluations.find((item) => item.ruleId === ruleId);
  };

  const pass = evaluate('pass');
  assert.equal(pass.classification, 'compliant');
  assert.equal(pass.focusNodeId, '31:1');

  const fail = evaluate('fail');
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '31:1');
  assert.equal(fail.trace.children[1].actual, 'border/secondary');
  assert.equal(fail.trace.children[1].expected, 'border/primary');

  const unknown = evaluate('unknown');
  assert.equal(unknown.classification, 'not-evaluable');
  assert.equal(unknown.focusNodeId, '31:1');
});

function tableViewRootStrokeRequest(mode) {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  const rootComponent = component(
    TABLE_VIEW_HORIZONTAL_KEY,
    '[D] TableView :: Horizontal',
    { Compact: 'False' },
  );
  if (mode === 'unknown') {
    rootComponent.directOverrides = [{ nodeId: '31:table-root', fields: ['strokes'] }];
  }
  input.evidenceBundle.context.selectionNodeIds = ['31:table-root'];
  const hasChange = mode === 'fail' || mode === 'null-baseline';
  input.evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '31:table-root',
    path: 'TV-12 / [D] TableView :: Horizontal',
    name: '[D] TableView :: Horizontal',
    component: rootComponent,
    appearance: {
      opacity: 1,
      radius: 0,
      fill: null,
      stroke: {
        value: hasChange ? 'status/error' : 'border/primary',
        resourceType: 'token',
        resourceId: hasChange ? 'stroke-error-key' : 'stroke-baseline-key',
        resourceName: hasChange ? 'status/error' : 'border/primary',
        bindingName: hasChange ? 'status/error' : 'border/primary',
        bindingCollection: 'Interface Dynamic',
        styleId: null,
        visible: true,
        paintCount: 1,
        paintTypes: ['SOLID'],
      },
    },
  })];
  input.evidenceBundle.graph.relations = [];
  input.evidenceBundle.baselines = hasChange ? [{
    id: 'baseline-table-root-stroke',
    componentKey: TABLE_VIEW_HORIZONTAL_KEY,
    nestedOwnerComponentKey: TABLE_VIEW_HORIZONTAL_KEY,
    nestedOwnerRelativePath: '',
    variantProperties: { Compact: 'False' },
  }] : [];
  input.evidenceBundle.changes = hasChange ? [{
    id: 'change-table-root-stroke',
    nodeId: '31:table-root',
    nodeName: '[D] TableView :: Horizontal',
    nodePath: 'TV-12 / [D] TableView :: Horizontal',
    property: 'stroke',
    kind: 'paint',
    ownerComponentKey: TABLE_VIEW_HORIZONTAL_KEY,
    baselineReferenceId: 'baseline-table-root-stroke',
    baseline: {
      value: mode === 'null-baseline' ? null : '#D2D3D9',
      resourceType: mode === 'null-baseline' ? null : 'token',
      resourceName: mode === 'null-baseline' ? null : 'border/primary',
      bindingName: mode === 'null-baseline' ? null : 'border/primary',
      bindingCollection: mode === 'null-baseline' ? null : 'Interface Dynamic',
    },
    actual: {
      value: '#FF0000',
      resourceType: 'token',
      resourceName: 'status/error',
      bindingName: 'status/error',
      bindingCollection: 'Interface Dynamic',
    },
    bindingStatus: 'different-binding',
    mapping: {
      method: 'apollo-effective-baseline-diff',
      quality: 'exact',
      referenceOrigin: 'component-root',
      nestedOwnerRelativePath: '',
    },
    candidateRuleIds: [
      'component:web-corp.table-view.manual-visual-overrides-forbidden',
    ],
  }] : [];
  return input;
}

test('TableView root stroke is evaluated while radius and opacity remain outside authority', () => {
  const sourceRuleId = 'component:web-corp.table-view.manual-visual-overrides-forbidden';
  const ruleId = `${sourceRuleId}.stroke`;
  const evaluations = evaluatePredicatePilotRequest(
    tableViewRootStrokeRequest('fail'),
    { designSystemRoot },
  ).result.evaluations;
  const violation = evaluations.find((item) => item.ruleId === ruleId);

  assert.equal(violation.classification, 'violation');
  assert.equal(violation.focusNodeId, '31:table-root');
  assert.equal(violation.ruleRevision, 3);
  assert.equal(violation.trace.actual, 'status/error');
  assert.equal(violation.trace.expected, 'border/primary');
  assert.ok(!evaluations.some((item) => (
    item.ruleId === `${sourceRuleId}.radius` || item.ruleId === `${sourceRuleId}.opacity`
  )));

  const noStrokeBaseline = evaluatePredicatePilotRequest(
    tableViewRootStrokeRequest('null-baseline'),
    { designSystemRoot },
  ).result.evaluations.find((item) => item.ruleId === ruleId);
  assert.equal(noStrokeBaseline.classification, 'violation');
  assert.equal(noStrokeBaseline.focusNodeId, '31:table-root');
  assert.equal(noStrokeBaseline.trace.actual, 'status/error');
  assert.equal(noStrokeBaseline.trace.expected, null);
});

function backgroundPlateStrokeBindingRequest(mode) {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  input.evidenceBundle.context.selectionNodeIds = ['32:0'];
  input.evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '32:0',
    path: 'C17 / [D] Style Level 1, Type=Border',
    name: '[D] Style Level 1',
    component: component(
      BACKGROUND_PLATE_STYLE_LEVEL_1_KEY,
      '[D] Style Level 1',
      { Type: 'Border' },
    ),
    appearance: {
      opacity: 1,
      radius: 16,
      fill: null,
      stroke: {
        value: mode === 'fail' ? '#747474' : 'border/primary',
        resourceType: mode === 'fail' ? 'paint' : 'token',
        resourceId: mode === 'fail' ? null : 'stroke-token-key',
        resourceName: mode === 'fail' ? null : 'border/primary',
        bindingName: mode === 'fail' ? null : 'border/primary',
        bindingCollection: mode === 'fail' ? null : 'Interface Dynamic',
        styleId: null,
        visible: true,
        paintCount: 1,
        paintTypes: ['SOLID'],
      },
    },
    variableBindings: mode === 'fail' ? [] : [{
      property: 'strokes',
      variableIds: ['VariableID:stroke-token'],
      variables: [{
        id: 'VariableID:stroke-token',
        key: mode === 'unknown' ? null : 'stroke-token-key',
        name: mode === 'unknown' ? null : 'border/primary',
        collectionId: mode === 'unknown' ? null : 'collection:interface-dynamic',
        collectionName: mode === 'unknown' ? null : 'Interface Dynamic',
      }],
    }],
  })];
  input.evidenceBundle.graph.relations = [];
  input.evidenceBundle.baselines = [];
  input.evidenceBundle.changes = [];
  return input;
}

test('C17 compiles generic stroke token binding PASS, FAIL and UNKNOWN from rules.json', () => {
  const ruleId = 'component:web-corp.background-plate.colored-and-border-use-color-tokens.stroke';
  const evaluate = (mode) => {
    const output = evaluatePredicatePilotRequest(backgroundPlateStrokeBindingRequest(mode), {
      designSystemRoot,
    });
    return output.result.evaluations.find((item) => item.ruleId === ruleId);
  };

  const pass = evaluate('pass');
  assert.equal(pass.classification, 'compliant');
  assert.equal(pass.focusNodeId, '32:0');

  const fail = evaluate('fail');
  assert.equal(fail.classification, 'violation');
  assert.equal(fail.focusNodeId, '32:0');
  assert.equal(fail.trace.children[1].actual.bound, false);

  const unknown = evaluate('unknown');
  assert.equal(unknown.classification, 'not-evaluable');
  assert.equal(unknown.focusNodeId, '32:0');
});

function backgroundPlateAppearanceRequest({
  type = 'Colored',
  position = 'Level 1 (outer)',
  fill = 'status/positive',
  stroke = null,
  fillBound = true,
  family = 'style-level-1',
} = {}) {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  input.evidenceBundle.context.selectionNodeIds = ['33:0'];
  input.evidenceBundle.graph.nodes = [evidenceNode({
    nodeId: '33:0',
    path: `BackgroundPlate / ${position} / ${type}`,
    name: family === 'background-plate-slot' ? '[D] BackgroundPlateSlot' : '[D] Style Level 1',
    component: component(
      family === 'background-plate-slot'
        ? BACKGROUND_PLATE_SLOT_KEY
        : BACKGROUND_PLATE_STYLE_LEVEL_1_KEY,
      family === 'background-plate-slot' ? '[D] BackgroundPlateSlot' : '[D] Style Level 1',
      { Type: type, Position: position },
    ),
    appearance: {
      opacity: 1,
      radius: 16,
      fill: fill === null ? null : {
        value: fill,
        resourceType: fillBound ? 'token' : 'paint',
        resourceName: fillBound ? fill : null,
        bindingName: fillBound ? fill : null,
        bindingCollection: fillBound ? 'Interface Dynamic' : null,
        visible: true,
        paintCount: 1,
        paintTypes: ['SOLID'],
      },
      stroke: stroke === null ? null : {
        value: stroke,
        resourceType: 'paint',
        resourceName: null,
        bindingName: null,
        bindingCollection: null,
        visible: true,
        paintCount: 1,
        paintTypes: ['SOLID'],
      },
    },
    variableBindings: fill === null || !fillBound ? [] : [{
      property: 'fills',
      variableIds: ['VariableID:fill-token'],
      variables: [{
        id: 'VariableID:fill-token',
        key: 'fill-token-key',
        name: fill,
        collectionId: 'collection:interface-dynamic',
        collectionName: 'Interface Dynamic',
      }],
    }],
  })];
  input.evidenceBundle.graph.relations = [];
  input.evidenceBundle.baselines = [];
  input.evidenceBundle.changes = [];
  return input;
}

function backgroundPlateLevel2TypeRequest(type) {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  const owner = {
    nodeId: '33:10',
    componentKey: BACKGROUND_PLATE_KEY,
    name: '[D] BackgroundPlate',
    path: '[D] BackgroundPlate',
    relativePath: '',
    variantProperties: { Position: 'Level 2 (inner)' },
    componentProperties: { Position: 'Level 2 (inner)' },
  };
  input.evidenceBundle.context.selectionNodeIds = ['33:10'];
  input.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '33:10',
      childNodeIds: ['33:11'],
      path: '[D] BackgroundPlate',
      name: '[D] BackgroundPlate',
      component: component(BACKGROUND_PLATE_KEY, '[D] BackgroundPlate', {
        Position: 'Level 2 (inner)',
      }),
    }),
    evidenceNode({
      nodeId: '33:11',
      parentNodeId: '33:10',
      depth: 1,
      path: '[D] BackgroundPlate / [D] Style Level 2',
      name: '[D] Style Level 2',
      component: component(BACKGROUND_PLATE_STYLE_LEVEL_2_KEY, '[D] Style Level 2', {
        Type: type,
      }),
      componentOwner: owner,
    }),
  ];
  input.evidenceBundle.graph.relations = [];
  input.evidenceBundle.baselines = [];
  input.evidenceBundle.changes = [];
  return input;
}

test('BackgroundPlate package applies independent Level-2 and Colored appearance predicates', () => {
  const evaluate = (options, ruleId) => {
    const output = evaluatePredicatePilotRequest(backgroundPlateAppearanceRequest(options), {
      designSystemRoot,
    });
    return output.result.evaluations.find((item) => item.ruleId === ruleId);
  };
  const typeRule = 'component:web-corp.background-plate.no-secondary-for-level-2';
  const bindingRule = 'component:web-corp.background-plate.colored-and-border-use-color-tokens.fill';
  const paintRule = 'component:web-corp.background-plate.colored-uses-fill-without-stroke';
  const borderRule = 'component:web-corp.background-plate.border-has-no-visible-fill';

  const evaluateLevel2Type = (type) => {
    const output = evaluatePredicatePilotRequest(backgroundPlateLevel2TypeRequest(type), {
      designSystemRoot,
    });
    return output.result.evaluations.find((item) => item.ruleId === typeRule);
  };

  assert.equal(evaluateLevel2Type('Primary').classification, 'compliant');
  const invalidType = evaluateLevel2Type('Secondary');
  assert.equal(invalidType.classification, 'violation');
  assert.equal(invalidType.focusNodeId, '33:11');

  assert.equal(evaluate({ type: 'Colored', fillBound: true }, bindingRule).classification, 'compliant');
  const rawFill = evaluate({ type: 'Colored', fillBound: false }, bindingRule);
  assert.equal(rawFill.classification, 'violation');
  assert.equal(rawFill.focusNodeId, '33:0');

  assert.equal(evaluate({ type: 'Colored', stroke: null }, paintRule).classification, 'compliant');
  const coloredWithStroke = evaluate({ type: 'Colored', stroke: '#747474' }, paintRule);
  assert.equal(coloredWithStroke.classification, 'violation');
  assert.equal(coloredWithStroke.focusNodeId, '33:0');

  const rawSlotFill = evaluate({
    type: 'Colored',
    fillBound: false,
    family: 'background-plate-slot',
  }, bindingRule);
  assert.equal(rawSlotFill.classification, 'violation');

  const coloredSlotWithStroke = evaluate({
    type: 'Colored',
    stroke: '#747474',
    family: 'background-plate-slot',
  }, paintRule);
  assert.equal(coloredSlotWithStroke.classification, 'violation');

  const borderSlotWithFill = evaluate({
    type: 'Border',
    fill: '#f5e0e0',
    fillBound: false,
    family: 'background-plate-slot',
  }, borderRule);
  assert.equal(borderSlotWithFill.classification, 'violation');
});

test('TagGroup size predicate selects published Tag variants by component identity', () => {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  const owner = {
    nodeId: '34:0',
    componentKey: TAG_GROUP_KEY,
    name: '[D] TagGroup',
    path: 'TagGroup',
    relativePath: '[D] Tag_Filled',
    variantProperties: { Size: '56' },
    componentProperties: { Size: '56' },
  };
  input.evidenceBundle.context.selectionNodeIds = ['34:section'];
  input.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '34:section',
      childNodeIds: ['34:0'],
      path: 'TagGroup test section',
      type: 'SECTION',
      name: 'TagGroup test section',
    }),
    evidenceNode({
      nodeId: '34:0',
      parentNodeId: '34:section',
      childNodeIds: ['34:1'],
      depth: 1,
      path: 'TagGroup test section / [D] TagGroup',
      name: '[D] TagGroup',
      component: component(TAG_GROUP_KEY, '[D] TagGroup', { Size: '56' }),
    }),
    evidenceNode({
      nodeId: '34:1',
      parentNodeId: '34:0',
      depth: 2,
      path: 'TagGroup test section / [D] TagGroup / [D] Tag_Filled',
      name: '[D] Tag_Filled',
      component: component(TAG_FILLED_KEY, '[D] Tag_Filled', { Size: '40' }),
      componentOwner: owner,
    }),
  ];
  input.evidenceBundle.graph.relations = [];
  input.evidenceBundle.baselines = [];
  input.evidenceBundle.changes = [];

  const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
  const evaluation = output.result.evaluations.find((item) => (
    item.ruleId === 'component:web-core.tag-group.nested-tag-size-matches-group'
    && item.classification === 'violation'
  ));
  assert.equal(evaluation.focusNodeId, '34:1');
});

test('PaymentMaskedNumber baseline predicate selects published pen-prefixed text layers', () => {
  const input = request({ View: 'Secondary', Size: '56', SingleIcon: 'False' });
  const owner = {
    nodeId: '35:1',
    componentKey: PAYMENT_MASKED_NUMBER_MAJOR_KEY,
    name: 'Major',
    path: 'PaymentMaskedNumber / Major',
    relativePath: '✎ Major',
    variantProperties: { 'Mask Number': 'False' },
    componentProperties: { 'Mask Number': 'False' },
  };
  input.evidenceBundle.context.selectionNodeIds = ['35:section'];
  input.evidenceBundle.graph.nodes = [
    evidenceNode({
      nodeId: '35:section',
      childNodeIds: ['35:0'],
      path: 'PaymentMaskedNumber test section',
      type: 'SECTION',
      name: 'PaymentMaskedNumber test section',
    }),
    evidenceNode({
      nodeId: '35:0',
      parentNodeId: '35:section',
      childNodeIds: ['35:1'],
      depth: 1,
      path: 'PaymentMaskedNumber test section / PaymentMaskedNumber',
      name: 'PaymentMaskedNumber',
      component: component(PAYMENT_MASKED_NUMBER_KEY, 'PaymentMaskedNumber', { RightAddon: false }),
    }),
    evidenceNode({
      nodeId: '35:1',
      parentNodeId: '35:0',
      childNodeIds: ['35:text'],
      depth: 2,
      path: 'PaymentMaskedNumber test section / PaymentMaskedNumber / Major',
      name: 'Major',
      component: component(PAYMENT_MASKED_NUMBER_MAJOR_KEY, 'Major', { 'Mask Number': 'False' }),
    }),
    evidenceNode({
      nodeId: '35:text',
      parentNodeId: '35:1',
      depth: 3,
      path: 'PaymentMaskedNumber test section / PaymentMaskedNumber / Major / ✎ Major',
      type: 'TEXT',
      name: '✎ Major',
      componentOwner: owner,
      appearance: {
        opacity: 1,
        radius: 0,
        fill: {
          value: '#F21F14',
          resourceType: 'raw',
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
    }),
  ];
  input.evidenceBundle.graph.relations = [];
  input.evidenceBundle.baselines = [{
    id: 'baseline-payment-major',
    componentKey: PAYMENT_MASKED_NUMBER_KEY,
    nestedOwnerComponentKey: PAYMENT_MASKED_NUMBER_MAJOR_KEY,
    nestedOwnerRelativePath: '✎ Major',
    variantProperties: { 'Mask Number': 'False' },
  }];
  input.evidenceBundle.changes = [{
    id: 'change-payment-major-fill',
    nodeId: '35:text',
    nodeName: '✎ Major',
    nodePath: 'PaymentMaskedNumber test section / PaymentMaskedNumber / Major / ✎ Major',
    property: 'fill',
    kind: 'paint',
    ownerComponentKey: PAYMENT_MASKED_NUMBER_KEY,
    baselineReferenceId: 'baseline-payment-major',
    baseline: {
      value: 'text/primary',
      resourceType: 'token',
      resourceName: 'text/primary',
      bindingName: 'text/primary',
      bindingCollection: 'Interface Dynamic',
    },
    actual: {
      value: '#F21F14',
      resourceType: 'raw',
      resourceName: null,
      bindingName: null,
      bindingCollection: null,
    },
    bindingStatus: 'unbound',
    mapping: {
      method: 'apollo-effective-baseline-diff',
      quality: 'exact',
      referenceOrigin: 'nested-component',
      nestedOwnerRelativePath: '✎ Major',
    },
    candidateRuleIds: [
      'component:web-corp.payment-masked-number.text-color-follows-baseline',
    ],
  }];

  const output = evaluatePredicatePilotRequest(input, { designSystemRoot });
  const evaluation = output.result.evaluations.find((item) => (
    item.ruleId === 'component:web-corp.payment-masked-number.text-color-follows-baseline'
    && item.classification === 'violation'
  ));
  assert.equal(evaluation.focusNodeId, '35:text');
});
