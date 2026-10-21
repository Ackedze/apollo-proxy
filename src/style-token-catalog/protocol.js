'use strict';

const crypto = require('node:crypto');
const VERSION = 'apollo.style-token-read.v1';
const HASH = /^[a-f0-9]{64}$/;
const KEY = /^[a-f0-9]{40}$/;
const TARGETS = Object.freeze({
  fills: ['COLOR', 'FILL_COLOR'],
  strokes: ['COLOR', 'STROKE_COLOR'],
  textFills: ['COLOR', 'TEXT_FILL'],
  itemSpacing: ['FLOAT', 'GAP'],
  paddingTop: ['FLOAT', 'GAP'],
  paddingRight: ['FLOAT', 'GAP'],
  paddingBottom: ['FLOAT', 'GAP'],
  paddingLeft: ['FLOAT', 'GAP'],
  width: ['FLOAT', 'WIDTH_HEIGHT'],
  height: ['FLOAT', 'WIDTH_HEIGHT'],
  fontSize: ['FLOAT', 'FONT_SIZE'],
  characters: ['STRING', 'TEXT_CONTENT'],
  visible: ['BOOLEAN', 'ALL_SCOPES'],
  fillStyle: ['PAINT', null],
  strokeStyle: ['PAINT', null],
  textStyle: ['TEXT', null],
  effectStyle: ['EFFECT', null],
});

class ReadApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function fail(code = 'INVALID_QUERY', status = 400) { throw new ReadApiError(status, code); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function canonical(value, depth = 0) {
  if (depth > 24) fail('JSON_TOO_DEEP');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(v => canonical(v, depth + 1)).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k], depth + 1)).join(',') + '}';
  }
  fail('INVALID_JSON_VALUE');
}
function digest(value) { return sha256(canonical(value)); }
function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const allowed = new Set(required.concat(optional));
  if (required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !allowed.has(k))) fail();
}
function string(value, max = 200) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f]/.test(value)) fail();
}
function color(value) {
  exactKeys(value, ['r', 'g', 'b', 'a']);
  for (const channel of Object.values(value)) if (typeof channel !== 'number' || !Number.isFinite(channel) || channel < 0 || channel > 1) fail();
}
// A client fingerprint is a reproducibility/freshness claim, never authority.
function observationFingerprint(query) {
  return digest({ scope: query.scope, consumerModes: query.consumerModes,
    observation: { kind: query.observation.kind, type: query.observation.type,
      unit: query.observation.unit, value: query.observation.value } });
}
function validateQuery(query) {
  if (Buffer.byteLength(canonical(query), 'utf8') > 65536) fail('QUERY_TOO_LARGE', 413);
  exactKeys(query, ['protocolVersion', 'snapshotId', 'contentVersion', 'scope', 'consumerModes', 'observation'], ['limit']);
  if (query.protocolVersion !== VERSION) fail('PROTOCOL_VERSION_MISMATCH', 409);
  if (typeof query.snapshotId !== 'string' || !HASH.test(query.snapshotId)) fail();
  string(query.contentVersion);
  exactKeys(query.scope, ['ds', 'platform', 'theme', 'property', 'sourceIds']);
  string(query.scope.ds); string(query.scope.platform); string(query.scope.property);
  if (query.scope.theme !== null) string(query.scope.theme);
  if (!Object.hasOwn(TARGETS, query.scope.property)) fail('UNSUPPORTED_PROPERTY', 422);
  const ids = query.scope.sourceIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 32 || new Set(ids).size !== ids.length) fail();
  for (const id of ids) string(id, 300);
  if (!Array.isArray(query.consumerModes) || query.consumerModes.length > 128) fail();
  const seenModes = new Set();
  for (const mode of query.consumerModes) {
    exactKeys(mode, ['sourceId', 'collectionKey', 'modeId', 'origin']);
    if (!ids.includes(mode.sourceId) || typeof mode.collectionKey !== 'string' || !KEY.test(mode.collectionKey)) fail();
    string(mode.modeId);
    if (!['explicit', 'inherited', 'default'].includes(mode.origin)) fail();
    const key = canonical([mode.sourceId, mode.collectionKey]);
    if (seenModes.has(key)) fail('DUPLICATE_CONSUMER_MODE');
    seenModes.add(key);
  }
  const observed = query.observation;
  exactKeys(observed, ['kind', 'type', 'unit', 'value', 'fingerprint']);
  if (!['variable', 'style'].includes(observed.kind) || TARGETS[query.scope.property][0] !== observed.type) fail('PROPERTY_TYPE_MISMATCH', 422);
  if (['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'].includes(observed.type) !== (observed.kind === 'variable')) fail();
  if (observed.type === 'COLOR') { if (observed.unit !== 'rgba') fail(); color(observed.value); }
  if (observed.type === 'FLOAT') {
    if (!['px', 'percent', 'unitless', 'unknown'].includes(observed.unit) || typeof observed.value !== 'number' || !Number.isFinite(observed.value)) fail();
  }
  if (observed.type === 'STRING' && (observed.unit !== 'text' || typeof observed.value !== 'string' || observed.value.length > 4096)) fail();
  if (observed.type === 'BOOLEAN' && (observed.unit !== 'boolean' || typeof observed.value !== 'boolean')) fail();
  if (observed.kind === 'style') {
    if (observed.unit !== 'figma-native' || !observed.value || typeof observed.value !== 'object' || query.consumerModes.length) fail();
    // Style raw exports lack a complete native fingerprint; no exact style match is claimed in v1.
    canonical(observed.value);
  }
  if (typeof observed.fingerprint !== 'string' || !HASH.test(observed.fingerprint)) fail();
  if (observed.fingerprint !== observationFingerprint(query)) fail('OBSERVATION_FINGERPRINT_MISMATCH', 409);
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200)) fail();
  return JSON.parse(canonical(query));
}
module.exports = { VERSION, HASH, KEY, TARGETS, ReadApiError, fail, sha256, digest, canonical, exactKeys, color, observationFingerprint, validateQuery };
