'use strict';
// Real service and native bridge; the provider, Figma document and images are deterministic test doubles.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createLandingService}=require('../src/landing/service');
const apollo=process.env.APOLLO_PROJECT_ROOT||path.resolve(__dirname,'../../../projects/Apollo');
const {createLandingCanvasBridge,NS}=require(path.join(apollo,'src/landing/native'));
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'),copy=v=>JSON.parse(JSON.stringify(v));
const wireValue=v=>Array.isArray(v)?v.map(wireValue):v!==null&&typeof v==='object'?{entries:Object.entries(v).map(([key,value])=>({key,value:wireValue(value)}))}:v;
function wirePayload(result,kind){
 if(!['continue','finish'].includes(kind))return null;
 const preparation=result.preparationPatch?copy(result.preparationPatch):null;
 if(preparation){const d=preparation.decision;if(d.layout)d.layout=wireValue(d.layout);if(d.props)d.props=wireValue(d.props);if(preparation.stage==='prepare-foundation'&&!Object.hasOwn(d,'slotContentReplacement'))d.slotContentReplacement=null;}
 const report=kind==='finish'?{summary:result.summary,checks:result.checks.map((c,i)=>Object.assign({name:'Fixture check '+i},c)),visualReviews:result.visualReviews,issues:[],limits:[]}:null;
 return {checkpoint:result.checkpoint||null,preparationPatch:preparation,technicalPatch:result.technicalPatch||null,apiObservations:result.apiObservations||[],report};
}
function createFullFlowHarness({root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-full-flow-'))),holdContent=false,delayCommit=true,readNow=Date.now,responseTransform=null}={}){
 const ids=['hero','benefits','steps','faq','cta'],keys=Object.fromEntries(['foundation','asset',...ids].map(id=>[id,hash(id).slice(0,40)])),calls=[],mutations=[],messages=[],nodes=new Map(),modelStages=[];
 let seq=0,request=0,bridge,service,onNative=()=>{},chatId=null,ownedRoot=null,body=null,commit=null,commitAt=0,settle=0,globalModes={},held=null,paused=false,stale=false,outlineCalls=0;
 function node(type='FRAME',name=type){
  const n={id:'1:'+ ++seq,type,name,x:0,y:0,width:1440,height:100,visible:true,clipsContent:false,layoutMode:'VERTICAL',boundVariables:{},explicitVariableModes:{},get resolvedVariableModes(){return {...globalModes};},children:[],data:new Map(),appendChild(child){if(child.parent)child.parent.children.splice(child.parent.children.indexOf(child),1);this.children.push(child);child.parent=this;},getSharedPluginData(ns,key){return this.data.get(ns+':'+key)||'';},setSharedPluginData(ns,key,value){this.data.set(ns+':'+key,value);},resize(w,h){this.width=w;this.height=h;},resizeWithoutConstraints(w,h){this.resize(w,h);},remove(){this.parent?.children.splice(this.parent.children.indexOf(this),1);this.parent=null;this.removed=true;nodes.delete(this.id);}};nodes.set(n.id,n);return n;
 }
 function instance(key,name){const n=node('INSTANCE',name);n.getMainComponentAsync=async()=>({key,parent:{type:'COMPONENT_SET',key}});n.componentProperties={View:{type:'VARIANT',value:'Fixture'}};return n;}
 function text(parent,value){const n=node('TEXT','value');n.characters=value;n.fontName={family:'Fixture',style:'Regular'};n.hasMissingFont=false;parent.appendChild(n);return n;}
 const page=node('PAGE'),neighbor=node('FRAME','Existing user content');page.appendChild(neighbor);const neighborHash=hash([neighbor.id,neighbor.x,neighbor.y,neighbor.width,neighbor.height]);
 const api={currentPage:page,fileKey:'FixtureFile',createFrame:()=>{const n=node();page.appendChild(n);return n;},createSection:()=>{const n=node('SECTION');page.appendChild(n);return n;},getNodeByIdAsync:async id=>nodes.get(id)||null,variables:{getVariableCollectionByIdAsync:async id=>Object.hasOwn(globalModes,id)?{defaultModeId:'1:0'}:null}};
 const recipe={schemaVersion:'apollo.slot-content-replacement.v1',id:'Fixture.Body.default',containerKey:keys.foundation,slot:{type:'SLOT',name:'Body'},defaultChildren:[{type:'FRAME',name:'SwapMe',children:[{type:'TEXT',name:'value',characters:'Content',children:[]}]}]};
 const guide={id:'knowledge/data/ds-ai-hub/products/ab/patterns/fixture.md',mode:'read',path:[],offset:0,sha256:hash('guide'),text:'Synthetic source keys '+Object.values(keys).join(' ')+'\n```apollo-slot-content-replacement\n'+JSON.stringify(recipe)+'\n```'};
 const citation=r=>({id:r.id,sha256:r.sha256,path:r.path,offset:r.offset,observation:'Read this exact synthetic selection source.'});
 const outline={facts:[{id:'offer',value:'Business card'},{id:'cta',value:'Start application'}],sections:ids.map(id=>({id,role:id,contentShape:{titleCount:1,imageCount:1,cta:id==='hero'||id==='cta'?1:0},sourceIds:[]}))};
 const source={id:'fixture-data',resumePin:'fixture-source-pin',knowledgeVersion:'fixture-knowledge',skill:{id:'ab-generate-custom-landing',name:'Landing',version:'0.4.1',sha256:hash('skill'),generation:{workflow:'staged-content-v1',recipeOperations:'slot-content-replacement-v1'}},initial:{norms:[guide],instructions:{},workflow:[],resources:[]},assertCurrent(){if(stale)throw Object.assign(Error('LANDING_DATA_STALE'),{code:'LANDING_DATA_STALE'});},list(query,offset=0){return {query,offset,total:1,next:null,resources:[{id:'knowledge/data/ds-ai-hub/'+query.replace(/\/$/,'')+'/instructions.md'}]};},read(r){return {...r,sha256:guide.sha256,text:guide.text,total:guide.text.length,next:null};}};
 function accept(m){if(m.operation==='observe'&&commit&&delayCommit!=='never'){if(typeof delayCommit==='number'?readNow()>=commitAt:settle++>=1||!delayCommit){commit();commit=null;}}return bridge.accept(m);}
 function makeBridge(){bridge=createLandingCanvasBridge({api,hash,post:m=>{messages.push(m);onNative(m);}});}
 async function native(operation,payload={}){const requestId='full:'+ ++request;accept({type:'landing-canvas',requestId,operation,payload});for(let i=0;i<2000;i++){const reply=messages.find(m=>m.requestId===requestId);if(reply){if(reply.error)throw Object.assign(Error(reply.error.code),reply.error);return reply.value;}await new Promise(r=>setTimeout(r,1));}throw Error('Fixture native response timeout');}
 function buildBlock(id){
  const n=instance(keys[id],id);n.id='Icanonical:'+id;nodes.set(n.id,n);n.setSharedPluginData(NS,'section',id);
  if(id==='hero')n.componentProperties={View:{type:'VARIANT',value:'Page'},Background:{type:'VARIANT',value:'False'},'BlurEffect#api':{type:'BOOLEAN',value:true},'ButtonGroup#api':{type:'BOOLEAN',value:true}};
  const title=node('FRAME','Title'),subtitle=node('FRAME','Subtitle'),button=instance(keys.asset,'ButtonGroup'),image=node('SLOT','Illustration');text(title,'Title');text(subtitle,'Subtitle');text(button,'Label');n.appendChild(title);n.appendChild(subtitle);n.appendChild(button);n.appendChild(image);
  for(let i=0;i<20;i++)n.appendChild(node('FRAME','Source-owned-'+i));body.appendChild(n);return n;
 }
 async function run(options){
  const ctx=JSON.parse(options.prompt.split('\n').at(-1));calls.push(ctx);const stage=ctx.execution?.stage,id=ctx.execution?.activeSectionId;modelStages.push([stage||'outline',id]);
  let kind='continue',sectionPatch=null,result={},tools=0;
  if(!ctx.execution){outlineCalls++;return {result:{kind:'build',message:'Fixture outline',specJson:JSON.stringify(outline),query:'',offset:0,resources:[],resultJson:'{}'},receipt:{mcp:{toolCalls:0}}};}
  ownedRoot=nodes.get(ctx.target.rootNodeId);
  if(stage.startsWith('prepare-')){
   const section=ctx.spec.sections.find(s=>s.id===id),row=id&&ctx.resources.find(r=>r.id==='knowledge/data/ds-ai-hub/products/ab/components/'+id+'/instructions.md');
   if(stage==='prepare-structure'&&!row)return {result:{kind:'list_resources',message:'Read current source',query:'products/ab/components/'+id,offset:0,resources:[],payload:null,sectionPatch:null},receipt:{mcp:{toolCalls:0}}};
   let decision,previous;
   if(stage==='prepare-foundation'){previous=ctx.spec.foundation?.plan;decision={container:{role:'container',type:'INSTANCE',componentKey:keys.foundation},mount:{role:'mount',type:'SLOT',componentKey:null},layout:{flow:'source-owned'},slotContentReplacement:recipe.id};}
   else if(stage==='prepare-structure'){
    previous=section.structurePlan;decision={root:{type:'INSTANCE',componentKey:keys[id]},props:id==='hero'?previous?{View:'Page',Background:false,BlurEffect:true,'ButtonGroup#api':true}:{View:'Page',Background:false,BlurEffect:true,PrimaryAction:true}:{View:'Fixture'},slots:['Illustration'],layout:{sourceOwned:true}};
   }else{
    previous=section.contentPlan;const rows=ctx.readback.native.nodes.filter(n=>n.sectionId===id),parents=new Map(rows.map(n=>[n.id,n]));
    const target=name=>rows.find(n=>n.type==='TEXT'&&parents.get(n.parentId)?.name===name).id;
    decision={texts:[{target:target('Title'),value:'Heading '+id,factIds:['offer']},{target:target('Subtitle'),value:'Description '+id,factIds:['offer']},{target:target('ButtonGroup'),value:'Apply',factIds:['cta']}],assets:[{target:rows.find(n=>n.name==='Illustration').id,kind:'component',key:keys.asset,resourceId:guide.id,path:[]}]};
   }
   result.preparationPatch={stage,sectionId:id,baseRevision:previous?.revision||0,sources:[citation(stage==='prepare-structure'?row:guide)],decision};
  }else if(stage==='foundation'){
   const host=instance(keys.foundation,'CorporateContent');host.setSharedPluginData(NS,'role','container');body=node('SLOT','Body');body.setSharedPluginData(NS,'role','mount');const placeholder=node('FRAME','SwapMe');text(placeholder,'Content');body.appendChild(placeholder);host.appendChild(body);ownedRoot.appendChild(host);mutations.push('foundation');tools=1;
  }else if(stage==='structure'){
   let n=body.children.find(n=>n.getSharedPluginData(NS,'section')===id);const reported='reported:'+id;
   if(!n&&id==='hero'){
    const ownership={rootId:ownedRoot.id,owner:ownedRoot.getSharedPluginData(NS,'owner')};
    options.onEvent({type:'item.completed',item:{id:'create-hero',type:'mcp_tool_call',tool:'use_figma',status:'completed',result:{content:[{type:'text',text:JSON.stringify({createdNodeIds:[reported],ownership})}]}}});
    commitAt=readNow()+(typeof delayCommit==='number'?delayCommit:0);commit=()=>{globalModes={...globalModes,...Object.fromEntries(Array.from({length:40},(_,i)=>['VariableCollectionId:fixture-'+i+'/1:1','1:0']))};const old=body.children[0];n=buildBlock(id);old.remove();mutations.push('structure:'+id);};
    throw Object.assign(Error('AGENT_CHECKPOINT_REQUIRED'),{code:'AGENT_CHECKPOINT_REQUIRED',usage:{toolCalls:1}});
   }
   if(!n){n=buildBlock(id);mutations.push('structure:'+id);}sectionPatch={sectionId:id,nodeId:id==='hero'?reported:n.id};tools=1;
  }else if(stage==='content'){
   if(holdContent&&id==='benefits'&&!paused){paused=true;await new Promise(resolve=>held=resolve);if(options.signal.aborted)throw Object.assign(Error('AGENT_CANCELLED'),{code:'AGENT_CANCELLED'});}
   assert.equal(body.children.filter(n=>n.getSharedPluginData(NS,'section')).length,5);
   const decision=ctx.spec.sections.find(s=>s.id===id).contentPlan.decision;for(const row of decision.texts)nodes.get(row.target).characters=row.value;
   for(const row of decision.assets){const target=nodes.get(row.target),asset=instance(row.key,'Selected library illustration');target.children.slice().forEach(n=>n.remove());target.appendChild(asset);}mutations.push('content:'+id);tools=1;
  }else if(stage==='verify'){
   const scopes=ctx.spec.sections.map(s=>({id:s.id,nodeId:s.nodeId})).concat({id:'page',nodeId:ctx.target.rootNodeId}),prior=ctx.execution.screenshots||[],missing=scopes.filter(s=>!prior.some(p=>p.nodeId===s.nodeId)),fresh=[];
   for(const scope of missing.slice(0,2)){const callId='image-'+calls.length+'-'+scope.id;options.onEvent({type:'item.completed',item:{id:callId,type:'mcp_tool_call',tool:'get_screenshot',status:'completed',arguments:{nodeId:scope.nodeId},result:{content:[{type:'image',mimeType:'image/png',data:Buffer.from('synthetic image').toString('base64')}]}}});fresh.push({scope:scope.id,callId,modelStep:ctx.execution.modelStepsUsed,verdict:'PASS',evidence:'Synthetic image, not live visual acceptance'});}
   if(missing.length<=2){kind='finish';result={summary:'Deterministic five-section test',checks:[{verdict:'PASS',critical:true,evidence:'Synthetic source and native fixture checks'}],visualReviews:prior.map(p=>({scope:scopes.find(s=>s.nodeId===p.nodeId).id,modelStep:p.modelStep,callId:p.callId,verdict:'PASS',evidence:'Synthetic image only'})).concat(fresh)};}else result.partial=true;
  }else throw Error('Unexpected stage '+stage);
  if(kind==='continue')result.checkpoint={sectionId:id,status:result.partial?'partial':'complete',nextAction:'Next assigned unit'};delete result.partial;
  const reply={kind,message:stage+' '+(id||''),query:'',offset:0,resources:[],payload:wirePayload(result,kind),sectionPatch};
  return {result:responseTransform?responseTransform(reply,{stage,sectionId:id}):reply,receipt:{mcp:{toolCalls:tools}}};
 }
 function makeService(){service=createLandingService({root:path.join(root,'chats'),knowledge:()=>source,createCli:()=>({run}),readNow});}
 makeBridge();makeService();
 async function begin(){const c=service.create({pageId:page.id,fileKey:api.fileKey,placement:{mode:'new-section',sectionId:null}});chatId=c.id;service.submit(c.id,{requestId:crypto.randomUUID(),revision:0,text:'Five-section business card landing'});await service.whenSettled(c.id);return service.poll(c.id);}
 async function tick(){let c=service.poll(chatId);if(c.status==='awaiting-canvas'){const n=await native('open',{chatId,revision:c.revision,pageId:page.id,fileKey:api.fileKey,rootNodeId:c.target?.rootNodeId||null,ownerNonce:c.target?.ownerNonce||null,placement:c.context.placement,evidenceVersion:c.source.nativeEvidenceVersion});service.canvas(chatId,{revision:c.revision,...n,operationId:crypto.randomUUID()});}
  else if(c.status==='awaiting-readback'){const t=c.target,readback=await native('observe',{chatId,revision:c.revision,rootNodeId:t.rootNodeId,ownerNonce:t.ownerNonce,leaseNonce:t.leaseNonce});service.observation(chatId,{revision:c.revision,readback,operationId:crypto.randomUUID()});}await service.whenSettled(chatId);return service.poll(chatId);}
 return {root,api,node,nodes,page,neighbor,source,calls,mutations,modelStages,begin,tick,native,accept,get bridge(){return bridge;},get service(){return service;},get paused(){return paused;},get outlineCalls(){return outlineCalls;},setNativePost:fn=>onNative=fn,addInheritedDefault:()=>globalModes['VariableCollectionId:retry/1:1']='1:0',changeProtected:field=>{if(field==='mode')globalModes[Object.keys(globalModes)[0]]='1:9';else ownedRoot[field==='explicit'?'explicitVariableModes':'boundVariables']={changed:'foreign'};},markStale:()=>stale=true,releaseHeld:()=>held?.(),reloadService:makeService,assertNeighbor:()=>assert.equal(hash([neighbor.id,neighbor.x,neighbor.y,neighbor.width,neighbor.height]),neighborHash),close(){bridge.close();fs.rmSync(root,{recursive:true,force:true});}};
}
module.exports={createFullFlowHarness};
if(require.main===module){
 const test=require('node:test');
 test('real service/native path completes five structures and contents after delayed canonical SLOT commit and API re-preparation',async()=>{
  const h=createFullFlowHarness();try{let c=await h.begin();for(let i=0;i<60&&['awaiting-canvas','awaiting-readback'].includes(c.status);i++)c=await h.tick();
   assert.equal(c.status,'completed',JSON.stringify(c.error||c.result?.verification));assert.equal(c.execution.structures.length,5);assert.equal(c.execution.completed.length,5);assert.equal(c.result.Ready,false);assert.equal(c.result.verification.ownerAcceptance,'PENDING');assert.equal(h.outlineCalls,1);assert.equal(h.mutations.filter(v=>v==='structure:hero').length,1);assert(h.mutations.indexOf('content:hero')>h.mutations.indexOf('structure:cta'));assert.equal(c.spec.sections[0].nodeBinding.reportedId,'reported:hero');assert.equal(c.execution.apiBindingRepairs,1);assert(Buffer.byteLength(JSON.stringify(c.readback))>262144);assert(c.execution.modelStepsUsed<=48);assert(c.readback.native.nodes.length>125);assert(h.calls.some(ctx=>ctx.readback?.projection));h.assertNeighbor();
  }finally{h.close();}
 });
 test('Stop, persisted reload and exact resume complete the same five blocks without another outline',async()=>{
  const h=createFullFlowHarness({holdContent:true});try{
   let c=await h.begin();const advancing=(async()=>{for(let i=0;i<60&&['awaiting-canvas','awaiting-readback'].includes(c.status);i++)c=await h.tick();})();
   for(let i=0;i<5000&&!h.paused;i++)await new Promise(r=>setTimeout(r,1));assert(h.paused);c=h.service.poll(c.id);const accepted=copy(c.spec),target=copy(c.target),modelCalls=h.calls.length;
   await h.native('release',{chatId:c.id});h.service.cancel(c.id);h.releaseHeld();await advancing;h.reloadService();assert.equal(h.service.poll(c.id).status,'cancelled');
   h.service.submit(c.id,{requestId:crypto.randomUUID(),revision:c.revision,text:'продолжи'});assert.equal(h.calls.length,modelCalls);assert.equal(h.service.poll(c.id).status,'awaiting-canvas');
   c=await h.tick();for(let i=0;i<40&&c.status==='awaiting-readback';i++)c=await h.tick();assert.equal(c.status,'completed',JSON.stringify(c.error));assert.equal(c.target.rootNodeId,target.rootNodeId);assert.deepEqual(c.spec.facts,accepted.facts);assert.equal(c.execution.completed.length,5);assert.equal(h.outlineCalls,1);assert.equal(h.mutations.filter(v=>v==='structure:hero').length,1);assert(c.execution.modelStepsUsed<=48);h.assertNeighbor();
  }finally{h.releaseHeld();h.close();}
 });
 test('a rejected exact native after and compact diff are durable without replacing accepted state',async()=>{
  const h=createFullFlowHarness();try{
   let c=await h.begin();for(let i=0;i<30&&!(c.execution?.stage==='structure'&&c.execution.activeSectionId==='benefits');i++)c=await h.tick();assert.equal(c.execution.activeSectionId,'benefits');const accepted=copy(c.spec),before=copy(c.readback),t=c.target;
   const readback=await h.native('observe',{chatId:c.id,revision:c.revision,rootNodeId:t.rootNodeId,ownerNonce:t.ownerNonce,leaseNonce:t.leaseNonce});readback.native.nodes.find(n=>n.type==='TEXT'&&n.sectionId==='hero').characters='Unrequested edit';
   assert.throws(()=>h.service.observation(c.id,{revision:c.revision,readback,operationId:crypto.randomUUID()}),{code:'LANDING_SECTION_SCOPE_CHANGED'});c=h.service.poll(c.id);assert.deepEqual(c.spec,accepted);assert.deepEqual(c.readback,before);assert.equal(c.error.diagnostic.receipt.complete,true);const id=c.error.diagnostic.receipt.id,raw=fs.readFileSync(path.join(h.root,'chats/readbacks',id+'.json'));assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),c.error.diagnostic.receipt.sha256);const stored=JSON.parse(raw);assert.deepEqual(stored.after,readback);assert.deepEqual(stored.before,before);assert(c.error.diagnostic.diff.changes.length>0);
  }finally{h.close();}
 });
 test('malformed rejected native rows keep the original validation error and exact receipt',async()=>{
  const h=createFullFlowHarness();try{let c=await h.begin();c=await h.tick();const accepted=copy(c.spec),before=copy(c.readback),readback=copy(before);readback.native.nodes={bad:true};
   assert.throws(()=>h.service.observation(c.id,{revision:c.revision,readback,operationId:crypto.randomUUID()}),{code:'LANDING_READBACK_INVALID'});c=h.service.poll(c.id);assert.equal(c.status,'interrupted');assert.equal(c.error.code,'LANDING_READBACK_INVALID');assert.deepEqual(c.spec,accepted);assert.deepEqual(c.readback,before);assert.equal(c.error.diagnostic.receipt.complete,true);const stored=JSON.parse(fs.readFileSync(path.join(h.root,'chats/readbacks',c.error.diagnostic.receipt.id+'.json')));assert.deepEqual(stored.after,readback);
  }finally{h.close();}
 });
 test('settlement expires after30seconds, not after five fast observations, without another model write',async()=>{
  let now=Date.now();const h=createFullFlowHarness({delayCommit:'never',readNow:()=>now});try{
   let c=await h.begin();for(let i=0;i<30&&!c.failures.length;i++)c=await h.tick();assert.equal(c.failures[0].error.code,'AGENT_CHECKPOINT_REQUIRED');const calls=h.calls.length;
   for(let i=0;i<8;i++){c=await h.tick();assert.equal(h.calls.length,calls);assert.equal(c.status,'awaiting-readback');}
   now+=30000;
   await assert.rejects(h.tick(),{code:'LANDING_WRITE_NOT_OBSERVED'});c=h.service.poll(c.id);assert.equal(c.status,'interrupted');assert.equal(c.error.diagnostic.receipt.complete,true);assert.equal(h.calls.length,calls);
  }finally{h.close();}
 });
 test('a20second commit in a30second window completes all five blocks without another creation',async()=>{
  let now=Date.now();const h=createFullFlowHarness({delayCommit:20000,readNow:()=>now});try{
   let c=await h.begin();for(let i=0;i<30&&!c.failures.length;i++)c=await h.tick();const calls=h.calls.length;
   for(let i=0;i<7;i++){c=await h.tick();assert.equal(c.status,'awaiting-readback');assert.equal(h.calls.length,calls);}now+=20000;
   c=await h.tick();for(let i=0;i<60&&c.status==='awaiting-readback';i++)c=await h.tick();assert.equal(c.status,'completed',JSON.stringify(c.error));assert.equal(h.mutations.filter(v=>v==='structure:hero').length,1);assert.equal(h.outlineCalls,1);assert.equal(c.execution.completed.length,5);h.assertNeighbor();
  }finally{h.close();}
 });
 for(const guard of ['Stop','source','scope'])test('settlement preserves '+guard+' guard without replaying a write',async()=>{
  let now=Date.now();const h=createFullFlowHarness({delayCommit:'never',readNow:()=>now});try{
   let c=await h.begin();for(let i=0;i<30&&!c.failures.length;i++)c=await h.tick();c=await h.tick();const calls=h.calls.length,mutations=copy(h.mutations);now+=5000;
   if(guard==='Stop'){h.service.cancel(c.id);c=await h.tick();assert.equal(c.status,'cancelled');}
   if(guard==='source'){h.markStale();await assert.rejects(h.tick(),{code:'LANDING_DATA_STALE'});}
   if(guard==='scope'){const t=c.target,readback=await h.native('observe',{chatId:c.id,revision:c.revision,rootNodeId:t.rootNodeId,ownerNonce:t.ownerNonce,leaseNonce:t.leaseNonce});readback.native.nodes[0].name='Foreign edit';assert.throws(()=>h.service.observation(c.id,{revision:c.revision,readback,operationId:crypto.randomUUID()}),{code:'LANDING_SECTION_SCOPE_CHANGED'});}
   assert.equal(h.calls.length,calls);assert.deepEqual(h.mutations,mutations);assert(h.nodes.get(c.target.rootNodeId));h.assertNeighbor();
  }finally{h.close();}
 });
 test('v2 workflow refuses a legacy snapshot before executing a construction step',async()=>{
  const h=createFullFlowHarness();try{
   let c=await h.begin();const n=await h.native('open',{chatId:c.id,revision:c.revision,pageId:h.api.currentPage.id,fileKey:h.api.fileKey,rootNodeId:null,ownerNonce:null,placement:c.context.placement,evidenceVersion:1});
   assert.throws(()=>h.service.canvas(c.id,{revision:c.revision,...n}),{code:'LANDING_NATIVE_EVIDENCE_REQUIRED'});assert.equal(h.calls.length,1);assert.equal(h.mutations.length,0);assert(h.nodes.get(n.target.rootNodeId));
  }finally{h.close();}
 });
}
