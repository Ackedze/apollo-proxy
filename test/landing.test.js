'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createLandingService}=require('../src/landing/service');
const spec=(ids=['hero'])=>({version:1,facts:[],decisions:[],questions:[],sections:ids.map(id=>({id,role:id,component:{key:'library-key'},nodeId:null}))});
const step=(kind,s=spec(),message=kind)=>({kind,message,specJson:JSON.stringify(s),query:'',offset:0,resources:[],resultJson:JSON.stringify({summary:'Synthetic result',checks:[{name:'visual',verdict:'UNKNOWN'}],issues:[],limits:['Synthetic only']})});
const target=()=>({fileKey:'FileKey123',pageId:'0:1',rootNodeId:'1:1',ownerNonce:'a'.repeat(64),leaseNonce:'b'.repeat(64)});
const readback=(t=target(),sections=[])=>({...t,fileKey:undefined,rootNodeId:t.rootNodeId,pageId:t.pageId,ownerNonce:t.ownerNonce,leaseNonce:t.leaseNonce,outsideHash:'c'.repeat(64),nodeCount:sections.length+2,instanceCount:sections.length,sections,text:'Synthetic',coverage:'tagged-sections-and-text'});
function canvasRead(t=target(),sections=[]){const v=readback(t,sections);delete v.fileKey;return v;}
const section=(id,nodeId,fingerprint='d'.repeat(64))=>({id:nodeId,sectionId:id,fingerprint});
function harness(t,steps){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'apollo-landing-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const calls=[];let stale=false;
 const knowledge=()=>({id:'data1',knowledgeVersion:'knowledge1',skill:{version:'0.3.0',sha256:'s1'},assertCurrent:()=>{if(stale)throw Object.assign(Error('LANDING_DATA_STALE'),{code:'LANDING_DATA_STALE'});},initial:{instructions:{'SKILL.md':'Synthetic canonical skill'},norms:[],workflow:[],resources:{resources:[]}},list:(query,offset=0)=>({query,offset,total:1,resources:[{id:'doc'}]}),read:r=>({id:r.id,sha256:'pin',text:'synthetic source',path:[],mode:'read',offset:0})});
 const createCli=()=>({run:async options=>{calls.push(options);const next=steps.shift();if(!next)throw Error('Unexpected CLI invocation');const value=typeof next==='function'?await next(options):next;return{result:value,receipt:{usage:{measurementId:crypto.randomUUID(),actualInputTokens:1,actualOutputTokens:1},mcp:options.profile==='landing-figma'?{toolCalls:1}:null}};}});
 const make=()=>createLandingService({root,knowledge,createCli});return {root,calls,make,service:make(),stale:()=>{stale=true;}};
}
const message=(r,text='Brief')=>({requestId:crypto.randomUUID(),revision:r.revision,text});
test('brief, question, answer, scoped Figma sections and final readback persist one chat/root',async t=>{
 const built=spec();built.sections[0].nodeId='2:1';const h=harness(t,[step('question'),step('build'),step('continue',built),step('finish',built)]),s=h.service;
 let r=s.create({pageId:'0:1',fileKey:null}),request=message(r);r=s.submit(r.id,request);await s.whenSettled(r.id);r=s.poll(r.id);assert.equal(r.status,'needs-input');assert.equal(r.target,null);assert.equal(s.submit(r.id,request).sequence,r.sequence);assert.equal(h.calls.length,1);
 r=s.submit(r.id,message(r,'Confirmed answer'));await s.whenSettled(r.id);r=s.poll(r.id);assert.equal(r.status,'awaiting-canvas');
 const owned=target();r=s.canvas(r.id,{revision:r.revision,target:owned,readback:canvasRead(owned)});await s.whenSettled(r.id);r=s.poll(r.id);assert.equal(r.status,'awaiting-readback');assert.equal(h.calls[2].profile,'landing-figma');
 r=s.observation(r.id,{revision:r.revision,readback:canvasRead(owned,[section('hero','2:1')])});await s.whenSettled(r.id);r=s.poll(r.id);assert.equal(r.status,'awaiting-readback');
 r=s.observation(r.id,{revision:r.revision,readback:canvasRead(owned,[section('hero','2:1')])});assert.equal(r.status,'completed');assert.equal(r.target.rootNodeId,'1:1');assert.equal(r.messages.filter(m=>m.role==='user').length,2);assert.equal(r.result.Ready,false);assert.equal(r.result.checks[0].origin,'agent-report');assert.equal(r.usage.length,4);assert.match(r.result.figmaUrl,/node-id=1%3A1/);
 const restart=h.make().poll(r.id);assert.equal(restart.status,'completed');assert.deepEqual(restart.spec,r.spec);assert.deepEqual(restart.target,r.target);
});
test('restart marks interrupted work honestly; no automatic duplicate root or model invocation',async t=>{
 const h=harness(t,[step('build')]);let r=h.service.create({pageId:'0:1',fileKey:'FileKey123'});h.service.submit(r.id,message(r));await h.service.whenSettled(r.id);
 const restarted=h.make().poll(r.id);assert.equal(restarted.status,'interrupted');assert.equal(restarted.target,null);assert.equal(restarted.messages.length,1);assert.equal(h.calls.length,1);
});
test('cancel aborts pending CLI and late reply cannot restore running or create a result',async t=>{
 let release;const h=harness(t,[()=>new Promise(resolve=>release=resolve)]),s=h.service;let r=s.create({pageId:'0:1',fileKey:'FileKey123'});s.submit(r.id,message(r));const settled=s.whenSettled(r.id);r=s.cancel(r.id);assert.equal(h.calls[0].signal.aborted,true);release(step('build'));await settled;r=s.poll(r.id);assert.equal(r.status,'cancelled');assert.equal(r.result,null);assert.equal(r.target,null);assert.equal(r.usage.length,1,'a measured late reply is retained without applying its result');
});
test('pinned source drift stops before the next worker and keeps the spec and first diagnostic',async t=>{
 const h=harness(t,[step('build')]),s=h.service;let r=s.create({pageId:'0:1',fileKey:'FileKey123'});s.submit(r.id,message(r));await s.whenSettled(r.id);r=s.poll(r.id);h.stale();assert.throws(()=>s.canvas(r.id,{revision:r.revision,target:target(),readback:canvasRead()}),/STALE/);assert.equal(h.calls.length,1);assert.equal(s.poll(r.id).spec.sections.length,1);assert.equal(s.poll(r.id).status,'interrupted');assert.equal(s.isBusy(),false);
});
test('empty frames do not complete; foreign page/root and stale revision are refused',async t=>{
 const built=spec();built.sections[0].nodeId='2:1';const h=harness(t,[step('build'),step('finish',built)]),s=h.service;let r=s.create({pageId:'0:1',fileKey:'FileKey123'});s.submit(r.id,message(r));await s.whenSettled(r.id);r=s.poll(r.id);
 assert.throws(()=>s.canvas(r.id,{revision:r.revision,target:{...target(),pageId:'0:2'},readback:canvasRead()}),/INVALID/);
 s.canvas(r.id,{revision:r.revision,target:target(),readback:canvasRead()});await s.whenSettled(r.id);r=s.poll(r.id);assert.throws(()=>s.observation(r.id,{revision:r.revision-1,readback:canvasRead()}),/STALE/);assert.throws(()=>s.observation(r.id,{revision:r.revision,readback:canvasRead()}),/INCOMPLETE/);assert.equal(s.poll(r.id).result,null);
});
test('follow-up declares changed sections and rejects mutations of other sections',async t=>{
 const built=spec(['hero','details']);built.sections[0].nodeId='2:1';built.sections[1].nodeId='2:2';const follow=JSON.parse(JSON.stringify(built));follow.editSectionIds=['hero'];follow.sections[0].content='Updated';
 const h=harness(t,[step('build',built),step('finish',built),step('build',follow),step('finish',follow)]),s=h.service;let r=s.create({pageId:'0:1',fileKey:'FileKey123'});s.submit(r.id,message(r));await s.whenSettled(r.id);r=s.poll(r.id);s.canvas(r.id,{revision:r.revision,target:target(),readback:canvasRead()});await s.whenSettled(r.id);r=s.poll(r.id);const rows=[section('hero','2:1'),section('details','2:2')];r=s.observation(r.id,{revision:r.revision,readback:canvasRead(target(),rows)});
 s.submit(r.id,message(r,'Change hero only'));await s.whenSettled(r.id);r=s.poll(r.id);assert.equal(r.status,'awaiting-canvas');assert.equal(r.result.rootNodeId,'1:1');const lease={...target(),leaseNonce:'c'.repeat(64)};s.canvas(r.id,{revision:r.revision,target:lease,readback:canvasRead(lease,rows)});await s.whenSettled(r.id);r=s.poll(r.id);
 assert.throws(()=>s.observation(r.id,{revision:r.revision,readback:canvasRead(lease,[section('hero','2:1','e'.repeat(64)),section('details','2:2','f'.repeat(64))])}),/UNREQUESTED/);r=s.poll(r.id);assert.equal(r.status,'interrupted');assert.equal(r.result.rootNodeId,'1:1');assert.equal(r.error.code,'LANDING_UNREQUESTED_CONTENT_CHANGED');
});

