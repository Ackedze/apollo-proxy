'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {CODEX_DESIGN_SYSTEM, CODEX_DS_AI_HUB}=require('../config');
const {isCustomizationReportPayload, isPatternReportPayload, getCodexPayloadAuditId, buildFigmaSelectionUrl, getCodexPayloadCheckedNodes, getCodexPayloadNodeIds, isTextReportPayload}=require('./request');
const {isActiveComponentDesignRule, buildSemanticRuleCoverage, isSafeRelativePath}=require('./semantic');


function buildApolloSkillResponseError(message) {
  const err = new Error(`Invalid Apollo response: ${message}`);
  err.status = 502;
  err.code = 'CODEX_SKILL_RESPONSE_INVALID';
  return err;
}


function getApolloReportAtomicChanges(payload) {
  if (
    !isCustomizationReportPayload(payload) &&
    !isPatternReportPayload(payload)
  ) return [];
  const atomicChanges = [];
  const items = Array.isArray(payload?.report?.category?.items)
    ? payload.report.category.items
    : [];
  for (const item of items) {
    for (const change of Array.isArray(item?.changes) ? item.changes : []) {
      const nodeId = change?.node?.id;
      const factPath = change?.property;
      if (
        typeof nodeId !== 'string' ||
        !nodeId ||
        typeof factPath !== 'string' ||
        !factPath
      ) {
        continue;
      }
      atomicChanges.push({
        key: `${nodeId}|${factPath}`,
        nodeId,
        factPath,
        nodeName: change?.node?.name || item?.node?.name || nodeId,
        nodePath: change?.node?.path || item?.node?.path || '',
        reference: change?.reference ?? null,
        actual: change?.actual ?? null,
        assessment: change?.assessment ?? null,
        componentRules: Array.isArray(change?.componentRules)
          ? change.componentRules
          : [],
      });
    }
  }
  return atomicChanges;
}


function findRuleByIdInDocument(value, ruleId) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findRuleByIdInDocument(item, ruleId);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  if (value.ruleId === ruleId) return value;
  for (const item of Object.values(value)) {
    const match = findRuleByIdInDocument(item, ruleId);
    if (match) return match;
  }
  return null;
}


function resolveSnapshotComponentRuleEvidence(evidence, sourceRoots = {}) {
  if (
    evidence?.source !== 'design-system_ab' ||
    typeof evidence?.ruleId !== 'string' ||
    !evidence.ruleId.trim()
  ) {
    return null;
  }
  const resolved = resolveVerifiedSourcePath(
    evidence.source,
    evidence.path,
    {
      designSystem: sourceRoots.designSystem || CODEX_DESIGN_SYSTEM,
      dsAiHub: sourceRoots.dsAiHub || CODEX_DS_AI_HUB,
    }
  );
  if (!resolved) return null;
  try {
    const stat = fs.statSync(resolved.path);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return null;
    const document = JSON.parse(fs.readFileSync(resolved.path, 'utf8'));
    return findRuleByIdInDocument(document, evidence.ruleId);
  } catch {
    return null;
  }
}


function findReportComponentRule(change, ruleId) {
  if (!change || typeof ruleId !== 'string' || !ruleId) return null;
  return change.componentRules.find((rule) => rule?.ruleId === ruleId) || null;
}


function findCanonicalReportChange(reportChanges, nodeId, factPath) {
  if (typeof nodeId !== 'string' || typeof factPath !== 'string') return null;
  const exact = reportChanges.find(
    (change) => change.nodeId === nodeId && change.factPath === factPath
  );
  if (exact) return exact;
  const suffixMatches = reportChanges.filter((change) => (
    change.nodeId === nodeId && factPath.endsWith(`.${change.factPath}`)
  ));
  return suffixMatches.length === 1 ? suffixMatches[0] : null;
}


function normalizeReportResponseFactPaths(result, reportChanges) {
  for (const classification of result.classifications || []) {
    const change = findCanonicalReportChange(
      reportChanges,
      classification?.nodeId,
      classification?.factPath
    );
    if (!change || change.factPath === classification.factPath) continue;
    console.warn('[Apollo][codex] repaired prefixed classification factPath', {
      nodeId: classification.nodeId,
      received: classification.factPath,
      canonical: change.factPath,
    });
    classification.factPath = change.factPath;
    const finding = (result.findings || []).find(
      (entry) => entry?.id === classification.findingId
    );
    if (finding) {
      finding.factPath = change.factPath;
      finding.dedupeKey = [finding.nodeId, finding.ruleId, change.factPath].join('|');
    }
  }
  for (const finding of result.findings || []) {
    const change = findCanonicalReportChange(
      reportChanges,
      finding?.nodeId,
      finding?.factPath
    );
    if (!change || change.factPath === finding.factPath) continue;
    console.warn('[Apollo][codex] repaired prefixed finding factPath', {
      findingId: finding.id,
      received: finding.factPath,
      canonical: change.factPath,
    });
    finding.factPath = change.factPath;
    finding.dedupeKey = [finding.nodeId, finding.ruleId, change.factPath].join('|');
    const classification = (result.classifications || []).find(
      (entry) => entry?.findingId === finding.id
    );
    if (classification) classification.factPath = change.factPath;
  }
}


function removePageSpecificPatternClassifications(result) {
  const findingsById = new Map(
    (result.findings || []).map((finding) => [finding?.id, finding])
  );
  result.classifications = (result.classifications || []).filter((classification) => {
    const finding = findingsById.get(classification?.findingId);
    const isLinkedPageSpecificClassification =
      typeof classification?.factPath === 'string' &&
      classification.factPath.startsWith('patterns.') &&
      finding?.nodeId === classification.nodeId &&
      finding?.factPath === classification.factPath;
    if (!isLinkedPageSpecificClassification) return true;
    console.warn('[Apollo][codex] removed page-specific pattern classification', {
      findingId: finding.id,
      nodeId: classification.nodeId,
      factPath: classification.factPath,
    });
    return false;
  });
  if (result.summary) {
    result.summary.allowed = result.classifications.filter(
      (classification) => classification?.disposition === 'allowed'
    ).length;
  }
}


function normalizeReportFindingAuthority(
  result,
  reportChanges,
  resolvedRulesById = new Map()
) {
  const changesByKey = new Map(
    reportChanges.map((change) => [change.key, change])
  );
  const findEffectiveRule = (change, ruleId) => {
    const reportRule = findReportComponentRule(change, ruleId);
    if (isActiveComponentDesignRule(reportRule)) return reportRule;
    return resolvedRulesById.get(ruleId) || reportRule;
  };
  for (const finding of result.findings || []) {
    const change = changesByKey.get(`${finding.nodeId}|${finding.factPath}`);
    if (!change) continue;
    const referencedRule = findEffectiveRule(change, finding.ruleId);
    const invalidEvidence = (finding.verifiedEvidence || []).filter((evidence) => (
      evidence?.kind === 'component_contract' &&
      !isActiveComponentDesignRule(
        findEffectiveRule(change, evidence?.ruleId || finding.ruleId)
      )
    ));
    const usesInactiveRule = referencedRule && !isActiveComponentDesignRule(referencedRule);
    if (!usesInactiveRule && invalidEvidence.length === 0) continue;

    const assessmentRule = change?.assessment?.verdict === 'violation'
      ? findEffectiveRule(change, change?.assessment?.ruleId)
      : null;
    if (isActiveComponentDesignRule(assessmentRule)) {
      finding.ruleId = assessmentRule.ruleId;
      finding.dedupeKey = [finding.nodeId, finding.ruleId, finding.factPath].join('|');
      finding.verifiedEvidence = (finding.verifiedEvidence || []).map((evidence) => (
        invalidEvidence.includes(evidence)
          ? { ...evidence, ruleId: assessmentRule.ruleId }
          : evidence
      ));
      const classification = (result.classifications || []).find(
        (entry) => entry?.findingId === finding.id
      );
      if (classification) classification.ruleId = assessmentRule.ruleId;
      console.warn('[Apollo][codex] repaired finding authority from deterministic assessment', {
        findingId: finding.id,
        ruleId: assessmentRule.ruleId,
      });
      continue;
    }

    finding.priority = 'human_review';
    finding.evidenceStatus = 'unresolved';
    finding.verifiedEvidence = (finding.verifiedEvidence || []).filter(
      (evidence) => !invalidEvidence.includes(evidence)
    );
    finding.actions = (finding.actions || []).filter(
      (action) => action?.type !== 'propose_mutation'
    );
    const classification = (result.classifications || []).find(
      (entry) => entry?.findingId === finding.id
    );
    if (classification) classification.disposition = 'human_review';
    console.warn('[Apollo][codex] downgraded finding without active authority', {
      findingId: finding.id,
      ruleId: finding.ruleId,
    });
  }
  if (result.summary) {
    result.summary.errors = (result.findings || []).filter(
      (finding) => finding?.priority === 'error'
    ).length;
    result.summary.warnings = (result.findings || []).filter(
      (finding) => finding?.priority === 'warning'
    ).length;
    result.summary.humanReview = (result.findings || []).filter(
      (finding) => finding?.priority === 'human_review'
    ).length;
  }
}


