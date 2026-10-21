'use strict';

const { VERSION, KEY, TARGETS, fail, digest, canonical, validateQuery } = require('./protocol');

function tokenValue(record, modeId, localIds) {
  const raw = record.valuesByMode[modeId];
  const aliases = [];
  const reported = record.resolutionByMode[modeId] || null;
  const isAlias = raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS';
  const declaredIds = [...new Set([...(isAlias && typeof raw.id === 'string' ? [raw.id] : []), ...(Array.isArray(reported?.aliasIds) ? reported.aliasIds.filter(id=>typeof id==='string') : [])])];
  for (const aliasId of declaredIds.slice(0,128)) {
    const local = localIds.get(aliasId) || [];
    aliases.push({ exportedAliasId: aliasId,
      sameSourceTargets: local.filter(v => KEY.test(v.key)).map(v => ({ key: v.key, collectionKey: v.collectionKey })),
      targetModeMapping: 'unknown' });
  }
  let values;
  if (isAlias) values = record.actualValuesByMode[modeId];
  else values = raw === undefined ? record.actualValuesByMode[modeId] : [raw];
  const reasons = [];
  if (raw === undefined) reasons.push('DIRECT_VALUE_UNPROVEN');
  if (!Array.isArray(values) || values.length !== 1) reasons.push('VALUE_UNRESOLVED_OR_MULTIPLE');
  const value = Array.isArray(values) && values.length === 1 ? values[0] : null;
  if (isAlias || declaredIds.length) reasons.push('ALIAS_DEPENDENCY_UNPROVEN');
  if (reported && reported.status !== 'resolved') reasons.push('EXPORT_RESOLUTION_UNCONFIRMED');
  if (reported?.unresolvedAliasIds?.length) reasons.push('ALIAS_DEPENDENCY_UNPROVEN');
  if (value !== null) {
    const validColor = value && typeof value === 'object' && ['r','g','b','a'].every(k => typeof value[k] === 'number' && Number.isFinite(value[k]) && value[k] >= 0 && value[k] <= 1) && Object.keys(value).length === 4;
    if ((record.type === 'COLOR' && !validColor) || (record.type === 'FLOAT' && (typeof value !== 'number' || !Number.isFinite(value))) || (record.type === 'STRING' && typeof value !== 'string') || (record.type === 'BOOLEAN' && typeof value !== 'boolean')) reasons.push('INVALID_EXPORTED_VALUE');
  }
  const unit = { COLOR: 'rgba', FLOAT: 'unknown', STRING: 'text', BOOLEAN: 'boolean' }[record.type] || 'unknown';
  return { value, unit, reasons: [...new Set(reasons)], alias: { status: isAlias || declaredIds.length ? 'export-value-only' : 'none',
    references: aliases, exportedResolution: reported, dependencyExpansion: 'disabled' } };
}
function createQueryService(snapshot, maxCacheEntries = 64) {
  if (!Number.isInteger(maxCacheEntries) || maxCacheEntries < 1 || maxCacheEntries > 256) fail('INVALID_CACHE_BOUND',500);
  const cache = new Map();
  function query(input) {
    const request = validateQuery(input);
    if (request.snapshotId !== snapshot.snapshotId || request.contentVersion !== snapshot.contentVersion) fail('SNAPSHOT_VERSION_MISMATCH', 409);
    snapshot.assertFresh();
    const cacheKey = digest({ protocolVersion: VERSION, snapshotId: snapshot.snapshotId, manifestSha256: snapshot.manifestSha256, request });
    if (cache.has(cacheKey)) return JSON.parse(cache.get(cacheKey));
    const gaps = [];
    const gap = (code, sourceId = null, collectionKey = null) => {
      const item = { code, sourceId, collectionKey };
      if (!gaps.some(g => canonical(g) === canonical(item))) gaps.push(item);
    };
    const excluded = [];
    const occurrences = [];
    const definitions = new Map();
    const usedModes = new Set();
    const selectedModes = new Map(request.consumerModes.map(m => [canonical([m.sourceId, m.collectionKey]), m]));
    const sourceIds = [...request.scope.sourceIds].sort();
    for (const sourceId of sourceIds) {
      const source = snapshot.sources.get(sourceId);
      if (!source) { gap('SOURCE_UNKNOWN', sourceId); continue; }
      if (source.status === 'deprecated') { excluded.push({ sourceId, reason: 'DEPRECATED_SOURCE', evidence: source.statusEvidence }); continue; }
      if (source.availability !== 'available') { gap('SOURCE_NOT_PACKAGED', sourceId); continue; }
      if (source.context && (source.context.ds !== request.scope.ds || source.context.platform !== request.scope.platform || !source.context.themes.includes(request.scope.theme))) {
        excluded.push({ sourceId, reason: 'FOREIGN_SCOPE', evidence: source.contextEvidence }); continue;
      }
      const scopeUnproven = source.context === null;
      if (scopeUnproven) gap('SOURCE_SCOPE_UNPROVEN', sourceId);
      if (request.observation.kind === 'style') { gap('STYLE_NATIVE_FINGERPRINT_UNSUPPORTED', sourceId); continue; }
      if (source.kind !== 'tokens') { gap('SOURCE_KIND_MISMATCH', sourceId); continue; }
      const data = snapshot.tokenData.get(sourceId);
      for (const record of data.records) {
        if (record.hidden || !KEY.test(record.key)) continue;
        if (!definitions.has(record.key)) definitions.set(record.key, new Set());
        definitions.get(record.key).add(canonical({ type:record.type, collectionKey:record.collectionKey }));
      }
      for (const record of data.records) {
        if (record.hidden || !KEY.test(record.key) || !KEY.test(record.collectionKey)) continue;
        const mode = selectedModes.get(canonical([sourceId, record.collectionKey]));
        if (!mode) { gap('CONSUMER_MODE_UNOBSERVED', sourceId, record.collectionKey); continue; }
        usedModes.add(canonical([sourceId, record.collectionKey]));
        if (!record.modes.some(m => m.modeId === mode.modeId)) { gap('CONSUMER_MODE_UNKNOWN', sourceId, record.collectionKey); continue; }
        if (record.type !== request.observation.type) continue;
        const fieldScope = TARGETS[request.scope.property][1];
        if (!record.scopes.includes('ALL_SCOPES') && !record.scopes.includes(fieldScope)) continue;
        const resolved = tokenValue(record, mode.modeId, data.ids);
        if (resolved.reasons.includes('VALUE_UNRESOLVED_OR_MULTIPLE') || resolved.reasons.includes('INVALID_EXPORTED_VALUE')) { gap('EXPORTED_VALUE_UNKNOWN', sourceId, record.collectionKey); continue; }
        const reasons = resolved.reasons.slice();
        if (scopeUnproven) reasons.push('SOURCE_SCOPE_UNPROVEN');
        if (resolved.unit === 'unknown' || request.observation.unit === 'unknown') reasons.push('UNIT_UNPROVEN');
        occurrences.push({ key: record.key, name: record.name, type: record.type,
          value: resolved.value, unit: resolved.unit, sourceId, sourceSha256: source.sha256,
          provenance: source.provenance, collectionKey: record.collectionKey,
          collectionName: record.collectionName, defaultModeId: record.defaultModeId,
          effectiveMode: { modeId: mode.modeId, origin: mode.origin, evidence: 'client-observation-only' },
          declaredScopes: record.scopes, alias: resolved.alias, reasons,
          equalValue: canonical(resolved.value) === canonical(request.observation.value) });
      }
    }
    for (const mode of request.consumerModes) if (!usedModes.has(canonical([mode.sourceId,mode.collectionKey]))) gap('CONSUMER_COLLECTION_UNKNOWN',mode.sourceId,mode.collectionKey);
    // Group published identity before filtering equal values, preserving conflicts in duplicate exports.
    const byKey = new Map();
    for (const occurrence of occurrences) {
      if (!byKey.has(occurrence.key)) byKey.set(occurrence.key, []);
      byKey.get(occurrence.key).push(occurrence);
    }
    const candidates = [];
    for (const [key, records] of byKey) {
      if (!records.some(r => r.equalValue)) continue;
      const reasons = new Set(records.flatMap(r => r.reasons));
      const signatures = new Set(records.map(r => canonical({ type:r.type, unit:r.unit, value:r.value, collectionKey:r.collectionKey })));
      if (signatures.size > 1 || definitions.get(key)?.size > 1) reasons.add('DUPLICATE_IDENTITY_CONFLICT');
      const valueMatch = reasons.has('UNIT_UNPROVEN') || reasons.has('DUPLICATE_IDENTITY_CONFLICT') ? 'unknown' : 'exact-export';
      const candidate = { identity: { kind: 'variable', publishedKey: key },
        names: [...new Set(records.map(r => r.name))], type: records[0].type,
        value: signatures.size === 1 ? records[0].value : null, unit: records[0].unit,
        valueMatch, evidence: records, duplicateOccurrences: records.length,
        eligibility: { status: 'unknown', reasons: [...reasons, 'SEMANTIC_APPLICABILITY_UNPROVEN', 'NATIVE_PUBLICATION_AND_CONSUMER_RESOLUTION_REQUIRED'],
          bindingPermission: false, semanticEvidence: [], publication: 'unverified' } };
      candidate.candidateId = digest({ snapshotId:snapshot.snapshotId, requestHash:cacheKey, candidate });
      candidates.push(candidate);
    }
    candidates.sort((a,b) => a.candidateId.localeCompare(b.candidateId));
    const total = candidates.length;
    const limit = request.limit || 50;
    if (total > limit) gap('RESULT_TRUNCATED');
    const matchStatus = total > 1 ? 'ambiguous' : total === 1 ? (candidates[0].valueMatch === 'unknown' ? 'unknown' : 'unique') : gaps.length ? 'unknown' : 'no-match';
    const response = { protocolVersion: VERSION, snapshotId: snapshot.snapshotId,
      contentVersion: snapshot.contentVersion, sourceCommits: snapshot.knowledge.sourceCommits,
      requestHash:cacheKey, observedFingerprint:request.observation.fingerprint, scope:request.scope,
      consumerModes:request.consumerModes, sourcePins:sourceIds.map(id => { const s=snapshot.sources.get(id); return {sourceId:id, sha256:s?.sha256 || null, availability:s?.availability || 'unknown'}; }),
      assessment: { matchStatus, coverage: gaps.length ? 'unknown' : 'exported-scope-only',
        verdict:'suggestions-only', totalCandidates:total, returnedCandidates:Math.min(total,limit),
        bindingPermission:false, gaps, excluded },
      candidates:candidates.slice(0,limit) };
    response.responseHash = digest(response);
    const json = canonical(response);
    cache.set(cacheKey, json);
    while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
    return JSON.parse(json);
  }
  return { query, cacheSize: () => cache.size };
}
module.exports = { tokenValue, createQueryService };
