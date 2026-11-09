'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const {EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
const {createAgentCli,invocation,DIRECT_FIGMA_TOOLS}=require('../src/generation-agent/agent-cli');
const session='12345678-1234-1234-1234-123456789abc',knowledge={releaseRoot:'/private/tmp/installed-data',runtimeRoot:'/private/tmp/installed-runtime',sourcePin:'a'.repeat(64),skillId:'ab-generate-custom-landing'},connection={name:'apollo_figma_mcp',url:'https://mcp.figma.com/mcp',fileKey:'FixtureFile',tools:DIRECT_FIGMA_TOOLS};
function fixture(t,attack=null,readiness={state:"connected",reason:"FIXTURE"}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'direct-cli-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(const n of ['work','trace'])fs.mkdirSync(path.join(root,n));const invocations=[],probes=[],spawnEnvironments=[];
 const cli=createAgentCli({generatedRoot:root,mcpConnection:connection,knowledgeConnection:knowledge,maxRuntimeMs:2000,checkMcp:async input=>{probes.push(input);return typeof readiness==='function'?readiness(input):readiness;},spawnProcess(_bin,args,options){spawnEnvironments.push({binary:_bin,env:options.env});
  invocations.push(args);const child=new EventEmitter();child.pid=987999999;child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{queueMicrotask(()=>child.emit('close',null));};
  child.stdin=new Writable({write(_chunk,_enc,done){done();},final(done){done();queueMicrotask(()=>{
   if(attack==='startup-timeout'||attack==='process-failure'||attack==='auth-required'){child.stderr.write(attack==='auth-required'?'Failed to initialize session: apollo_figma_mcp: Auth required':attack==='startup-timeout'?'Failed to initialize session: required MCP servers failed to initialize: apollo_figma_mcp: MCP client startup timed out after 30s':'ordinary process failure');child.emit('close',1);return;}
   const emit=value=>child.stdout.write(JSON.stringify(value)+'\n');emit({type:'thread.started',thread_id:session});
   let item={id:'knowledge:1',type:'mcp_tool_call',server:'apollo_knowledge',tool:'read_source',arguments:{id:'knowledge/data/ds-ai-hub/products/ab/manifest.json'},status:'in_progress'};
   if(attack==='server')item.server='other_server';if(attack==='shell')item={id:'command:1',type:'command_execution',command:'cat /outside'};if(attack==='file')item={id:'file:1',type:'file_change'};
   if(attack==='file-scope')item={id:'figma:1',type:'mcp_tool_call',server:'apollo_figma_mcp',tool:'use_figma',arguments:{fileKey:'ForeignFile',code:'return {};'},status:'in_progress'};
   emit({type:'item.started',item});if(attack)return;
   emit({type:'item.completed',item:{...item,status:'completed',result:{content:[{type:'text',text:'{"text":"Packaged rule"}'}]}}});
   emit({type:'turn.completed',usage:{input_tokens:10,output_tokens:3}});fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({status:'partial'}));child.emit('close',0);
  });}});return child;
 }});
 return {root,invocations,probes,spawnEnvironments,run:opts=>cli.run({workspace:path.join(root,'work'),traceDirectory:path.join(root,'trace'),profile:'landing-direct',prompt:'Read packaged sources',schema:{type:'object'},mcpBudget:{maxToolCalls:128},...opts})};
}
test('every fresh and resumed CLI launch disables host skills/shell and connects the pinned reader plus direct Figma MCP',async t=>{
 const f=fixture(t);const first=await f.run();await f.run({sessionId:first.receipt.sessionId});assert.equal(first.receipt.sessionId,session);
 for(const args of f.invocations){for(const setting of ['features.skip_host_skill_discovery=true','skills.include_instructions=false','skills.bundled.enabled=false','features.shell_tool=false','features.apps=false','features.plugins=false'])assert(args.includes(setting));assert(!args.includes('--ephemeral'));const config=args.find(x=>x.startsWith('mcp_servers='));assert(config.includes('apollo_figma_mcp=')&&config.includes('apollo_knowledge=')&&config.includes(knowledge.sourcePin));assert(config.includes('knowledge-mcp.js'));}
 assert(!f.invocations[0].includes('resume'));assert.equal(f.invocations[1][f.invocations[1].indexOf('resume')+1],session);
});
for(const attack of ['server','shell','file','file-scope'])test('direct CLI refuses '+attack+' outside its two allowed MCP capabilities',async t=>{
 const f=fixture(t,attack);await assert.rejects(f.run(),{code:attack==='file-scope'?'AGENT_MCP_FILE_SCOPE_MISMATCH':'AGENT_MCP_TOOL_NOT_ALLOWED'});
});
test('new direct profile requires pinned installed roots and a valid resume session',()=>{
 const base={profile:'landing-direct',workspace:'/private/tmp/work',schemaPath:'/private/tmp/schema',outputPath:'/private/tmp/output',mcpConnection:connection,knowledgeConnection:knowledge};assert.throws(()=>invocation({...base,knowledgeConnection:null}),{code:'AGENT_KNOWLEDGE_UNAVAILABLE'});assert.throws(()=>invocation({...base,sessionId:'../other'}),{code:'AGENT_SESSION_INVALID'});
});
test('actual MCP startup timeout has its own diagnosis and does not imply a failed canvas read',async t=>{
 const f=fixture(t,'startup-timeout');await assert.rejects(f.run(),error=>{assert.equal(error.code,'AGENT_MCP_STARTUP_TIMEOUT');const d=JSON.parse(error.diagnostic);assert.equal(d.stage,'mcp-startup');assert.deepEqual(d.mcpStartup,{server:'apollo_figma_mcp',timeoutMs:30000});assert.equal(d.callId,null);return true;});
 const other=fixture(t,'process-failure');await assert.rejects(other.run(),{code:'AGENT_PROCESS_FAILED'});
});