function getApolloReportValue(value) {
  const rawValue = value && typeof value === 'object' && 'value' in value
    ? value.value
    : value;
  if (rawValue === null || rawValue === undefined) return '—';
  if (typeof rawValue === 'string') return rawValue;
  if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
    return String(rawValue);
  }
  try {
    return JSON.stringify(rawValue);
  } catch {
    return String(rawValue);
  }
}


function isCompactPatternAssessmentResponse(result) {
  return Boolean(
    result &&
    result.schemaVersion === 1 &&
    result.documentType === 'apollo-pattern-assessment-response' &&
    Array.isArray(result.assessments)
  );
}


function formatCompactPatternFactValue(value) {
  if (value && typeof value === 'object' && 'value' in value) {
    const resourceName = value?.binding?.name || value?.resource?.name;
    return resourceName || getApolloReportValue(value.value);
  }
  return getApolloReportValue(value);
}


function resolveCompactPatternFact(requestDocument, assessment) {
  const semanticFact = (requestDocument?.semanticModel?.facts || []).find(
    (fact) => (
      fact?.factPath === assessment.factPath &&
      (
        fact?.subject?.nodeId === assessment.nodeId ||
        (
          fact?.kind === 'relation' &&
          fact?.relation?.containerNodeId === assessment.nodeId
        )
      )
    )
  );
  if (semanticFact) {
    if (semanticFact.kind === 'property_state') {
      return {
        kind: semanticFact.kind,
        subject: semanticFact.subject || {},
        observed: `${formatCompactPatternFactValue(semanticFact.baseline)} → ${formatCompactPatternFactValue(semanticFact.actual)}`,
        actual: formatCompactPatternFactValue(semanticFact.actual),
        baseline: formatCompactPatternFactValue(semanticFact.baseline),
      };
    }
    if (
      semanticFact.kind === 'component_occurrence' ||
      semanticFact.kind === 'group_aggregate' ||
      semanticFact.kind === 'layout_state'
    ) {
      const actual = semanticFact.kind === 'component_occurrence'
        ? semanticFact.component
        : semanticFact.kind === 'group_aggregate'
          ? semanticFact.aggregate
          : semanticFact.layout;
      return {
        kind: semanticFact.kind,
        subject: semanticFact.subject || {},
        observed: formatCompactPatternFactValue(actual),
        actual,
        baseline: null,
      };
    }
    const actualPx = semanticFact?.relation?.measurement?.actualPx;
    const subject = semanticFact.kind === 'relation'
      ? {
          ...(semanticFact.subject || {}),
          nodeId: semanticFact.relation.containerNodeId,
        }
      : semanticFact.subject || {};
    return {
      kind: semanticFact.kind,
      subject,
      observed: Number.isFinite(actualPx)
        ? `${actualPx} px`
        : formatCompactPatternFactValue(semanticFact.relation),
      actual: Number.isFinite(actualPx) ? actualPx : semanticFact.relation,
      baseline: null,
    };
  }

  if (
    typeof assessment?.ruleId === 'string' &&
    assessment.factPath ===
      `coverage.rule.${assessment.ruleId}.requiredEvidence` &&
    (requestDocument?.resolution?.requestedRuleIds || []).includes(
      assessment.ruleId
    )
  ) {
    const readiness = buildSemanticRuleCoverage(
      requestDocument?.semanticModel?.rules || [],
      requestDocument?.semanticModel?.facts || [],
      requestDocument?.context || {}
    ).find((entry) => entry.ruleId === assessment.ruleId);
    if (readiness?.status === 'not_evaluable') {
      const rootNodeId = requestDocument?.context?.figma?.rootNodeId ||
        assessment.nodeId;
      const isTitleViewSpacingRule =
        typeof assessment.ruleId === 'string' &&
        /title-view/i.test(assessment.ruleId) &&
        (requestDocument?.semanticModel?.rules || []).some((rule) => (
          rule?.id === assessment.ruleId &&
          rule?.assertion?.kind === 'vertical-spacing-relations'
        ));
      return {
        kind: 'rule_coverage',
        subject: {
          nodeId: rootNodeId,
          name: requestDocument?.report?.scan?.selection?.[0]?.name ||
            'Область проверки',
          path: requestDocument?.report?.scan?.selection?.[0]?.path || null,
        },
        observed: isTitleViewSpacingRule
          ? 'Не определены связи TitleView с соседними блоками.'
          : [
              ...(readiness.missingFactKinds || []),
              ...(readiness.missingEvidence || []),
            ].join(', '),
        actual: {
          missingFactKinds: readiness.missingFactKinds || [],
          missingEvidence: readiness.missingEvidence || [],
        },
        baseline: null,
      };
    }
  }

  for (const relation of requestDocument?.architectureAudit?.layoutRelations || []) {
    const factPath = `patterns.${assessment.ruleId}.${relation?.id}.actualPx`;
    if (factPath !== assessment.factPath) continue;
    const actualPx = relation?.measurement?.actualPx;
    const subject = relation?.to?.nodeId === assessment.nodeId
      ? relation.to
      : relation?.from?.nodeId === assessment.nodeId
        ? relation.from
        : relation.container || {};
    return {
      kind: 'architecture_relation',
      subject,
      observed: Number.isFinite(actualPx) ? `${actualPx} px` : assessment.rationale,
      actual: Number.isFinite(actualPx) ? actualPx : assessment.rationale,
      baseline: null,
    };
  }

  for (const observation of requestDocument?.observations || []) {
    for (const container of observation?.containers || []) {
      if (
        container?.nodeId !== assessment.nodeId ||
        container?.factPath !== assessment.factPath
      ) continue;
      return {
        kind: 'observation',
        subject: {
          nodeId: container.nodeId,
          name: container.name || null,
          path: container.path || null,
        },
        observed: String(container.actualCount),
        actual: container.actualCount,
        baseline: null,
      };
    }
  }
  return null;
}


