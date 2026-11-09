'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { NOT_FOUND, NO_EXAMPLE, renderAbmResponse } = require('../src/reports/ABM-response');

function fixture(t, version = 'v.2.3') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-abm-template-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = 'p_abm_fixture.md';
  fs.writeFileSync(path.join(root, file), `---
abmDocumentType: Pattern
abmPatternID: "ptrn:controls.fixture"
titlePage: "✅ Поля ввода :: R29 :: 03 сентября 2026"
version: ${version}
---
### [Rule] R01_without_example
**Ключ правила:** R01_without_example
**Раздел:** hidden-section
Копейки всегда отделяем запятой.
### [Rule] R02_parent
Общая группа правил.
### [Rule] R02.1_first
Первое условие действует в тексте.
### [Rule] R02.2_second
Второе условие действует в таблице.
#### [RuleExample] R02_parent
Ссылка на [RuleExample] R02_parent (iOS): https://www.figma.com/design/fixture?node-id=1-2
Ссылка на [RuleExample] R02_parent (Android): https://www.figma.com/design/fixture?node-id=1-3
### [Rule] R03_other
- Чужое условие не применяется.
#### [RuleExample] R03_other
Ссылка на [RuleExample] R03_other (iOS): https://www.figma.com/design/fixture?node-id=9-9
`);
  return { root, file };
}
const answer = (file, ruleId, quote, question = 'Вопрос?') => ({
  question, kind: 'answer', evidence: [{ file, ruleId, quote }],
});

test('the no-answer template is exact and never emits model prose or questions', t => {
  const f = fixture(t);
  assert.equal(renderAbmResponse({answers:[{question:'Вопрос?',kind:'not_found',evidence:[],text:'Уточни сценарий?'}]},f.root,'Вопрос?'),NOT_FOUND);
  assert.equal(renderAbmResponse({answers:[answer(f.file,'R01_without_example','Моя интерпретация правила.')]},f.root,'Вопрос?'),NOT_FOUND);
  assert.equal(renderAbmResponse({answers:[answer(f.file,'R99_missing','Копейки всегда отделяем запятой.')]},f.root,'Вопрос?'),NOT_FOUND);
});

test('the caption always uses metadata version, never a model number, section or date', t => {
  const f = fixture(t);
  const item = {...answer(f.file,'R01_without_example','Копейки всегда отделяем запятой.'),version:'R29',title:'Источник: 2026'};
  const text=renderAbmResponse({answers:[item]},f.root,'Вопрос?');
  assert.equal(text,'Копейки всегда отделяем запятой.\n\n'+NO_EXAMPLE+'\n\nПаттерн: «Поля ввода», v.2.3');
  assert(!text.includes('R29') && !text.includes('2026') && !text.includes('hidden-section'));
});

test('a missing or non-version metadata value fails closed instead of substituting another number', t => {
  const f = fixture(t,'R29');
  assert.equal(renderAbmResponse({answers:[answer(f.file,'R01_without_example','Копейки всегда отделяем запятой.')]},f.root,'Вопрос?'),NOT_FOUND);
});

test('subrules resolve shared parent examples and never use an unrelated neighboring example', t => {
  const f=fixture(t);
  const text=renderAbmResponse({answers:[answer(f.file,'R02.1_first','Первое условие действует в тексте.')]},f.root,'Вопрос?');
  assert(text.includes('[Пример iOS](https://www.figma.com/design/fixture?node-id=1-2)'));
  assert(text.includes('[Пример Android](https://www.figma.com/design/fixture?node-id=1-3)'));
  assert(!text.includes('9-9'));
  assert(text.indexOf('Пример iOS')<text.indexOf('Паттерн:'));
});

test('multiple questions have independent template blocks and repeated relevant examples', t => {
  const f=fixture(t);
  const text=renderAbmResponse({answers:[
    answer(f.file,'R02.1_first','Первое условие действует в тексте.','Первый вопрос?'),
    answer(f.file,'R02.2_second','Второе условие действует в таблице.','Второй вопрос?'),
  ]},f.root,'Первый вопрос? Второй вопрос?');
  assert(text.startsWith('**Первый вопрос?**'));
  assert.equal((text.match(/Паттерн:/g)||[]).length,2);
  assert.equal((text.match(/node-id=1-2/g)||[]).length,2);
  const boundary=text.indexOf('**Второй вопрос?**');
  assert(text.indexOf('Паттерн:')<boundary);
  assert(text.lastIndexOf('Пример Android')<text.lastIndexOf('Паттерн:'));
  assert(!/^\s*(?:\||[-*] |\d+[.)] )/m.test(text));
});

test('invented subquestions and paths outside the pattern folder fail closed', t => {
  const f=fixture(t);
  assert.equal(renderAbmResponse({answers:[answer(f.file,'R01_without_example','Копейки всегда отделяем запятой.','Вопрос от агента?')]},f.root,'Вопрос?'),NOT_FOUND);
  assert.equal(renderAbmResponse({answers:[answer('../p_abm_fixture.md','R01_without_example','Копейки всегда отделяем запятой.')]},f.root,'Вопрос?'),NOT_FOUND);
});


test('source quote list markers remain plain text instead of creating Markdown lists', t => {
  const f=fixture(t);
  const text=renderAbmResponse({answers:[answer(f.file,'R03_other','- Чужое условие не применяется.')]},f.root,'Вопрос?');
  assert(text.startsWith('\\- Чужое условие не применяется.'));
  assert(!/^[-+*] /m.test(text));
});