test('direct skill descriptor cannot enable a legacy executor or recipe workflow',()=>{
 const catalog=require('../src/skills/catalog'),p=path.resolve(__dirname,'../../../shared/design-system_ab/apollo/skills/ab-generate-custom-landing/manifest.json'),value=JSON.parse(fs.readFileSync(p));assert.equal(value.generation.workflow,catalog.DIRECT_WORKFLOW);catalog.packageFiles(Buffer.from(JSON.stringify(value)),value.id);
 for(const extra of [{skeletonExecutor:'native-layout-v1'},{recipeOperations:'slot-content-replacement-v1'}])assert.throws(()=>catalog.packageFiles(Buffer.from(JSON.stringify({...value,generation:{...value.generation,...extra}})),value.id),{code:'SKILL_CATALOG_INVALID'});
});

test('Figma readiness refuses model execution, preserves private failure and separates unknown from reauthentication',async t=>{
 for(const [state,code] of [['config_conflict','AGENT_MCP_CONFIG_CONFLICT'],['not_connected','AGENT_MCP_AUTH_REQUIRED'],['reauthentication_required','AGENT_MCP_AUTH_REQUIRED'],['unknown','AGENT_MCP_CONNECTION_UNVERIFIED'],['cancelled','AGENT_CANCELLED']]){
  const f=fixture(t,null,{state,reason:'FIXTURE',privateError:'original fixture failure'});await assert.rejects(f.run(),{code});assert.equal(f.invocations.length,0);const file=fs.readdirSync(path.join(f.root,'trace')).find(n=>n.endsWith('.failure.json'));assert(file);const trace=JSON.parse(fs.readFileSync(path.join(f.root,'trace',file)));assert.equal(trace.stderr,'original fixture failure');assert.equal(trace.mcpAuthentication.state,state);
 }
});
test('execution Auth required has an exact diagnosis while preserving original stderr and error code',async t=>{
 const f=fixture(t,'auth-required');await assert.rejects(f.run(),e=>e.code==='AGENT_MCP_AUTH_REQUIRED'&&JSON.parse(e.diagnostic).traceRecorded===true);const file=fs.readdirSync(path.join(f.root,'trace')).find(n=>n.endsWith('.failure.json')),trace=JSON.parse(fs.readFileSync(path.join(f.root,'trace',file)));assert.equal(trace.originalCode,'AGENT_PROCESS_FAILED');assert.match(trace.stderr,/apollo_figma_mcp: Auth required/);assert.equal(trace.stage,'mcp-authentication');
});

test('readiness and execution use the same binary/environment and shared MCP/OAuth definition',async t=>{
 const f=fixture(t);await f.run();assert.equal(f.probes[0].binary,f.spawnEnvironments[0].binary);assert.deepEqual(f.probes[0].environment,f.spawnEnvironments[0].env);const connection=require('../src/figma-mcp/connection');assert(f.invocations[0].includes(connection.credentialsConfig));assert(f.invocations[0].find(x=>x.startsWith('mcp_servers=')).includes('apollo_figma_mcp={'+connection.serverConfig(DIRECT_FIGMA_TOOLS)));
});
test('unexpected readiness errors and exhausted budget cannot start a model process',async t=>{
 const failed=fixture(t,null,()=>{throw Error('Fixture check failed');});await assert.rejects(failed.run(),{code:'AGENT_MCP_CONNECTION_UNVERIFIED'});assert.equal(failed.invocations.length,0);
 const slow=fixture(t,null,async()=>{await new Promise(r=>setTimeout(r,30));return {state:'connected'};});await assert.rejects(slow.run({runtimeBudgetMs:10}),{code:'AGENT_EXECUTION_TIME_BUDGET'});assert.equal(slow.invocations.length,0);
});