function expandCompactPatternAssessmentResponse(
  result,
  payload,
  skillManifest,
  requestDocument
) {
  if (!isCompactPatternAssessmentResponse(result)) return result;
  const invalid = (message) => {
    throw buildApolloSkillResponseError(`compact pattern response ${message}`);
  };
  if (!isPatternReportPayload(payload)) {
    invalid('is only valid for pattern reports.');
  }
  if (result.auditId !== getCodexPayloadAuditId(payload)) {
    invalid('auditId does not match the request.');
  }

  const rulesById = new Map(
    (requestDocument?.semanticModel?.rules || [])
      .filter((rule) => typeof rule?.id === 'string' && rule.id)
      .map((rule) => [rule.id, rule])
  );
  const reportChanges = getApolloReportAtomicChanges(payload);
  const reportChangeKeys = new Set(reportChanges.map((change) => change.key));
  const reportChangesByKey = new Map(
    reportChanges.map((change) => [change.key, change])
  );
  const assessmentKeys = new Set();
  const findingIds = new Set();
  const findings = [];
  const classifications = [];
  const sourceEntries = new Map();
  let findingIndex = 0;

  const addSourceTrace = (rule, findingId, used) => {
    const source = rule?.source;
    if (
      !source ||
      !['ds-ai-hub', 'design-system_ab'].includes(source.source) ||
      !isSafeRelativePath(source.path)
    ) return;
    const key = `${source.source}:${source.path}:${used ? 'used' : 'consulted'}`;
    if (!sourceEntries.has(key)) {
      sourceEntries.set(key, {
        source: source.source,
        path: source.path,
        revision: null,
        checksum: null,
        role: ['component', 'slot', 'composition'].includes(rule.scope)
          ? 'component-contract'
          : 'normative-rule',
        purpose: used
          ? 'Нормативное основание для классификации.'
          : 'Контекст правила, недостаточный для подтверждённого решения.',
        ruleIds: [],
        findingIds: [],
      });
    }
    const entry = sourceEntries.get(key);
    if (!entry.ruleIds.includes(rule.id)) entry.ruleIds.push(rule.id);
    if (findingId && !entry.findingIds.includes(findingId)) {
      entry.findingIds.push(findingId);
    }
  };

  for (const assessment of result.assessments) {
    if (!assessment || typeof assessment !== 'object') {
      invalid('contains an invalid assessment.');
    }
    const assessmentKey = `${assessment.nodeId}|${assessment.factPath}`;
    if (assessmentKeys.has(assessmentKey)) {
      invalid(`duplicates ${assessmentKey}.`);
    }
    assessmentKeys.add(assessmentKey);
    const fact = resolveCompactPatternFact(requestDocument, assessment);
    if (!fact) invalid(`references unknown fact ${assessmentKey}.`);

    let rule = typeof assessment.ruleId === 'string'
      ? rulesById.get(assessment.ruleId)
      : null;
    let disposition = assessment.disposition;
    let assessmentTitle = assessment.title;
    let assessmentRationale = assessment.rationale;
    let assessmentExpectation = assessment.expectation;
    let assessmentFix = assessment.fix;
    const inputChange = reportChangesByKey.get(assessmentKey);
    const deterministicVerdict = inputChange?.assessment?.verdict;
    const deterministicRuleId = inputChange?.assessment?.ruleId;
    const deterministicComponentRule = findReportComponentRule(
      inputChange,
      deterministicRuleId
    );
    const deterministicRule = rulesById.get(deterministicRuleId) || null;
    const authoritativeViolation =
      deterministicVerdict === 'violation' &&
      isActiveComponentDesignRule(deterministicComponentRule);
    const authoritativeAllowed =
      ['allowed', 'expected'].includes(deterministicVerdict) &&
      isActiveComponentDesignRule(deterministicComponentRule);
    const deterministicDisposition = authoritativeViolation
      ? 'error'
      : authoritativeAllowed
        ? 'allowed'
        : null;
    if (
      deterministicDisposition &&
      disposition !== deterministicDisposition
    ) {
      console.warn('[Apollo][codex] normalized compact assessment to deterministic verdict', {
        assessmentId: assessment.id || null,
        nodeId: assessment.nodeId,
        factPath: assessment.factPath,
        agentDisposition: disposition,
        deterministicDisposition,
        ruleId: deterministicRuleId || null,
      });
      disposition = deterministicDisposition;
      rule = deterministicRule || rule;
      assessmentTitle = authoritativeViolation
        ? 'Нарушено обязательное правило компонента'
        : 'Изменение разрешено компонентом';
      assessmentRationale =
        inputChange?.assessment?.message ||
        deterministicComponentRule?.ruleText ||
        assessmentRationale;
      assessmentExpectation =
        deterministicComponentRule?.ruleText ||
        assessmentExpectation;
      assessmentFix = authoritativeViolation
        ? deterministicComponentRule?.remediation || assessmentFix
        : 'Изменение не требует исправления.';
    }
    const hasVerifiedSource = Boolean(
      rule?.authoritative === true &&
      ['ds-ai-hub', 'design-system_ab'].includes(rule?.source?.source) &&
      isSafeRelativePath(rule?.source?.path)
    );
    if (
      ['error', 'warning'].includes(disposition) &&
      (!rule || rule.effect !== 'violation' || !hasVerifiedSource)
    ) {
      disposition = 'human_review';
    }
    if (
      disposition === 'allowed' &&
      (!rule || rule.effect !== 'allow' || !hasVerifiedSource)
    ) {
      disposition = 'human_review';
    }

    const isPropertyFact = reportChangeKeys.has(assessmentKey);
    if (disposition === 'ok') {
      if (isPropertyFact) {
        invalid(`marks property fact ${assessmentKey} as ok.`);
      }
      addSourceTrace(rule, null, false);
      continue;
    }
    if (disposition === 'allowed') {
      if (!isPropertyFact) {
        invalid(`marks non-property fact ${assessmentKey} as allowed.`);
      }
      classifications.push({
        nodeId: assessment.nodeId,
        factPath: assessment.factPath,
        disposition,
        findingId: null,
        ruleId: rule?.id || null,
        rationale: assessmentRationale,
      });
      addSourceTrace(rule, null, true);
      continue;
    }

    const findingId = assessment.id || `PAT-${String(++findingIndex).padStart(3, '0')}`;
    if (findingIds.has(findingId)) invalid(`duplicates finding id ${findingId}.`);
    findingIds.add(findingId);
    const findingRuleId = rule?.id || assessment.ruleId || 'apollo:unconfirmed-rule';
    const source = rule?.source;
    const verified = ['error', 'warning'].includes(disposition) && hasVerifiedSource;
    const objectName =
      fact?.subject?.name || fact?.subject?.componentName || assessment.nodeId;
    const objectPath = fact?.subject?.path || objectName;
    let observedFact = fact.observed;
    if (
      findingRuleId ===
        'component:web-corp.background-plate.level-2-requires-level-1' &&
      fact.kind === 'group_aggregate'
    ) {
      const occurrence = (requestDocument?.semanticModel?.facts || []).find(
        (candidate) => (
          candidate?.kind === 'component_occurrence' &&
          candidate?.subject?.nodeId === assessment.nodeId
        )
      );
      const position = occurrence?.component?.variantProperties?.Position ||
        'Level 2 (inner)';
      const parentName = occurrence?.component?.owner?.name ||
        occurrence?.component?.parentNodeId ||
        'неопределённый компонент';
      observedFact = `Position=${position}; прямой родитель — ${parentName}.`;
    }
    const snapshotEvidence = {
      kind: 'snapshot_fact',
      source: 'figma_snapshot',
      path: null,
      ruleId: findingRuleId,
      quote: null,
      factPath: assessment.factPath,
      actual: fact.actual,
      expected: assessmentExpectation,
      verified: true,
      verificationReason: 'Факт восстановлен из канонической Semantic Fact Model.',
    };
    const verifiedEvidence = [snapshotEvidence];
    if (verified) {
      verifiedEvidence.push({
        kind: ['component', 'slot', 'composition'].includes(rule.scope)
          ? 'component_contract'
          : 'approved_rule',
        source: source.source,
        path: source.path,
        ruleId: rule.id,
        quote: source.quote || rule.text || null,
        factPath: assessment.factPath,
        actual: fact.actual,
        expected: assessmentExpectation,
        verified: true,
        verificationReason: 'Active authoritative rule выбран агентом для этого факта.',
      });
    }
    const actions = [{
      type: 'focus_node',
      label: 'Показать',
      userDecisionRequired: true,
      payload: [{ key: 'nodeId', value: assessment.nodeId }],
    }];
    if (hasVerifiedSource) {
      actions.push({
        type: 'open_source',
        label: 'Открыть источник',
        userDecisionRequired: true,
        payload: [
          { key: 'source', value: source.source },
          { key: 'path', value: source.path },
        ],
      });
    }
    findings.push({
      id: findingId,
      dedupeKey: `${assessment.nodeId}|${findingRuleId}|${assessment.factPath}`,
      nodeId: assessment.nodeId,
      ruleId: findingRuleId,
      factPath: assessment.factPath,
      priority: disposition,
      category: isPropertyFact ? 'component-pattern' : 'patterns',
      title: assessmentTitle,
      object: {
        name: objectName,
        path: objectPath,
        figmaUrl: buildFigmaSelectionUrl(
          { figma: { fileKey: payload?.report?.figma?.fileKey || null } },
          assessment.nodeId
        ),
      },
      fact: observedFact,
      expectation: assessmentExpectation,
      rationale: assessmentRationale,
      fix: assessmentFix,
      evidenceStatus: verified ? 'verified' : 'unresolved',
      verifiedEvidence,
      actions,
    });
    if (isPropertyFact) {
      classifications.push({
        nodeId: assessment.nodeId,
        factPath: assessment.factPath,
        disposition,
        findingId,
        ruleId: rule?.id || null,
        rationale: assessmentRationale,
      });
    }
    addSourceTrace(rule, findingId, verified);
  }

  const missingChanges = [...reportChangeKeys].filter(
    (changeKey) => !assessmentKeys.has(changeKey)
  );
  if (missingChanges.length) {
    invalid(`does not classify report facts: ${missingChanges.join(', ')}.`);
  }

  const usedSources = [];
  const consultedSources = [];
  for (const [key, entry] of sourceEntries) {
    (key.endsWith(':used') ? usedSources : consultedSources).push(entry);
  }
  const summary = {
    checkedNodes: getCodexPayloadCheckedNodes(payload),
    errors: findings.filter((finding) => finding.priority === 'error').length,
    warnings: findings.filter((finding) => finding.priority === 'warning').length,
    humanReview: findings.filter(
      (finding) => finding.priority === 'human_review'
    ).length,
    allowed: classifications.filter(
      (classification) => classification.disposition === 'allowed'
    ).length,
    contextHints: 0,
    skippedRuleGroups: ['editorial-rules', 'other-pattern-rules'],
  };
  const clarificationQuestions = (result.clarificationQuestions || []).map(
    (question, index) => ({
      id: `clarification-${index + 1}`,
      nodeId: payload?.report?.scan?.selection?.[0]?.nodeId ||
        getCodexPayloadNodeIds(payload)[0],
      ruleId: 'apollo:clarification',
      round: 1,
      question,
      answerType: 'text',
      options: [],
    })
  );
  return {
    schemaVersion: 1,
    documentType: 'apollo-design-audit-response',
    auditId: result.auditId,
    skill: {
      name: skillManifest.name,
      version: skillManifest.version,
      checksum: skillManifest.checksum,
    },
    runStatus: result.runStatus,
    coverage: result.coverage,
    summary,
    findings,
    classifications,
    contextHints: [],
    clarificationQuestions,
    sourceTrace: { usedSources, consultedSources },
    responseMarkdown: result.summaryText || '',
  };
}