test('planner receives immutable native file/page/section context without asking for a URL',async t=>{
 const placement={mode:'section',sectionId:'7:1'},h=harness(t,[options=>{const state=JSON.parse(options.prompt.split('\n').at(-1));assert.deepEqual(state.canvasContext,{pageId:'0:1',fileKey:'FileKey123',placement});assert.match(options.prompt,/Never ask for a Figma URL/);return step('build');}]);
 assert.throws(()=>h.service.create({pageId:'0:1',fileKey:'FileKey123',placement:null}),{code:'LANDING_CHAT_INVALID'});
 let r=h.service.create({pageId:'0:1',fileKey:'FileKey123',placement});h.service.submit(r.id,message(r));await h.service.whenSettled(r.id);r=h.service.poll(r.id);assert.equal(r.status,'awaiting-canvas');assert.equal(r.spec.target.pageId,'0:1');assert.equal(r.spec.target.fileKey,'FileKey123');assert.deepEqual(r.spec.target.placement,placement);
 assert.throws(()=>h.service.canvas(r.id,{revision:r.revision,target:{...target(),parentNodeId:'7:2'},readback:canvasRead()}),{code:'LANDING_CANVAS_INVALID'});
 h.service.cancel(r.id);
});
test('alternating resource searches keep both index results and stop with precise diagnostics before exhausting 24 model steps',async t=>{
 const queries=['corporate-content','AGENTS.md','corporate-content','AGENTS.md','corporate-content'];
 const h=harness(t,queries.map((query,i)=>options=>{const state=JSON.parse(options.prompt.split('\n').at(-1));if(i===2)assert.deepEqual(state.indexes.map(row=>row.query),queries.slice(0,2));return {...step('list_resources'),query};}));
 let r=h.service.create({pageId:'0:1',fileKey:'FileKey123'});h.service.submit(r.id,message(r));await h.service.whenSettled(r.id);r=h.service.poll(r.id);
 assert.equal(h.calls.length,5);assert.equal(r.status,'interrupted');assert.equal(r.error.code,'LANDING_NO_PROGRESS');assert.equal(r.error.diagnostic.query,'corporate-content');assert.equal(r.error.diagnostic.repeatedQueries,3);assert.equal(r.target,null);assert.equal(r.failures.length,1);
});
test('a list step can also read its requested pinned resources, avoiding another model round',async t=>{
 const h=harness(t,[{...step('list_resources'),query:'doc',resources:[{id:'doc',mode:'read',path:[],offset:0,limit:1000}]},options=>{const state=JSON.parse(options.prompt.split('\n').at(-1));assert.equal(state.resources[0].text,'synthetic source');return step('build');}]);
 const r=h.service.create({pageId:'0:1',fileKey:'FileKey123'});h.service.submit(r.id,message(r));await h.service.whenSettled(r.id);assert.equal(h.service.poll(r.id).status,'awaiting-canvas');assert.equal(h.calls.length,2);
});

