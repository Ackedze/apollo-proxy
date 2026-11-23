'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {inspectAbmPatternKnowledge}=require('../src/knowledge-root');
const {buildAbmKnowledgePacket,knowledgePayload,MAX_PACKET_CHARS}=require('../src/reports/ABM-retrieval');
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

test('same-level descriptive headings anchor their entire section before generic matching rules',t=>{
 const f=fixture(t);
 f.write('buttons','Кнопки',
 '## General rules\n### Общие правила\n### [Rule] R01_general\nПодпись кнопки соответствует заголовку.\n'+
 '## Button labels\n### Нейминг в кнопках\n### [Rule] R13_labels\nДля действия используй глагол.\n'+
 '### [Rule] R14_pair\nДве кнопки называй единообразно.\n### [Rule] R14.1_exception\nДля отмены есть исключение.\n'+
 '### [Rule] R15_retry\nПовторный запрос обозначай явно.\n## Placement\n### Расположение кнопок\n### [Rule] R20_position\nРасполагай кнопку под контентом.\n');
 for(const query of ['Нейминг кнопок','Нейминг в кнопках','Расскажи про нейминг кнопки']) {
  const packet=buildAbmKnowledgePacket(f.source(),query);
  assert(packet.matchedSections.some(section=>section.title==='Нейминг в кнопках'));
  for(const id of ['R13_labels','R14_pair','R14.1_exception','R15_retry'])assert(packet.rules.some(rule=>rule.ruleId===id));
  assert.equal(packet.rules[0].ruleId,'R13_labels');
  assert(!packet.rules.some(rule=>rule.ruleId==='R01_general'));
  const naming=packet.rules.find(rule=>rule.ruleId==='R13_labels');
  assert(naming.context.includes('Нейминг в кнопках'));
  assert(!naming.context.includes('Общие правила'));
  const prompt=buildAbmDialoguePrompt(query,[],packet);
  assert(prompt.includes('matchedSections'));
 }
});

test('unknown new subjects never inherit an unrelated earlier topic',t=>{
 const f=fixture(t);
 const packet=buildAbmKnowledgePacket(f.source(),'QuantumButton', [{role:'user',text:'Про клавиатуру в АБМ'}]);
 assert.equal(packet.rules.length,0);assert.equal(packet.diagnostics.historyUsed,false);
});
test('platform-only follow-up uses the latest substantive user topic, ignoring assistant text',t=>{
 const f=fixture(t);
 const packet=buildAbmKnowledgePacket(f.source(),'А на Android?',[
 {role:'user',text:'Про клавиатуру'}, {role:'assistant',text:'Читай про суммы'},
 {role:'user',text:'Иконка Инфо в поле ввода'}, {role:'assistant',text:'Обсудим суммы'},
 ]);
 assert(packet.rules.some(rule=>rule.ruleId==='R02_info'));
 assert.equal(packet.diagnostics.historyUsed,true);
 assert(!packet.rules.some(rule=>rule.file==='p_abm_amount.md'));
 assert.equal(buildAbmKnowledgePacket(f.source(),'Android').rules.length,0);
});
test('button naming paraphrases and a unique typo find the complete same section',t=>{
 const f=fixture(t);
 f.write('buttons','Кнопки','## Текст\n### Нейминг в кнопках\n### [Rule] R01\nПрименимое условие.\n### [Rule] R02\nДополнительное исключение.\n');
 for(const q of ['Как назвать кнопку?','Как подписать кнопки?','Названия кнопок','Неймниг кнопок','Button naming']) {
  const packet=buildAbmKnowledgePacket(f.source(),q);
  assert(packet.matchedSections.some(section=>section.title==='Нейминг в кнопках'),q);
  assert(packet.rules.some(rule=>rule.file==='p_abm_buttons.md'&&rule.ruleId==='R01'),q);
  assert(packet.rules.some(rule=>rule.file==='p_abm_buttons.md'&&rule.ruleId==='R02'),q);
 }
});
test('a broad first topic cannot consume the reservation for another question; the entire payload is budgeted',t=>{
 const f=fixture(t);
 f.write('huge','Большая тема','## Большая тема\n'+Array.from({length:150},(_,i)=>'### [Rule] R'+String(i+1).padStart(3,'0')+'\nБольшая тема. '+('Подробное условие. '.repeat(24))+'\n').join(''));
 const packet=buildAbmKnowledgePacket(f.source(),'Расскажи все правила большой темы? Что делает иконка Инфо в поле ввода?');
 assert(packet.rules.some(rule=>rule.ruleId==='R02_info'));
 assert(packet.diagnostics.queryCoverage.every(Boolean));
 assert(packet.coverageLimited);
 const payload=knowledgePayload(packet);
 assert(payload.matchedSections.some(section=>section.title==='Большая тема'&&!section.complete));
 assert.equal(packet.chars,JSON.stringify(payload).length);
 assert(packet.chars<=MAX_PACKET_CHARS);
 for(const section of payload.matchedSections)for(const id of section.ruleIds)assert(payload.rules.some(rule=>rule.file===section.file&&rule.ruleId===id));
});