function getResolvedAuthorityRules(requestDocument) {
  const rules = new Map();
  for (const rule of requestDocument?.semanticModel?.rules || []) {
    if (rule?.authoritative !== true || typeof rule?.id !== 'string') continue;
    rules.set(rule.id, {
      ruleId: rule.id,
      ruleKind: 'design-rule',
      severity: rule.severity,
      appliesTo: rule.appliesTo,
      authority: rule.authority,
    });
  }
  return rules;
}


function normalizeTextFindingAuthority(
  result,
  resolvedRulesById = new Map(),
  sourceRoots = {}
) {
  for (const finding of result.findings || []) {
    if (finding?.priority === 'human_review') continue;
    const inactiveComponentEvidence = (finding.verifiedEvidence || []).some(
      (evidence) => {
        if (evidence?.kind !== 'component_contract') return false;
        const ruleId = evidence?.ruleId || finding.ruleId;
        const semanticRule = resolvedRulesById.get(ruleId);
        if (isActiveComponentDesignRule(semanticRule)) return false;
        const fileRule = resolveSnapshotComponentRuleEvidence(
          { ...evidence, ruleId },
          sourceRoots
        );
        return !isActiveComponentDesignRule(fileRule);
      }
    );
    if (!inactiveComponentEvidence) continue;
    finding.priority = 'human_review';
    finding.evidenceStatus = 'unresolved';
    finding.actions = (finding.actions || []).filter(
      (action) => action?.type !== 'propose_mutation'
    );
    console.warn('[Apollo][codex] downgraded text finding without active authority', {
      findingId: finding.id,
      ruleId: finding.ruleId,
    });
  }
  if (result.summary) {
    result.summary.errors = (result.findings || []).filter(
      (finding) => finding?.priority === 'error'
    ).length;
    result.summary.warnings = (result.findings || []).filter(
      (finding) => finding?.priority === 'warning'
    ).length;
    result.summary.humanReview = (result.findings || []).filter(
      (finding) => finding?.priority === 'human_review'
    ).length;
    // Text reports intentionally do not return one classification per clean
    // TEXT node. `allowed` therefore counts explicit allowed items, of which
    // the text response schema has none.
    result.summary.allowed = 0;
  }
}


