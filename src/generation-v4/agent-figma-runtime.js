'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createAgentFigmaService,mountAgentFigmaRoutes}=require('./agent-figma-service');
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

// This descriptor is local, reviewed server configuration; HTTP bodies never select modules or policies.
function createConfiguredAgentFigmaRuntime({descriptorFile,inputs,cli,traceRoot,readonlyRoot,evalStore=null,evidenceKind='native-reported',executionEnvironment='native-plugin-api'}={}){
 let service=null,loading=null;
 async function loadService(){
  if(service)return service;if(loading)return loading;
  loading=Promise.resolve().then(()=>{
   if(typeof descriptorFile!=='string'||!path.isAbsolute(descriptorFile)||!inputs||!cli)fail('AGENT_EXECUTION_UNAVAILABLE');
   const descriptorBytes=fs.readFileSync(descriptorFile),descriptorPin=sha(descriptorBytes),d=JSON.parse(descriptorBytes);
   const current=d?.schemaVersion==='apollo.agent-figma-runtime-descriptor.v2';
   const keys=(current?['consumer','apolloRepository','workingSeal']:[]).concat(['schemaVersion','sourceHash','protocol','nativeProtocol','postconditions','providerPacket','runtimeInputs','historicalInspections','review','workingApply','Ready']);
   if(!d||Object.keys(d).length!==keys.length||!keys.every(k=>Object.hasOwn(d,k))||!['apollo.agent-figma-runtime-descriptor.v1','apollo.agent-figma-runtime-descriptor.v2'].includes(d.schemaVersion)
    ||typeof d.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(d.sourceHash)||!Array.isArray(d.runtimeInputs)||!d.runtimeInputs.length||d.runtimeInputs.length>512
    ||!Array.isArray(d.historicalInspections)||d.historicalInspections.some(pin=>pin?.runtimeAuthority!==false)
    ||d.Ready!==false||typeof d.workingApply!=='boolean')fail('AGENT_CONFIGURATION_INVALID');
   const pins=new Map();
   for(const pin of d.runtimeInputs){
    if(!pin||!['path','sha256','bytes'].every(k=>Object.hasOwn(pin,k))||typeof pin.path!=='string'||!path.isAbsolute(pin.path)
     ||typeof pin.sha256!=='string'||!/^[a-f0-9]{64}$/.test(pin.sha256)||!Number.isSafeInteger(pin.bytes)||pin.bytes<0||pins.has(pin.path))fail('AGENT_CONFIGURATION_INVALID');
    pins.set(pin.path,pin);
   }
   for(const key of ['protocol','nativeProtocol','postconditions','providerPacket','review'].concat(current?['consumer','workingSeal']:[])){
    const pin=d[key],current=pins.get(pin?.path);
    if(!current||current.sha256!==pin.sha256||current.bytes!==pin.bytes)fail('AGENT_CONFIGURATION_INVALID');
   }
   const assertCurrent=()=>{
    try{
     if(sha(fs.readFileSync(descriptorFile))!==descriptorPin)fail('AGENT_RUNTIME_INPUTS_STALE');
     for(const pin of pins.values()){const bytes=fs.readFileSync(pin.path);if(bytes.length!==pin.bytes||sha(bytes)!==pin.sha256)fail('AGENT_RUNTIME_INPUTS_STALE');}
    }catch{fail('AGENT_RUNTIME_INPUTS_STALE');}
   };
   assertCurrent();
   const review=JSON.parse(fs.readFileSync(d.review.path));
   if(current){
    if(typeof d.apolloRepository!=='string'||!path.isAbsolute(d.apolloRepository))fail('AGENT_CONFIGURATION_INVALID');
    const owned=require(path.join(d.apolloRepository,'apps/apollo-v4/scripts/agent-figma-current-consumer.cjs')).loadOwnedFigmaProvider({consumerFile:d.consumer.path,apolloRepository:d.apolloRepository});
    const consumer=JSON.parse(fs.readFileSync(d.consumer.path));
    if(owned.sourceHash!==d.sourceHash||review.status!=='ACCEPTED'||d.review.sha256!==consumer.approvedCandidate.sha256)fail('AGENT_CONFIGURATION_INVALID');
    const accepted=[consumer.packet,consumer.protocol,consumer.postconditions].concat(consumer.runtimePins,consumer.sourcePins);
    for(const key of ['nativeProtocol','postconditions','providerPacket'])if(!accepted.some(p=>p.path===d[key].path&&p.sha256===d[key].sha256&&p.bytes===d[key].bytes))fail('AGENT_CONFIGURATION_INVALID');
    if(!review.pins?.some(p=>p.path===d.workingSeal.path&&p.sha256===d.workingSeal.sha256&&p.bytes===d.workingSeal.bytes))fail('AGENT_CONFIGURATION_INVALID');
    const working=JSON.parse(fs.readFileSync(d.workingSeal.path));
    if(working.writesClosed!==true||d.protocol.path!==path.join(d.apolloRepository,'apps/apollo-v4/dist/agent-protocol.cjs')||!working.inputs?.some(p=>p.path===d.protocol.path&&p.sha256===d.protocol.sha256&&p.bytes===d.protocol.bytes))fail('AGENT_CONFIGURATION_INVALID');
    owned.assertCurrent();
   }else if(review.status!=='CLOSED_PRIVATE_PROTOCOL_PROVIDER_CHECKER_INPUT_ACCEPTED'||!Array.isArray(review.pins)
    ||['nativeProtocol','postconditions','providerPacket'].some(key=>!review.pins.some(pin=>pin.path===d[key].path&&pin.sha256===d[key].sha256&&pin.bytes===d[key].bytes)))fail('AGENT_CONFIGURATION_INVALID');
   const p=require(d.protocol.path),n=require(d.nativeProtocol.path),checker=require(d.postconditions.path),packet=JSON.parse(fs.readFileSync(d.providerPacket.path));
   if(packet.sourceHash!==d.sourceHash||checker.SOURCE_HASH!==d.sourceHash||typeof checker.validatePostconditions!=='function'
    ||packet.writesClosed!==true||!p.validScreenVersion||!n.validObservation)fail('AGENT_NATIVE_POLICY_UNAVAILABLE');
   const hash=value=>p.hashWithout(value,'__absent__');
   const wrappedInputs={async admitDraft(body){assertCurrent();const value=await inputs.admitDraft(body);assertCurrent();return value;},
    async resolveAgentRun(identity){assertCurrent();const resolved=await inputs.resolveAgentRun(identity);assertCurrent();
     if(typeof resolved?.assertCurrent!=='function')fail('AGENT_PACKET_INVALID');
     return{...resolved,async assertCurrent(){assertCurrent();await resolved.assertCurrent();assertCurrent();}};},
    invalidate:identity=>inputs.invalidate(identity)};
   const context={...packet,admission:'CONDITIONAL_CURRENT_NATIVE_CORRESPONDENCE_BEFORE_EACH_SETTER',
    fullNormCoverage:'UNKNOWN_MANUAL',nativeLive:'NOT_RUN_USER_ONLY',runtimeDescriptorHash:descriptorPin};
   // A source catalog selects finite ports; the native broker separately proves source, SLOT and owned TEXT before every setter.
   const resolveNativePolicy=async()=>{assertCurrent();return{sourceHash:d.sourceHash,capabilities:Object.keys(n.operations),context:p.clone(context),assertCurrent};};
   const createService=evalStore?options=>require('./agent-eval-service').createEvaluatedAgentService({createService:createAgentFigmaService,evalStore,evidenceKind,...options}):createAgentFigmaService;
   service=createService({inputs:wrappedInputs,cli,protocol:p,nativeProtocol:n,hash,resolveNativePolicy,executionEnvironment,
    validatePostconditions:args=>{assertCurrent();const result=checker.validatePostconditions(args);assertCurrent();return result;},traceRoot,readonlyRoot});
   return service;
  }).catch(error=>{loading=null;throw error;});return loading;
 }
 return{loadService};
}
function mountConfiguredAgentFigmaRoutes(app,options){const runtime=createConfiguredAgentFigmaRuntime(options);mountAgentFigmaRoutes(app,runtime);return runtime;}
function createConfiguredAgentFigmaHostRuntime({configFile,providerFactory,provider='codex',binary='codex',model='',environment=process.env}={}){
 let runtime=null,loading=null;
 async function loadService(){
  if(runtime)return runtime.loadService();if(loading)return loading;
  loading=Promise.resolve().then(async()=>{
   if(!path.isAbsolute(configFile||'')||typeof providerFactory!=='function')fail('AGENT_EXECUTION_UNAVAILABLE');
   const bytes=fs.readFileSync(configFile),configHash=sha(bytes),config=JSON.parse(bytes);
   const keys=['schemaVersion','apolloRoot','currentConsumerFile','descriptorFile','frontendRoot','hostRoot'];
   if(!config||Object.keys(config).length!==keys.length||!keys.every(k=>Object.hasOwn(config,k))||config.schemaVersion!=='apollo.agent-figma-host-config.v1'||keys.slice(1).some(k=>!path.isAbsolute(config[k]||'')))fail('AGENT_CONFIGURATION_INVALID');
   fs.mkdirSync(config.frontendRoot,{recursive:true});fs.mkdirSync(config.hostRoot,{recursive:true});
   const generatedRoot=path.dirname(config.frontendRoot);
   if(fs.realpathSync(generatedRoot)!==generatedRoot||fs.realpathSync(config.frontendRoot)!==config.frontendRoot||fs.realpathSync(config.hostRoot)!==config.hostRoot||!config.hostRoot.startsWith(generatedRoot+path.sep)||config.hostRoot===config.frontendRoot||config.hostRoot.startsWith(config.frontendRoot+path.sep))fail('AGENT_CONFIGURATION_INVALID');
   const descriptor=JSON.parse(fs.readFileSync(config.descriptorFile));
   if(descriptor.schemaVersion!=='apollo.agent-figma-runtime-descriptor.v2'||descriptor.apolloRepository!==config.apolloRoot||descriptor.consumer?.path!==config.currentConsumerFile)fail('AGENT_CONFIGURATION_INVALID');
   const app=path.join(config.apolloRoot,'apps/apollo-v4'),p=require(descriptor.protocol.path);
   const owned=require(path.join(app,'scripts/agent-figma-current-consumer.cjs')).loadOwnedFigmaProvider({consumerFile:config.currentConsumerFile,apolloRepository:config.apolloRoot});
   const assertCurrent=()=>{if(sha(fs.readFileSync(configFile))!==configHash)fail('AGENT_RUNTIME_INPUTS_STALE');owned.assertCurrent();};
   const source=providerFactory(config),wrappedProvider={...source,readPromptContext:async input=>{assertCurrent();const value=await source.readPromptContext(input);value.assertCurrent();assertCurrent();return{...value,assertCurrent(){assertCurrent();value.assertCurrent();}};}};
   const inputs=require(path.join(app,'scripts/agent-run-inputs.cjs')).createAgentRunInputs({ownedFigmaProvider:owned,provider:wrappedProvider,protocol:p,hash:source.hash,skillsDirectory:path.join(app,'instructions/agent-generation'),frontendRoot:config.frontendRoot});
   const selected=require(path.join(app,'scripts/agent-generation-skills.cjs')).createGenerationSkills().select('figma',{executionProfile:'figma-owned-root-v1',sourceHash:owned.sourceHash});selected.assertCurrent();
   const skills={figma:{id:selected.metadata.name,version:selected.metadata.version,sources:selected.metadata.files.map(pin=>({...pin,name:path.relative(path.dirname(selected.metadata.files[0].path),pin.path),prompt:true}))}};
   const evalStore=require('./agent-eval-store').createAgentEvalStore({root:path.join(config.hostRoot,'run-evals'),protocol:p,hash:source.hash,skills});
   const cli=require('./agent-cli').createAgentCli({provider,binary,model,environment,generatedRoot});
   runtime=createConfiguredAgentFigmaRuntime({descriptorFile:config.descriptorFile,inputs,cli,evalStore,evidenceKind:'native-reported',traceRoot:path.join(config.hostRoot,'runtime-traces'),readonlyRoot:path.join(config.hostRoot,'readonly-workspaces')});
   return runtime.loadService();
  }).catch(error=>{loading=null;throw error;});return loading;
 }
 return{loadService};
}
function mountConfiguredAgentFigmaHostRoutes(app,options){const runtime=createConfiguredAgentFigmaHostRuntime(options);mountAgentFigmaRoutes(app,runtime);return runtime;}
module.exports={createConfiguredAgentFigmaRuntime,mountConfiguredAgentFigmaRoutes,createConfiguredAgentFigmaHostRuntime,mountConfiguredAgentFigmaHostRoutes};
