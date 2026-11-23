'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readGuideRequest}=require('../src/reports/ABM-guide-search');
const {inspectAbmPatternKnowledge}=require('../src/knowledge-root');
const {buildAbmKnowledgePacket,knowledgePayload,MAX_PACKET_CHARS}=require('../src/reports/ABM-retrieval');
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
  assert(p.chars<=MAX_PACKET_CHARS);assert.equal(p.chars,JSON.stringify(knowledgePayload(p)).length);
  const prompt=buildAbmDialoguePrompt(q,[],p);assert(prompt.includes('Пользователь явно запросил только платформенные гайды.'));assert(!prompt.includes('Для каждого отдельного вопроса сначала ищи точный подтверждённый ответ в паттернах АБМ.'));
 }
 const ordinary=buildAbmKnowledgePacket(f.source,'Кнопки');assert.equal(ordinary.guideOnly,false);assert(ordinary.rules.some(r=>r.sourceType==='pattern'));
});
test('short follow-ups inherit the guide scope; a new question without guide words restores pattern search',t=>{
 const f=fixture(t);
 for(const [q,history,families] of [['А ещё?',[{role:'user',text:'Кнопки HIG'}],['hig']],['А ещё?',[{role:'user',text:'Кнопки'},{role:'user',text:'А что в Material 3?'}],['material3']],['А что в Material 3?',[{role:'user',text:'Кнопки Material 2'}],['material3']],['А в гайдах?',[{role:'user',text:'Кнопки'}],['hig','material2','material3']]]){
  const p=buildAbmKnowledgePacket(f.source,q,history);assert.equal(p.guideOnly,true);assert.deepEqual(new Set(p.rules.map(r=>r.family)),new Set(families),q);
 }
 const p=buildAbmKnowledgePacket(f.source,'Как использовать кнопки?',[{role:'user',text:'Кнопки HIG'}]);assert.equal(p.guideOnly,false);assert(p.rules.some(r=>r.sourceType==='pattern'));
});
test('explicit guide answers use plain text blocks and source links without a fallback card',t=>{
 const f=fixture(t),q='Кнопки HIG',p=buildAbmKnowledgePacket(f.source,q),row=p.rules[0];let blocks;
 const value={answers:[{question:q,kind:'answer',evidence:[{file:row.file,ruleId:row.ruleId,quote:row.text,text:'**Подпись кнопки описывает действие.**'}]}]};
 const text=renderAbmResponse(value,f.root,q,p,{onBlocks:value=>{blocks=value;}});
 assert(blocks.every(b=>b.kind==='text'));assert(text.includes('Гайд: HIG — [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)'));assert(!text.includes('Паттерн:'));
 const missing=renderAbmResponse({answers:[{question:q,kind:'not_found',evidence:[]}]},f.root,q,p);assert(missing.startsWith('Не нашёл ответа в выбранных гайдах.'));assert(!missing.includes('в паттернах АБМ'));
 assert.throws(()=>renderAbmResponse({answers:[{question:q,kind:'answer',evidence:[{file:'patterns/p_abm_buttons.md',ruleId:'R01',quote:'Кнопка запускает действие.',text:'Неподходящий источник.'}]}]},f.root,q,p),error=>error.code==='ABM_EVIDENCE_OUTSIDE_PACKET');
});