function validateApolloSkillResponse(
  result,
  payload,
  skillManifest,
  sourceRoots = {},
  requestDocument = null
) {
  const invalid = (message) => {
    throw buildApolloSkillResponseError(message);
  };
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    invalid('response must be an object.');
  }
  if (
    result.schemaVersion !== 1 ||
    result.documentType !== 'apollo-design-audit-response'
  ) {
    invalid('unsupported schemaVersion or documentType.');
  }
  const expectedAuditId = getCodexPayloadAuditId(payload);
  if (typeof expectedAuditId === 'string' && result.auditId !== expectedAuditId) {
    invalid('auditId does not match the request.');
  }
  if (
    result.skill?.name !== skillManifest.name ||
    result.skill?.version !== skillManifest.version ||
    result.skill?.checksum !== skillManifest.checksum
  ) {
    invalid('skill name, version, or checksum does not match runtime preflight.');
  }
  if (!['completed', 'clarification_required', 'failed'].includes(result.runStatus)) {
    invalid('unsupported runStatus.');
  }
  if (!['full', 'base-only', 'partial'].includes(result.coverage)) {
    invalid('unsupported coverage.');
  }
  if (!Array.isArray(result.findings)) invalid('findings must be an array.');
  if (!Array.isArray(result.classifications)) {
    invalid('classifications must be an array.');
  }
  if (!Array.isArray(result.contextHints)) {
    invalid('contextHints must be an array.');
  }
  if (
    !Array.isArray(result.clarificationQuestions) ||
    result.clarificationQuestions.length > 3
  ) {
    invalid('clarificationQuestions must contain at most three items.');
  }
  if (
    result.runStatus === 'clarification_required' &&
    result.clarificationQuestions.length === 0
  ) {
    invalid('clarification_required must include a question.');
  }

  const validNodeIds = new Set(getCodexPayloadNodeIds(payload));
  const priorities = new Set(['error', 'warning', 'human_review']);
  const reportChanges = getApolloReportAtomicChanges(payload);
  const resolvedRulesById = getResolvedAuthorityRules(requestDocument);
  if (isTextReportPayload(payload)) {
    normalizeTextFindingAuthority(
      result,
      resolvedRulesById,
      sourceRoots
    );
  }
  if (isCustomizationReportPayload(payload) || isPatternReportPayload(payload)) {
    normalizeReportResponseFactPaths(result, reportChanges);
    if (isPatternReportPayload(payload)) {
      removePageSpecificPatternClassifications(result);
    }
    normalizeReportFindingAuthority(
      result,
      reportChanges,
      resolvedRulesById
    );
  }
  const findingIds = new Set();
  const dedupeKeys = new Set();
  const counts = { error: 0, warning: 0, human_review: 0 };
  for (const finding of result.findings) {
    if (!finding || typeof finding !== 'object') invalid('invalid finding.');
    if (typeof finding.id !== 'string' || !finding.id) {
      invalid('finding id is required.');
    }
    if (!validNodeIds.has(finding.nodeId)) {
      invalid(`finding ${finding.id} references a node outside the snapshot.`);
    }
    if (!priorities.has(finding.priority)) {
      invalid(`finding ${finding.id} has unsupported priority.`);
    }
    const expectedDedupeKey = [
      finding.nodeId,
      finding.ruleId,
      finding.factPath,
    ].join('|');
    if (finding.dedupeKey !== expectedDedupeKey) {
      console.warn('[Apollo][codex] repaired derived finding dedupeKey', {
        findingId: finding.id,
      });
      finding.dedupeKey = expectedDedupeKey;
    }
    if (findingIds.has(finding.id) || dedupeKeys.has(finding.dedupeKey)) {
      invalid(`finding ${finding.id} is duplicated.`);
    }
    findingIds.add(finding.id);
    dedupeKeys.add(finding.dedupeKey);
    counts[finding.priority] += 1;

    const evidenceItems = Array.isArray(finding.verifiedEvidence)
      ? finding.verifiedEvidence
      : [];
    const inputChange = reportChanges.find(
      (change) =>
        change.nodeId === finding.nodeId &&
        change.factPath === finding.factPath
    );
    const reportComponentRule = findReportComponentRule(inputChange, finding.ruleId);
    const referencedComponentRule = isActiveComponentDesignRule(reportComponentRule)
      ? reportComponentRule
      : resolvedRulesById.get(finding.ruleId) || reportComponentRule;
    if (
      finding.priority !== 'human_review' &&
      referencedComponentRule &&
      !isActiveComponentDesignRule(referencedComponentRule)
    ) {
      invalid(
        `finding ${finding.id} uses a component rule without active authority.`
      );
    }
    const sanitizedEvidenceItems = [];
    for (const evidence of evidenceItems) {
      if (evidence?.kind !== 'component_contract') continue;
      const evidenceRuleId = evidence?.ruleId || finding.ruleId;
      const componentRule = (
        isCustomizationReportPayload(payload) || isPatternReportPayload(payload)
      )
        ? (() => {
            const reportRule = findReportComponentRule(inputChange, evidenceRuleId);
            return isActiveComponentDesignRule(reportRule)
              ? reportRule
              : resolvedRulesById.get(evidenceRuleId) || reportRule;
          })()
        : resolveSnapshotComponentRuleEvidence(
          { ...evidence, ruleId: evidenceRuleId },
          sourceRoots
      );
      if (!isActiveComponentDesignRule(componentRule)) {
        if (finding.priority === 'human_review') {
          console.warn(
            '[Apollo][codex] removed non-authoritative component evidence from human review',
            {
              findingId: finding.id,
              ruleId: evidenceRuleId,
            }
          );
          continue;
        }
        invalid(
          `finding ${finding.id} has component-contract evidence without active authority.`
        );
      }
      sanitizedEvidenceItems.push(evidence);
    }
    finding.verifiedEvidence = evidenceItems.filter((evidence) => (
      evidence?.kind !== 'component_contract' ||
      sanitizedEvidenceItems.includes(evidence)
    ));
    if (
      finding.priority === 'human_review' &&
      finding.verifiedEvidence.length !== evidenceItems.length
    ) {
      finding.evidenceStatus = 'unresolved';
    }
    if (finding.priority !== 'human_review') {
      const observedEvidence = evidenceItems.some((evidence) => (
        ['snapshot_fact', 'screenshot_observation', 'user_context'].includes(
          evidence?.kind
        ) && evidence?.verified === true
      ));
      const normativeEvidence = evidenceItems.some((evidence) => (
        ['component_contract', 'approved_rule', 'replacement_mapping'].includes(
          evidence?.kind
        ) &&
        (evidence?.source === 'ds-ai-hub' ||
          evidence?.source === 'design-system_ab') &&
        isSafeRelativePath(evidence?.path) &&
        evidence?.verified === true
      ));
      if (
        finding.evidenceStatus !== 'verified' ||
        evidenceItems.some((evidence) => evidence?.verified !== true) ||
        !observedEvidence ||
        !normativeEvidence
      ) {
        invalid(
          `finding ${finding.id} is an error/warning without both evidence lanes.`
        );
      }
    }
    if (!Array.isArray(finding.actions)) {
      invalid(`finding ${finding.id} actions must be an array.`);
    }
    const safeActions = [];
    for (const action of finding.actions) {
      if (action?.userDecisionRequired !== true) {
        invalid(`finding ${finding.id} contains an automatic action.`);
      }
      if (
        isTextReportPayload(payload) &&
        !['focus_node', 'open_source'].includes(action?.type)
      ) {
        invalid(`finding ${finding.id} contains an unsupported text-audit action.`);
      }
      if (
        action?.type === 'propose_mutation' &&
        (finding.priority !== 'error' || finding.evidenceStatus !== 'verified')
      ) {
        console.warn('[Apollo][codex] removed unsafe mutation proposal', {
          findingId: finding.id,
          priority: finding.priority,
          evidenceStatus: finding.evidenceStatus,
        });
        continue;
      }
      safeActions.push(action);
    }
    finding.actions = safeActions;
  }

  const reportChangeKeys = new Set();
  for (const change of reportChanges) {
    if (reportChangeKeys.has(change.key)) {
      invalid(`report contains a duplicate atomic change ${change.key}.`);
    }
    reportChangeKeys.add(change.key);
  }
  const classificationKeys = new Set();
  const classifiedFindingIds = new Set();
  let allowedCount = 0;
  for (const classification of result.classifications) {
    if (!classification || typeof classification !== 'object') {
      invalid('invalid classification.');
    }
    const classificationKey = `${classification.nodeId}|${classification.factPath}`;
    if (classificationKeys.has(classificationKey)) {
      invalid(`classification ${classificationKey} is duplicated.`);
    }
    classificationKeys.add(classificationKey);
    if (reportChanges.length && !reportChangeKeys.has(classificationKey)) {
      invalid(`classification ${classificationKey} is outside the report.`);
    }
    if (
      !reportChanges.length &&
      (isCustomizationReportPayload(payload) || isPatternReportPayload(payload))
    ) {
      invalid(`classification ${classificationKey} is outside the empty report.`);
    }
    if (
      !isCustomizationReportPayload(payload) &&
      !isPatternReportPayload(payload)
    ) {
      invalid('classifications are only allowed for customization reports.');
    }
    if (
      !['error', 'warning', 'human_review', 'allowed'].includes(
        classification.disposition
      )
    ) {
      invalid(`classification ${classificationKey} has unsupported disposition.`);
    }
    if (
      typeof classification.rationale !== 'string' ||
      !classification.rationale.trim()
    ) {
      invalid(`classification ${classificationKey} requires rationale.`);
    }
    const inputChange = reportChanges.find(
      (change) => change.key === classificationKey
    );
    const assessmentVerdict = inputChange?.assessment?.verdict;
    const assessmentRule = findReportComponentRule(
      inputChange,
      inputChange?.assessment?.ruleId
    );
    const authoritativeViolation =
      assessmentVerdict === 'violation' &&
      isActiveComponentDesignRule(assessmentRule);
    const authoritativeAllowed =
      ['allowed', 'expected'].includes(assessmentVerdict) &&
      isActiveComponentDesignRule(assessmentRule);
    if (
      authoritativeViolation &&
      classification.disposition !== 'error'
    ) {
      invalid(
        `classification ${classificationKey} downgrades a deterministic violation.`
      );
    }
    if (
      authoritativeAllowed &&
      classification.disposition !== 'allowed'
    ) {
      invalid(
        `classification ${classificationKey} contradicts a deterministic ${assessmentVerdict} assessment.`
      );
    }
    if (classification.disposition === 'allowed') {
      allowedCount += 1;
      if (classification.findingId !== null) {
        invalid(`allowed classification ${classificationKey} references a finding.`);
      }
      continue;
    }
    if (
      typeof classification.findingId !== 'string' ||
      !classification.findingId ||
      !findingIds.has(classification.findingId)
    ) {
      invalid(`classification ${classificationKey} has no matching finding.`);
    }
    if (classifiedFindingIds.has(classification.findingId)) {
      invalid(`finding ${classification.findingId} has multiple classifications.`);
    }
    const finding = result.findings.find(
      (entry) => entry.id === classification.findingId
    );
    if (
      finding.nodeId !== classification.nodeId ||
      finding.factPath !== classification.factPath ||
      finding.priority !== classification.disposition ||
      (
        classification.ruleId !== null &&
        classification.ruleId !== finding.ruleId
      )
    ) {
      invalid(`classification ${classificationKey} does not match its finding.`);
    }
    classifiedFindingIds.add(classification.findingId);
  }
  if (
    isCustomizationReportPayload(payload) ||
    isPatternReportPayload(payload)
  ) {
    if (classificationKeys.size !== reportChangeKeys.size) {
      const missingKeys = [...reportChangeKeys].filter(
        (changeKey) => !classificationKeys.has(changeKey)
      );
      invalid(`report changes are not fully classified: ${missingKeys.join(', ')}.`);
    }
    if (
      isCustomizationReportPayload(payload) &&
      classifiedFindingIds.size !== findingIds.size
    ) {
      invalid('every report finding must have exactly one classification.');
    }
    if (isPatternReportPayload(payload)) {
      const unclassifiedGeneralFinding = result.findings.find((finding) => (
        reportChangeKeys.has(`${finding.nodeId}|${finding.factPath}`) &&
        !classifiedFindingIds.has(finding.id)
      ));
      if (unclassifiedGeneralFinding) {
        invalid(
          `general finding ${unclassifiedGeneralFinding.id} has no classification.`
        );
      }
    }
  } else if (result.classifications.length !== 0) {
    invalid('non-report response must use an empty classifications array.');
  }

  if (
    !result.summary ||
    result.summary.errors !== counts.error ||
    result.summary.warnings !== counts.warning ||
    result.summary.humanReview !== counts.human_review ||
    result.summary.allowed !== allowedCount ||
    result.summary.contextHints !== result.contextHints.length
  ) {
    invalid('summary counters do not match response items.');
  }
  if (
    !result.sourceTrace ||
    !Array.isArray(result.sourceTrace.usedSources) ||
    !Array.isArray(result.sourceTrace.consultedSources)
  ) {
    invalid('sourceTrace is incomplete.');
  }
  for (const sourceEntry of result.sourceTrace.usedSources.concat(
    result.sourceTrace.consultedSources
  )) {
    if (!isSafeRelativePath(sourceEntry?.path)) {
      invalid('sourceTrace contains an unsafe path.');
    }
    if (
      !Array.isArray(sourceEntry.ruleIds) ||
      !Array.isArray(sourceEntry.findingIds) ||
      sourceEntry.findingIds.some((findingId) => !findingIds.has(findingId))
    ) {
      invalid('sourceTrace contains invalid finding references.');
    }
  }
  if (typeof result.responseMarkdown !== 'string') {
    invalid('responseMarkdown must be a string.');
  }
  return result;
}


