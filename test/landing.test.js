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
 let release;const h=harness(t,[()=>new Promise(resolve=>release=resolve)]),s=h.service;let r=s.create({pageId:'0:1',fileKey:'FileKey123'});s.submit(r.id,message(r));const settled=s.whenSettled(r.id);r=s.cancel(r.id);assert.equal(h.calls[0].signal.aborted,true);release(step('build'));await settled;r=s.poll(r.id);assert.equal(r.status,'cancelled');assert.equal(r.result,null);assert.equal(r.target,null);
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
