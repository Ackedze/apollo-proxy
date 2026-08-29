const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { balanceSourceRules } = require('./source-rule-balancer');

const BUTTONS_GROUP_CONTRACT = 'web/components/web-corp/ButtonGroup [D]/composition-contract.json';
const TITLE_VIEW_RULES = 'web/components/web-corp/TitleView/rules.json';
const TITLE_VIEW_COMPOSITION = 'web/components/web-corp/TitleView/composition-contract.json';
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

function compositionDefinitionFromContract(contract, source) {
  if (!contract || contract.schemaVersion !== 'apollo.composition-predicate-contract.v1') {
    return null;
  }
  if (contract.ruleKind !== 'design-rule' || contract.authority?.status !== 'active') {
    const error = new Error(
      `Composition predicate contract ${contract?.id || '<unknown>'} has no active design-rule authority`,
    );
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  return Object.assign({}, contract, {
    sourcePath: source.path,
    sourceChecksum: source.checksum,
  });
}

function slotOrderDefinitionFromPolicy(policy, source) {
  if (!policy || policy.schemaVersion !== 'apollo.slot-order-policy.v1') {
    return null;
  }
  if (
    policy.ruleKind !== 'design-rule' ||
    policy.authority?.status !== 'active' ||
    policy.required !== true
  ) {
    const error = new Error(
      `Slot order policy ${policy?.ruleId || '<unknown>'} has no active design-rule authority`,
    );
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  return Object.assign({}, policy, {
    sourcePath: source.path,
    sourceChecksum: source.checksum,
  });
}

function contourDefinitionFromRule(rule, source) {
  const contour = rule?.predicateContour;
  if (!contour) return null;
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
  return Object.assign({}, contour, {
    ruleId: rule.ruleId,
    revision: Number.isInteger(rule.authority?.revision) ? rule.authority.revision : 1,
    sourcePath: source.path,
    sourceChecksum: source.checksum,
    sourceAnchor: `rules/${rule.ruleId}`,
    authorityStatus: rule.authority.status,
    provenance: rule.authority.provenance,
    severity: rule.severity,
    unknownPolicy: contour.unknownPolicy || 'not-evaluable',
  });
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

function validateComponentExecutionPolicy(rulesDocument, compositionDefinitions) {
  const rules = rulesDocument?.manual?.rules || [];
  const policy = rulesDocument?.manual?.executionPolicy;
  if (policy?.schemaVersion !== 'apollo.component-rule-execution.v1') {
    throw new TypeError('component rule execution policy has an unsupported schemaVersion');
  }
  const sourceRuleIds = rules.map((rule) => rule?.ruleId);
  if (sourceRuleIds.some((ruleId) => typeof ruleId !== 'string' || !ruleId)) {
    throw new TypeError('component rule execution policy requires ruleId on every source rule');
  }
  if (new Set(sourceRuleIds).size !== sourceRuleIds.length) {
    throw new TypeError('component rule execution policy source ruleIds must be unique');
  }

  const predicateRuleIds = policy.predicateRules || [];
  const compositionEntries = policy.compositionRules || [];
  const delegatedEntries = policy.delegatedRules || [];
  const policyEntries = policy.policyRules || [];
  const contextEntries = policy.contextOnlyRules || [];
  const covered = predicateRuleIds.concat(
    compositionEntries.map((entry) => entry?.sourceRuleId),
    delegatedEntries.map((entry) => entry?.sourceRuleId),
    policyEntries.map((entry) => entry?.sourceRuleId),
    contextEntries.map((entry) => entry?.sourceRuleId),
  );
  if (covered.some((ruleId) => typeof ruleId !== 'string' || !ruleId)) {
    throw new TypeError('component rule execution policy contains an invalid sourceRuleId');
  }
  if (new Set(covered).size !== covered.length) {
    throw new TypeError('component rule execution policy classifies a source rule more than once');
  }
  const sourceSet = new Set(sourceRuleIds);
  const coveredSet = new Set(covered);
  const missing = sourceRuleIds.filter((ruleId) => !coveredSet.has(ruleId));
  const extra = covered.filter((ruleId) => !sourceSet.has(ruleId));
  if (missing.length || extra.length) {
    throw new TypeError(
      `component rule execution policy is not closed: missing=${missing.join(',')}; extra=${extra.join(',')}`,
    );
  }

  const ruleById = new Map(rules.map((rule) => [rule.ruleId, rule]));
  for (const ruleId of predicateRuleIds) {
    const rule = ruleById.get(ruleId);
    if (
      !rule?.predicateContour ||
      rule.ruleKind !== 'design-rule' ||
      rule.authority?.status !== 'active'
    ) {
      throw new TypeError(`predicate execution rule is not active and executable: ${ruleId}`);
    }
  }

  const compositionRuleIds = new Set((compositionDefinitions || []).flatMap(
    (definition) => (definition.constraints || []).map((constraint) => constraint.ruleId),
  ));
  for (const entry of compositionEntries) {
    if (!Array.isArray(entry?.contractRuleIds) || !entry.contractRuleIds.length) {
      throw new TypeError(`composition execution entry has no contractRuleIds: ${entry?.sourceRuleId}`);
    }
    for (const ruleId of entry.contractRuleIds) {
      if (!compositionRuleIds.has(ruleId)) {
        throw new TypeError(`composition execution rule is not compiled: ${ruleId}`);
      }
    }
  }
  for (const entry of contextEntries) {
    if (!Array.isArray(entry?.missingFacts) || !entry.missingFacts.length) {
      throw new TypeError(`context-only execution entry has no missingFacts: ${entry?.sourceRuleId}`);
    }
  }
  return policy;
}

function validateRequestedExecutionPolicies(jsonRoot, requestedByPackage, compositionDefinitions) {
  const validated = [];
  const packages = Array.from(requestedByPackage.values())
    .map((entry) => entry.packageEntry)
    .sort((left, right) => String(left.packagePath).localeCompare(String(right.packagePath)));

  for (const packageEntry of packages) {
    const rulesName = packageEntry.artifacts?.rules;
    if (typeof rulesName !== 'string' || !rulesName) continue;
    const rulesPath = path.join(jsonRoot, packageEntry.packagePath, rulesName);
    if (!fs.statSync(rulesPath, { throwIfNoEntry: false })?.isFile()) continue;
    const rulesDocument = readJson(rulesPath);
    if (!rulesDocument?.manual?.executionPolicy) continue;
    validateComponentExecutionPolicy(rulesDocument, compositionDefinitions);
    validated.push({
      componentIdentity: packageEntry.componentKey,
      sourcePath: `design-system_ab/JSONS/${packageEntry.packagePath}/${rulesName}`,
    });
  }

  return validated;
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
      const definition = contourDefinitionFromRule(rule, {
        path: sourcePath,
        checksum: sourceChecksum,
      });
      if (definition) definitions.push(definition);
    }
  }

  return definitions.sort((left, right) => left.ruleId.localeCompare(right.ruleId));
}

function loadComponentContourCatalog(jsonRoot, packages) {
  const packagesForCatalog = new Map();
  for (const packageEntry of packages || []) {
    if (!packageEntry || typeof packageEntry.packagePath !== 'string') continue;
    packagesForCatalog.set(packageEntry.packagePath, {
      packageEntry,
      figmaKeys: [],
    });
  }
  return loadRequestedContourDefinitions(jsonRoot, packagesForCatalog);
}

function loadPatternContourDefinitions(designSystemRoot) {
  const patternsRoot = path.join(designSystemRoot, 'patterns');
  if (!fs.statSync(patternsRoot, { throwIfNoEntry: false })?.isDirectory()) return [];
  const definitions = [];
  const blockPattern = /```json apollo-predicate-contour\s*\r?\n([\s\S]*?)\r?\n```/gu;
  const fileNames = fs.readdirSync(patternsRoot)
    .filter((fileName) => fileName.endsWith('.md'))
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of fileNames) {
    const filePath = path.join(patternsRoot, fileName);
    const markdown = fs.readFileSync(filePath, 'utf8');
    const matches = Array.from(markdown.matchAll(blockPattern));
    if (!matches.length) continue;
    if (!/^- status:\s*active\s*$/mu.test(markdown)) {
      const error = new Error(`Pattern predicate source is not active: ${fileName}`);
      error.code = 'PREDICATE_RELEASE_INCOMPLETE';
      throw error;
    }
    const source = {
      path: `design-system_ab/patterns/${fileName}`,
      checksum: sha256File(filePath),
    };
    for (const match of matches) {
      let rule;
      try {
        rule = JSON.parse(match[1]);
      } catch (parseError) {
        const error = new Error(`Pattern predicate contour is invalid JSON: ${fileName}`);
        error.code = 'PREDICATE_RELEASE_INCOMPLETE';
        error.cause = parseError;
        throw error;
      }
      const definition = contourDefinitionFromRule(rule, source);
      if (definition) definitions.push(definition);
    }
  }

  const ids = new Set();
  for (const definition of definitions) {
    if (ids.has(definition.ruleId)) {
      const error = new Error(`Duplicate pattern predicate contour: ${definition.ruleId}`);
      error.code = 'PREDICATE_RELEASE_INCOMPLETE';
      throw error;
    }
    ids.add(definition.ruleId);
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
      platform: null,
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
        platform: contract.platform || null,
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
  const buttonsGroupComposition = readJson(contractPath);
  const buttonsGroupCompositionDefinitions = (buttonsGroupComposition?.manual?.contracts || [])
    .map((contract) => compositionDefinitionFromContract(contract, {
      path: `design-system_ab/JSONS/${BUTTONS_GROUP_CONTRACT}`,
      checksum: sha256File(contractPath),
    }))
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!buttonsGroupCompositionDefinitions.length) {
    const error = new Error('ButtonsGroup composition has no active predicate contract');
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const titleViewRulesPath = path.join(jsonRoot, TITLE_VIEW_RULES);
  if (!fs.statSync(titleViewRulesPath, { throwIfNoEntry: false })?.isFile()) {
    const error = new Error(`TitleView predicate rules are missing: ${titleViewRulesPath}`);
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const titleViewRules = readJson(titleViewRulesPath);
  const titleViewCompositionPath = path.join(jsonRoot, TITLE_VIEW_COMPOSITION);
  if (!fs.statSync(titleViewCompositionPath, { throwIfNoEntry: false })?.isFile()) {
    const error = new Error(`TitleView predicate composition is missing: ${titleViewCompositionPath}`);
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const titleViewComposition = readJson(titleViewCompositionPath);
  const titleViewCompositionDefinitions = (titleViewComposition?.manual?.contracts || [])
    .map((contract) => compositionDefinitionFromContract(contract, {
      path: `design-system_ab/JSONS/${TITLE_VIEW_COMPOSITION}`,
      checksum: sha256File(titleViewCompositionPath),
    }))
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!titleViewCompositionDefinitions.length) {
    const error = new Error('TitleView composition has no active predicate contract');
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    throw error;
  }
  const compositionDefinitions = buttonsGroupCompositionDefinitions
    .concat(titleViewCompositionDefinitions)
    .sort((left, right) => left.id.localeCompare(right.id));
  validateComponentExecutionPolicy(titleViewRules, titleViewCompositionDefinitions);
  validateRequestedExecutionPolicies(jsonRoot, requestedByPackage, compositionDefinitions);
  const slotOrderPolicies = [slotOrderDefinitionFromPolicy(
    titleViewComposition?.manual?.slotOrderPolicy,
    {
      path: `design-system_ab/JSONS/${TITLE_VIEW_COMPOSITION}`,
      checksum: sha256File(titleViewCompositionPath),
    },
  )].filter(Boolean);
  if (!slotOrderPolicies.length) {
    const error = new Error('TitleView composition has no active slot order policy');
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
  const patternContourDefinitions = loadPatternContourDefinitions(designSystemRoot);
  const requestedContourDefinitions = loadRequestedContourDefinitions(jsonRoot, requestedByPackage)
    .concat(patternContourDefinitions)
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  const contourCatalog = loadComponentContourCatalog(jsonRoot, index.packages)
    .concat(patternContourDefinitions)
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  const balancedContours = balanceSourceRules(requestedContourDefinitions, contourCatalog);
  const contourDefinitions = balancedContours.definitions;
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
      benefitsRules: sha256File(benefitsRulesPath),
      tableViewRules: sha256File(tableViewRulesPath),
      formPattern: sha256File(formPatternPath),
      buttonPattern: sha256File(buttonPatternPath),
    },
    slotOrderPolicies,
    compositionDefinitions,
    contourDefinitions,
    contourCompatibilityTraces: balancedContours.traces,
  };
}

module.exports = {
  BUTTONS_GROUP_CONTRACT,
  BENEFITS_RULES,
  TABLE_VIEW_RULES,
  FORM_PATTERN,
  BUTTON_PATTERN,
  TITLE_VIEW_RULES,
  TITLE_VIEW_COMPOSITION,
  loadRequestedContourDefinitions,
  loadComponentContourCatalog,
  loadPatternContourDefinitions,
  compositionDefinitionFromContract,
  slotOrderDefinitionFromPolicy,
  validateComponentExecutionPolicy,
  validateRequestedExecutionPolicies,
  loadPredicateRelease,
};