test('the model packet keeps every source text and parent without repeating shared context',t=>{
 const f=fixture(t);
 const packet=buildAbmKnowledgePacket(f.source(),'Каким шрифтом писать копейки?');
 const payload=knowledgePayload(packet);
 for(const row of packet.rules) {
  const item=payload.rules.find(rule=>rule.file===row.file&&rule.ruleId===row.ruleId);
  assert.equal(item.text,row.text);
  assert.equal(payload.contexts.find(context=>context.id===item.contextId).text,row.context);
  for(const parent of row.parents) {
   assert(item.parentRuleIds.includes(parent.ruleId));
   assert(payload.rules.some(rule=>rule.file===row.file&&rule.ruleId===parent.ruleId&&rule.text===parent.text));
  }
 }
 assert(payload.contexts.length<payload.rules.length);
 assert(JSON.stringify(payload).length<JSON.stringify({rules:packet.rules,matchedSections:packet.matchedSections,coverageLimited:packet.coverageLimited}).length);
});

test('a qualified examples request switches to its explicit subject instead of inheriting an old one',t=>{
 const f=fixture(t);
 f.write('checkbox','Checkbox','### [Rule] R01_checkbox\nУсловие чекбокса.\n');
 const history=[{role:'user',text:'Клавиатура в АБМ'},{role:'user',text:'Покажи примеры чекбоксов'}];
 const explicit=buildAbmKnowledgePacket(f.source(),'Покажи примеры чекбоксов',[history[0]]);
 assert.equal(explicit.diagnostics.historyUsed,false);
 assert(explicit.rules.some(rule=>rule.file==='p_abm_checkbox.md'));
 const follow=buildAbmKnowledgePacket(f.source(),'А на Android?',history);
 assert(follow.diagnostics.historyUsed);
 assert(follow.rules.some(rule=>rule.file==='p_abm_checkbox.md'));
 assert(!follow.rules.some(rule=>rule.file==='p_abm_keyboard.md'));
 const examples=buildAbmKnowledgePacket(f.source(),'Покажи примеры',[{role:'user',text:'Клавиатура в АБМ'}]);
 assert(examples.diagnostics.historyUsed);
 assert(examples.rules.some(rule=>rule.file==='p_abm_keyboard.md'));
});

