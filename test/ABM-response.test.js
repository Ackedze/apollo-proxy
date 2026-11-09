'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {CHAT_URL,NOT_FOUND,renderAbmResponse}=require('../src/reports/ABM-response');
function fixture(t,version='v.2.3') {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'apollo-abm-template-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file='p_abm_fixture.md';
 fs.writeFileSync(path.join(root,file),'---\nabmDocumentType: Pattern\nabmPatternID: "ptrn:controls.fixture"\ntitlePage: "✅ Поля ввода :: R29 :: 03 сентября 2026"\nversion: '+version+'\n---\n'+
 '### [Rule] R01_without_example\n**Ключ правила:** R01_without_example\n**Раздел:** hidden-section\nКопейки всегда отделяем запятой.\n'+
 '### [Rule] R02_parent\nОбщая группа правил.\n### [Rule] R02.1_first\nПервое условие действует в тексте.\n'+
 '### [Rule] R02.2_second\nВторое условие действует в таблице.\n#### [RuleExample] R02_parent\n'+
 'Ссылка на [RuleExample] R02_parent (iOS): https://www.figma.com/design/fixture?node-id=1-2\n'+
 'Ссылка на [RuleExample] R02_parent (Android): https://www.figma.com/design/fixture?node-id=1-3\n'+
 '### [Rule] R03_other\n- Чужое условие не применяется.\n#### [RuleExample] R03_other\n'+
 'Ссылка на [RuleExample] R03_other (iOS): https://www.figma.com/design/fixture?node-id=9-9\n');
 return {root,file};
}
const evidence=(file,ruleId,quote,text=quote)=>({file,ruleId,quote,text});
const answer=(item,question='Вопрос?')=>({question,kind:'answer',evidence:[item]});
test('missing answers use the exact approved chat link without model prose',t=>{
 const f=fixture(t);
 const result=renderAbmResponse({answers:[{question:'Вопрос?',kind:'not_found',evidence:[],text:'Уточни сценарий?'}]},f.root,'Вопрос?');
 assert.equal(result,NOT_FOUND);assert(result.includes(']('+CHAT_URL+')'));
});
test('paraphrases and allowed Markdown survive; source captions use real metadata',t=>{
 const f=fixture(t);
 const text='Копейки отделяй **запятой**.\n\n- Это *условие*.\n1. Первый пункт.';
 const result=renderAbmResponse({answers:[answer(evidence(f.file,'R01_without_example','Копейки всегда отделяем запятой.',text))]},f.root,'Вопрос?');
 assert.equal(result,text+'\n\nПаттерн: «Поля ввода», v.2.3');
 assert(!result.includes('примера к нему не нашёл'));
 assert(!result.includes('R29')&&!result.includes('2026')&&!result.includes('hidden-section'));
});
test('each rule is followed by its own example; one caption per pattern',t=>{
 const f=fixture(t);
 const value={answers:[{question:'Вопрос?',kind:'answer',evidence:[
 evidence(f.file,'R02.1_first','Первое условие действует в тексте.','Первый ответ.'),
 evidence(f.file,'R03_other','- Чужое условие не применяется.','Второй ответ.'),
 evidence(f.file,'R02.2_second','Второе условие действует в таблице.','Третий ответ.'),
 ]}]};
 const result=renderAbmResponse(value,f.root,'Вопрос?');
 assert(result.indexOf('Первый ответ.')<result.indexOf('node-id=1-2'));
 assert(result.indexOf('node-id=1-3')<result.indexOf('Второй ответ.'));
 assert(result.indexOf('Второй ответ.')<result.indexOf('node-id=9-9'));
 assert(result.indexOf('node-id=9-9')<result.indexOf('Третий ответ.'));
 assert.equal((result.match(/node-id=1-2/g)||[]).length,2);
 assert.equal((result.match(/Паттерн:/g)||[]).length,1);
 assert(result.includes('🍏 [Пример](')&&result.includes('🤖 [Пример]('));
 assert(!result.includes('[🍏')&&!result.includes('Пример iOS'));
});
test('unanswered questions are collected under one final heading',t=>{
 const f=fixture(t),questions='Первый? Второй? Третий?';
 const result=renderAbmResponse({answers:[
 {question:'Первый?',kind:'not_found',evidence:[]},
 answer(evidence(f.file,'R01_without_example','Копейки всегда отделяем запятой.'),'Второй?'),
 {question:'Третий?',kind:'not_found',evidence:[]},
 ]},f.root,questions);
 assert(result.startsWith('**Второй?**'));
 assert.equal((result.match(/Не нашёл ответа/g)||[]).length,1);
 assert(result.includes('**'+NOT_FOUND+'**\n\n- Первый?\n- Третий?'));
});
test('invalid evidence, unrelated examples and references outside retrieved rules fail closed',t=>{
 const f=fixture(t);
 const render=item=>renderAbmResponse({answers:[answer(item)]},f.root,'Вопрос?');
 assert.equal(render(evidence(f.file,'R01_without_example','Несуществующее подтверждение.')),NOT_FOUND);
 assert.equal(render(evidence('../'+f.file,'R01_without_example','Копейки всегда отделяем запятой.')),NOT_FOUND);
 assert.equal(renderAbmResponse({answers:[answer(evidence(f.file,'R01_without_example','Копейки всегда отделяем запятой.'))]},f.root,'Вопрос?',{rules:[]}),NOT_FOUND);
 const result=render(evidence(f.file,'R02.1_first','Первое условие действует в тексте.'));
 assert(result.includes('1-2')&&!result.includes('9-9'));
});
test('unsafe formatting, invented subquestions and invalid source versions fail closed',t=>{
 const f=fixture(t);
 for(const text of ['[Чужая ссылка](https://evil.test)','| A | B |','<script>x</script>','Источник: v.R29','Текст R29_info']) {
  assert.equal(renderAbmResponse({answers:[answer(evidence(f.file,'R01_without_example','Копейки всегда отделяем запятой.',text))]},f.root,'Вопрос?'),NOT_FOUND);
 }
 assert.equal(renderAbmResponse({answers:[answer(evidence(f.file,'R01_without_example','Копейки всегда отделяем запятой.'),'Выдуманный?')]},f.root,'Вопрос?'),NOT_FOUND);
 const invalid=fixture(t,'R29');
 assert.equal(renderAbmResponse({answers:[answer(evidence(invalid.file,'R01_without_example','Копейки всегда отделяем запятой.'))]},invalid.root,'Вопрос?'),NOT_FOUND);
});

