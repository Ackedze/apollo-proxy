'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),api=require('../src/figma-mcp/connection');
const fake=String.raw`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const home=process.env.HOME,mode=fs.readFileSync(path.join(home,'mode'),'utf8'),record=path.join(home,'commands');
fs.appendFileSync(record,JSON.stringify({args:process.argv.slice(2),home,cwd:process.cwd(),codexHome:process.env.CODEX_HOME,secret:process.env.FIGMA_TEST_SECRET,pid:process.pid})+'\n');
if(process.argv.includes('add')){if(mode==='add-failed')process.exit(1);fs.appendFileSync(path.join(process.env.CODEX_HOME,'config.toml'),'\n[mcp_servers.apollo_figma_mcp]\nurl="https://mcp.figma.com/mcp"\n');fs.writeFileSync(path.join(home,'mode'),mode==='absent-needs-login'||mode==='add-hang'?'not-connected':'connected');if(mode==='add-hang'){process.on('SIGTERM',()=>{});process.stdin.resume();setInterval(()=>{},1000);return;}console.log('Registered only target');process.exit(0);}
if(process.argv.includes('login')){if(mode==='login-hang'){process.on('SIGTERM',()=>{});process.stdin.resume();setInterval(()=>{},1000);return;}if(mode!=='login-failed')fs.writeFileSync(path.join(home,'mode'),'connected');console.log('OAuth URL https://fixture.invalid/?code=PRIVATE-DO-NOT-LOG');process.exit(mode==='login-failed'?1:0);}
if(mode==='hang'){process.on('SIGTERM',()=>{});process.stdin.resume();setInterval(()=>{},1000);return;}
const input=readline.createInterface({input:process.stdin});input.on('close',()=>process.exit(0));input.on('line',line=>{
 const v=JSON.parse(line);if(!v.method)return;
 if(mode==='malformed'){console.log('not json');return;}
 let result={};if(v.method==='config/read'){
  const entry={url:'https://mcp.figma.com/mcp',enabled:true,environment_id:'local',tool_timeout_sec:null};
  if(mode==='custom-url')entry.url='https://other.invalid/mcp';
  if(mode==='custom-transport'){delete entry.url;entry.command='do-not-run';}
  if(mode==='custom-headers')entry.http_headers={Authorization:'PRIVATE-TOKEN'};
  if(mode==='custom-env')entry.env_http_headers={Authorization:'PRIVATE_ENV'};
  if(mode==='custom-helper')entry.http_headers_helper='do-not-run';
  if(mode==='custom-auth')entry.oauth={client_secret:'PRIVATE-TOKEN'};
  if(mode==='custom-unknown')entry.unrecognized=true;
  if(mode==='custom-prototype')entry.constructor='return true';
  result={config:mode==='config-unknown'?null:{mcp_servers:mode.startsWith('absent')||['add-failed','add-hang'].includes(mode)?{}:{apollo_figma_mcp:entry}}};
 }else if(v.method==='mcpServerStatus/list'){
  const row={name:'apollo_figma_mcp',httpOrigin:'https://mcp.figma.com',authStatus:'oAuth',runtimeStatus:null,serverInfo:{name:'Figma',version:'1'},serverCapabilities:{tools:{}},tools:{use_figma:{name:'use_figma',inputSchema:{type:'object'}}},toolsError:null};
  if(mode==='not-connected'){row.authStatus='notLoggedIn';row.toolsError='Auth required';row.serverInfo=null;row.serverCapabilities=null;}
  if(mode==='expired'){row.runtimeStatus='authenticationRequired';row.toolsError='Auth required';}
  if(mode==='network'){row.toolsError='connection timed out';row.serverInfo=null;row.serverCapabilities=null;}
  if(mode==='cached'){row.serverInfo=null;row.serverCapabilities=null;}
  if(mode==='unknown-auth')row.authStatus='unknown';
  if(mode==='permission'){row.toolsError='HTTP 403 forbidden for this file';row.serverInfo=null;}
  if(mode==='foreign')row.httpOrigin='https://other.invalid';
  if(mode==='missing-tool')row.tools={};
  result={data:[row],nextCursor:null};
 }
 fs.appendFileSync(path.join(home,'requests'),JSON.stringify(v)+'\n');console.log(JSON.stringify({id:v.id,result}));
});`;
async function until(check){for(let i=0;i<250;i++){try{if(check())return;}catch{}await new Promise(r=>setTimeout(r,20));}throw Error('Fixture child did not become ready');}
function fixture(t,mode='connected'){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'figma-mcp-test-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const home=path.join(root,'user space'),codexHome=path.join(root,'codex space'),binary=path.join(root,'fake codex');fs.mkdirSync(home);fs.mkdirSync(codexHome);fs.writeFileSync(path.join(home,'mode'),mode);fs.writeFileSync(binary,fake,{mode:0o755});
 const config=path.join(codexHome,'config.toml'),bytes='[mcp_servers.personal]\nurl="https://do-not-change.invalid"\n'+(mode.startsWith('custom')?'[mcp_servers.apollo_figma_mcp]\nurl="https://mcp.figma.com/mcp"\nhttp_headers={Authorization="PRIVATE-TOKEN"}\n':'');fs.writeFileSync(config,bytes);
 return {root,home,binary,environment:{...process.env,HOME:home,CODEX_HOME:codexHome,FIGMA_TEST_SECRET:'DO-NOT-INHERIT'},setMode:value=>fs.writeFileSync(path.join(home,'mode'),value),commands:()=>fs.readFileSync(path.join(home,'commands'),'utf8').trim().split('\n').map(JSON.parse),preserved:()=>{const after=fs.readFileSync(config,'utf8');assert(after===bytes||(mode.startsWith('absent')||mode==='add-hang')&&after===bytes+'\n[mcp_servers.apollo_figma_mcp]\nurl="https://mcp.figma.com/mcp"\n');if(fs.existsSync(path.join(home,'commands')))for(const c of fs.readFileSync(path.join(home,'commands'),'utf8').trim().split('\n').map(JSON.parse))assert.equal(fs.existsSync(c.cwd),false);}};
}
test('official login and live discovery share exact endpoint, binary, HOME/CODEX_HOME and preserve config',async t=>{
 const f=fixture(t),value=await api.login(f);assert.equal(value.state,'connected');assert.equal(value.fileAccessVerified,false);const calls=f.commands();assert.equal(calls.length,3);
 assert(calls[0].args.includes('app-server'));assert(calls[1].args.includes('login'));assert(calls[2].args.includes('app-server'));
 for(const c of calls){assert.equal(c.home,f.home);assert.equal(c.codexHome,f.environment.CODEX_HOME);assert.equal(c.secret,undefined);assert(!c.args.some(x=>x.startsWith('mcp_servers=')));assert(c.args.includes(api.credentialsConfig));}
 const methods=fs.readFileSync(path.join(f.home,'requests'),'utf8').trim().split('\n').map(x=>JSON.parse(x).method);assert.deepEqual(methods,['initialize','initialized','config/read','initialize','initialized','config/read','mcpServerStatus/list']);f.preserved();
});
for(const [mode,state] of [['not-connected','not_connected'],['expired','reauthentication_required'],['network','unknown'],['permission','unknown'],['cached','unknown'],['unknown-auth','unknown'],['foreign','unknown'],['missing-tool','unknown'],['malformed','unknown']])test('connection '+mode+' reports '+state+' without a model or tool call',async t=>{
 const f=fixture(t,mode),value=await api.checkConnection(f);assert.equal(value.state,state);assert.equal(f.commands().length,1);f.preserved();
});
test('timeout and cancellation kill owned children and permit retry',async t=>{
 const f=fixture(t,'hang'),value=await api.checkConnection({...f,timeoutMs:1500});assert.equal(value.reason,'CHECK_TIMEOUT');for(const c of f.commands())assert.throws(()=>process.kill(c.pid,0),{code:'ESRCH'});
 const controller=new AbortController(),pending=api.checkConnection({...f,signal:controller.signal});await until(()=>f.commands().length>=2);controller.abort();assert.equal((await pending).state,'cancelled');
 for(const c of f.commands())assert.throws(()=>process.kill(c.pid,0),{code:'ESRCH'});f.setMode('connected');assert.equal((await api.checkConnection(f)).state,'connected');f.preserved();
});
test('login failure and missing CLI stay unverified; no discovery after failed OAuth',async t=>{
 const f=fixture(t,'login-failed');assert.equal((await api.login(f)).reason,'LOGIN_FAILED');assert.equal(f.commands().length,2);assert.equal((await api.checkConnection({...f,binary:path.join(f.root,'missing')})).reason,'CLI_UNAVAILABLE');
});
test('native command never prints private OAuth output; parent EOF cancels descendants',async t=>{
 const f=fixture(t),appHome=path.join(f.root,'app/proxy'),script=path.join(appHome,'scripts/figma-mcp-cli.js');fs.mkdirSync(path.dirname(script),{recursive:true});fs.copyFileSync(path.resolve(__dirname,'../scripts/figma-mcp-cli.js'),script);fs.mkdirSync(path.join(appHome,'src/figma-mcp'),{recursive:true});fs.symlinkSync(path.resolve(__dirname,'../src/figma-mcp/connection.js'),path.join(appHome,'src/figma-mcp/connection.js'));
 async function launch(mode,interrupt=false){const child=spawn(process.execPath,[script,mode,'--binary',f.binary],{env:f.environment,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);if(interrupt){await until(()=>f.commands().length>=4);child.stdin.end();}const code=await new Promise((res,rej)=>{child.once('error',rej);child.once('close',res)});return{out,err,code};}
 const ok=await launch('login');assert.equal(ok.code,0);assert.equal(JSON.parse(ok.out).state,'connected');assert(!ok.out.includes('PRIVATE-DO-NOT-LOG'));assert.equal(ok.err,'');
 f.setMode('hang');assert.equal(JSON.parse((await launch('check',true)).out).state,'cancelled');for(const c of f.commands())assert.throws(()=>process.kill(c.pid,0),{code:'ESRCH'});
});
test('only this MCP startup auth failure is classified; file access and other servers remain separate',()=>{
 assert(api.executionAuthRequired('Failed to initialize session: apollo_figma_mcp: Auth required'));
 for(const text of ['apollo_knowledge: Auth required','apollo_figma_mcp: timed out','apollo_figma_mcp: HTTP 403 forbidden file','ordinary process failure','apollo_figma_mcp: timed out; apollo_knowledge: Auth required'])assert(!api.executionAuthRequired(text));
});

test('Ask works through the actual Proxy endpoint with no Figma OAuth or MCP commands',async t=>{
 const f=fixture(t),ds=path.join(f.root,'knowledge/design-system_ab'),hub=path.join(f.root,'knowledge/ds-ai-hub'),put=(name,text)=>{fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,text);};
 put(path.join(ds,'JSONS/apollo/indexes/componentContractIndex.json'),JSON.stringify({schemaVersion:2,packages:[{componentKey:'fixture',packagePath:'fixture',artifacts:{contract:'contract.json'}}]}));put(path.join(ds,'JSONS/fixture/contract.json'),'{}');put(path.join(ds,'JSONS/apollo/designPatternRules.json'),'{"rules":[]}');put(path.join(ds,'redpolrules/dictionary.json'),'{"rules":[]}');put(path.join(ds,'patterns/fixture.md'),'# Fixture');
 for(const d of ['products/ab/components','core/web/components'])fs.mkdirSync(path.join(hub,d),{recursive:true});put(path.join(hub,'products/ab/patterns/fixture.md'),'# Fixture');
 const binary=path.join(f.root,'ask-codex');put(binary,'#!'+process.execPath+'\n'+`const fs=require('node:fs');const args=process.argv.slice(2);if(args.some(x=>['app-server','mcp','login'].includes(x)))throw Error('Ask must not ask for Figma OAuth');process.stdin.resume();process.stdin.on('end',()=>fs.writeFileSync(args[args.indexOf('--output-last-message')+1],'Ask without Figma'));`);fs.chmodSync(binary,0o700);
 const code=`const assert=require('node:assert/strict'),{app}=require(${JSON.stringify(path.resolve(__dirname,'../server.js'))});(async()=>{const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'codex',text:'Fixture question'})});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.result,'Ask without Figma');console.log('ASK_NO_FIGMA_PASS');}finally{await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1});`;
 const output=require('node:child_process').execFileSync(process.execPath,['-e',code],{cwd:f.root,encoding:'utf8',timeout:15000,env:{...f.environment,APOLLO_STATE_ROOT:path.join(f.root,'state'),APOLLO_PROXY_HOME:f.root,APOLLO_PROJECT_ROOT:path.join(f.root,'no-runtime'),APOLLO_RELEASE_ROOT:path.join(f.root,'no-release'),APOLLO_DATA_ROOT:path.join(f.root,'no-data'),APOLLO_CODEX_DEBUG_ROOT:path.join(f.root,'debug'),APOLLO_CLI_PROVIDER:'codex',CODEX_BIN:binary,CODEX_WORKSPACE:path.join(f.root,'no-workspace'),CODEX_DESIGN_SYSTEM:ds,CODEX_DS_AI_HUB:hub,APOLLO_CODEX_KNOWLEDGE_SOURCE:'design-system_ab',APOLLO_PROXY_MANAGED:'0'}});assert.match(output,/ASK_NO_FIGMA_PASS/);
});

