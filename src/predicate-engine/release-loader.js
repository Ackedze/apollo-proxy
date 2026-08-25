const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BUTTONS_GROUP_CONTRACT = 'web/components/web-corp/ButtonGroup [D]/composition-contract.json';
const TITLE_VIEW_RULES = 'web/components/web-corp/TitleView/rules.json';
const TITLE_VIEW_COMPOSITION = 'web/components/web-corp/TitleView/composition-contract.json';
const BACKGROUND_PLATE_RULES = 'web/components/web-corp/BackgroundPlate/rules.json';
const BENEFITS_RULES = 'web/components/web-corp-promo/Benefits/rules.json';
const TABLE_VIEW_RULES = 'web/components/web-corp/TableView/rules.json';
const FORM_PATTERN = 'patterns/p_form-construction-rules.md';
const BUTTON_PATTERN = 'patterns/p_buttons-and-buttons-group.md';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function contractKeys(contract) {
  const keys = new Set();
  if (typeof contract?.componentKey === 'string' && contract.componentKey) {
    keys.add(contract.componentKey);
  }
  const figma = contract?.figma;
  if (typeof figma?.defaultVariantKey === 'string' && figma.defaultVariantKey) {
    keys.add(figma.defaultVariantKey);
  }
  for (const variant of figma?.variants?.variantKeys || []) {
    if (typeof variant?.key === 'string' && variant.key) keys.add(variant.key);
  }
  return keys;
}

function loadRequestedContourDefinitions(jsonRoot, requestedByPackage) {
  const definitions = [];
  const packages = Array.from(requestedByPackage.values())
    .map((entry) => entry.packageEntry)
    .sort((left, right) => String(left.packagePath).localeCompare(String(right.packagePath)));

  for (const packageEntry of packages) {
    const rulesName = packageEntry.artifacts?.rules;
    if (typeof rulesName !== 'string' || !rulesName) continue;
    const rulesPath = path.join(jsonRoot, packageEntry.packagePath, rulesName);
    if (!fs.statSync(rulesPath, { throwIfNoEntry: false })?.isFile()) continue;
    const rulesDocument = readJson(rulesPath);
    const sourceChecksum = sha256File(rulesPath);
    const sourcePath = `design-system_ab/JSONS/${packageEntry.packagePath}/${rulesName}`;
    for (const rule of rulesDocument?.manual?.rules || []) {
      const contour = rule?.predicateContour;
      if (!contour) continue;
      if (
        contour.schemaVersion !== 'apollo.contour-definition.v1' ||
        rule.ruleKind !== 'design-rule' ||
        rule.authority?.status !== 'active'
      ) {
        const error = new Error(
          `Predicate contour ${rule?.ruleId || '<unknown>'} has no active design-rule authority`,
        );
        error.code = 'PREDICATE_RELEASE_INCOMPLETE';
        throw error;
      }
      definitions.push(Object.assign({}, contour, {
        ruleId: rule.ruleId,
        revision: Number.isInteger(rule.authority?.revision) ? rule.authority.revision : 1,
        sourcePath,
        sourceChecksum,
        sourceAnchor: `rules/${rule.ruleId}`,
        authorityStatus: rule.authority.status,
        provenance: rule.authority.provenance,
        severity: rule.severity,
        unknownPolicy: contour.unknownPolicy || 'not-evaluable',
      }));
    }
  }

  return definitions.sort((left, right) => left.ruleId.localeCompare(right.ruleId));
}

