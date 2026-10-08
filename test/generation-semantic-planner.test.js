const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildGenerationAgentPrompt,
  normalizeGenerationDialogue,
  normalizeGenerationRequest,
  validateSemanticGenerationResponse,
} = require('../src/generation/semantic-planner');

function readyResponse() {
  return {
    schemaVersion: 'apollo.semantic-generation.v3',
    status: 'ready',
    title: 'Форма',
    summary: 'Форма по правилам ds-ai-hub.',
    kind: 'pattern',
    recipe: null,
    platform: 'desktop',
    primaryPattern: {
      id: 'ptrn:forms.construction-rules',
      sourcePath: 'products/ab/patterns/form-construction-rules.md',
      ruleIds: ['rule:forms.layout-8-4'],
    },
    sources: [{
      path: 'products/ab/patterns/form-construction-rules.md',
      role: 'pattern',
      purpose: 'Структура формы',
      ruleIds: ['rule:forms.layout-8-4'],
    }],
    clarification: null,
    blocked: null,
    nodes: [
      {
        id: 'screen',
        type: 'frame',
        parentId: null,
        name: 'Форма',
        semanticRole: 'screen',
        semanticComponentId: null,
        placement: 'append',
        parentPath: null,
        width: 1200,
        minHeight: 800,
        layout: 'vertical',
        gap: 24,
        padding: 32,
        fillRole: 'base-alt',
        cornerRadius: 0,
        componentQuery: null,
        variantProperties: [],
        textOverrides: [],
      },
      {
        id: 'title',
        type: 'component',
        parentId: 'screen',
        name: 'Заголовок',
        semanticRole: 'content',
        semanticComponentId: 'TitleView',
        placement: 'append',
        parentPath: null,
        width: 'fill',
        minHeight: null,
        layout: null,
        gap: null,
        padding: null,
        fillRole: null,
        cornerRadius: null,
        componentQuery: '[D] TitleView',
        variantProperties: [],
        textOverrides: [],
      },
    ],
  };
}

test('normalizes a bounded generation dialogue', () => {
  const dialogue = normalizeGenerationDialogue([
    { role: 'assistant', text: '  Что должно быть в форме?  ' },
    { role: 'user', text: 'Контактные данные' },
  ]);
  assert.deepEqual(dialogue, [
    { role: 'assistant', text: 'Что должно быть в форме?' },
    { role: 'user', text: 'Контактные данные' },
  ]);
});

test('preserves the original user brief when the dialogue exceeds the recent window', () => {
  const dialogue = normalizeGenerationDialogue([
    { role: 'user', text: 'Исходный бриф: CTA — Оставить отзыв' },
    ...Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 ? 'user' : 'assistant',
      text: `Реплика ${index + 1}`,
    })),
  ]);
  assert.equal(dialogue.length, 16);
  assert.equal(dialogue[0].text, 'Исходный бриф: CTA — Оставить отзыв');
  assert.equal(dialogue.at(-1).text, 'Реплика 24');
});

test('generation prompt makes ds-ai-hub semantic and keeps keys outside the agent', () => {
  const request = normalizeGenerationRequest({
    prompt: 'Собери форму',
    dialogue: [{ role: 'assistant', text: 'Какие поля нужны?' }],
  });
  const prompt = buildGenerationAgentPrompt(request, 'context-packet.json', {
    documentCount: 12,
    packetChars: 42000,
    packetChecksum: 'a'.repeat(64),
  });
  assert.match(prompt, /Единственный источник истины.*ds-ai-hub/);
  assert.match(prompt, /Context packet: context-packet\.json/);
  assert.match(prompt, /полная без обрезки семантическая проекция/);
  assert.match(prompt, /не читай другие пути/);
  assert.match(prompt, /не вызывай rg, find или git/i);
  assert.match(prompt, /Не ищи и не указывай Figma component keys/);
  assert.match(prompt, /Технические ключи.*design-system_ab/);
  assert.match(prompt, /Никогда не спрашивай у пользователя component name, key, cookbook/);
  assert.match(prompt, /publicComponentRoot/);
  assert.match(prompt, /placement=replace-slot/);
  assert.match(prompt, /technicalContracts.*исполнимый технический API/);
  assert.match(prompt, /semanticTargetProfiles/);
  assert.match(prompt, /ordered targets items\.N/);
  assert.match(prompt, /ruleIds можно только дословно копировать/);
  assert.match(prompt, /clarification_required/);
  assert.match(prompt, /<original_brief>/);
  assert.match(prompt, /Исходный бриф неизменяем/);
  assert.match(prompt, /status=blocked/);
  assert.match(prompt, /Какие поля нужны/);
});

test('accepts a clarification response as a first-class outcome', () => {
  const response = {
    schemaVersion: 'apollo.semantic-generation.v3',
    status: 'clarification_required',
    title: 'Нужно уточнение',
    summary: 'Недостаточно данных о составе формы.',
    kind: null,
    recipe: null,
    platform: null,
    primaryPattern: null,
    sources: [],
    clarification: {
      question: 'Какие поля нужны?',
      reason: 'Состав полей определяет структуру формы.',
      suggestedAnswers: ['Контакты', 'Реквизиты'],
    },
    blocked: null,
    nodes: [],
  };
  assert.equal(
    validateSemanticGenerationResponse(response).status,
    'clarification_required',
  );
});

test('normalizes neutral nullable frame fields without guessing component data', () => {
  const response = readyResponse();
  response.nodes[0].layout = null;
  response.nodes[0].gap = null;
  response.nodes[0].padding = null;
  response.nodes[0].fillRole = null;
  response.nodes[0].cornerRadius = null;
  const result = validateSemanticGenerationResponse(response);
  assert.equal(result.nodes[0].layout, 'vertical');
  assert.equal(result.nodes[0].gap, 0);
  assert.equal(result.nodes[0].padding, 0);
  assert.equal(result.nodes[0].fillRole, 'none');
  assert.equal(result.nodes[0].cornerRadius, 0);
});

test('rejects a clarification response that also mutates the canvas', () => {
  const response = {
    schemaVersion: 'apollo.semantic-generation.v3',
    status: 'clarification_required',
    title: 'Нужно уточнение',
    summary: 'Недостаточно данных.',
    kind: null,
    recipe: null,
    platform: null,
    primaryPattern: null,
    sources: [],
    clarification: {
      question: 'Какие поля нужны?',
      reason: 'Нужен состав.',
      suggestedAnswers: [],
    },
    blocked: null,
    nodes: [{ id: 'screen', type: 'script', source: 'figma.currentPage.remove()' }],
  };
  assert.throws(
    () => validateSemanticGenerationResponse(response),
    /некорректный запрос уточнения/,
  );
});

test('accepts a terminal blocked response without canvas nodes', () => {
  const response = {
    schemaVersion: 'apollo.semantic-generation.v3',
    status: 'blocked',
    title: 'Генерация остановлена',
    summary: 'Не хватает исполнимой возможности.',
    kind: null,
    recipe: null,
    platform: null,
    primaryPattern: null,
    sources: [],
    clarification: null,
    blocked: {
      code: 'GENERATION_CAPABILITY_MISSING',
      message: 'Этот блок пока нельзя собрать.',
      reason: 'Нет semantic target.',
      missingCapabilities: ['content.image'],
    },
    nodes: [],
  };
  assert.equal(validateSemanticGenerationResponse(response).status, 'blocked');
});
