const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  normalizeGenerationRequest,
  validateSemanticGenerationResponse,
} = require('./semantic-planner');
const { runGenerationPreflight } = require('./preflight');

const PLAN_SCHEMA_VERSION = 'apollo.generation-plan.v5';
const MAX_COMPONENTS = 48;
const catalogCache = new Map();
const tokenCatalogCache = new Map();

const FILL_ROLE_TOKENS = {
  base: 'base-bg/primary',
  'base-alt': 'base-bg-alt/primary',
  modal: 'modal-bg/primary',
  'modal-alt': 'modal-bg-alt/primary',
};

function createGenerationError(message, code, status = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[\[\](){}]/g, ' ')
    .replace(/[🔩🔄🔒💊🚧]/gu, ' ')
    .replace(/[_:/\\|.,;!?—–-]+/g, ' ')
    .replace(/\b(?:d|m|desktop|mobile|web|corporate|corp|ao)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function listFilesRecursively(directory, fileName, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      listFilesRecursively(absolutePath, fileName, result);
    } else if (entry.isFile() && entry.name === fileName) {
      result.push(absolutePath);
    }
  }
  return result;
}

function resolveCatalogRoot(designSystemRoot) {
  const candidates = [
    path.join(designSystemRoot, 'JSONS', 'web', 'components'),
    path.join(designSystemRoot, 'web', 'components'),
  ];
  const root = candidates.find((candidate) => {
    const stat = fs.statSync(candidate, { throwIfNoEntry: false });
    return stat?.isDirectory();
  });
  if (!root) {
    throw createGenerationError(
      'Каталог компонентов design-system_ab недоступен.',
      'GENERATION_TECHNICAL_KNOWLEDGE_MISSING',
      503,
      { candidates },
    );
  }
  return root;
}

function loadGenerationCatalog(designSystemRoot) {
  const catalogRoot = resolveCatalogRoot(designSystemRoot);
  const rootStat = fs.statSync(catalogRoot);
  const cached = catalogCache.get(catalogRoot);
  if (cached && cached.mtimeMs === rootStat.mtimeMs) return cached.value;

  const contracts = [];
  for (const contractPath of listFilesRecursively(catalogRoot, 'contract.generated.json')) {
    let document;
    try {
      document = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    } catch (_error) {
      continue;
    }
    if (!Array.isArray(document?.contracts)) continue;
    const relativePath = path.relative(designSystemRoot, contractPath);
    const semanticTargetPath = path.join(path.dirname(contractPath), 'semantic-targets.json');
    let semanticTargetDocument = null;
    try {
      semanticTargetDocument = JSON.parse(fs.readFileSync(semanticTargetPath, 'utf8'));
    } catch (_error) {
      semanticTargetDocument = null;
    }
    for (const contract of document.contracts) {
      const importKey =
        typeof contract?.figma?.defaultVariantKey === 'string' &&
        contract.figma.defaultVariantKey
          ? contract.figma.defaultVariantKey
          : contract?.componentKey;
      if (
        contract?.status !== 'active' ||
        typeof contract?.name !== 'string' ||
        typeof importKey !== 'string' ||
        !/^[a-f0-9]{40}$/i.test(importKey)
      ) {
        continue;
      }
      const aliases = new Set([
        contract.name,
        contract.normalizedName,
        contract.id,
        path.basename(path.dirname(contractPath)),
      ].map(normalizeSearchText).filter(Boolean));
      const semanticProfiles = Array.isArray(semanticTargetDocument?.profiles)
        ? semanticTargetDocument.profiles.filter((profile) =>
          profile?.contractId === contract.id &&
          profile?.publicRoot === contract.name &&
          profile?.platform === contract.platform
        )
        : [];
      const defaultVariant = Array.isArray(contract?.figma?.variants?.variantKeys)
        ? contract.figma.variants.variantKeys.find((variant) => variant?.key === importKey)
        : null;
      contracts.push({
        id: String(contract.id || importKey),
        name: contract.name,
        normalizedName: normalizeSearchText(contract.name),
        componentKey: String(contract.componentKey || importKey),
        importKey,
        platform: contract.platform || 'universal',
        role: contract.role || 'main',
        aliases: Array.from(aliases),
        knowledgePath: relativePath,
        packageName: path.basename(path.dirname(contractPath)),
        variants: contract?.figma?.variants?.properties || {},
        defaultVariantProperties: defaultVariant?.properties || {},
        anatomy: Array.isArray(contract?.figma?.anatomy) ? contract.figma.anatomy : [],
        presentation: Array.isArray(contract?.figma?.anatomy) &&
          contract.figma.anatomy.some((entry) => /Modal(?:Header|Body|Footer)/i.test(String(entry?.path || '')))
          ? 'modal'
          : 'inline',
        semanticProfiles,
        semanticTargetPath: semanticProfiles.length
          ? path.relative(designSystemRoot, semanticTargetPath)
          : null,
      });
    }
  }
  if (!contracts.length) {
    throw createGenerationError(
      'В design-system_ab не найдены активные компоненты для генерации.',
      'GENERATION_CATALOG_EMPTY',
      503,
    );
  }
  const value = { catalogRoot, contracts };
  catalogCache.set(catalogRoot, { mtimeMs: rootStat.mtimeMs, value });
  return value;
}

function resolveTokenRoot(designSystemRoot) {
  const candidates = [
    path.join(designSystemRoot, 'tokens'),
    path.join(designSystemRoot, 'JSONS', 'tokens'),
  ];
  return candidates.find((candidate) =>
    fs.statSync(candidate, { throwIfNoEntry: false })?.isDirectory()
  ) || null;
}

