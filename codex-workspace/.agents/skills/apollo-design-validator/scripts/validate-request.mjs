#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const SUPPORTED_PLATFORMS = new Set([
  'desktop',
  'mobile-web',
  'ios',
  'android',
]);
const SUPPORTED_SCREEN_TYPES = new Set([
  null,
  'form',
  'landing',
  'view',
  'hub',
]);
const SUPPORTED_SCOPES = new Set([
  'screen',
  'fragment',
  'component',
  'modal',
]);

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

function validateCustomizationReportRequest(request) {
  if (request.mode !== 'customization-report') {
    fail('customization report mode must be customization-report');
  }
  nonEmptyString(request.auditId, 'auditId');
  const context = object(request.context, 'context');
  if (!SUPPORTED_PLATFORMS.has(context.platform)) {
    fail(`unsupported platform: ${String(context.platform)}`);
  }
  const report = object(request.report, 'report');
  if (report.reportKind !== 'apollo-customizations-wip-report') {
    fail('reportKind must be apollo-customizations-wip-report');
  }
  if (report.reportId !== request.auditId) {
    fail('report.reportId must match auditId');
  }
  const category = object(report.category, 'report.category');
  if (!Array.isArray(category.items)) {
    fail('report.category.items must be an array');
  }
  const nodeIds = new Set();
  let changeCount = 0;
  for (const [itemIndex, item] of category.items.entries()) {
    object(item, `report.category.items[${itemIndex}]`);
    const node = object(item.node, `report.category.items[${itemIndex}].node`);
    nonEmptyString(node.id, `report.category.items[${itemIndex}].node.id`);
    if (node.visible === false) fail('hidden report item is out of scope');
    nodeIds.add(node.id);
    if (!Array.isArray(item.changes)) {
      fail(`report.category.items[${itemIndex}].changes must be an array`);
    }
    for (const [changeIndex, change] of item.changes.entries()) {
      object(change, `report.category.items[${itemIndex}].changes[${changeIndex}]`);
      const changedNode = object(
        change.node,
        `report.category.items[${itemIndex}].changes[${changeIndex}].node`,
      );
      nonEmptyString(changedNode.id, 'changed node id');
      nonEmptyString(change.property, 'change property');
      if (changedNode.visible === false) fail('hidden changed node is out of scope');
      nodeIds.add(changedNode.id);
      changeCount += 1;
    }
  }
  return {
    auditId: request.auditId,
    checkedNodes: nodeIds.size,
    platform: context.platform,
    screenType: null,
    changeCount,
  };
}

function validate(request) {
  object(request, 'request');
  if (request.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (request.documentType === 'apollo-customization-audit-request') {
    return validateCustomizationReportRequest(request);
  }
  if (request.documentType !== 'apollo-design-audit-request') {
    fail('unsupported documentType');
  }
  if (request.mode !== 'validation' && request.mode !== 'question') {
    fail('mode must be validation or question');
  }
  nonEmptyString(request.auditId, 'auditId');

  const context = object(request.context, 'context');
  if (!SUPPORTED_PLATFORMS.has(context.platform)) {
    fail(`unsupported platform: ${String(context.platform)}`);
  }
  if (!SUPPORTED_SCREEN_TYPES.has(context.screenType)) {
    fail(`unsupported screenType: ${String(context.screenType)}`);
  }
  if (!SUPPORTED_SCOPES.has(context.selectionScope)) {
    fail(`unsupported selectionScope: ${String(context.selectionScope)}`);
  }
  if (
    !Number.isInteger(context.clarificationRound) ||
    context.clarificationRound < 0 ||
    context.clarificationRound > 2
  ) {
    fail('clarificationRound must be an integer from 0 to 2');
  }

  const figma = object(context.figma, 'context.figma');
  nonEmptyString(figma.pageId, 'context.figma.pageId');
  nonEmptyString(figma.rootNodeId, 'context.figma.rootNodeId');

  const snapshot = object(request.snapshot, 'snapshot');
  if (!Array.isArray(snapshot.selection) || snapshot.selection.length !== 1) {
    fail('snapshot.selection must contain exactly one root');
  }
  if (snapshot.selection[0]?.nodeId !== figma.rootNodeId) {
    fail('selected root nodeId must match context.figma.rootNodeId');
  }
  if (!Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) {
    fail('snapshot.nodes must contain visible nodes');
  }
  const nodeIds = new Set();
  for (const [index, node] of snapshot.nodes.entries()) {
    object(node, `snapshot.nodes[${index}]`);
    nonEmptyString(node.nodeId, `snapshot.nodes[${index}].nodeId`);
    if (node.visible !== true) {
      fail(`snapshot.nodes[${index}] is hidden; hidden nodes are out of scope`);
    }
    if (nodeIds.has(node.nodeId)) {
      fail(`duplicate snapshot nodeId: ${node.nodeId}`);
    }
    nodeIds.add(node.nodeId);
  }
  if (!nodeIds.has(figma.rootNodeId)) {
    fail('snapshot.nodes must contain the selected root node');
  }
  if (!Array.isArray(snapshot.screenshots) || snapshot.screenshots.length !== 1) {
    fail('snapshot.screenshots must contain exactly one PNG');
  }
  const screenshot = object(snapshot.screenshots[0], 'snapshot.screenshots[0]');
  if (screenshot.nodeId !== figma.rootNodeId) {
    fail('screenshot nodeId must match the selected root nodeId');
  }
  if (screenshot.mimeType !== 'image/png') {
    fail('screenshot mimeType must be image/png');
  }

  if (request.mode === 'validation' && request.question !== null) {
    fail('validation mode requires question=null');
  }
  if (request.mode === 'question') {
    nonEmptyString(request.question, 'question');
  }
  if (!Array.isArray(request.dialogue)) fail('dialogue must be an array');

  return {
    auditId: request.auditId,
    checkedNodes: snapshot.nodes.length,
    platform: context.platform,
    screenType: context.screenType,
  };
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: validate-request.mjs <request.json>');
  process.exit(2);
}

try {
  const request = JSON.parse(await readFile(inputPath, 'utf8'));
  const result = validate(request);
  console.log(JSON.stringify({ valid: true, ...result }));
} catch (error) {
  console.error(`Invalid Apollo audit request: ${error.message}`);
  process.exit(1);
}