for(const mode of ['custom-url','custom-transport','custom-headers','custom-env','custom-helper','custom-auth','custom-unknown','custom-prototype','config-unknown'])test('existing '+mode+' is preserved; no login, registration, model or MCP discovery',async t=>{
 const f=fixture(t,mode),value=await api.login(f);assert.equal(value.state,mode==='config-unknown'?'unknown':'config_conflict');assert.equal(f.commands().length,1);const requests=fs.readFileSync(path.join(f.home,'requests'),'utf8');assert(!requests.includes('mcpServerStatus/list'));assert(!JSON.stringify(f.commands()).includes('PRIVATE-TOKEN'));f.preserved();
});
test('only missing connection is registered; immediate OAuth never opens a second login',async t=>{
 const immediate=fixture(t,'absent-immediate');assert.equal((await api.login(immediate)).state,'connected');let calls=immediate.commands();assert.equal(calls.length,3);assert(calls[1].args.includes('add'));assert(calls[1].args.includes(api.URL));assert(!calls.some(c=>c.args.includes('login')));immediate.preserved();
 const later=fixture(t,'absent-needs-login');assert.equal((await api.login(later)).state,'connected');calls=later.commands();assert.equal(calls.filter(c=>c.args.includes('add')).length,1);assert.equal(calls.filter(c=>c.args.includes('login')).length,1);later.preserved();
 const failed=fixture(t,'add-failed');assert.equal((await api.login(failed)).reason,'LOGIN_FAILED');assert(!failed.commands().some(c=>c.args.includes('login')));failed.preserved();
});

