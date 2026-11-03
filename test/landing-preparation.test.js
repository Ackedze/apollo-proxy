'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createLandingService}=require('../src/landing/service');
const ids=['hero','benefits','steps','faq','cta'];
const plan={host:{componentKey:'fixture-host'},facts:[{id:'confirmed',quote:'Fixture fact'}],decisions:['Preserve'],openSelections:['Fixture asset still requires a source'],sections:ids.map(id=>({id,nodeId:null,role:id,props:{view:'Fixture'},assets:[],sourceIds:['fixture-norm']}))};
const target={fileKey:'FixtureFile',pageId:'0:1',rootNodeId:'1:1',ownerNonce:'a'.repeat(64),leaseNonce:'b'.repeat(64)};
const snapshot=sections=>{
 const nodes=[{id:target.rootNodeId,parentId:target.pageId,type:'FRAME',name:'Owned root',role:'',sectionId:null},{id:'host',parentId:target.rootNodeId,type:'INSTANCE',name:'Fixture host',role:'host',sectionId:null,componentKey:'fixture-host'},{id:'body',parentId:'host',type:'SLOT',name:'Body',role:'body',sectionId:null}].concat(sections.map(row=>({id:row.id,parentId:'body',type:'INSTANCE',name:row.sectionId,role:'',sectionId:row.sectionId,componentKey:'fixture-section'})));
 return {rootNodeId:target.rootNodeId,pageId:target.pageId,ownerNonce:target.ownerNonce,leaseNonce:target.leaseNonce,outsideHash:'c'.repeat(64),nodeCount:nodes.length,instanceCount:1+sections.length,sections,text:'Fixture',coverage:'tagged-sections-and-text',native:{schemaVersion:'apollo.landing-native.v1',nodes}};
};
function fixture(t,{reads=14,partials=2}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-preparation-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const calls=[],state={build:false,last:null},source={id:'fixture',knowledgeVersion:'fixture',resumePin:'e'.repeat(64),skill:{id:'ab-generate-custom-landing',version:'0.3.1',sha256:'d'.repeat(64),generation:{platforms:['desktop']}},assertCurrent(){},list(query,offset=0){return {query,offset,total:0,next:null,resources:[]};},read(){throw Error('Unexpected resource');},initial:{instructions:'Fixture',norms:[],workflow:[],resources:{resources:[]}}};let partialCount=0;
 const service=createLandingService({root,knowledge:()=>source,createCli:()=>({run:async options=>{
  calls.push(options);const ctx=JSON.parse(options.prompt.split('\n').at(-1));let result;
  if(options.profile==='landing-plan'){const kind=state.build||calls.length>reads?'build':'list_resources';result={kind,message:kind,specJson:JSON.stringify(plan),query:'fixture-'+calls.length,offset:0,resources:[],resultJson:'{}'};}
  else {const id=ctx.execution.activeSectionId,partial=id==='hero'&&partialCount++<partials,kind=ctx.execution.stage==='verify'?'finish':'continue';result={kind,message:kind,sectionPatch:id&&!partial?{sectionId:id,nodeId:'2:'+ids.indexOf(id)}:null,query:'',offset:0,resources:[],resultJson:JSON.stringify(kind==='finish'?{summary:'Fixture',checks:[{verdict:'PASS',evidence:'Synthetic test only',critical:true}],visualReviews:ctx.execution.screenshots.map(shot=>({scope:shot.sectionId||'page',callId:shot.callId,modelStep:shot.modelStep,verdict:'PASS',evidence:'Synthetic image review'}))}:{checkpoint:{sectionId:id,status:partial?'partial':'complete',nextAction:'Fixture next'}})};}
  if(options.profile==='landing-figma'&&ctx.execution.stage!=='bootstrap'){const id=ctx.execution.activeSectionId;options.onEvent({type:'item.completed',item:{type:'mcp_tool_call',id:'shot-'+calls.length,tool:'get_screenshot',status:'completed',arguments:{nodeId:id?'2:'+ids.indexOf(id):target.rootNodeId},result:{content:[{type:'image',mimeType:'image/png',data:'c3ludGhldGlj'}]}}});if(result.kind==='finish'){const report=JSON.parse(result.resultJson);report.visualReviews.push({scope:'page',callId:'shot-'+calls.length,modelStep:calls.length,verdict:'PASS',evidence:'Synthetic page review'});result.resultJson=JSON.stringify(report);}}
  state.last=result;return {result,receipt:{usage:{measurementId:'fixture-'+calls.length},mcp:{toolCalls:0}}};
 }})});
 const chat=service.create({fileKey:target.fileKey,pageId:target.pageId});
 const submit=async()=>{const r=service.poll(chat.id);service.submit(chat.id,{requestId:crypto.randomUUID(),revision:r.revision,text:'Fixture'});await service.whenSettled(chat.id);return service.poll(chat.id);};
 return {service,chat,calls,state,submit};
}
test('five-section preparation stops before spending reserved write calls and retains the exact unresolved plan',async t=>{
 const h=fixture(t),r=await h.submit();assert.equal(r.status,'interrupted');assert.equal(r.error.code,'LANDING_PREPARATION_BUDGET');assert.equal(h.calls.length,14);assert.equal(r.target,null);assert.deepEqual(r.spec.facts,plan.facts);assert.deepEqual(r.spec.openSelections,plan.openSelections);assert.equal(r.planning.reservedSteps,10);assert.equal(r.planning.limit,14);assert.equal(r.error.diagnostic.unresolved[0],plan.openSelections[0]);
 const stored=JSON.parse(fs.readFileSync(path.join(h.calls[0].workspace,'../../'+h.chat.id+'.json')));assert.equal(stored.readerState.indexes.length,14);
 h.state.build=true;const resumed=await h.submit();assert.equal(resumed.status,'awaiting-canvas');assert.equal(resumed.planning.usedSteps,1);assert.equal(JSON.parse(h.calls.at(-1).prompt.split('\n').at(-1)).indexes.length,14);
});
test('a prepared five-section plan leaves room for bootstrap, all sections, verify and two partial turns within24',async t=>{
 const h=fixture(t,{reads:13}),start=await h.submit();assert.equal(start.status,'awaiting-canvas');h.service.canvas(h.chat.id,{revision:start.revision,target,readback:snapshot([])});await h.service.whenSettled(h.chat.id);let r=h.service.poll(h.chat.id),sections=[],turns=0;
 while(r.status==='awaiting-readback'){
  if(h.state.last.sectionPatch){const p=h.state.last.sectionPatch;if(!sections.some(s=>s.sectionId===p.sectionId))sections.push({id:p.nodeId,sectionId:p.sectionId,fingerprint:crypto.createHash('sha256').update(p.sectionId).digest('hex')});}
  h.service.observation(h.chat.id,{revision:r.revision,readback:snapshot(sections)});await h.service.whenSettled(h.chat.id);r=h.service.poll(h.chat.id);assert(++turns<20);
 }
 assert.equal(r.status,'completed',JSON.stringify(r.result?.verification||r.error));assert.equal(h.calls.length,23);assert.equal(r.execution.completed.length,5);assert.equal(r.result.Ready,false);assert.deepEqual(r.spec.facts,plan.facts);assert.deepEqual(r.spec.sections.map(s=>s.props),plan.sections.map(s=>s.props));
});
