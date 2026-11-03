'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readDataIndex, sha } = require('../data-packages/artifacts');
const clone = value => JSON.parse(JSON.stringify(value));
const ownedRoots = ['styles', 'fill', 'stroke', 'layout', 'opacity', 'opacityToken', 'typographyToken', 'radius', 'radiusToken', 'effects', 'componentInstance', 'text', 'visible'];

// Keep the V3 library.ts shallow patch/order semantics, including ownership paths.
function markVariantOwnedProperties(node, source) {
  const paths = [];
  function collect(value, name) {
    if (value == null || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) paths.push(name);
    else for (const key of Object.keys(value).sort()) collect(value[key], name + '.' + key);
  }
  for (const root of ownedRoots) if (Object.hasOwn(source, root)) collect(source[root], root);
  if (paths.length) node.referenceVariantOwnedProperties = [...new Set([...(node.referenceVariantOwnedProperties || []), ...paths])].sort();
}

function buildStructureFromPatches(base, patches) {
  const nodes = clone(base || []), byId = new Map(nodes.map(node => [node.id, node]));
  for (const patch of patches || []) {
    if (patch.op === 'update') {
      const target = byId.get(patch.id);
      if (target) { Object.assign(target, patch.value); markVariantOwnedProperties(target, patch.value); }
    } else if (patch.op === 'remove') {
      byId.delete(patch.id);
      const index = nodes.findIndex(node => node.id === patch.id);
      if (index !== -1) nodes.splice(index, 1);
    } else if (patch.op === 'add') {
      const node = clone(patch.node);
      markVariantOwnedProperties(node, patch.node);
      nodes.push(node);
      if (!byId.has(node.id)) byId.set(node.id, node);
    }
  }
  return nodes;
}

function normalizeVariantStructureRootPath(component, variantKey, nodes) {
  if (!nodes.length) return nodes;
  const name = component.variants?.find(variant => variant.key === variantKey)?.name?.trim() || '';
  if (!name) return nodes;
  const root = nodes.find(node => !node.path.includes(' / ')) || nodes[0], rootPath = root?.path?.trim() || '';
  if (!rootPath || rootPath === name) return nodes;
  for (const node of nodes) {
    if (node.path === rootPath) node.path = name;
    else if (node.path.startsWith(rootPath + ' /')) node.path = name + node.path.slice(rootPath.length);
  }
  return nodes;
}

function resolveStructure(component, variantKey) {
  if (!component) return null;
  if (variantKey && component.variantStructures?.[variantKey]) {
    return normalizeVariantStructureRootPath(component, variantKey,
      buildStructureFromPatches(component.structure || [], component.variantStructures[variantKey]));
  }
  return component.structure?.length ? clone(component.structure) : null;
}

// V3 normalizes both the base and patch values before resolving the tree.
function normalizeStructureFields(target) {
  if (!target || typeof target !== 'object') return;
  function token(paints) {
    for (const paint of Array.isArray(paints) ? paints : []) {
      if (!paint || typeof paint !== 'object') continue;
      const value = paint.tokenKey || paint.token || paint.boundVariables?.color?.id || paint.boundVariables?.color?.variableId
        || paint.boundVariables?.color?.variable?.id || paint.boundVariables?.color?.variable?.key;
      if (value) return String(value);
    }
    return null;
  }
  function color(paints) {
    for (const paint of Array.isArray(paints) ? paints : []) {
      if (!paint || typeof paint !== 'object' || paint.visible === false || paint.type && paint.type !== 'SOLID') continue;
      if (typeof paint.color === 'string') return paint.color;
      if (paint.color && typeof paint.color === 'object') {
        const value = paint.color, scale = Math.max(value.r, value.g, value.b) <= 1 ? 255 : 1;
        const alpha = typeof value.a === 'number' ? Math.round(value.a * 100) / 100 : 1;
        return `rgba(${Math.round(value.r * scale)},${Math.round(value.g * scale)},${Math.round(value.b * scale)},${alpha})`;
      }
    }
    return null;
  }
  const fillToken = target.fillToken ?? token(target.fills), fillColor = color(target.fills);
  if (fillToken || fillColor) {
    target.fill ??= {};
    if (!target.fill.token && fillToken) target.fill.token = fillToken;
    if (!target.fill.color && fillColor) target.fill.color = fillColor;
  }
  const strokeToken = target.strokeToken ?? token(target.strokes), strokeColor = color(target.strokes);
  if (strokeToken || strokeColor || typeof target.strokeWeight === 'number') {
    target.stroke ??= {};
    if (!target.stroke.token && strokeToken) target.stroke.token = strokeToken;
    if (!target.stroke.color && strokeColor) target.stroke.color = strokeColor;
    if (target.stroke.weight == null && typeof target.strokeWeight === 'number') target.stroke.weight = target.strokeWeight;
    if (!target.stroke.align && target.strokeAlign) target.stroke.align = target.strokeAlign;
  }
  const layout = target.layout && typeof target.layout === 'object' ? target.layout : null;
  const horizontal = layout?.sizing?.horizontal ?? target.layoutSizingHorizontal ?? layout?.layoutSizingHorizontal ?? null;
  const vertical = layout?.sizing?.vertical ?? target.layoutSizingVertical ?? layout?.layoutSizingVertical ?? null;
  if (horizontal || vertical) {
    target.layout = layout ?? {}; target.layout.sizing ??= {};
    if (!target.layout.sizing.horizontal && horizontal) target.layout.sizing.horizontal = horizontal;
    if (!target.layout.sizing.vertical && vertical) target.layout.sizing.vertical = vertical;
  }
}

