const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONTEXT_PACKET_SCHEMA_VERSION = 'apollo.generation-context.v3';
const MAX_CONTEXT_PACKET_CHARS = 240000;
const MAX_CONTEXT_TECHNICAL_RESERVE_CHARS = 41000;
const MAX_CONTEXT_DOCUMENT_CHARS =
  MAX_CONTEXT_PACKET_CHARS - MAX_CONTEXT_TECHNICAL_RESERVE_CHARS;
const MAX_PATTERN_CANDIDATES = 3;
const MAX_COMPONENT_CANDIDATES = 20;

const BASE_DOCUMENTS = [
  ['products/ab/manifest.json', 'guideline'],
];

const STOP_WORDS = new Set([
  'and', 'apollo', 'component', 'components', 'design', 'figma', 'layout',
  'mobile', 'mobileweb', 'desktop', 'page', 'screen', 'system', 'web',
  'блок', 'добав', 'десктоп', 'долж', 'ключев', 'мобил',
  'компонент', 'макет', 'мнен', 'нужн', 'основн', 'подготов', 'сдела',
  'собер', 'страниц', 'экран',
]);

const SYNONYM_GROUPS = [
  ['landing', 'promo', 'лендинг', 'промо'],
  ['form', 'application', 'input', 'textarea', 'форм', 'заявк', 'пол'],
  ['benefit', 'advantage', 'преимуществ', 'выгод', 'бенефит'],
  ['feature', 'card', 'особенност', 'карточк', 'контент'],
  ['faq', 'question', 'answer', 'вопрос', 'ответ'],
  ['feedback', 'review', 'rating', 'comment', 'voc', 'отзыв', 'оценк', 'коммент', 'обратн', 'связ'],
  ['table', 'grid', 'таблиц', 'реестр'],
  ['list', 'список', 'перечен'],
  ['button', 'action', 'кнопк', 'действ'],
  ['select', 'dropdown', 'селект', 'выпада'],
  ['title', 'heading', 'заголов'],
];

let semanticIndexCache = null;

function createIndexError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = details;
  return error;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemToken(token) {
  if (/^[a-z]+$/i.test(token)) {
    return token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token;
  }
  if (token.length <= 4) return token;
  return token.replace(
    /(?:иями|ями|ами|ого|ему|ому|ыми|ими|ий|ый|ая|яя|ое|ее|ые|ие|ую|юю|ов|ев|ам|ям|ах|ях|ом|ем|ы|и|а|я|о|е|у|ю)$/u,
    '',
  );
}

