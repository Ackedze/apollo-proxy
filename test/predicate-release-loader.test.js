const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  loadPredicateRelease,
  loadRequestedPackageDefinitions,
  validateComponentExecutionPolicy,
} = require('../src/predicate-engine/release-loader');
const { compileCompositionContract } = require('../src/predicate-engine/composition-compiler');
const { compileContourRule } = require('../src/predicate-engine/contour-rules');
const { compilePredicateReleaseRules } = require('../src/predicate-engine/release-service');

const designSystemRoot = process.env.DESIGN_SYSTEM_AB_ROOT
  ? path.resolve(process.env.DESIGN_SYSTEM_AB_ROOT)
  : path.resolve(__dirname, '../../../shared/design-system_ab');

test('generic package loader compiles only composition artifacts declared by requested packages', () => {
  const jsonRoot = path.join(designSystemRoot, 'JSONS');
  const index = JSON.parse(fs.readFileSync(
    path.join(jsonRoot, 'apollo/indexes/componentContractIndex.json'),
    'utf8',
  ));
  const titleView = index.packages.find((entry) => entry.componentKey === 'web-corp.title-view');
  const amountStyles = index.packages.find((entry) => entry.componentKey === 'web-corp.amount-styles');
  assert.ok(titleView);
  assert.ok(amountStyles);

  const requestedByPackage = new Map([
    [titleView.componentKey, { packageEntry: titleView, figmaKeys: [] }],
    [amountStyles.componentKey, { packageEntry: amountStyles, figmaKeys: [] }],
  ]);
  const loaded = loadRequestedPackageDefinitions(jsonRoot, requestedByPackage);

  assert.deepEqual(
    loaded.compositionDefinitions.map((definition) => definition.id),
    [
      'title-view.button-group.composition',
      'title-view.desktop-button-size.composition',
      'title-view.mobile-button-size.composition',
      'title-view.status.composition',
    ],
  );
  assert.deepEqual(
    loaded.slotOrderPolicies.map((definition) => definition.ruleId),
    ['component:web-corp.title-view.visible-slots-follow-required-order'],
  );
  assert.deepEqual(
    Object.keys(loaded.sourceChecksums),
    [
      'design-system_ab/JSONS/web/components/web-corp/AmountStyles/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-corp/TitleView/composition-contract.json',
    ],
  );
});

test('source-derived release replaces ButtonsGroup pilot rules and exposes remaining coverage gap', () => {
  const release = loadPredicateRelease(designSystemRoot, [
    '007cc201f1166fe3411674225da1bc4e8b967850',
    '04408ef7f3e1e9e85fcca24bc92067ce2ea726cb',
  ]);
  const sourceRuleIds = new Set(
    release.compositionDefinitions
      .flatMap((definition) => compileCompositionContract(definition))
      .concat(release.contourDefinitions.flatMap((definition) => compileContourRule(definition)))
      .map((rule) => rule.ruleId),
  );
  assert.deepEqual(
    [
      'component:web-corp.buttons-group.button-count',
      'component:web-corp.buttons-group.allowed-views',
      'component:web-corp.buttons-group.overflow-enables-last-single-icon',
      'component:web-corp.buttons-group.uniform-size',
      'component:web-corp.buttons-group.single-icon-position',
    ].filter((ruleId) => !sourceRuleIds.has(ruleId)),
    [],
  );
  assert.equal(
    sourceRuleIds.has('component:web-corp.table-view.compact-is-consistent-across-rows'),
    true,
    'TableView Compact must compile from the production predicate contour',
  );
});

test('production rule compiler uses only definitions loaded from the knowledge release', () => {
  const release = loadPredicateRelease(designSystemRoot, [
    '007cc201f1166fe3411674225da1bc4e8b967850',
  ]);
  const rules = compilePredicateReleaseRules(release);
  const ruleIds = new Set(rules.map((rule) => rule.ruleId));
  assert.deepEqual(
    [
      'component:web-corp.buttons-group.allowed-views',
      'component:web-corp.buttons-group.button-count',
      'component:web-corp.buttons-group.overflow-enables-last-single-icon',
      'component:web-corp.buttons-group.single-icon-position',
      'component:web-corp.buttons-group.uniform-size',
    ].filter((ruleId) => !ruleIds.has(ruleId)),
    [],
  );
  assert.equal(
    ruleIds.has('component:web-corp.table-view.compact-is-consistent-across-rows'),
    false,
  );
});

test('every executable rule in the production catalog declares its UI presentation in source', () => {
  const index = JSON.parse(fs.readFileSync(
    path.join(
      designSystemRoot,
      'JSONS/apollo/indexes/componentContractIndex.json',
    ),
    'utf8',
  ));
  const release = loadPredicateRelease(
    designSystemRoot,
    Object.keys(index.components || {}),
  );
  const missing = compilePredicateReleaseRules(release)
    .filter((rule) => (
      !rule.presentation
      || rule.presentation.schemaVersion !== 'apollo.predicate-presentation.v1'
    ))
    .map((rule) => `${rule.ruleId} (${rule.source.path})`);
  assert.deepEqual(missing, []);
});

test('BenefitCard execution policy closes the DS AI Hub rules and exposes executable contours', () => {
  const rulesPath = path.join(
    designSystemRoot,
    'JSONS/web/components/web-corp-promo/BenefitCard/rules.json',
  );
  const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  assert.equal(document.manual.rules.length, 30);
  assert.doesNotThrow(() => validateComponentExecutionPolicy(document, []));

  const release = loadPredicateRelease(designSystemRoot, [
    '61cba21130d5adfd36b798bb4a41f6ccd148c1aa',
  ]);
  assert.deepEqual(
    release.contourDefinitions
      .filter((definition) => definition.ruleId.includes('benefit-card'))
      .map((definition) => [definition.ruleId, definition.kind]),
    [
      ['component:web.benefit-card-bottom-content-link-only', 'fact-domain'],
      ['component:web.benefit-card-platform-version-must-match', 'platform-match'],
      ['component:web.benefit-card.compact-required-at-1024', 'fact-domain'],
      ['component:web.benefit-card.compact-uses-secondary-title', 'fact-domain'],
      ['component:web.benefit-card.public-roots-only', 'public-root'],
      ['component:web.benefit-card.visuals-follow-effective-baseline', 'baseline-set'],
    ],
  );

  const incomplete = structuredClone(document);
  incomplete.manual.executionPolicy.contextOnlyRules.pop();
  assert.throws(
    () => validateComponentExecutionPolicy(incomplete, []),
    /is not closed/,
  );
});

test('ContentCardWrapper projects every human rule into one explicit execution route', () => {
  const rulesPath = path.join(
    designSystemRoot,
    'JSONS/web/components/web-corp/ContentCardWrapper/rules.json',
  );
  const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  assert.equal(document.metadata.status, 'generated-draft');
  assert.equal(document.manual.rules.length, 30);
  assert.doesNotThrow(() => validateComponentExecutionPolicy(document, []));

  const release = loadPredicateRelease(designSystemRoot, [
    '5c53b3d9a9357a015219531e6d4ad1843faeef6b',
  ]);
  assert.deepEqual(
    release.contourDefinitions
      .filter((definition) => definition.ruleId.startsWith('component:web-corp.content-card-wrapper.'))
      .map((definition) => [definition.ruleId, definition.kind])
      .sort(([left], [right]) => left.localeCompare(right)),
    [
      ['component:web-corp.content-card-wrapper.background-plate-level-by-platform', 'context-map'],
      ['component:web-corp.content-card-wrapper.edge-padding-immutable', 'baseline-set'],
      ['component:web-corp.content-card-wrapper.inter-item-gap-tokenized', 'fact-assertion'],
      ['component:web-corp.content-card-wrapper.layer-properties-use-effective-baseline', 'baseline-set'],
      ['component:web-corp.content-card-wrapper.public-root-only', 'public-root'],
      ['component:web-corp.content-card-wrapper.skeleton-variant', 'fact-assertion'],
      ['component:web-corp.content-card-wrapper.slot-placeholder-must-be-replaced', 'slot-contract'],
      ['component:web-corp.content-card-wrapper.text-style-immutable', 'baseline-set'],
    ],
  );

  const contours = new Map(
    release.contourDefinitions
      .filter((definition) => definition.ruleId.startsWith('component:web-corp.content-card-wrapper.'))
      .map((definition) => [definition.ruleId, definition]),
  );
  for (const ruleId of [
    'component:web-corp.content-card-wrapper.skeleton-variant',
    'component:web-corp.content-card-wrapper.edge-padding-immutable',
  ]) {
    assert.ok(
      contours.get(ruleId).select.where.some((condition) => (
        condition.actual?.fact === 'component.family'
        && condition.expected?.literal === 'content-card-wrapper'
      )),
      `${ruleId} must target the public ContentCardWrapper root, not a standalone internal part`,
    );
  }
  const gapContour = contours.get(
    'component:web-corp.content-card-wrapper.inter-item-gap-tokenized',
  );
  const placeholderContour = contours.get(
    'component:web-corp.content-card-wrapper.slot-placeholder-must-be-replaced',
  );
  assert.deepEqual(placeholderContour.slot.families, [
    'left-slot',
    'content-presets',
    'status-slot',
    'right-slot',
  ]);
  assert.equal(placeholderContour.visibleOnly, true);
  assert.ok(
    gapContour.select.where.some((condition) => (
      condition.actual?.fact === 'ownership.contour.root.component.family'
      && condition.expected?.literal === 'content-card-wrapper'
    )),
    'inter-item-gap-tokenized must remain inside a ContentCardWrapper contour',
  );
  assert.ok(
    gapContour.select.where.some((condition) => (
      condition.predicate === 'equals'
      && condition.actual?.fact === 'directOverride.fields.itemSpacing'
      && condition.expected?.literal === true
    )),
    'inter-item-gap-tokenized must evaluate explicitly overridden gaps only, not every nested auto-layout',
  );
  for (const ruleId of [
    'component:web-corp.content-card-wrapper.text-style-immutable',
    'component:web-corp.content-card-wrapper.layer-properties-use-effective-baseline',
  ]) {
    assert.ok(
      contours.get(ruleId).select.where.some((condition) => (
        condition.actual?.fact === 'ownership.contour.root.component.family'
        && condition.expected?.literal === 'content-card-wrapper'
      )),
      `${ruleId} must not inherit the ContentCardWrapper identity from an internal standalone part`,
    );
  }

  const incomplete = structuredClone(document);
  incomplete.manual.executionPolicy.contextOnlyRules.pop();
  assert.throws(
    () => validateComponentExecutionPolicy(incomplete, []),
    /is not closed/,
  );
});

