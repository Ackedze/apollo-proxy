'use strict';
const {failureDiagnostic,readFailure}=require('./failure-diagnostic');
const {measurement,budget,persistMeasurement}=require('./usage');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const ENV=['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','LANG','LC_ALL','CODEX_HOME'];
const MAX_PROMPT_CHARS=900000;
const MCP_MAX_TOOL_CALLS=24;
const MCP_TOOL_TIMEOUT_MS=60000;
const isMcp=profile=>profile==='landing-figma';
const fail=code=>{throw Object.assign(new Error(code),{code,status:503});};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function mcpNativeFailures(events,timings=[]){
 const result=[],seen=new Set();
 for(const event of events){const item=event.item,detail=item?.result?.structured_content||item?.result?.structuredContent;
  if(item?.type!=='mcp_tool_call'||event.type!=='item.completed'||seen.has(item.id)||item.status!=='failed'&&!detail?.error&&!item.error&&item.result?.isError!==true)continue;
  seen.add(item.id);const raw=detail?.error?.message||item.error?.message||item.result?.content?.find(c=>c.type==='text')?.text,message=typeof raw==='string'?raw:'',property=message.match(/no such property '([A-Za-z][A-Za-z0-9_]{0,119})' on ([A-Z_]{1,64}) node/),size=message.match(/Return value exceeds the (\d{1,9})-byte limit \((\d{1,9}) bytes\)/);
  const timeout=message.match(/timed out awaiting tools\/call after (\d{1,6}(?:\.\d{1,3})?)s/),timing=timings.find(t=>t.callId===item.id);
  const value={callId:/^[a-zA-Z0-9._:-]{1,120}$/.test(item.id||'')?item.id:null,code:timeout?'FIGMA_MCP_TRANSPORT_TIMEOUT':property?'FIGMA_MCP_API_PROPERTY_UNSUPPORTED':size?'FIGMA_MCP_RESULT_LIMIT':'FIGMA_MCP_TOOL_ERROR',safeToRetryWithoutCanvasRead:typeof detail?.safeToRetryWithoutCanvasRead==='boolean'?detail.safeToRetryWithoutCanvasRead:null};
  if(timeout)Object.assign(value,{timeoutMs:Number(timeout[1])*1000,observedDurationMs:timing?.durationMs??null});
  if(property)Object.assign(value,{property:property[1],nodeType:property[2]});if(size)Object.assign(value,{limitBytes:Number(size[1]),actualBytes:Number(size[2])});result.push(value);if(result.length===8)break;
 }
 return result;
}
// Failure traces keep bounded observed tool facts. They do not prove remote
// completion or identify a failing child node from model/tool text.
function mcpFailureEvents(events){
 const observed=events.map((event,index)=>({event,index})).filter(row=>row.event.item?.type==='mcp_tool_call'),selected=observed.slice(-32);
 const text=(value,max)=>typeof value==='string'?value.slice(0,max):null;
 const body=(value,limit)=>{if(value===undefined||value===null)return null;const raw=typeof value==='string'?value:JSON.stringify(value),bytes=Buffer.byteLength(raw);return{sha256:sha(Buffer.from(raw)),bytes,preview:Buffer.from(raw).subarray(0,limit).toString('utf8'),truncated:bytes>limit};};
 const summaries=selected.map(({event,index})=>{const item=event.item;return{ordinal:index,eventType:text(event.type,80),id:text(item.id,512),server:text(item.server||item.server_name,256),tool:text(item.tool,256),status:text(item.status,80),arguments:body(item.arguments,4096),result:body(item.result,1024),error:body(item.error,1024)};});
 return{schemaVersion:'apollo.failed-mcp-tool-events.v1',observedEventCount:observed.length,recordedEventCount:summaries.length,truncated:observed.length>selected.length,events:summaries,executionAuthority:'Observed CLI item events only; remote completion and child identity require independent readback.'};
}
function scopedDirectory(root,directory){
 if(typeof root!=='string'||typeof directory!=='string'||!path.isAbsolute(root)||!path.isAbsolute(directory))fail('AGENT_SCOPE_INVALID');
 let base,actual;try{base=fs.realpathSync(root);actual=fs.realpathSync(directory);}catch{fail('AGENT_SCOPE_INVALID');}
 if(actual!==path.resolve(directory)||actual===base||!actual.startsWith(base+path.sep)||!fs.statSync(actual).isDirectory())fail('AGENT_SCOPE_INVALID');
 return actual;
}
function invocation({workspace,profile,schemaPath,outputPath,model='',mcpConnection=null}){
 if(!['landing-plan','landing-figma'].includes(profile))fail('AGENT_PROFILE_UNAVAILABLE');
 if(isMcp(profile)&&(!mcpConnection||mcpConnection.name!=='apollo_figma_mcp'||mcpConnection.url!=='https://mcp.figma.com/mcp'||!Array.isArray(mcpConnection.tools)||!mcpConnection.tools.includes('use_figma')||mcpConnection.tools.some(t=>!['use_figma','get_screenshot'].includes(t))))fail('AGENT_MCP_UNAVAILABLE');
 const args=['-a','never','exec','--json','--ephemeral','--ignore-user-config','--ignore-rules',
  '--sandbox','read-only','--skip-git-repo-check','--cd',workspace,
  '-c','sandbox_workspace_write.writable_roots=[]','-c','sandbox_workspace_write.network_access=false',
  '-c','sandbox_workspace_write.exclude_tmpdir_env_var=true','-c','sandbox_workspace_write.exclude_slash_tmp=true',
  '--output-schema',schemaPath,'--output-last-message',outputPath];
 if(isMcp(profile)){
  const connection='mcp_servers={apollo_figma_mcp={url="https://mcp.figma.com/mcp",enabled=true,required=true,enabled_tools='+JSON.stringify(mcpConnection.tools)+',default_tools_approval_mode="approve",tool_timeout_sec='+MCP_TOOL_TIMEOUT_MS/1000+'}}';
  for(const setting of ['features.shell_tool=false','project_doc_max_bytes=0','projects.'+JSON.stringify(workspace)+'.trust_level="untrusted"','features.apps=false','features.plugins=false','features.remote_plugin=false','features.multi_agent=false','web_search="disabled"',connection])args.push('-c',setting);
 }
 if(profile==='landing-plan')for(const setting of ['features.shell_tool=false','project_doc_max_bytes=0','features.apps=false','features.plugins=false','features.remote_plugin=false','features.multi_agent=false','web_search="disabled"','mcp_servers={}'])args.push('-c',setting);
 if(model)args.push('--model',model);args.push('-');return args;
}
function profilePrefix(profile){
 if(profile==='landing-plan')return 'Landing dialogue planner. Read the supplied canonical skill and pinned knowledge. No tools, shell, files or external access. Ask only material questions and preserve confirmed facts. Return one structured step; no Figma write has happened.';
 if(profile==='landing-figma')return 'Landing execution through the supplied canonical skill and pinned knowledge. DS norms and technical/visual checks are enabled. Use only the named Figma MCP tools and exact target file. Before every mutation verify the root owner, active lease, exact target.parentNodeId (or pageId for legacy roots), and containing page. Never edit outside the owned root or library/global definitions. Load fonts before text/variant mutations, use confirmed component keys and public props/slots. Preserve user content and other sections. On an uncertain write outcome read the canvas before any further mutation; never blindly repeat or delete for cleanup. Return actual node IDs and honest PASS/FAIL/UNKNOWN with provenance. A root receipt is not design conformance; Ready=false. No shell, arbitrary local files, credentials, network requests or SDK. Workflow bodies are supplied inline or by the pinned resource reader.';
 fail('AGENT_PROFILE_UNAVAILABLE');
}