const batchResources=()=>Array.from({length:20},(_,i)=>({id:'doc-'+i,mode:'read',path:[],offset:0,limit:1000}));
test('all twenty requested documents reach the next planner step without an undeclared batch cap',async t=>{
 const h=harness(t,[{...step('request_context'),resources:batchResources()},options=>{
  const state=JSON.parse(options.prompt.split('\n').at(-1));assert.equal(state.resources.length,20);assert.equal(new Set(state.resources.map(row=>row.id)).size,20);assert.match(options.prompt,/matches ALL query words/);return step('build');
 }]);
 const r=h.service.create({pageId:'0:1',fileKey:'FileKey123'});h.service.submit(r.id,message(r));await h.service.whenSettled(r.id);const final=h.service.poll(r.id);
 assert.equal(final.status,'awaiting-canvas');assert.equal(final.sources.length,20);assert.equal(final.usage.length,2);assert.equal(h.calls.length,2);assert.equal(final.error,null);h.service.cancel(r.id);
});
test('Stop interrupts a resource batch before the next slice, preserving measured usage and late-result rejection',async t=>{
 let r;const h=harness(t,[()=>{setImmediate(()=>h.service.cancel(r.id));return {...step('request_context'),resources:batchResources()};}]);r=h.service.create({pageId:'0:1',fileKey:'FileKey123'});h.service.submit(r.id,message(r));await h.service.whenSettled(r.id);r=h.service.poll(r.id);
 assert.equal(r.status,'cancelled');assert.equal(r.sources.length,8);assert.equal(r.usage.length,1);assert.equal(r.target,null);assert.equal(h.calls.length,1);assert.equal(h.service.isBusy(),false);
});
test('source drift is still rejected between resource slices with the exact request and usage retained',async t=>{
 const h=harness(t,[()=>{setImmediate(h.stale);return {...step('request_context'),resources:batchResources()};}]);const r=h.service.create({pageId:'0:1',fileKey:'FileKey123'});h.service.submit(r.id,message(r));await h.service.whenSettled(r.id);const final=h.service.poll(r.id);
 assert.equal(final.status,'interrupted');assert.equal(final.error.code,'LANDING_DATA_STALE');assert.equal(final.error.diagnostic.step.resourceCount,20);assert.deepEqual(final.error.diagnostic.resourceRequest,{index:8,id:'doc-8'});assert.equal(final.sources.length,8);assert.equal(final.usage.length,1);assert.equal(h.calls.length,1);
});
test('an invalid model step retains its measured usage and observed step shape in the first failure',async t=>{
 const h=harness(t,[step('not-a-step')]),r=h.service.create({pageId:'0:1',fileKey:'FileKey123'});h.service.submit(r.id,message(r));await h.service.whenSettled(r.id);const final=h.service.poll(r.id);
 assert.equal(final.status,'interrupted');assert.equal(final.error.code,'LANDING_STEP_INVALID');assert.equal(final.error.diagnostic.step.kind,'not-a-step');assert.equal(final.error.diagnostic.step.resourceCount,0);assert.equal(final.usage.length,1);assert.equal(final.usage[0].actualInputTokens,1);assert.equal(final.failures[0].error.code,'LANDING_STEP_INVALID');assert.equal(final.target,null);
});

