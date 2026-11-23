'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readGuideRequest}=require('../src/reports/ABM-guide-search');
const {inspectAbmPatternKnowledge}=require('../src/knowledge-root');
const {buildAbmKnowledgePacket,knowledgePayload}=require('../src/reports/ABM-retrieval');
const {buildAbmDialoguePrompt}=require('../src/reports/ABM-messages');
const {renderAbmResponse}=require('../src/reports/ABM-response');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'abm-guide-mode-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(file,text)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text);};
 write('patterns/p_abm_buttons.md','---\nid: ptrn:abm.buttons\nproduct: abm\n---\n# Buttons\n- abmDocumentType: Pattern\n- abmPatternID: ptrn:ux.buttons\n- abmPatternTitle: Buttons\n- version: v.1.7\n\n### [Rule] R01\nКнопка запускает действие.\n');
 for(const family of ['hig','material2','material3'])write('guides/'+family+'/g_'+family+'_buttons.md','---\nid: abm.guides.'+family+'.buttons\nproduct: abm\nplatforms: ['+(family==='hig'?'ios':'android')+']\n---\n# Buttons\n- documentType: PlatformGuide\n- guideID: guide:'+family+'.buttons\n\n## Button labels\nButton labels describe the action.\n');
 return {root,source:inspectAbmPatternKnowledge(root)};
}
test('explicit guide names and generic mentions select only the requested families',()=>{
 for(const [q,families] of [['Что в HIG про кнопки?',['hig']],['Что в HIK про кнопки?',['hig']],['Что в ХИГ про кнопки?',['hig']],['Что в Material 2 про кнопки?',['material2']],['Что в Material3 про кнопки?',['material3']],['Что в Материал 3?',['material3']],['HIG и Material 2',['hig','material2']],['Material 2 и Material 3',['material2','material3']],['Что в гайдах про кнопки?',['hig','material2','material3']],['По гайдлайнам',['hig','material2','material3']]])assert.deepEqual(readGuideRequest(q)?.families,families,q);
 for(const q of ['Расскажи про кнопки','Паттерны без гайдов','Не используй гайды','Materialize buttons'])assert.equal(readGuideRequest(q),null,q);
});
test('guide-only packets exclude patterns before budgeting and preserve ordinary fallback mode',t=>{
 const f=fixture(t);
 for(const q of ['Кнопки HIG','Кнопки Material 2','Кнопки Material 3','Кнопки HIG и Material 2','Кнопки в гайдах']){
  const p=buildAbmKnowledgePacket(f.source,q),families=readGuideRequest(q).families;
  assert.equal(p.guideOnly,true);assert(p.rules.length,q);assert(p.rules.every(r=>r.sourceType==='guide'&&families.includes(r.family)));
  assert.deepEqual(new Set(p.rules.map(r=>r.family)),new Set(families));
  assert(!JSON.stringify(knowledgePayload(p)).includes('Кнопка запускает действие.'));
  assert.equal(p.chars,JSON.stringify(knowledgePayload(p)).length);
  const prompt=buildAbmDialoguePrompt(q,[],p);assert(prompt.includes('Пользователь явно запросил только платформенные гайды.'));assert(!prompt.includes('Для каждого отдельного вопроса сначала ищи точный подтверждённый ответ в паттернах АБМ.'));
 }
 const ordinary=buildAbmKnowledgePacket(f.source,'Кнопки');assert.equal(ordinary.guideOnly,false);assert(ordinary.rules.some(r=>r.sourceType==='pattern'));
});
test('conversation keeps guide scope on the same topic and resets it for a new source topic',t=>{
 const f=fixture(t);
 for(const [q,history,families] of [['А ещё?',[{role:'user',text:'Кнопки HIG'}],['hig']],['А ещё?',[{role:'user',text:'Кнопки'},{role:'user',text:'А что в Material 3?'}],['material3']],['А что в Material 3?',[{role:'user',text:'Кнопки Material 2'}],['material3']],['А в гайдах?',[{role:'user',text:'Кнопки'}],['hig','material2','material3']]]){
  const p=buildAbmKnowledgePacket(f.source,q,history);assert.equal(p.guideOnly,true);assert.deepEqual(new Set(p.rules.map(r=>r.family)),new Set(families),q);
 }
 const same=buildAbmKnowledgePacket(f.source,'Как использовать кнопки?',[{role:'user',text:'Кнопки HIG'}]);assert.equal(same.guideOnly,true);
 fs.writeFileSync(path.join(f.root,'patterns/p_abm_keyboard.md'),'---\nid: ptrn:abm.keyboard\nproduct: abm\nplatforms: [ios, android]\n---\n# Keyboard\n- abmDocumentType: Pattern\n- abmPatternTitle: Клавиатура\n- abmPatternID: ptrn:ux.keyboard\n- version: v.1.0\n\n### [Rule] R01_keyboard\nКлавиатуру скрываем при прокрутке.\n');
 const p=buildAbmKnowledgePacket(inspectAbmPatternKnowledge(f.root),'Клавиатура',[{role:'user',text:'Кнопки HIG'}]);assert.equal(p.guideOnly,false);assert(p.rules.some(r=>r.sourceType==='pattern'));
});
test('explicit guide answers use plain text blocks and source links without a fallback card',t=>{
 const f=fixture(t),q='Кнопки HIG',p=buildAbmKnowledgePacket(f.source,q),row=p.rules[0];let blocks;
 const value={answers:[{question:q,kind:'answer',evidence:[{file:row.file,ruleId:row.ruleId,quote:row.text,text:'**Подпись кнопки описывает действие.**'}]}]};
 const text=renderAbmResponse(value,f.root,q,p,{onBlocks:value=>{blocks=value;}});
 assert(blocks.every(b=>b.kind==='text'));assert(text.includes('Гайд: HIG — [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)'));assert(!text.includes('Паттерн:'));
 const missing=renderAbmResponse({answers:[{question:q,kind:'not_found',evidence:[]}]},f.root,q,p);assert(missing.startsWith('Не нашёл ответа в выбранных гайдах.'));assert(!missing.includes('в паттернах АБМ'));
 assert.throws(()=>renderAbmResponse({answers:[{question:q,kind:'answer',evidence:[{file:'patterns/p_abm_buttons.md',ruleId:'R01',quote:'Кнопка запускает действие.',text:'Неподходящий источник.'}]}]},f.root,q,p),error=>error.code==='ABM_EVIDENCE_OUTSIDE_PACKET');
});

