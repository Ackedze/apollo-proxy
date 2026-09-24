const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_CONTEXT_PACKET_CHARS,
  buildGenerationContextPacket,
  clearSemanticIndexCache,
  inspectSemanticIndex,
} = require('../src/generation/semantic-index');

const HUB_ROOT = path.resolve(
  process.env.DS_AI_HUB_ROOT
    || process.env.CODEX_DS_AI_HUB
    || path.resolve(__dirname, '../../../ds-ai-hub'),
);

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function componentIds(packet) {
  return packet.retrieval.componentCandidates.map((candidate) => candidate.id);
}

test.afterEach(() => clearSemanticIndexCache());

test('indexes the current ds-ai-hub and builds a bounded landing context packet', () => {
  const request = {
    prompt: 'подготовь мне лендинг для мобильного веба. 3 основных преимущества, 5 карточек с ключевыми особенностями, блок с вопросами и форма обратной связи. ключевое действие на странице — Оставить отзыв',
    dialogue: [],
  };
  const result = buildGenerationContextPacket(request, HUB_ROOT);
  const summary = inspectSemanticIndex(HUB_ROOT);

  assert.equal(summary.mode, 'semantic-index-context-packet');
  assert.ok(summary.patternCount >= 30);
  assert.ok(summary.componentCount >= 80);
  assert.ok(result.serialized.length <= MAX_CONTEXT_PACKET_CHARS);
  assert.equal(
    result.packet.retrieval.patternCandidates[0].id,
    'ptrn:landing-pages.alfa-business',
  );
  for (const expected of ['PromoMainBlock', 'BenefitCard', 'NavigationCardView', 'FAQ', 'VOC']) {
    assert.ok(componentIds(result.packet).includes(expected), `missing ${expected}`);
  }
  assert.deepEqual(
    result.allowedSourcePaths,
    result.packet.documents.map((document) => document.path),
  );
  assert.equal(result.packet.policy.documentsNotTruncated, true);
  assert.equal(result.packet.policy.figmaKeysExcluded, true);
  const faq = result.packet.documents.find(
    (document) => document.path === 'products/ab/patterns/faq.md',
  );
  assert.ok(faq.ruleIds.includes('rule:components.faq.public-roots-only'));
  assert.ok(faq.ruleIds.includes('rule:components.faq.platform-version-must-match'));
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
  for (const expected of ['VOC', 'Input', 'Button', 'ContentCardWrapper', 'TitleView']) {
    assert.ok(componentIds(result.packet).includes(expected), `missing ${expected}`);
  }
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
