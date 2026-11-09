'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {inspectAbmPatternKnowledge}=require('../src/knowledge-root');
const {buildAbmKnowledgePacket,MAX_PACKET_CHARS}=require('../src/reports/ABM-retrieval');
const {buildAbmDialoguePrompt}=require('../src/reports/ABM-messages');
function fixture(t) {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'apollo-abm-retrieval-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(name,title,text)=>fs.writeFileSync(path.join(root,'p_abm_'+name+'.md'),
 '---\nabmDocumentType: Pattern\nabmPatternID: "ptrn:ux.'+name+'"\nabmPatternTitle: '+title+'\nversion: v.1.2\ntags: '+name+'\n---\n# '+title+'\n'+text);
 write('amount','Форматирование сумм','## Суммы в тексте\nТолько для сумм, не для кодов.\n'+
 '### [Rule] R01_parent\nДля финансовых текстов.\n### [Rule] R01.1_kopecks\nКопейки всегда отделяем запятой и пишем Regular шрифтом.\n'+
 '### [Rule] R01.2_numbers\nЧетырёхзначные числа в тексте пишем без пробелов.\n#### [RuleExample] R01_parent\nСсылка на [RuleExample] R01_parent (iOS): https://example.test/no-source-text\nПосле ссылки сохраняем исключение для таблиц.\n'+
 '## Другая тема\n### [Rule] R09\nНесвязанный раздел не часть предыдущего правила.\n');
 write('fields','Поля ввода','### [Rule] R02_info\nПри нажатии на иконку Инфо в поле ввода открываем штору.\n');
 write('keyboard','Клавиатура','### [Rule] R03\nКлавиатура скрывается при прокрутке.\n');
 return {root,write,source:()=>inspectAbmPatternKnowledge(root)};
}
test('multiquestion retrieval keeps each subject, complete parents and section conditions',t=>{
 const f=fixture(t);
 const packet=buildAbmKnowledgePacket(f.source(),'Каким шрифтом писать копейки? Что происходит при нажатии на иконку Инфо?');
 const money=packet.rules.find(rule=>rule.ruleId==='R01.1_kopecks');
 assert(money);assert(money.parents.some(parent=>parent.text==='Для финансовых текстов.'));
 assert(money.context.includes('Только для сумм, не для кодов.'));
 assert(packet.rules.some(rule=>rule.ruleId==='R02_info'));
 assert(packet.rules.find(rule=>rule.ruleId==='R01.2_numbers').text.includes('После ссылки сохраняем исключение для таблиц.'));
 assert(!money.text.includes('RuleExample')&&!money.text.includes('Несвязанный раздел'));
 assert(!JSON.stringify(packet.rules).includes('example.test'));
 assert(packet.chars<=MAX_PACKET_CHARS);
});
test('morphological variants and explicit IDs retrieve real rules; history recovers follow-up topic',t=>{
 const f=fixture(t);
 assert(buildAbmKnowledgePacket(f.source(),'О копейках').rules.some(rule=>rule.ruleId==='R01.1_kopecks'));
 assert(buildAbmKnowledgePacket(f.source(),'ptrn:ux.fields').rules.some(rule=>rule.ruleId==='R02_info'));
 assert(buildAbmKnowledgePacket(f.source(),'А какие условия?', [{role:'user',text:'Про клавиатуру в АБМ'}]).rules.some(rule=>rule.ruleId==='R03'));
});
test('the cached index follows content fingerprint changes and prompt contains no source path',t=>{
 const f=fixture(t);
 buildAbmKnowledgePacket(f.source(),'Клавиатура');
 f.write('keyboard','Клавиатура','### [Rule] R04\nКлавиатура всегда скрыта.\n');
 const packet=buildAbmKnowledgePacket(f.source(),'Клавиатура');
 assert(packet.rules.some(rule=>rule.ruleId==='R04')&&!packet.rules.some(rule=>rule.ruleId==='R03'));
 const prompt=buildAbmDialoguePrompt('Клавиатура',[],packet);
 assert(prompt.includes('Клавиатура всегда скрыта.'));
 assert(!prompt.includes(f.root));
});
test('large rules are never cut through conditions and overflow is explicit',t=>{
 const f=fixture(t);
 f.write('large','Лимиты','### [Rule] R01\nЛимит '+('условие '.repeat(MAX_PACKET_CHARS))+'исключение в конце.\n');
 const packet=buildAbmKnowledgePacket(f.source(),'Лимиты');
 assert(packet.chars<=MAX_PACKET_CHARS);
 assert(!packet.rules.some(rule=>rule.file==='p_abm_large.md'));
 assert(packet.coverageLimited);
});

test('short follow-ups keep the user topic even when the generic word matches another pattern',t=>{
 const f=fixture(t);
 f.write('other','Другая тема','### [Rule] R09\nИсключения для таблиц описаны отдельно.\n');
 const packet=buildAbmKnowledgePacket(f.source(),'А какие исключения?', [{role:'user',text:'Про клавиатуру в АБМ'}]);
 assert(packet.rules.some(rule=>rule.file==='p_abm_keyboard.md'&&rule.ruleId==='R03'));
});
test('clear-button aliases preserve the source parent and child together',t=>{
 const f=fixture(t);
 f.write('clear','Поля ввода','### [Rule] R10_parent\nКрестик показываем только в заполненном поле.\n### [Rule] R10.1_search\nВ поиске крестик появляется после трёх символов.\n');
 const packet=buildAbmKnowledgePacket(f.source(),'Кнопка очистки в поиске');
 assert(packet.rules.some(rule=>rule.ruleId==='R10.1_search'));
 assert(packet.rules.some(rule=>rule.ruleId==='R10_parent'));
});