function loadTokenCatalog(designSystemRoot) {
  const tokenRoot = resolveTokenRoot(designSystemRoot);
  if (!tokenRoot) return { tokenRoot: null, variables: [] };
  const rootStat = fs.statSync(tokenRoot);
  const cached = tokenCatalogCache.get(tokenRoot);
  if (cached && cached.mtimeMs === rootStat.mtimeMs) return cached.value;
  const variables = [];
  for (const entry of fs.readdirSync(tokenRoot, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name) !== '.json') continue;
    const absolutePath = path.join(tokenRoot, entry.name);
    let document;
    try {
      document = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    } catch (_error) {
      continue;
    }
    for (const collection of Array.isArray(document?.collections) ? document.collections : []) {
      for (const variable of Array.isArray(collection?.variables) ? collection.variables : []) {
        if (
          variable?.resolvedType !== 'COLOR' ||
          typeof variable?.name !== 'string' ||
          typeof variable?.key !== 'string' ||
          !/^[a-f0-9]{40}$/i.test(variable.key)
        ) {
          continue;
        }
        variables.push({
          name: variable.name,
          normalizedName: normalizeSearchText(variable.name),
          key: variable.key,
          knowledgePath: path.relative(designSystemRoot, absolutePath),
        });
      }
    }
  }
  const value = { tokenRoot, variables };
  tokenCatalogCache.set(tokenRoot, { mtimeMs: rootStat.mtimeMs, value });
  return value;
}

function scoreContract(contract, query, platform) {
  let score = 0;
  const normalizedQuery = normalizeSearchText(query);
  if (contract.platform === platform) score += 60;
  else if (contract.platform === 'universal') score += 30;
  else score -= 80;
  if (contract.role === 'main') score += 8;
  if (/corporate|corp|promo/i.test(contract.name)) score += 4;
  if (/🔩/.test(contract.name)) score -= 20;
  if (contract.normalizedName === normalizedQuery) score += 140;
  if (contract.aliases.includes(normalizedQuery)) score += 120;
  if (contract.normalizedName.includes(normalizedQuery)) score += 45;
  if (normalizedQuery.includes(contract.normalizedName)) score += 35;
  return score;
}

function normalizeComponentIdentity(value) {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function packageMatchesSemanticId(contract, semanticComponentId) {
  if (!semanticComponentId) return true;
  return normalizeComponentIdentity(contract.packageName).includes(
    normalizeComponentIdentity(semanticComponentId),
  );
}

function findComponent(catalog, query, platform, semanticComponentId = null) {
  const platformMatches = catalog.contracts.filter((contract) =>
    contract.platform === platform || contract.platform === 'universal'
  );
  const exactMatches = platformMatches.filter((contract) =>
    contract.name.normalize('NFKC').trim() === String(query || '').normalize('NFKC').trim() &&
    packageMatchesSemanticId(contract, semanticComponentId)
  );
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    throw createGenerationError(
      `Компонент ${query} неоднозначен в design-system_ab.`,
      'GENERATION_COMPONENT_AMBIGUOUS',
      422,
      { query, semanticComponentId, matches: exactMatches.map((item) => item.knowledgePath) },
    );
  }
  if (semanticComponentId) return null;

  const ranked = platformMatches
    .map((contract) => ({ contract, score: scoreContract(contract, query, platform) }))
    .filter((entry) => entry.score > 20)
    .sort((left, right) =>
      right.score - left.score || left.contract.name.localeCompare(right.contract.name, 'ru')
    );
  if (!ranked.length) return null;
  const leaders = ranked.filter((entry) => entry.score === ranked[0].score);
  if (leaders.length > 1) {
    throw createGenerationError(
      `Компонент ${query} неоднозначен в design-system_ab.`,
      'GENERATION_COMPONENT_AMBIGUOUS',
      422,
      { query, matches: leaders.map((entry) => entry.contract.knowledgePath) },
    );
  }
  return ranked[0].contract;
}

function isSafeRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]+/).includes('..')
  );
}

function hashFile(absolutePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
}

function resolveHubSources(dsAiHubRoot, sources, allowedSourcePaths = null) {
  const root = path.resolve(dsAiHubRoot);
  const allowedPaths = Array.isArray(allowedSourcePaths)
    ? new Set(allowedSourcePaths)
    : null;
  return sources.map((source) => {
    if (!isSafeRelativePath(source.path)) {
      throw createGenerationError(
        'Семантический план содержит небезопасный путь ds-ai-hub.',
        'GENERATION_SOURCE_INVALID',
        502,
        { path: source.path },
      );
    }
    const absolutePath = path.resolve(root, source.path);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) {
      throw createGenerationError(
        'Семантический план вышел за пределы ds-ai-hub.',
        'GENERATION_SOURCE_INVALID',
        502,
        { path: source.path },
      );
    }
    if (allowedPaths && !allowedPaths.has(source.path)) {
      throw createGenerationError(
        `Источник ${source.path} отсутствует в context packet агента.`,
        'GENERATION_CONTEXT_SOURCE_UNAVAILABLE',
        502,
        { path: source.path },
      );
    }
    const stat = fs.statSync(absolutePath, { throwIfNoEntry: false });
    if (!stat?.isFile()) {
      throw createGenerationError(
        `Источник ds-ai-hub не найден: ${source.path}.`,
        'GENERATION_SOURCE_MISSING',
        502,
        { path: source.path },
      );
    }
    const text = fs.readFileSync(absolutePath, 'utf8');
    const missingRuleIds = source.ruleIds.filter((ruleId) => !text.includes(ruleId));
    if (missingRuleIds.length) {
      throw createGenerationError(
        `Источник ${source.path} не подтверждает заявленные правила.`,
        'GENERATION_SOURCE_EVIDENCE_INVALID',
        502,
        { path: source.path, missingRuleIds },
      );
    }
    return {
      source: 'ds-ai-hub',
      path: source.path,
      role: source.role,
      purpose: source.purpose,
      ruleIds: source.ruleIds,
      checksum: hashFile(absolutePath),
    };
  });
}

