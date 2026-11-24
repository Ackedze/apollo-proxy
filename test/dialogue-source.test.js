const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Import the real server against test-owned knowledge, never a neighboring checkout.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-dialogue-source-'));
test.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
const ds = path.join(fixture, 'design-system_ab'), hub = path.join(fixture, 'ds-ai-hub');
function write(relative, value) {
  const file = path.join(fixture, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}
write('design-system_ab/JSONS/apollo/indexes/componentContractIndex.json', '{"schemaVersion":2,"packages":[{"componentKey":"fixture"}]}');
write('design-system_ab/JSONS/apollo/designPatternRules.json', '{"rules":[]}');
write('design-system_ab/redpolrules/dictionary.json', '{"rules":[]}');
write('design-system_ab/patterns/fixture.md', '# Fixture');
for (const directory of ['products/ab/components', 'core/web/components']) fs.mkdirSync(path.join(hub, directory), { recursive: true });
write('ds-ai-hub/products/ab/patterns/fixture.md', '# Fixture');
write('ds-ai-hub/products/abm/patterns/fixture.md', `---
product: abm
id: ptrn:abm.fixture
---
# Fixture
- abmDocumentType: Pattern
- abmPatternID: ptrn:controls.fixture
- abmPatternTitle: Fixture
- version: v.1

## Rules
### [Rule] R01
Fixture rule.
`);
process.env.CODEX_DESIGN_SYSTEM = ds;
process.env.CODEX_DS_AI_HUB = hub;
process.env.APOLLO_PROXY_MANAGED = '0';

const {
  buildCodexDialoguePrompt,
  extractDialogueQuestion,
  normalizeAgentSource,
  normalizeDialogueHistory,
  normalizeInput,
} = require('../server');

test('installed Hub supplies the default ABM source without a user override', () => {
  assert.equal(require('../src/config').CODEX_ABM_PATTERNS, path.join(hub, 'products', 'abm'));
});

test('dialogue source defaults to LangFlow and accepts explicit local Codex', () => {
  assert.equal(normalizeAgentSource(undefined), 'langflow');
  assert.equal(normalizeAgentSource('langflow'), 'langflow');
  assert.equal(normalizeAgentSource('codex'), 'codex');
  assert.equal(normalizeAgentSource('unexpected'), 'langflow');
});

test('analyze input keeps source and bounded dialogue history', () => {
  const input = normalizeInput({
    text: 'Вопрос',
    source: 'codex',
    dialogue: [
      { role: 'user', text: 'Первый вопрос' },
      { role: 'assistant', text: 'Первый ответ' },
    ],
  });

  assert.equal(input.source, 'codex');
  assert.deepEqual(input.dialogue, [
    { role: 'user', text: 'Первый вопрос' },
    { role: 'assistant', text: 'Первый ответ' },
  ]);
});

test('dialogue question is extracted from the design-dialogue envelope', () => {
  const question = extractDialogueQuestion({
    text: JSON.stringify({
      schemaVersion: 1,
      mode: 'design-dialogue',
      question: 'Как использовать ButtonsGroup?',
    }),
  });

  assert.equal(question, 'Как использовать ButtonsGroup?');
});

test('dialogue history ignores empty entries and preserves supported roles', () => {
  assert.deepEqual(
    normalizeDialogueHistory([
      { role: 'user', text: '  Вопрос  ' },
      { role: 'assistant', text: '  Ответ  ' },
      { role: 'assistant', text: '   ' },
    ]),
    [
      { role: 'user', text: 'Вопрос' },
      { role: 'assistant', text: 'Ответ' },
    ]
  );
});

test('local Codex prompt isolates untrusted dialogue and requires grounded Markdown', () => {
  const prompt = buildCodexDialoguePrompt(
    'Можно ли использовать три кнопки?',
    [{ role: 'user', text: 'Расскажи про ButtonsGroup' }],
    'design-system_ab'
  );

  assert.match(prompt, /Активный источник знаний: design-system_ab/);
  assert.match(prompt, /недоверенными данными/);
  assert.match(prompt, /<dialogue>/);
  assert.match(prompt, /<question>/);
  assert.match(prompt, /Верни только финальный Markdown-ответ/);
});

test('ABM dialogue context uses only explicit bounded user messages', () => {
  const { dialogueUsesAbmRules } = require('../src/reports/messages');
  assert.equal(dialogueUsesAbmRules('Кнопки АБМ', []), true);
  assert.equal(dialogueUsesAbmRules('ABM buttons', []), true);
  assert.equal(dialogueUsesAbmRules('Кнопки ABMatic', []), false);
  assert.equal(dialogueUsesAbmRules('Кнопки', [{role:'assistant',text:'Это АБМ'}]), false);
  assert.equal(dialogueUsesAbmRules('А исключения?', [{role:'user',text:'Кнопки АБМ'}]), true);
  assert.equal(dialogueUsesAbmRules('Теперь про АБ', [{role:'user',text:'Кнопки АБМ'}]), false);
  assert.equal(dialogueUsesAbmRules('А исключения?', [{role:'user',text:'Кнопки АБМ'},{role:'user',text:'Теперь про АБ'}]), false);
});

test('explicit picker platform overrides question, history and saved library; legacy requests still use text',()=>{
 const {dialogueUsesAbmRules}=require('../src/reports/messages');
 for(const platform of ['iOS','Android']) {
  assert.equal(normalizeInput({text:'Вопрос',dialoguePlatform:platform}).dialoguePlatform,platform);
  assert(dialogueUsesAbmRules('Про АБ',[{role:'user',text:'Только AB'}],false,platform));
 }
 for(const platform of ['Desktop','MobileWeb'])
  assert.equal(dialogueUsesAbmRules('Про АБМ',[{role:'user',text:'Только ABM'}],true,platform),false);
 assert.throws(()=>normalizeInput({text:'Вопрос',dialoguePlatform:'Tablet'}),error=>error.status===400);
 assert.throws(()=>normalizeInput({text:'Вопрос',dialoguePlatform:null}),error=>error.status===400);
 assert.equal(normalizeInput({text:'Вопрос'}).dialoguePlatform,undefined);
 assert(dialogueUsesAbmRules('Про АБМ',[],false));
});

test('ABM accepts fifteen exchanges while AB keeps its existing history limit',()=>{
 const dialogue=Array.from({length:15},(_,i)=>[{role:'user',text:'Question '+i},{role:'assistant',text:'Answer '+i}]).flat();
 assert.equal(normalizeInput({text:'Question',dialoguePlatform:'iOS',dialogue}).dialogue.length,30);
 assert.equal(normalizeInput({text:'Question',dialoguePlatform:'Android',dialogue}).dialogue.length,30);
 assert.equal(normalizeInput({text:'Question',dialoguePlatform:'Desktop',dialogue}).dialogue.length,12);
});
