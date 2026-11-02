'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createLandingService,STEP,WRITE_STEP}=require('../src/landing/service'),checkpoints=require('../src/landing/checkpoints');
const copy=v=>JSON.parse(JSON.stringify(v));
const target={fileKey:'FileKey123',pageId:'0:1',rootNodeId:'1:1',ownerNonce:'a'.repeat(64),leaseNonce:'b'.repeat(64)};
const snapshot=rows=>({rootNodeId:'1:1',pageId:'0:1',ownerNonce:target.ownerNonce,leaseNonce:target.leaseNonce,outsideHash:'c'.repeat(64),nodeCount:rows.length+5,instanceCount:rows.length+1,sections:rows,text:'Fixture host',coverage:'tagged-sections-and-text'});
function fullPlan(){return {facts:[{id:'fact',text:'Confirmed'}],decisions:['Keep facts'],sections:['hero','benefits','steps','faq','cta'].map(id=>({id,nodeId:null,component:{name:'Fixture',key:'published-fixture',library:'Fixture library'},role:id,factIds:['fact'],props:{view:'Light'},publicSlots:{title:'Title'},content:{title:'Confirmed '+id},assets:[{key:'fixture-image'}],assetSources:['fixture-source'],rules:['fixture-rule'],checks:['verify'],considered:['Fixture']}))};}
const plan=spec=>({kind:'build',message:'Build',query:'',offset:0,resources:[],specJson:JSON.stringify(spec),resultJson:''});
function write(kind,sectionPatch=null,checkpoint=null){return {kind,message:kind,query:'',offset:0,resources:[],sectionPatch,resultJson:JSON.stringify(checkpoint?{checkpoint}:{summary:'Fixture',checks:[{verdict:'UNKNOWN'}]})};}
function harness(t,firstWrite){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-delta-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const original=fullPlan(),calls=[];
 const source={id:'data1',knowledgeVersion:'k1',skill:{version:'0.3.0',sha256:'s1'},initial:{norms:[],instructions:{},resources:[]},assertCurrent(){}};
 let first=true;const service=createLandingService({root,knowledge:()=>source,createCli:()=>({run:async options=>{
  calls.push(options);const state=JSON.parse(options.prompt.split('\n').at(-1));let result;
  if(options.profile==='landing-plan')result=plan(original);
  else if(first){first=false;result=firstWrite(state);}
  else if(state.execution.stage==='verify')result=write('finish');
  else{const id=state.execution.activeSectionId;result=write('continue',id?{sectionId:id,nodeId:'section:'+id}:null,{sectionId:id,status:'complete',nextAction:'Next unit'});}
  return {result,receipt:{usage:{measurementId:'delta-'+calls.length},mcp:{toolCalls:0}}};
 }})});
 const start=async()=>{let r=service.create({fileKey:'FileKey123',pageId:'0:1'});service.submit(r.id,{requestId:crypto.randomUUID(),revision:r.revision,text:'Fixture brief'});await service.whenSettled(r.id);r=service.poll(r.id);assert.equal(r.status,'awaiting-canvas',JSON.stringify(r.error));service.canvas(r.id,{revision:r.revision,target,readback:snapshot([])});await service.whenSettled(r.id);return service.poll(r.id);};
 return {root,service,original,calls,start};
}
test('write schema has a typed delta and cannot request replacement specJson',()=>{
 assert(STEP.properties.specJson);assert(!WRITE_STEP.properties.specJson);assert.deepEqual(WRITE_STEP.properties.sectionPatch.required,['sectionId','nodeId']);assert.equal(WRITE_STEP.additionalProperties,false);
});
test('lossy legacy fullspec is rejected without losing the accepted plan',async t=>{
 const h=harness(t,state=>({...plan({sections:state.spec.sections.map(({id,component,nodeId})=>({id,component:{name:component.name,key:component.key},nodeId}))}),kind:'continue',resultJson:JSON.stringify({checkpoint:{sectionId:null,status:'partial',nextAction:'Read current root'}})}));const r=await h.start();assert.equal(r.error.code,'LANDING_STEP_INVALID');assert.deepEqual(r.spec.sections,h.original.sections);assert.equal(r.target.rootNodeId,'1:1');
 assert.throws(()=>checkpoints.specScope(r.execution,h.original.sections,h.original.sections.map(({id,component,nodeId})=>({id,component:{name:component.name,key:component.key},nodeId}))),{code:'LANDING_SECTION_SCOPE_CHANGED'},'former guard remains strict');
});
test('partial bootstrap delta survives independent readback and all five sections finish without reserializing the plan',async t=>{
 const h=harness(t,()=>write('continue',null,{sectionId:null,status:'partial',nextAction:'Read current root after uncertain bootstrap'}));let r=await h.start();assert.equal(r.status,'awaiting-readback');assert.deepEqual(r.spec.sections,h.original.sections);const rows=[];
 for(let i=0;i<10&&r.status!=='completed';i++){
  assert.equal(r.status,'awaiting-readback',JSON.stringify(r.error));const id=r.execution.activeSectionId;if(id&&!rows.some(x=>x.sectionId===id))rows.push({sectionId:id,id:'section:'+id,fingerprint:'d'.repeat(64)});
  h.service.observation(r.id,{revision:r.revision,readback:snapshot(rows)});await h.service.whenSettled(r.id);r=h.service.poll(r.id);
 }
 assert.equal(r.status,'completed');assert.equal(r.result.Ready,false);const expected=copy(h.original.sections);for(const s of expected)s.nodeId='section:'+s.id;assert.deepEqual(r.spec.sections,expected);assert.deepEqual(r.spec.facts,h.original.facts);assert.deepEqual(r.spec.decisions,h.original.decisions);assert(h.calls.filter(c=>c.profile==='landing-figma').every(c=>!c.schema.properties.specJson));
});
test('only the active section node binding is admitted and only after matching host readback',()=>{
 const state={stage:'section',activeSectionId:'hero'},spec=fullPlan();
 for(const patch of [{sectionId:'faq',nodeId:'2:1'},{sectionId:'hero',nodeId:'2:1',content:{title:'Overwrite'}},{sectionId:'hero',nodeId:'../secret'},{sectionId:'hero',nodeId:null}])assert.throws(()=>checkpoints.sectionPatch(state,'continue',patch),{code:'LANDING_SECTION_PATCH_INVALID'});
 assert.throws(()=>checkpoints.sectionPatch({...state,stage:'bootstrap'},'continue',{sectionId:'hero',nodeId:'2:1'}),{code:'LANDING_SECTION_PATCH_INVALID'});
 const patch=checkpoints.sectionPatch(state,'continue',{sectionId:'hero',nodeId:'2:1'});assert.throws(()=>checkpoints.confirmPatch(spec,patch,snapshot([])),{code:'LANDING_SECTION_PATCH_UNCONFIRMED'});assert.equal(spec.sections[0].nodeId,null);
 const result=checkpoints.confirmPatch(spec,patch,snapshot([{sectionId:'hero',id:'2:1',fingerprint:'d'.repeat(64)}]));assert.equal(result.sections[0].nodeId,'2:1');assert.deepEqual(result.sections[0].content,spec.sections[0].content);assert.deepEqual(result.sections.slice(1),spec.sections.slice(1));
});
test('unknown and prototype write payload fields do not get merged into the host plan',async t=>{
 const h=harness(t,()=>({...write('continue',null,{sectionId:null,status:'partial',nextAction:'Read'}),spec:{sections:[]}}));const r=await h.start();assert.equal(r.error.code,'LANDING_STEP_INVALID');assert.deepEqual(r.spec.sections,h.original.sections);
 const unsafe=JSON.parse('{"sectionId":"hero","nodeId":"2:1","__proto__":{"polluted":true}}');assert.throws(()=>checkpoints.sectionPatch({stage:'section',activeSectionId:'hero'},'continue',unsafe));assert.equal({}.polluted,undefined);
});
