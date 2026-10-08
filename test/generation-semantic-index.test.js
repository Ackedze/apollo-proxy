const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_CONTEXT_PACKET_CHARS,
  buildGenerationContextPacket,
  buildSemanticIndex,
  clearSemanticIndexCache,
  extractGenerationIntent,
  inspectSemanticIndex,
} = require('../src/generation/semantic-index');
const {
  inspectGenerationComponentAvailability,
} = require('../src/generation/planner');

const HUB_ROOT = path.resolve(__dirname, '../../../ds-ai-hub');
const DESIGN_SYSTEM_ROOT = path.resolve(
  __dirname,
  '../../../shared/design-system_ab',
);

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function componentIds(packet) {
  return packet.retrieval.componentCandidates.map((candidate) => candidate.id);
}

test.afterEach(() => clearSemanticIndexCache());

test('does not infer a form only from the wording of the primary action', () => {
  const intent = extractGenerationIntent(
    'Лендинг для mobile web. Ключевое действие — Оставить отзыв',
  );
  assert.equal(intent.primaryAction, 'Оставить отзыв');
  assert.equal(intent.requirements.form, false);
});

test('indexes the current ds-ai-hub and builds a bounded landing context packet', () => {
  const request = {
    prompt: 'подготовь мне лендинг для мобильного веба. 3 основных преимущества, 5 карточек с ключевыми особенностями, блок с вопросами и форма обратной связи. ключевое действие на странице — Оставить отзыв',
    dialogue: [],
  };
  const result = buildGenerationContextPacket(request, HUB_ROOT);
  const summary = inspectSemanticIndex(HUB_ROOT);

  assert.equal(summary.mode, 'semantic-index-context-packet');
  assert.equal(result.packet.schemaVersion, 'apollo.generation-context.v3');
  assert.ok(summary.patternCount >= 30);
  assert.ok(summary.componentCount >= 80);
  assert.ok(result.serialized.length <= MAX_CONTEXT_PACKET_CHARS);
  assert.equal(
    result.packet.retrieval.patternCandidates[0].id,
    'ptrn:landing-pages.alfa-business',
  );
  for (const expected of [
    'PromoMainBlock', 'CorporateContent', 'ButtonStack', 'Benefits',
    'PromoCard', 'FAQ', 'TitleView', 'Input', 'Button',
  ]) {
    assert.ok(componentIds(result.packet).includes(expected), `missing ${expected}`);
  }
  assert.ok(!componentIds(result.packet).includes('VOC'), 'inline feedback must not retrieve modal VOC');
  assert.equal(result.packet.retrieval.intent.primaryAction, 'Оставить отзыв');
  assert.equal(result.packet.retrieval.intent.requirements.benefits, 3);
  assert.equal(result.packet.retrieval.intent.requirements.featureCards, 5);
  for (const expectedPath of [
    'products/ab/patterns/landing-pages.generation.json',
    'products/ab/components/promo-main-block/generation.json',
    'products/ab/components/corporate-content/adapter.figma.md',
    'products/ab/components/button-stack/adapter.figma.md',
    'products/ab/components/benefits/generation.json',
    'products/ab/components/benefit-card/generation.json',
    'products/ab/components/faq/generation.json',
  ]) {
    assert.ok(result.allowedSourcePaths.includes(expectedPath), `missing ${expectedPath}`);
  }
  assert.deepEqual(
    result.allowedSourcePaths,
    result.packet.documents.map((document) => document.path),
  );
  assert.equal(result.packet.policy.documentsNotTruncated, true);
  assert.equal(result.packet.policy.figmaKeysExcluded, true);
  assert.equal(result.packet.policy.generationContractsIncluded, true);
  assert.ok(result.allowedSourcePaths.includes('products/ab/components/faq/meta.json'));
  assert.ok(result.allowedSourcePaths.includes('products/ab/components/faq/instructions.md'));
});

test('landing context stays bounded after semantic target capability projection', () => {
  const index = buildSemanticIndex(HUB_ROOT);
  const technicalAvailability = inspectGenerationComponentAvailability(
    DESIGN_SYSTEM_ROOT,
    index.components.map((component) => component.id),
  );
  const result = buildGenerationContextPacket({
    prompt: 'Подготовь лендинг для десктопного веба. 3 преимущества, 5 карточек, FAQ и форма обратной связи. Главное действие — Оставить отзыв',
    dialogue: [],
  }, HUB_ROOT, { technicalAvailability });

  assert.ok(result.serialized.length <= MAX_CONTEXT_PACKET_CHARS);
  assert.ok(result.allowedSourcePaths.includes(
    'products/ab/components/benefit-card/generation.json',
  ));
  assert.ok(result.packet.retrieval.componentCandidates.some((candidate) =>
    candidate.technicalContracts.some((contract) =>
      contract.semanticTargetProfiles.length > 0
    )
  ));
});

test('uses form semantics and the full dialogue to retrieve form components', () => {
  const result = buildGenerationContextPacket({
    prompt: 'Продолжай генерацию',
    dialogue: [
      { role: 'user', text: 'Собери форму обратной связи' },
      { role: 'assistant', text: 'Какие данные должен отправить пользователь?' },
      { role: 'user', text: 'Оценку и комментарий, главное действие — Отправить' },
    ],
  }, HUB_ROOT);

  assert.equal(result.trace.patternIds[0], 'ptrn:forms.construction-rules');
  for (const expected of ['Textarea', 'Input', 'Button', 'ContentCardWrapper', 'TitleView']) {
    assert.ok(componentIds(result.packet).includes(expected), `missing ${expected}`);
  }
  assert.ok(!componentIds(result.packet).includes('VOC'));
});

test('packet documents are complete semantic projections without Figma identifiers', () => {
  const result = buildGenerationContextPacket({
    prompt: 'Собери форму обратной связи с оценкой, комментарием и кнопкой Отправить',
    dialogue: [],
  }, HUB_ROOT);
  const technicalIdentifier = /https:\/\/(?:www\.)?figma\.com\/|\b[a-f0-9]{40}\b|\b\d{1,9}:\d{1,9}\b/gi;

  for (const document of result.packet.documents) {
    assert.ok(!/(?:adapter\.code|bridge|figma-keys|(?:verify|check)\.md)/i.test(document.path));
    const sourceContent = fs.readFileSync(path.join(HUB_ROOT, document.path), 'utf8');
    assert.equal(document.sourceChecksum, checksum(sourceContent));
    assert.equal(document.projectionChecksum, checksum(document.content));
    assert.ok(document.ruleIds.every((ruleId) => sourceContent.includes(`ruleId: ${ruleId}`)));
    assert.doesNotMatch(document.content, technicalIdentifier);
  }
});
