'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');


function validateCodexRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Request body must be an object.';
  }

  const mode = payload.mode === 'question' ? 'question' : 'validation';
  if (!payload.snapshot || typeof payload.snapshot !== 'object') {
    return mode === 'validation'
      ? 'Validation mode requires snapshot.'
      : 'Question mode requires the audited snapshot.';
  }
  if (!Array.isArray(payload.snapshot.nodes)) {
    return 'snapshot.nodes must be an array.';
  }
  if (
    !Array.isArray(payload.snapshot.selection) ||
    payload.snapshot.selection.length !== 1
  ) {
    return 'Apollo skill requires exactly one selected root.';
  }
  if (
    !Array.isArray(payload.snapshot.screenshots) ||
    payload.snapshot.screenshots.length !== 1
  ) {
    return 'Apollo skill requires exactly one selection screenshot.';
  }
  if (payload.snapshot.nodes.some((node) => node?.visible === false)) {
    return 'Apollo skill request must not contain hidden nodes.';
  }

  if (mode === 'question') {
    if (typeof payload.question !== 'string' || !payload.question.trim()) {
      return 'Question mode requires a non-empty question.';
    }
  }

  return null;
}


function validateCodexReportRequest(payload) {
  if (require('./progressbar-pilot').isProgressBarPilot(payload)) return require('./progressbar-pilot').validatePilotRequest(payload);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Request body must be an object.';
  }
  const report = payload.report;
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return 'Report analysis requires report.';
  }
  if (![
    'apollo-customizations-wip-report',
    'apollo-pattern-audit-report',
    'apollo-text-audit-report',
  ].includes(report.reportKind)) {
    return 'Unsupported Apollo report kind.';
  }
  if (typeof report.reportId !== 'string' || !report.reportId.trim()) {
    return 'Apollo report requires reportId.';
  }
  if (
    report.reportKind === 'apollo-pattern-audit-report' &&
    !Array.isArray(report?.facts?.occurrences)
  ) {
    return 'Apollo pattern report facts.occurrences must be an array.';
  }
  if (
    report.reportKind === 'apollo-text-audit-report' &&
    !Array.isArray(report?.facts?.texts)
  ) {
    return 'Apollo text report facts.texts must be an array.';
  }
  if (
    report.reportKind === 'apollo-text-audit-report' &&
    report.facts.texts.length > 5000
  ) {
    return 'Apollo text report contains too many text nodes.';
  }
  if (report.reportKind === 'apollo-text-audit-report') {
    for (const fact of report.facts.texts) {
      if (!fact?.node || typeof fact.node.id !== 'string') {
        return 'Every Apollo text fact requires node.id.';
      }
      if (fact.node.visible === false) {
        return 'Apollo text report must not contain hidden nodes.';
      }
      if (typeof fact.text !== 'string') {
        return 'Every Apollo text fact requires text.';
      }
      if (!Array.isArray(fact.ancestors)) {
        return 'Every Apollo text fact requires ancestors.';
      }
    }
  }
  if (report.reportKind === 'apollo-text-audit-report') {
    try {
      normalizeApolloPlatform(report?.scan?.channel);
    } catch (error) {
      return error.message;
    }
    return null;
  }
  if (
    report.reportKind === 'apollo-pattern-audit-report' &&
    !Array.isArray(report?.requestedRuleIds)
  ) {
    return 'Apollo pattern report requestedRuleIds must be an array.';
  }
  if (
    report.reportKind === 'apollo-pattern-audit-report' &&
    report.facts.occurrences.length > 5000
  ) {
    return 'Apollo pattern report contains too many occurrences.';
  }
  if (report.reportKind === 'apollo-pattern-audit-report') {
    for (const occurrence of report.facts.occurrences) {
      if (!occurrence?.node || typeof occurrence.node.id !== 'string') {
        return 'Every Apollo pattern occurrence requires node.id.';
      }
      if (occurrence.node.visible === false) {
        return 'Apollo pattern report must not contain hidden nodes.';
      }
      if (!occurrence?.component || typeof occurrence.component.name !== 'string') {
        return 'Every Apollo pattern occurrence requires component.name.';
      }
      if (!Array.isArray(occurrence.ancestors)) {
        return 'Every Apollo pattern occurrence requires ancestors.';
      }
    }
    if (report.evidenceBundle !== undefined) {
      const evidenceBundleError = validateApolloEvidenceBundle(
        report.evidenceBundle
      );
      if (evidenceBundleError) return evidenceBundleError;
    }
  }
  if (!Array.isArray(report?.category?.items)) {
    return 'Apollo report category.items must be an array.';
  }
  if (report.category.items.length > 5000) {
    return 'Apollo report contains too many component items.';
  }
  for (const item of report?.category?.items || []) {
    if (!item?.node || typeof item.node.id !== 'string') {
      return 'Every Apollo report item requires node.id.';
    }
    if (!Array.isArray(item.changes)) {
      return 'Every Apollo report item requires changes.';
    }
    if (item.node.visible === false || item.changes.some((change) => change?.node?.visible === false)) {
      return 'Apollo report must not contain hidden nodes.';
    }
  }
  try {
    normalizeApolloPlatform(report?.scan?.channel);
  } catch (error) {
    return error.message;
  }
  return null;
}


function validateApolloEvidenceBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return 'Apollo evidenceBundle must be an object.';
  }
  if (
    bundle.schemaVersion !== 2 ||
    bundle.documentType !== 'apollo-audit-evidence-bundle'
  ) {
    return 'Apollo evidenceBundle requires schemaVersion 2 and documentType apollo-audit-evidence-bundle.';
  }
  if (!bundle.graph || !Array.isArray(bundle.graph.nodes)) {
    return 'Apollo evidenceBundle graph.nodes must be an array.';
  }
  if (!Array.isArray(bundle.graph.relations)) {
    return 'Apollo evidenceBundle graph.relations must be an array.';
  }
  if (bundle.graph.nodes.length > 10000) {
    return 'Apollo evidenceBundle contains too many graph nodes.';
  }
  if (bundle.graph.relations.length > 50000) {
    return 'Apollo evidenceBundle contains too many graph relations.';
  }
  const nodeIds = new Set();
  for (const node of bundle.graph.nodes) {
    if (!node || typeof node.nodeId !== 'string' || !node.nodeId.trim()) {
      return 'Every Apollo evidenceBundle graph node requires nodeId.';
    }
    if (node.visible !== true) {
      return 'Apollo evidenceBundle must contain visible graph nodes only.';
    }
    if (nodeIds.has(node.nodeId)) {
      return `Apollo evidenceBundle contains duplicate nodeId ${node.nodeId}.`;
    }
    nodeIds.add(node.nodeId);
  }
  if (!Array.isArray(bundle.baselines)) {
    return 'Apollo evidenceBundle baselines must be an array.';
  }
  if (!Array.isArray(bundle.changes)) {
    return 'Apollo evidenceBundle changes must be an array.';
  }
  if (!Array.isArray(bundle.ruleCandidates)) {
    return 'Apollo evidenceBundle ruleCandidates must be an array.';
  }
  if (bundle.changes.length > 10000) {
    return 'Apollo evidenceBundle contains too many changes.';
  }
  return null;
}


function isCodexReportPayload(payload) {
  return isCustomizationReportPayload(payload) ||
    isPatternReportPayload(payload) ||
    isTextReportPayload(payload);
}


function isCustomizationReportPayload(payload) {
  return payload?.report?.reportKind === 'apollo-customizations-wip-report';
}


function isPatternReportPayload(payload) {
  return payload?.report?.reportKind === 'apollo-pattern-audit-report';
}


function isTextReportPayload(payload) {
  return payload?.report?.reportKind === 'apollo-text-audit-report';
}


