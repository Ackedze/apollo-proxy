'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
function outputs(workspace){
 if(fs.realpathSync(workspace)!==path.resolve(workspace))fail('AGENT_EVAL_OUTPUT_SYMLINK');
 const pins=[],captures=[];let captured=0;
 function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  if(entry.name==='node_modules')continue;const file=path.join(directory,entry.name),relative=path.relative(workspace,file);
  if(entry.isSymbolicLink())fail('AGENT_EVAL_OUTPUT_SYMLINK');if(entry.isDirectory()){walk(file);continue;}if(!entry.isFile())continue;
  const bytes=fs.readFileSync(file);if(bytes.length>8388608||pins.length>=256)fail('AGENT_EVAL_CAPTURE_LIMIT');pins.push({path:relative,sha256:sha(bytes),bytes:bytes.length});
  // Preserve repairable source/check snapshots and screenshots; compiled outputs keep exact pins, without dependency copies.
  if(!relative.startsWith('dist'+path.sep)&&(/\.(tsx?|jsx?|css|json)$/.test(relative)&&bytes.length<=262144||relative==='browser-default.png'&&bytes.length<=2097152)){
   if((captured+=bytes.length)>8388608)fail('AGENT_EVAL_CAPTURE_LIMIT');captures.push({name:relative,bytes});
  }
 }}
 walk(workspace);return{pins,captures};
}
function tracePins(directory){if(fs.realpathSync(directory)!==path.resolve(directory))fail('AGENT_EVAL_TRACE_INVALID');return fs.readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.name.endsWith('.json')).map(entry=>{if(!entry.isFile())fail('AGENT_EVAL_TRACE_INVALID');const file=path.join(directory,entry.name),bytes=fs.readFileSync(file);return{path:file,sha256:sha(bytes),bytes:bytes.length};});}
function createEvaluatedAgentService({createService,evalStore,evidenceKind,...options}={}){
 const {inputs,cli,protocol:p,hash,traceRoot}=options;
 const isMcp=options.executionMethod==='mcp'||evidenceKind==='mcp-owned-root-experimental';
 if(typeof createService!=='function'||!evalStore||!inputs||!cli||!path.isAbsolute(traceRoot||'')||!evidenceKind)fail('AGENT_EVAL_CONFIGURATION_INVALID');
 const configuredEvidence=target=>typeof evidenceKind==='string'?evidenceKind:evidenceKind[target];
 const wrappedInputs={...inputs,async resolveAgentRun(identity){
  const resolved=await inputs.resolveAgentRun(identity);await resolved.assertCurrent();
  evalStore.begin({identity,packet:resolved.packet,traceDirectory:path.join(traceRoot,hash(identity)),evidenceKind:configuredEvidence(identity.target)});
  return{...resolved,readContext:typeof resolved.readContext==='function'?resourceIds=>{const view=resolved.readContext(resourceIds);evalStore.record(identity,'context-view',{sourceHash:view.sourceHash,versionHash:view.versionHash,manifestHash:view.manifestHash,viewHash:view.viewHash,resourceIds:view.resourceIds,contextEvidenceIsNative:false});return view;}:undefined,checkFrontend:typeof resolved.checkFrontend==='function'?async(...args)=>{
   let diagnostics;try{diagnostics=await resolved.checkFrontend(...args);}catch(error){
    const capture=outputs(resolved.frontendWorkspace);evalStore.record(identity,'frontend-check',{checks:[],gaps:[{code:error.code||'AGENT_CHECK_FAILED',message:'Checker did not return a verified verdict'}],error:{code:error.code||null},outputs:capture.pins,actualChecksAdmission:'NOT_RETURNED'},{captures:capture.captures});throw error;
   }
   const capture=outputs(resolved.frontendWorkspace);let actual=null;
   const actualFile=path.join(resolved.frontendWorkspace,'actual-checks.json');if(fs.existsSync(actualFile)){
    const candidate=JSON.parse(fs.readFileSync(actualFile));if(candidate.versionHash===resolved.packet.version.versionHash&&hash(candidate.checks)===hash(diagnostics.checks))actual=candidate;
   }
   evalStore.record(identity,'frontend-check',{...diagnostics,actual,outputs:capture.pins,channels:{build:(diagnostics.checks||[]).filter(c=>['typecheck','public-ds-imports','build'].includes(c.id)),browser:actual?{observation:actual.observation,checks:diagnostics.checks}:null},actualChecksAdmission:actual?'EXACT_VERSION_AND_RETURNED_CHECKS':'NOT_RETURNED'},{captures:capture.captures});return diagnostics;
  }:undefined};
 }};
 let providerProbe=null;
 const wrappedCli={...cli,async probe(...args){providerProbe=await cli.probe(...args);return providerProbe;},async run(args){
  const identity=evalStore.fromTrace(args.traceDirectory);if(args.traceDirectory!==path.join(traceRoot,hash(identity)))fail('AGENT_EVAL_TRACE_INVALID');
  evalStore.record(identity,'model-input',{profile:args.profile,providerProbe,prompt:args.prompt,schema:args.schema,promptSha256:sha(Buffer.from(args.prompt)),schemaSha256:sha(Buffer.from(JSON.stringify(args.schema))),workspace:args.workspace,traceDirectory:args.traceDirectory});
  let response;try{response=await cli.run(args);}catch(error){const capture=identity.target==='frontend'?outputs(args.workspace):{pins:[],captures:[]};evalStore.record(identity,'model-error',{code:error.code||'AGENT_MODEL_FAILED',diagnostic:error.diagnostic||null,usage:error.usage||null,tracePins:tracePins(args.traceDirectory),outputs:capture.pins},{captures:capture.captures});throw error;}
  const capture=identity.target==='frontend'?outputs(args.workspace):{pins:[],captures:[]};
  if(response.outputPath){const file=path.resolve(response.outputPath);if(!file.startsWith(args.traceDirectory+path.sep)||fs.realpathSync(file)!==file)fail('AGENT_EVAL_TRACE_INVALID');}
  evalStore.record(identity,'model-output',{origin:'agent-report',result:response.result,receipt:response.receipt||null,outputPath:response.outputPath||null,tracePins:tracePins(args.traceDirectory),outputs:capture.pins},{captures:capture.captures});return response;
 }};
 const validation=options.validatePostconditions;
 const service=createService({...options,inputs:wrappedInputs,cli:wrappedCli,...(typeof validation==='function'?{validatePostconditions:args=>{
  const verdict=validation(args);evalStore.record(args.observation.identity,'postconditions',{origin:'configured-checker',versionHash:args.version.versionHash,observationHash:args.observation.evidenceHash,request:args.request,verdict});return verdict;
 }}:{})});
 function persistSnapshot(value){if(value?.identity&&value.snapshotHash&&evalStore.get(value.identity).lastSnapshotHash!==value.snapshotHash)evalStore.record(value.identity,'snapshot',value);return value;}
 const wrapped={...service};
 for(const method of ['start','poll','cancel'])wrapped[method]=async(...args)=>persistSnapshot(await service[method](...args));
 wrapped.observation=async body=>{
  let result;try{result=await service.observation(body);}catch(error){
   if(evalStore.has(body?.identity))evalStore.record(body.identity,isMcp?'mcp-observation':'native-observation',{observation:body,acceptance:'rejected',error:{code:error.code||null}});
   throw error;
  }
  // A model attempt can contain several native callbacks; their sequence stays in the receipt.
  evalStore.record(body.identity,isMcp?'mcp-observation':'native-observation',{observation:body,acceptance:'accepted'});return persistSnapshot(result);
 };
 if(typeof service.preservation==='function')wrapped.preservation=async body=>{const result=await service.preservation(body);evalStore.record(body.identity,'mcp-preservation',{observation:body,acceptance:'accepted'});return persistSnapshot(result);};
 for(const method of ['controlTicket','controlObservation'])if(typeof service[method]==='function')wrapped[method]=async body=>{
  const result=await service[method](body),identity=body.identity||body.ticket.identity;evalStore.record(identity,'control',{method,request:body,response:result});return result;
 };
 wrapped.whenSettled=async identity=>{const result=await service.whenSettled(identity);persistSnapshot(await service.poll({...identity,afterSequence:0}));return result;};
 wrapped.recordAgentReview=(identity,review)=>evalStore.record(identity,'agent-review',{...review,origin:'agent-review',independent:false});
 return wrapped;
}
module.exports={createEvaluatedAgentService};
