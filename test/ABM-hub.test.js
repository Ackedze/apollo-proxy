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
test('guides use separate bounded lanes and respect explicit guide or Material version requests',t=>{
 const f=fixture(t);
 for(const [q,platform,family] of [['Buttons accessibility HIG','iOS','hig'],['Buttons accessibility Material 2','Android','material2'],['Buttons accessibility Material 3','Android','material3']]){
  const packet=buildAbmKnowledgePacket(f.source(),q,[],{platform});const guides=packet.rules.filter(row=>row.sourceType==='guide');
  assert(guides.length,q);assert(guides.every(row=>row.family===family),q);assert(packet.rules[0].sourceType==='pattern');
  assert(packet.chars<=MAX_PACKET_CHARS);assert.equal(packet.chars,JSON.stringify(knowledgePayload(packet)).length);
  assert(!guides.some(row=>row.text.includes('Old publication history')));
 }
 const contradiction=buildAbmKnowledgePacket(f.source(),'Buttons HIG',[],{platform:'Android'});
 assert(contradiction.rules.some(row=>row.sourceType==='guide'&&row.family==='hig'));
 const ios=buildAbmKnowledgePacket(f.source(),'Buttons accessibility',[],{platform:'iOS'});
 const android=buildAbmKnowledgePacket(f.source(),'Buttons accessibility',[],{platform:'Android'});
 assert.deepEqual(ios,android);
 assert.deepEqual(new Set(ios.rules.filter(row=>row.sourceType==='guide').map(row=>row.family)),new Set(['hig','material2','material3']));
 const materialOnIos=buildAbmKnowledgePacket(f.source(),'Buttons Material 3',[],{platform:'iOS'});
 assert(materialOnIos.rules.some(row=>row.sourceType==='guide'&&row.family==='material3'));
});
test('guide citations are checked and captions never invent a pattern version or platform example',t=>{
 const f=fixture(t),q='Buttons accessibility HIG',packet=buildAbmKnowledgePacket(f.source(),q,[],{platform:'iOS'});
 const row=packet.rules.find(row=>row.sourceType==='guide'&&row.text.includes('accessible name'));
 const answer={answers:[{question:q,kind:'answer',evidence:[{file:row.file,ruleId:row.ruleId,quote:row.text,text:'У кнопки должно быть доступное имя.'}]}]};
 const text=renderAbmResponse(answer,f.root,q,packet);assert(text.includes('Гайд: HIG — [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)'));assert(!text.includes('Паттерн:'));assert(!text.includes('Пример'));
 answer.answers[0].evidence[0].quote='Invented guideline sentence';assert.throws(()=>renderAbmResponse(answer,f.root,q,packet),e=>e.code==='ABM_QUOTE_MISMATCH');
});
test('guide modifications change source identity and foreign products and symlinks are rejected',t=>{
 const f=fixture(t),before=f.source();const p=path.join(f.root,'guides/hig/g_hig_buttons.md');fs.appendFileSync(p,'\nAdditional condition.');assert.notEqual(before.contentSha256,f.source().contentSha256);
 const body=fs.readFileSync(p,'utf8');fs.writeFileSync(p,body.replace('product: abm','product: ab'));assert.throws(()=>f.source(),e=>e.status===503);fs.writeFileSync(p,body);
 fs.symlinkSync(p,path.join(f.root,'guides/hig/g_hig_alias.md'));assert.throws(()=>f.source(),e=>e.status===503);
 assert.equal(loadPattern(f.root,'../outside.md'),null);
});

test('structured guide blocks group each family separately after product rules and match legacy Markdown',t=>{
 const f=fixture(t),q='Buttons HIG Material 2 Material 3';
 const files=['guides/hig/g_hig_buttons.md','guides/material2/g_material2_buttons.md','guides/material3/g_material3_buttons.md','patterns/p_abm_buttons.md'];
 const documents=files.map(file=>loadPattern(f.root,file));
 const rows=documents.map(doc=>({file:doc.file,ruleId:doc.rules[0].key}));
 const evidence=documents.map(doc=>({file:doc.file,ruleId:doc.rules[0].key,quote:doc.rules[0].body,text:doc.rules[0].body}));
 let blocks;
 const text=renderAbmResponse({answers:[{question:q,kind:'answer',evidence}]},f.root,q,{rules:rows},{onBlocks:value=>{blocks=value;}});
 assert.equal(blocks[0].kind,'text');assert(blocks[0].text.includes('Паттерн:'));
 assert.deepEqual(blocks.filter(b=>b.kind==='guide').map(b=>b.family),['hig','material2','material3']);
 assert.equal(blocks.map(block=>block.text).join('\n\n'),text);
});