test('initial assembly with prior planning sections: repeat build reads same root, not follow-up scope',async t=>{
 const built=spec(['hero','details']);built.editSectionIds=[];const final=copyForTest(built);final.sections.forEach((s,i)=>s.nodeId=`2:${i+1}`);
 const h=harness(t,[step('question',built),step('build',built),step('build',built),step('finish',final)]),s=h.service;
 let r=s.create({pageId:'0:1',fileKey:'FileKey123'});s.submit(r.id,message(r));await s.whenSettled(r.id);r=s.poll(r.id);
 s.submit(r.id,message(r,'Confirmed'));await s.whenSettled(r.id);r=s.poll(r.id);assert.equal(r.status,'awaiting-canvas');
 s.canvas(r.id,{revision:r.revision,target:target(),readback:canvasRead()});await s.whenSettled(r.id);r=s.poll(r.id);
 assert.equal(r.status,'awaiting-readback',JSON.stringify(r.error));assert.equal(r.result,null);assert.equal(r.target.rootNodeId,'1:1');assert.equal(r.error,null);
 s.observation(r.id,{revision:r.revision,readback:canvasRead()});await s.whenSettled(r.id);r=s.poll(r.id);assert.equal(r.status,'awaiting-readback');
 r=s.observation(r.id,{revision:r.revision,readback:canvasRead(target(),[section('hero','2:1'),section('details','2:2')])});assert.equal(r.status,'completed');assert.equal(r.result.Ready,false);
});
function copyForTest(v){return JSON.parse(JSON.stringify(v));}

test('repeat build cannot reset outsideHash baseline or bypass independent readback',async t=>{
 const h=harness(t,[step('build'),step('build')]),s=h.service;let r=s.create({pageId:'0:1',fileKey:'FileKey123'});s.submit(r.id,message(r));await s.whenSettled(r.id);r=s.poll(r.id);
 s.canvas(r.id,{revision:r.revision,target:target(),readback:canvasRead()});await s.whenSettled(r.id);r=s.poll(r.id);assert.equal(r.status,'awaiting-readback');
 assert.throws(()=>s.canvas(r.id,{revision:r.revision,target:target(),readback:canvasRead()}),/STALE/);
 assert.throws(()=>s.observation(r.id,{revision:r.revision,readback:{...canvasRead(),outsideHash:'e'.repeat(64)}}),/UNREQUESTED/);assert.equal(s.poll(r.id).error.code,'LANDING_UNREQUESTED_CONTENT_CHANGED');
});

