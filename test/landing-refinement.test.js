'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('../src/landing/checkpoints');
const copy=v=>JSON.parse(JSON.stringify(v)),source={id:'workflow/api',sha256:'a'.repeat(64),path:[],offset:123,mode:'read',text:'Public API signature'};
const state={stage:'section',activeSectionId:'hero',sourcePin:'pin'},spec={facts:['confirmed'],sections:[{id:'hero',slots:{Title:'Confirmed copy'},props:{View:'Page'}},{id:'benefits',nodeId:'2:2'}]},readback={sections:[],text:'Stable'},point={sectionId:'hero',status:'partial',nextAction:'Apply API decision'};
const patch={sectionId:'hero',baseRevision:0,sources:[{id:source.id,sha256:source.sha256,path:[],offset:123,observation:'API signature read at pinned range'}],decision:'Use the documented public API for this section.'};
test('technical decision is append-only, source-linked and needs unchanged readback before admission',()=>{
 const admitted=cp.refinement(state,{technicalPatch:patch},point,null,[source],0),before=copy(spec),after=cp.refine(spec,state,admitted,readback,readback);
 assert.deepEqual(spec,before);assert.deepEqual(after.facts,spec.facts);assert.deepEqual(after.sections[0].slots,spec.sections[0].slots);assert.deepEqual(after.sections[0].props,spec.sections[0].props);assert.deepEqual(after.sections[1],spec.sections[1]);assert.equal(after.sections[0].technicalDecisions[0].revision,1);assert.equal(after.sections[0].technicalDecisions[0].origin,'agent-source-interpretation');assert.throws(()=>cp.refine(after,state,admitted,readback,readback),{code:'LANDING_TECHNICAL_REVISION_STALE'});
 assert.throws(()=>cp.refine(spec,state,admitted,readback,{...readback,text:'Changed'}),{code:'LANDING_TECHNICAL_CANVAS_CHANGED'});
});
for(const attack of ['other-section','bootstrap','write-in-turn','node-binding','complete','extra-field','unread','wrong-hash','wrong-range','failed-read'])test('technical refinement refuses '+attack,()=>{
 const value=copy(patch),st=copy(state),pt=copy(point);let binding=null,tools=0,reads=[copy(source)];
 if(attack==='other-section')value.sectionId='benefits';if(attack==='bootstrap')st.stage='bootstrap';if(attack==='write-in-turn')tools=1;if(attack==='node-binding')binding={sectionId:'hero',nodeId:'1:1'};if(attack==='complete')pt.status='complete';if(attack==='extra-field')value.slots={Title:'Invented'};if(attack==='unread')reads=[];if(attack==='wrong-hash')value.sources[0].sha256='b'.repeat(64);if(attack==='wrong-range')value.sources[0].offset=0;if(attack==='failed-read')reads[0].error='failed';
 assert.throws(()=>cp.refinement(st,{technicalPatch:value},pt,binding,reads,tools),{code:['unread','wrong-hash','wrong-range','failed-read'].includes(attack)?'LANDING_TECHNICAL_SOURCE_UNCONFIRMED':'LANDING_TECHNICAL_PATCH_INVALID'});
});
test('API observations are bounded agent reports, not replacement plans or independent proof',()=>{
 assert.deepEqual(cp.apiObservations({apiObservations:['Observed actual public property']}),['Observed actual public property']);for(const rows of [[{}],Array(9).fill('x'),['x'.repeat(1501)]])assert.throws(()=>cp.apiObservations({apiObservations:rows}),{code:'LANDING_API_OBSERVATIONS_INVALID'});
});
test('native scope protects host and other sections while allowing active section and automatic geometry',()=>{
 const node=(id,sectionId=null)=>({id,sectionId,parentId:'root',componentKey:id,width:100}),before={sections:[],native:{nodes:[node('host'),node('active','hero'),node('other','benefits')]}},after=copy(before);after.native.nodes[0].width=200;after.native.nodes[1].componentKey='changed';cp.protect(state,before,after);
 after.native.nodes[0].componentKey='changed';assert.throws(()=>cp.protect(state,before,after),{code:'LANDING_SECTION_SCOPE_CHANGED'});after.native.nodes[0].componentKey='host';after.native.nodes.push(node('unassigned'));assert.throws(()=>cp.protect(state,before,after),{code:'LANDING_SECTION_SCOPE_CHANGED'});
});

test('service persists refinement only after host observation, carries API findings, and keeps chat revision/whole plan',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{createLandingService}=require('../src/landing/service');
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-refinement-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const target={fileKey:'FixtureFile',pageId:'page',rootNodeId:'root',ownerNonce:'a'.repeat(64),leaseNonce:'b'.repeat(64)},nodes=[{id:'root',parentId:'page',type:'FRAME',name:'Root',role:'',sectionId:null}],observation={rootNodeId:'root',pageId:'page',ownerNonce:target.ownerNonce,leaseNonce:target.leaseNonce,outsideHash:'c'.repeat(64),nodeCount:1,instanceCount:0,sections:[],text:'',coverage:'tagged-sections-and-text',native:{schemaVersion:'apollo.landing-native.v1',nodes}};
 const calls=[],plan=copy(spec),knowledge={id:'fixture',knowledgeVersion:'fixture',resumePin:'pin',skill:{generation:{},version:'0.3.2',sha256:'fixture'},assertCurrent(){},initial:{norms:[source],instructions:{},workflow:[],resources:[]}};
 const service=createLandingService({root,knowledge:()=>knowledge,createCli:()=>({run:async options=>{
  const ctx=JSON.parse(options.prompt.split('\n').at(-1));calls.push(ctx);const kind=calls.length===1?'build':calls.length===4?'question':'continue',result={kind,message:'Fixture',query:'',offset:0,resources:[],resultJson:'{}'};
  if(kind==='build')result.specJson=JSON.stringify(plan);else result.sectionPatch=null;
  if(calls.length===2)result.resultJson=JSON.stringify({checkpoint:{sectionId:null,status:'complete',nextAction:'Hero'},apiObservations:['Actual API inspection retained as agent report']});
  if(calls.length===3)result.resultJson=JSON.stringify({checkpoint:point,technicalPatch:patch});
  return {result,receipt:{mcp:{toolCalls:0}}};
 }})});const chat=service.create({fileKey:target.fileKey,pageId:target.pageId});service.submit(chat.id,{requestId:crypto.randomUUID(),revision:0,text:'Fixture'});await service.whenSettled(chat.id);service.canvas(chat.id,{revision:1,target,readback:observation});await service.whenSettled(chat.id);service.observation(chat.id,{revision:1,readback:observation});await service.whenSettled(chat.id);
 assert.equal(service.poll(chat.id).spec.sections[0].technicalDecisions,undefined);service.observation(chat.id,{revision:1,readback:observation});await service.whenSettled(chat.id);const final=service.poll(chat.id);assert.equal(final.status,'needs-input');assert.equal(final.revision,1);assert.equal(final.spec.sections[0].technicalDecisions.length,1);assert.deepEqual(final.spec.sections[0].slots,plan.sections[0].slots);assert.deepEqual(final.spec.sections[1],plan.sections[1]);assert.deepEqual(final.spec.facts,plan.facts);assert.equal(calls.at(-1).execution.apiObservations[0].origin,'agent-report');assert.equal(calls.at(-1).spec.sections[0].technicalDecisions[0].decision,patch.decision);
});