test('TitleView execution policy closes every real component rule exactly once', () => {
  const rulesPath = path.join(
    designSystemRoot,
    'JSONS/web/components/web-corp/TitleView/rules.json',
  );
  const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  const release = loadPredicateRelease(designSystemRoot, [
    '3bfd179dc3b4c996f58db4cbcd26687a356fb3b7',
  ]);
  assert.doesNotThrow(() => validateComponentExecutionPolicy(
    document,
    release.compositionDefinitions.filter((definition) => definition.id.startsWith('title-view.')),
  ));

  const incomplete = structuredClone(document);
  incomplete.manual.executionPolicy.predicateRules.pop();
  assert.throws(
    () => validateComponentExecutionPolicy(
      incomplete,
      release.compositionDefinitions.filter((definition) => definition.id.startsWith('title-view.')),
    ),
    /is not closed/,
  );
});

test('TableView execution policy closes every real component rule and exposes the production contours', () => {
  const rulesPath = path.join(
    designSystemRoot,
    'JSONS/web/components/web-corp/TableView/rules.json',
  );
  const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  assert.equal(document.metadata.status, 'draft');
  assert.equal(document.manual.rules.length, 41);
  assert.doesNotThrow(() => validateComponentExecutionPolicy(document, []));

  const release = loadPredicateRelease(designSystemRoot, [
    '6e9a72189d150779165acb1dde3a800b92daa2f9',
  ]);
  const contourKinds = new Map(
    release.contourDefinitions
      .filter((definition) => definition.ruleId.startsWith('component:web-corp.table-view.'))
      .map((definition) => [definition.ruleId, definition.kind]),
  );
  assert.deepEqual(
    Object.fromEntries(contourKinds),
    {
      'component:web-corp.table-view.horizontal-compact-one-column': 'fact-domain',
      'component:web-corp.table-view.horizontal-multi-column-min-two-data-columns': 'fact-assertion',
      'component:web-corp.table-view.compact-is-consistent-across-rows': 'fact-assertion',
      'component:web-corp.table-view.row-spacing-matches-compact': 'fact-assertion',
      'component:web-corp.table-view.internal-parts-not-standalone': 'public-root',
      'component:web-corp.table-view.manual-visual-overrides-forbidden': 'baseline-set',
      'component:web-corp.table-view.vertical-has-one-data-column': 'fact-domain',
      'component:web-corp.table-view.horizontal-sidepanel-is-single-column-compact': 'fact-assertion',
      'component:web-corp.table-view.horizontal-multi-column-header-required': 'fact-domain',
      'component:web-corp.table-view.public-root-platforms': 'platform-match',
    },
  );

  const incomplete = structuredClone(document);
  incomplete.manual.executionPolicy.contextOnlyRules.pop();
  assert.throws(
    () => validateComponentExecutionPolicy(incomplete, []),
    /is not closed/,
  );
});

test('Core Button execution policy closes every real component rule exactly once', () => {
  const rulesPath = path.join(
    designSystemRoot,
    'JSONS/web/components/web-core/core/Button/rules.json',
  );
  const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  assert.equal(document.manual.rules.length, 12);
  assert.doesNotThrow(() => validateComponentExecutionPolicy(document, []));

  const incomplete = structuredClone(document);
  incomplete.manual.executionPolicy.delegatedRules.pop();
  assert.throws(
    () => validateComponentExecutionPolicy(incomplete, []),
    /is not closed/,
  );
});

test('Core IconView execution policy closes the reusable boundary rules exactly once', () => {
  const rulesPath = path.join(
    designSystemRoot,
    'JSONS/web/components/web-core/core/IconView/rules.json',
  );
  const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  assert.equal(document.metadata.status, 'ready');
  assert.equal(document.manual.rules.length, 5);
  assert.doesNotThrow(() => validateComponentExecutionPolicy(document, []));

  const release = loadPredicateRelease(designSystemRoot, [
    'f188fb1de981b2f32966f4844a4b10cffdb81c35',
    '913a526e98f177533ca3e4495d6658d0120e6afe',
  ]);
  const main = release.componentIndex.f188fb1de981b2f32966f4844a4b10cffdb81c35;
  const content = release.componentIndex['913a526e98f177533ca3e4495d6658d0120e6afe'];
  assert.deepEqual(
    { identity: main.identity, family: main.family, platform: main.platform },
    { identity: 'web-core.icon-view', family: 'icon-view', platform: 'universal' },
  );
  assert.deepEqual(
    { identity: content.identity, family: content.family, platform: content.platform },
    { identity: 'web-core.icon-view', family: 'content', platform: 'universal' },
  );
  assert.deepEqual(
    release.contourDefinitions
      .filter((definition) => definition.ruleId.startsWith('component:web-core.icon-view.'))
      .map((definition) => [definition.ruleId, definition.kind]),
    [
      ['component:web-core.icon-view.layer-properties-use-effective-baseline', 'baseline-set'],
      ['component:web-core.icon-view.public-root-only', 'public-root'],
    ],
  );

  const baselineRule = document.manual.rules.find(
    (rule) => rule.ruleId === 'component:web-core.icon-view.layer-properties-use-effective-baseline',
  );
  assert.equal(baselineRule.appliesTo, 'layout.*|radius|opacity');
  assert.equal(
    baselineRule.predicateContour.paths.some((entry) =>
      ['appearance.fill.value', 'appearance.stroke.value'].includes(entry.actualFact),
    ),
    false,
  );
  const paintRule = document.manual.rules.find(
    (rule) => rule.ruleId === 'component:web-core.icon-view.paint-colors-are-public-settings',
  );
  assert.equal(paintRule.classification.treatAsViolation, false);
  assert.equal(paintRule.authority.status, 'active');

  const incomplete = structuredClone(document);
  incomplete.manual.executionPolicy.contextOnlyRules.pop();
  assert.throws(
    () => validateComponentExecutionPolicy(incomplete, []),
    /is not closed/,
  );
});

test('ButtonsGroup execution policy closes every source rule and both platform contracts', () => {
  const rulesPath = path.join(
    designSystemRoot,
    'JSONS/web/components/web-corp/ButtonGroup [D]/rules.json',
  );
  const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  const release = loadPredicateRelease(designSystemRoot, [
    'f05915599f71e822fd8b46a2b2509a2e395005cf',
  ]);
  const definitions = release.compositionDefinitions.filter(
    (definition) => definition.id.startsWith('buttons-group.'),
  );
  assert.equal(document.manual.rules.length, 32);
  assert.deepEqual(
    definitions.map((definition) => definition.id),
    ['buttons-group.desktop-composition', 'buttons-group.mobile-composition'],
  );
  assert.doesNotThrow(() => validateComponentExecutionPolicy(document, definitions));

  const incomplete = structuredClone(document);
  incomplete.manual.executionPolicy.contextOnlyRules.pop();
  assert.throws(
    () => validateComponentExecutionPolicy(incomplete, definitions),
    /is not closed/,
  );
});

test('BackgroundPlate execution policy closes every real component rule exactly once', () => {
  const rulesPath = path.join(
    designSystemRoot,
    'JSONS/web/components/web-corp/BackgroundPlate/rules.json',
  );
  const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  assert.equal(document.manual.rules.length, 30);
  assert.doesNotThrow(() => validateComponentExecutionPolicy(document, []));

  const release = loadPredicateRelease(designSystemRoot, [
    '5b6c5ac720154aff36be2f8a883bd058faa663cf',
    '1745af83255e324781c2fbadfe0ad8cc7f13e0d8',
  ]);
  assert.deepEqual(
    release.contourDefinitions
      .filter((definition) => definition.ruleId.startsWith('component:web-corp.background-plate.'))
      .filter((definition) => ['public-root', 'platform-match'].includes(definition.kind))
      .map((definition) => definition.ruleId)
      .sort(),
    [
      'component:web-corp.background-plate.platform-version-must-match',
      'component:web-corp.background-plate.public-roots-only',
    ],
  );

  const incomplete = structuredClone(document);
  incomplete.manual.executionPolicy.contextOnlyRules.pop();
  assert.throws(
    () => validateComponentExecutionPolicy(incomplete, []),
    /is not closed/,
  );
});

