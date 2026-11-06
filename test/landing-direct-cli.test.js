'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const {EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
const {createAgentCli,invocation,DIRECT_FIGMA_TOOLS}=require('../src/generation-agent/agent-cli');
const session='12345678-1234-1234-1234-123456789abc',knowledge={releaseRoot:'/private/tmp/installed-data',runtimeRoot:'/private/tmp/installed-runtime',sourcePin:'a'.repeat(64),skillId:'ab-generate-custom-landing'},connection={name:'apollo_figma_mcp',url:'https://mcp.figma.com/mcp',fileKey:'FixtureFile',tools:DIRECT_FIGMA_TOOLS};
function fixture(t,attack=null){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'direct-cli-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(const n of ['work','trace'])fs.mkdirSync(path.join(root,n));const invocations=[];
 const cli=createAgentCli({generatedRoot:root,mcpConnection:connection,knowledgeConnection:knowledge,maxRuntimeMs:2000,spawnProcess(_bin,args){
  invocations.push(args);const child=new EventEmitter();child.pid=987999999;child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{queueMicrotask(()=>child.emit('close',null));};
  child.stdin=new Writable({write(_chunk,_enc,done){done();},final(done){done();queueMicrotask(()=>{
   if(attack==='startup-timeout'||attack==='process-failure'){child.stderr.write(attack==='startup-timeout'?'Failed to initialize session: required MCP servers failed to initialize: apollo_figma_mcp: MCP client startup timed out after 30s':'ordinary process failure');child.emit('close',1);return;}
   const emit=value=>child.stdout.write(JSON.stringify(value)+'\n');emit({type:'thread.started',thread_id:session});
   let item={id:'knowledge:1',type:'mcp_tool_call',server:'apollo_knowledge',tool:'read_source',arguments:{id:'knowledge/data/ds-ai-hub/products/ab/manifest.json'},status:'in_progress'};
   if(attack==='server')item.server='other_server';if(attack==='shell')item={id:'command:1',type:'command_execution',command:'cat /outside'};if(attack==='file')item={id:'file:1',type:'file_change'};
   if(attack==='file-scope')item={id:'figma:1',type:'mcp_tool_call',server:'apollo_figma_mcp',tool:'use_figma',arguments:{fileKey:'ForeignFile',code:'return {};'},status:'in_progress'};
   emit({type:'item.started',item});if(attack)return;
   emit({type:'item.completed',item:{...item,status:'completed',result:{content:[{type:'text',text:'{"text":"Packaged rule"}'}]}}});
   emit({type:'turn.completed',usage:{input_tokens:10,output_tokens:3}});fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({status:'partial'}));child.emit('close',0);
  });}});return child;
 }});
 return {root,invocations,run:opts=>cli.run({workspace:path.join(root,'work'),traceDirectory:path.join(root,'trace'),profile:'landing-direct',prompt:'Read packaged sources',schema:{type:'object'},mcpBudget:{maxToolCalls:128},...opts})};
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
