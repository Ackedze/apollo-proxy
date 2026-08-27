const crypto = require('node:crypto');

const TRACE_SCHEMA_VERSION = 'apollo.source-rule-compatibility.v1';

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function normalizeFactFamily(factPath) {
  if (typeof factPath !== 'string' || !factPath) return null;
  if (factPath.startsWith('component.properties.')) return 'component.properties.*';
  if (factPath.startsWith('variant.')) return 'variant.*';
  if (factPath.startsWith('bindings.')) return 'bindings.*';
  if (factPath.startsWith('baseline.effective.')) return 'baseline.effective.*';
  if (factPath.startsWith('appearance.')) return 'appearance.*';
  if (factPath.startsWith('layout.')) return 'layout.*';
  if (factPath.startsWith('geometry.')) return 'geometry.*';
  return factPath;
}

function collectFactFamilies(value, result = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectFactFamilies(entry, result);
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'fact') {
      const family = normalizeFactFamily(entry);
      if (family) result.add(family);
    } else {
      collectFactFamilies(entry, result);
    }
  }
  return result;
}

function uniformCollectionProfile(definition) {
  const propertyPathFamilies = Array.from(new Set(
    (definition.propertyFacts || []).map(normalizeFactFamily).filter(Boolean),
  )).sort((left, right) => left.localeCompare(right));
  return {
    selectedContourId: 'uniform-collection-properties',
    collectionBoundary: {
      from: 'subject',
      traversal: 'parameterized-bounded-collection',
    },
    memberSelector: {
      nodeType: 'INSTANCE',
      identityFact: 'component.identity',
      additionalFilters: 'parameterized',
    },
    propertyPathFamilies,
    predicateSemantics: [
      'count-between',
      'all-equal-per-property',
    ],
  };
}

function genericContourProfile(definition) {
  return {
    selectedContourId: definition.kind,
    collectionBoundary: {
      from: definition.query?.from || definition.from || definition.select?.from || null,
      traversal: definition.query?.traverse
        || definition.traverse
        || definition.select?.traverse
        || null,
    },
    memberSelector: {
      factFamilies: Array.from(collectFactFamilies(
        definition.query?.where || definition.memberWhere || definition.select?.where || [],
      )).sort((left, right) => left.localeCompare(right)),
    },
    propertyPathFamilies: Array.from(collectFactFamilies({
      actual: definition.actual,
      pairs: definition.pairs,
      paths: definition.paths,
      propertyFacts: definition.propertyFacts,
      queryProject: definition.query?.project,
    })).sort((left, right) => left.localeCompare(right)),
    predicateSemantics: [definition.kind],
  };
}

function compatibilityProfile(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('source rule definition must be an object');
  }
  if (typeof definition.ruleId !== 'string' || !definition.ruleId) {
    throw new TypeError('source rule definition requires ruleId');
  }
  if (typeof definition.kind !== 'string' || !definition.kind) {
    throw new TypeError(`source rule ${definition.ruleId} requires a contour kind`);
  }
  return definition.kind === 'uniform-collection-properties'
    ? uniformCollectionProfile(definition)
    : genericContourProfile(definition);
}

function configuredTrace(definition) {
  if (definition.kind !== 'uniform-collection-properties') {
    return {
      identity: definition.identity || null,
      factFamilies: Array.from(collectFactFamilies(definition))
        .sort((left, right) => left.localeCompare(right)),
    };
  }
  return {
    identity: definition.identity || null,
    memberIdentity: definition.memberIdentity || null,
    from: definition.from || 'subject',
    traverse: definition.traverse || 'descendants',
    memberNames: Array.isArray(definition.memberNames)
      ? definition.memberNames.slice()
      : null,
    memberWhere: Array.isArray(definition.memberWhere)
      ? stableValue(definition.memberWhere)
      : [],
    propertyFacts: Array.isArray(definition.propertyFacts)
      ? definition.propertyFacts.slice()
      : [],
    minimumCount: definition.minimumCount === undefined ? 1 : definition.minimumCount,
    maximumCount: definition.maximumCount === undefined ? null : definition.maximumCount,
  };
}

function uniqueDefinitions(definitions) {
  const byRuleId = new Map();
  for (const definition of definitions || []) {
    if (!definition || typeof definition.ruleId !== 'string' || !definition.ruleId) continue;
    if (!byRuleId.has(definition.ruleId)) byRuleId.set(definition.ruleId, definition);
  }
  return Array.from(byRuleId.values())
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId));
}

function balanceSourceRules(definitions, catalogDefinitions = definitions) {
  const requested = uniqueDefinitions(definitions);
  const catalog = uniqueDefinitions(catalogDefinitions);
  const catalogProfiles = catalog.map((definition) => {
    const profile = compatibilityProfile(definition);
    return {
      definition,
      profile,
      signature: stableHash(profile),
    };
  });
  const traces = requested.map((definition) => {
    const profile = compatibilityProfile(definition);
    const signature = stableHash(profile);
    const matchedPrecedentRuleIds = catalogProfiles
      .filter((entry) => (
        entry.definition.ruleId !== definition.ruleId && entry.signature === signature
      ))
      .map((entry) => entry.definition.ruleId)
      .sort((left, right) => left.localeCompare(right));
    return {
      schemaVersion: TRACE_SCHEMA_VERSION,
      ruleId: definition.ruleId,
      selectedContourId: profile.selectedContourId,
      compatibilitySignature: signature,
      decision: matchedPrecedentRuleIds.length ? 'reuse' : 'registered-contour',
      matchedPrecedentRuleIds,
      profile,
      configured: configuredTrace(definition),
    };
  });
  return {
    definitions: requested,
    traces,
  };
}

module.exports = {
  TRACE_SCHEMA_VERSION,
  balanceSourceRules,
  compatibilityProfile,
  normalizeFactFamily,
};