test('a component list keeps core definitions as well as detailed guidelines',t=>{
 const f=fixture(t);
 f.write('selection','Selection components',
 '## Компоненты выбора\n### [Rule] R02_radio_buttons\nРадиокнопки — одиночный выбор.\n'+
 '### [Rule] R03_checkboxes\nЧекбоксы — независимые варианты.\n'+
 '### [Rule] R04_switch\nПереключатель — мгновенное действие.\n'+
 '## Отдельно расположенное исключение\n### [Rule] R04.1_confirmation\nНе используй переключатель с подтверждением.\n## Продолжение\n'+
 '### [Rule] R05_chips\nЧипсы — альтернативный выбор.\n'+
 '## Детали\n'+Array.from({length:24},(_,i)=>'### [Rule] R'+(20+i)+'_radio_checkbox_switch_chips_guidelines\nПодробные условия для Radio, Checkbox, Switch и Chips.\n').join(''));
 const packet=buildAbmKnowledgePacket(f.source(),'Когда использовать радиокнопки, чекбоксы, переключатели и чипсы?');
 for(const id of ['R02_radio_buttons','R03_checkboxes','R04_switch','R04.1_confirmation','R05_chips'])assert(packet.rules.some(rule=>rule.ruleId===id),id);
});

test('a pattern overview includes every section even when only two headings repeat its name',t=>{
 const f=fixture(t);
 f.write('haptic','Хаптик',
  '## Общие принципы\n### [Rule] R01_definition\nОпределение тактильной отдачи.\n'+
  '### [Rule] R02_types\nТри системных типа.\n### [Rule] R02.1_impact\nФизическое взаимодействие.\n'+
  '## Кнопки\n### [Rule] R03_required\nПри завершении сценария нужен Light.\n'+
  '### [Rule] R04_not_required\nЕсли действие ничего не меняет, отдача не нужна.\n'+
  '## Выбор\n### [Rule] R05_selection\nSelection при выборе.\n'+
  '## Хаптик в онбордингах\n### [Rule] R09_onboarding\nХаптик при появлении спотлайта.\n'+
  '## Хаптик в лотти-анимациях\n### [Rule] R10_lottie\nХаптик в ключевые моменты анимации.\n');
 f.write('animation','Анимации','## Общие принципы\n### [Rule] R01_start\nПервый случай.\n## Анимации в лотти\n### [Rule] R02_end\nВторой случай.\n');
 const animation=buildAbmKnowledgePacket(f.source(),'Как использовать анимации');
 assert.deepEqual(animation.rules.map(rule=>rule.ruleId),['R01_start','R02_end']);
 const ids=['R01_definition','R02_types','R02.1_impact','R03_required','R04_not_required','R05_selection','R09_onboarding','R10_lottie'];
 for(const query of ['Как мне использовать хаптик','Haptic','Haptics','Хаптик']) {
  const packet=buildAbmKnowledgePacket(f.source(),query);
  assert.deepEqual(new Set(packet.rules.map(rule=>rule.ruleId)),new Set(ids),query);
  assert(knowledgePayload(packet).matchedSections.some(section=>section.title==='Хаптик'&&section.complete));
  assert(!packet.coverageLimited);
 }
 const specific=buildAbmKnowledgePacket(f.source(),'Хаптик в онбордингах');
 assert.deepEqual(specific.rules.map(rule=>rule.ruleId),['R09_onboarding']);
 for(const query of ['А ещё?','Что еще?','Продолжи','А дальше?']) {
  const packet=buildAbmKnowledgePacket(f.source(),query,[
   {role:'user',text:'Как мне использовать хаптик'},
   {role:'assistant',text:'Хаптик в онбордингах и анимациях.'},
   {role:'user',text:'А ещё?'},
  ]);
  assert(packet.diagnostics.historyUsed,query);
  assert.deepEqual(new Set(packet.rules.map(rule=>rule.ruleId)),new Set(ids),query);
  assert.equal(buildAbmKnowledgePacket(f.source(),query).rules.length,0,query);
 }
 const changed=buildAbmKnowledgePacket(f.source(),'Хаптик в онбордингах',[{role:'user',text:'Клавиатура'}]);
 assert(!changed.diagnostics.historyUsed);
 assert.deepEqual(changed.rules.map(rule=>rule.ruleId),['R09_onboarding']);
});