test('Benefits production policy closes every rule and exposes only declared predicates', () => {
  const rulesPath = path.join(
    designSystemRoot,
    'JSONS/web/components/web-corp-promo/Benefits/rules.json',
  );
  const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  assert.equal(document.manual.rules.length, 19);
  assert.doesNotThrow(() => validateComponentExecutionPolicy(document, []));

  const release = loadPredicateRelease(designSystemRoot, [
    '5eb973ab22e01c40d556cc600f1a5c15101b8192',
  ]);
  assert.equal(
    release.componentIndex['5eb973ab22e01c40d556cc600f1a5c15101b8192'].identity,
    'web.benefits',
  );
  assert.deepEqual(
    release.contourDefinitions
      .filter((definition) => definition.ruleId.startsWith('component:web.benefits.'))
      .map((definition) => definition.ruleId)
      .sort(),
    [
      'component:web.benefits.capacity-matches-card-count',
      'component:web.benefits.fill-width-hug-height',
      'component:web.benefits.nested-card-settings-are-uniform',
    ],
  );
});

test('ButtonStack production policy closes all rules without inventing predicates', () => {
  const rulesPath = path.join(
    designSystemRoot,
    'JSONS/web/components/web-corp/ButtonStack [M]/rules.json',
  );
  const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  assert.equal(document.manual.rules.length, 15);
  assert.doesNotThrow(() => validateComponentExecutionPolicy(document, []));

  const release = loadPredicateRelease(designSystemRoot, [
    '1e9261fa9df082fa82b6ec3b42b429797f906cd9',
  ]);
  assert.equal(
    release.componentIndex['1e9261fa9df082fa82b6ec3b42b429797f906cd9'].identity,
    'web-corp.button-stack',
  );
  assert.deepEqual(
    release.contourDefinitions.filter(
      (definition) => definition.ruleId.startsWith('component:web-corp.button-stack.'),
    ),
    [],
  );
});

test('supporting packages are production-closed and expose only approved contours', () => {
  const packages = [
    ['web/components/web-core/core/Amount', 'web-core.amount', 2],
    ['web/components/web-core/core/TagGroup', 'web-core.tag-group', 1],
    ['web/components/web-corp/PaymentMaskedNumber', 'web-corp.payment-masked-number', 9],
  ];
  const figmaKeys = [
    'fe3399f71c9e0971646821d935b64657e462c28e',
    'a3dc186947232ebf1978ba767c8d46fc355e3b3e',
    'bd25bbd83bfc28176b42284659f21c8a7cd8e97b',
  ];
  const release = loadPredicateRelease(designSystemRoot, figmaKeys);

  for (const [packagePath, identity, predicateCount] of packages) {
    const rulesPath = path.join(designSystemRoot, 'JSONS', packagePath, 'rules.json');
    const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
    assert.doesNotThrow(() => validateComponentExecutionPolicy(document, []), identity);
    assert.equal(
      release.contourDefinitions.filter(
        (definition) => definition.ruleId.startsWith(`component:${identity}.`),
      ).length,
      predicateCount,
      identity,
    );
  }

  assert.deepEqual(
    release.contourDefinitions
      .filter((definition) => (
        definition.ruleId.startsWith('component:web-corp.payment-masked-number.')
      ))
      .map((definition) => definition.ruleId)
      .sort(),
    [
      'component:web-corp.payment-masked-number.addon-geometry',
      'component:web-corp.payment-masked-number.addon-uses-final-component',
      'component:web-corp.payment-masked-number.mask-format',
      'component:web-corp.payment-masked-number.minor-last-four-digits',
      'component:web-corp.payment-masked-number.parts-share-color-token',
      'component:web-corp.payment-masked-number.public-root-only',
      'component:web-corp.payment-masked-number.text-style-binding-required',
      'component:web-corp.payment-masked-number.typography-follows-effective-pair',
      'component:web-corp.payment-masked-number.unmasked-major-format',
    ],
  );

  assert.deepEqual(
    compilePredicateReleaseRules(release)
      .filter((rule) => rule.ruleId.startsWith('component:web-corp.payment-masked-number.addon-'))
      .map((rule) => rule.ruleId)
      .sort(),
    [
      'component:web-corp.payment-masked-number.addon-geometry.gap',
      'component:web-corp.payment-masked-number.addon-geometry.height',
      'component:web-corp.payment-masked-number.addon-uses-final-component',
    ],
  );
});

test('FilterCompanySelect execution policy closes every real component rule exactly once', () => {
  const rulesPath = path.join(
    designSystemRoot,
    'JSONS/web/components/web-corp/FilterCompanySelect/rules.json',
  );
  const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  assert.equal(document.manual.rules.length, 28);
  assert.doesNotThrow(() => validateComponentExecutionPolicy(document, []));
  assert.equal(
    document.manual.rules.some((rule) => (
      rule.ruleId === 'component:web-corp.filter-company-select.selected-value-content'
    )),
    false,
    'selected-value display is delegated to its nested owners',
  );
  assert.equal(
    document.manual.executionPolicy.contextOnlyRules.some((entry) => (
      entry.sourceRuleId === 'component:web-corp.filter-company-select.form-uses-select-view'
    )),
    false,
    'holding scenario rules are not component-owned routes',
  );

  const incomplete = structuredClone(document);
  incomplete.manual.executionPolicy.contextOnlyRules.pop();
  assert.throws(
    () => validateComponentExecutionPolicy(incomplete, []),
    /is not closed/,
  );
});

test('PromoMainBlock projects 25 owner-confirmed rules into explicit execution routes', () => {
  const rulesPath = path.join(
    designSystemRoot,
    'JSONS/web/components/web-corp-promo/PromoMainBlock/rules.json',
  );
  const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  assert.equal(document.manual.rules.length, 25);
  assert.doesNotThrow(() => validateComponentExecutionPolicy(document, []));

  const release = loadPredicateRelease(designSystemRoot, [
    'e691885120337235bc0443186870e7b120567f40',
    '3b7ac57095a531c933b5960841f09f94b6324988',
  ]);
  const promoContours = release.contourDefinitions
    .filter((definition) => definition.ruleId.startsWith('component:web.promo-main-block.'))
    .map((definition) => [definition.ruleId, definition.kind])
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(promoContours, [
    ['component:web.promo-main-block.background-matrix', 'fact-assertion'],
    ['component:web.promo-main-block.bottom-slot-final-content', 'fact-domain'],
    ['component:web.promo-main-block.desktop-actions-follow-baseline', 'baseline-set'],
    ['component:web.promo-main-block.desktop-blur-required', 'fact-domain'],
    ['component:web.promo-main-block.desktop-compact-under-1024', 'fact-domain'],
    ['component:web.promo-main-block.image-source-and-settings', 'fact-assertion'],
    ['component:web.promo-main-block.layout-is-component-owned', 'fact-assertion'],
    ['component:web.promo-main-block.mobile-internal-button-group-warning', 'fact-domain'],
    ['component:web.promo-main-block.public-roots-only', 'public-root'],
    ['component:web.promo-main-block.required-content', 'required-regions'],
    ['component:web.promo-main-block.title-subtitle-visuals-follow-baseline', 'baseline-set'],
  ]);

  const incomplete = structuredClone(document);
  incomplete.manual.executionPolicy.contextOnlyRules.pop();
  assert.throws(
    () => validateComponentExecutionPolicy(incomplete, []),
    /is not closed/,
  );
});

test('AccountSelect execution policy closes every real component rule exactly once', () => {
  const rulesPath = path.join(
    designSystemRoot,
    'JSONS/web/components/web-corp/AccountSelect/rules.json',
  );
  const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  assert.equal(document.manual.rules.length, 41);
  assert.doesNotThrow(() => validateComponentExecutionPolicy(document, []));

  const incomplete = structuredClone(document);
  incomplete.manual.executionPolicy.contextOnlyRules.pop();
  assert.throws(
    () => validateComponentExecutionPolicy(incomplete, []),
    /is not closed/,
  );
});

