const fs = require('fs');
const path = require('path');

const PLAN_SCHEMA_VERSION = 'apollo.generation-plan.v1';
const MAX_PROMPT_CHARS = 4000;
const MAX_COMPONENTS = 12;
const catalogCache = new Map();

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

function listFilesRecursively(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      listFilesRecursively(absolutePath, result);
    } else if (entry.isFile() && entry.name === 'contract.generated.json') {
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
      'Каталог компонентов Apollo Proxy недоступен.',
      'GENERATION_KNOWLEDGE_MISSING',
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
  if (cached && cached.mtimeMs === rootStat.mtimeMs) {
    return cached.value;
  }

  const contracts = [];
  for (const contractPath of listFilesRecursively(catalogRoot)) {
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
        normalizeSearchText(contract.name),
        normalizeSearchText(contract.id),
        normalizeSearchText(path.basename(path.dirname(contractPath))),
      ]);
      aliases.delete('');
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
      });
    }
  }

  if (!contracts.length) {
    throw createGenerationError(
      'В Apollo Proxy не найдены активные компоненты для генерации.',
      'GENERATION_CATALOG_EMPTY',
      503,
    );
  }

  const value = { catalogRoot, contracts };
  catalogCache.set(catalogRoot, { mtimeMs: rootStat.mtimeMs, value });
  return value;
}

function scoreContract(contract, target, platform) {
  let score = 0;
  const normalizedTarget = normalizeSearchText(target);
  if (contract.platform === platform) score += 40;
  else if (contract.platform === 'universal') score += 20;
  else score -= 30;
  if (contract.role === 'main') score += 8;
  if (/corporate|corp/i.test(contract.name)) score += 5;
  if (/🔩|🔒/.test(contract.name)) score -= 15;
  if (contract.normalizedName === normalizedTarget) score += 100;
  if (contract.aliases.includes(normalizedTarget)) score += 80;
  if (contract.normalizedName.includes(normalizedTarget)) score += 35;
  if (normalizedTarget.includes(contract.normalizedName)) score += 25;
  return score;
}

function findComponent(catalog, target, platform) {
  const ranked = catalog.contracts
    .map((contract) => ({
      contract,
      score: scoreContract(contract, target, platform),
    }))
    .filter((entry) => entry.score > 20)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.contract.name.localeCompare(right.contract.name, 'ru');
    });
  return ranked[0]?.contract || null;
}

function findMentionedComponents(catalog, prompt, platform) {
  const normalizedPrompt = normalizeSearchText(prompt);
  const matches = [];
  const seen = new Set();
  for (const contract of catalog.contracts) {
    const alias = contract.aliases
      .filter((value) => value.length >= 4)
      .sort((left, right) => right.length - left.length)
      .find((value) => normalizedPrompt.includes(value));
    if (!alias) continue;
    const preferred = findComponent(catalog, alias, platform);
    if (!preferred || seen.has(preferred.id)) continue;
    seen.add(preferred.id);
    matches.push(preferred);
  }
  return matches.slice(0, MAX_COMPONENTS);
}

function detectRecipe(prompt) {
  if (/(?:таблиц\w*|реестр\w*|список\w*|\btable\b|\bdashboard\b|дашборд\w*)/iu.test(prompt)) {
    return {
      id: 'table',
      title: 'Экран со списком',
      surfaceWidth: 'fill',
      targets: ['TitleView', 'FilterBar', 'TableView Horizontal'],
    };
  }
  if (/(?:форм\w*|анкет\w*|заявк\w*|ввод\w*|\bform\b|\binput\b)/iu.test(prompt)) {
    return {
      id: 'form',
      title: 'Форма',
      surfaceWidth: 560,
      targets: ['TitleView', 'Input', 'Input', 'Select', 'ButtonsGroup'],
    };
  }
  if (/(?:успех\w*|результат\w*|подтвержд\w*|\bsuccess\b|\bconfirmation\b)/iu.test(prompt)) {
    return {
      id: 'result',
      title: 'Экран результата',
      surfaceWidth: 640,
      targets: ['TitleView', 'SystemMessage', 'ButtonsGroup'],
    };
  }
  return {
    id: 'screen',
    title: 'Экран',
    surfaceWidth: 720,
    targets: ['TitleView', 'Input', 'ButtonsGroup'],
  };
}

