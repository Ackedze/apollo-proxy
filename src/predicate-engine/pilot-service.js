const { evaluateRules, stableHash } = require('./index');
const { compileContourRule } = require('./contour-rules');
const { predicateMvpRules } = require('./pilot-rules');
const { loadPredicateRelease } = require('./release-loader');
const { buildPredicateSnapshotV2 } = require('./snapshot-adapter');

const PREDICATE_REPEATABILITY_RUNS = 10;

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

function evaluatePredicatePilotRequest(payload, options) {
  if (!payload || payload.ruleSet !== 'buttons-group-pilot') {
    const error = new Error('Predicate MVP accepts ruleSet=buttons-group-pilot');
    error.code = 'PREDICATE_RULE_SET_UNSUPPORTED';
    error.status = 400;
    throw error;
  }
  const evidenceBundle = payload.evidenceBundle;
  if (!evidenceBundle || evidenceBundle.documentType !== 'apollo-audit-evidence-bundle') {
    const error = new Error('Predicate MVP requires evidenceBundle');
    error.code = 'PREDICATE_EVIDENCE_INVALID';
    error.status = 400;
    throw error;
  }
  if (!options?.designSystemRoot) {
    const error = new Error('Predicate MVP design-system release is not configured');
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
    titleViewSlotOrder: loaded.titleViewSlotOrder,
    collectionErrors: payload.collectionErrors,
  });
  const rules = predicateMvpRules(loaded.sourceChecksums).concat(
    loaded.contourDefinitions.map((definition) => compileContourRule(definition)),
  );
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
    result,
    repeatability,
  };
}

module.exports = {
  PREDICATE_REPEATABILITY_RUNS,
  collectComponentKeys,
  evaluatePredicatePilotRequest,
  runPredicateRepeatabilityGate,
};