function adaptApolloSkillResponse(result, payload) {
  const patternMode = isPatternReportPayload(payload);
  const reportChangesByKey = new Map(
    getApolloReportAtomicChanges(payload).map((change) => [change.key, change])
  );
  const findings = result.findings.map((finding) => {
    const isComponentRuleFinding =
      typeof finding?.ruleId === 'string' &&
      finding.ruleId.startsWith('component:');
    const evidence = finding.verifiedEvidence
      .filter((item) => (
        (item?.source === 'ds-ai-hub' || item?.source === 'design-system_ab') &&
        isSafeRelativePath(item.path) &&
        (typeof item.ruleId === 'string' || typeof item.quote === 'string')
      ))
      .map((item) => ({
        source: item.source,
        path: item.path,
        ruleId: item.ruleId ?? null,
        quote: item.quote ?? null,
      }));
    return {
      id: finding.id,
      nodeId: finding.nodeId,
      severity:
        finding.priority === 'human_review' ? 'info' : finding.priority,
      priority: finding.priority,
      ruleId: finding.ruleId,
      factPath: finding.factPath,
      category: finding.category,
      title: finding.title,
      observed: finding.fact,
      expected: finding.expectation,
      rationale: finding.rationale,
      suggestedFix: finding.fix,
      confidence: finding.evidenceStatus === 'verified' ? 1 : 0,
      object: finding.object,
      actions: finding.actions,
      evidence,
      patternScope: patternMode
        ? isComponentRuleFinding ||
          reportChangesByKey.has(`${finding.nodeId}|${finding.factPath}`)
          ? 'general'
          : 'page-specific'
        : null,
    };
  });
  const sourcesUsed = result.sourceTrace.usedSources.map((source) => ({
    source: source.source,
    path: source.path,
    purpose: source.purpose,
  }));
  const classifications = result.classifications.map((classification) => ({
    nodeId: classification.nodeId,
    factPath: classification.factPath,
    disposition: classification.disposition,
    findingId: classification.findingId,
    ruleId: classification.ruleId,
    rationale: classification.rationale,
  }));
  const allowedCustomizations = classifications
    .filter((classification) => classification.disposition === 'allowed')
    .map((classification) => {
      const change = reportChangesByKey.get(
        `${classification.nodeId}|${classification.factPath}`
      );
      return {
        nodeId: classification.nodeId,
        factPath: classification.factPath,
        ruleId: classification.ruleId,
        title: `${change?.nodeName || classification.nodeId}: ${classification.factPath}`,
        observed: `${getApolloReportValue(change?.reference)} → ${getApolloReportValue(change?.actual)}`,
        rationale: classification.rationale,
        patternScope: patternMode ? 'general' : null,
      };
    });
  return {
    schemaVersion: 2,
    runId: result.auditId,
    mode: isTextReportPayload(payload)
      ? 'text-report'
      : payload.mode === 'question'
        ? 'question'
        : 'validation',
    status:
      result.runStatus === 'completed' &&
      !findings.some((finding) => finding.priority === 'human_review')
        ? 'completed'
        : 'needs_review',
    summary: {
      checkedNodes: 0,
      errors: 0,
      warnings: 0,
      info: 0,
      allowed: allowedCustomizations.length,
    },
    findings,
    classifications,
    allowedCustomizations,
    sourcesUsed,
    responseMarkdown: result.responseMarkdown,
    skill: result.skill,
    runStatus: result.runStatus,
    coverage: result.coverage,
    contextHints: result.contextHints,
    clarificationQuestions: result.clarificationQuestions,
    sourceTrace: result.sourceTrace,
    sourcesConsulted: result.sourceTrace.consultedSources.map((source) => ({
      source: source.source,
      path: source.path,
      purpose: source.purpose,
    })),
    patternAudit: patternMode ? {
      pageType: payload?.report?.scan?.pageType || null,
      generalChangeCount:
        payload?.report?.summary?.generalChangeCount ?? reportChangesByKey.size,
      requestedRuleCount:
        payload?.report?.summary?.requestedRuleCount ??
        payload?.report?.requestedRuleIds?.length ?? 0,
    } : null,
  };
}


function normalizeCodexValidation(
  result,
  payload,
  skillManifest = null,
  requestDocument = null
) {
  if (isCompactPatternAssessmentResponse(result)) {
    if (!skillManifest) {
      throw buildApolloSkillResponseError('runtime skill manifest is missing.');
    }
    result = expandCompactPatternAssessmentResponse(
      result,
      payload,
      skillManifest,
      requestDocument
    );
  }
  if (result?.documentType === 'apollo-design-audit-response') {
    if (!skillManifest) {
      throw buildApolloSkillResponseError('runtime skill manifest is missing.');
    }
    result = adaptApolloSkillResponse(
      validateApolloSkillResponse(
        result,
        payload,
        skillManifest,
        {},
        requestDocument
      ),
      payload
    );
  }
  if (!result || typeof result !== 'object' || !Array.isArray(result.findings)) {
    const err = new Error('Codex response does not match Apollo validation contract.');
    err.status = 502;
    throw err;
  }

  const validNodeIds = new Set(getCodexPayloadNodeIds(payload));
  const findings = result.findings.filter((finding) => {
    return (
      finding &&
      typeof finding === 'object' &&
      typeof finding.nodeId === 'string' &&
      validNodeIds.has(finding.nodeId)
    );
  });
  const errors = findings.filter((finding) => finding.severity === 'error').length;
  const warnings = findings.filter((finding) => finding.severity === 'warning').length;
  const info = findings.filter((finding) => finding.severity === 'info').length;
  const allowed = Array.isArray(result.allowedCustomizations)
    ? result.allowedCustomizations.length
    : 0;

  result.schemaVersion = 2;
  result.mode = isPatternReportPayload(payload)
    ? 'pattern-report'
    : isTextReportPayload(payload)
      ? 'text-report'
    : isCustomizationReportPayload(payload)
      ? 'customization-report'
    : payload.mode === 'question'
      ? 'question'
      : 'validation';
  result.runId =
    typeof getCodexPayloadAuditId(payload) === 'string'
      ? getCodexPayloadAuditId(payload)
      : typeof result.runId === 'string'
        ? result.runId
        : crypto.randomUUID();
  result.status = result.status === 'needs_review' ? 'needs_review' : 'completed';
  result.findings = findings;
  result.summary = {
    checkedNodes: getCodexPayloadCheckedNodes(payload),
    errors,
    warnings,
    info,
    allowed,
  };
  result.responseMarkdown =
    typeof result.responseMarkdown === 'string'
      ? result.responseMarkdown
      : '';
  return result;
}


