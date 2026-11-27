'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');

test('consultation, a CLI skill and a passport run independently with isolated cancellation and maintenance', {timeout:30000},async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'parallel-dialogue-'))),ds=path.join(root,'ds'),hub=path.join(root,'hub'),binary=path.join(root,'owned-agent');
 const put=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
 put(path.join(ds,'JSONS/apollo/indexes/componentContractIndex.json'),JSON.stringify({schemaVersion:2,packages:[{componentKey:'fixture',packagePath:'fixture',artifacts:{contract:'contract.json'}}]}));
 put(path.join(ds,'JSONS/fixture/contract.json'),'{"name":"Fixture"}');put(path.join(ds,'JSONS/apollo/designPatternRules.json'),'{"rules":[]}');put(path.join(ds,'redpolrules/dictionary.json'),'{"rules":[]}');put(path.join(ds,'patterns/fixture.md'),'# Synthetic rule');
 fs.mkdirSync(path.join(hub,'products/ab/components'),{recursive:true});fs.mkdirSync(path.join(hub,'core/web/components'),{recursive:true});put(path.join(hub,'products/ab/patterns/fixture.md'),'# Synthetic rule');put(path.join(hub,'products/ab/components/fixture/meta.json'),'{"id":"fixture","name":"Fixture"}');
 put(binary,'#!'+process.execPath+'\n'+`
const fs=require('node:fs'),path=require('node:path'),root=${JSON.stringify(root)},args=process.argv.slice(2);
if(args.includes('mcp')&&args.includes('list')){console.log('[]');process.exit(0);}
let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{
 const naming=input.includes('\\nOVERVIEW='),kind=naming?'skill':'chat';
 fs.writeFileSync(path.join(root,kind+'.json'),JSON.stringify({pid:process.pid,args,input}));
 console.log(JSON.stringify({type:'turn.started'}));
 const timer=setInterval(()=>{
  if(!fs.existsSync(path.join(root,kind+'-release')))return;
  clearInterval(timer);
  const result=naming?JSON.stringify({action:'finish',nodeIds:[],changes:[]}):'Synthetic independent chat reply';
  fs.writeFileSync(args[args.indexOf('--output-last-message')+1],result);
  console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:2,cached_input_tokens:0}}));
 },10);
});
`);fs.chmodSync(binary,0o700);
 const controlKey='a'.repeat(64),passportKey='b'.repeat(64);
 Object.assign(process.env,{CODEX_BIN:binary,APOLLO_PROJECT_ROOT:path.resolve(__dirname,'../../../projects/Apollo'),APOLLO_CLI_PROVIDER:'codex',APOLLO_CODEX_DEBUG_ENABLED:'0',APOLLO_RELEASE_ROOT:'',APOLLO_STATE_ROOT:root,APOLLO_PROXY_MANAGED:'0',CODEX_DESIGN_SYSTEM:ds,CODEX_DS_AI_HUB:hub,APOLLO_CODEX_KNOWLEDGE_SOURCE:'design-system_ab',APOLLO_UX_WRITER_OPENROUTER:'1',APOLLO_CODE_UPDATE_KEY:controlKey});
 let passportCalls=0,passportFailure=false;
 require('../src/skills/ux-writer/openrouter').completeStructured=({cancellation})=>new Promise((_resolve,reject)=>{
  passportCalls++;
  if(passportFailure){reject(Object.assign(Error('Owned provider failure'),{code:'OPENROUTER_RATE_LIMIT'}));return;}
  cancellation.addEventListener('abort',()=>reject(cancellation.reason),{once:true});
 });
 const landing={busy:false};let auditUnavailable;
 require('../src/generation/semantic-index').inspectSemanticIndex=()=>({ready:false,reason:'synthetic-no-model'});
 require('../src/landing/runtime').mountConfiguredLandingRoutes=()=>({isBusy:()=>landing.busy});
 require('../src/figma-audit/runtime').mountConfiguredAuditRoutes=(_app,options)=>{auditUnavailable ||= options.isUnavailable;return{isBusy:()=>false};};
 const {app}=require('../server'),protocol=require('../src/skills/layer-names/run-protocol')(require(path.resolve(__dirname,'../../../projects/Apollo/src/skills/layer-names/protocol')));
 app.get('/owned-test/skill-admission',(_req,res)=>res.json({unavailable:auditUnavailable()}));
 const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',e=>{fs.rmSync(root,{recursive:true,force:true});reject(e);});}),base='http://127.0.0.1:'+server.address().port;
 const controllers=[],ownedPids=new Set();let skillRun,passportRun;
 const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
 const wait=async check=>{const deadline=Date.now()+8000;while(Date.now()<deadline){const v=await check();if(v)return v;await new Promise(r=>setTimeout(r,10));}assert.fail('Owned fake process did not reach expected state');};
 const marker=kind=>{try{const v=JSON.parse(fs.readFileSync(path.join(root,kind+'.json')));ownedPids.add(v.pid);return v;}catch{return null;}};
 const health=()=>fetch(base+'/health').then(r=>r.json());
 const post=async(url,body,signal,headers={})=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal});return{status:r.status,body:await r.json()};};
 const passportInput={schemaVersion:'apollo.task-passport.v1',brief:'',snapshot:{name:'Owned',notes:[],links:[],screens:[{id:'s1',name:'Owned',box:[0,0,400,800],texts:['Synthetic'],buttons:[],components:[]}]}};
 const startPassport=()=>post('/skills/task-passport/runs',passportInput,undefined,{'X-Apollo-Task-Passport-Key':passportKey,Origin:'null'});
 const cancelPassport=()=>post('/skills/task-passport/runs/'+passportRun.id+'/cancel',{},undefined,{'X-Apollo-Task-Passport-Key':passportKey,Origin:'null'});
 const ask=signal=>post('/analyze',{source:'codex',session_id:'same-consultation',text:JSON.stringify({schemaVersion:1,mode:'design-dialogue',question:'Synthetic question'}),dialogue:[]},signal);
 t.after(async()=>{for(const c of controllers)c.abort();if(passportRun)await cancelPassport().catch(()=>{});if(skillRun)try{await post('/skills/layer-names/runs/'+skillRun.runId+'/cancel',{requestId:skillRun.requestId});}catch{}for(const pid of ownedPids)if(alive(pid))try{process.kill(pid,'SIGKILL');}catch{}server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
 const snapshot={schemaVersion:protocol.SCHEMA,snapshotId:'parallel-fixture',pageId:'page',rootIds:['form'],scopeName:'Owned',observedCount:1,skippedCount:0,nodes:[{nodeId:'form',type:'FRAME',parentId:'page',oldName:'Frame 1',path:'Frame 1',texts:['Synthetic']}]};
 const started=await post('/skills/layer-names/runs',{schemaVersion:protocol.RUN_SCHEMA,wire:{version:protocol.WIRE_VERSION,sha256:protocol.WIRE_SHA256},requestId:'parallel-skill',snapshot});assert.equal(started.status,202,JSON.stringify(started.body));skillRun=started.body.run;
 const skillPid=(await wait(()=>marker('skill'))).pid;
 const passport=await startPassport();assert.equal(passport.status,202,'passport starts during the active CLI skill');passportRun=passport.body;
 assert.equal((await startPassport()).status,429,'same passport still has one active run');
 assert.equal((await health()).taskPassport.busy,true);assert(alive(skillPid));assert.equal(passportCalls,0);
 const first=new AbortController();controllers.push(first);let firstError;const chat=ask(first.signal).then(v=>{if(v.status!==200)firstError=v;return v;}).catch(e=>e);
 const firstChat=await wait(()=>{assert(!firstError,JSON.stringify(firstError));return marker('chat');});let state=await health();assert.equal(state.capabilities.parallelDialogue,true);assert.equal(state.agent.busy,true);assert.equal(state.codex.busy,true);assert.equal(state.dialogue.busy,true);assert.equal(state.dialogue.cancelScope,'server-request');assert(alive(skillPid));
 assert.equal((await ask()).status,429,'second turn cannot enter the dialogue slot');
 first.abort();assert.equal((await chat).name,'AbortError');await wait(async()=>!(await health()).dialogue.busy);await wait(()=>!alive(firstChat.pid));assert(alive(skillPid));assert.equal((await health()).agent.busy,true,'skill remains active after chat cancellation');
 const second=new AbortController();controllers.push(second);const reply=ask(second.signal);
 const secondChat=await wait(()=>{const v=marker('chat');return v&&v.pid!==firstChat.pid?v:null;});
 const args=secondChat.args;assert(args.includes('features.apps=false'));assert(args.includes('features.plugins=false'));assert(args.includes('features.remote_plugin=false'));assert(args.includes('read-only'));
 assert.equal((await post('/skills/layer-names/runs/'+skillRun.runId+'/cancel',{requestId:skillRun.requestId})).status,200);await wait(()=>!alive(skillPid));assert.equal((await health()).dialogue.busy,true,'chat remains active after skill cancellation');
 assert.equal((await fetch(base+'/owned-test/skill-admission').then(r=>r.json())).unavailable,false,'a live chat HTTP request does not occupy the skill admission gate');
 const again=await post('/skills/layer-names/runs',{schemaVersion:protocol.RUN_SCHEMA,wire:{version:protocol.WIRE_VERSION,sha256:protocol.WIRE_SHA256},requestId:'parallel-skill-again',snapshot});
 assert.equal(again.status,202,'another CLI skill starts while the passport is awaiting approval');skillRun=again.body.run;
 const nextSkillPid=(await wait(()=>{const v=marker('skill');return v&&v.pid!==skillPid?v:null;})).pid;
 assert.equal((await post('/ux-writer/openrouter/approval',{runId:passportRun.id,key:'owned-passport-key'},undefined,{'X-Apollo-Code-Key':controlKey})).status,200);
 await wait(()=>passportCalls===1);
 assert.equal((await health()).taskPassport.busy,true);
 await cancelPassport();await wait(async()=>!(await health()).taskPassport.busy);passportRun=null;
 assert(alive(nextSkillPid));assert.equal((await health()).dialogue.busy,true,'passport cancellation leaves both other tasks running');
 await post('/skills/layer-names/runs/'+skillRun.runId+'/cancel',{requestId:skillRun.requestId});await wait(()=>!alive(nextSkillPid));
 put(path.join(root,'chat-release'),'release');const completed=await reply;assert.equal(completed.status,200);assert.equal(completed.body.result,'Synthetic independent chat reply');await wait(async()=>!(await health()).agent.busy);
 const alone=await startPassport();assert.equal(alone.status,202);passportRun=alone.body;
 state=await health();assert.equal(state.agent.busy,true);assert.equal(state.codex.busy,false,'passport does not occupy the CLI slot');
 const maintenanceHeaders={'X-Apollo-Code-Key':controlKey,'X-Apollo-Code-Lease':'a33681d8-e5b6-41c1-a499-e40a54186d57'};
 assert.equal((await post('/code-update/prepare',{},undefined,maintenanceHeaders)).body.code,'CODE_PROXY_BUSY','maintenance keeps the read-only run safe');
 assert.equal((await fetch(base+'/owned-test/skill-admission').then(r=>r.json())).unavailable,false);
 await cancelPassport();await wait(async()=>!(await health()).agent.busy);passportRun=null;
 assert.equal((await post('/code-update/prepare',{},undefined,maintenanceHeaders)).status,200);
 await post('/code-update/release',{},undefined,maintenanceHeaders);
 passportFailure=true;const failing=await startPassport();assert.equal(failing.status,202);passportRun=failing.body;
 await post('/ux-writer/openrouter/approval',{runId:passportRun.id,key:'owned-failed-key'},undefined,{'X-Apollo-Code-Key':controlKey});
 await wait(async()=>!(await health()).taskPassport.busy);
 const failed=await fetch(base+'/skills/task-passport/runs/'+passportRun.id,{headers:{'X-Apollo-Task-Passport-Key':passportKey,Origin:'null'}}).then(r=>r.json());
 assert.equal(failed.status,'failed');assert.equal(failed.error,'OPENROUTER_RATE_LIMIT');assert.equal((await health()).agent.busy,false);
 passportFailure=false;const retry=await startPassport();assert.equal(retry.status,202,'model failure releases only the passport slot');passportRun=retry.body;
 await cancelPassport();await wait(async()=>!(await health()).taskPassport.busy);passportRun=null;
 landing.busy=true;state=await health();assert.equal(state.agent.busy,true);assert.equal(state.generation.busy,true);assert.equal(state.dialogue.busy,false);
 assert.equal((await ask()).status,200,'consultation also works during an asynchronous generation');assert.equal((await health()).agent.busy,true,'global maintenance busy remains set by generation');landing.busy=false;
});

test('cancellation during tool isolation cannot spawn a new model process',async()=>{
 const cp=require('node:child_process'),isolation=require('../src/reports/ABM-tool-isolation');
 const originalSpawn=cp.spawn,originalIsolation=isolation.isolateAbmTools,controller=new AbortController();let spawns=0;
 require('../src/token-journal').configure(null);
 try{
  isolation.isolateAbmTools=async(_binary,args)=>{controller.abort();return args;};
  cp.spawn=()=>{spawns++;throw Error('A cancelled request must not spawn');};
  delete require.cache[require.resolve('../src/reports/process')];
  const {runCodexProcess}=require('../src/reports/process');
  await assert.rejects(runCodexProcess(['exec','-'],'Synthetic input','unused-output',null,'waiting',{mode:'dialogue',signal:controller.signal}),{code:'CLI_CANCELLED'});
  assert.equal(spawns,0);
 }finally{cp.spawn=originalSpawn;isolation.isolateAbmTools=originalIsolation;}
});
