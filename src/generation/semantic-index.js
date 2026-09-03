const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONTEXT_PACKET_SCHEMA_VERSION = 'apollo.generation-context.v1';
const MAX_CONTEXT_PACKET_CHARS = 240000;
const MAX_CONTEXT_DOCUMENT_CHARS = 205000;
const MAX_PATTERN_CANDIDATES = 3;
const MAX_COMPONENT_CANDIDATES = 20;

const BASE_DOCUMENTS = [
  ['AGENTS.md', 'skill'],
  ['docs/AGENT-ROUTER.md', 'skill'],
  ['products/ab/manifest.json', 'guideline'],
  ['skills/design-figma/SKILL.md', 'skill'],
  ['skills/design-figma/01-cookbook/01-index.md', 'skill'],
  ['skills/design-figma/01-cookbook/03-import-instance.md', 'component-recipe'],
  ['skills/design-figma/01-cookbook/04-auto-layout-sizing.md', 'component-recipe'],
  ['skills/design-figma/01-cookbook/05-structural-containers.md', 'component-recipe'],
  ['skills/design-figma/01-cookbook/06-text.md', 'component-recipe'],
  ['skills/design-figma/01-cookbook/07-boolean-text-props.md', 'component-recipe'],
  ['skills/design-figma/01-cookbook/12-surfaces.md', 'token-guideline'],
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
  return Array.from(new Set(candidates))
    .filter((absolutePath) => fs.statSync(absolutePath, { throwIfNoEntry: false })?.isFile())
    .filter((absolutePath) => !/(?:adapter\.code|bridge|figma-keys)/i.test(absolutePath));
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

function buildGenerationContextPacket(request, dsAiHubRoot) {
  const index = buildSemanticIndex(dsAiHubRoot);
  const dialogueText = Array.isArray(request.dialogue)
    ? request.dialogue.map((entry) => entry.text).join('\n')
    : '';
  const requestText = `${dialogueText}\n${request.prompt}`.trim();
  const requestTokens = tokenize(requestText, false);
  const expandedRequestTokens = tokenize(requestText, true);
  const rankedPatterns = rankPatterns(index, requestText, expandedRequestTokens);
  const positivePatterns = rankedPatterns.filter((candidate) => candidate.score > 0);
  const candidatePatterns = positivePatterns.length ? positivePatterns : rankedPatterns;
  const primaryPatternScore = Math.max(0, candidatePatterns[0]?.score || 0);
  const selectedPatterns = candidatePatterns
    .filter((candidate, index) => index === 0 || candidate.score >= primaryPatternScore * 0.65)
    .slice(0, MAX_PATTERN_CANDIDATES)
    .map((candidate) => candidate.entry);
  const rankedComponents = rankComponents(index, requestText, requestTokens, selectedPatterns);
  const selectedComponents = rankedComponents
    .filter((candidate) => candidate.score > 0)
    .slice(0, MAX_COMPONENT_CANDIDATES)
    .map((candidate) => candidate.entry);

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
  });

  const componentDocumentLists = selectedComponents.map((entry) => ({
    entry,
    paths: entry.documentPaths,
  }));
  const maximumDepth = Math.max(0, ...componentDocumentLists.map((item) => item.paths.length));
  for (let depth = 0; depth < maximumDepth; depth += 1) {
    for (const item of componentDocumentLists) {
      const relativePath = item.paths[depth];
      if (!relativePath) continue;
      addPacketDocument(state, index.root, relativePath, sourceRoleForPath(relativePath));
    }
  }

  const packetBase = {
    schemaVersion: CONTEXT_PACKET_SCHEMA_VERSION,
    sourceOfTruth: 'ds-ai-hub',
    policy: {
      documentsNotTruncated: true,
      semanticProjection: true,
      figmaKeysExcluded: true,
      technicalIdentifiersRedacted: true,
      postGenerationVerificationExcluded: true,
    },
    retrieval: {
      queryTokens: Array.from(expandedRequestTokens).sort(),
      patternCandidates: rankedPatterns.slice(0, MAX_PATTERN_CANDIDATES).map((candidate) => ({
        id: candidate.entry.id,
        path: candidate.entry.relativePath,
        score: candidate.score,
      })),
      componentCandidates: rankedComponents.slice(0, MAX_COMPONENT_CANDIDATES).map((candidate) => ({
        id: candidate.entry.id,
        directory: candidate.entry.relativeDirectory,
        score: candidate.score,
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
};