test('next ten Corp packages close every source rule and compile from canonical Figma keys', () => {
  const packages = [
    ['AmountStyles', '46d9453084998704a7c26aefd8c2d4427e3a4f5c', 'web-corp.amount-styles'],
    ['CorporateAppHeaderNew [D]', 'd187029a0a1af08dbb499e13b3ef2ac98efaaac2', 'web-corp.corporate-app-header-new'],
    ['CorporateSystemMessage', '985497c1f5a102a52e4d4dc40b6953303db72f8e', 'web-corp.corporate-system-message'],
    ['CorporateTopbar [D]', '636e6d4474770d65d5b077757a9c1c62c08a8f8c', 'web-corp.corporate-topbar'],
    ['FAQ', '4ea9c627c5990f79b4acff821221db8cc1191308', 'web-corp.faq'],
    ['HoldingPlate', '2ae29ad1eedf15fcc9cdc927a718121e3595f156', 'web-corp.holding-plate'],
    ['ScenarioModel ! interruption', 'f7644c318f200ae2d63acba8f6def7a1aa3a749b', 'web-corp.scenario-model-interruption'],
    ['Table Basic [D]', 'aca58bac6a6137109081a0f7289424b5a240d0fd', 'web-corp.table-basic-d'],
    ['Table Wide [D]', '4ebc8002c21ea12d0e149fb782cdf0b219769a8a', 'web-corp.table-wide-d'],
    ['[D] FilterCompanySelect_UniversalModal', '9a23ab30e0b4c5e60362fd0eb4905e9fe1fc1b21', 'web-corp.filter-company-select-universal-modal'],
  ];
  const release = loadPredicateRelease(designSystemRoot, packages.map((entry) => entry[1]));
  const canonicalRootFamilies = new Map([
    ['web-corp.amount-styles', ['amount-headline', 'amount-paragraph']],
    ['web-corp.corporate-app-header-new', ['header', 'side-menu', '768-header-menu']],
    ['web-corp.corporate-system-message', ['corporate-system-message']],
    ['web-corp.corporate-topbar', ['top-bar']],
    ['web-corp.faq', ['faq']],
    ['web-corp.scenario-model-interruption', ['scenario-model-interruption']],
  ]);
  const platformPublicFamilies = new Map([
    ['web-corp.amount-styles', ['amount-headline', 'amount-paragraph']],
    ['web-corp.corporate-app-header-new', ['header', 'side-menu', '768-header-menu']],
    ['web-corp.corporate-system-message', ['corporate-system-message']],
    ['web-corp.corporate-topbar', ['top-bar']],
    ['web-corp.holding-plate', ['holding-plate']],
    ['web-corp.scenario-model-interruption', ['scenario-model-interruption']],
    ['web-corp.table-basic-d', [
      'body-action-cell-basic',
      'body-cell-basic',
      'body-control-cell-basic',
      'group-divider-basic',
      'body-cell',
      'body-row-basic',
    ]],
    ['web-corp.table-wide-d', [
      'body-action-cell-wide',
      'body-cell-wide',
      'body-control-cell-wide',
      'head-action-cell',
      'head-cell',
      'head-control-cell',
      'body-group-row-wide',
      'body-row-wide',
      'head-row-universal',
    ]],
    ['web-corp.filter-company-select-universal-modal', [
      'filter-company-select-universal-modal',
    ]],
  ]);
  for (const [directory, , identity] of packages) {
    const rulesPath = path.join(
      designSystemRoot,
      `JSONS/web/components/web-corp/${directory}/rules.json`,
    );
    const document = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
    assert.doesNotThrow(() => validateComponentExecutionPolicy(document, []), directory);
    assert.ok(
      release.contourDefinitions.some((definition) => definition.ruleId.startsWith(`component:${identity}.`)),
      `${directory} has no compiled contour`,
    );
    if (canonicalRootFamilies.has(identity)) {
      const publicBoundary = release.contourDefinitions.find((definition) => (
        definition.kind === 'fact-domain'
        && definition.actual?.fact === 'component.family'
        && definition.select?.where?.some((condition) => (
          condition.actual?.fact === 'component.identity'
          && condition.expected?.literal === identity
        ))
      ));
      assert.ok(publicBoundary, `${directory} has no stable root-family contour`);
      assert.deepEqual(
        publicBoundary.allowedValues,
        canonicalRootFamilies.get(identity),
        `${directory} public families are not canonical`,
      );
    }
    if (platformPublicFamilies.has(identity)) {
      const platformRule = release.contourDefinitions.find((definition) => (
        definition.kind === 'platform-match' && definition.identity === identity
      ));
      assert.ok(platformRule, `${directory} has no platform contour`);
      assert.deepEqual(
        platformRule.publicFamilies,
        platformPublicFamilies.get(identity),
        `${directory} platform contour has no explicit public boundary`,
      );
    }
  }
});

