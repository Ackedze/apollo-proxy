const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
const {createAgentCli,MAX_PROMPT_CHARS}=require('../src/generation-v4/agent-cli');
function fixture(t,behavior='success'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'apollo-cli-regression-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(const n of ['workspace','trace'])fs.mkdirSync(root+'/'+n);
 let calls=0,observed,started;const spawned=new Promise(r=>started=r),kills=[];
 const cli=createAgentCli({generatedRoot:root,model:'synthetic-model',environment:{PATH:process.env.PATH,HOME:os.homedir(),APOLLO_AGENT_KEY:'must-not-leak'},maxRuntimeMs:1000,spawnProcess:(binary,args,options)=>{
  calls++;observed={binary,args,options};if(behavior==='spawn-error')throw Error('/private/binary');
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=signal=>{kills.push(signal);queueMicrotask(()=>child.emit('close',null));};
  child.stdin=new Writable({write(chunk,encoding,done){observed.input=(observed.input||'')+chunk.toString();done();},final(done){done();queueMicrotask(()=>{
   if(behavior==='wait')return;
   if(behavior==='failure'||behavior==='input-limit'){child.stderr.write(behavior==='failure'?'Synthetic stderr /private/diagnostic':'Input exceeds the maximum length; input_too_large');child.stdout.write(JSON.stringify({type:'error',message:'Synthetic provider refusal'})+'\n');child.emit('close',1);return;}
   fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({kind:'capabilityGap',message:'Synthetic only'}));child.emit('close',0);
  });}});started();return child;
 }});
 const run=(overrides={})=>cli.run({workspace:root+'/workspace',profile:'figma-engineering',prompt:'Synthetic prompt',schema:{type:'object'},traceDirectory:root+'/trace',...overrides});
 const failure=()=>JSON.parse(fs.readFileSync(root+'/trace/'+fs.readdirSync(root+'/trace').find(n=>n.endsWith('.failure.json'))));
 return{root,run,failure,calls:()=>calls,observed:()=>observed,spawned,kills};
}
test('worker input budget counts the final profile prefix and refuses before spawning',async t=>{
 const f=fixture(t);await assert.rejects(f.run({prompt:'x'.repeat(MAX_PROMPT_CHARS)}),e=>e.code==='AGENT_CONTEXT_LIMIT'&&e.status===413);
 assert.equal(f.calls(),0);const receipt=f.failure();assert.equal(receipt.stage,'input-budget');assert(receipt.promptChars>MAX_PROMPT_CHARS);assert.equal(receipt.maxPromptChars,MAX_PROMPT_CHARS);assert.equal(Object.hasOwn(receipt,'prompt'),false);
});
test('failed worker persists bounded private stderr and a correlated public diagnostic without source text',async t=>{
 const f=fixture(t,'failure');let error;await assert.rejects(f.run(),e=>{error=e;return e.code==='AGENT_PROCESS_FAILED';});const receipt=f.failure(),diagnostic=JSON.parse(error.diagnostic);
 assert.equal(receipt.stderr,'Synthetic stderr /private/diagnostic');assert.equal(receipt.exitCode,1);assert.equal(receipt.errorEvents[0].type,'error');assert.equal(diagnostic.traceId,receipt.traceId);assert.equal(diagnostic.traceRecorded,true);assert.equal(error.diagnostic.includes('/private'),false);
 const file=f.root+'/trace/'+receipt.traceId+'.failure.json';assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(Object.hasOwn(receipt,'environment'),false);
});
test('a provider input-size refusal has a specific code and retained failure receipt',async t=>{const f=fixture(t,'input-limit');await assert.rejects(f.run(),e=>e.code==='AGENT_CONTEXT_LIMIT');assert(f.failure().stderr.includes('input_too_large'));});
test('spawn failures keep a diagnostic receipt without exposing the executable path',async t=>{const f=fixture(t,'spawn-error');await assert.rejects(f.run(),e=>e.code==='AGENT_CLI_UNAVAILABLE'&&!e.diagnostic.includes('/private'));assert.equal(f.failure().stage,'spawn');});
test('cancel and timeout retain failure diagnostics and the original terminal codes',async t=>{
 const cancelled=fixture(t,'wait'),controller=new AbortController(),pending=cancelled.run({signal:controller.signal});await cancelled.spawned;controller.abort();await assert.rejects(pending,e=>e.code==='AGENT_CANCELLED');assert.deepEqual(cancelled.kills,['SIGTERM']);assert.equal(cancelled.failure().stage,'interrupted');
 const timed=fixture(t,'wait');await assert.rejects(timed.run(),e=>e.code==='AGENT_TIMEOUT'&&e.status===504);assert.equal(timed.failure().code,'AGENT_TIMEOUT');
});
test('successful worker profiles preserve sandbox arguments, isolated environment and ordinary trace receipt',async t=>{
 for(const profile of ['figma-engineering','frontend-engineering']){const f=fixture(t),out=await f.run({profile}),seen=f.observed();assert.equal(out.result.kind,'capabilityGap');assert.equal(seen.args[seen.args.indexOf('--sandbox')+1],profile==='frontend-engineering'?'workspace-write':'read-only');assert.equal(seen.options.env.APOLLO_AGENT_KEY,undefined);assert(seen.args.includes('sandbox_workspace_write.network_access=false'));assert.equal(fs.readdirSync(f.root+'/trace').some(n=>n.endsWith('.failure.json')),false);}
});
test('CLI diagnostic carries run and step into the private receipt and public message',async t=>{
 const f=fixture(t,'failure');let error;await assert.rejects(f.run({diagnosticContext:{phase:'model',runId:'run:test',modelStep:3,revision:1,nodeId:null}}),e=>{error=e;return true;});
 const d=JSON.parse(error.diagnostic),receipt=f.failure();assert.equal(d.schemaVersion,'apollo.generation-failure.v1');assert.equal(d.runId,'run:test');assert.equal(d.modelStep,3);assert.equal(d.nodeStatus,'unresolved');assert.equal(receipt.errorId,d.errorId);assert.equal(receipt.runId,d.runId);assert.equal(receipt.traceId,d.traceId);
 const second=fixture(t,'failure');let another;await assert.rejects(second.run(),e=>{another=JSON.parse(e.diagnostic);return true;});assert.notEqual(another.errorId,d.errorId);assert.equal(another.code,d.code);
});
test('proxy diagnostic module is shipped locally and the CLI loads without an author checkout',t=>{
 const f=fixture(t),standalone=f.root+'/standalone';fs.mkdirSync(standalone);const directory=path.resolve(__dirname,'../src/generation-v4');for(const n of ['agent-cli.js','failure-diagnostic.js'])fs.copyFileSync(path.join(directory,n),path.join(standalone,n));
 assert.equal(typeof require(standalone+'/agent-cli').createAgentCli,'function');const canonical=path.resolve(__dirname,'../../../projects/Apollo-v3/apps/apollo-v4/src/generation-failure.js');assert.deepEqual(fs.readFileSync(directory+'/failure-diagnostic.js'),fs.readFileSync(canonical));
});
