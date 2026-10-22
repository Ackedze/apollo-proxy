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
 const result=structured?{summary:'fixture'}:'Fixture response';
 if(a.includes('--output-last-message'))fs.writeFileSync(a[a.indexOf('--output-last-message')+1],structured?JSON.stringify(result):result);
 else console.log(JSON.stringify({type:'result',is_error:false,...(structured?{structured_output:result}:{result})}));
});`);fs.chmodSync(binary,0o700);
  const expected=mode==='default'?null:provider+'-model-choice';
  const script=`
const assert=require('node:assert/strict'),fs=require('fs');const {app,callCodexContractExplanation}=require(${JSON.stringify(path.resolve(__dirname,'../server'))});
(async()=>{const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));const base='http://127.0.0.1:'+s.address().port;
const ask=text=>fetch(base+'/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'codex',text})});
try{
 const expected=${JSON.stringify(expected)},health=await(await fetch(base+'/health')).json();assert.equal(health.agent.model,expected);
 let response=await ask('fixture'),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.model,expected);assert.equal(body.provider,${JSON.stringify(provider)});
 assert.deepEqual(await callCodexContractExplanation('structured fixture',{type:'object',properties:{summary:{type:'string'}}}),{summary:'fixture'});
 response=await ask('UNAVAILABLE');body=await response.json();assert.equal(response.status,400,JSON.stringify(body));assert.match(body.error,/модель недоступна/);
 const calls=fs.readFileSync(${JSON.stringify(record)},'utf8').trim().split('\\n').map(JSON.parse);assert.equal(calls.length,3);
 for(const args of calls){const i=args.indexOf('--model');if(expected===null)assert.equal(i,-1);else assert.equal(args[i+1],expected);}
 assert.equal((await(await fetch(base+'/health')).json()).agent.model,expected);console.log('model routing PASS');
}finally{s.closeAllConnections();await new Promise(r=>s.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});`;
  const env=Object.assign({},process.env,{APOLLO_CLI_PROVIDER:provider,CODEX_MODEL:mode==='default'?'':'codex-model-choice',CLAUDE_MODEL:mode==='default'?'':'claude-model-choice',CODEX_BIN:binary,CLAUDE_BIN:binary,CODEX_DESIGN_SYSTEM:ds,CODEX_DS_AI_HUB:hub,APOLLO_CODEX_KNOWLEDGE_SOURCE:'design-system_ab',APOLLO_PROXY_MANAGED:'0',APOLLO_CODEX_DEBUG_ENABLED:'0'});
  assert.match(execFileSync(process.execPath,['-e',script],{cwd:root,env,encoding:'utf8',timeout:18000}),/model routing PASS/);
 });
}
