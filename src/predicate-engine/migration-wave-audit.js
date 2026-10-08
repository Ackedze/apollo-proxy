const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_WAVE_PATH = 'experiments/migration-wave-1.json';

function resolveMigrationPath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.length > 1024
    || path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)
    || relativePath.includes('\\')
    || relativePath.split('/').some(part => !part || part === '.' || part === '..')) {
    const error = new TypeError('Migration artifact path is invalid or escapes its root.');
    error.code = 'MIGRATION_PATH_INVALID';
    throw error;
  }
  const base = fs.realpathSync(root);
  const actual = fs.realpathSync(path.resolve(base, relativePath));
  if (!actual.startsWith(`${base}${path.sep}`)) {
    const error = new TypeError('Migration artifact path is invalid or escapes its root.');
    error.code = 'MIGRATION_PATH_INVALID';
    throw error;
  }
  return actual;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function routeSummary(policy) {
  if (!policy) return null;
  return {
    predicate: (policy.predicateRules || []).length,
    composition: (policy.compositionRules || []).length,
    delegated: (policy.delegatedRules || []).length,
    policy: (policy.policyRules || []).length,
    contextOnly: (policy.contextOnlyRules || []).length,
  };
}

function classifiedSourceRuleIds(policy) {
  if (!policy) return [];
  return (policy.predicateRules || []).concat(
    (policy.compositionRules || []).map((entry) => entry.sourceRuleId),
    (policy.delegatedRules || []).map((entry) => entry.sourceRuleId),
    (policy.policyRules || []).map((entry) => entry.sourceRuleId),
    (policy.contextOnlyRules || []).map((entry) => entry.sourceRuleId),
  );
}

function auditMigrationWave(designSystemRoot) {
  const manifestPath = resolveMigrationPath(designSystemRoot, MIGRATION_WAVE_PATH);
  const experimentsRoot = path.dirname(manifestPath);
  const manifest = readJson(manifestPath);
  if (manifest.schemaVersion !== 'apollo.contract-v2-migration-wave.v1') {
    throw new TypeError('Predicate migration wave has an unsupported schemaVersion');
  }

  const entries = (manifest.readyPackages || []).map((entry) => ({
    role: 'ready',
    entry,
  })).concat((manifest.supportingPackages || []).map((entry) => ({
    role: 'supporting',
    entry,
  })));
  const packages = entries.map(({ role, entry }) => {
    const sourceRoot = resolveMigrationPath(designSystemRoot, entry.sourcePath);
    const rulesPath = resolveMigrationPath(sourceRoot, 'rules.json');
    const contractPath = resolveMigrationPath(experimentsRoot, entry.contractPath);
    const rulesDocument = readJson(rulesPath);
    const contract = readJson(contractPath);
    const sourceRules = rulesDocument.manual?.rules || [];
    const sourceRuleIds = sourceRules.map((rule) => rule.ruleId);
    const duplicateSourceRuleIds = sourceRuleIds.filter(
      (ruleId, index) => sourceRuleIds.indexOf(ruleId) !== index,
    );
    const rulesSourcePath = `${entry.sourcePath}/rules.json`;
    const contractRulesSourceFile = entry.contractRulesSourceFile || rulesSourcePath;
    const pinnedRules = (contract.package?.sourceFiles || []).find(
      (source) => source.file === contractRulesSourceFile,
    );
    const actualRulesChecksum = sha256File(rulesPath);
    const executionPolicy = rulesDocument.manual?.executionPolicy || null;
    const classifiedIds = classifiedSourceRuleIds(executionPolicy);
    const sourceSet = new Set(sourceRuleIds);
    const classifiedSet = new Set(classifiedIds);
    const missingRoutes = sourceRuleIds.filter((ruleId) => !classifiedSet.has(ruleId));
    const unknownRoutes = classifiedIds.filter((ruleId) => !sourceSet.has(ruleId));
    const duplicateRoutes = classifiedIds.filter(
      (ruleId, index) => classifiedIds.indexOf(ruleId) !== index,
    );
    const contractFresh = pinnedRules?.sha256 === actualRulesChecksum;
    const productionClosed = Boolean(executionPolicy)
      && !missingRoutes.length
      && !unknownRoutes.length
      && !duplicateRoutes.length;
    const predicateRuleIds = new Set(executionPolicy?.predicateRules || []);
    const sourceRuleById = new Map(sourceRules.map((rule) => [rule.ruleId, rule]));
    const productionPredicateBridgeRuleIds = entry.productionPredicateBridgeRuleIds || [];
    const invalidProductionPredicateBridgeRuleIds = productionPredicateBridgeRuleIds.filter(
      (ruleId) => (
        !predicateRuleIds.has(ruleId)
        || !sourceRuleById.get(ruleId)?.predicateContour
      ),
    );
    const blockingUnsupportedRuleIds = entry.blockingUnsupportedRuleIds || [];

    return {
      packageId: entry.packageId,
      role,
      sourcePath: rulesSourcePath,
      contractPath: `experiments/${entry.contractPath}`,
      sourceRuleCount: sourceRuleIds.length,
      deterministicRuleCount: entry.deterministicRules,
      agentRuleCount: entry.agentRules,
      humanReviewRuleCount: entry.humanReviewRules,
      contractFresh,
      pinnedRulesChecksum: pinnedRules?.sha256 || null,
      contractRulesSourceFile,
      actualRulesChecksum,
      productionPolicyPresent: Boolean(executionPolicy),
      productionClosed,
      productionPredicateBridgeRuleIds,
      invalidProductionPredicateBridgeRuleIds,
      blockingUnsupportedRuleIds,
      runtimeStatus: productionClosed ? 'production-closed' : 'shadow-only',
      routes: routeSummary(executionPolicy),
      missingRoutes,
      unknownRoutes,
      duplicateRoutes,
      duplicateSourceRuleIds: Array.from(new Set(duplicateSourceRuleIds)),
    };
  });

  return {
    schemaVersion: 'apollo.predicate-migration-audit.v1',
    waveId: manifest.waveId,
    manifestStatus: manifest.status,
    manifestChecksum: sha256File(manifestPath),
    safeToPromote: packages.every((entry) => (
      entry.contractFresh
      && entry.productionClosed
      && !entry.duplicateSourceRuleIds.length
      && !entry.invalidProductionPredicateBridgeRuleIds.length
      && !entry.blockingUnsupportedRuleIds.length
    )),
    packages,
  };
}

module.exports = {
  MIGRATION_WAVE_PATH,
  auditMigrationWave,
  classifiedSourceRuleIds,
  routeSummary,
};
