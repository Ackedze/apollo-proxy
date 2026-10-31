const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { selectedCliProvider, assertLocalAgent } = require('../src/cli-agent');

test('AlfaGen is a selectable HTTP provider, never a local CLI', () => {
  assert.equal(selectedCliProvider('alfagen'), 'alfagen');
  assert.throws(() => assertLocalAgent('alfagen'), {code: 'AGENT_PROVIDER_CAPABILITY_UNAVAILABLE', status: 503});
  assert.doesNotThrow(() => assertLocalAgent('codex'));
  assert.doesNotThrow(() => assertLocalAgent('claude'));
});

for (const provider of ['codex', 'claude', 'alfagen']) {
  test(`Ask follows selected ${provider}, reports provenance and never falls back`, {timeout: 20000}, t => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-provider-')));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    function write(file, value) { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, value); }
    const ds = path.join(root, 'ds'), hub = path.join(root, 'hub');
    write(path.join(ds, 'JSONS/apollo/indexes/componentContractIndex.json'), '{"schemaVersion":2,"packages":[{"componentKey":"fixture","packagePath":"fixture","artifacts":{"contract":"contract.json"}}]}');
    write(path.join(ds, 'JSONS/fixture/contract.json'), '{"name":"Fixture"}');
    write(path.join(ds, 'JSONS/apollo/designPatternRules.json'), '{"rules":[]}');
    write(path.join(ds, 'redpolrules/dictionary.json'), '{"rules":[]}');
    write(path.join(ds, 'patterns/fixture.md'), '# Fixture');
    write(path.join(hub, 'products/ab/patterns/fixture.md'), '# Fixture');
    write(path.join(hub, 'products/ab/components/fixture/meta.json'), '{"id":"Fixture","publicComponentRoots":["Fixture"]}');
    fs.mkdirSync(path.join(hub, 'core/web/components'), {recursive: true});
    const binary = path.join(root, 'fake-cli'), record = path.join(root, 'cli-record');
    write(binary, '#!' + process.execPath + '\n' + `
const fs=require('fs');let prompt='';process.stdin.on('data',b=>prompt+=b);process.stdin.on('end',()=>{
 fs.appendFileSync(${JSON.stringify(record)},process.env.APOLLO_CLI_PROVIDER+'\\n');
 if(prompt.includes('CLI_FAIL'))process.exit(1);
 const args=process.argv.slice(2),text='fixture CLI answer';
 if(args.includes('--output-last-message'))fs.writeFileSync(args[args.indexOf('--output-last-message')+1],text);
 else console.log(JSON.stringify({type:'result',result:text,is_error:false}));
});`);
    fs.chmodSync(binary, 0o700);
    const code = `
const assert=require('node:assert/strict'),http=require('http'),fs=require('fs');
async function listen(server){server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));return 'http://127.0.0.1:'+server.address().port;}
(async()=>{
 let remoteCalls=0,mode='ok',received;const sockets=new Set();
 const remote=http.createServer(async(req,res)=>{remoteCalls++;let text='';for await(const b of req)text+=b;received={body:JSON.parse(text),headers:req.headers};
 if(mode==='hang')return;
 res.setHeader('Content-Type','application/json');res.statusCode=mode==='error'?503:200;
 res.end(JSON.stringify(mode==='empty'?{}:mode==='error'?{error:'fixture failure'}:{outputs:[{outputs:[{results:{message:{text:'fixture AlfaGen answer'}}}]}]}));});
 remote.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 process.env.APOLLO_AGENT_URL=await listen(remote)+'/api/v1/run/fixture';process.env.APOLLO_AGENT_KEY='fixture-remote-key';
 const {app,callCodexContractExplanation}=require(${JSON.stringify(path.resolve(__dirname, '../server'))});
 const proxy=http.createServer(app),base=await listen(proxy),provider=process.env.APOLLO_CLI_PROVIDER;
 const ask=(source='codex',question='fixture question',signal)=>fetch(base+'/analyze',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({source,text:question,session_id:'owned-session',dialogue:[]})});
 const localCalls=()=>fs.existsSync(${JSON.stringify(record)})?fs.readFileSync(${JSON.stringify(record)},'utf8').trim().split('\\n').length:0;
 try {
  const health=await (await fetch(base+'/health')).json();assert.equal(health.agent.provider,provider);assert.equal(health.agent.configured,true);
  let response=await ask(),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.provider,provider);assert.equal(body.source,'codex');
  assert.equal(body.result,provider==='alfagen'?'fixture AlfaGen answer':'fixture CLI answer');assert.equal(localCalls(),provider==='alfagen'?0:1);assert.equal(remoteCalls,provider==='alfagen'?1:0);
  if(provider==='alfagen'){
   assert.equal(body.knowledgeRelease,null);assert.equal(received.body.session_id,'owned-session');assert.equal(received.body.input_value,'fixture question');assert.equal(received.headers['x-api-key'],'fixture-remote-key');
   await assert.rejects(()=>callCodexContractExplanation('fixture',{}),{code:'AGENT_PROVIDER_CAPABILITY_UNAVAILABLE'});const retired=await fetch(base+'/generation/status');assert.equal(retired.status,410);assert.equal((await retired.json()).code,'GENERATION_RETIRED');
   mode='error';response=await ask();assert.equal(response.status,503);assert.match((await response.json()).error,/AlfaGen HTTP/);
   mode='empty';response=await ask();assert.equal(response.status,502);assert.match((await response.json()).error,/пустой/);
   mode='hang';const cancel=new AbortController(),pending=ask('codex','cancel fixture',cancel.signal);
   const wait=()=>new Promise(r=>setTimeout(r,10));while(remoteCalls<4)await wait();
   assert.equal((await(await fetch(base+'/health')).json()).agent.busy,true);
   assert.equal((await ask()).status,429);cancel.abort();await assert.rejects(pending);
   for(let i=0;i<100&&(await(await fetch(base+'/health')).json()).agent.busy;i++)await wait();
   assert.equal((await(await fetch(base+'/health')).json()).agent.busy,false);assert.equal(localCalls(),0);
  }else{
   response=await ask('codex','CLI_FAIL');assert.equal(response.ok,false);assert.equal(remoteCalls,0);
  }
  mode='ok';const before=remoteCalls;response=await ask('langflow');body=await response.json();assert.equal(response.status,200);assert.equal(body.source,'langflow');assert.equal(body.provider,'alfagen');assert.equal(remoteCalls,before+1);
  console.log('provider integration PASS');
 }finally{proxy.closeAllConnections();await new Promise(r=>proxy.close(r));for(const s of sockets)s.destroy();await new Promise(r=>remote.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});`;
    assert.match(execFileSync(process.execPath, ['-e', code], {cwd: root, encoding: 'utf8', timeout: 18000,
      env: Object.assign({}, process.env, {APOLLO_CLI_PROVIDER: provider, CODEX_BIN: binary, CLAUDE_BIN: binary,
        CODEX_DESIGN_SYSTEM: ds, CODEX_DS_AI_HUB: hub, APOLLO_CODEX_KNOWLEDGE_SOURCE: 'design-system_ab', APOLLO_PROXY_MANAGED: '0'})}), /integration PASS/);
  });
}