function resolvePrimaryPattern(dsAiHubRoot, primaryPattern, resolvedHubSources) {
  if (!primaryPattern) return null;
  const source = resolvedHubSources.find((entry) => entry.path === primaryPattern.sourcePath);
  if (!source) {
    throw createGenerationError(
      'Основной паттерн отсутствует в списке прочитанных источников агента.',
      'GENERATION_PATTERN_EVIDENCE_MISSING',
      502,
      { sourcePath: primaryPattern.sourcePath },
    );
  }
  const absolutePath = path.join(dsAiHubRoot, primaryPattern.sourcePath);
  const text = fs.readFileSync(absolutePath, 'utf8');
  if (!text.includes(primaryPattern.id)) {
    throw createGenerationError(
      `Источник ${primaryPattern.sourcePath} не подтверждает patternId.`,
      'GENERATION_PATTERN_EVIDENCE_INVALID',
      502,
      { patternId: primaryPattern.id },
    );
  }
  const missingRuleIds = primaryPattern.ruleIds.filter((ruleId) => !text.includes(ruleId));
  if (missingRuleIds.length) {
    throw createGenerationError(
      'Основной паттерн не подтверждает заявленные правила.',
      'GENERATION_PATTERN_EVIDENCE_INVALID',
      502,
      { patternId: primaryPattern.id, missingRuleIds },
    );
  }
  const patternKeyMatch = text.match(/(?:^|\n)-?\s*patternKey:\s*([^\n]+)/i);
  const nameMatch = text.match(/^#\s+Pattern:\s*(.+)$/im);
  return {
    id: primaryPattern.id,
    key: patternKeyMatch?.[1]?.trim() || primaryPattern.id.replace(/^ptrn:/, ''),
    name: nameMatch?.[1]?.trim() || primaryPattern.id,
    sourcePath: primaryPattern.sourcePath,
    sourceChecksum: source.checksum,
    ruleIds: primaryPattern.ruleIds,
  };
}

function semanticEvidenceTokens(value) {
  const normalized = normalizeSearchText(
    String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2'),
  );
  const ignored = new Set([
    'adapter', 'component', 'components', 'cookbook', 'desktop', 'figma',
    'group', 'guideline', 'instructions', 'mobile', 'pattern', 'patterns',
    'products', 'view', 'web',
  ]);
  return new Set(
    normalized
      .split(' ')
      .map((token) => token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token)
      .filter((token) => token.length >= 3 && !ignored.has(token)),
  );
}

function assertComponentSemanticEvidence(
  dsAiHubRoot,
  semanticComponentId,
  componentQuery,
  resolvedHubSources,
) {
  const metaCandidates = resolvedHubSources.filter((source) => source.path.endsWith('/meta.json'));
  for (const metaSource of metaCandidates) {
    let metadata;
    try {
      metadata = JSON.parse(fs.readFileSync(path.join(dsAiHubRoot, metaSource.path), 'utf8'));
    } catch (_error) {
      continue;
    }
    if (metadata?.id !== semanticComponentId) continue;
    const publicRoots = [
      ...(Array.isArray(metadata.publicComponentRoots) ? metadata.publicComponentRoots : []),
      ...(Array.isArray(metadata.recommendedComponentRoots) ? metadata.recommendedComponentRoots : []),
    ];
    if (publicRoots.length && !publicRoots.includes(componentQuery)) {
      throw createGenerationError(
        `${componentQuery} не является public root компонента ${semanticComponentId}.`,
        'GENERATION_COMPONENT_ROOT_INVALID',
        422,
        { semanticComponentId, componentQuery, publicRoots: Array.from(new Set(publicRoots)) },
      );
    }
    // Legacy/core Hub packages may define semantic identity without a public
    // Figma root. In that case the exact public root is resolved and checked
    // against design-system_ab by findComponent; it must not be duplicated or
    // guessed into the Hub metadata.
    return metaSource;
  }
  {
    throw createGenerationError(
      `Агент не подтвердил ${semanticComponentId}/${componentQuery} полным пакетом ds-ai-hub.`,
      'GENERATION_COMPONENT_KNOWLEDGE_MISSING',
      502,
      { semanticComponentId, componentQuery },
    );
  }
}

function validateVariantProperties(component, requestedProperties, warnings) {
  return requestedProperties.map((property) => {
    const allowedValues = component.variants[property.name];
    if (Array.isArray(allowedValues) && allowedValues.includes(property.value)) {
      return property;
    }
    if (!Array.isArray(allowedValues) && /#\d+:\d+$/.test(property.name)) {
      const normalizedValue = typeof property.value === 'string' && /^(?:true|false)$/i.test(property.value)
        ? property.value.toLowerCase() === 'true'
        : property.value;
      warnings.push(
        `Свойство ${component.name}.${property.name} подтверждено cookbook, но отсутствует в variant-контракте; окончательно проверяется Figma runtime.`,
      );
      return { name: property.name, value: normalizedValue };
    }
    {
      throw createGenerationError(
        `Компонент ${component.name} не поддерживает ${property.name}=${property.value}.`,
        'GENERATION_COMPONENT_PROPERTY_UNAVAILABLE',
        422,
        {
          componentId: component.id,
          property: property.name,
          value: property.value,
          allowedValues: Array.isArray(allowedValues) ? allowedValues : [],
        },
      );
    }
  });
}

function findSemanticTarget(component, targetId) {
  const matches = [];
  for (const profile of component.semanticProfiles || []) {
    for (const target of profile.targets || []) {
      if (target?.id === targetId) matches.push({ profile, target });
    }
  }
  if (!matches.length) return null;
  if (matches.length > 1) {
    throw createGenerationError(
      `Semantic target ${targetId} неоднозначен в ${component.name}.`,
      'GENERATION_SEMANTIC_TARGET_AMBIGUOUS',
      503,
      { componentId: component.id, targetId, profiles: matches.map((item) => item.profile.id) },
    );
  }
  return matches[0];
}

function semanticTargetValue(component, target, value) {
  const values = target.values || {};
  const sourceKey = String(value);
  if (Object.prototype.hasOwnProperty.call(values, sourceKey)) return values[sourceKey];
  const normalizedKey = sourceKey.toLocaleLowerCase('ru-RU');
  const matchingKey = Object.keys(values).find((key) =>
    key.toLocaleLowerCase('ru-RU') === normalizedKey
  );
  if (matchingKey) return values[matchingKey];
  throw createGenerationError(
    `Semantic target ${target.id} не поддерживает значение ${sourceKey}.`,
    'GENERATION_SEMANTIC_TARGET_VALUE_UNAVAILABLE',
    422,
    { componentId: component.id, targetId: target.id, value, allowedValues: Object.keys(values) },
  );
}

function ensureSupportedSemanticTarget(component, targetEntry) {
  if (targetEntry?.target?.supported === true) return targetEntry.target;
  throw createGenerationError(
    `Semantic target ${targetEntry?.target?.id || 'unknown'} пока нельзя исполнить в ${component.name}.`,
    'GENERATION_SEMANTIC_TARGET_UNAVAILABLE',
    422,
    {
      componentId: component.id,
      targetId: targetEntry?.target?.id || null,
      reason: targetEntry?.target?.reason || null,
    },
  );
}

function selectorOverrides(target, payload) {
  return (target.selectors || []).map((selector) => ({
    path: selector.path,
    occurrence: selector.occurrence || 0,
    nodeTypes: selector.nodeTypes,
    semanticTarget: target.id,
    ...payload,
  }));
}

function resolveComponentConfiguration(component, requestedProperties, warnings) {
  const rawProperties = [];
  const nodeOverrides = [];
  const instancePropertyOverrides = [];
  for (const property of requestedProperties) {
    const targetEntry = findSemanticTarget(component, property.name);
    if (!targetEntry) {
      rawProperties.push(property);
      continue;
    }
    const target = ensureSupportedSemanticTarget(component, targetEntry);
    if (target.kind === 'variant-property') {
      rawProperties.push({
        name: target.property,
        value: semanticTargetValue(component, target, property.value),
      });
      continue;
    }
    if (target.kind === 'node-visibility') {
      const value = typeof property.value === 'boolean'
        ? property.value
        : String(property.value).toLocaleLowerCase('ru-RU') === 'true';
      nodeOverrides.push(...selectorOverrides(target, { visible: value }));
      continue;
    }
    if (target.kind === 'instance-property') {
      const value = semanticTargetValue(component, target, property.value);
      instancePropertyOverrides.push(...selectorOverrides(target, {
        properties: [{ name: target.property, value }],
      }));
      continue;
    }
    throw createGenerationError(
      `Semantic target ${target.id} нельзя передать через variantProperties.`,
      'GENERATION_SEMANTIC_TARGET_KIND_MISMATCH',
      422,
      { componentId: component.id, targetId: target.id, kind: target.kind },
    );
  }
  return {
    variantProperties: validateVariantProperties(component, rawProperties, warnings),
    nodeOverrides,
    instancePropertyOverrides,
  };
}

function effectiveVariantProperties(component, variantProperties) {
  const values = new Map(Object.entries(component.defaultVariantProperties || {}));
  for (const property of variantProperties || []) values.set(property.name, property.value);
  return values;
}

function findUnavailableCondition(target, effectiveProperties) {
  for (const condition of target.availableWhen || []) {
    const actual = effectiveProperties.get(condition.property);
    const matches = (condition.values || []).some((value) => String(value) === String(actual));
    if (!matches) return { property: condition.property, actual, expected: condition.values || [] };
  }
  return null;
}

function resolveEditContextOverrides(component, target) {
  return (target.editContext || []).flatMap((context) => {
    const dependencyEntry = findSemanticTarget(component, context.target);
    const dependency = ensureSupportedSemanticTarget(component, dependencyEntry);
    if (dependency.kind !== 'instance-property') {
      throw createGenerationError(
        `Edit context ${context.target} нельзя применить в ${component.name}.`,
        'GENERATION_EDIT_CONTEXT_INVALID',
        503,
        { componentId: component.id, targetId: target.id, contextTarget: context.target },
      );
    }
    const value = semanticTargetValue(component, dependency, context.value);
    return selectorOverrides(dependency, {
      properties: [{ name: dependency.property, value }],
    });
  });
}

function uniqueInstancePropertyOverrides(overrides) {
  const seen = new Set();
  return overrides.filter((override) => {
    const key = JSON.stringify([
      override.path,
      override.occurrence,
      override.semanticTarget,
      override.properties,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedTextPathSegments(value) {
  return String(value || '')
    .split('/')
    .map((segment) => normalizeSearchText(segment))
    .filter(Boolean);
}

function resolveTextOverridePath(textPaths, requestedPath) {
  const requestedSegments = normalizedTextPathSegments(requestedPath);
  if (!requestedSegments.length) return null;

  const candidates = textPaths.map((pathValue) => ({
    path: pathValue,
    segments: normalizedTextPathSegments(pathValue),
  }));
  const exactSuffixMatches = candidates.filter((candidate) => {
    if (candidate.segments.length < requestedSegments.length) return false;
    return requestedSegments.every((segment, index) =>
      candidate.segments[candidate.segments.length - requestedSegments.length + index] === segment
    );
  });
  if (exactSuffixMatches.length === 1) {
    return { path: exactSuffixMatches[0].path, inferred: false };
  }

  // The semantic plan may describe a text role through its conceptual hierarchy
  // (for example Field/Content/Label), while the exported component anatomy can
  // flatten that role to Label/Label. A unique leaf is still a deterministic,
  // contract-backed target; duplicate leaves remain ambiguous and are rejected.
  const requestedLeaf = requestedSegments[requestedSegments.length - 1];
  const roleContainerMatches = candidates.filter((candidate) => {
    const length = candidate.segments.length;
    return (
      length >= 2 &&
      candidate.segments[length - 1] === requestedLeaf &&
      candidate.segments[length - 2] === requestedLeaf
    );
  });
  if (roleContainerMatches.length === 1) {
    return { path: roleContainerMatches[0].path, inferred: true };
  }
  if (exactSuffixMatches.length > 1) return null;

  const leafMatches = candidates.filter((candidate) =>
    candidate.segments[candidate.segments.length - 1] === requestedLeaf
  );
  if (leafMatches.length === 1) {
    return { path: leafMatches[0].path, inferred: true };
  }
  return null;
}

function validateTextOverrides(component, requestedOverrides, warnings, variantProperties) {
  if (!requestedOverrides.length) return { textOverrides: [], preconditionOverrides: [] };
  const textPaths = component.anatomy
    .filter((entry) => entry?.type === 'TEXT' && typeof entry.path === 'string')
    .map((entry) => entry.path);
  const effectiveProperties = effectiveVariantProperties(component, variantProperties);
  const preconditionOverrides = [];
  const textOverrides = requestedOverrides.flatMap((override) => {
    const targetEntry = findSemanticTarget(component, override.path);
    if (targetEntry) {
      const target = ensureSupportedSemanticTarget(component, targetEntry);
      if (target.kind !== 'text') {
        throw createGenerationError(
          `Semantic target ${target.id} нельзя передать через textOverrides.`,
          'GENERATION_SEMANTIC_TARGET_KIND_MISMATCH',
          422,
          { componentId: component.id, targetId: target.id, kind: target.kind },
        );
      }
      const unavailable = findUnavailableCondition(target, effectiveProperties);
      if (unavailable) {
        if (target.onUnavailable === 'omit') {
          warnings.push(
            `Semantic target ${component.name}.${target.id} пропущен: ` +
            `${unavailable.property}=${String(unavailable.actual)} не входит в ` +
            `[${unavailable.expected.map(String).join(', ')}].`,
          );
          return [];
        }
        throw createGenerationError(
          `Semantic target ${target.id} недоступен при текущем состоянии ${component.name}.`,
          'GENERATION_SEMANTIC_TARGET_PRECONDITION_FAILED',
          422,
          { componentId: component.id, targetId: target.id, condition: unavailable },
        );
      }
      preconditionOverrides.push(...resolveEditContextOverrides(component, target));
      return selectorOverrides(target, { value: override.value });
    }
    const resolved = resolveTextOverridePath(textPaths, override.path);
    if (!resolved) {
      throw createGenerationError(
        `Текстовый путь ${override.path} не разрешён однозначно в ${component.name}.`,
        'GENERATION_TEXT_TARGET_UNAVAILABLE',
        422,
        { componentId: component.id, path: override.path, matches: 0 },
      );
    }
    if (resolved.inferred) {
      warnings.push(
        `Текстовая роль ${component.name}.${override.path} сопоставлена с ${resolved.path} по уникальному имени слоя.`,
      );
    }
    return [{ path: resolved.path, value: override.value }];
  });
  return {
    textOverrides,
    preconditionOverrides: uniqueInstancePropertyOverrides(preconditionOverrides),
  };
}

function resolvePlacementTarget(parentComponent, requestedTarget, placement) {
  if (!requestedTarget) return { path: null, occurrence: null, semanticTarget: null };
  if (!parentComponent) return { path: requestedTarget, occurrence: null, semanticTarget: null };
  const targetEntry = findSemanticTarget(parentComponent, requestedTarget);
  if (!targetEntry) return { path: requestedTarget, occurrence: null, semanticTarget: null };
  const target = ensureSupportedSemanticTarget(parentComponent, targetEntry);
  const expectedKind = placement === 'replace-slot' ? 'slot' : 'instance-property';
  if (target.kind !== expectedKind || !target.selectors?.length) {
    throw createGenerationError(
      `Semantic target ${target.id} нельзя использовать для ${placement}.`,
      'GENERATION_SEMANTIC_TARGET_KIND_MISMATCH',
      422,
      { componentId: parentComponent.id, targetId: target.id, kind: target.kind, expectedKind },
    );
  }
  const selector = target.selectors[0];
  return {
    path: selector.path,
    occurrence: selector.occurrence || 0,
    semanticTarget: target.id,
  };
}

function findFillVariable(tokenCatalog, fillRole) {
  if (fillRole === 'none') return null;
  const target = FILL_ROLE_TOKENS[fillRole];
  const normalizedTarget = normalizeSearchText(target);
  return tokenCatalog.variables.find((variable) =>
    variable.name === target || variable.normalizedName === normalizedTarget
  ) || null;
}

function uniqueKnowledgeSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    const key = `${source.source}:${source.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function blockedGenerationOutcome(blocked, resolvedHubSources, contextTrace) {
  return {
    status: 'blocked',
    blocked,
    knowledge: {
      primarySource: 'ds-ai-hub',
      retrieval: contextTrace || null,
      sources: resolvedHubSources,
    },
  };
}

function normalizedClarificationText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTechnicalClarification(clarification) {
  const text = normalizedClarificationText([
    clarification?.question,
    clarification?.reason,
    ...(clarification?.suggestedAnswers || []),
  ].join(' '));
  return /(?:context packet|blueprint|generation contract|semantic target|apollo proxy|перезапуст|пакет контракт|расширить пакет|исполним.*контракт|figma key|source path)/u.test(text);
}

function wasClarificationAlreadyAsked(dialogue, clarification) {
  const question = normalizedClarificationText(clarification?.question);
  if (!question) return false;
  const signature = question.slice(0, 96);
  return (dialogue || []).some((entry) =>
    entry?.role === 'assistant' &&
    normalizedClarificationText(entry.text).includes(signature)
  );
}

function applyPatternCompilerDefaults(semanticPlan) {
  if (
    semanticPlan.status !== 'ready' ||
    semanticPlan.primaryPattern?.id !== 'ptrn:landing-pages.alfa-business'
  ) {
    return semanticPlan;
  }
  let nodes = semanticPlan.nodes.map((node) => Object.assign({}, node));
  const root = nodes.find((node) => node.type === 'frame' && node.parentId === null);
  const corporate = nodes.find((node) =>
    node.type === 'component' && node.semanticComponentId === 'CorporateContent'
  );
  const main = nodes.find((node) =>
    node.type === 'frame' && node.semanticRole === 'main-content'
  );
  if (root && corporate) {
    corporate.parentId = root.id;
    corporate.placement = 'append';
    corporate.parentPath = null;
  }
  if (corporate && main) {
    main.parentId = corporate.id;
    main.placement = 'replace-slot';
    main.parentPath = 'slots.body';
  }
  if (main) {
    for (const node of nodes) {
      if (['hero', 'benefits', 'features', 'footer'].includes(node.semanticRole)) {
        node.parentId = main.id;
        node.placement = 'append';
        node.parentPath = null;
      }
      if (node.type === 'frame' && node.semanticRole === 'footer') {
        node.fillRole = 'base';
      }
    }
  }

  const features = nodes.find((node) =>
    node.type === 'frame' && node.semanticRole === 'features'
  );
  const featureCards = nodes.filter((node) =>
    node.type === 'component' && node.semanticRole === 'feature'
  );
  if (semanticPlan.platform === 'desktop' && features && featureCards.length === 5) {
    features.layout = 'vertical';
    features.gap = 24;
    const directRows = nodes.filter((node) =>
      node.type === 'frame' && node.parentId === features.id && node.layout === 'horizontal'
    );
    const selectedRows = directRows.slice(0, 2);
    const usedIds = new Set(nodes.map((node) => node.id));
    function uniqueId(base) {
      let candidate = base;
      let suffix = 2;
      while (usedIds.has(candidate)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(candidate);
      return candidate;
    }
    while (selectedRows.length < 2) {
      const index = selectedRows.length + 1;
      const row = {
        id: uniqueId(`apollo-features-row-${index}`),
        type: 'frame',
        parentId: features.id,
        name: `Ряд особенностей ${index}`,
        semanticRole: 'content',
        semanticComponentId: null,
        placement: 'append',
        parentPath: null,
        width: 'fill',
        minHeight: null,
        layout: 'horizontal',
        gap: 24,
        padding: 0,
        fillRole: 'none',
        cornerRadius: 0,
        componentQuery: null,
        variantProperties: [],
        textOverrides: [],
      };
      selectedRows.push(row);
      nodes.push(row);
    }
    for (const [index, row] of selectedRows.entries()) {
      row.parentId = features.id;
      row.placement = 'append';
      row.parentPath = null;
      row.layout = 'horizontal';
      row.gap = 24;
      row.padding = 0;
      row.fillRole = 'none';
      row.name = `Ряд особенностей ${index + 1}`;
    }
    const selectedRowIds = new Set(selectedRows.map((row) => row.id));
    const removableRowIds = new Set(directRows
      .filter((row) => !selectedRowIds.has(row.id))
      .filter((row) => nodes
        .filter((node) => node.parentId === row.id)
        .every((node) => node.semanticRole === 'feature'))
      .map((row) => row.id));
    nodes = nodes.filter((node) => !removableRowIds.has(node.id));
    for (const [index, card] of featureCards.entries()) {
      card.parentId = index < 3 ? selectedRows[0].id : selectedRows[1].id;
      card.placement = 'append';
      card.parentPath = null;
      const properties = new Map((card.variantProperties || []).map((property) => [property.name, property]));
      properties.set('variant.size', { name: 'variant.size', value: 'small' });
      properties.set('variant.image', { name: 'variant.image', value: 'none' });
      properties.set('variant.imageCrop', { name: 'variant.imageCrop', value: false });
      card.variantProperties = Array.from(properties.values());
    }
  }
  return Object.assign({}, semanticPlan, { nodes });
}

function topologicallyOrderSemanticNodes(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(node) {
    if (visited.has(node.id)) return;
    if (visiting.has(node.id)) {
      throw createGenerationError(
        `Семантический план содержит цикл в parentId около ${node.id}.`,
        'GENERATION_NODE_CYCLE',
        422,
        { nodeId: node.id },
      );
    }
    visiting.add(node.id);
    if (node.parentId !== null) {
      const parent = byId.get(node.parentId);
      if (!parent) {
        throw createGenerationError(
          `Родитель ${node.parentId} для узла ${node.id} отсутствует в плане.`,
          'GENERATION_PARENT_NOT_FOUND',
          422,
          { nodeId: node.id, parentId: node.parentId },
        );
      }
      visit(parent);
    }
    visiting.delete(node.id);
    visited.add(node.id);
    ordered.push(node);
  }

  for (const node of nodes) visit(node);
  return ordered;
}

function createGenerationPlan(payload, semanticResponse, options = {}) {
  const request = normalizeGenerationRequest(payload);
  let semanticPlan = validateSemanticGenerationResponse(semanticResponse);
  if (!options.dsAiHubRoot) {
    throw createGenerationError(
      'Не задан корень ds-ai-hub.',
      'GENERATION_SEMANTIC_KNOWLEDGE_MISSING',
      503,
    );
  }
  const dsAiHubRoot = path.resolve(options.dsAiHubRoot);
  const resolvedHubSources = resolveHubSources(
    dsAiHubRoot,
    semanticPlan.sources,
    options.allowedSourcePaths,
  );
  if (semanticPlan.status === 'blocked') {
    return blockedGenerationOutcome(
      semanticPlan.blocked,
      resolvedHubSources,
      options.contextTrace,
    );
  }
  if (semanticPlan.status === 'clarification_required') {
    if (isTechnicalClarification(semanticPlan.clarification)) {
      return blockedGenerationOutcome({
        code: 'GENERATION_CAPABILITY_MISSING',
        message: 'Текущий набор исполнимых возможностей не позволяет собрать этот макет без догадок.',
        reason: semanticPlan.clarification.reason,
        missingCapabilities: ['generation-capability'],
      }, resolvedHubSources, options.contextTrace);
    }
    if (
      request.clarificationRound >= 4 ||
      wasClarificationAlreadyAsked(request.dialogue, semanticPlan.clarification)
    ) {
      return blockedGenerationOutcome({
        code: 'GENERATION_CLARIFICATION_LIMIT',
        message: 'Генерация остановлена: агент не смог подготовить однозначный план после уточнений.',
        reason: request.clarificationRound >= 4
          ? 'Достигнут лимит из четырёх продуктовых уточнений.'
          : 'Агент повторил уже заданный вопрос.',
        missingCapabilities: [],
      }, resolvedHubSources, options.contextTrace);
    }
    return {
      status: 'clarification_required',
      clarification: semanticPlan.clarification,
      knowledge: {
        primarySource: 'ds-ai-hub',
        retrieval: options.contextTrace || null,
        sources: resolvedHubSources,
      },
    };
  }
  if (!options.designSystemRoot) {
    throw createGenerationError(
      'Не задан корень design-system_ab.',
      'GENERATION_TECHNICAL_KNOWLEDGE_MISSING',
      503,
    );
  }

  semanticPlan = applyPatternCompilerDefaults(semanticPlan);
  semanticPlan = Object.assign({}, semanticPlan, {
    nodes: topologicallyOrderSemanticNodes(semanticPlan.nodes),
  });

  const designSystemRoot = path.resolve(options.designSystemRoot);
  const catalog = loadGenerationCatalog(designSystemRoot);
  const tokenCatalog = loadTokenCatalog(designSystemRoot);
  const pattern = resolvePrimaryPattern(
    dsAiHubRoot,
    semanticPlan.primaryPattern,
    resolvedHubSources,
  );
  const technicalSources = [];
  const warnings = [];
  let componentCount = 0;
  const technicalComponentByNodeId = new Map();
  const nodes = semanticPlan.nodes.map((semanticNode) => {
    const parentTechnicalComponent = semanticNode.parentId
      ? technicalComponentByNodeId.get(semanticNode.parentId) || null
      : null;
    const placementTarget = resolvePlacementTarget(
      parentTechnicalComponent,
      semanticNode.parentPath,
      semanticNode.placement,
    );
    if (semanticNode.type === 'frame') {
      const fillVariable = findFillVariable(tokenCatalog, semanticNode.fillRole);
      if (semanticNode.fillRole !== 'none' && !fillVariable) {
        throw createGenerationError(
          `Токен заливки ${FILL_ROLE_TOKENS[semanticNode.fillRole]} не найден в design-system_ab.`,
          'GENERATION_TOKEN_UNAVAILABLE',
          503,
          { fillRole: semanticNode.fillRole },
        );
      }
      if (fillVariable) {
        technicalSources.push({
          source: 'design-system_ab',
          path: fillVariable.knowledgePath,
          role: 'variable-catalog',
          purpose: `Заливка ${semanticNode.name}`,
          ruleIds: [],
          checksum: null,
        });
      }
      const frame = {
        id: semanticNode.id,
        type: 'frame',
        parentId: semanticNode.parentId,
        name: semanticNode.name,
        semanticRole: semanticNode.semanticRole,
        placement: semanticNode.placement,
        parentPath: placementTarget.path,
        parentOccurrence: placementTarget.occurrence,
        parentSemanticTarget: placementTarget.semanticTarget,
        width:
          semanticNode.parentId === null && semanticNode.width === 'fill'
            ? semanticPlan.platform === 'mobile-web' ? 390 : 1200
            : semanticNode.width,
        layout: semanticNode.layout,
        gap: semanticNode.gap,
        padding: semanticNode.padding,
        fillVariableKey: fillVariable?.key || null,
        fillVariableName: fillVariable?.name || null,
        cornerRadius: semanticNode.cornerRadius,
      };
      if (semanticNode.minHeight !== null) frame.minHeight = semanticNode.minHeight;
      return frame;
    }
    if (componentCount >= MAX_COMPONENTS) {
      throw createGenerationError(
        `Семантический план превышает лимит ${MAX_COMPONENTS} компонентов.`,
        'GENERATION_COMPONENT_LIMIT_EXCEEDED',
        422,
      );
    }
    assertComponentSemanticEvidence(
      dsAiHubRoot,
      semanticNode.semanticComponentId,
      semanticNode.componentQuery,
      resolvedHubSources,
    );
    const component = findComponent(
      catalog,
      semanticNode.componentQuery,
      semanticPlan.platform,
      semanticNode.semanticComponentId,
    );
    if (!component) {
      throw createGenerationError(
        `Компонент ${semanticNode.componentQuery} не найден для ${semanticPlan.platform}.`,
        'GENERATION_COMPONENTS_NOT_FOUND',
        422,
        { query: semanticNode.componentQuery, platform: semanticPlan.platform },
      );
    }
    if (
      semanticNode.semanticRole === 'form' &&
      semanticNode.placement === 'append' &&
      component.presentation === 'modal'
    ) {
      throw createGenerationError(
        `Модальный компонент ${component.name} нельзя использовать как встроенную форму страницы.`,
        'GENERATION_PRESENTATION_MISMATCH',
        422,
        { semanticComponentId: semanticNode.semanticComponentId, presentation: component.presentation },
      );
    }
    componentCount += 1;
    technicalSources.push({
      source: 'design-system_ab',
      path: component.knowledgePath,
      role: 'component-contract',
      purpose: `Figma key и возможности ${component.name}`,
      ruleIds: [],
      checksum: null,
    });
    if (component.semanticTargetPath) {
      technicalSources.push({
        source: 'design-system_ab',
        path: component.semanticTargetPath,
        role: 'semantic-target-map',
        purpose: `Semantic targets ${component.name}`,
        ruleIds: [],
        checksum: hashFile(path.join(designSystemRoot, component.semanticTargetPath)),
      });
    }
    const configuration = resolveComponentConfiguration(
      component,
      semanticNode.variantProperties,
      warnings,
    );
    const textConfiguration = validateTextOverrides(
      component,
      semanticNode.textOverrides,
      warnings,
      configuration.variantProperties,
    );
    const compiledNode = {
      id: semanticNode.id,
      type: 'component',
      parentId: semanticNode.parentId,
      name: semanticNode.name || component.name,
      semanticRole: semanticNode.semanticRole,
      semanticComponentId: semanticNode.semanticComponentId,
      placement: semanticNode.placement,
      parentPath: placementTarget.path,
      parentOccurrence: placementTarget.occurrence,
      parentSemanticTarget: placementTarget.semanticTarget,
      componentId: component.id,
      componentKey: component.importKey,
      width: semanticNode.width,
      knowledgePath: component.knowledgePath,
      presentation: component.presentation,
      variantProperties: configuration.variantProperties,
      textOverrides: textConfiguration.textOverrides,
      preconditionOverrides: textConfiguration.preconditionOverrides,
      nodeOverrides: configuration.nodeOverrides,
      instancePropertyOverrides: configuration.instancePropertyOverrides,
    };
    technicalComponentByNodeId.set(semanticNode.id, component);
    return compiledNode;
  });

  const preflight = runGenerationPreflight(payload, semanticPlan, nodes);

  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    title: semanticPlan.title,
    summary: semanticPlan.summary,
    kind: semanticPlan.kind,
    recipe: semanticPlan.kind === 'pattern' ? null : semanticPlan.recipe,
    pattern,
    platform: semanticPlan.platform,
    knowledge: {
      primarySource: 'ds-ai-hub',
      technicalSource: 'design-system_ab',
      retrieval: options.contextTrace || null,
      catalogRoot: path.relative(designSystemRoot, catalog.catalogRoot) || '.',
      componentCount,
      sources: uniqueKnowledgeSources(resolvedHubSources.concat(technicalSources)),
    },
    warnings: Array.from(new Set(warnings)),
    preflight,
    nodes,
  };
}

function clearGenerationCatalogCache() {
  catalogCache.clear();
  tokenCatalogCache.clear();
}

function inspectGenerationComponentAvailability(designSystemRoot, semanticComponentIds) {
  const catalog = loadGenerationCatalog(designSystemRoot);
  return Object.fromEntries(semanticComponentIds.map((semanticComponentId) => [
    semanticComponentId,
    (() => {
      const matches = catalog.contracts.filter((contract) =>
        packageMatchesSemanticId(contract, semanticComponentId) && contract.role === 'main'
      );
      const mappedMatches = matches.filter((contract) =>
        (contract.semanticProfiles || []).length > 0
      );
      const projectedMatches = mappedMatches.length ? mappedMatches : matches;
      return {
        available: projectedMatches.length > 0,
        contracts: projectedMatches.slice(0, 12).map((contract) => ({
          name: contract.name,
          platform: contract.platform,
          presentation: contract.presentation,
          variantProperties: contract.variants,
          semanticTargetProfiles: (contract.semanticProfiles || []).map((profile) => ({
            id: profile.id,
            publicRoot: profile.publicRoot,
            liveInstanceVerified: profile.verification?.liveInstanceVerified === true,
            targets: (profile.targets || []).map((target) => ({
              id: target.id,
              kind: target.kind,
              supported: target.supported === true,
              values: target.values ? Object.keys(target.values) : [],
              availableWhen: target.availableWhen || [],
              onUnavailable: target.onUnavailable || null,
              editContext: target.editContext || [],
              reason: target.supported === false ? target.reason || null : null,
            })),
          })),
          textTargets: contract.semanticProfiles?.length ? [] : contract.anatomy
            .filter((entry) => entry?.type === 'TEXT' && typeof entry.path === 'string')
            .map((entry) => entry.path)
            .slice(0, 16),
          slotTargets: contract.semanticProfiles?.length ? [] : contract.anatomy
            .filter((entry) => entry?.type === 'SLOT' && typeof entry.path === 'string')
            .map((entry) => entry.path)
            .slice(0, 8),
        })),
      };
    })(),
  ]));
}

module.exports = {
  FILL_ROLE_TOKENS,
  MAX_COMPONENTS,
  PLAN_SCHEMA_VERSION,
  applyPatternCompilerDefaults,
  clearGenerationCatalogCache,
  createGenerationPlan,
  findComponent,
  inspectGenerationComponentAvailability,
  loadGenerationCatalog,
  loadTokenCatalog,
  normalizeSearchText,
  resolveCatalogRoot,
  resolveHubSources,
};