test('multiple questions preserve guide ownership in structured blocks',t=>{
 const f=fixture(t),doc=loadPattern(f.root,'guides/hig/g_hig_buttons.md'),rule=doc.rules[0],q='Первый вопрос? Второй вопрос?';let blocks;
 const value={answers:[{question:'Первый вопрос?',kind:'answer',evidence:[{file:doc.file,ruleId:rule.key,quote:rule.body,text:rule.body}]},{question:'Второй вопрос?',kind:'not_found',evidence:[]}]};
 const text=renderAbmResponse(value,f.root,q,{rules:[{file:doc.file,ruleId:rule.key}]},{onBlocks:value=>{blocks=value;}});
 assert.equal(blocks.find(b=>b.kind==='guide').question,'Первый вопрос?');
 assert.equal(blocks[0].questionHeading,true);assert.equal(blocks.map(b=>b.text).join('\n\n'),text);
});

test('guide links bind to the exact source identity and official family, without unrelated or invented destinations',()=>{
 const {guideUrl,safeGuideUrl}=require('../src/reports/ABM-guide-links');
 const url=guideUrl({family:'hig',guideId:'guide:hig.playing-haptics',title:'Playing haptics'});
 assert.equal(url,'https://developer.apple.com/design/human-interface-guidelines/playing-haptics');
 assert.equal(guideUrl({family:'hig',guideId:'guide:hig.playing-haptics',title:'Different guide'}),null);
 assert.equal(guideUrl({family:'hig',guideId:'guide:hig.unknown',title:'Unknown'}),null);
 assert.equal(safeGuideUrl('javascript:alert(1)','hig'),null);
 assert.equal(safeGuideUrl('https://developer.apple.com.evil.test/design/human-interface-guidelines/buttons','hig'),null);
 assert.equal(safeGuideUrl('https://m3.material.io/foundations','material2'),null);
 assert.equal(safeGuideUrl('https://developer.apple.com/documentation/UIKit','hig'),null);
 assert.equal(safeGuideUrl('https://m2.material.io/design/navigation/understanding-navigation.html','material2'),'https://m2.material.io/design/navigation/understanding-navigation.html');
 assert.equal(guideUrl({family:'material3',guideId:'guide:material3.designing.structure',title:'Designing — Structure'}),'https://m3.material.io/foundations/designing/structure');
});


test('Russian guide prose preserves source terms and units while grounding stays in the original language',t=>{
 const f=fixture(t),file='guides/material3/g_material3_buttons.md';
 const quote='Keep a touch target of at least 48 dp. An outlined button may represent a secondary action.';
 fs.appendFileSync(path.join(f.root,file),'\n## Touch targets\n'+quote+'\n');
 const q='Buttons Material 3 touch target',packet=buildAbmKnowledgePacket(f.source(),q);
 const row=packet.rules.find(row=>row.file===file&&row.text.includes(quote));
 assert(row);
 const translated='Сохраняй область касания (touch target) не меньше **48 dp**. Кнопка outlined может обозначать дополнительное действие (secondary action).';
 const value={answers:[{question:q,kind:'answer',evidence:[{file,ruleId:row.ruleId,quote,text:translated}]}]};
 let blocks;
 const text=renderAbmResponse(value,f.root,q,packet,{onBlocks:value=>{blocks=value;}});
 assert.equal(blocks.length,1);assert.equal(blocks[0].kind,'guide');assert.equal(blocks[0].family,'material3');
 assert(text.startsWith(translated+'\n\nГайд: Material 3'));
 assert(!text.includes(quote));assert.equal(blocks[0].text,text);
 // Translating the evidence itself must never bypass exact source verification.
 value.answers[0].evidence[0].quote=translated;
 assert.throws(()=>renderAbmResponse(value,f.root,q,packet),e=>e.code==='ABM_QUOTE_MISMATCH');
});