test('predicate release resolves canonical Figma keys and pins source checksums', () => {
  const release = loadPredicateRelease(designSystemRoot, [
    'f05915599f71e822fd8b46a2b2509a2e395005cf',
    '0012e7a5e420b87136b910b29578a4d06e6dd30c',
    '0b1fd301e14ae7dab9eb62de83c8f4b8d9eab376',
    '0fb58a88030651af939c278b544143643cdd1223',
    '6e9a72189d150779165acb1dde3a800b92daa2f9',
    'af607289bf050cc8236b882039cf787d32296383',
    '77938b4511abfbafdd13b13f6bb6f3fbe87cf2a2',
    '1043a9208a949b1af3f708637de5fd13721a4519',
    '7b188529df2fdf9c6e93989b2173f6cc95fc77d6',
    'b0e271a2c5e94e00b753d223c1bce95b87da95af',
    '0ccaf9d784aa8b603d6229a898f46433ee74b925',
    'd115bb68174c21fe7475748dc31f651221db4558',
    '1e8647f2b51a623083755fdad5c677fc38770e3e',
    '26b847ef2dadd62ff9728ab50c728f6c7dcef455',
    'a54fc8de49f424f46ddb87e1f14103cda8a5456e',
    '3bfd179dc3b4c996f58db4cbcd26687a356fb3b7',
    '6d5d4dda10be00621991e9b5a0152db4e47f4e2f',
    '2bbced82d96c1347fea71a3922cd11cf4c25ad6a',
    '44f1398a704dba217a9da9694913ec61b5bb15bf',
    'e0b688215640e6280ff9effdbf880ccf248cc65a',
    'c9a8db25e3fb6bc7907464f81547a6295816c59b',
  ]);
  assert.equal(release.release.knowledgeSource, 'design-system_ab');
  assert.equal(release.release.checksum.length, 64);
  assert.deepEqual(
    Object.keys(release.sourceChecksums).sort(),
    [
      'design-system_ab/JSONS/web/components/web-core/core/Button/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-core/core/Status/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-corp-promo/BenefitCard/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-corp-promo/Benefits/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-corp/AccountSelect/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-corp/BackgroundPlate/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-corp/ButtonGroup [D]/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-corp/CardImage/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-corp/CardSwiperMobile [M]/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-corp/CorporateContent/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-corp/Onboarding Tooltip [D]/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-corp/Status & Property/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-corp/TableView/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-corp/TabsView/composition-contract.json',
      'design-system_ab/JSONS/web/components/web-corp/TitleView/composition-contract.json',
    ],
  );
  for (const checksum of Object.values(release.sourceChecksums)) {
    assert.match(checksum, /^[a-f0-9]{64}$/);
  }
  assert.equal(release.compositionDefinitions.length, 6);
  assert.deepEqual(
    release.compositionDefinitions.map((definition) => definition.id),
    [
      'buttons-group.desktop-composition',
      'buttons-group.mobile-composition',
      'title-view.button-group.composition',
      'title-view.desktop-button-size.composition',
      'title-view.mobile-button-size.composition',
      'title-view.status.composition',
    ],
  );
  assert.equal(
    release.compositionDefinitions[0].schemaVersion,
    'apollo.composition-predicate-contract.v1',
  );
  assert.deepEqual(
    release.compositionDefinitions[0].match.hostComponentIdentities,
    ['web-corp.buttons-group'],
  );
  assert.equal(release.compositionDefinitions[0].sourceChecksum.length, 64);
  assert.equal(release.slotOrderPolicies.length, 1);
  assert.equal(
    release.slotOrderPolicies[0].ruleId,
    'component:web-corp.title-view.visible-slots-follow-required-order',
  );
  assert.deepEqual(
    release.slotOrderPolicies[0].ownerComponentIdentities,
    ['web-corp.title-view', 'web-corp.title-view-mobile'],
  );
  assert.deepEqual(release.slotOrderPolicies[0].containerNames, ['MainContent']);
  assert.equal(release.slotOrderPolicies[0].sourceChecksum.length, 64);

  const buttonsGroup = release.componentIndex.f05915599f71e822fd8b46a2b2509a2e395005cf;
  assert.equal(buttonsGroup.identity, 'web-corp.buttons-group');
  assert.equal(buttonsGroup.lifecycle, 'active');
  assert.equal(buttonsGroup.library, 'Web _ Corp Components');

  const button = release.componentIndex['0012e7a5e420b87136b910b29578a4d06e6dd30c'];
  assert.equal(button.identity, 'web-core.button');
  const buttonFillContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-core.button.manual-fill-is-layer-property'
  ));
  assert.equal(
    buttonFillContour.sourcePath,
    'design-system_ab/JSONS/web/components/web-core/core/Button/rules.json',
  );
  const desktopButtonContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'rule:controls.buttons-and-button-groups.desktop-safe-variants'
  ));
  assert.equal(
    desktopButtonContour.sourcePath,
    'design-system_ab/patterns/p_buttons-and-buttons-group.md',
  );
  assert.equal(desktopButtonContour.kind, 'fact-assertion');

  const benefits = release.componentIndex['0b1fd301e14ae7dab9eb62de83c8f4b8d9eab376'];
  assert.equal(benefits.identity, 'web.benefits');
  const benefitCard = release.componentIndex['0fb58a88030651af939c278b544143643cdd1223'];
  assert.equal(benefitCard.identity, 'web.benefit-card');
  const tableView = release.componentIndex['6e9a72189d150779165acb1dde3a800b92daa2f9'];
  assert.equal(tableView.identity, 'web-corp.table-view');
  assert.equal(tableView.family, 'table-view-horizontal');
  const tableRow = release.componentIndex.af607289bf050cc8236b882039cf787d32296383;
  assert.equal(tableRow.family, 'row');
  const cardImage = release.componentIndex.e0b688215640e6280ff9effdbf880ccf248cc65a;
  assert.equal(cardImage.identity, 'web-corp.card-image');
  const compactOneColumnContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.table-view.horizontal-compact-one-column'
  ));
  assert.deepEqual(compactOneColumnContour, {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'fact-domain',
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
    scope: { platform: ['desktop', 'mobile-web'] },
    unknownPolicy: 'not-evaluable',
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: 'В Compact TableView обнаружено несколько колонок данных',
      observed: 'В строке Compact TableView найдено колонок данных: {{actual}}.',
      expectation: 'Каждая Body Row в Horizontal TableView с Compact=true должна содержать ровно одну колонку данных.',
      action: 'Оставить в строке одну колонку данных или отключить Compact.',
    },
    ruleId: 'component:web-corp.table-view.horizontal-compact-one-column',
    revision: 3,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/TableView/rules.json',
    sourceChecksum: compactOneColumnContour.sourceChecksum,
    sourceAnchor: 'rules/component:web-corp.table-view.horizontal-compact-one-column',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
  });
  assert.equal(compactOneColumnContour.sourceChecksum.length, 64);
  const accountItemSum = release.componentIndex['7b188529df2fdf9c6e93989b2173f6cc95fc77d6'];
  const accountItemNumber = release.componentIndex['b0e271a2c5e94e00b753d223c1bce95b87da95af'];
  const accountSelectDesktop = release.componentIndex['77938b4511abfbafdd13b13f6bb6f3fbe87cf2a2'];
  const accountSelectMobile = release.componentIndex['1043a9208a949b1af3f708637de5fd13721a4519'];
  assert.equal(accountItemSum.identity, 'web-corp.account-select');
  assert.equal(accountItemNumber.identity, 'web-corp.account-select');
  assert.equal(accountItemSum.family, 'account-item');
  assert.equal(accountItemNumber.family, 'account-item');
  assert.equal(accountSelectDesktop.platform, 'desktop');
  assert.equal(accountSelectMobile.platform, 'mobile-web');
  const cardSwiper360 = release.componentIndex['0ccaf9d784aa8b603d6229a898f46433ee74b925'];
  const cardSwiper320 = release.componentIndex.d115bb68174c21fe7475748dc31f651221db4558;
  assert.equal(cardSwiper360.identity, 'web-corp.card-swiper-mobile');
  assert.equal(cardSwiper320.identity, 'web-corp.card-swiper-mobile');
  assert.equal(cardSwiper360.family, 'card-swiper-mobile');
  assert.equal(cardSwiper320.family, 'card-swiper-mobile');
  const accountSelectContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.account-select.public-roots-only'
  ));
  assert.deepEqual(accountSelectContour, {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'public-root',
    identity: 'web-corp.account-select',
    standaloneOnly: true,
    familyFact: 'component.family',
    allowedFamilies: ['account-option-list-content'],
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: 'Служебный компонент AccountSelect используется отдельно',
      observed: '{{actual}} размещён как самостоятельный компонент.',
      expectation: 'Самостоятельно допускается использовать только {{expected}}.',
      action: 'Заменить {{actual}} на {{expected}}.',
      valueLabels: {
        'account-item': 'AccountItem',
        'account-option-list-content': 'AccountOptionListContent',
      },
    },
    scope: { platform: ['desktop', 'mobile-web'] },
    unknownPolicy: 'not-evaluable',
    ruleId: 'component:web-corp.account-select.public-roots-only',
    revision: 1,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/AccountSelect/rules.json',
    sourceChecksum: accountSelectContour.sourceChecksum,
    sourceAnchor: 'rules/component:web-corp.account-select.public-roots-only',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
  });
  assert.equal(accountSelectContour.sourceChecksum.length, 64);

  const accountSelectPlatformContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.account-select.platform-match'
  ));
  assert.equal(accountSelectPlatformContour.kind, 'platform-match');
  assert.equal(accountSelectPlatformContour.identity, 'web-corp.account-select');
  assert.equal(accountSelectPlatformContour.publicRootOnly, true);
  assert.deepEqual(accountSelectPlatformContour.publicFamilies, ['account-option-list-content']);
  assert.deepEqual(accountSelectPlatformContour.supportedPlatforms, ['desktop', 'mobile-web']);
  assert.equal(accountSelectPlatformContour.sourceChecksum.length, 64);

  const accountSelectUniformContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.account-select.list-content-is-uniform'
  ));
  assert.deepEqual(accountSelectUniformContour, {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'uniform-allowed-collection',
    identity: 'web-corp.account-select',
    where: [{
      predicate: 'equals',
      actual: { fact: 'component.family' },
      expected: { literal: 'account-option-list-content' },
    }],
    allowedValues: ['Sum', 'Number'],
    minimumCount: 1,
    query: {
      from: 'subject',
      traverse: 'descendants',
      where: [{
        predicate: 'equals',
        actual: { fact: 'component.family' },
        expected: { literal: 'account-item' },
      }],
      project: { fact: 'component.properties.Type' },
    },
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: 'Строки AccountSelect используют разные или недопустимые типы',
      observed: 'В AccountSelect обнаружены значения AccountItem.Type: {{actual}}.',
      expectation: 'В списке должна быть хотя бы одна строка; все строки используют одинаковый Type=Sum или Type=Number.',
      action: 'Выбрать для всех строк один допустимый Type: Sum или Number.',
      targetFact: 'component.properties.Type',
    },
    scope: { platform: ['desktop', 'mobile-web'] },
    unknownPolicy: 'not-evaluable',
    ruleId: 'component:web-corp.account-select.list-content-is-uniform',
    revision: 1,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/AccountSelect/rules.json',
    sourceChecksum: accountSelectUniformContour.sourceChecksum,
    sourceAnchor: 'rules/component:web-corp.account-select.list-content-is-uniform',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
  });
  assert.equal(accountSelectUniformContour.sourceChecksum.length, 64);

  const cardSwiperBreakpointContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.card-swiper-mobile.screen-size-follows-viewport'
  ));
  assert.deepEqual(cardSwiperBreakpointContour, {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'breakpoint-map',
    identity: 'web-corp.card-swiper-mobile',
    widthFact: 'page.context.viewportWidth',
    targetFact: 'component.properties.Screen Size',
    ranges: [{
      lower: 320,
      upper: 359,
      bounds: 'inclusive',
      expected: '320-360',
    }, {
      lower: 360,
      expected: '360+',
    }],
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: 'Screen Size не соответствует ширине страницы',
      observed: 'При ширине {{context}} px выбран Screen Size={{actual}}.',
      expectation: 'При ширине 320–359 px используется Screen Size=320-360; при ширине от 360 px — Screen Size=360+.',
      action: 'Выбрать Screen Size, соответствующий ширине страницы.',
      contextFact: 'page.context.viewportWidth',
      targetFact: 'component.properties.Screen Size',
    },
    scope: { platform: ['mobile-web'] },
    unknownPolicy: 'not-evaluable',
    ruleId: 'component:web-corp.card-swiper-mobile.screen-size-follows-viewport',
    revision: 1,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/CardSwiperMobile [M]/rules.json',
    sourceChecksum: cardSwiperBreakpointContour.sourceChecksum,
    sourceAnchor: 'rules/component:web-corp.card-swiper-mobile.screen-size-follows-viewport',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
  });
  assert.equal(cardSwiperBreakpointContour.sourceChecksum.length, 64);

  const benefitsSizingContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web.benefits.fill-width-hug-height'
  ));
  assert.deepEqual(benefitsSizingContour, {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'sizing',
    identity: 'web.benefits',
    expectations: {
      'layout.sizingHorizontal': 'FILL',
      'layout.sizingVertical': 'HUG',
    },
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: 'Sizing компонента Benefits изменён',
      observed: 'Размер корня Benefits не соответствует контракту Fill по ширине и Hug по высоте.',
      expectation: 'Корень Benefits должен использовать Fill container по ширине и Hug contents по высоте.',
      action: 'Установить для Benefits ширину Fill и высоту Hug.',
    },
    scope: { platform: ['desktop', 'mobile-web'] },
    unknownPolicy: 'not-evaluable',
    ruleId: 'component:web.benefits.fill-width-hug-height',
    revision: 1,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp-promo/Benefits/rules.json',
    sourceChecksum: benefitsSizingContour.sourceChecksum,
    sourceAnchor: 'rules/component:web.benefits.fill-width-hug-height',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
  });
  assert.equal(benefitsSizingContour.sourceChecksum.length, 64);

  const buttonsGroupSizingContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.buttons-group.root-sizing-is-hug-hug'
  ));
  assert.deepEqual(buttonsGroupSizingContour, {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'sizing',
    identity: 'web-corp.buttons-group',
    expectations: {
      'layout.sizingHorizontal': 'HUG',
      'layout.sizingVertical': 'HUG',
    },
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: 'Sizing ButtonsGroup изменён',
      observed: 'Размер корня ButtonsGroup не соответствует контракту Hug по ширине и Hug по высоте.',
      expectation: 'Корень ButtonsGroup должен использовать Hug contents по обеим осям.',
      action: 'Установить для ButtonsGroup ширину Hug и высоту Hug.',
    },
    scope: { platform: ['desktop', 'mobile-web'] },
    unknownPolicy: 'not-evaluable',
    ruleId: 'component:web-corp.buttons-group.root-sizing-is-hug-hug',
    revision: 2,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/ButtonGroup [D]/rules.json',
    sourceChecksum: buttonsGroupSizingContour.sourceChecksum,
    sourceAnchor: 'rules/component:web-corp.buttons-group.root-sizing-is-hug-hug',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
  });
  assert.equal(buttonsGroupSizingContour.sourceChecksum.length, 64);

  const titleViewBaselineContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.title-view.root-style-and-clickability-prohibited'
  ));
  assert.equal(titleViewBaselineContour.kind, 'baseline-set');
  assert.equal(titleViewBaselineContour.revision, 2);
  assert.deepEqual(
    titleViewBaselineContour.paths.map((item) => item.suffix),
    ['fill', 'stroke', 'radius', 'opacity'],
  );
  assert.equal(
    titleViewBaselineContour.sourcePath,
    'design-system_ab/JSONS/web/components/web-corp/TitleView/rules.json',
  );
  assert.equal(titleViewBaselineContour.sourceChecksum.length, 64);

  const backgroundPlateRadiusBaselineContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.background-plate.radius-is-fixed-by-component-baseline'
  ));
  assert.deepEqual(backgroundPlateRadiusBaselineContour, {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'baseline',
    identity: 'web-corp.background-plate',
    pairs: [{
      actualFact: 'appearance.radius',
      baselineFact: 'baseline.effective.appearance.radius',
    }],
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: 'Изменено скругление BackgroundPlate',
      observed: 'Скругление изменено с {{expected}} на {{actual}}.',
      expectation: 'Скругление BackgroundPlate должно совпадать с effective baseline выбранного варианта.',
      action: 'Сбросить скругление BackgroundPlate к effective baseline.',
      targetFact: 'appearance.radius',
    },
    scope: { platform: ['desktop', 'mobile-web'] },
    unknownPolicy: 'not-evaluable',
    ruleId: 'component:web-corp.background-plate.radius-is-fixed-by-component-baseline',
    revision: 2,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/BackgroundPlate/rules.json',
    sourceChecksum: backgroundPlateRadiusBaselineContour.sourceChecksum,
    sourceAnchor: 'rules/component:web-corp.background-plate.radius-is-fixed-by-component-baseline',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
  });
  assert.equal(backgroundPlateRadiusBaselineContour.sourceChecksum.length, 64);

  const titleViewTypographyContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.title-view.title-and-subtitle-typography-is-fixed'
  ));
  assert.equal(titleViewTypographyContour.kind, 'baseline');
  assert.deepEqual(titleViewTypographyContour.pairs, [{
    actualFact: 'appearance.styles.textStyle',
    baselineFact: 'baseline.effective.appearance.styles.textStyle',
    required: true,
  }]);
  assert.equal(titleViewTypographyContour.select.traverse, 'descendants');
  assert.equal(titleViewTypographyContour.sourceChecksum.length, 64);

  const titleViewColorContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.title-view.title-and-subtitle-color-is-fixed'
  ));
  assert.equal(titleViewColorContour.kind, 'baseline');
  assert.deepEqual(titleViewColorContour.pairs, [{
    actualFact: 'appearance.fill.value',
    baselineFact: 'baseline.effective.appearance.fill.value',
    required: true,
  }]);
  assert.equal(titleViewColorContour.select.traverse, 'descendants');
  assert.equal(titleViewColorContour.revision, 2);
  assert.equal(titleViewColorContour.sourceChecksum.length, 64);

  const onboardingTooltipFillContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.onboarding-tooltip.visuals-follow-effective-baseline'
  ));
  assert.equal(onboardingTooltipFillContour.kind, 'baseline');
  assert.equal(onboardingTooltipFillContour.select.traverse, 'descendants');
  assert.deepEqual(onboardingTooltipFillContour.select.where, [{
    predicate: 'equals',
    actual: { fact: 'ownership.owner.component.identity' },
    expected: { literal: 'web-corp.onboarding-tooltip' },
  }, {
    predicate: 'exists',
    actual: { fact: 'appearance.fill.value' },
  }]);
  assert.deepEqual(onboardingTooltipFillContour.pairs, [{
    actualFact: 'appearance.fill.value',
    baselineFact: 'baseline.effective.appearance.fill.value',
    required: true,
  }]);
  assert.equal(onboardingTooltipFillContour.revision, 2);
  assert.equal(onboardingTooltipFillContour.sourceChecksum.length, 64);

  const onboardingTooltipTypographyContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.onboarding-tooltip.typography-follows-effective-baseline'
  ));
  assert.equal(onboardingTooltipTypographyContour.kind, 'baseline');
  assert.deepEqual(onboardingTooltipTypographyContour.pairs, [{
    actualFact: 'appearance.styles.textStyle',
    baselineFact: 'baseline.effective.appearance.styles.textStyle',
    required: true,
  }]);
  assert.equal(onboardingTooltipTypographyContour.select.traverse, 'descendants');

  const onboardingTooltipTextStyleBindingContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.onboarding-tooltip.text-style-binding-required'
  ));
  assert.equal(onboardingTooltipTextStyleBindingContour.kind, 'binding-set');
  assert.equal(onboardingTooltipTextStyleBindingContour.paths[0].requireValue, false);
  assert.deepEqual(onboardingTooltipTextStyleBindingContour.expectedBinding, {
    bound: true,
    kind: 'text-style',
  });
  assert.equal(onboardingTooltipTextStyleBindingContour.select.traverse, 'descendants');

  const titleViewStatusContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.title-view.status-and-title-status-color-match'
  ));
  assert.equal(titleViewStatusContour.kind, 'owned-peer-property-equality');
  assert.deepEqual(titleViewStatusContour.ownerIdentities, [
    'web-corp.title-view',
    'web-corp.title-view-mobile',
  ]);
  assert.deepEqual(titleViewStatusContour.target, {
    identities: ['web-corp.title-view', 'web-corp.title-view-mobile'],
    names: ['[D] TitleStatus', '[M] TitleStatus'],
  });
  assert.deepEqual(titleViewStatusContour.requiredRoles, ['Status', 'TitleStatus']);
  assert.deepEqual(
    titleViewStatusContour.members.map((member) => member.propertyFact),
    ['component.properties.Type', 'component.properties.Type'],
  );
  assert.equal(titleViewStatusContour.collectionKey, 'statusTypeConsistency');

  const titleStatusRequiresStatusContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.title-view.title-status-requires-status'
  ));
  assert.equal(titleStatusRequiresStatusContour.kind, 'fact-domain');
  assert.equal(titleStatusRequiresStatusContour.revision, 2);
  assert.deepEqual(titleStatusRequiresStatusContour.actual, {
    fact: 'component.properties.Status',
  });
  assert.deepEqual(titleStatusRequiresStatusContour.allowedValues, [true]);
  assert.equal(
    titleStatusRequiresStatusContour.select.where.some((condition) => (
      condition.actual?.fact === 'component.properties.TitleStatus' &&
      condition.expected?.literal === true
    )),
    true,
  );
  assert.equal(
    titleStatusRequiresStatusContour.select.where.some((condition) => (
      condition.actual?.fact === 'component.properties.View' &&
      condition.expected?.literal === 'xLarge'
    )),
    true,
  );
  assert.equal(titleStatusRequiresStatusContour.sourceChecksum.length, 64);

  const cardImageXsStateContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.card-image.xs-active-only'
  ));
  assert.equal(cardImageXsStateContour.kind, 'fact-domain');
  assert.equal(cardImageXsStateContour.revision, 2);
  assert.equal(cardImageXsStateContour.select.traverse, 'self-and-descendants');
  assert.equal(
    cardImageXsStateContour.select.where.some((condition) => (
      condition.actual?.fact === 'component.identity' &&
      condition.expected?.literal === 'web-corp.card-image'
    )),
    true,
  );
  assert.equal(
    cardImageXsStateContour.select.where.some((condition) => (
      condition.actual?.fact === 'component.properties.Size' &&
      condition.expected?.literal === '24x16'
    )),
    true,
  );
  assert.deepEqual(cardImageXsStateContour.actual, {
    fact: 'component.properties.State',
  });
  assert.deepEqual(cardImageXsStateContour.allowedValues, ['Active']);
  assert.equal(cardImageXsStateContour.sourceChecksum.length, 64);

  const tabsSecondarySingleIconContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.tabs-view.secondary-single-icon-forbidden'
  ));
  assert.equal(tabsSecondarySingleIconContour.kind, 'fact-domain');
  assert.equal(tabsSecondarySingleIconContour.revision, 2);
  assert.equal(tabsSecondarySingleIconContour.select.traverse, 'descendants');
  assert.equal(
    tabsSecondarySingleIconContour.select.where.some((condition) => (
      condition.actual?.fact === 'component.identity' &&
      condition.expected?.literal === 'web-core.tag'
    )),
    true,
  );
  assert.equal(
    tabsSecondarySingleIconContour.select.where.some((condition) => (
      condition.actual?.fact === 'ownership.owner.component.key' &&
      condition.expected?.literal === 'd44e07075d37245006c02b03ca28fa9a8681fa1e'
    )),
    true,
  );
  assert.deepEqual(tabsSecondarySingleIconContour.actual, {
    fact: 'component.properties.SingleIcon',
  });
  assert.deepEqual(tabsSecondarySingleIconContour.allowedValues, ['False']);
  assert.equal(tabsSecondarySingleIconContour.sourceChecksum.length, 64);

  const tabsSecondaryUniformityContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.tabs-view.secondary-single-icon-is-uniform'
  ));
  assert.equal(tabsSecondaryUniformityContour.kind, 'uniform-collection-properties');
  assert.equal(tabsSecondaryUniformityContour.revision, 2);
  assert.equal(tabsSecondaryUniformityContour.identity, 'web-core-navigation.tabs');
  assert.equal(tabsSecondaryUniformityContour.memberIdentity, 'web-core.tag');
  assert.equal(tabsSecondaryUniformityContour.traverse, 'descendants');
  assert.deepEqual(
    tabsSecondaryUniformityContour.propertyFacts,
    ['component.properties.SingleIcon'],
  );
  const tabsCompatibilityTrace = release.contourCompatibilityTraces.find((trace) => (
    trace.ruleId === tabsSecondaryUniformityContour.ruleId
  ));
  assert.equal(tabsCompatibilityTrace.decision, 'reuse');
  assert.equal(tabsCompatibilityTrace.selectedContourId, 'uniform-collection-properties');
  assert.equal(
    tabsCompatibilityTrace.matchedPrecedentRuleIds.includes(
      'component:web.benefits.nested-card-settings-are-uniform',
    ),
    true,
  );
  assert.deepEqual(
    tabsCompatibilityTrace.profile.propertyPathFamilies,
    ['component.properties.*'],
  );

  const tabsUniqueLabelsContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.tabs-view.labels-are-unique-within-level'
  ));
  assert.equal(tabsUniqueLabelsContour.kind, 'query-unique');
  assert.equal(tabsUniqueLabelsContour.revision, 3);
  assert.equal(tabsUniqueLabelsContour.select.traverse, 'self-and-descendants');
  assert.deepEqual(
    tabsUniqueLabelsContour.select.where.find((condition) => (
      condition.actual?.fact === 'component.key'
    )).expected.literal,
    [
      '0b6cbeb2069d15adf5be7b9a4ba17acc6a397017',
      'd44e07075d37245006c02b03ca28fa9a8681fa1e',
    ],
  );
  assert.equal(tabsUniqueLabelsContour.query.from, 'subject');
  assert.equal(tabsUniqueLabelsContour.query.traverse, 'descendants');
  assert.deepEqual(tabsUniqueLabelsContour.query.project, {
    fact: 'text.characters',
  });
  assert.equal(
    tabsUniqueLabelsContour.presentation.observed,
    'На одном уровне повторяются названия табов: {{duplicates}}.',
  );
  assert.equal(tabsUniqueLabelsContour.sourceChecksum.length, 64);
  assert.equal(titleViewStatusContour.authorityStatus, 'active');
  assert.equal(titleViewStatusContour.sourceChecksum.length, 64);

  const tabsStrokeContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.tabs-view.manual-visual-overrides-forbidden'
  ));
  assert.equal(tabsStrokeContour.kind, 'baseline');
  assert.equal(tabsStrokeContour.revision, 2);
  assert.deepEqual(tabsStrokeContour.pairs, [{
    actualFact: 'appearance.stroke.value',
    baselineFact: 'baseline.effective.appearance.stroke.value',
    required: true,
  }]);
  assert.equal(tabsStrokeContour.sourceChecksum.length, 64);

  const backgroundPlateStrokeBindingContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.background-plate.colored-and-border-use-color-tokens'
  ));
  assert.equal(backgroundPlateStrokeBindingContour.kind, 'binding-set');
  assert.equal(backgroundPlateStrokeBindingContour.revision, 3);
  assert.deepEqual(backgroundPlateStrokeBindingContour.paths, [{
    suffix: 'fill',
    label: 'Заливка',
    valueFact: 'appearance.fill.value',
    bindingFact: 'bindings.fills',
    where: [{
      predicate: 'equals',
      actual: { fact: 'component.properties.Type' },
      expected: { literal: 'Colored' },
    }],
  }, {
    suffix: 'stroke',
    label: 'Обводка',
    valueFact: 'appearance.stroke.value',
    bindingFact: 'bindings.strokes',
    where: [{
      predicate: 'equals',
      actual: { fact: 'component.properties.Type' },
      expected: { literal: 'Border' },
    }],
  }]);
  assert.deepEqual(backgroundPlateStrokeBindingContour.expectedBinding, { bound: true });
  assert.equal(backgroundPlateStrokeBindingContour.sourceChecksum.length, 64);

  const corporateSectionGutterContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.corporate-content.section-gutter-required'
  ));
  assert.deepEqual(corporateSectionGutterContour, {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'binding-set',
    identity: 'web-corp.corporate-content',
    where: [{
      predicate: 'equals',
      actual: { fact: 'component.name' },
      expected: { literal: '[D] Section' },
    }],
    paths: [{
      suffix: 'gutter',
      label: 'Gutter между Content и Isle',
      valueFact: 'layout.itemSpacing',
      bindingFact: 'bindings.itemSpacing',
    }],
    expectedBinding: { bound: true, token: 'Grid/Gutter' },
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: '{{property}} задан без переменной Gutter',
      observed: '{{property}} имеет значение {{actual}} px без привязки к переменной Gutter.',
      expectation: 'Отступ между Content и Isle в [D] Section должен быть привязан к переменной Gutter.',
      action: 'Привязать текущее значение itemSpacing к переменной Gutter.',
    },
    scope: { platform: ['desktop'] },
    unknownPolicy: 'not-evaluable',
    ruleId: 'component:web-corp.corporate-content.section-gutter-required',
    revision: 2,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/CorporateContent/rules.json',
    sourceChecksum: corporateSectionGutterContour.sourceChecksum,
    sourceAnchor: 'rules/component:web-corp.corporate-content.section-gutter-required',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
  });
  assert.equal(corporateSectionGutterContour.sourceChecksum.length, 64);

  const backgroundPlateUnderlayContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.background-plate.level-2-requires-level-1'
  ));
  assert.equal(backgroundPlateUnderlayContour.kind, 'co-located-underlay');
  assert.deepEqual(backgroundPlateUnderlayContour.subject, {
    identity: 'web-corp.background-plate',
    properties: { Position: 'Level 2 (inner)' },
    publicRootOnly: true,
  });
  assert.deepEqual(backgroundPlateUnderlayContour.underlay, {
    identity: 'web-corp.background-plate',
    properties: { Position: 'Level 1 (outer)' },
    positioning: 'ABSOLUTE',
  });
  assert.equal(backgroundPlateUnderlayContour.relationKey, 'level1Underlay');
  assert.equal(backgroundPlateUnderlayContour.authorityStatus, 'active');
  assert.equal(backgroundPlateUnderlayContour.revision, 2);
  assert.equal(backgroundPlateUnderlayContour.sourceChecksum.length, 64);

  const titleViewPageCountContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'rule:components.title-view.single-xlarge'
  ));
  assert.equal(titleViewPageCountContour.kind, 'query-count');
  assert.deepEqual(titleViewPageCountContour.select, {
    from: 'selection-root',
    traverse: 'self',
    where: [],
  });
  assert.equal(titleViewPageCountContour.lower, 0);
  assert.equal(titleViewPageCountContour.upper, 1);
  assert.equal(
    titleViewPageCountContour.sourcePath,
    'design-system_ab/patterns/p_title-view.md',
  );
  assert.equal(titleViewPageCountContour.sourceChecksum.length, 64);

  const formEightFourContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'rule:forms.construction-rules.layout-8-4'
  ));
  assert.equal(formEightFourContour.kind, 'derived-geometry');
  assert.deepEqual(formEightFourContour.scope, {
    platform: ['desktop'],
    pageType: ['form'],
  });
  assert.equal(formEightFourContour.checks.length, 3);
  assert.equal(formEightFourContour.sourcePath, 'design-system_ab/patterns/p_form-construction-rules.md');
  assert.equal(formEightFourContour.sourceChecksum.length, 64);
  assert.equal(titleViewPageCountContour.authorityStatus, 'active');
  assert.equal(titleViewPageCountContour.provenance, 'design-system-author');

  const benefitsCapacityContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web.benefits.capacity-matches-card-count'
  ));
  assert.equal(benefitsCapacityContour.kind, 'context-map');
  assert.equal(benefitsCapacityContour.revision, 2);
  assert.equal(benefitsCapacityContour.identity, 'web.benefits');
  assert.equal(benefitsCapacityContour.contextFact, 'composition.capacity');
  assert.equal(benefitsCapacityContour.targetFact, 'composition.visibleBenefitCardCount');
  assert.deepEqual(benefitsCapacityContour.mappingEntries, [
    { context: 3, target: 3 },
    { context: 4, target: 4 },
  ]);
  assert.equal(benefitsCapacityContour.sourceChecksum.length, 64);

  const benefitsUniformityContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web.benefits.nested-card-settings-are-uniform'
  ));
  assert.equal(benefitsUniformityContour.kind, 'uniform-collection-properties');
  assert.equal(benefitsUniformityContour.revision, 4);
  assert.equal(benefitsUniformityContour.identity, 'web.benefits');
  assert.equal(benefitsUniformityContour.memberIdentity, 'web.benefit-card');
  assert.equal(benefitsUniformityContour.traverse, 'direct-children');
  assert.equal(benefitsUniformityContour.memberNames, undefined);
  assert.deepEqual(benefitsUniformityContour.propertyFacts, [
    'component.properties.Background',
    'component.properties.CardAxis',
    'component.properties.Compact',
    'component.properties.GraphicPosition',
  ]);
  assert.equal(benefitsUniformityContour.sourceChecksum.length, 64);

  const tableViewHeaderContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.table-view.horizontal-multi-column-header-required'
  ));
  assert.equal(tableViewHeaderContour.kind, 'fact-domain');
  assert.equal(tableViewHeaderContour.revision, 2);
  assert.deepEqual(tableViewHeaderContour.actual, {
    fact: 'composition.visibleHeaderRowCount',
  });
  assert.deepEqual(tableViewHeaderContour.allowedValues, [1]);
  assert.equal(tableViewHeaderContour.sourceChecksum.length, 64);

  const formFirstLevelDistanceContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'rule:forms.construction-rules.block-spacing.first-level'
  ));
  assert.equal(formFirstLevelDistanceContour.kind, 'distance');
  assert.equal(formFirstLevelDistanceContour.revision, 4);
  assert.deepEqual(formFirstLevelDistanceContour.scope, {
    platform: ['desktop', 'mobile-web'],
    pageType: ['form'],
  });
  assert.deepEqual(formFirstLevelDistanceContour.actual, { fact: 'bounds' });
  assert.deepEqual(formFirstLevelDistanceContour.target, {
    fact: 'composition.previousFormFirstLevelBlock.bounds',
  });
  assert.deepEqual(formFirstLevelDistanceContour.expected, { literal: 24 });
  assert.equal(formFirstLevelDistanceContour.axis, 'vertical');
  assert.equal(formFirstLevelDistanceContour.sourcePath, 'design-system_ab/patterns/p_form-construction-rules.md');
  assert.equal(formFirstLevelDistanceContour.sourceChecksum.length, 64);

  const formSecondLevelActionDistanceContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'rule:forms.construction-rules.block-spacing.second-level-actions'
  ));
  assert.equal(formSecondLevelActionDistanceContour.kind, 'distance');
  assert.equal(formSecondLevelActionDistanceContour.revision, 3);
  assert.deepEqual(formSecondLevelActionDistanceContour.scope, {
    platform: ['desktop', 'mobile-web'],
    pageType: ['form'],
  });
  assert.deepEqual(formSecondLevelActionDistanceContour.select.where[1], {
    predicate: 'equals',
    actual: { fact: 'composition.previousFormContent.hierarchyLevel' },
    expected: { literal: 'second-level' },
  });
  assert.deepEqual(formSecondLevelActionDistanceContour.actual, { fact: 'bounds' });
  assert.deepEqual(formSecondLevelActionDistanceContour.target, {
    fact: 'composition.previousFormContent.bounds',
  });
  assert.deepEqual(formSecondLevelActionDistanceContour.expected, { literal: 32 });
  assert.equal(formSecondLevelActionDistanceContour.axis, 'vertical');
  assert.equal(formSecondLevelActionDistanceContour.sourceChecksum.length, 64);

  const formTitleContentDistanceContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'rule:forms.construction-rules.inner-padding-standard.title-to-content'
  ));
  assert.equal(formTitleContentDistanceContour.kind, 'distance');
  assert.deepEqual(formTitleContentDistanceContour.target, {
    fact: 'composition.previousFormMediumTitle.bounds',
  });
  assert.deepEqual(formTitleContentDistanceContour.expected, { literal: 24 });
  assert.equal(formTitleContentDistanceContour.axis, 'vertical');
  assert.equal(formTitleContentDistanceContour.sourceChecksum.length, 64);

  const formContentInsetsContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'rule:forms.construction-rules.inner-padding-standard.content-insets'
  ));
  assert.equal(formContentInsetsContour.kind, 'derived-geometry');
  assert.equal(formContentInsetsContour.checks.length, 4);
  assert.deepEqual(
    formContentInsetsContour.checks.map((check) => check.actual.fact),
    [
      'composition.formFirstLevelSurface.contentInsets.top',
      'composition.formFirstLevelSurface.contentInsets.right',
      'composition.formFirstLevelSurface.contentInsets.bottom',
      'composition.formFirstLevelSurface.contentInsets.left',
    ],
  );
  assert.deepEqual(
    formContentInsetsContour.checks.map((check) => check.expected.literal),
    [32, 32, 32, 32],
  );
  assert.equal(formContentInsetsContour.sourceChecksum.length, 64);

  const formMediumTitleDomainContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'rule:forms.construction-rules.title-medium-one-per-plate'
  ));
  assert.equal(formMediumTitleDomainContour.kind, 'fact-domain');
  assert.equal(formMediumTitleDomainContour.revision, 2);
  assert.deepEqual(formMediumTitleDomainContour.actual, {
    fact: 'composition.formFirstLevelSurface.mediumTitlePosition',
  });
  assert.deepEqual(formMediumTitleDomainContour.allowedValues, ['single', 'first']);
  assert.deepEqual(formMediumTitleDomainContour.scope, {
    platform: ['desktop', 'mobile-web'],
    pageType: ['form'],
  });
  assert.equal(formMediumTitleDomainContour.sourceChecksum.length, 64);

  const statusShapeContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.status-property.shape-is-fixed-by-preset'
  ));
  assert.deepEqual(statusShapeContour, {
    schemaVersion: 'apollo.contour-definition.v1',
    kind: 'context-map',
    identity: 'web-core.status',
    where: [{
      predicate: 'equals',
      actual: { fact: 'ownership.owner.component.identity' },
      expected: { literal: 'web-corp.status-property' },
    }, {
      predicate: 'one-of',
      actual: { fact: 'ownership.owner.component.family' },
      expected: { literal: ['status-preset', 'property-preset'] },
    }],
    contextFact: 'ownership.owner.component.family',
    targetFact: 'component.properties.Shape',
    mapping: {
      'status-preset': 'Rounded',
      'property-preset': 'Rectangular',
    },
    presentation: {
      schemaVersion: 'apollo.predicate-presentation.v1',
      title: 'Форма Status не соответствует preset',
      observed: 'Внутри {{contextLabel}} у Status выбран Shape={{actual}}.',
      expectation: 'Форма вложенного Status должна соответствовать preset: Shape={{expected}}.',
      action: 'Вернуть Shape={{expected}}.',
      contextLabels: {
        'status-preset': 'StatusPreset',
        'property-preset': 'PropertyPreset',
      },
    },
    scope: { platform: ['desktop', 'mobile-web'] },
    unknownPolicy: 'not-evaluable',
    ruleId: 'component:web-corp.status-property.shape-is-fixed-by-preset',
    revision: 1,
    sourcePath: 'design-system_ab/JSONS/web/components/web-corp/Status & Property/rules.json',
    sourceChecksum: statusShapeContour.sourceChecksum,
    sourceAnchor: 'rules/component:web-corp.status-property.shape-is-fixed-by-preset',
    authorityStatus: 'active',
    provenance: 'design-system-author',
    severity: 'error',
  });
  assert.equal(statusShapeContour.sourceChecksum.length, 64);

  const statusFillContour = release.contourDefinitions.find((definition) => (
    definition.ruleId === 'component:web-corp.status-property.fill-follows-effective-baseline'
  ));
  assert.equal(statusFillContour.kind, 'baseline-set');
  assert.equal(statusFillContour.revision, 2);
  assert.deepEqual(statusFillContour.paths, [{
    suffix: 'fill',
    label: 'Заливка',
    actualFact: 'appearance.fill.value',
    baselineFact: 'baseline.effective.appearance.fill.value',
  }]);
  assert.deepEqual(statusFillContour.select.where[1], {
    predicate: 'equals',
    actual: { fact: 'ownership.contour.host.component.identity' },
    expected: { literal: 'web-corp.status-property' },
  });
  assert.equal(statusFillContour.sourceChecksum.length, 64);
});