function loadPredicateRelease(designSystemRoot, requestedFigmaKeys = []) {
  const jsonRoot = path.join(designSystemRoot, 'JSONS');
  const indexPath = path.join(jsonRoot, 'apollo', 'indexes', 'componentContractIndex.json');
  if (!fs.statSync(indexPath, { throwIfNoEntry: false })?.isFile()) {
    const error = new Error(`Predicate component index is missing: ${indexPath}`);
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const index = readJson(indexPath);
  if (index.schemaVersion !== 2 || !Array.isArray(index.packages)) {
    const error = new Error('Predicate component index has an unsupported format');
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }

  const requested = new Set(
    requestedFigmaKeys.filter((value) => typeof value === 'string' && value),
  );
  const packageByIdentity = new Map(
    index.packages.map((entry) => [entry.componentKey, entry]),
  );
  const requestedByPackage = new Map();
  for (const figmaKey of requested) {
    const identity = index.components?.[figmaKey] || null;
    const packageEntry = identity ? packageByIdentity.get(identity) : null;
    if (!packageEntry) continue;
    if (!requestedByPackage.has(packageEntry.componentKey)) {
      requestedByPackage.set(packageEntry.componentKey, {
        packageEntry,
        figmaKeys: [],
      });
    }
    requestedByPackage.get(packageEntry.componentKey).figmaKeys.push(figmaKey);
  }

  const componentIndex = {};
  for (const { packageEntry, figmaKeys } of requestedByPackage.values()) {
    const baseMetadata = {
      identity: packageEntry.componentKey || null,
      family: packageEntry.packageName || null,
      library: null,
      lifecycle: null,
      api: null,
    };
    for (const figmaKey of figmaKeys) {
      componentIndex[figmaKey] = Object.assign({}, baseMetadata);
    }

    const generatedName = packageEntry.artifacts?.generatedContract;
    if (typeof generatedName !== 'string' || !generatedName) continue;
    const generatedPath = path.join(jsonRoot, packageEntry.packagePath, generatedName);
    if (!fs.statSync(generatedPath, { throwIfNoEntry: false })?.isFile()) continue;
    const generated = readJson(generatedPath);
    for (const contract of generated.contracts || []) {
      const metadata = Object.assign({}, baseMetadata, {
        family: contract.normalizedName || baseMetadata.family,
        library: contract.source?.library || generated.source?.library || null,
        lifecycle: contract.status || null,
      });
      for (const figmaKey of contractKeys(contract)) {
        if (requested.has(figmaKey)) componentIndex[figmaKey] = metadata;
      }
    }
  }

  const contractPath = path.join(jsonRoot, BUTTONS_GROUP_CONTRACT);
  if (!fs.statSync(contractPath, { throwIfNoEntry: false })?.isFile()) {
    const error = new Error(`ButtonsGroup predicate contract is missing: ${contractPath}`);
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const titleViewRulesPath = path.join(jsonRoot, TITLE_VIEW_RULES);
  if (!fs.statSync(titleViewRulesPath, { throwIfNoEntry: false })?.isFile()) {
    const error = new Error(`TitleView predicate rules are missing: ${titleViewRulesPath}`);
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const titleViewCompositionPath = path.join(jsonRoot, TITLE_VIEW_COMPOSITION);
  if (!fs.statSync(titleViewCompositionPath, { throwIfNoEntry: false })?.isFile()) {
    const error = new Error(`TitleView predicate composition is missing: ${titleViewCompositionPath}`);
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const titleViewComposition = readJson(titleViewCompositionPath);
  const titleViewSlotOrder = titleViewComposition?.manual?.slotOrderPolicy?.order;
  if (!Array.isArray(titleViewSlotOrder) || !titleViewSlotOrder.length) {
    const error = new Error('TitleView predicate composition has no slotOrderPolicy.order');
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const backgroundPlateRulesPath = path.join(jsonRoot, BACKGROUND_PLATE_RULES);
  if (!fs.statSync(backgroundPlateRulesPath, { throwIfNoEntry: false })?.isFile()) {
    const error = new Error(`BackgroundPlate predicate rules are missing: ${backgroundPlateRulesPath}`);
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const benefitsRulesPath = path.join(jsonRoot, BENEFITS_RULES);
  if (!fs.statSync(benefitsRulesPath, { throwIfNoEntry: false })?.isFile()) {
    const error = new Error(`Benefits predicate rules are missing: ${benefitsRulesPath}`);
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const benefitsRules = readJson(benefitsRulesPath);
  const capacityRule = benefitsRules?.manual?.rules?.find((rule) => (
    rule?.ruleId === 'component:web.benefits.capacity-matches-card-count'
  ));
  const nestedCardSettingsRule = benefitsRules?.manual?.rules?.find((rule) => (
    rule?.ruleId === 'component:web.benefits.nested-card-settings-are-uniform'
  ));
  if (
    capacityRule?.ruleKind !== 'design-rule' ||
    capacityRule?.authority?.status !== 'active'
  ) {
    const error = new Error('Benefits capacity predicate has no active design-rule authority');
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  if (
    nestedCardSettingsRule?.ruleKind !== 'design-rule' ||
    nestedCardSettingsRule?.authority?.status !== 'active'
  ) {
    const error = new Error('Benefits nested card settings predicate has no active design-rule authority');
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const tableViewRulesPath = path.join(jsonRoot, TABLE_VIEW_RULES);
  if (!fs.statSync(tableViewRulesPath, { throwIfNoEntry: false })?.isFile()) {
    const error = new Error(`TableView predicate rules are missing: ${tableViewRulesPath}`);
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const tableViewRules = readJson(tableViewRulesPath);
  const horizontalHeaderRule = tableViewRules?.manual?.rules?.find((rule) => (
    rule?.ruleId === 'component:web-corp.table-view.horizontal-multi-column-header-required'
  ));
  const compactConsistencyRule = tableViewRules?.manual?.rules?.find((rule) => (
    rule?.ruleId === 'component:web-corp.table-view.compact-is-consistent-across-rows'
  ));
  const compactOneColumnRule = tableViewRules?.manual?.rules?.find((rule) => (
    rule?.ruleId === 'component:web-corp.table-view.horizontal-compact-one-column'
  ));
  if (
    horizontalHeaderRule?.ruleKind !== 'design-rule' ||
    horizontalHeaderRule?.authority?.status !== 'active'
  ) {
    const error = new Error('TableView header predicate has no active design-rule authority');
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  if (
    compactConsistencyRule?.ruleKind !== 'design-rule' ||
    compactConsistencyRule?.authority?.status !== 'active'
  ) {
    const error = new Error('TableView Compact consistency predicate has no active design-rule authority');
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  if (
    compactOneColumnRule?.ruleKind !== 'design-rule' ||
    compactOneColumnRule?.authority?.status !== 'active'
  ) {
    const error = new Error('TableView compact column predicate has no active design-rule authority');
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const formPatternPath = path.join(designSystemRoot, FORM_PATTERN);
  if (!fs.statSync(formPatternPath, { throwIfNoEntry: false })?.isFile()) {
    const error = new Error(`Form predicate pattern is missing: ${formPatternPath}`);
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const formPattern = fs.readFileSync(formPatternPath, 'utf8');
  if (
    !/^- status:\s*active\s*$/mu.test(formPattern) ||
    !/^- ruleId:\s*rule:forms\.construction-rules\.block-spacing\s*$/mu.test(formPattern) ||
    !/^- ruleId:\s*rule:forms\.construction-rules\.title-medium-one-per-plate\s*$/mu.test(formPattern) ||
    !/^- ruleId:\s*rule:forms\.construction-rules\.inner-padding-standard\s*$/mu.test(formPattern)
  ) {
    const error = new Error('Form predicates have no active pattern authority');
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const buttonPatternPath = path.join(designSystemRoot, BUTTON_PATTERN);
  if (!fs.statSync(buttonPatternPath, { throwIfNoEntry: false })?.isFile()) {
    const error = new Error(`Button predicate pattern is missing: ${buttonPatternPath}`);
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const buttonPattern = fs.readFileSync(buttonPatternPath, 'utf8');
  if (
    !/^- status:\s*active\s*$/mu.test(buttonPattern) ||
    !/^- ruleId:\s*rule:controls\.buttons-and-button-groups\.desktop-safe-variants\s*$/mu.test(buttonPattern)
  ) {
    const error = new Error('Desktop Button predicate has no active pattern authority');
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const contourDefinitions = loadRequestedContourDefinitions(jsonRoot, requestedByPackage);
  const releaseChecksum = sha256File(indexPath);
  return {
    release: {
      knowledgeSource: 'design-system_ab',
      revision: String(index.generatedAt || releaseChecksum.slice(0, 12)),
      checksum: releaseChecksum,
    },
    componentIndex,
    sourceChecksums: {
      buttonsGroupComposition: sha256File(contractPath),
      titleViewRules: sha256File(titleViewRulesPath),
      titleViewComposition: sha256File(titleViewCompositionPath),
      backgroundPlateRules: sha256File(backgroundPlateRulesPath),
      benefitsRules: sha256File(benefitsRulesPath),
      tableViewRules: sha256File(tableViewRulesPath),
      formPattern: sha256File(formPatternPath),
      buttonPattern: sha256File(buttonPatternPath),
    },
    titleViewSlotOrder: titleViewSlotOrder.slice(),
    contourDefinitions,
  };
}

module.exports = {
  BUTTONS_GROUP_CONTRACT,
  BACKGROUND_PLATE_RULES,
  BENEFITS_RULES,
  TABLE_VIEW_RULES,
  FORM_PATTERN,
  BUTTON_PATTERN,
  TITLE_VIEW_RULES,
  TITLE_VIEW_COMPOSITION,
  loadRequestedContourDefinitions,
  loadPredicateRelease,
};