function getEvidenceSourceRoot(source, sourceRoots) {
  if (source === 'ds-ai-hub') return sourceRoots.dsAiHub;
  if (source === 'design-system_ab') return sourceRoots.designSystem;
  return null;
}


function resolveVerifiedSourcePath(source, relativePath, sourceRoots) {
  const root = getEvidenceSourceRoot(source, sourceRoots);
  if (!root || typeof relativePath !== 'string' || !relativePath.trim()) {
    return null;
  }
  if (path.isAbsolute(relativePath)) return null;
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (
    resolvedPath !== resolvedRoot &&
    !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    return null;
  }
  return { root: resolvedRoot, path: resolvedPath };
}


async function verifySourceFile(source, relativePath, sourceRoots, cache) {
  const resolved = resolveVerifiedSourcePath(
    source,
    relativePath,
    sourceRoots
  );
  if (!resolved) {
    return { verified: false, content: '', reason: 'invalid_source_path' };
  }
  if (cache.has(resolved.path)) return cache.get(resolved.path);

  const verification = await fsp
    .stat(resolved.path)
    .then(async (stat) => {
      if (!stat.isFile()) {
        return { verified: false, content: '', reason: 'not_a_file' };
      }
      if (stat.size > 8 * 1024 * 1024) {
        return { verified: false, content: '', reason: 'file_too_large' };
      }
      const content = await fsp.readFile(resolved.path, 'utf8');
      return { verified: true, content, reason: null };
    })
    .catch(() => ({
      verified: false,
      content: '',
      reason: 'file_not_found',
    }));
  cache.set(resolved.path, verification);
  return verification;
}


function normalizeEvidenceNeedle(value) {
  return typeof value === 'string' ? value.trim() : '';
}


async function verifyCodexEvidence(result, sourceRoots = {}) {
  const roots = {
    dsAiHub: sourceRoots.dsAiHub || CODEX_DS_AI_HUB,
    designSystem: sourceRoots.designSystem || CODEX_DESIGN_SYSTEM,
  };
  const fileCache = new Map();
  const reportedSources = Array.isArray(result.sourcesUsed)
    ? result.sourcesUsed
    : [];
  const verifiedSources = [];
  const verifiedConsultedSources = [];
  const sourceKeys = new Set();

  for (const sourceEntry of reportedSources) {
    const source = sourceEntry?.source;
    const sourcePath = sourceEntry?.path;
    const verification = await verifySourceFile(
      source,
      sourcePath,
      roots,
      fileCache
    );
    const key = `${source}:${sourcePath}`;
    if (sourceKeys.has(key)) continue;
    sourceKeys.add(key);
    verifiedSources.push({
      source,
      path: sourcePath,
      purpose:
        typeof sourceEntry?.purpose === 'string' ? sourceEntry.purpose : '',
      verified: verification.verified,
      verificationReason: verification.reason,
    });
  }

  const reportedConsultedSources = Array.isArray(result.sourcesConsulted)
    ? result.sourcesConsulted
    : [];
  for (const sourceEntry of reportedConsultedSources) {
    const verification = await verifySourceFile(
      sourceEntry?.source,
      sourceEntry?.path,
      roots,
      fileCache
    );
    verifiedConsultedSources.push({
      source: sourceEntry?.source,
      path: sourceEntry?.path,
      purpose:
        typeof sourceEntry?.purpose === 'string' ? sourceEntry.purpose : '',
      verified: verification.verified,
      verificationReason: verification.reason,
    });
  }

  const findings = [];
  for (const finding of result.findings) {
    const evidenceItems = Array.isArray(finding.evidence)
      ? finding.evidence
      : [];
    const verifiedEvidence = [];
    for (const evidence of evidenceItems) {
      const verification = await verifySourceFile(
        evidence?.source,
        evidence?.path,
        roots,
        fileCache
      );
      const quote = normalizeEvidenceNeedle(evidence?.quote);
      const ruleId = normalizeEvidenceNeedle(evidence?.ruleId);
      const matchedBy = verification.verified && quote && verification.content.includes(quote)
        ? 'quote'
        : verification.verified && ruleId && verification.content.includes(ruleId)
          ? 'ruleId'
          : null;
      verifiedEvidence.push({
        source: evidence?.source,
        path: evidence?.path,
        ruleId: evidence?.ruleId ?? null,
        quote: evidence?.quote ?? null,
        verified: Boolean(matchedBy),
        matchedBy,
        verificationReason: matchedBy
          ? null
          : verification.reason || 'rule_or_quote_not_found',
      });
      const sourceKey = `${evidence?.source}:${evidence?.path}`;
      if (!sourceKeys.has(sourceKey)) {
        sourceKeys.add(sourceKey);
        verifiedSources.push({
          source: evidence?.source,
          path: evidence?.path,
          purpose: `Evidence для finding: ${finding.title || finding.id || 'без названия'}`,
          verified: verification.verified,
          verificationReason: verification.reason,
        });
      }
    }
    const isConfirmed =
      finding.priority !== 'human_review' &&
      verifiedEvidence.some((evidence) => evidence.verified);
    findings.push({
      ...finding,
      verdict: isConfirmed ? 'confirmed' : 'assumption',
      verifiedEvidence,
    });
  }

  result.findings = findings;
  result.sourcesUsed = verifiedSources;
  result.sourcesConsulted = verifiedConsultedSources;
  result.summary.confirmed = findings.filter(
    (finding) => finding.verdict === 'confirmed'
  ).length;
  result.summary.assumptions = findings.filter(
    (finding) => finding.verdict === 'assumption'
  ).length;
  if (result.summary.assumptions > 0) result.status = 'needs_review';
  if (
    result.mode === 'validation' ||
    result.mode === 'customization-report' ||
    result.mode === 'pattern-report' ||
    result.mode === 'text-report'
  ) {
    result.responseMarkdown = buildVerifiedValidationMarkdown(result);
  }
  return result;
}


function escapeMarkdownTableCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}


