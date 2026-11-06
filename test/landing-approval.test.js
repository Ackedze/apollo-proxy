'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createLandingService}=require('../src/landing/service'),nativePlan=require('../src/landing/native-plan'),approval=require('../src/landing/structure-approval');
const copy=v=>JSON.parse(JSON.stringify(v)),sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'),key='a'.repeat(40);
const guide={id:'knowledge/data/ds-ai-hub/products/ab/patterns/native-fixture.md',sha256:'b'.repeat(64),path:[],offset:0,mode:'read',text:'Synthetic source: '+key};
const cite=()=>({id:guide.id,sha256:guide.sha256,path:[],offset:0,observation:'Synthetic published source.'});
const wire=v=>Array.isArray(v)?v.map(wire):v!==null&&typeof v==='object'?{entries:Object.entries(v).map(([key,value])=>({key,value:wire(value)}))}:v;
function nativeWire(p,stage){
 const settings=v=>({fields:wire(v.fields||{}),bindings:wire(v.bindings||{}),modes:v.modes||[]});
 return {...p,rootLayout:stage==='prepare-foundation'?settings(p.rootLayout):p.rootLayout,nodes:p.nodes.map(n=>{
  const out={...n,role:n.role??null,layout:n.kind==='slot'?(n.layout||{}):settings(n.layout||{})};
  if(['instance','layout'].includes(n.kind))out.name=n.name??null;
  if(['instance','configure'].includes(n.kind))out.props=wire(n.props||{});return out;
 })};
}
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-approval-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const scene={host:false,sections:[],texts:{},lease:'b'.repeat(64)},calls=[];let sourceChanged=false,nextIds=null,service;
 const target=()=>({fileKey:'FixtureFile',pageId:'page',rootNodeId:'root',ownerNonce:'a'.repeat(64),leaseNonce:scene.lease});
 const snapshot=()=>{
  const nodes=[{id:'root',parentId:'page',type:'FRAME',name:'Root',role:'',nativeKey:'',sectionId:null}];
  if(scene.host)nodes.push({id:'host',parentId:'root',type:'FRAME',name:'Host',role:'host',nativeKey:'host',sectionId:null,layoutMode:'VERTICAL'});
  const sections=scene.sections.map(id=>({id:'node-'+id,sectionId:id,fingerprint:sha([id,scene.texts[id]||'Default'])}));
  for(const s of sections)nodes.push({id:s.id,parentId:'host',type:'INSTANCE',name:s.sectionId,role:'',nativeKey:'block',sectionId:s.sectionId,componentKey:key,componentProperties:{}},{id:'text-'+s.sectionId,parentId:s.id,type:'TEXT',name:'Title',role:'',nativeKey:'',sectionId:s.sectionId,characters:scene.texts[s.sectionId]||'Default',fontName:{family:'Synthetic',style:'Regular'},hasMissingFont:false});
  return {...target(),rootNodeId:'root',outsideHash:'c'.repeat(64),nodeCount:nodes.length,instanceCount:sections.length,sections,text:Object.values(scene.texts).join('\n'),coverage:'tagged-sections-and-text',native:{schemaVersion:'apollo.landing-native.v2',executor:nativePlan.VERSION,modeDefaults:{},nodes}};
 };
 const readback=()=>{const v=snapshot();delete v.fileKey;return v;};
 const source={id:'fixture',resumePin:'fixture-pin',knowledgeVersion:'fixture',skill:{id:'ab-generate-custom-landing',version:'0.5.0',sha256:'fixture',generation:{workflow:'staged-content-v1',skeletonExecutor:nativePlan.VERSION}},assertCurrent(){if(sourceChanged)throw Object.assign(Error('LANDING_SKILL_STALE'),{code:'LANDING_SKILL_STALE'});},initial:{instructions:{},norms:[guide],workflow:[],resources:[]},read(){return guide;},list(){return {resources:[],total:0,next:null};}};
 const createCli=()=>({run:async options=>{
  const c=JSON.parse(options.prompt.split('\n').at(-1)),stage=c.execution?.stage,id=c.execution?.activeSectionId;calls.push({stage,profile:options.profile});
  if(!stage){const ids=nextIds||['hero','benefits','steps','faq','cta'];return {result:{kind:'build',message:'Outline',query:'',offset:0,resources:[],resultJson:'{}',specJson:JSON.stringify({facts:[{id:'offer',value:'User fact'}],sections:ids.map(id=>({id,role:id,contentShape:{items:1},sourceIds:[]})),...(c.target||c.spec.sections.length?{editSectionIds:[...new Set(c.spec.sections.map(s=>s.id).concat(ids))]}:{})})},receipt:{}};}
  assert(!['foundation','structure','approve-structure'].includes(stage),'A native or waiting unit must never invoke CLI');
  let result={kind:'continue',message:stage,query:'',offset:0,resources:[],sectionPatch:null,payload:{checkpoint:{sectionId:id,status:'complete',nextAction:'Next'},preparationPatch:null,technicalPatch:null,apiObservations:[],report:null}};
  if(stage.startsWith('prepare-')){
   let decision;
   if(stage==='prepare-foundation')decision={container:{role:'host',type:'FRAME',componentKey:null},mount:{role:'host',type:'FRAME',componentKey:null},layout:{nativePlan:{schemaVersion:nativePlan.SCHEMA,rootId:'host',mountId:'host',rootLayout:{},nodes:[{id:'host',parent:'$root',kind:'layout',role:'host',layout:{fields:{layoutMode:'VERTICAL'}}}]}},slotContentReplacement:null};
   else if(stage==='prepare-structure')decision={root:{type:'INSTANCE',componentKey:key},props:{},slots:[],layout:{nativePlan:{schemaVersion:nativePlan.SCHEMA,rootId:'block',mountId:null,rootLayout:{},nodes:[{id:'block',parent:'$mount',kind:'instance',key,importType:'COMPONENT',props:{},layout:{}}]}}};
   else decision={texts:[{target:'text-'+id,value:'Final '+id,factIds:['offer']}],assets:[]};
   const prior=stage==='prepare-foundation'?c.spec.foundation?.plan:c.spec.sections.find(s=>s.id===id)?.[stage==='prepare-structure'?'structurePlan':'contentPlan'];
   result.payload.preparationPatch={stage,sectionId:id,baseRevision:prior?.revision||0,sources:[cite()],decision:{...decision,...(decision.layout?{layout:{nativePlan:nativeWire(decision.layout.nativePlan,stage)}}:{}),...(decision.props?{props:wire(decision.props)}:{})}};
  }else if(stage==='content'){
   assert.equal(c.execution.structureApproval.status,'accepted');scene.texts[id]='Final '+id;
  }else if(stage==='verify'){
   const scopes=c.spec.sections.map(s=>({scope:s.id,nodeId:s.nodeId})).concat({scope:'page',nodeId:'root'}),reviews=[];
   for(const scope of scopes){const callId='image-'+scope.scope;options.onEvent({type:'item.completed',item:{type:'mcp_tool_call',id:callId,tool:'get_screenshot',status:'completed',arguments:{nodeId:scope.nodeId},result:{content:[{type:'image',mimeType:'image/png',data:'c3ludGhldGlj'}]}}});reviews.push({scope:scope.scope,modelStep:c.execution.modelStepsUsed,callId,verdict:'PASS',evidence:'Synthetic image only'});}
   result.kind='finish';result.payload.checkpoint=null;result.payload.report={summary:'Synthetic complete',checks:[{name:'Fixture',verdict:'PASS',evidence:'Synthetic source',critical:true}],visualReviews:reviews,issues:[],limits:[]};
  }
  return {result,receipt:{mcp:{toolCalls:stage==='content'?1:0}}};
 }});
 const make=()=>createLandingService({root,knowledge:()=>source,createCli});service=make();const chat=service.create({fileKey:'FixtureFile',pageId:'page',skeletonExecutor:nativePlan.VERSION});
 const get=()=>service.poll(chat.id),settle=async()=>{await service.whenSettled(chat.id);return get();};
 const submit=async text=>{const c=get();service.submit(chat.id,{requestId:crypto.randomUUID(),revision:c.revision,text});return settle();};
 const step=async()=>{
  const c=get();
  if(c.status==='awaiting-canvas'){scene.lease=sha(['lease',c.revision]);service.canvas(chat.id,{revision:c.revision,target:target(),readback:readback()});}
  else if(c.status==='awaiting-readback')service.observation(chat.id,{revision:c.revision,readback:readback()});
  else if(c.status==='awaiting-native'){
   const n=c.execution.nativeRequest;if(n.stage==='foundation')scene.host=true;else{if(!scene.sections.includes(n.sectionId))scene.sections.push(n.sectionId);scene.sections=scene.sections.filter(id=>!n.removeSections.some(s=>s.sectionId===id));scene.sections.sort((a,b)=>n.order.indexOf(a)-n.order.indexOf(b));}
   service.nativeResult(chat.id,{revision:c.revision,operationId:crypto.randomUUID(),readback:readback(),nativeResult:{operationId:n.operationId,bindings:[{id:n.plan.rootId,nodeId:n.stage==='foundation'?'host':'node-'+n.sectionId}],issue:null}});
  }else return c;return settle();
 };
 const drive=async()=>{for(let i=0;i<70;i++){const c=get();if(!['awaiting-canvas','awaiting-native','awaiting-readback','running'].includes(c.status))return c;await step();}throw Error('Fixture did not settle');};
 const decision=(value='approve',extra={})=>{const c=get(),a=c.execution.structureApproval;return {requestId:crypto.randomUUID(),revision:c.revision,approvalId:a.id,structureHash:a.structureHash,decision:value,text:'',...extra};};
 return {root,calls,scene,get,submit,step,drive,decision,readback,target,decide:b=>service.structureDecision(chat.id,b),reload(){service=make();return get();},cancel:()=>service.cancel(chat.id),changeSource(){sourceChanged=true;},setIds:ids=>{nextIds=ids;},service:()=>service,chat};
}
test('all five native blocks pause durably with zero write-capable model calls before approval',async t=>{
 const h=fixture(t);await h.submit('Build');const c=await h.drive();assert.equal(c.status,'needs-structure-approval',JSON.stringify(c.error));assert.equal(c.execution.structures.length,5);assert.equal(c.execution.completed.length,0);assert.equal(c.execution.nativeOperations.length,6);assert.equal(h.calls.length,7);assert(h.calls.every(c=>c.profile==='landing-plan'));assert.deepEqual(h.scene.texts,{});
 const n=h.calls.length;h.reload();for(let i=0;i<5;i++)h.get();await new Promise(r=>setTimeout(r,10));assert.equal(h.calls.length,n);assert.equal(h.get().status,'needs-structure-approval');
 const body=h.decision();h.decide(body);assert.equal(h.get().status,'awaiting-canvas');assert.equal(h.calls.length,n);h.decide(body);assert.equal(h.get().revision,2,'lost acknowledgement must not start a second continuation');
 const done=await h.drive();assert.equal(done.status,'completed',JSON.stringify(done.error||done.result));assert.equal(done.execution.completed.length,5);assert.equal(done.result.Ready,false);assert.equal(h.calls.filter(c=>c.stage==='content').length,5);
});
test('negative decision requests changes and a revised order needs a new independent approval',async t=>{
 const h=fixture(t);await h.submit('Build');await h.drive();const original=h.get().execution.structureApproval.id;h.decide(h.decision('revise'));assert.equal(h.get().status,'needs-structure-changes');assert.throws(()=>h.service().submit(h.chat.id,{requestId:crypto.randomUUID(),revision:h.get().revision,text:'ок'}),/LANDING_STRUCTURE_CHANGES_REQUIRED/);
 h.setIds(['hero','steps','benefits','cta']);await h.submit('Remove FAQ and put steps before benefits');const revised=await h.drive();assert.equal(revised.status,'needs-structure-approval',JSON.stringify(revised.error));assert.notEqual(revised.execution.structureApproval.id,original);assert.deepEqual(h.scene.sections,['hero','steps','benefits','cta']);assert.deepEqual(h.scene.texts,{});h.decide(h.decision());assert.equal((await h.drive()).status,'completed');
});
test('stale decision, changed source and changed fresh canvas never launch content',async t=>{
 for(const kind of ['decision','source','canvas']){
  const h=fixture(t);await h.submit('Build');await h.drive();const n=h.calls.length,b=h.decision();
  if(kind==='decision'){b.structureHash='0'.repeat(64);assert.throws(()=>h.decide(b),/LANDING_STRUCTURE_APPROVAL_STALE/);}
  else if(kind==='source'){h.changeSource();assert.throws(()=>h.decide(b),/LANDING_SKILL_STALE/);}
  else{h.decide(b);h.scene.texts.hero='Manual change';try{await h.step();}catch{}assert.equal(h.get().status,'interrupted');}
  assert.equal(h.calls.length,n);assert.equal(h.calls.some(c=>c.stage==='content'),false);
 }
});
test('Stop at the preview and during approved fresh-read wait preserves the gate and counters',async t=>{
 const h=fixture(t);await h.submit('Build');await h.drive();const n=h.calls.length;h.cancel();await h.submit('продолжи');assert.equal(h.get().status,'needs-structure-approval');assert.equal(h.calls.length,n);
 h.decide(h.decision());h.cancel();await h.submit('продолжи');assert.equal(h.get().status,'awaiting-canvas');assert.equal(h.calls.length,n);assert.equal((await h.drive()).status,'completed');
});
test('only unambiguous approval text advances; negative/qualified replies never count as approval',()=>{
 for(const text of ['ок','ok','Да','Структура подходит','всё ок'])assert(approval.affirmative(text));for(const text of ['не ок','ок, но поменяй порядок','да, но убери FAQ','нет','продолжи'])assert(!approval.affirmative(text));
});
test('the last allowed preparation can still execute its native unit without resetting the model limit',async t=>{
 const h=fixture(t);await h.submit('Build');await h.step();await h.step();await h.step();assert.equal(h.get().execution.stage,'prepare-structure');h.cancel();
 const file=path.join(h.root,h.chat.id+'.json'),record=JSON.parse(fs.readFileSync(file));record.execution.modelStepsUsed=47;fs.writeFileSync(file,JSON.stringify(record));h.reload();await h.submit('продолжи');await h.step();await h.step();assert.equal(h.get().status,'awaiting-native');assert.equal(h.get().execution.modelStepsUsed,48);
 await h.step();assert.equal(h.get().error.code,'LANDING_STEP_BUDGET');assert.equal(h.get().execution.modelStepsUsed,48);assert.deepEqual(h.scene.sections,['hero']);assert.equal(h.get().execution.nativeOperations.length,2);
});