test('decimal paraphrases focus the source rule with its conditions and parent',t=>{
 const f=fixture(t);
 f.write('faq','FAQ','### [Rule] R90\nПодробный ответ заканчивается точкой.\n');
 for(const q of ['После числа ставить точку или запятую?','Чем отделять копейки?','Как отделить дробную часть?','В числе нужна запятая?']) {
  const packet=buildAbmKnowledgePacket(f.source(),q);
  assert.deepEqual(new Set(packet.rules.map(row=>row.ruleId)),new Set(['R01_parent','R01.1_kopecks']),q);
  const rule=packet.rules.find(row=>row.ruleId==='R01.1_kopecks');
  assert(rule.context.includes('Только для сумм, не для кодов.'));
  assert(rule.parents.some(parent=>parent.ruleId==='R01_parent'));
 }
 const multi=buildAbmKnowledgePacket(f.source(),'Чем отделять копейки? Что делает иконка Инфо?');
 assert(multi.rules.some(row=>row.ruleId==='R01.1_kopecks'));
 assert(multi.rules.some(row=>row.ruleId==='R02_info'));
 assert(multi.chars<=MAX_PACKET_CHARS);
});
test('number follow-ups use the user domain but explicit new domains override it',t=>{
 const f=fixture(t),history=[{role:'user',text:'Форматирование сумм'},{role:'assistant',text:'Обсудим телефон'}];
 for(const q of ['А можно точку вместо запятой?','После числа ставить точку или запятую?']) {
  const packet=buildAbmKnowledgePacket(f.source(),q,history);
  assert(packet.diagnostics.historyUsed,q);
  assert(packet.rules.some(row=>row.ruleId==='R01.1_kopecks'),q);
 }
 for(const q of ['Точка или запятая в дате?','После числа в конце предложения ставить точку или запятую?','Точка или запятая в номере телефона?','Точка или запятая в коде?']) {
  const packet=buildAbmKnowledgePacket(f.source(),q,history);
  assert(!packet.diagnostics.historyUsed,q);
  assert(!packet.rules.some(row=>row.file==='p_abm_amount.md'),q);
 }
});

test('long scenarios retain small alternative groups and full parent families',t=>{
 const f=fixture(t);
 f.write('archive','Архивирование',
 '## Действия\n### [Rule] R40\nКарточку архивируем только после подтверждения.\n'+
 '### [Rule] R40.1_online\nПри наличии сети подтверждение отправляем немедленно.\n'+
 '### [Rule] R40.2_offline\nВ офлайне сохраняем черновик локально, архивирование откладываем.\n'+
 '## Оформление\n### [Rule] R90\nЗаголовок страницы красный.\n');
 const packet=buildAbmKnowledgePacket(f.source(),'Карточку нужно архивировать после подтверждения, но в офлайне сохраняем черновик локально. Как поступить с архивированием?');
 for(const id of ['R40','R40.1_online','R40.2_offline'])assert(packet.rules.some(row=>row.ruleId===id),id);
 assert(!packet.rules.some(row=>row.ruleId==='R90'));
 assert(packet.chars<=MAX_PACKET_CHARS);
});
test('long scenarios compare numeric layout constraints and retain alternate child rules',t=>{
 const f=fixture(t);
 f.write('actions','Действия','## Компоновка\n### [Rule] R50\nВыбор расположения действий.\n'+
 '### [Rule] R50.1\nГоризонтальный: названия кнопок помещаются в ширину 320px.\n'+
 '### [Rule] R50.2\nВертикальный: если названия не помещаются.\n');
 const packet=buildAbmKnowledgePacket(f.source(),'У меня две кнопки рядом, названия помещаются в 320, но хочется проверить другое расположение действий.');
 for(const id of ['R50','R50.1','R50.2'])assert(packet.rules.some(row=>row.ruleId===id),id);
});
