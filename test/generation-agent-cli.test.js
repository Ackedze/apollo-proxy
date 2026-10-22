const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
const {createAgentCli,MAX_PROMPT_CHARS}=require('../src/generation-agent/agent-cli');
function fixture(t,behavior='success'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'apollo-cli-regression-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(const n of ['workspace','trace'])fs.mkdirSync(root+'/'+n);
 let calls=0,observed,started;const spawned=new Promise(r=>started=r),kills=[];
 const cli=createAgentCli({generatedRoot:root,model:'synthetic-model',environment:{PATH:process.env.PATH,HOME:os.homedir(),APOLLO_AGENT_KEY:'must-not-leak'},maxRuntimeMs:1000,mcpConnection:{name:'apollo_figma_mcp',url:'https://mcp.figma.com/mcp',fileKey:'syntheticFile',tools:['use_figma','get_screenshot']},spawnProcess:(binary,args,options)=>{
  calls++;observed={binary,args,options};if(behavior==='spawn-error')throw Error('/private/binary');
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=signal=>{kills.push(signal);observed.firstKillAt??=observed.nativeToolStarts;queueMicrotask(()=>child.emit('close',null));};
  child.stdin=new Writable({write(chunk,encoding,done){observed.input=(observed.input||'')+chunk.toString();done();},final(done){done();queueMicrotask(()=>{
   if(['mcp-budget-replay','mcp-global-limit'].includes(behavior)){
    for(let i=0;i<(behavior==='mcp-global-limit'?25:6);i++){
     observed.nativeToolStarts=i+1;const item={id:'mcp:call-'+i,type:'mcp_tool_call',server:'apollo_figma_mcp',tool:'use_figma',status:'in_progress',arguments:{fileKey:'syntheticFile',code:'return {read: true};'}},message=i===1?"TypeError: node.slotProperty: no such property 'slotProperty' on COMPONENT node":i===2?'Return value exceeds the 20480-byte limit (33651 bytes). Canvas edits from this run were not committed.':null;
     child.stdout.write(JSON.stringify({type:'item.started',item})+'\n');child.stdout.write(JSON.stringify({type:'item.completed',item:{...item,status:message?'failed':'completed',result:message?{structured_content:{error:{message},safeToRetryWithoutCanvasRead:true}}:{content:[{type:'text',text:'{}'}]}}})+'\n');
    }
    fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({kind:'finish',message:'Synthetic complete',resourceIds:[]}));child.emit('close',0);return;
   }
   if(behavior.startsWith('mcp-')){
    const item={id:'mcp:call-one',type:'mcp_tool_call',server:'apollo_figma_mcp',tool:'use_figma',status:'in_progress',arguments:{fileKey:'syntheticFile',code:'const node = await figma.getNodeByIdAsync("root:known"); return {id: node.id};',description:'Synthetic read'}};
    if(behavior==='mcp-argument-guard')item.arguments.code='x'.repeat(20000);if(behavior==='mcp-many-events')for(let i=0;i<40;i++)child.stdout.write(JSON.stringify({type:'item.updated',item})+'\n');observed.mcpArguments=item.arguments;child.stdout.write(JSON.stringify({type:'item.started',item})+'\n');
    if(['mcp-timeout','mcp-argument-guard'].includes(behavior))return;
    const completed={...item,status:'failed',result:behavior==='mcp-tool-guard'?{content:[{type:'text',text:'x'.repeat(70000)}]}:null,error:{message:behavior==='mcp-transport-timeout'?'tool call error: tool call failed for `apollo_figma_mcp/use_figma`\n\nCaused by:\n    timed out awaiting tools/call after 15s':'Synthetic actual tool getter failed'}};
    child.stdout.write(JSON.stringify({type:'item.completed',item:completed})+'\n');
    if(behavior==='mcp-tool-guard')return;
    child.stdout.write(JSON.stringify({type:'turn.failed',error:{message:'Synthetic provider stopped after tool failure'}})+'\n');child.emit('close',1);return;
   }
   if(behavior==='wait')return;
   if(behavior==='model-unavailable'){child.stderr.write('The requested model does not exist');child.emit('close',1);return;}
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
test('an unavailable engineering model preserves the requested ID and fails without fallback',async t=>{
 const f=fixture(t,'model-unavailable');await assert.rejects(f.run(),e=>e.code==='AGENT_MODEL_UNAVAILABLE'&&e.status===400);
 assert.equal(f.calls(),1);const args=f.observed().args;assert.equal(args[args.indexOf('--model')+1],'synthetic-model');assert.equal(f.failure().model,'synthetic-model');
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
test('actual MCP CLI stdin permits proven default SLOT replacement while preserving roots and interrupted work',async t=>{
 const f=fixture(t),prefix=require('../src/generation-agent/agent-cli').profilePrefix('figma-mcp'),profile=fs.readFileSync(path.resolve(__dirname,'../../../projects/Apollo/instructions/agent-generation/figma-mcp.md'),'utf8');
 await f.run({profile:'figma-mcp',prompt:profile});const actual=f.observed().input;assert.equal(actual,prefix+'\n'+profile);
 assert(!/source\/library edits or deletion/.test(actual),'A blanket deletion ban prevents legitimate slot replacement');
 assert(!actual.includes('If any proof or mutation outcome is unknown'),'Full-norm UNKNOWN must not become a blanket prewrite veto');
 assert(prefix.includes('DS/norm/default-style checking and automatic compliance repair are disabled'));
 assert(prefix.includes('no quality certification, Ready=false'));
 for(const text of ['Only during normal assembly','untouched default placeholder payload','fresh instance created in this run','root ownership','exact mapped SLOT reference','pristine source correspondence of the entire default payload','frozen ScreenSpec','append and verify replacement content before removing only that proven default payload','return removed IDs','Keep the native SLOT and its parent instance','Never delete roots, other generated content, user content, outside nodes or library definitions','failure, timeout, cancellation or unknown write','capabilityGap without deleting anything'])assert(prefix.includes(text),text);
 assert(profile.includes('Never delete roots'));assert(profile.includes('Stop and preserve partial work'));assert(f.observed().args.includes('features.shell_tool=false'));
});
test('recorded MCP failure sequence can finish six calls within its admitted run budget',async t=>{
 const f=fixture(t,'mcp-budget-replay'),out=await f.run({profile:'figma-mcp',mcpBudget:{maxToolCalls:6}});assert.equal(out.result.kind,'finish');assert.equal(out.receipt.mcp.toolCalls,6);assert.equal(out.receipt.mcp.maxToolCalls,6);assert.deepEqual(f.kills,[]);assert.deepEqual(out.receipt.mcp.nativeFailures.map(f=>f.code),['FIGMA_MCP_API_PROPERTY_UNSUPPORTED','FIGMA_MCP_RESULT_LIMIT']);assert.equal(out.receipt.mcp.nativeFailures[0].property,'slotProperty');assert.equal(out.receipt.mcp.nativeFailures[1].limitBytes,20480);
});
test('MCP connection and host share the standard60s deadline without reducing call allowance',async t=>{
 const f=fixture(t);await f.run({profile:'figma-mcp'});const {MCP_TOOL_TIMEOUT_MS}=require('../src/generation-agent/agent-cli'),{LIMITS}=require('../src/generation-agent/agent-mcp-service');
 assert.equal(MCP_TOOL_TIMEOUT_MS,60000);assert.equal(LIMITS.toolMs,MCP_TOOL_TIMEOUT_MS);assert(f.observed().args.some(s=>s.includes('tool_timeout_sec=60')));assert.equal(LIMITS.execMs,300000);assert.equal(LIMITS.runMs,900000);
});
test('recorded client timeout has a distinct code and observed call timing with unknown remote outcome',async t=>{
 const f=fixture(t,'mcp-transport-timeout');let error;await assert.rejects(f.run({profile:'figma-mcp'}),e=>{error=e;return e.code==='AGENT_PROCESS_FAILED';});
 const receipt=f.failure(),native=error.nativeFailures[0];assert.equal(native.code,'FIGMA_MCP_TRANSPORT_TIMEOUT');assert.equal(native.callId,'mcp:call-one');assert.equal(native.timeoutMs,15000);assert.equal(native.safeToRetryWithoutCanvasRead,null);assert(Number.isFinite(native.observedDurationMs));assert(native.observedDurationMs>=0);assert.equal(receipt.mcpToolTimings.length,1);assert.equal(receipt.mcpToolTimings[0].callId,native.callId);assert.equal(receipt.mcpToolTimings[0].status,'failed');assert.equal(receipt.mcpToolTimings[0].durationMs,native.observedDurationMs);assert.equal(JSON.parse(error.diagnostic).code,'AGENT_PROCESS_FAILED');
});
test('MCP total budget still stops at24 and retains the first native causes separately from interruption',async t=>{
 const f=fixture(t,'mcp-global-limit');let error;await assert.rejects(f.run({profile:'figma-mcp',mcpBudget:{maxToolCalls:999}}),e=>{error=e;return e.code==='AGENT_MCP_TOOL_LIMIT';});assert.equal(f.observed().firstKillAt,25);assert.equal(f.failure().nativeFailures[0].callId,'mcp:call-1');assert.equal(error.nativeFailures[1].actualBytes,33651);assert.equal(error.nativeFailures[0].safeToRetryWithoutCanvasRead,true);assert.equal(JSON.parse(error.diagnostic).code,'AGENT_MCP_TOOL_LIMIT');
});
test('CLI diagnostic carries run and step into the private receipt and public message',async t=>{
 const f=fixture(t,'failure');let error;await assert.rejects(f.run({diagnosticContext:{phase:'model',runId:'run:test',modelStep:3,revision:1,nodeId:null}}),e=>{error=e;return true;});
 const d=JSON.parse(error.diagnostic),receipt=f.failure();assert.equal(d.schemaVersion,'apollo.generation-failure.v1');assert.equal(d.runId,'run:test');assert.equal(d.modelStep,3);assert.equal(d.nodeStatus,'unresolved');assert.equal(receipt.errorId,d.errorId);assert.equal(receipt.runId,d.runId);assert.equal(receipt.traceId,d.traceId);
 const second=fixture(t,'failure');let another;await assert.rejects(second.run(),e=>{another=JSON.parse(e.diagnostic);return true;});assert.notEqual(another.errorId,d.errorId);assert.equal(another.code,d.code);
});
test('proxy diagnostic module is shipped locally and the CLI loads without an author checkout',t=>{
 const f=fixture(t),standalone=f.root+'/standalone';fs.mkdirSync(standalone);const directory=path.resolve(__dirname,'../src/generation-agent');for(const n of ['agent-cli.js','failure-diagnostic.js','usage.js'])fs.copyFileSync(path.join(directory,n),path.join(standalone,n));
 assert.equal(typeof require(standalone+'/agent-cli').createAgentCli,'function');const canonical=path.resolve(__dirname,"../../../projects/Apollo/src/generation/failure.js");assert.deepEqual(fs.readFileSync(directory+'/failure-diagnostic.js'),fs.readFileSync(canonical));
});

for(const [behavior,code]of [['mcp-nonzero','AGENT_PROCESS_FAILED'],['mcp-timeout','AGENT_TIMEOUT'],['mcp-tool-guard','AGENT_MCP_TOOL_OUTPUT_LIMIT'],['mcp-argument-guard','AGENT_MCP_TOOL_ARGUMENT_LIMIT'],['mcp-many-events','AGENT_PROCESS_FAILED']])test('failed MCP item events remain bounded and correlated in physical trace: '+behavior,async t=>{
 const f=fixture(t,behavior);let error;await assert.rejects(f.run({profile:'figma-mcp',diagnosticContext:{runId:'run:mcp',rootNodeId:'root:known',nodeId:null,modelStep:2}}),e=>{error=e;return e.code===code;});
 const receipt=f.failure(),publicFailure=JSON.parse(error.diagnostic),events=receipt.mcpToolEvents;
 assert(events&&events.observedEventCount>=1);assert(events.events.length>=1&&events.events.length<=32);const last=events.events.at(-1);assert.equal(last.id,'mcp:call-one');assert.equal(last.server,'apollo_figma_mcp');assert.equal(last.tool,'use_figma');assert.equal(last.status,['mcp-timeout','mcp-argument-guard'].includes(behavior)?'in_progress':'failed');assert.equal(last.arguments.sha256,require('node:crypto').createHash('sha256').update(JSON.stringify(f.observed().mcpArguments)).digest('hex'));
 assert(last.arguments.bytes>0);assert.equal(publicFailure.callId,'mcp:call-one');assert.equal(publicFailure.operation,'mcp.use_figma');assert.equal(publicFailure.rootNodeId,'root:known');assert.equal(publicFailure.nodeId,null);assert.equal(publicFailure.nodeStatus,'unresolved');assert.equal(receipt.traceId,publicFailure.traceId);assert.equal(receipt.errorId,publicFailure.errorId);assert.equal(publicFailure.traceRecorded,true);assert.equal(publicFailure.mcpToolEvents,undefined);
 if(!['mcp-timeout','mcp-argument-guard'].includes(behavior))assert.match(last.error.preview,/getter failed/);
 if(behavior==='mcp-tool-guard'){assert(last.result.truncated);assert(last.result.bytes>65536);assert(Buffer.byteLength(last.result.preview)<=2048);}
 if(behavior==='mcp-argument-guard'){assert(last.arguments.truncated);assert(last.arguments.bytes>16384);assert(Buffer.byteLength(last.arguments.preview)<=4096);}
 if(behavior==='mcp-many-events'){assert(events.observedEventCount>32);assert.equal(events.events.length,32);assert.equal(events.truncated,true);}
 const file=f.root+'/trace/'+receipt.traceId+'.failure.json';assert(fs.statSync(file).size<262144);assert.equal(fs.statSync(file).mode&0o777,0o600);
});