for(const mode of ['add-hang','login-hang'])test('cancel '+mode+' closes the owned OAuth process, preserves settings and permits deliberate retry',async t=>{
 const f=fixture(t,mode),controller=new AbortController(),pending=api.login({...f,signal:controller.signal});await until(()=>f.commands().length>=2);controller.abort();assert.equal((await pending).state,'cancelled');for(const c of f.commands())assert.throws(()=>process.kill(c.pid,0),{code:'ESRCH'});f.setMode('not-connected');assert.equal((await api.login(f)).state,'connected');assert.equal(f.commands().filter(c=>c.args.includes('add')).length,mode==='add-hang'?1:0);f.preserved();
});
test('OAuth login has a finite deadline and kills a process that ignores termination',async t=>{
 const f=fixture(t,'login-hang');assert.equal((await api.login({...f,timeoutMs:3000})).reason,'LOGIN_TIMEOUT');assert(f.commands().length>=2);for(const c of f.commands())assert.throws(()=>process.kill(c.pid,0),{code:'ESRCH'});f.preserved();
});

test('native adapter binds admitted current code, refuses stale/pending/tampered code and never falls back across rollback',async t=>{
 const f=fixture(t),home=path.join(f.root,'app/proxy'),store=path.join(f.root,'app/code-releases'),code=require('../src/code-release/store'),{selectConnection}=require('../scripts/figma-mcp-cli');
 const loaded=path.join(f.root,'loaded-helpers');
 const put=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);},moduleText=tag=>'require("node:fs").appendFileSync('+JSON.stringify(loaded)+','+JSON.stringify(tag+'\n')+');module.exports={tag:'+JSON.stringify(tag)+',login:async()=>({}),checkConnection:async()=>({})};';
 put(path.join(home,'package.json'),JSON.stringify({version:'1.0.0',dependencies:{}}));put(path.join(home,'package-lock.json'),'{}');put(path.join(home,'node_modules/.package-lock.json'),'{}');put(path.join(home,'src/figma-mcp/connection.js'),moduleText('bootstrap'));
 fs.mkdirSync(path.join(home,'src/code-release'),{recursive:true});fs.symlinkSync(path.resolve(__dirname,'../src/code-release/store.js'),path.join(home,'src/code-release/store.js'));
 const bootstrap=selectConnection(home);assert.equal(bootstrap.api.tag,'bootstrap');bootstrap.assertCurrent();
 await t.test('dangling store entry cannot select bootstrap',()=>{fs.symlinkSync(path.join(f.root,'missing-store'),store);try{assert.throws(()=>selectConnection(home));assert.throws(()=>bootstrap.assertCurrent());}finally{fs.unlinkSync(store);}});
 await t.test('existing empty store cannot select bootstrap',()=>{fs.mkdirSync(store);assert.throws(()=>selectConnection(home));assert.throws(()=>bootstrap.assertCurrent());});
 async function version(name,tag){const source=path.join(f.root,'source-'+name),dest=path.join(store,'stage-'+name);put(path.join(source,'server.js'),'module.exports={};');put(path.join(source,'package.json'),JSON.stringify({version:name,dependencies:{}}));if(tag)put(path.join(source,'src/figma-mcp/connection.js'),moduleText(tag));const manifest=await code.snapshotCode({sourceRoot:source,destination:dest,version:name,sourceCommit:null,profile:code.compatibility(home)});fs.mkdirSync(path.join(store,'versions'),{recursive:true});fs.renameSync(dest,code.versionRoot(store,manifest.id));return{id:manifest.id,version:name};}
 const a=await version('1.0.1','active-a'),b=await version('1.0.2','active-b'),old=await version('1.0.0',null),state=current=>({schemaVersion:code.STORE_SCHEMA,current,previous:null,pending:null});
 const set=value=>put(path.join(store,'state.json'),JSON.stringify(value));
 await t.test('versions without state, malformed JSON and invalid state fail closed',()=>{assert.throws(()=>selectConnection(home));put(path.join(store,'state.json'),'{');assert.throws(()=>selectConnection(home));set({});assert.throws(()=>selectConnection(home));});
 await t.test('manifest identity and version must match current before helper loading',()=>{
  const wrong={...a,id:'f'.repeat(64)},root=code.versionRoot(store,wrong.id),before=fs.readFileSync(loaded,'utf8');fs.cpSync(code.versionRoot(store,a.id),root,{recursive:true});
  set(state(wrong));assert.throws(()=>selectConnection(home),{code:'CODE_CHANGED'});set(state({...a,version:'9.9.9'}));assert.throws(()=>selectConnection(home),{code:'CODE_CHANGED'});assert.equal(fs.readFileSync(loaded,'utf8'),before);
 });
 set(state(a));const selected=selectConnection(home);assert.equal(selected.api.tag,'active-a');selected.assertCurrent();
 await t.test('post-flow checks current version and manifest identity again',()=>{
  set(state({...a,version:'9.9.9'}));assert.throws(()=>selected.assertCurrent(),{code:'CODE_CHANGED'});set(state(a));
  const root=code.versionRoot(store,a.id),saved=path.join(f.root,'saved-a');fs.renameSync(root,saved);
  try{fs.cpSync(code.versionRoot(store,b.id),root,{recursive:true});assert.throws(()=>selected.assertCurrent(),{code:'CODE_CHANGED'});}finally{fs.rmSync(root,{recursive:true,force:true});fs.renameSync(saved,root);}
  selected.assertCurrent();
 });
 set(state(b));assert.throws(()=>selected.assertCurrent(),{code:'CODE_CHANGED'});assert.equal(selectConnection(home).api.tag,'active-b');
 const pending=state(b);pending.pending=a;set(pending);assert.throws(()=>selectConnection(home),{code:'CODE_SELECTION_BUSY'});
 set(state(old));assert.throws(()=>selectConnection(home),{code:'CODE_UPDATE_REQUIRED'});
 set(state(b));const tampered=path.join(code.versionRoot(store,b.id),'src/figma-mcp/connection.js');fs.chmodSync(tampered,0o600);fs.appendFileSync(tampered,'// changed');assert.throws(()=>selectConnection(home));f.preserved();
});

test('relative credential-home paths cannot bind login and generation to different temporary profiles',async t=>{
 const f=fixture(t);for(const key of ['HOME','CODEX_HOME']){const value=await api.login({...f,environment:{...f.environment,[key]:'relative-profile'}});assert.equal(value.reason,'ENVIRONMENT_UNVERIFIED');}assert(!fs.existsSync(path.join(f.home,'commands')));f.preserved();
});
