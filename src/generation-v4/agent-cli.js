'use strict';
const {failureDiagnostic,readFailure}=require('./failure-diagnostic');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const ENV=['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','LANG','LC_ALL','CODEX_HOME'];
const MAX_PROMPT_CHARS=900000;
const fail=code=>{throw Object.assign(new Error(code),{code,status:503});};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function scopedDirectory(root,directory){
 if(typeof root!=='string'||typeof directory!=='string'||!path.isAbsolute(root)||!path.isAbsolute(directory))fail('AGENT_SCOPE_INVALID');
 let base,actual;try{base=fs.realpathSync(root);actual=fs.realpathSync(directory);}catch{fail('AGENT_SCOPE_INVALID');}
 if(actual!==path.resolve(directory)||actual===base||!actual.startsWith(base+path.sep)||!fs.statSync(actual).isDirectory())fail('AGENT_SCOPE_INVALID');
 return actual;
}
function invocation({workspace,profile,schemaPath,outputPath,model=''}){
 if(!['frontend-engineering','figma-readonly','figma-engineering'].includes(profile))fail('AGENT_PROFILE_UNAVAILABLE');
 const args=['-a','never','exec','--json','--ephemeral','--ignore-user-config','--ignore-rules',
  '--sandbox',profile==='frontend-engineering'?'workspace-write':'read-only','--skip-git-repo-check','--cd',workspace,
  '-c','sandbox_workspace_write.writable_roots=[]','-c','sandbox_workspace_write.network_access=false',
  '-c','sandbox_workspace_write.exclude_tmpdir_env_var=true','-c','sandbox_workspace_write.exclude_slash_tmp=true',
  '--output-schema',schemaPath,'--output-last-message',outputPath];
 if(model)args.push('--model',model);args.push('-');return args;
}
function createAgentCli({provider='codex',binary='codex',model='',generatedRoot,environment=process.env,
 maxRuntimeMs=300000,spawnProcess=spawn}={}){
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
    profiles:['frontend-engineering','figma-readonly','figma-engineering'],frontendWriteScope:'assigned generated project only',figmaAcceptedWriteOperations:[],model:model||'cli-default'};
  }catch{return{provider,available:false,reason:'CLI_OR_AUTH_UNAVAILABLE',acceptedWriteOperations:[]};}
 }
 async function run({workspace,profile,prompt,schema,traceDirectory,signal,onEvent=()=>{},diagnosticContext={}}){
  available();const scope=scopedDirectory(generatedRoot,workspace);
  if(typeof prompt!=='string'||Buffer.byteLength(prompt)>2*1024*1024||!schema||typeof schema!=='object')fail('AGENT_INPUT_INVALID');
  if(signal?.aborted)fail('AGENT_CANCELLED');
  // Host-owned CLI output lives outside the agent writable directory.
  const trace=scopedDirectory(generatedRoot,traceDirectory);
  if(trace===scope||trace.startsWith(scope+path.sep)||scope.startsWith(trace+path.sep))fail('AGENT_TRACE_SCOPE_INVALID');
  const id=crypto.randomUUID(),schemaPath=path.join(trace,id+'.schema.json'),outputPath=path.join(trace,id+'.output.json');
  await fsp.writeFile(schemaPath,JSON.stringify(schema),{flag:'wx',mode:0o600});
  const args=invocation({workspace:scope,profile,schemaPath,outputPath,model});
  const prefix=profile==='frontend-engineering'
   ? 'Engineering profile: edit only the assigned generated project. Use existing project tools/dependencies. Do not install packages, edit source contracts/shared libraries, read credentials, access unrelated files, use network or modify acceptance gates. Build/check your files and report actual failures honestly.'
   : profile==='figma-engineering'
   ? 'Native engineering profile: choose only schema-valid low-level operations for the trusted broker. No shell/write, credentials or network operations. Only correlated broker facts/readback are execution evidence; preserve gaps, partial writes and UNKNOWN. Never claim native execution or rollback from model intent.'
   : 'Readonly profile: choose one structured next step. No shell/write, credentials or external network operations. A proposed operation is a request, not execution evidence. PluginAPI observations are supplied by the broker; preserve their provenance and UNKNOWN.';
  const input=prefix+'\n'+prompt;
  async function failureError(code,{status=502,exitCode=null,stage='process',stderr='',events=[]}={}){
   const diagnostic={...failureDiagnostic(code,{...diagnosticContext,stage,traceId:id},'err:'+id),exitCode,promptChars:input.length,promptBytes:Buffer.byteLength(input),maxPromptChars:MAX_PROMPT_CHARS};
   let traceRecorded=true;
   try{await fsp.writeFile(path.join(trace,id+'.failure.json'),JSON.stringify({...diagnostic,provider,profile,model:model||'cli-default',promptSha256:sha(Buffer.from(input)),schemaSha256:sha(Buffer.from(JSON.stringify(schema))),stderr,errorEvents:events.filter(e=>['error','turn.failed'].includes(e.type)).slice(-16)},null,2)+'\n',{flag:'wx',mode:0o600});}catch{traceRecorded=false;}
   return Object.assign(Error(code),{code,status,diagnostic:JSON.stringify({...diagnostic,traceRecorded})});
  }
  if(input.length>MAX_PROMPT_CHARS)throw await failureError('AGENT_CONTEXT_LIMIT',{status:413,stage:'input-budget'});
  return new Promise((resolve,reject)=>{
   let child,closed=false,failure,forceTimer,buffer='',stdoutBytes=0,stderr='',events=[];
   const stop=code=>{
    if(failure||closed)return;failure=Object.assign(new Error(code),{code,status:code==='AGENT_TIMEOUT'?504:503});
    const kill=signalName=>{try{if(child?.pid&&process.platform!=='win32')process.kill(-child.pid,signalName);else child?.kill(signalName);}catch{child?.kill(signalName);}};
    kill('SIGTERM');forceTimer=setTimeout(()=>kill('SIGKILL'),3000);forceTimer.unref();
   };
   const abort=()=>stop('AGENT_CANCELLED'),timer=setTimeout(()=>stop('AGENT_TIMEOUT'),maxRuntimeMs);
   const clean=()=>{clearTimeout(timer);clearTimeout(forceTimer);signal?.removeEventListener('abort',abort);};
   const consume=line=>{if(!line.trim())return;let event;try{event=JSON.parse(line);}catch{return;}
    events.push(event);try{onEvent(event);}catch{stop('AGENT_PROGRESS_FAILED');}
   };
   try{child=spawnProcess(binary,args,{cwd:scope,env,shell:false,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});}
   catch{clean();failureError('AGENT_CLI_UNAVAILABLE',{status:503,stage:'spawn'}).then(reject);return;}
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   child.stdout.on('data',chunk=>{stdoutBytes+=chunk.length;if(stdoutBytes>4*1024*1024){stop('AGENT_OUTPUT_LIMIT');return;}
    buffer+=chunk.toString('utf8');const lines=buffer.split(/\r?\n/);buffer=lines.pop();lines.forEach(consume);
   });
   child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString('utf8')).slice(-65536);});
   child.stdin.on('error',()=>{});
   child.on('error',()=>{closed=true;clean();failureError('AGENT_CLI_UNAVAILABLE',{status:503,stage:'spawn',stderr,events}).then(reject);});
   child.on('close',async code=>{
    if(closed)return;closed=true;clean();consume(buffer);
    if(failure)return reject(await failureError(failure.code,{status:failure.status,stage:'interrupted',exitCode:code,stderr,events}));
    if(code!==0)return reject(await failureError(/input_too_large|Input exceeds the maximum length/.test(stderr)?'AGENT_CONTEXT_LIMIT':'AGENT_PROCESS_FAILED',{exitCode:code,stderr,events}));
    try{
     if(scopedDirectory(generatedRoot,workspace)!==scope||signal?.aborted)fail('AGENT_CANCELLED');
     const bytes=await fsp.readFile(outputPath);if(bytes.length>1024*1024)fail('AGENT_OUTPUT_LIMIT');
     const result=JSON.parse(bytes);if(!result||typeof result!=='object'||Array.isArray(result))fail('AGENT_OUTPUT_INVALID');
     const receipt={provider,profile,model:model||'cli-default',workspace:scope,args,promptSha256:sha(Buffer.from(input)),schemaSha256:sha(Buffer.from(JSON.stringify(schema))),outputSha256:sha(bytes),
      cliModel:stderr.match(/^model:\s*(.+)$/m)?.[1]||null,events};
     await fsp.writeFile(path.join(trace,id+'.trace.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
     resolve({result,receipt,outputPath});
    }catch(e){reject(await failureError(e.code&&/^AGENT_[A-Z_]+$/.test(e.code)?e.code:'AGENT_OUTPUT_INVALID',{stage:'output',exitCode:code,stderr,events}));}
   });
   child.stdin.end(input);
  });
 }
 return{probe,run};
}
module.exports={createAgentCli,invocation,scopedDirectory,MAX_PROMPT_CHARS};