function createAgentCli({provider='codex',binary='codex',model='',generatedRoot,environment=process.env,
 maxRuntimeMs=300000,spawnProcess=spawn,mcpConnection=null,usageRoot=null,trackUsage=()=>null}={}){
 const env=Object.fromEntries(ENV.filter(k=>typeof environment[k]==='string').map(k=>[k,environment[k]]));
 if(!Number.isInteger(maxRuntimeMs)||maxRuntimeMs<1000||maxRuntimeMs>900000)fail('AGENT_PROFILE_INVALID');
 function available(){if(provider!=='codex')fail('AGENT_PROVIDER_CAPABILITY_UNAVAILABLE');}
 async function probe(){
  if(provider!=='codex')return{provider,available:false,reason:'ENGINEERING_PROFILE_NOT_IMPLEMENTED',acceptedWriteOperations:[]};
  try{
   const run=promisify(execFile),version=await run(binary,['--version'],{env,timeout:10000,maxBuffer:65536});
   const auth=await run(binary,['login','status'],{env,timeout:10000,maxBuffer:65536});
   const authenticated=/Logged in using/.test(auth.stdout+'\n'+auth.stderr);
   return{provider,available:authenticated,cliVersion:version.stdout.trim(),authentication:authenticated?'OFFICIAL_CLI_LOGGED_IN':'AUTH_REQUIRED',
    profiles:['landing-plan'].concat(mcpConnection?['landing-figma']:[]),
    mcp:{configured:!!mcpConnection,readiness:'REQUIRED_INIT_AND_TOOLS_NOT_YET_VERIFIED'},figmaAcceptedWriteOperations:[],model:model||'cli-default'};
  }catch{return{provider,available:false,reason:'CLI_OR_AUTH_UNAVAILABLE',acceptedWriteOperations:[]};}
 }
 async function run(options){
  const observed=trackUsage({provider,model:model||null,operation:'Генерация'});let failure;
  try{return await execute({...options,onEvent:event=>{observed?.event(event);options.onEvent?.(event);}});}
  catch(error){failure=error;throw error;}finally{observed?.end(failure);}
 }
 async function execute({workspace,profile,prompt,schema,traceDirectory,signal,onEvent=()=>{},diagnosticContext={},mcpBudget=null,runtimeBudgetMs=null}){
  const startedAt=Date.now();
  available();const scope=scopedDirectory(generatedRoot,workspace);
  if(typeof prompt!=='string'||Buffer.byteLength(prompt)>2*1024*1024||!schema||typeof schema!=='object')fail('AGENT_INPUT_INVALID');
  if(signal?.aborted)fail('AGENT_CANCELLED');
  // Host-owned CLI output lives outside the agent writable directory.
  const trace=scopedDirectory(generatedRoot,traceDirectory);
  if(trace===scope||trace.startsWith(scope+path.sep)||scope.startsWith(trace+path.sep))fail('AGENT_TRACE_SCOPE_INVALID');
  const id=crypto.randomUUID(),schemaPath=path.join(trace,id+'.schema.json'),outputPath=path.join(trace,id+'.output.json');
  await fsp.writeFile(schemaPath,JSON.stringify(schema),{flag:'wx',mode:0o600});
  const args=invocation({workspace:scope,profile,schemaPath,outputPath,model,mcpConnection});
  const prefix=profilePrefix(profile);
  const input=prefix+'\n'+prompt;
  const toolTimings=new Map(),timingView=()=>Array.from(toolTimings.values(),({monotonicStart,...value})=>value);
  async function failureError(code,{status=502,exitCode=null,stage='process',stderr='',events=[]}={}){
   const mcpToolEvents=isMcp(profile)?mcpFailureEvents(events):null,lastTool=mcpToolEvents?.events.at(-1),safe=value=>typeof value==='string'&&/^[a-zA-Z0-9._:-]{1,120}$/.test(value)?value:null;
   const nativeFailures=isMcp(profile)?mcpNativeFailures(events,timingView()):[];
   const callContext=lastTool?{callId:safe(lastTool.id),operation:safe('mcp.'+lastTool.tool)}:{};
   const diagnostic={...failureDiagnostic(code,{...diagnosticContext,...callContext,stage,traceId:id},'err:'+id),exitCode,promptChars:input.length,promptBytes:Buffer.byteLength(input),maxPromptChars:MAX_PROMPT_CHARS};
   const usage=measurement({prompt,schema,prefix:prefix+'\n',events,durationMs:Date.now()-startedAt,requestId:diagnosticContext.requestId,runId:diagnosticContext.runId,stage:diagnosticContext.stage||'executor',attempt:diagnosticContext.modelStep,method:isMcp(profile)?'mcp':'landing-plan'});
   let traceRecorded=true;
   try{await fsp.writeFile(path.join(trace,id+'.failure.json'),JSON.stringify({...diagnostic,provider,profile,model:model||'cli-default',promptSha256:sha(Buffer.from(input)),schemaSha256:sha(Buffer.from(JSON.stringify(schema))),stderr,usage,usageEvents:events.filter(e=>e.type==='turn.completed'),errorEvents:events.filter(e=>['error','turn.failed'].includes(e.type)).slice(-16),...(mcpToolEvents?{mcpToolEvents,nativeFailures,mcpToolTimings:timingView()}:{})},null,2)+'\n',{flag:'wx',mode:0o600});}catch{traceRecorded=false;}
   try{persistMeasurement(usageRoot,usage,events.filter(e=>e.type==='turn.completed'));}catch{usage.persistence='FAILED';}
   return Object.assign(Error(code),{code,status,usage,nativeFailures,diagnostic:JSON.stringify({...diagnostic,traceRecorded})});
  }
  try{budget({prompt,schema,prefix:prefix+'\n',outputReserveChars:isMcp(profile)?163840:16384});}catch{throw await failureError('AGENT_CONTEXT_LIMIT',{status:413,stage:'input-budget'});}
  if(isMcp(profile)&&(!Number.isSafeInteger(mcpBudget?.maxToolCalls??MCP_MAX_TOOL_CALLS)||(mcpBudget?.maxToolCalls??MCP_MAX_TOOL_CALLS)<1))throw await failureError('AGENT_MCP_BUDGET_INVALID',{status:400,stage:'input-budget'});
  return new Promise((resolve,reject)=>{
   let child,closed=false,failure,forceTimer,buffer='',stdoutBytes=0,stderr='',events=[];
   const toolCalls=new Set(),toolResults=new Set(),maxToolCalls=Math.min(MCP_MAX_TOOL_CALLS,mcpBudget?.maxToolCalls??MCP_MAX_TOOL_CALLS),maxToolOutputBytes=profile==='landing-figma'?8*1024*1024:65536,maxTotalToolOutputBytes=Math.min(profile==='landing-figma'?16*1024*1024:65536,mcpBudget?.maxTotalToolOutputBytes??65536);let totalToolOutputBytes=0;
   const stop=code=>{
    if(failure||closed)return;failure=Object.assign(new Error(code),{code,status:code==='AGENT_TIMEOUT'?504:503});
    const kill=signalName=>{try{if(child?.pid&&process.platform!=='win32')process.kill(-child.pid,signalName);else child?.kill(signalName);}catch{child?.kill(signalName);}};
    kill('SIGTERM');forceTimer=setTimeout(()=>kill('SIGKILL'),3000);forceTimer.unref();
   };
   const allowedRuntime=runtimeBudgetMs===null?maxRuntimeMs:Math.min(maxRuntimeMs,runtimeBudgetMs);if(!Number.isInteger(allowedRuntime)||allowedRuntime<1){reject(Object.assign(Error('AGENT_EXECUTION_TIME_BUDGET'),{code:'AGENT_EXECUTION_TIME_BUDGET'}));return;}
   const abort=()=>stop('AGENT_CANCELLED'),timer=setTimeout(()=>stop('AGENT_TIMEOUT'),allowedRuntime);
   const clean=()=>{clearTimeout(timer);clearTimeout(forceTimer);signal?.removeEventListener('abort',abort);};
   const consume=line=>{if(!line.trim())return;let event;try{event=JSON.parse(line);}catch{return;}
    events.push(event);
    if(profile==='landing-plan'&&['mcp_tool_call','command_execution','file_change'].includes(event.item?.type)){stop('AGENT_MCP_TOOL_NOT_ALLOWED');return;}
    if(isMcp(profile)&&event.item?.type==='mcp_tool_call'){
     const item=event.item,server=item.server||item.server_name;
     if(server!=='apollo_figma_mcp'||!mcpConnection.tools.includes(item.tool)||typeof item.id!=='string'){stop('AGENT_MCP_TOOL_NOT_ALLOWED');return;}
     let toolArguments=item.arguments;try{if(typeof toolArguments==='string')toolArguments=JSON.parse(toolArguments);}catch{stop('AGENT_MCP_TOOL_NOT_ALLOWED');return;}
     if(!toolArguments||toolArguments.fileKey!==mcpConnection.fileKey){stop('AGENT_MCP_FILE_SCOPE_MISMATCH');return;}
     toolCalls.add(item.id);if(toolCalls.size>maxToolCalls){stop('AGENT_MCP_TOOL_LIMIT');return;}
     if(event.type==='item.started'&&!toolTimings.has(item.id))toolTimings.set(item.id,{callId:item.id,startedAtUtc:new Date().toISOString(),completedAtUtc:null,durationMs:null,status:'in_progress',monotonicStart:performance.now()});
     const timing=toolTimings.get(item.id);if(event.type==='item.completed'&&timing&&timing.completedAtUtc===null)Object.assign(timing,{completedAtUtc:new Date().toISOString(),durationMs:Math.max(0,Math.round(performance.now()-timing.monotonicStart)),status:item.status});
     if(Buffer.byteLength(JSON.stringify(item.arguments||{}))>16384){stop('AGENT_MCP_TOOL_ARGUMENT_LIMIT');return;}
     if(item.result){const size=Buffer.byteLength(JSON.stringify(item.result));if(size>maxToolOutputBytes){stop('AGENT_MCP_TOOL_OUTPUT_LIMIT');return;}if(event.type==='item.completed'&&!toolResults.has(item.id)){toolResults.add(item.id);totalToolOutputBytes+=size;if(totalToolOutputBytes>maxTotalToolOutputBytes){stop('AGENT_MCP_TOOL_OUTPUT_LIMIT');return;}}}
    }
    try{onEvent(event);}catch{stop('AGENT_PROGRESS_FAILED');}
   };
   try{child=spawnProcess(binary,args,{cwd:scope,env,shell:false,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});}
   catch{clean();failureError('AGENT_CLI_UNAVAILABLE',{status:503,stage:'spawn'}).then(reject);return;}
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   child.stdout.on('data',chunk=>{stdoutBytes+=chunk.length;if(stdoutBytes>(profile==='landing-figma'?32:4)*1024*1024){stop('AGENT_OUTPUT_LIMIT');return;}
    buffer+=chunk.toString('utf8');const lines=buffer.split(/\r?\n/);buffer=lines.pop();lines.forEach(consume);
   });
   child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString('utf8')).slice(-65536);});
   child.stdin.on('error',()=>{});
   child.on('error',()=>{closed=true;clean();failureError('AGENT_CLI_UNAVAILABLE',{status:503,stage:'spawn',stderr,events}).then(reject);});
   child.on('close',async code=>{
    if(closed)return;closed=true;clean();consume(buffer);
    if(failure)return reject(await failureError(failure.code,{status:failure.status,stage:'interrupted',exitCode:code,stderr,events}));
    if(code!==0){
     // This launcher also ships standalone, without the parent CLI adapters.
     const unavailable=/model_not_found|(?:unknown|invalid|unsupported) model|model[^\n]{0,160}(?:does not exist|not found|not available|not supported|do not have access)/i.test(stderr+'\n'+JSON.stringify(events.filter(e=>['error','turn.failed'].includes(e.type))));
     return reject(await failureError(unavailable?'AGENT_MODEL_UNAVAILABLE':(/input_too_large|Input exceeds the maximum length/.test(stderr)?'AGENT_CONTEXT_LIMIT':'AGENT_PROCESS_FAILED'),{status:unavailable?400:502,exitCode:code,stderr,events}));
    }
    try{
     if(scopedDirectory(generatedRoot,workspace)!==scope||signal?.aborted)fail('AGENT_CANCELLED');
     const bytes=await fsp.readFile(outputPath);if(bytes.length>1024*1024)fail('AGENT_OUTPUT_LIMIT');
     const result=JSON.parse(bytes);if(!result||typeof result!=='object'||Array.isArray(result))fail('AGENT_OUTPUT_INVALID');
     const receipt={provider,profile,model:model||'cli-default',workspace:scope,args,promptSha256:sha(Buffer.from(input)),schemaSha256:sha(Buffer.from(JSON.stringify(schema))),outputSha256:sha(bytes),
      cliModel:stderr.match(/^model:\s*(.+)$/m)?.[1]||null,events,
      usage:measurement({prompt,schema,prefix:prefix+'\n',events,durationMs:Date.now()-startedAt,requestId:diagnosticContext.requestId,runId:diagnosticContext.runId,stage:diagnosticContext.stage||'executor',attempt:diagnosticContext.modelStep,method:isMcp(profile)?'mcp':'landing-plan'}),
      mcp:isMcp(profile)?{connection:'apollo_figma_mcp',targetFileKey:mcpConnection.fileKey,argumentScopeValidated:true,endpoint:'https://mcp.figma.com/mcp',toolCalls:toolCalls.size,maxToolCalls,maxToolOutputBytes,totalToolOutputBytes,maxTotalToolOutputBytes,toolArgumentBytesLimit:16384,hiddenToolSchemaChars:null,nativeFailures:mcpNativeFailures(events,timingView()),toolTimings:timingView(),toolTimeoutMs:MCP_TOOL_TIMEOUT_MS,guaranteeProfile:profile==='landing-figma'?'landing-owned-root-independent-readback':'experimental-owned-root-post-readback',internalProviderModelAttempts:null,toolAdmission:'CLI allowlist; event budget termination can follow a remote mutation, so interrupted roots require independent readback and are retained.'}:null};
     persistMeasurement(usageRoot,receipt.usage,events.filter(e=>e.type==='turn.completed'));
     await fsp.writeFile(path.join(trace,id+'.trace.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
     resolve({result,receipt,outputPath});
    }catch(e){reject(await failureError(e.code&&/^AGENT_[A-Z_]+$/.test(e.code)?e.code:'AGENT_OUTPUT_INVALID',{stage:'output',exitCode:code,stderr,events}));}
   });
   child.stdin.end(input);
  });
 }
 return{probe,run};
}
module.exports={createAgentCli,invocation,scopedDirectory,MAX_PROMPT_CHARS,MCP_MAX_TOOL_CALLS,MCP_TOOL_TIMEOUT_MS,profilePrefix};
