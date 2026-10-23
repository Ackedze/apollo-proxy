const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {modelUnavailableError}=require('../src/cli-agent');

test('unavailable model diagnostics are explicit and distinct from generic failures',()=>{
 for(const message of ['model_not_found','The requested model does not exist','unknown model fixture'])assert.equal(modelUnavailableError(message).code,'AGENT_MODEL_UNAVAILABLE');
 assert.equal(modelUnavailableError('connection reset'),null);
});
for(const provider of ['codex','claude'])for(const mode of ['selected','default']){
 test(`${provider} uses its own ${mode} model for chat and structured calls, with no fallback`,{timeout:20000},t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'model-selection-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(name,data)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);return p;};
  const ds=path.join(root,'ds'),hub=path.join(root,'hub');
  write('ds/JSONS/apollo/indexes/componentContractIndex.json','{"schemaVersion":2,"packages":[{"componentKey":"fixture","packagePath":"fixture","artifacts":{"contract":"contract.json"}}]}');
  write('ds/JSONS/fixture/contract.json','{"name":"Fixture"}');write('ds/JSONS/apollo/designPatternRules.json','{"rules":[]}');write('ds/redpolrules/dictionary.json','{"rules":[]}');write('ds/patterns/fixture.md','# Fixture');
  write('hub/products/ab/patterns/fixture.md','# Fixture');write('hub/products/ab/components/fixture/meta.json','{"id":"Fixture"}');fs.mkdirSync(path.join(hub,'core/web/components'),{recursive:true});
  const record=path.join(root,'calls.jsonl'),binary=write('cli','#!'+process.execPath+'\n'+`
const fs=require('fs');let prompt='';process.stdin.on('data',v=>prompt+=v);process.stdin.on('end',()=>{
 const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(record)},JSON.stringify(a)+'\\n');
 if(prompt.includes('UNAVAILABLE')){process.stderr.write('The requested model does not exist');process.exitCode=1;return;}
 const structured=a.includes('--output-schema')||a.includes('--json-schema');
 const result=prompt.includes('OVERVIEW=')?{action:'finish',nodeIds:[],changes:[]}:structured?{summary:'fixture'}:'Fixture response';
 if(a.includes('--output-last-message')){fs.writeFileSync(a[a.indexOf('--output-last-message')+1],structured?JSON.stringify(result):result);console.log(JSON.stringify({type:'thread.started',thread_id:require('crypto').randomUUID()}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:17,output_tokens:5,cached_input_tokens:10}}));}
 else console.log(JSON.stringify({type:'result',is_error:false,usage:{input_tokens:7,cache_read_input_tokens:10,cache_creation_input_tokens:0,output_tokens:5},...(structured?{structured_output:result}:{result})}));
});`);fs.chmodSync(binary,0o700);
  const expected=mode==='default'?null:provider+'-model-choice@latest';
  const script=`
const assert=require('node:assert/strict'),fs=require('fs');const {app,callCodexContractExplanation}=require(${JSON.stringify(path.resolve(__dirname,'../server'))});
(async()=>{const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));const base='http://127.0.0.1:'+s.address().port;
const ask=text=>fetch(base+'/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'codex',text})});
try{
 const expected=${JSON.stringify(expected)},health=await(await fetch(base+'/health')).json();assert.equal(health.agent.model,expected);
 let response=await ask('fixture'),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.model,expected);assert.equal(body.provider,${JSON.stringify(provider)});
 const progress=[];assert.deepEqual(await callCodexContractExplanation('structured fixture',{type:'object',properties:{summary:{type:'string'}}},{onProgress:event=>progress.push(event)}),{summary:'fixture'});
 assert.ok(progress.some(e=>e.kind==='request-prepared'&&e.provider===${JSON.stringify(provider)}&&e.requestedModel===expected&&/^apollo-contract-v4-[A-Za-z0-9_-]+$/.test(e.cliRunId)));
 response=await ask('UNAVAILABLE');body=await response.json();assert.equal(response.status,400,JSON.stringify(body));assert.match(body.error,/модель недоступна/);
 const threeBatches=${JSON.stringify(provider==='codex'&&mode==='selected')};
 if(threeBatches){
  const p=require(${JSON.stringify(path.resolve(__dirname,'../src/skills/layer-names/run-protocol'))})(require(require('path').join(process.env.APOLLO_PROJECT_ROOT,'src/skills/layer-names/protocol')));
  for(let i=0;i<3;i++){
   const requestId='three-batch-'+i,snapshot={schemaVersion:p.SCHEMA,snapshotId:'batch-'+i,pageId:'page',rootIds:['root'],scopeName:'Owned',observedCount:1,skippedCount:0,nodes:[{nodeId:'root',type:'FRAME',parentId:'page',oldName:'Frame 1',path:'Frame 1',texts:['Owned']}]};
   response=await fetch(base+'/skills/layer-names/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:p.RUN_SCHEMA,wire:{version:p.WIRE_VERSION,sha256:p.WIRE_SHA256},requestId,snapshot})});body=await response.json();assert.equal(response.status,202,JSON.stringify(body));let run=body.run;
   while(run.status==='running'){await new Promise(r=>setTimeout(r,10));body=await(await fetch(base+'/skills/layer-names/runs/'+run.runId+'?requestId='+requestId)).json();run=body.run;}
   assert.equal(run.status,'completed');assert.equal(body.diagnostics.requestedModel,expected);
  }
 }
 const calls=fs.readFileSync(${JSON.stringify(record)},'utf8').trim().split('\\n').map(JSON.parse);assert.equal(calls.length,threeBatches?6:3);
 for(const args of calls){const i=args.indexOf('--model');if(expected===null)assert.equal(i,-1);else assert.equal(args[i+1],expected);}
 assert.equal((await(await fetch(base+'/health')).json()).agent.model,expected);
 const rows=(await(await fetch(base+'/usage')).json()).records;assert.equal(rows.length,threeBatches?6:3);assert.equal(rows.filter(r=>r.totalTokens===22).length,threeBatches?5:2);assert.equal(rows.filter(r=>r.totalTokens===null&&r.status==='failed').length,1);
 if(threeBatches){const skills=rows.filter(r=>r.operation==='Навык · Переименовать слои');assert.equal(skills.length,3);assert.ok(skills.every(r=>r.calls===1&&r.totalTokens===22&&r.inputTokens===17&&r.outputTokens===5&&r.cachedInputTokens===10));assert.equal(skills.reduce((n,r)=>n+r.totalTokens,0),66);}
 console.log('model routing PASS');
}finally{s.closeAllConnections();await new Promise(r=>s.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});`;
  const env=Object.assign({},process.env,{APOLLO_CLI_PROVIDER:provider,CODEX_MODEL:mode==='default'?'':'codex-model-choice@latest',CLAUDE_MODEL:mode==='default'?'':'claude-model-choice@latest',CODEX_BIN:binary,CLAUDE_BIN:binary,CODEX_DESIGN_SYSTEM:ds,CODEX_DS_AI_HUB:hub,APOLLO_CODEX_KNOWLEDGE_SOURCE:'design-system_ab',APOLLO_PROXY_MANAGED:'0',APOLLO_CODEX_DEBUG_ENABLED:'0'});
  assert.match(execFileSync(process.execPath,['-e',script],{cwd:root,env,encoding:'utf8',timeout:18000}),/model routing PASS/);
 });
}
test('real process wrapper accounts resumed cumulative usage without changing CLI arguments', {timeout:20000}, async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'token-process-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const binary=path.join(root,'cli'),output=path.join(root,'result.json'),journalRoot=path.join(root,'journal');
 fs.writeFileSync(binary,'#!'+process.execPath+'\n'+`
const fs=require('fs');let prompt='';process.stdin.on('data',v=>prompt+=v);process.stdin.on('end',()=>{
 const args=process.argv.slice(2),i=Number(prompt),id='01a1654b-fc1e-7092-918e-ee798befe820';
 const counters=[[19869,691,10752],[46573,942,30464],[77992,1042,56960]][i];
 if((i===0&&args.includes('resume'))||(i>0&&args[args.indexOf('resume')+1]!==id))throw Error('Session flow changed');
 fs.writeFileSync(${JSON.stringify(output)},'{"ok":true}');console.log(JSON.stringify({type:'thread.started',thread_id:id}));
 console.log(JSON.stringify({type:'turn.started'}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:counters[0],output_tokens:counters[1],cached_input_tokens:counters[2]}}));
});`);fs.chmodSync(binary,0o700);
 const script=`
const assert=require('node:assert/strict'),api=require(${JSON.stringify(path.resolve(__dirname,'../src/token-journal'))});
const journal=api.createTokenJournal(${JSON.stringify(journalRoot)});api.configure(journal);
const {runCodexProcess}=require(${JSON.stringify(path.resolve(__dirname,'../src/reports/process'))});
(async()=>{for(let i=0;i<3;i++){
 const args=i?['exec','resume','01a1654b-fc1e-7092-918e-ee798befe820','--json','-']:['exec','--json','-'];
 assert.deepEqual(await runCodexProcess(args,String(i),${JSON.stringify(output)},null,'analyzing_layout',{workingDirectory:${JSON.stringify(root)}}),{ok:true});
}assert.deepEqual(journal.read().records.map(r=>r.totalTokens).sort((a,b)=>a-b),[20560,26955,31519]);console.log('session accounting PASS');})().catch(e=>{console.error(e);process.exitCode=1;});`;
 const env={...process.env,APOLLO_CLI_PROVIDER:'codex',CODEX_BIN:binary,CODEX_MODEL:'fixture',CODEX_WORKSPACE:root};
 assert.match(execFileSync(process.execPath,['-e',script],{cwd:root,env,encoding:'utf8',timeout:18000}),/session accounting PASS/);
});
