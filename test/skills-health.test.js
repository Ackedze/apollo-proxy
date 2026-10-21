const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');

test('actual health stays busy between CLI calls and clears after a completed or cancelled naming run',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'naming-health-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const executable=path.join(root,'owned-agent');
 fs.writeFileSync(executable,'#!/usr/bin/env node\n'+`
const fs=require('node:fs'),args=process.argv.slice(2);let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{
const result=input.includes('NODE_CONTEXT=[]')?{action:'read_nodes',nodeIds:['form'],changes:[]}:{action:'finish',nodeIds:[],changes:[]};
fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(result));
});\n`,{mode:0o700});
 process.env.CODEX_BIN=executable;process.env.APOLLO_CODEX_DEBUG_ENABLED='0';process.env.APOLLO_RELEASE_ROOT='';
 const {app}=require('../server'),apolloRoot=process.env.APOLLO_PROJECT_ROOT || path.resolve(__dirname,'../../../projects/Apollo');
 const p=require('../src/skills/layer-names/run-protocol')(require(path.join(apolloRoot,'src/skills/layer-names/protocol')));
 const snapshot={schemaVersion:p.SCHEMA,snapshotId:'health-snapshot',pageId:'page',rootIds:['form'],scopeName:'Owned',observedCount:1,skippedCount:0,nodes:[{nodeId:'form',type:'FRAME',parentId:'page',oldName:'Frame 1',path:'Frame 1',texts:['Delivery']}]};
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>{server.closeIdleConnections?.();server.close(resolve);}));
 const origin='http://127.0.0.1:'+server.address().port,post=(url,body)=>fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(async r=>{assert.ok(r.ok,await r.clone().text());return r.json();});
 const health=()=>fetch(origin+'/health').then(r=>r.json());
 const wait=async(run,wanted)=>{const deadline=Date.now()+10000;while(Date.now()<deadline){const value=await fetch(origin+'/skills/layer-names/runs/'+run.runId+'?requestId='+run.requestId).then(r=>r.json());if(value.run.status===wanted)return value.run;assert.equal(value.run.status,'running');await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('Owned CLI did not settle');};
 assert.equal((await health()).agent.busy,false);
 for(const complete of [false,true]){
  const requestId='health-'+complete,{run}=await post('/skills/layer-names/runs',{schemaVersion:p.RUN_SCHEMA,wire:{version:p.WIRE_VERSION,sha256:p.WIRE_SHA256},requestId,snapshot});
  const waiting=await wait(run,'awaiting-context'),pendingHealth=await health();assert.equal(pendingHealth.agent.busy,true);assert.equal(pendingHealth.codex.busy,true);
  if(complete){await post('/skills/layer-names/runs/'+run.runId+'/context',{requestId,callId:waiting.pending.callId,context:{snapshotId:snapshot.snapshotId,nodes:[Object.assign({},snapshot.nodes[0],{layoutMode:'VERTICAL',geometry:[0,0,100,100],childTypes:[]})]}});await wait(run,'completed');}
  else await post('/skills/layer-names/runs/'+run.runId+'/cancel',{requestId});
  const idle=await health();assert.equal(idle.agent.busy,false);assert.equal(idle.codex.busy,false);
 }
});
