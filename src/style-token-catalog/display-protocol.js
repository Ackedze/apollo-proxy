'use strict';
const { canonical, digest } = require('./protocol');
const VERSION = 'apollo.catalog-display-name.v1-private';
const HASH = /^[a-f0-9]{64}$/;
const KEY = /^[a-f0-9]{40}$/i;
const PERMISSIONS = Object.freeze({ bindingPermission: false, nativeImportPermission: false,
  mutationPermission: false, variantChangePermission: false, sourceWideAdmission: false, enabledPilotChosen: false });
class DisplayError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
function fail(code = 'INVALID_DISPLAY_QUERY', status = 400) { throw new DisplayError(code, status); }
function plain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
function closed(v, required, optional = []) {
  if (!plain(v) || required.some(k => !Object.hasOwn(v,k)) || Object.keys(v).some(k => !required.includes(k) && !optional.includes(k))) fail();
}
function scalar(v, max = 300) { return typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v); }
function hash(v) { return typeof v === 'string' && HASH.test(v); }
function stableKey(v) { return typeof v === 'string' && KEY.test(v); }
function identity(kind, reference) {
  if (!['variable','style'].includes(kind) || !scalar(reference,300)) return { key:null, reason:'INVALID_IDENTITY' };
  if (stableKey(reference)) return { key:reference.toLowerCase(), form:'stable-key', reason:null };
  const pattern = kind === 'variable' ? /^VariableID:([a-f0-9]{40})(?:\/[^\s]+)?$/i
    : /^(?:S:([a-f0-9]{40})(?:,[^\s]+)?|key:([a-f0-9]{40}))$/i;
  const match=pattern.exec(reference);
  if(match) return { key:(match[1] || match[2]).toLowerCase(), form:'encoded-stable-key', reason:null };
  if(kind === 'style' && reference.startsWith('VariableID:') || kind === 'variable' && /^(S:|key:)/.test(reference)) return {key:null,reason:'RESOURCE_KIND_MISMATCH'};
  if (/^(VariableID:|S:|local:)/.test(reference)) return {key:null,reason:'LOCAL_ID_NOT_STABLE'};
  return {key:null,reason:'STABLE_IDENTITY_UNAVAILABLE'};
}
function validateRequest(value) {
  let bytes; try { bytes=Buffer.byteLength(canonical(value)); } catch { fail(); }
  if(bytes>65536)fail('DISPLAY_QUERY_TOO_LARGE',413);
  closed(value,['protocolVersion','indexId','contentVersion','resources'],['includeProposedStyleLabels']);
  if(typeof value.protocolVersion !== 'string')fail();
  if(value.protocolVersion !== VERSION)fail('DISPLAY_PROTOCOL_MISMATCH',409);
  if(!hash(value.indexId) || !scalar(value.contentVersion,200))fail();
  if(!Array.isArray(value.resources) || !value.resources.length || value.resources.length>256)fail();
  if(Object.hasOwn(value,'includeProposedStyleLabels') && typeof value.includeProposedStyleLabels !== 'boolean')fail();
  for(const item of value.resources){
    closed(item,['kind','reference'],['sourceIds']);
    if(typeof item.kind !== 'string' || !['variable','style'].includes(item.kind) || !scalar(item.reference,300))fail();
    if(Object.hasOwn(item,'sourceIds')){
      if(!Array.isArray(item.sourceIds) || !item.sourceIds.length || item.sourceIds.length>32 || item.sourceIds.some(x=>!scalar(x,300)) || new Set(item.sourceIds).size!==item.sourceIds.length)fail();
    }
  }
  return JSON.parse(canonical(value));
}
module.exports={VERSION,PERMISSIONS,DisplayError,fail,plain,closed,scalar,hash,stableKey,identity,validateRequest,canonical,digest};
