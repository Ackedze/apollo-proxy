const { evaluateRules, stableHash } = require('./index');
const {
  compileCompositionContract,
  compileSlotOrderPolicy,
} = require('./composition-compiler');
const { compileContourRule } = require('./contour-rules');
const { loadPredicateRelease } = require('./release-loader');
const { buildPredicateSnapshotV2 } = require('./snapshot-adapter');

const PREDICATE_REPEATABILITY_RUNS = 10;

function compilePredicateReleaseRules(loaded) {
  return loaded.compositionDefinitions.flatMap((definition) => (
    compileCompositionContract(definition)
  )).concat(
    loaded.slotOrderPolicies.map((definition) => compileSlotOrderPolicy(definition)),
    loaded.contourDefinitions.flatMap((definition) => compileContourRule(definition)),
  );
}

function runPredicateRepeatabilityGate({
  snapshot,
  rules,
  ruleRelease,
  runCount = PREDICATE_REPEATABILITY_RUNS,
}) {
  if (!Number.isInteger(runCount) || runCount < 2) {
    throw new TypeError('Predicate repeatability runCount must be an integer of at least 2');
  }

  const results = [];
  const resultHashes = [];
  for (let index = 0; index < runCount; index += 1) {
    const result = evaluateRules({ snapshot, rules, ruleRelease });
    results.push(result);
    resultHashes.push(stableHash(result));
  }

  const resultHash = resultHashes[0];
  const mismatchIndex = resultHashes.findIndex((hash) => hash !== resultHash);
  if (mismatchIndex !== -1) {
    const error = new Error(
      'Predicate repeatability gate failed: identical snapshot and rule release produced different results',
    );
    error.code = 'PREDICATE_REPEATABILITY_FAILED';
    error.status = 500;
    error.details = {
      runCount,
      baselineHash: resultHash,
      mismatchIndex,
      mismatchHash: resultHashes[mismatchIndex],
    };
    throw error;
  }

  return {
    result: results[0],
    repeatability: {
      runCount,
      stable: true,
      resultHash,
    },
  };
}

function collectComponentKeys(bundle) {
  const keys = new Set();
  for (const node of bundle?.graph?.nodes || []) {
    if (typeof node?.component?.key === 'string' && node.component.key) {
      keys.add(node.component.key);
    }
    if (
      typeof node?.componentOwner?.componentKey === 'string' &&
      node.componentOwner.componentKey
    ) {
      keys.add(node.componentOwner.componentKey);
    }
  }
  return Array.from(keys).sort();
}

function assertReleaseRulePresentations(rules) {
  const missingRuleIds = rules
    .filter((rule) => !rule.presentation || typeof rule.presentation !== 'object')
    .map((rule) => rule.ruleId);
  if (missingRuleIds.length > 0) {
    const error = new Error(
      `Predicate release contains rules without presentation: ${missingRuleIds.join(', ')}`,
    );
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    error.status = 503;
    error.details = { missingRuleIds };
    throw error;
  }
}

function evaluatePredicateReleaseRequest(payload, options) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('Predicate validation requires a request object');
    error.code = 'PREDICATE_REQUEST_INVALID';
    error.status = 400;
    throw error;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'rules')) {
    const error = new Error('Client-supplied predicate rules are forbidden');
    error.code = 'PREDICATE_CLIENT_RULES_FORBIDDEN';
    error.status = 400;
    throw error;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'ruleSet')) {
    const error = new Error('Client-selected predicate rule sets are forbidden');
    error.code = 'PREDICATE_CLIENT_RULE_SET_FORBIDDEN';
    error.status = 400;
    throw error;
  }
  const evidenceBundle = payload.evidenceBundle;
  if (!evidenceBundle || evidenceBundle.documentType !== 'apollo-audit-evidence-bundle') {
    const error = new Error('Predicate validation requires evidenceBundle');
    error.code = 'PREDICATE_EVIDENCE_INVALID';
    error.status = 400;
    throw error;
  }
  if (!options?.designSystemRoot) {
    const error = new Error('Predicate design-system release is not configured');
    error.code = 'PREDICATE_RELEASE_INCOMPLETE';
    error.status = 503;
    throw error;
  }

  const loaded = loadPredicateRelease(
    options.designSystemRoot,
    collectComponentKeys(evidenceBundle),
  );
  const snapshot = buildPredicateSnapshotV2({
    evidenceBundle,
    auditId: payload.auditId || evidenceBundle.sourceReportId,
    pageType: payload.pageType,
    surface: payload.surface,
    modalRootNodeId: payload.modalRootNodeId,
    release: loaded.release,
    componentIndex: loaded.componentIndex,
    compositionDefinitions: loaded.compositionDefinitions,
    slotOrderPolicies: loaded.slotOrderPolicies,
    contourDefinitions: loaded.contourDefinitions,
    collectionErrors: payload.collectionErrors,
  });
  const rules = compilePredicateReleaseRules(loaded);
  assertReleaseRulePresentations(rules);
  const { result, repeatability } = runPredicateRepeatabilityGate({
    snapshot,
    rules,
    ruleRelease: loaded.release.checksum,
  });
  return {
    snapshot: {
      schemaVersion: snapshot.schemaVersion,
      auditId: snapshot.auditId,
      snapshotHash: snapshot.snapshotHash,
      context: snapshot.context,
      release: snapshot.release,
      selection: snapshot.selection,
      nodeCount: snapshot.nodes.length,
      contourDiagnostics: snapshot.nodes
        .filter((node) => node.type === 'INSTANCE' && node.component)
        .map((node) => ({
          nodeId: node.id,
          parentNodeId: node.parentId,
          component: {
            identity: node.component.identity,
            family: node.component.family,
          },
          owner: node.ownership?.owner
            ? {
                nodeId: node.ownership.ownerNodeId,
                identity: node.ownership.owner.component?.identity || null,
                family: node.ownership.owner.component?.family || null,
              }
            : null,
          contour: node.ownership?.contour || null,
        })),
    },
    rules: rules.map((rule) => ({
      ruleId: rule.ruleId,
      revision: rule.revision,
      severity: rule.severity,
      source: rule.source,
      scope: rule.scope,
      presentation: rule.presentation,
    })),
    sourceRuleBalance: {
      schemaVersion: 'apollo.source-rule-balance.v1',
      traces: loaded.contourCompatibilityTraces,
    },
    result,
    repeatability,
  };
}

module.exports = {
  PREDICATE_REPEATABILITY_RUNS,
  assertReleaseRulePresentations,
  compilePredicateReleaseRules,
  collectComponentKeys,
  evaluatePredicateReleaseRequest,
  runPredicateRepeatabilityGate,
};