function buildPlanNodes(components, recipe, platform) {
  const mobile = platform === 'mobile-web';
  const rootWidth = mobile ? 390 : 1200;
  const rootPadding = mobile ? 20 : 48;
  const surfacePadding = mobile ? 20 : 32;
  const nodes = [
    {
      id: 'screen',
      type: 'frame',
      parentId: null,
      name: `Apollo · ${recipe.title}`,
      width: rootWidth,
      minHeight: mobile ? 760 : 720,
      layout: 'vertical',
      gap: mobile ? 20 : 32,
      padding: rootPadding,
      fill: '#F2F3F5',
      cornerRadius: mobile ? 24 : 32,
    },
    {
      id: 'content',
      type: 'frame',
      parentId: 'screen',
      name: 'Content',
      width: recipe.surfaceWidth === 'fill' || mobile ? 'fill' : recipe.surfaceWidth,
      layout: 'vertical',
      gap: mobile ? 16 : 24,
      padding: recipe.id === 'table' ? 0 : surfacePadding,
      fill: recipe.id === 'table' ? null : '#FFFFFF',
      cornerRadius: recipe.id === 'table' ? 0 : 20,
    },
  ];
  components.forEach((component, index) => {
    nodes.push({
      id: `component-${index + 1}`,
      type: 'component',
      parentId: 'content',
      name: component.name,
      componentId: component.id,
      componentKey: component.importKey,
      width: 'fill',
      knowledgePath: component.knowledgePath,
    });
  });
  return nodes;
}

function createGenerationPlan(payload, options = {}) {
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
  if (!prompt) {
    throw createGenerationError(
      'Опишите макет, который нужно создать.',
      'GENERATION_PROMPT_REQUIRED',
    );
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw createGenerationError(
      `Промпт генерации длиннее ${MAX_PROMPT_CHARS} символов.`,
      'GENERATION_PROMPT_TOO_LONG',
    );
  }
  if (!options.designSystemRoot) {
    throw createGenerationError(
      'Не задан корень базы знаний дизайн-системы.',
      'GENERATION_KNOWLEDGE_MISSING',
      503,
    );
  }

  const platform = /(?:мобил\w*|\bmobile\b|телефон\w*)/iu.test(prompt)
    ? 'mobile-web'
    : 'desktop';
  const catalog = loadGenerationCatalog(path.resolve(options.designSystemRoot));
  const recipe = detectRecipe(prompt);
  const mentioned = findMentionedComponents(catalog, prompt, platform);
  const requestedTargets = mentioned.length ? [] : recipe.targets;
  const components = mentioned.slice();
  const missingTargets = [];
  for (const target of requestedTargets) {
    const component = findComponent(catalog, target, platform);
    if (!component) {
      missingTargets.push(target);
      continue;
    }
    components.push(component);
  }
  if (!components.length) {
    throw createGenerationError(
      'В базе Apollo Proxy не найдены компоненты для этого макета.',
      'GENERATION_COMPONENTS_NOT_FOUND',
      422,
      { targets: recipe.targets },
    );
  }

  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    title: recipe.title,
    summary: `${recipe.title}: ${components.length} компонентов из базы Apollo Proxy.`,
    recipe: recipe.id,
    platform,
    knowledge: {
      source: 'apollo-proxy',
      catalogRoot: path.relative(options.designSystemRoot, catalog.catalogRoot) || '.',
      componentCount: components.length,
    },
    warnings: missingTargets.map(
      (target) => `Компонент ${target} не найден и пропущен.`,
    ),
    nodes: buildPlanNodes(components.slice(0, MAX_COMPONENTS), recipe, platform),
  };
}

function clearGenerationCatalogCache() {
  catalogCache.clear();
}

module.exports = {
  PLAN_SCHEMA_VERSION,
  clearGenerationCatalogCache,
  createGenerationPlan,
  detectRecipe,
  loadGenerationCatalog,
  normalizeSearchText,
};
