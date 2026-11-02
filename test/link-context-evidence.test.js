'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const base=require('../src/reports/progressbar-pilot'),pilot=require('../src/reports/component-pattern-pilot'),evidence=require('../src/reports/link-context-evidence');
const {fixture,payload,rehash,answer,updateEvidence}=require('./helpers/component-patterns');
const clone=x=>JSON.parse(JSON.stringify(x)),available=value=>({status:'available',value}),unsupported=()=>({status:'not-supported',value:null});
const collectionKey='c'.repeat(40),colors=evidence.COLOR_NAMES.map((name,i)=>({name,key:String(i+1).repeat(40),resolvedType:'COLOR'}));
function fact(n){return{nodeId:n.id,fills:unsupported(),propertyReferences:available(null),componentProperties:unsupported(),textSegments:unsupported(),reactions:available([]),annotations:available([])};}
function enrich(c){c.schemaVersion='apollo.progressbar-capture.v2';c.contextEvidence={schemaVersion:evidence.SCHEMA,nodes:c.nodes.map(fact)};return rehash(c);}
function paint(){return{type:'SOLID',visible:true,opacity:1,color:{r:0,g:0,b:1},binding:{id:'semantic',status:'available',chain:[{id:'semantic',key:colors[0].key,name:colors[0].name,remote:true,collection:{id:'collection',key:collectionKey,name:'Interface Dynamic',modeId:'light',modeName:'Light'},aliasId:null,color:{r:0,g:0,b:1,a:1}}]}};}
async function sources(f){
  await f.write(path.join(f.options.designSystemRoot,evidence.COLOR_PATH),JSON.stringify({collections:[{key:collectionKey,variables:colors}],opaque:'Do not send the catalog body'}));
  for(const [i,p] of evidence.HOST_PATHS.entries())await f.write(path.join(f.options.designSystemRoot,p),JSON.stringify({contracts:[{id:'host-'+i,name:i===0?'Notification':'Host '+i,status:'active',componentKey:'d'.repeat(40),figma:{variants:{variantKeys:[{key:'e'.repeat(40),properties:{Inverted:'False'}}]},anatomy:[{name:'Caption',type:'TEXT',path:'Root / Text / Caption'},{name:'Button',type:'FRAME',path:'Root / Button'}]}}]}));
  for(const spec of evidence.SUPPORTING_PATTERNS)await f.write(path.join(f.options.designSystemRoot,spec.path),'- patternId: '+spec.id+'\n- status: active\n\n## Section 5: Synthetic host context\n\nHost text structure.\n\n## Section 6: Rules\n\n'+(spec.rules||[]).map((id,i)=>'### Rule '+(i+1)+': Synthetic host norm\n- ruleId: '+id+'\n\nComplete contextual host norm.\n').join('\n')+'\n## Section 7: Examples\n');
}
test('v2 evidence is strictly validated and survives preparation alongside all eight Link rules; legacy v1 stays compatible',async t=>{
  const f=await fixture(t,pilot.LINK_PILOT);await sources(f);
  const c=enrich(f.capture([{contract:'link.universal',text:'Help'}])),label=c.contextEvidence.nodes.at(-1);
  label.fills=available([paint()]);label.textSegments=available([{start:0,end:4,fills:available([paint()]),hyperlink:{type:'URL',value:'https://example.test/help'},textDecoration:'NONE'}]);rehash(c);
  assert.equal(base.validatePilotRequest(payload(c,pilot.LINK_PILOT)),null);
  const packet=await base.preparePilot(payload(c,pilot.LINK_PILOT),f.options);
  assert.equal(packet.subjects[0].ruleIds.length,8);assert.deepEqual(packet.capture.contextEvidence,c.contextEvidence);
  assert.equal(packet.sources.find(s=>s.sourceId==='link-color-tokens').colorTokens[0].key,colors[0].key);
  assert.equal(JSON.stringify(packet).includes('Do not send the catalog body'),false);
  assert.doesNotThrow(()=>base.validatePilotResponse(answer(packet),packet));
  for(const mode of [base.PILOT,pilot.PILOT,pilot.LINK_PILOT]){
    const input=payload(f.capture([{contract:mode===pilot.LINK_PILOT?'link.universal':'progress-bar-goal.desktop'}]),mode);
    assert.equal(base.validatePilotRequest(input),null);assert.ok(await base.preparePilot(input,f.options));
  }
});
test('malformed/foreign/mixed-range/alias-cycle evidence refuses at the request boundary before model work',async t=>{
  const f=await fixture(t,pilot.LINK_PILOT),c=enrich(f.capture([{contract:'link.universal',text:'Help'}]));
  for(const mutate of [
    x=>x.contextEvidence.nodes.pop(),
    x=>{x.contextEvidence.nodes[0].nodeId='9:9';},
    x=>{x.contextEvidence.nodes[0].inventedSlot='Caption';},
    x=>{x.contextEvidence.nodes.at(-1).textSegments=available([{start:1,end:4,fills:available([]),hyperlink:null,textDecoration:'NONE'}]);},
    x=>{const p=paint();p.binding.chain[0].aliasId='semantic';p.binding.chain[0].color=null;x.contextEvidence.nodes.at(-1).fills=available([p]);},
    x=>{const p=paint();p.binding.chain[0].key='not-a-key';x.contextEvidence.nodes.at(-1).fills=available([p]);},
    x=>{x.contextEvidence.nodes[0].annotations=available([{label:'x'.repeat(4001),labelMarkdown:''}]);},
  ]){const changed=clone(c);mutate(changed);rehash(changed);assert.equal(base.validatePilotRequest(payload(changed,pilot.LINK_PILOT)),'PATTERN_CONTEXT_EVIDENCE_INVALID');}
});
test('a v2 capture without Link never requires Link-only color, host or supporting norm files',async t=>{
  const f=await fixture(t,pilot.LINK_PILOT),c=enrich(f.capture([{contract:'progress-bar-goal.desktop'}]));
  const packet=await base.preparePilot(payload(c,pilot.LINK_PILOT),f.options);
  assert.equal(packet.subjects[0].family,'progressbar');assert.equal(packet.sources.some(s=>s.sourceId.startsWith('link-host')||s.sourceId==='link-color-tokens'),false);
  await base.assertSourceCurrent(packet,f.options);
});
test('a verified Notification host exposes Button property path separately from wrapped Caption; sibling Link evidence remains forbidden',async t=>{
  const f=await fixture(t,pilot.LINK_PILOT);await sources(f);
  const c=f.capture([{contract:'link.universal',parent:'1:5'},{contract:'link.universal',parent:'1:3'}]);
  c.nodes.splice(2,0,{id:'1:3',parentId:'1:1',type:'INSTANCE',name:'Renamed host',visible:true,component:{key:'e'.repeat(40),setKey:'d'.repeat(40),name:'Notification',variants:{Inverted:'False'}}},
    {id:'1:4',parentId:'1:3',type:'FRAME',name:'Renamed text wrapper',visible:true},{id:'1:6',parentId:'1:4',type:'TEXT',name:'Renamed caption',text:'Processing the application',visible:true},
    {id:'1:5',parentId:'1:3',type:'FRAME',name:'Caption misleading name',visible:true});
  enrich(c);c.contextEvidence.nodes.find(n=>n.nodeId==='1:3').componentProperties=available([{name:'Button#5:7',type:'BOOLEAN',value:true},{name:'CaptionContent#5:4',type:'TEXT',value:'Processing the application'}]);
  c.contextEvidence.nodes.find(n=>n.nodeId==='1:5').propertyReferences=available({visible:'Button#5:7'});
  c.contextEvidence.nodes.find(n=>n.nodeId==='1:6').propertyReferences=available({characters:'CaptionContent#5:4'});rehash(c);
  const packet=await base.preparePilot(payload(c,pilot.LINK_PILOT),f.options),subject=packet.subjects[0];
  assert.equal(subject.linkContext.hostNodeId,'1:3');assert.ok(subject.contextNodeIds.includes('1:6'));assert.equal(subject.contextNodeIds.includes('1:21'),false);
  assert.equal(subject.linkContext.slotPath[0].propertyReferences.value.visible,'Button#5:7');
  const result=answer(packet),item=result.assessments[0];item.ruleResults[0].evidenceNodeIds.push('1:6');updateEvidence(item);assert.doesNotThrow(()=>base.validatePilotResponse(result,packet));
  item.ruleResults[0].evidenceNodeIds.push('1:21');updateEvidence(item);assert.throws(()=>base.validatePilotResponse(result,packet),/FOREIGN_CONTEXT/);
});
test('canonical token and host structural sources are pinned and rechecked; a same-name variable never changes the canonical allowlist',async t=>{
  const f=await fixture(t,pilot.LINK_PILOT);await sources(f);
  const c=enrich(f.capture([{contract:'link.universal'}])),p=paint();p.binding.chain[0].key='f'.repeat(40);p.binding.chain[0].remote=false;
  c.contextEvidence.nodes.at(-1).fills=available([p]);rehash(c);
  const packet=await base.preparePilot(payload(c,pilot.LINK_PILOT),f.options);
  assert.notEqual(packet.capture.contextEvidence.nodes.at(-1).fills.value[0].binding.chain[0].key,packet.sources.find(s=>s.sourceId==='link-color-tokens').colorTokens[0].key);
  await fs.appendFile(path.join(f.options.designSystemRoot,evidence.COLOR_PATH),'\n');await assert.rejects(base.assertSourceCurrent(packet,f.options),/SOURCE_STALE/);
  await sources(f);const current=await base.preparePilot(payload(c,pilot.LINK_PILOT),f.options);
  await fs.appendFile(path.join(f.options.designSystemRoot,evidence.HOST_PATHS[0]),'\n');await assert.rejects(base.assertSourceCurrent(current,f.options),/SOURCE_STALE/);
  await sources(f);const withNorms=await base.preparePilot(payload(c,pilot.LINK_PILOT),f.options);
  assert.ok(withNorms.sources.find(s=>s.sourceId==='link-host-norm-0').supportingRuleIds.includes('rule:layout.islands.pseudo-links'));
  await fs.appendFile(path.join(f.options.designSystemRoot,evidence.SUPPORTING_PATTERNS[0].path),'\n');await assert.rejects(base.assertSourceCurrent(withNorms,f.options),/SOURCE_STALE/);
});
test('prompt uses native token/slot/prototype facts while distinguishing design declarations, unknown approvals and runtime effect',async t=>{
  const f=await fixture(t,pilot.LINK_PILOT);await sources(f);const c=enrich(f.capture([{contract:'link.universal'}]));
  const packet=await base.preparePilot(payload(c,pilot.LINK_PILOT),f.options),prompt=base.promptForPilot(packet);
  for(const fragment of ['binding.chain','collectionKey','subject.linkContext','propertyReferences','action-slot','textSegments.hyperlink','Conditional','unavailable'])assert.ok(prompt.includes(fragment),fragment);
  assert.match(prompt,/design declarations/);assert.match(prompt,/не доказательство работающего frontend/);
});
test('host catalogs above the legacy 2MiB read budget load with the explicit bounded catalog budget',async t=>{
  const f=await fixture(t,pilot.LINK_PILOT);await sources(f);
  const p=path.join(f.options.designSystemRoot,evidence.HOST_PATHS[5]),document=JSON.parse(await fs.readFile(p));
  document.opaque='x'.repeat(3*1024*1024);await fs.writeFile(p,JSON.stringify(document));
  await assert.rejects(base.readSource(f.options.designSystemRoot,evidence.HOST_PATHS[5],'test'),/SOURCE_INVALID/);
  const c=enrich(f.capture([{contract:'link.universal'}]));assert.ok(await base.preparePilot(payload(c,pilot.LINK_PILOT),f.options));
  await assert.rejects(base.readSource(f.options.designSystemRoot,evidence.HOST_PATHS[5],'test',9*1024*1024),/SOURCE_INVALID/);
});