test('a citation spanning an inline Markdown link is validated against the same text sent to the agent',t=>{
 const f=fixture(t);
 const body='\n### [Rule] R04_linked_context\nКвадратные чипсы используй в фильтрах.\n\n[Фильтры. Читать паттерн](https://example.test/pattern)\n\nВыбирай компонент ChipView.\n';
 fs.appendFileSync(path.join(f.root,f.file),body);
 const quote='Квадратные чипсы используй в фильтрах.\n\nФильтры. Читать паттерн\n\nВыбирай компонент ChipView.';
 const item=evidence(f.file,'R04_linked_context',quote,'Квадратные чипсы используй в фильтрах.');
 const {inspectAbmPatternKnowledge}=require('../src/knowledge-root');
 const {buildAbmKnowledgePacket}=require('../src/reports/ABM-retrieval');
 const packet=buildAbmKnowledgePacket(inspectAbmPatternKnowledge(f.root),'Когда использовать чипсы?');
 assert(packet.rules.find(rule=>rule.ruleId===item.ruleId).text.includes('Фильтры. Читать паттерн'));
 assert(!packet.rules.find(rule=>rule.ruleId===item.ruleId).text.includes('https://'));
 const result=renderAbmResponse({answers:[{question:'Вопрос?',kind:'answer',evidence:[
  evidence(f.file,'R02.1_first','Первое условие действует в тексте.'),
  item,
 ]}]},f.root,'Вопрос?');
 assert.notEqual(result,NOT_FOUND);
 assert(result.includes('Первое условие действует в тексте.'));
 assert(result.includes('Квадратные чипсы используй в фильтрах.'));
 assert(result.includes('node-id=1-2'));
 assert(!result.includes('example.test'));
 // Normalization must not make new normative statements acceptable.
 assert.equal(renderAbmResponse({answers:[answer({...item,quote:quote+'\nДопускается любой компонент.'})]},f.root,'Вопрос?'),NOT_FOUND);
});

test('source placeholders in square brackets are plain text while model-authored links remain forbidden',t=>{
 const f=fixture(t);
 const quote='Копейки всегда отделяем запятой.';
 const render=text=>renderAbmResponse({answers:[answer(evidence(f.file,'R01_without_example',quote,text))]},f.root,'Вопрос?');
 const result=render('Используй «К [разделу]» и «Что такое [продукт]».');
 assert(result.startsWith('Используй «К [разделу]» и «Что такое [продукт]».'));
 assert(!result.includes('примера к нему не нашёл'));
 for(const text of ['[Ссылка](/local)','[Ссылка][ref]','[ref]: /local','![image](/local)'])assert.equal(render(text),NOT_FOUND);
});