function baseTokens(value) {
  return normalizeText(value)
    .split(' ')
    .map(stemToken)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

const NORMALIZED_SYNONYM_GROUPS = SYNONYM_GROUPS.map((group) =>
  Array.from(new Set(group.flatMap(baseTokens)))
);

function tokenize(value, expandSynonyms = false) {
  const tokens = new Set(baseTokens(value));
  if (expandSynonyms) {
    for (const group of NORMALIZED_SYNONYM_GROUPS) {
      if (group.some((token) => tokens.has(token))) {
        for (const token of group) tokens.add(token);
      }
    }
  }
  return tokens;
}

function readUtf8(absolutePath) {
  return fs.readFileSync(absolutePath, 'utf8');
}

function fileChecksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function extractRuleIds(content) {
  return Array.from(
    new Set(
      Array.from(content.matchAll(/(?:^|\n)-?\s*ruleId:\s*([^\s\n]+)/gi))
        .map((match) => match[1].trim()),
    ),
  );
}

function createSemanticProjection(content) {
  return content
    .replace(/https:\/\/(?:www\.)?figma\.com\/[^\s)\]}>"']+/gi, '[FIGMA_URL_REDACTED]')
    .replace(/\b[a-f0-9]{40}\b/gi, '[FIGMA_KEY_REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{18,32}\b(?=\s*(?:["'`,]|$))/g, (value) =>
      /[A-Za-z]/.test(value) && /\d/.test(value) ? '[FIGMA_FILE_KEY_REDACTED]' : value
    )
    .replace(/\b\d{1,9}:\d{1,9}\b/g, '[FIGMA_NODE_ID_REDACTED]');
}

function safeReadJson(absolutePath) {
  try {
    return JSON.parse(readUtf8(absolutePath));
  } catch (_error) {
    return null;
  }
}

function listFiles(directory, predicate) {
  const stat = fs.statSync(directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function collectComponentDocumentPaths(componentDirectory) {
  const candidates = [
    'meta.json',
    'generation.json',
    'cookbook.md',
    'figma/cookbook.md',
  ].map((relativePath) => path.join(componentDirectory, relativePath));
  const cookbookDirectories = [
    path.join(componentDirectory, 'cookbook'),
    path.join(componentDirectory, 'figma', 'cookbook'),
  ];
  for (const cookbookDirectory of cookbookDirectories) {
    candidates.push(...listFiles(
      cookbookDirectory,
      (name) => name.endsWith('.md') && !/(?:verify|check)/i.test(name),
    ));
  }
  candidates.push(...[
    'guidelines.md',
    'instructions.md',
    'adapter.figma.md',
    'figma/adapter.md',
  ].map((relativePath) => path.join(componentDirectory, relativePath)));
  const documentPriority = (absolutePath) => {
    const relativePath = path.relative(componentDirectory, absolutePath);
    if (relativePath === 'meta.json') return 0;
    if (relativePath === 'generation.json') return 1;
    if (relativePath === 'instructions.md' || relativePath === 'guidelines.md') return 2;
    if (/(?:^|\/)adapter(?:\.figma)?\.md$/.test(relativePath)) return 3;
    if (/(?:^|\/)cookbook(?:\.md|\/01-overview\.md)$/.test(relativePath)) return 4;
    return 5;
  };
  return Array.from(new Set(candidates))
    .filter((absolutePath) => fs.statSync(absolutePath, { throwIfNoEntry: false })?.isFile())
    .filter((absolutePath) => !/(?:adapter\.code|bridge|figma-keys)/i.test(absolutePath))
    .sort((left, right) =>
      documentPriority(left) - documentPriority(right) || left.localeCompare(right, 'en')
    );
}

function extractRequestedCount(text, nounPattern) {
  const match = normalizeText(text).match(new RegExp(`(?:^|\\s)(\\d{1,2})\\s+(?:${nounPattern})`, 'u'));
  return match ? Number(match[1]) : null;
}

function extractPrimaryAction(text) {
  const patterns = [
    /(?:ключевое|главное|основное)\s+действие[^—–:\n]*[—–:]\s*[«"']?([^»"'\n.,;]{2,80})/iu,
    /(?:текст|название)\s+(?:главной\s+)?кнопки[^—–:\n]*[—–:]\s*[«"']?([^»"'\n.,;]{2,80})/iu,
  ];
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractGenerationIntent(requestText) {
  const normalized = normalizeText(requestText);
  const isLanding = /(?:лендинг|landing|промо\s+страниц)/u.test(normalized);
  const asksForForm = /(?:форм|обратн[\p{L}]*\s+связ|feedback\s+form|review\s+form)/u.test(normalized);
  const explicitlyModal = /(?:модаль|модальн|modal|popup|попап|voc)/u.test(normalized);
  return {
    schemaVersion: 'apollo.generation-intent.v1',
    kind: isLanding ? 'landing' : asksForForm ? 'form' : 'unknown',
    platform: /(?:mobile\s+web|мобил[\p{L}]*\s+(?:веб[\p{L}]*|web))/u.test(normalized)
      ? 'mobile-web'
      : /(?:desktop|десктоп)/u.test(normalized) ? 'desktop' : null,
    primaryAction: extractPrimaryAction(requestText),
    requirements: {
      benefits: extractRequestedCount(requestText, '(?:основ[\\p{L}]*\\s+)?преимуществ[\\p{L}]*|benefit[a-z]*'),
      featureCards: extractRequestedCount(requestText, 'карточ[\\p{L}]*(?:\\s+с\\s+ключев[\\p{L}]+\\s+особенност[\\p{L}]*)?|feature[a-z]*'),
      faq: /(?:част[\p{L}]*\s+вопрос|блок\s+с\s+вопрос|faq)/u.test(normalized),
      form: asksForForm,
      formPresentation: asksForForm ? (explicitlyModal ? 'modal' : 'inline') : null,
    },
  };
}

function requiredComponentIds(intent) {
  const ids = [];
  if (intent.kind === 'landing') {
    ids.push('PromoMainBlock', 'CorporateContent', 'Benefits', 'PromoCard', 'FAQ');
    if (intent.requirements.benefits) ids.push('BenefitCard');
    if (intent.platform === 'mobile-web') ids.push('ButtonStack');
  }
  if (intent.requirements.form) {
    if (intent.requirements.formPresentation === 'modal') {
      ids.push('VOC');
    } else {
      if (intent.kind !== 'landing') ids.push('ContentCardWrapper');
      ids.push('TitleView', 'Input', 'Button');
    }
  }
  return Array.from(new Set(ids));
}

function patternMetadata(content, relativePath) {
  const id = content.match(/(?:^|\n)(?:id|- patternId):\s*([^\n]+)/i)?.[1]?.trim() ||
    `ptrn:${path.basename(relativePath, '.md')}`;
  const title = content.match(/^#\s+Pattern:\s*(.+)$/im)?.[1]?.trim() ||
    path.basename(relativePath, '.md');
  const tags = content.match(/(?:^|\n)- tags:\s*([^\n]+)/i)?.[1] || '';
  return { id, title, tags };
}

function createPatternEntry(root, absolutePath) {
  const relativePath = path.relative(root, absolutePath);
  const content = readUtf8(absolutePath);
  const metadata = patternMetadata(content, relativePath);
  const identityText = `${relativePath} ${metadata.id} ${metadata.title} ${metadata.tags}`;
  return {
    type: 'pattern',
    id: metadata.id,
    title: metadata.title,
    relativePath,
    content,
    identity: normalizeText(identityText),
    identityTokens: tokenize(identityText),
    contentTokens: tokenize(content),
    generationPath: (() => {
      const candidate = absolutePath.replace(/\.md$/i, '.generation.json');
      return fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()
        ? path.relative(root, candidate)
        : null;
    })(),
  };
}

function createComponentEntry(root, componentDirectory) {
  const metaPath = path.join(componentDirectory, 'meta.json');
  const metadata = safeReadJson(metaPath);
  if (!metadata || typeof metadata !== 'object') return null;
  const relativeDirectory = path.relative(root, componentDirectory);
  const id = String(metadata.id || metadata.name || path.basename(componentDirectory));
  const referenceAliases = [
    id,
    metadata.folder,
    ...(Array.isArray(metadata.publicComponentRoots) ? metadata.publicComponentRoots : []),
    ...(Array.isArray(metadata.recommendedComponentRoots) ? metadata.recommendedComponentRoots : []),
  ].filter((value) => typeof value === 'string' && value.trim());
  const aliases = [
    ...referenceAliases,
    ...(Array.isArray(metadata.keywords) ? metadata.keywords : []),
  ];
  const identityText = `${relativeDirectory} ${aliases.join(' ')}`;
  return {
    type: 'component',
    id,
    relativeDirectory,
    aliases,
    normalizedAliases: aliases.map(normalizeText).filter((value) => value.length >= 3),
    normalizedReferenceAliases: referenceAliases
      .map(normalizeText)
      .filter((value) => value.length >= 3),
    identity: normalizeText(identityText),
    identityTokens: tokenize(identityText),
    documentPaths: collectComponentDocumentPaths(componentDirectory)
      .map((absolutePath) => path.relative(root, absolutePath)),
  };
}

function componentDirectories(root, baseDirectory) {
  const absoluteBase = path.join(root, baseDirectory);
  const stat = fs.statSync(absoluteBase, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return [];
  return fs.readdirSync(absoluteBase, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(absoluteBase, entry.name))
    .filter((directory) => fs.statSync(path.join(directory, 'meta.json'), { throwIfNoEntry: false })?.isFile())
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function buildSemanticIndex(dsAiHubRoot) {
  const root = path.resolve(dsAiHubRoot);
  if (semanticIndexCache?.root === root) return semanticIndexCache.index;
  const stat = fs.statSync(root, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) {
    throw createIndexError(
      `ds-ai-hub недоступен для semantic index: ${root}`,
      'GENERATION_SEMANTIC_INDEX_MISSING',
    );
  }
  const patterns = listFiles(
    path.join(root, 'products', 'ab', 'patterns'),
    (name) => name.endsWith('.md'),
  ).map((absolutePath) => createPatternEntry(root, absolutePath));
  const components = [
    ...componentDirectories(root, 'products/ab/components'),
    ...componentDirectories(root, 'core/web/components'),
  ].map((directory) => createComponentEntry(root, directory)).filter(Boolean);
  if (!patterns.length || !components.length) {
    throw createIndexError(
      'Semantic index не нашёл паттерны или компоненты ds-ai-hub.',
      'GENERATION_SEMANTIC_INDEX_EMPTY',
      { patternCount: patterns.length, componentCount: components.length },
    );
  }
  const index = {
    root,
    patterns,
    components,
    builtFrom: ['products/ab/patterns', 'products/ab/components/*/meta.json', 'core/web/components/*/meta.json'],
  };
  semanticIndexCache = { root, index };
  return index;
}

function overlapScore(leftTokens, rightTokens, weight) {
  let score = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) score += weight;
  }
  return score;
}

function containsNormalizedPhrase(haystack, needle) {
  if (!needle || baseTokens(needle).length === 0) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function semanticGroupScore(requestTokens, entryTokens, groupFrequencies) {
  let score = 0;
  NORMALIZED_SYNONYM_GROUPS.forEach((group, index) => {
    if (
      group.some((token) => requestTokens.has(token)) &&
      group.some((token) => entryTokens.has(token))
    ) {
      const frequency = Math.max(1, groupFrequencies[index] || 1);
      score += 30 + Math.round(90 / Math.sqrt(frequency));
    }
  });
  return score;
}

function rankPatterns(index, requestText, requestTokens) {
  const normalizedRequest = normalizeText(requestText);
  return index.patterns.map((entry) => {
    let score = overlapScore(requestTokens, entry.identityTokens, 16);
    score += overlapScore(requestTokens, entry.contentTokens, 2);
    if (entry.identity && normalizedRequest.includes(entry.identity)) score += 120;
    return { entry, score };
  }).sort((left, right) =>
    right.score - left.score || left.entry.relativePath.localeCompare(right.entry.relativePath, 'en')
  );
}

function rankComponents(index, requestText, requestTokens, selectedPatterns) {
  const normalizedRequest = normalizeText(requestText);
  const primaryPatternText = normalizeText(selectedPatterns[0]?.content || '');
  const groupFrequencies = NORMALIZED_SYNONYM_GROUPS.map((group) =>
    index.components.filter((entry) =>
      group.some((token) => entry.identityTokens.has(token))
    ).length
  );
  return index.components.map((entry) => {
    let score = overlapScore(requestTokens, entry.identityTokens, 50);
    score += semanticGroupScore(requestTokens, entry.identityTokens, groupFrequencies);
    if (entry.normalizedAliases.some((alias) =>
      alias.length >= 4 && containsNormalizedPhrase(normalizedRequest, alias)
    )) {
      score += 120;
    }
    if (entry.normalizedReferenceAliases.some((alias) =>
      alias.length >= 4 && containsNormalizedPhrase(primaryPatternText, alias)
    )) {
      score += 100;
    }
    return { entry, score };
  }).sort((left, right) =>
    right.score - left.score || left.entry.relativeDirectory.localeCompare(right.entry.relativeDirectory, 'en')
  );
}

function sourceRoleForPath(relativePath) {
  if (relativePath.endsWith('/generation.json') || relativePath.endsWith('.generation.json')) {
    return 'generation-contract';
  }
  if (relativePath.includes('/patterns/')) return 'pattern';
  if (relativePath.endsWith('meta.json') || /(?:guidelines|instructions)\.md$/.test(relativePath)) {
    return 'guideline';
  }
  if (relativePath.includes('skills/')) return 'skill';
  return 'component-recipe';
}

function addPacketDocument(state, root, relativePath, role, required = false) {
  if (state.paths.has(relativePath)) return true;
  const absolutePath = path.resolve(root, relativePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) return false;
  const stat = fs.statSync(absolutePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    if (required) {
      throw createIndexError(
        `Обязательный источник context packet отсутствует: ${relativePath}`,
        'GENERATION_CONTEXT_SOURCE_MISSING',
      );
    }
    return false;
  }
  const sourceContent = readUtf8(absolutePath);
  const content = createSemanticProjection(sourceContent);
  const estimatedSize = JSON.stringify(content).length + relativePath.length + 320;
  if (!required && state.estimatedSize + estimatedSize > MAX_CONTEXT_DOCUMENT_CHARS) {
    return false;
  }
  state.paths.add(relativePath);
  state.estimatedSize += estimatedSize;
  state.documents.push({
    path: relativePath,
    role,
    ruleIds: extractRuleIds(sourceContent),
    sourceChecksum: fileChecksum(sourceContent),
    projectionChecksum: fileChecksum(content),
    content,
  });
  return true;
}

function buildGenerationContextPacket(request, dsAiHubRoot, options = {}) {
  const index = buildSemanticIndex(dsAiHubRoot);
  const dialogueText = Array.isArray(request.dialogue)
    ? request.dialogue.map((entry) => entry.text).join('\n')
    : '';
  const requestText = `${request.brief || ''}\n${dialogueText}\n${request.prompt}`.trim();
  const requestTokens = tokenize(requestText, false);
  const expandedRequestTokens = tokenize(requestText, true);
  const intent = extractGenerationIntent(requestText);
  const rankedPatterns = rankPatterns(index, requestText, expandedRequestTokens);
  const positivePatterns = rankedPatterns.filter((candidate) => candidate.score > 0);
  const candidatePatterns = positivePatterns.length ? positivePatterns : rankedPatterns;
  const primaryPatternScore = Math.max(0, candidatePatterns[0]?.score || 0);
  let selectedPatterns = candidatePatterns
    .filter((candidate, index) => index === 0 || candidate.score >= primaryPatternScore * 0.65)
    .slice(0, MAX_PATTERN_CANDIDATES)
    .map((candidate) => candidate.entry);
  if (intent.kind === 'landing') {
    const requiredPatternIds = ['ptrn:landing-pages.alfa-business'];
    selectedPatterns = requiredPatternIds
      .map((patternId) => index.patterns.find((entry) => entry.id === patternId))
      .filter(Boolean);
  }
  const rankedComponents = rankComponents(index, requestText, requestTokens, selectedPatterns);
  const requiredIds = requiredComponentIds(intent);
  const requiredComponents = requiredIds.map((componentId) =>
    index.components.find((entry) => entry.id === componentId)
  ).filter(Boolean);
  const selectedComponents = Array.from(new Map([
    ...requiredComponents.map((entry) => [entry.id, entry]),
    ...rankedComponents
    .filter((candidate) => candidate.score > 0)
    .slice(0, MAX_COMPONENT_CANDIDATES)
    .filter((candidate) => !(
      candidate.entry.id === 'VOC' && intent.requirements.formPresentation === 'inline'
    ))
    .map((candidate) => [candidate.entry.id, candidate.entry]),
  ]).values()).slice(0, MAX_COMPONENT_CANDIDATES);

  const technicalAvailability = options.technicalAvailability || {};
  const isTechnicallyAvailable = (componentId) => {
    const capability = technicalAvailability[componentId];
    if (typeof capability === 'boolean') return capability;
    return capability?.available !== false;
  };
  const projectedTechnicalContracts = (entry) => {
    if (!requiredIds.includes(entry.id)) return [];
    const capability = technicalAvailability[entry.id];
    if (!capability || typeof capability !== 'object') return [];
    return (capability.contracts || [])
      .filter((contract) =>
        !intent.platform || contract.platform === intent.platform || contract.platform === 'universal'
      )
      .slice(0, 4)
      .map((contract) => ({
        ...contract,
        textTargets: (contract.textTargets || []).slice(0, 8),
        slotTargets: (contract.slotTargets || []).slice(0, 4),
      }));
  };
  const state = { documents: [], paths: new Set(), estimatedSize: 0 };
  for (const [relativePath, role] of BASE_DOCUMENTS) {
    addPacketDocument(state, index.root, relativePath, role, true);
  }
  selectedPatterns.forEach((entry, indexPosition) => {
    addPacketDocument(
      state,
      index.root,
      entry.relativePath,
      'pattern',
      indexPosition === 0,
    );
    if (entry.generationPath) {
      addPacketDocument(
        state,
        index.root,
        entry.generationPath,
        'generation-contract',
        indexPosition === 0,
      );
    }
  });

  const componentDocumentLists = selectedComponents
    .filter((entry) => isTechnicallyAvailable(entry.id))
    .map((entry) => ({
    entry,
    paths: entry.documentPaths,
    required: requiredIds.includes(entry.id),
    hasSemanticTargets: projectedTechnicalContracts(entry).some((contract) =>
      (contract.semanticTargetProfiles || []).length > 0
    ),
    }));
  const requiredLists = componentDocumentLists.filter((item) => item.required);
  const optionalLists = componentDocumentLists.filter((item) => !item.required);
  const addComponentDocuments = (lists, required) => {
    for (const item of lists) {
      const orderedPaths = item.paths.slice().sort((left, right) => {
        const priority = (relativePath) => {
          if (relativePath.endsWith('/meta.json')) return 0;
          if (relativePath.endsWith('/generation.json')) return 1;
          if (/(?:instructions|guidelines)\.md$/.test(relativePath)) return 2;
          if (/(?:^|\/)adapter(?:\.figma)?\.md$/.test(relativePath)) return 3;
          return 4;
        };
        return priority(left) - priority(right) || left.localeCompare(right, 'en');
      });
      const hasGenerationContract = orderedPaths.some((relativePath) =>
        relativePath.endsWith('/generation.json')
      );
      const documentLimit = required
        ? hasGenerationContract || !item.hasSemanticTargets ? 3 : 2
        : 2;
      for (const relativePath of orderedPaths.slice(0, documentLimit)) {
        const isRequiredDocument = required && (
          relativePath.endsWith('/meta.json') || relativePath.endsWith('/generation.json')
        );
        addPacketDocument(
          state,
          index.root,
          relativePath,
          sourceRoleForPath(relativePath),
          isRequiredDocument,
        );
      }
    }
  };
  addComponentDocuments(requiredLists, true);
  if (intent.kind === 'unknown') {
    addComponentDocuments(optionalLists, false);
  }

  const packetBase = {
    schemaVersion: CONTEXT_PACKET_SCHEMA_VERSION,
    sourceOfTruth: 'ds-ai-hub',
    policy: {
      documentsNotTruncated: true,
      semanticProjection: true,
      figmaKeysExcluded: true,
      technicalIdentifiersRedacted: true,
      technicalCapabilityProjection: true,
      semanticTargetProjection: true,
      generationContractsIncluded: true,
      postGenerationVerificationExcluded: true,
    },
    retrieval: {
      intent,
      requiredComponentIds: requiredIds,
      queryTokens: Array.from(expandedRequestTokens).sort(),
      patternCandidates: selectedPatterns.map((entry) => ({
        id: entry.id,
        path: entry.relativePath,
        score: rankedPatterns.find((candidate) => candidate.entry.id === entry.id)?.score || 0,
      })),
      componentCandidates: selectedComponents.map((entry) => ({
        id: entry.id,
        directory: entry.relativeDirectory,
        score: rankedComponents.find((candidate) => candidate.entry.id === entry.id)?.score || 0,
        required: requiredIds.includes(entry.id),
        technicalAvailable: isTechnicallyAvailable(entry.id),
        technicalContracts: projectedTechnicalContracts(entry),
      })),
    },
    documents: state.documents,
  };
  let serialized = JSON.stringify(packetBase, null, 2);
  if (serialized.length > MAX_CONTEXT_PACKET_CHARS) {
    throw createIndexError(
      `Context packet превышает лимит ${MAX_CONTEXT_PACKET_CHARS} символов.`,
      'GENERATION_CONTEXT_PACKET_TOO_LARGE',
      { actualChars: serialized.length, documentCount: state.documents.length },
    );
  }
  const packetChecksum = fileChecksum(serialized);
  const packet = { ...packetBase, packetChecksum };
  serialized = JSON.stringify(packet, null, 2);
  if (serialized.length > MAX_CONTEXT_PACKET_CHARS) {
    throw createIndexError(
      `Context packet превышает лимит ${MAX_CONTEXT_PACKET_CHARS} символов.`,
      'GENERATION_CONTEXT_PACKET_TOO_LARGE',
      { actualChars: serialized.length, documentCount: state.documents.length },
    );
  }
  return {
    packet,
    serialized,
    allowedSourcePaths: state.documents.map((document) => document.path),
    trace: {
      schemaVersion: CONTEXT_PACKET_SCHEMA_VERSION,
      packetChecksum,
      documentCount: state.documents.length,
      packetChars: serialized.length,
      patternIds: selectedPatterns.map((entry) => entry.id),
      componentIds: selectedComponents.map((entry) => entry.id),
      intent,
    },
  };
}

function inspectSemanticIndex(dsAiHubRoot) {
  const index = buildSemanticIndex(dsAiHubRoot);
  return {
    ready: true,
    mode: 'semantic-index-context-packet',
    patternCount: index.patterns.length,
    componentCount: index.components.length,
    maxPacketChars: MAX_CONTEXT_PACKET_CHARS,
  };
}

function clearSemanticIndexCache() {
  semanticIndexCache = null;
}

module.exports = {
  CONTEXT_PACKET_SCHEMA_VERSION,
  MAX_COMPONENT_CANDIDATES,
  MAX_CONTEXT_PACKET_CHARS,
  MAX_PATTERN_CANDIDATES,
  buildGenerationContextPacket,
  buildSemanticIndex,
  clearSemanticIndexCache,
  inspectSemanticIndex,
  normalizeText,
  tokenize,
  extractGenerationIntent,
};
