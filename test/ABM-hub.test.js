'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {inspectAbmPatternKnowledge}=require('../src/knowledge-root');
const {loadPattern}=require('../src/reports/ABM-source');
const {buildAbmKnowledgePacket,knowledgePayload,MAX_PACKET_CHARS}=require('../src/reports/ABM-retrieval');
const {renderAbmResponse}=require('../src/reports/ABM-response');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'abm-hub-test-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 function write(file,text){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text);}
 write('patterns/p_abm_buttons.md','---\nid: ptrn:abm.buttons\nproduct: abm\nplatforms: [ios, android]\n---\n# Buttons\n- abmDocumentType: Pattern\n- abmPatternID: ptrn:ux.buttons\n- abmPatternTitle: Buttons\n- titlePage: Кнопки :: v.1.7\n- version: v.1.7\n\n## Нейминг в кнопках\n### [Rule] R01_naming\nПодпись кнопки соответствует действию.\n#### [RuleExample] R01_naming\nСсылка на [RuleExample] R01_naming (iOS): https://example.test/ios\n');
 for(const family of ['hig','material2','material3'])write('guides/'+family+'/g_'+family+'_buttons.md',
  '---\nid: abm.guides.'+family+'.buttons\nproduct: abm\nplatforms: ['+(family==='hig'?'ios':'android')+']\n---\n# Buttons\n- documentType: PlatformGuide\n- guideID: guide:'+family+'.buttons\n\nA button initiates an action.\n## Accessibility\nButtons need an accessible name.\n## Change log\nOld publication history.\n');
 return {root,write,source:()=>inspectAbmPatternKnowledge(root)};
}
test('Hub source reads product metadata and keeps real versions, rules and examples',t=>{
 const f=fixture(t),source=f.source();assert.equal(source.patternCount,1);assert.equal(source.guideCount,3);assert.equal(source.source,'ds-ai-hub-abm');
 const doc=loadPattern(f.root,'patterns/p_abm_buttons.md');assert.equal(doc.title,'Кнопки');assert.equal(doc.version,'v.1.7');assert.equal(doc.rules[0].key,'R01_naming');
 const packet=buildAbmKnowledgePacket(source,'Нейминг кнопок',[],{platform:'iOS'});
 assert(packet.rules.some(rule=>rule.file==='patterns/p_abm_buttons.md'));
 const text=renderAbmResponse({answers:[{question:'Нейминг кнопок',kind:'answer',evidence:[{file:doc.file,ruleId:'R01_naming',quote:'Подпись кнопки соответствует действию.',text:'Подпись кнопки соответствует действию.'}]}]},f.root,'Нейминг кнопок',packet);
 assert(text.includes('🍏 [Пример](https://example.test/ios)'));assert(text.includes('Паттерн: «Кнопки», v.1.7'));
});
test('guides use a separate bounded lane, respect platform and explicit Material versions',t=>{
 const f=fixture(t);
 for(const [q,platform,family] of [['Buttons accessibility HIG','iOS','hig'],['Buttons accessibility Material 2','Android','material2'],['Buttons accessibility Material 3','Android','material3']]){
  const packet=buildAbmKnowledgePacket(f.source(),q,[],{platform});const guides=packet.rules.filter(row=>row.sourceType==='guide');
  assert(guides.length,q);assert(guides.every(row=>row.family===family),q);assert(packet.rules[0].sourceType==='pattern');
  assert(packet.chars<=MAX_PACKET_CHARS);assert.equal(packet.chars,JSON.stringify(knowledgePayload(packet)).length);
  assert(!guides.some(row=>row.text.includes('Old publication history')));
 }
 const contradiction=buildAbmKnowledgePacket(f.source(),'Buttons HIG',[],{platform:'Android'});
 assert(!contradiction.rules.some(row=>row.sourceType==='guide'));
});
test('guide citations are checked and captions never invent a pattern version or platform example',t=>{
 const f=fixture(t),q='Buttons accessibility HIG',packet=buildAbmKnowledgePacket(f.source(),q,[],{platform:'iOS'});
 const row=packet.rules.find(row=>row.sourceType==='guide'&&row.text.includes('accessible name'));
 const answer={answers:[{question:q,kind:'answer',evidence:[{file:row.file,ruleId:row.ruleId,quote:row.text,text:'У кнопки должно быть доступное имя.'}]}]};
 const text=renderAbmResponse(answer,f.root,q,packet);assert(text.includes('Гайд: HIG — «Buttons»'));assert(!text.includes('Паттерн:'));assert(!text.includes('Пример'));
 answer.answers[0].evidence[0].quote='Invented guideline sentence';assert.throws(()=>renderAbmResponse(answer,f.root,q,packet),e=>e.code==='ABM_QUOTE_MISMATCH');
});
test('guide modifications change source identity and foreign products and symlinks are rejected',t=>{
 const f=fixture(t),before=f.source();const p=path.join(f.root,'guides/hig/g_hig_buttons.md');fs.appendFileSync(p,'\nAdditional condition.');assert.notEqual(before.contentSha256,f.source().contentSha256);
 const body=fs.readFileSync(p,'utf8');fs.writeFileSync(p,body.replace('product: abm','product: ab'));assert.throws(()=>f.source(),e=>e.status===503);fs.writeFileSync(p,body);
 fs.symlinkSync(p,path.join(f.root,'guides/hig/g_hig_alias.md'));assert.throws(()=>f.source(),e=>e.status===503);
 assert.equal(loadPattern(f.root,'../outside.md'),null);
});