function getCodexPayloadNodeIds(payload) {
  if (!isCodexReportPayload(payload)) {
    return (payload?.snapshot?.nodes || [])
      .map((node) => (typeof node?.nodeId === 'string' ? node.nodeId : null))
      .filter(Boolean);
  }
  if (isPatternReportPayload(payload)) {
    const nodeIds = new Set((payload.report.facts.occurrences || [])
      .map((occurrence) => (
        typeof occurrence?.node?.id === 'string' ? occurrence.node.id : null
      ))
      .filter(Boolean));
    for (const relation of payload.report.facts.layoutRelations || []) {
      if (typeof relation?.from?.nodeId === 'string') nodeIds.add(relation.from.nodeId);
      if (typeof relation?.to?.nodeId === 'string') nodeIds.add(relation.to.nodeId);
      if (typeof relation?.container?.nodeId === 'string') nodeIds.add(relation.container.nodeId);
    }
    for (const item of payload.report.category.items || []) {
      if (typeof item?.node?.id === 'string') nodeIds.add(item.node.id);
      for (const change of item?.changes || []) {
        if (typeof change?.node?.id === 'string') nodeIds.add(change.node.id);
      }
    }
    for (const node of payload.report.evidenceBundle?.graph?.nodes || []) {
      if (typeof node?.nodeId === 'string') nodeIds.add(node.nodeId);
    }
    for (const change of payload.report.evidenceBundle?.changes || []) {
      if (typeof change?.nodeId === 'string') nodeIds.add(change.nodeId);
    }
    return Array.from(nodeIds);
  }
  if (isTextReportPayload(payload)) {
    return [...new Set((payload.report.facts.texts || [])
      .map((fact) => (
        typeof fact?.node?.id === 'string' ? fact.node.id : null
      ))
      .filter(Boolean))];
  }
  const nodeIds = new Set();
  for (const item of payload.report.category.items || []) {
    if (typeof item?.node?.id === 'string') nodeIds.add(item.node.id);
    for (const change of item?.changes || []) {
      if (typeof change?.node?.id === 'string') nodeIds.add(change.node.id);
    }
  }
  return Array.from(nodeIds);
}


function getCodexPayloadAuditId(payload) {
  return isCodexReportPayload(payload)
    ? payload.report.reportId
    : payload?.snapshot?.runId;
}


function getCodexPayloadCheckedNodes(payload) {
  if (isCodexReportPayload(payload)) {
    const scanned = Number(isTextReportPayload(payload)
      ? payload?.report?.summary?.scannedTextNodes
      : payload?.report?.summary?.scannedComponents);
    return Number.isFinite(scanned) && scanned >= 0
      ? Math.floor(scanned)
      : getCodexPayloadNodeIds(payload).length;
  }
  return Array.isArray(payload?.snapshot?.nodes)
    ? payload.snapshot.nodes.length
    : 0;
}


function normalizeApolloPlatform(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'desktop') return 'desktop';
  if (normalized === 'mobile-web' || normalized === 'mobile web') {
    return 'mobile-web';
  }
  if (normalized === 'mobileweb') return 'mobile-web';
  if (normalized === 'ios') return 'ios';
  if (normalized === 'android') return 'android';
  const err = new Error(`Unsupported Apollo platform: ${value || 'empty'}.`);
  err.status = 400;
  throw err;
}


function normalizeApolloScreenType(payload, snapshot) {
  const candidate =
    payload?.context?.screenType ??
    snapshot?.settings?.screenType ??
    snapshot?.capture?.pageType ??
    null;
  const normalized = typeof candidate === 'string'
    ? candidate.trim().toLowerCase()
    : null;
  const aliases = {
    form: 'form',
    landing: 'landing',
    view: 'view',
    hub: 'hub',
  };
  return aliases[normalized] || null;
}


function inferApolloSelectionScope(payload, snapshot, screenType) {
  const explicitScope = payload?.context?.selectionScope;
  if (['screen', 'fragment', 'component', 'modal'].includes(explicitScope)) {
    return explicitScope;
  }
  const selected = snapshot.selection[0] || {};
  const normalizedName = String(selected.name || '').toLowerCase();
  if (normalizedName.includes('universalmodal') || normalizedName.includes('modal')) {
    return 'modal';
  }
  if (selected.nodeType === 'COMPONENT' || selected.nodeType === 'INSTANCE') {
    return 'component';
  }
  return screenType ? 'screen' : 'fragment';
}


function buildFigmaSelectionUrl(snapshot, rootNodeId) {
  const fileKey = snapshot?.figma?.fileKey;
  if (typeof fileKey !== 'string' || !fileKey) return null;
  const urlNodeId = rootNodeId.replace(/:/g, '-');
  return `https://www.figma.com/design/${encodeURIComponent(fileKey)}?node-id=${encodeURIComponent(urlNodeId)}`;
}

module.exports = {validateCodexRequest, validateCodexReportRequest, validateApolloEvidenceBundle, isCodexReportPayload, isCustomizationReportPayload, isPatternReportPayload, isTextReportPayload, getCodexPayloadNodeIds, getCodexPayloadAuditId, getCodexPayloadCheckedNodes, normalizeApolloPlatform, normalizeApolloScreenType, inferApolloSelectionScope, buildFigmaSelectionUrl};