test('guide misses never show the ABM chat or routing-label fragments',t=>{
 const f=fixture(t),q='Кнопки HIG (АБМ)',p=buildAbmKnowledgePacket(f.source,q),row=p.rules[0];
 const evidence=[{file:row.file,ruleId:row.ruleId,quote:row.text,text:'Проверенная рекомендация.'}];
 const partial=renderAbmResponse({answers:[{question:q,kind:'partial',evidence,unanswered:['(АБМ)']}]},f.root,q,p);
 assert(partial.includes('Проверенная рекомендация.'));
 assert(!partial.includes('Не нашёл')&&!partial.includes('Скорая помощь')&&!partial.includes('(АБМ)'));
 const allMissing=renderAbmResponse({answers:[{question:q,kind:'not_found',evidence:[]}]},f.root,q,p);
 assert.equal(allMissing,'Не нашёл ответа в выбранных гайдах.');
 const mixed=renderAbmResponse({answers:[{question:'Кнопки HIG',kind:'answer',evidence},{question:'(АБМ)',kind:'not_found',evidence:[]}]},f.root,q,p);
 assert(!mixed.includes('(АБМ)')&&!mixed.includes('Не нашёл')&&!mixed.includes('achat'));
});

test('real guide answer gaps remain visible without sending designers to the ABM chat',t=>{
 const f=fixture(t),q='Кнопки HIG, а сроки запуска?',p=buildAbmKnowledgePacket(f.source,q),row=p.rules[0];
 const result=renderAbmResponse({answers:[{question:q,kind:'partial',evidence:[{file:row.file,ruleId:row.ruleId,quote:row.text,text:'Подтверждённое правило.'}],unanswered:['сроки запуска?']}]},f.root,q,p);
 assert(result.includes('Подтверждённое правило.'));
 assert(result.includes('- сроки запуска?'));
 assert(!result.includes('achat')&&!result.includes('Скорая помощь'));
});

test('conversation resolves arbitrary references across fifteen exchanges without follow-up trigger words',t=>{
 const f=fixture(t),history=Array.from({length:15},(_,i)=>[
 {role:'user',text:i===0?'Кнопки HIG':'Обсудим предложенный вариант '+i},
 {role:'assistant',text:'Синтетическое пояснение '+i},
 ]).flat();
 const p=buildAbmKnowledgePacket(f.source,'Предпочитаю второй вариант, объясни его подробнее',history);
 assert(p.diagnostics.historyUsed);assert(p.guideOnly);
 assert(p.rules.every(row=>row.sourceType==='guide'&&row.family==='hig'));
 const switched=buildAbmKnowledgePacket(f.source,'Теперь рассмотрим это в Material 3',history);
 assert(switched.guideOnly);assert(switched.rules.every(row=>row.family==='material3'));
});

test('context reselects previously cited guide sections from current sources',t=>{
 const f=fixture(t);
 const file=path.join(f.root,'guides/hig/g_hig_details.md');
 fs.writeFileSync(file,'---\nid: abm.guides.hig.details\nproduct: abm\nplatforms: [ios]\n---\n# Details\n- documentType: PlatformGuide\n- guideID: guide:hig.details\n\n## Labels\nButton labels describe every action precisely.\n');
 const history=[{role:'user',text:'Кнопки HIG'},{role:'assistant',text:'Описание вариантов.\n\nГайд: HIG — [Details](https://example.test/details)'}];
 const p=buildAbmKnowledgePacket(inspectAbmPatternKnowledge(f.root),'Объясни второй вариант подробнее',history);
 assert(p.guideOnly);assert(p.rules.some(row=>row.file==='guides/hig/g_hig_details.md'));
 assert(p.rules.every(row=>row.family==='hig'));
});

test('a missing guide family does not turn an answered question into an unanswered whole',t=>{
 const f=fixture(t),q='А как в Material?',base=buildAbmKnowledgePacket(f.source,'Кнопки Material 2'),row=base.rules[0];
 const packet={...base,requestedGuideFamilies:['material2','material3']};
 const result=renderAbmResponse({answers:[{question:q,kind:'partial',evidence:[{file:row.file,ruleId:row.ruleId,quote:row.text,text:'Подтверждённый ответ Material 2.'}],unanswered:[q]}]},f.root,q,packet);
 assert(result.includes('Подтверждённый ответ Material 2.'));
 assert(result.includes('По этой теме не нашёл рекомендаций Material 3.'));
 assert(!result.includes('- А как в Material?')&&!result.includes('Не нашёл ответа в выбранных гайдах.'));
 assert(!result.includes('achat'));
});
