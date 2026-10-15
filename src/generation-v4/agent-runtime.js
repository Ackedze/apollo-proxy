'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createAgentCli}=require('./agent-cli'),{createAgentService,mountAgentRoutes}=require('./agent-service');
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
// All paths and provider options come from local server configuration, never HTTP input.
function createConfiguredAgentRuntime({configFile,providerFactory,provider='codex',binary='codex',model='',environment=process.env,evalRoot=null}={}){
 let service=null,loading=null;
 async function loadService(){
  if(service)return service;if(loading)return loading;
  loading=Promise.resolve().then(()=>{
   if(typeof configFile!=='string'||!path.isAbsolute(configFile)||!fs.existsSync(configFile)||typeof providerFactory!=='function')fail('AGENT_EXECUTION_UNAVAILABLE');
   const pins=new Map(),read=file=>{const bytes=fs.readFileSync(file);pins.set(file,sha(bytes));return bytes;};
   const config=JSON.parse(read(configFile));
   const keys=['schemaVersion','apolloRoot','mappingDirectory','frontendRoot','hostRoot','toolchainHome','nodeExecutable','chromeExecutable','laboratoryFile'];
   if(!config||typeof config!=='object'||Object.keys(config).length!==keys.length||!keys.every(k=>Object.hasOwn(config,k))||config.schemaVersion!=='apollo.agent-runtime-config.v1'
    ||keys.slice(1,-1).some(k=>typeof config[k]!=='string'||!path.isAbsolute(config[k]))||config.laboratoryFile!==null&&(typeof config.laboratoryFile!=='string'||!path.isAbsolute(config.laboratoryFile)))fail('AGENT_CONFIGURATION_INVALID');
   const generatedRoot=path.dirname(config.frontendRoot);fs.mkdirSync(config.frontendRoot,{recursive:true});fs.mkdirSync(config.hostRoot,{recursive:true});
   if(fs.realpathSync(generatedRoot)!==generatedRoot||fs.realpathSync(config.frontendRoot)!==config.frontendRoot||fs.realpathSync(config.hostRoot)!==config.hostRoot||!config.hostRoot.startsWith(generatedRoot+path.sep)||config.hostRoot===config.frontendRoot||config.hostRoot.startsWith(config.frontendRoot+path.sep))fail('AGENT_CONFIGURATION_INVALID');
   const apollo=config.apolloRoot,protocolFile=path.join(apollo,'apps/apollo-v4/dist/agent-protocol.cjs'),resolverFile=path.join(apollo,'apps/apollo-v4/scripts/agent-run-inputs.cjs'),toolsFile=path.join(apollo,'apps/apollo-v4/scripts/agent-frontend-workspace.cjs');
   for(const file of [protocolFile,resolverFile,toolsFile]){if(!fs.existsSync(file))fail('AGENT_EXECUTION_UNAVAILABLE');read(file);delete require.cache[require.resolve(file)];}
   const protocol=require(protocolFile),{createAgentRunInputs}=require(resolverFile),{createFrontendWorkspaceTools}=require(toolsFile),source=providerFactory(config);
   const assertCurrent=()=>{for(const [file,pin]of pins)if(!fs.existsSync(file)||sha(fs.readFileSync(file))!==pin)fail('AGENT_RUNTIME_INPUTS_STALE');};
   const wrappedProvider={...source,readPromptContext:async input=>{assertCurrent();const result=await source.readPromptContext(input);result.assertCurrent();assertCurrent();return{...result,assertCurrent(){assertCurrent();result.assertCurrent();}};}};
   let laboratory=null;if(config.laboratoryFile){laboratory=JSON.parse(read(config.laboratoryFile));if(laboratory.schemaVersion!=='apollo.general-native-read-scope.v1'||laboratory.target!=='figma'||!Array.isArray(laboratory.acceptedWriteOperations)||laboratory.acceptedWriteOperations.length||!laboratory.destination||!Array.isArray(laboratory.allowedOperations)||laboratory.allowedOperations.some(x=>!protocol.CAPABILITIES.figma.includes(x))||laboratory.limits?.maxNodes!==1||laboratory.limits?.treeTraversal!==false)fail('AGENT_CONFIGURATION_INVALID');}
   const tools=createFrontendWorkspaceTools({toolchainHome:config.toolchainHome,nodeExecutable:config.nodeExecutable,chromeExecutable:config.chromeExecutable,hash:source.hash,bindingsPath:path.join(config.mappingDirectory,'bindings.ts')});
   const inputs=createAgentRunInputs({provider:wrappedProvider,hash:source.hash,protocol,skillsDirectory:path.join(apollo,'apps/apollo-v4/instructions/agent-generation'),mappingDirectory:config.mappingDirectory,frontendRoot:config.frontendRoot,...tools,laboratory});
   const cli=createAgentCli({provider,binary,model,environment,generatedRoot});
   const serviceOptions={inputs,cli,protocol,hash:source.hash,traceRoot:path.join(config.hostRoot,'runtime-traces'),readonlyRoot:path.join(config.hostRoot,'readonly-workspaces')};
   service=createAgentService(serviceOptions);
   if(evalRoot!==null){
    if(!path.isAbsolute(evalRoot)||!path.resolve(evalRoot).startsWith(config.hostRoot+path.sep))fail('AGENT_EVAL_SCOPE_INVALID');
    const selected=require(path.join(apollo,'apps/apollo-v4/scripts/agent-generation-skills.cjs')).createGenerationSkills().select('frontend');selected.assertCurrent();
    const skills={frontend:{id:selected.metadata.name,version:selected.metadata.version,sources:selected.metadata.files.map(pin=>({...pin,name:path.relative(path.dirname(selected.metadata.files[0].path),pin.path),prompt:true}))}};
    const evalStore=require('./agent-eval-store').createAgentEvalStore({root:evalRoot,protocol,hash:source.hash,skills});
    const evaluated=require('./agent-eval-service').createEvaluatedAgentService({createService:createAgentService,evalStore,evidenceKind:'frontend-tools',...serviceOptions});
    const readonly=service;
    service=Object.fromEntries(Object.keys(readonly).map(method=>[method,(...args)=>{
     const target=args[0]?.identity?.target||args[0]?.target;
     return(target==='figma'?readonly:evaluated)[method](...args);
    }]));
   }
   const currentService=service;
   service=Object.fromEntries(Object.entries(currentService).map(([method,fn])=>[method,async(...args)=>{try{return await fn(...args);}catch(error){if(error.code==='AGENT_SKILLS_STALE')throw Object.assign(Error('AGENT_RUNTIME_INPUTS_STALE'),{code:'AGENT_RUNTIME_INPUTS_STALE',status:error.status||503});throw error;}}]));
   return service;
  }).catch(error=>{loading=null;throw error;});return loading;
 }
 return{loadService};
}
function mountConfiguredAgentRoutes(app,options){const runtime=createConfiguredAgentRuntime(options);mountAgentRoutes(app,runtime);return runtime;}
module.exports={createConfiguredAgentRuntime,mountConfiguredAgentRoutes};
