const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  normalizeGenerationRequest,
  validateSemanticGenerationResponse,
} = require('./semantic-planner');

const PLAN_SCHEMA_VERSION = 'apollo.generation-plan.v2';
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
    path.join(designSystemRoot, 'web', 'components'),
    path.join(designSystemRoot, 'JSONS', 'web', 'components'),
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
        variants: contract?.figma?.variants?.properties || {},
        anatomy: Array.isArray(contract?.figma?.anatomy) ? contract.figma.anatomy : [],
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

function findComponent(catalog, query, platform) {
  return catalog.contracts
    .map((contract) => ({ contract, score: scoreContract(contract, query, platform) }))
    .filter((entry) => entry.score > 20)
    .sort((left, right) =>
      right.score - left.score || left.contract.name.localeCompare(right.contract.name, 'ru')
    )[0]?.contract || null;
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

function assertComponentSemanticEvidence(componentQuery, resolvedHubSources) {
  const componentTokens = semanticEvidenceTokens(componentQuery);
  const evidence = resolvedHubSources.find((source) => {
    const sourceTokens = semanticEvidenceTokens(`${source.path} ${source.purpose}`);
    for (const token of componentTokens) {
      if (sourceTokens.has(token)) return true;
    }
    return false;
  });
  if (!evidence) {
    throw createGenerationError(
      `Агент не подтвердил компонент ${componentQuery} источником ds-ai-hub.`,
      'GENERATION_COMPONENT_KNOWLEDGE_MISSING',
      502,
      { componentQuery },
    );
  }
  return evidence;
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

function validateTextOverrides(component, requestedOverrides, warnings) {
  if (!requestedOverrides.length) return [];
  const textPaths = component.anatomy
    .filter((entry) => entry?.type === 'TEXT' && typeof entry.path === 'string')
    .map((entry) => entry.path);
  return requestedOverrides.map((override) => {
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
    return { path: resolved.path, value: override.value };
  });
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

function createGenerationPlan(payload, semanticResponse, options = {}) {
  normalizeGenerationRequest(payload);
  const semanticPlan = validateSemanticGenerationResponse(semanticResponse);
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
  if (semanticPlan.status === 'clarification_required') {
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
  const nodes = semanticPlan.nodes.map((semanticNode) => {
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
    assertComponentSemanticEvidence(semanticNode.componentQuery, resolvedHubSources);
    const component = findComponent(catalog, semanticNode.componentQuery, semanticPlan.platform);
    if (!component) {
      throw createGenerationError(
        `Компонент ${semanticNode.componentQuery} не найден для ${semanticPlan.platform}.`,
        'GENERATION_COMPONENTS_NOT_FOUND',
        422,
        { query: semanticNode.componentQuery, platform: semanticPlan.platform },
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
    return {
      id: semanticNode.id,
      type: 'component',
      parentId: semanticNode.parentId,
      name: semanticNode.name || component.name,
      componentId: component.id,
      componentKey: component.importKey,
      width: semanticNode.width,
      knowledgePath: component.knowledgePath,
      variantProperties: validateVariantProperties(
        component,
        semanticNode.variantProperties,
        warnings,
      ),
      textOverrides: validateTextOverrides(component, semanticNode.textOverrides, warnings),
    };
  });

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
    nodes,
  };
}

function clearGenerationCatalogCache() {
  catalogCache.clear();
  tokenCatalogCache.clear();
}

module.exports = {
  FILL_ROLE_TOKENS,
  MAX_COMPONENTS,
  PLAN_SCHEMA_VERSION,
  clearGenerationCatalogCache,
  createGenerationPlan,
  findComponent,
  loadGenerationCatalog,
  loadTokenCatalog,
  normalizeSearchText,
  resolveHubSources,
};
