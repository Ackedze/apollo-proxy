#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const PRIORITIES = new Set(['error', 'warning', 'human_review']);
const DISPOSITIONS = new Set(['error', 'warning', 'human_review', 'allowed']);
const RUN_STATUSES = new Set([
  'completed',
  'clarification_required',
  'failed',
]);
const COVERAGE = new Set(['full', 'base-only', 'partial']);

function fail(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${label} must be a non-empty string`);
  }
}

function relativeSourcePath(value, label) {
  nonEmptyString(value, label);
  if (value.startsWith('/') || value.split(/[\\/]+/).includes('..')) {
    fail(`${label} must be a safe relative path`);
  }
}

function validateAction(action, finding) {
  object(action, `action for ${finding.id}`);
  if (action.userDecisionRequired !== true) {
    fail(`action ${action.type} must require an explicit user decision`);
  }
  if (action.type === 'propose_mutation') {
    if (finding.priority !== 'error' || finding.evidenceStatus !== 'verified') {
      fail(`mutation action is allowed only for a verified error: ${finding.id}`);
    }
  }
}

function validate(response) {
  object(response, 'response');
  if (response.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (response.documentType !== 'apollo-design-audit-response') {
    fail('documentType must be apollo-design-audit-response');
  }
  nonEmptyString(response.auditId, 'auditId');
  const skill = object(response.skill, 'skill');
  if (skill.name !== 'apollo-design-validator') {
    fail('skill.name must be apollo-design-validator');
  }
  nonEmptyString(skill.version, 'skill.version');
  if (!RUN_STATUSES.has(response.runStatus)) {
    fail(`unsupported runStatus: ${String(response.runStatus)}`);
  }
  if (!COVERAGE.has(response.coverage)) {
    fail(`unsupported coverage: ${String(response.coverage)}`);
  }

  if (!Array.isArray(response.findings)) fail('findings must be an array');
  const findingIds = new Set();
  const dedupeKeys = new Set();
  const counts = { error: 0, warning: 0, human_review: 0 };
  for (const [index, finding] of response.findings.entries()) {
    object(finding, `findings[${index}]`);
    nonEmptyString(finding.id, `findings[${index}].id`);
    nonEmptyString(finding.nodeId, `findings[${index}].nodeId`);
    nonEmptyString(finding.ruleId, `findings[${index}].ruleId`);
    nonEmptyString(finding.factPath, `findings[${index}].factPath`);
    if (!PRIORITIES.has(finding.priority)) {
      fail(`unsupported finding priority: ${String(finding.priority)}`);
    }
    const expectedDedupeKey = [
      finding.nodeId,
      finding.ruleId,
      finding.factPath,
    ].join('|');
    if (finding.dedupeKey !== expectedDedupeKey) {
      fail(`invalid dedupeKey for finding ${finding.id}`);
    }
    if (findingIds.has(finding.id)) fail(`duplicate finding id: ${finding.id}`);
    if (dedupeKeys.has(finding.dedupeKey)) {
      fail(`duplicate atomic finding: ${finding.dedupeKey}`);
    }
    findingIds.add(finding.id);
    dedupeKeys.add(finding.dedupeKey);
    counts[finding.priority] += 1;

    if (!Array.isArray(finding.verifiedEvidence)) {
      fail(`verifiedEvidence must be an array: ${finding.id}`);
    }
    if (finding.priority !== 'human_review') {
      if (finding.evidenceStatus !== 'verified') {
        fail(`error/warning must have verified evidence: ${finding.id}`);
      }
      if (
        finding.verifiedEvidence.length === 0 ||
        finding.verifiedEvidence.some((evidence) => evidence?.verified !== true)
      ) {
        fail(`error/warning contains unverified evidence: ${finding.id}`);
      }
    }
    if (!Array.isArray(finding.actions)) fail(`actions must be an array: ${finding.id}`);
    finding.actions.forEach((action) => validateAction(action, finding));
  }

  if (!Array.isArray(response.classifications)) {
    fail('classifications must be an array');
  }
  const classificationKeys = new Set();
  let allowedCount = 0;
  for (const [index, classification] of response.classifications.entries()) {
    object(classification, `classifications[${index}]`);
    nonEmptyString(classification.nodeId, `classifications[${index}].nodeId`);
    nonEmptyString(classification.factPath, `classifications[${index}].factPath`);
    nonEmptyString(classification.rationale, `classifications[${index}].rationale`);
    if (!DISPOSITIONS.has(classification.disposition)) {
      fail(`unsupported classification disposition: ${String(classification.disposition)}`);
    }
    const key = `${classification.nodeId}|${classification.factPath}`;
    if (classificationKeys.has(key)) fail(`duplicate classification: ${key}`);
    classificationKeys.add(key);
    if (classification.disposition === 'allowed') {
      allowedCount += 1;
      if (classification.findingId !== null) {
        fail(`allowed classification must not reference a finding: ${key}`);
      }
    } else {
      nonEmptyString(classification.findingId, `classification findingId for ${key}`);
      const finding = response.findings.find((item) => item.id === classification.findingId);
      if (!finding) fail(`classification references unknown finding: ${key}`);
      if (
        finding.nodeId !== classification.nodeId ||
        finding.factPath !== classification.factPath ||
        finding.priority !== classification.disposition
      ) {
        fail(`classification does not match its finding: ${key}`);
      }
    }
  }

  if (!Array.isArray(response.contextHints)) {
    fail('contextHints must be an array');
  }
  for (const hint of response.contextHints) {
    object(hint, 'context hint');
    if (hint.kind !== 'screen-type-suggestion') {
      fail(`unsupported context hint kind: ${String(hint.kind)}`);
    }
    if (!Array.isArray(hint.verifiedEvidence) || hint.verifiedEvidence.length === 0) {
      fail(`context hint must include verified evidence: ${hint.id}`);
    }
    if (hint.verifiedEvidence.some((evidence) => evidence?.verified !== true)) {
      fail(`context hint contains unverified evidence: ${hint.id}`);
    }
  }

  if (!Array.isArray(response.clarificationQuestions)) {
    fail('clarificationQuestions must be an array');
  }
  if (response.clarificationQuestions.length > 3) {
    fail('at most three clarification questions are allowed per round');
  }
  if (
    response.runStatus === 'clarification_required' &&
    response.clarificationQuestions.length === 0
  ) {
    fail('clarification_required must include at least one question');
  }

  const summary = object(response.summary, 'summary');
  if (summary.errors !== counts.error) fail('summary.errors does not match findings');
  if (summary.warnings !== counts.warning) {
    fail('summary.warnings does not match findings');
  }
  if (summary.humanReview !== counts.human_review) {
    fail('summary.humanReview does not match findings');
  }
  if (summary.allowed !== allowedCount) {
    fail('summary.allowed does not match classifications');
  }
  if (summary.contextHints !== response.contextHints.length) {
    fail('summary.contextHints does not match contextHints');
  }

  const trace = object(response.sourceTrace, 'sourceTrace');
  if (!Array.isArray(trace.usedSources) || !Array.isArray(trace.consultedSources)) {
    fail('sourceTrace must include usedSources and consultedSources arrays');
  }
  for (const [group, sources] of [
    ['usedSources', trace.usedSources],
    ['consultedSources', trace.consultedSources],
  ]) {
    for (const [index, source] of sources.entries()) {
      object(source, `${group}[${index}]`);
      relativeSourcePath(source.path, `${group}[${index}].path`);
      if (!Array.isArray(source.ruleIds) || !Array.isArray(source.findingIds)) {
        fail(`${group}[${index}] must include ruleIds and findingIds arrays`);
      }
      for (const findingId of source.findingIds) {
        if (!findingIds.has(findingId)) {
          fail(`${group}[${index}] references unknown finding: ${findingId}`);
        }
      }
    }
  }

  return {
    auditId: response.auditId,
    findings: response.findings.length,
    contextHints: response.contextHints.length,
    coverage: response.coverage,
  };
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: validate-response.mjs <response.json>');
  process.exit(2);
}

try {
  const response = JSON.parse(await readFile(inputPath, 'utf8'));
  const result = validate(response);
  console.log(JSON.stringify({ valid: true, ...result }));
} catch (error) {
  console.error(`Invalid Apollo audit response: ${error.message}`);
  process.exit(1);
}