function buildVerifiedFindingTable(findings) {
  if (!findings.length) return '_Нет записей._';
  const priorityLabel = (priority) => {
    if (priority === 'error') return 'Ошибка';
    if (priority === 'warning') return 'Предупреждение';
    return 'Требуется проверка';
  };
  const rows = findings.map((finding) => {
    const source = finding.verifiedEvidence
      .map((evidence) => `${evidence.source}/${evidence.path}`)
      .join(', ');
    const violation = `**${escapeMarkdownTableCell(finding.title)}**<br>${escapeMarkdownTableCell(finding.observed)}`;
    return `| ${escapeMarkdownTableCell(priorityLabel(finding.priority))} | ${violation} | ${escapeMarkdownTableCell(finding.expected)} | ${escapeMarkdownTableCell(source || 'Не подтверждён')} | ${escapeMarkdownTableCell(finding.suggestedFix)} |`;
  });
  return [
    '| Приоритет | Нарушение | Ожидание | Источник | Исправление |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}


function buildAllowedCustomizationTable(customizations) {
  const rows = customizations.map((customization) => {
    const source = customization.ruleId || 'Детерминированная оценка Apollo';
    return `| ${escapeMarkdownTableCell(customization.title)} | ${escapeMarkdownTableCell(customization.observed)} | ${escapeMarkdownTableCell(customization.rationale)} | ${escapeMarkdownTableCell(source)} |`;
  });
  return [
    '| Кастомизация | Факт | Обоснование | Источник |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}


function getPatternPageTypeLabel(pageType) {
  const labels = {
    form: 'Форма',
    landing: 'Лендинг',
    view: 'Просмотровая',
    hub: 'Разводящая',
    table: 'Страница с таблицей',
    dashboard: 'Дашборд',
    other: 'Другое',
  };
  return labels[pageType] || String(pageType || '');
}


function buildPatternScopeSection({
  stats,
  confirmed,
  assumptions,
  allowed,
}) {
  const parts = stats ? [stats] : [];
  const priorityOrder = { error: 0, warning: 1, human_review: 2 };
  const findings = confirmed.concat(assumptions).sort((left, right) => (
    (priorityOrder[left?.priority] ?? 3) -
    (priorityOrder[right?.priority] ?? 3)
  ));
  if (findings.length) parts.push(buildVerifiedFindingTable(findings));
  if (allowed.length) {
    parts.push(
      `### Допустимые изменения · ${allowed.length}`,
      buildAllowedCustomizationTable(allowed)
    );
  }
  return parts.join('\n\n');
}


function buildVerifiedValidationMarkdown(result) {
  const reportMode = result.mode === 'customization-report';
  const patternMode = result.mode === 'pattern-report';
  const textMode = result.mode === 'text-report';
  const agentSummary = (reportMode || patternMode || textMode) &&
    typeof result.responseMarkdown === 'string'
    ? result.responseMarkdown.trim()
    : '';
  const confirmed = result.findings.filter(
    (finding) => finding.verdict === 'confirmed'
  );
  const assumptions = result.findings.filter(
    (finding) => finding.verdict === 'assumption'
  );
  const allowedCustomizations = Array.isArray(result.allowedCustomizations)
    ? result.allowedCustomizations
    : [];
  const sources = result.sourcesUsed
    .map((source) => {
      const status = source.verified ? 'проверен' : 'не проверен';
      return `- \`${escapeMarkdownTableCell(`${source.source}/${source.path}`)}\` — ${status}; ${escapeMarkdownTableCell(source.purpose)}`;
    })
    .join('\n');
  const consultedSources = Array.isArray(result.sourcesConsulted) &&
    result.sourcesConsulted.length
    ? result.sourcesConsulted
        .map((source) => {
          const status = source.verified ? 'проверен' : 'не проверен';
          return `- \`${escapeMarkdownTableCell(`${source.source}/${source.path}`)}\` — ${status}; ${escapeMarkdownTableCell(source.purpose)}`;
        })
        .join('\n')
    : '';
  const contextHints = Array.isArray(result.contextHints) && result.contextHints.length
    ? result.contextHints.map((hint) => `- ${escapeMarkdownTableCell(hint.message)}`).join('\n')
    : '';
  const clarificationQuestions = Array.isArray(result.clarificationQuestions) &&
    result.clarificationQuestions.length
    ? result.clarificationQuestions
        .map((question) => `- ${escapeMarkdownTableCell(question.question)}`)
        .join('\n')
    : '';
  const skillTrace = result.skill
    ? `${result.skill.name} ${result.skill.version} · \`${String(result.skill.checksum).slice(0, 12)}\` · coverage: ${result.coverage || 'unknown'}`
    : 'Skill trace недоступен.';

  const lines = patternMode || textMode
    ? []
    : [
        reportMode ? '# Apollo v3 · Кастомизации' : '# Apollo v2',
        '',
        reportMode
          ? `Проверено компонентов: ${result.summary.checkedNodes}. Подтверждено: ${confirmed.length}. Требуют проверки: ${assumptions.length}.`
          : `Проверено слоёв: ${result.summary.checkedNodes}. Подтверждено: ${confirmed.length}. Требуют проверки: ${assumptions.length}.`,
      ];
  const appendSection = (title, content) => {
    if (!content) return;
    lines.push('', `## ${title}`, '', content);
  };
  appendSection('Итог агента', agentSummary);
  if (textMode) {
    const priorityOrder = { error: 0, warning: 1, human_review: 2 };
    const findings = confirmed.concat(assumptions).sort((left, right) => (
      (priorityOrder[left?.priority] ?? 3) -
      (priorityOrder[right?.priority] ?? 3)
    ));
    if (findings.length) lines.push('', buildVerifiedFindingTable(findings));
  } else if (patternMode) {
    const generalConfirmed = confirmed.filter(
      (finding) => finding.patternScope === 'general'
    );
    const generalAssumptions = assumptions.filter(
      (finding) => finding.patternScope === 'general'
    );
    const pageConfirmed = confirmed.filter(
      (finding) => finding.patternScope === 'page-specific'
    );
    const pageAssumptions = assumptions.filter(
      (finding) => finding.patternScope === 'page-specific'
    );
    const generalAllowed = allowedCustomizations.filter(
      (customization) => customization.patternScope === 'general'
    );
    appendSection(
      'Общие компонентные паттерны',
      buildPatternScopeSection({
        stats: '',
        confirmed: generalConfirmed,
        assumptions: generalAssumptions,
        allowed: generalAllowed,
      })
    );

    const pageType = result?.patternAudit?.pageType || null;
    const requestedRuleCount = Number.isFinite(
      result?.patternAudit?.requestedRuleCount
    )
      ? result.patternAudit.requestedRuleCount
      : 0;
    const pageTitle = pageType
      ? `Паттерны страницы · ${getPatternPageTypeLabel(pageType)}`
      : 'Специализированные паттерны страницы';
    const pageStats = pageType
      ? `Проверено правил: ${requestedRuleCount}. Подтверждено: ${pageConfirmed.length}. Требуют проверки: ${pageAssumptions.length}.`
      : 'Не выполнялись: тип страницы не выбран.';
    appendSection(
      pageTitle,
      buildPatternScopeSection({
        stats: pageStats,
        confirmed: pageConfirmed,
        assumptions: pageAssumptions,
        allowed: [],
      })
    );
  } else {
    if (confirmed.length) {
      appendSection('Подтверждённые нарушения', buildVerifiedFindingTable(confirmed));
    }
    if (assumptions.length) {
      appendSection('Предположения агента', buildVerifiedFindingTable(assumptions));
    }
    if (allowedCustomizations.length) {
      appendSection(
        `Допустимые кастомизации · ${allowedCustomizations.length}`,
        buildAllowedCustomizationTable(allowedCustomizations)
      );
    }
  }
  appendSection('Контекст проверки', contextHints);
  appendSection('Уточняющие вопросы', clarificationQuestions);
  appendSection('Файлы, использованные при аудите', sources);
  appendSection('Файлы, просмотренные при аудите', consultedSources);
  appendSection('Версия проверки', skillTrace);
  return lines.join('\n');
}

module.exports = {buildApolloSkillResponseError, getApolloReportAtomicChanges, findRuleByIdInDocument, resolveSnapshotComponentRuleEvidence, findReportComponentRule, findCanonicalReportChange, normalizeReportResponseFactPaths, removePageSpecificPatternClassifications, normalizeReportFindingAuthority, getApolloReportValue, isCompactPatternAssessmentResponse, formatCompactPatternFactValue, resolveCompactPatternFact, expandCompactPatternAssessmentResponse, getResolvedAuthorityRules, normalizeTextFindingAuthority, validateApolloSkillResponse, adaptApolloSkillResponse, normalizeCodexValidation, getEvidenceSourceRoot, resolveVerifiedSourcePath, verifySourceFile, normalizeEvidenceNeedle, verifyCodexEvidence, escapeMarkdownTableCell, buildVerifiedFindingTable, buildAllowedCustomizationTable, getPatternPageTypeLabel, buildPatternScopeSection, buildVerifiedValidationMarkdown};