function fail(code, status = 400) { throw Object.assign(Error(code), { code, status }); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function key(value) { return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value); }

function readCatalogReference(body, root) {
  const selection = body?.selection;
  if (!object(selection) || !key(selection.contractId) || !key(selection.componentId) || !key(selection.representationId)
    || !key(selection.componentKey) || !Number.isSafeInteger(selection.revision) || selection.revision < 1
    || selection.variantKey !== undefined && !key(selection.variantKey)
    || ['config', 'modes', 'hostContext'].some(field => selection[field] !== undefined && !object(selection[field]))
    || Object.keys(selection).some(field => !['contractId', 'componentId', 'revision', 'representationId', 'componentKey', 'variantKey', 'config', 'modes', 'hostContext'].includes(field))
    || Object.keys(body).some(field => !['releaseId', 'selection'].includes(field))
    || body.releaseId !== undefined && !/^[a-f0-9]{64}$/.test(body.releaseId)) fail('CATALOG_REQUEST_INVALID');
  if (!root) fail('CATALOG_REFERENCE_NOT_INSTALLED', 503);
  const manifestBytes = fs.readFileSync(path.join(root, 'manifest.json'));
  if (manifestBytes.length > 16 * 1024 * 1024) fail('DATA_INDEX_INVALID', 503);
  const { index, reader } = readDataIndex(root, JSON.parse(manifestBytes));
  reader.read({ file: 'manifest.json', sha256: sha(manifestBytes) });
  if (body.releaseId && body.releaseId !== index.id) fail('CONTRACT_V4_RELEASE_CHANGED', 409);
  const matches = index.contracts.filter(entry => entry.id === selection.contractId && entry.componentId === selection.componentId && entry.revision === selection.revision);
  if (matches.length !== 1) fail('CATALOG_CONTRACT_UNAVAILABLE', 404);
  const entry = matches[0], source = JSON.parse(reader.read({ file: entry.file, sha256: entry.sha256 }));
  const manual = source.manual;
  if (manual?.component?.contractId !== entry.id || manual.component.componentId !== entry.componentId || manual.metadata?.revision !== entry.revision) fail('CATALOG_CONTRACT_MISMATCH', 503);
  const representations = (manual.representations || []).filter(rep => rep.id === selection.representationId && rep.kind === 'figma');
  if (representations.length !== 1) fail('CATALOG_REPRESENTATION_UNAVAILABLE', 404);
  const descriptors = (index.rawCatalogs || []).filter(item => item.contractId === entry.id && item.componentId === entry.componentId
    && item.revision === entry.revision && item.representationIds?.includes(selection.representationId));
  if (descriptors.length !== 1) fail('CATALOG_REFERENCE_UNAVAILABLE', 503);
  const descriptor = descriptors[0], raw = JSON.parse(reader.read(descriptor.catalog));
  if (!Array.isArray(raw.components)) fail('CATALOG_DOCUMENT_INVALID', 503);
  const representation = representations[0], rootKey = representation.locator?.componentSetKey || representation.locator?.componentKey;
  const components = raw.components.filter(component => component.key === rootKey);
  if (!key(rootKey) || components.length !== 1) fail('CATALOG_COMPONENT_UNAVAILABLE', 503);
  const component = components[0], variants = component.variants || [];
  const variantKey = selection.variantKey || (variants.some(variant => variant.key === selection.componentKey) ? selection.componentKey : undefined);
  if (selection.componentKey !== component.key && selection.componentKey !== variantKey) fail('CATALOG_COMPONENT_MISMATCH', 409);
  if (variants.length && !variantKey) fail('CATALOG_VARIANT_REQUIRED', 409);
  const variant = variantKey ? variants.filter(item => item.key === variantKey) : [];
  if (variantKey && variant.length !== 1) fail('CATALOG_VARIANT_UNAVAILABLE', 404);
  if (variantKey && (!Object.hasOwn(component.variantStructures || {}, variantKey) || !Array.isArray(component.variantStructures[variantKey]))) fail('CATALOG_VARIANT_PATCH_UNAVAILABLE', 503);
  if (!Array.isArray(component.structure) || !component.structure.length) fail('CATALOG_STRUCTURE_UNAVAILABLE', 503);
  const selected = { structure: clone(component.structure), variants: variant,
    variantStructures: variantKey ? { [variantKey]: clone(component.variantStructures[variantKey]) } : {} };
  for (const node of selected.structure) normalizeStructureFields(node);
  for (const patch of variantKey ? selected.variantStructures[variantKey] : []) {
    if (patch.op === 'update') normalizeStructureFields(patch.value);
    else if (patch.op === 'add') normalizeStructureFields(patch.node);
  }
  const structure = resolveStructure(selected, variantKey);
  const issues = [];
  const patchIds = new Set(component.structure.map(node => node.id));
  for (const patch of variantKey ? selected.variantStructures[variantKey] : []) {
    if (patch.op === 'add') patchIds.add(patch.node.id);
    else if (patch.op === 'remove' || patch.op === 'update') {
      if (!patchIds.has(patch.id)) issues.push({ code: 'PATCH_TARGET_UNAVAILABLE', nodeId: patch.id });
      if (patch.op === 'remove') patchIds.delete(patch.id);
    } else issues.push({ code: 'PATCH_OPERATION_UNSUPPORTED' });
  }
  const ids = new Set();
  for (const node of structure) {
    if (ids.has(node.id)) issues.push({ code: 'DUPLICATE_NODE_ID', nodeId: node.id });
    ids.add(node.id);
  }
  for (const node of structure) if (node.parentId !== null && node.parentId !== undefined && !ids.has(node.parentId)) issues.push({ code: 'MISSING_PARENT', nodeId: node.id });
  const warnings = (raw.diagnostics?.warnings || []).filter(warning => (!warning.componentKey || warning.componentKey === component.key)
    && (!warning.variantKey || warning.variantKey === variantKey));
  const metadata = clone(component);
  for (const field of ['structure', 'variantStructures', 'variants']) delete metadata[field];
  const result = {
    success: true, schemaVersion: 'apollo.catalog-reference.v1', releaseId: index.id,
    componentId: entry.componentId, revision: entry.revision,
    contract: { id: entry.id, componentId: entry.componentId, revision: entry.revision, manualSourceHash: entry.manualSourceHash || null },
    runtime: { profileVersion: index.profileVersion || null },
    selection: clone(selection), component: metadata,
    variant: variant[0] ? clone(variant[0]) : null, structure,
    dependencies: clone(manual.componentDependencies || []),
    provenance: { assembler: 'apollo-v3.resolveStructure', catalog: clone(descriptor.catalog), contract: { file: entry.file, sha256: entry.sha256 }, source: clone(raw.source || {}) },
    completeness: { structure: issues.length ? 'incomplete' : 'assembled', facts: 'partial', nativeCorrespondence: 'unproven',
      config: selection.config === undefined ? 'not-requested' : 'unresolved', modes: selection.modes === undefined ? 'not-requested' : 'unresolved',
      hostContext: selection.hostContext === undefined ? 'not-requested' : 'unresolved', configuredReference: false, issues },
    diagnostics: warnings,
  };
  result.referenceHash = sha(Buffer.from(JSON.stringify(result)));
  reader.assertCurrent();
  return result;
}

module.exports = { buildStructureFromPatches, resolveStructure, readCatalogReference };