test('a later user request still requires explicit edit IDs, including existing empty owned roots',async t=>{
 const h=harness(t,[step('build'),step('question'),step('build')]),s=h.service;let r=s.create({pageId:'0:1',fileKey:'FileKey123'});s.submit(r.id,message(r));await s.whenSettled(r.id);r=s.poll(r.id);
 // Preserve an interrupted owned root as a real later request, without native calls.
 s.cancel(r.id);r=s.poll(r.id);const persisted=JSON.parse(fs.readFileSync(path.join(h.root,r.id+'.json')));persisted.target=target();persisted.readback=canvasRead();fs.writeFileSync(path.join(h.root,r.id+'.json'),JSON.stringify(persisted));
 const restarted=h.make();restarted.submit(r.id,message(r,'Resume'));await restarted.whenSettled(r.id);r=restarted.poll(r.id); // question
 restarted.submit(r.id,message(r,'Proceed'));await restarted.whenSettled(r.id);r=restarted.poll(r.id);assert.equal(r.error.code,'LANDING_EDIT_SCOPE_INVALID');assert.equal(r.target.rootNodeId,'1:1');
});

test('repeated follow-up build cannot expand the accepted edit scope',async t=>{
 const built=spec(['hero','details']);built.sections[0].nodeId='2:1';built.sections[1].nodeId='2:2';const follow=copyForTest(built);follow.editSectionIds=['hero'];const broad=copyForTest(follow);broad.editSectionIds=['hero','details'];
 const h=harness(t,[step('build',built),step('finish',built),step('build',follow),step('build',broad)]),s=h.service;let r=s.create({pageId:'0:1',fileKey:'FileKey123'});s.submit(r.id,message(r));await s.whenSettled(r.id);r=s.poll(r.id);s.canvas(r.id,{revision:r.revision,target:target(),readback:canvasRead()});await s.whenSettled(r.id);r=s.poll(r.id);const rows=[section('hero','2:1'),section('details','2:2')];r=s.observation(r.id,{revision:r.revision,readback:canvasRead(target(),rows)});
 s.submit(r.id,message(r,'Hero only'));await s.whenSettled(r.id);r=s.poll(r.id);s.canvas(r.id,{revision:r.revision,target:target(),readback:canvasRead(target(),rows)});await s.whenSettled(r.id);assert.equal(s.poll(r.id).error.code,'LANDING_EDIT_SCOPE_INVALID');
});

test('repeat build at step24 keeps budget and usage, no false edit-scope error',async t=>{
 const actual=[step('build'),step('build')];
 const fill=Array.from({length:22},(_,i)=>({...step('request_context'),resources:[{id:'doc'+i,mode:'read',path:[],offset:0,limit:100}]}));const h=harness(t,[...fill,...actual]),s=h.service;let r=s.create({pageId:'0:1',fileKey:'FileKey123'});s.submit(r.id,message(r));await s.whenSettled(r.id);r=s.poll(r.id);assert.equal(r.status,'awaiting-canvas');s.canvas(r.id,{revision:r.revision,target:target(),readback:canvasRead()});await s.whenSettled(r.id);r=s.poll(r.id);assert.equal(r.status,'awaiting-readback',JSON.stringify(r.error));assert.equal(r.usage.length,24);s.observation(r.id,{revision:r.revision,readback:canvasRead()});await s.whenSettled(r.id);r=s.poll(r.id);assert.equal(r.error.code,'LANDING_STEP_BUDGET');assert.equal(r.result,null);assert.equal(h.calls.length,24);
});

test('asset projection includes exact glyph metadata and source image/key indexes without raw glyph29MB',async t=>{
 const builder=require('../scripts/build-knowledge-package');const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-asset-')));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const put=(p,v)=>{fs.mkdirSync(path.dirname(path.join(temp,p)),{recursive:true});fs.writeFileSync(path.join(temp,p),JSON.stringify(v));};
 put('JSONS/apollo/indexes/componentContractIndex.json',{schemaVersion:2,packages:[]});
 const assets=['JSONS/images/Сorp _ Image Library -- Продуктовые имиджи.json','JSONS/images/Сorp _ Image Library -- Вспомогательные имиджи.json','JSONS/indexes/images/Сorp _ Image Library -- Продуктовые имиджи.index.json','JSONS/indexes/images/Сorp _ Image Library -- Вспомогательные имиджи.index.json','JSONS/indexes/icons/Icons -- glyph-26.index.json'];for(const p of assets)put(p,{});put('JSONS/icons/Icons -- glyph-26.json',{});put('core/web/assets/assets_glyph-26.json',{synthetic:{size:24}});
 const ds=await builder.collectDesignSystemFiles(temp),hub=await builder.collectDsAiHubFiles(temp);for(const p of assets)assert(ds.includes(p),p);assert(!ds.includes('JSONS/icons/Icons -- glyph-26.json'));assert(hub.includes('core/web/assets/assets_glyph-26.json'));assert(ds.includes('JSONS/apollo/indexes/componentContractIndex.json'));
});
