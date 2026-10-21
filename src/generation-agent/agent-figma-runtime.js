'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createAgentFigmaService,mountAgentFigmaRoutes}=require('./agent-figma-service');
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

// This descriptor is local, reviewed server configuration; HTTP bodies never select modules or policies.
function createConfiguredAgentFigmaRuntime({descriptorFile,inputs,cli,traceRoot,readonlyRoot,evalStore=null,evidenceKind='native-reported',executionEnvironment='native-plugin-api',serviceFactory=createAgentFigmaService,serviceOptions={}}={}){
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
    const owned=require(path.join(d.apolloRepository,'scripts/agent-figma-current-consumer.cjs')).loadOwnedFigmaProvider({consumerFile:d.consumer.path,apolloRepository:d.apolloRepository});
    const consumer=JSON.parse(fs.readFileSync(d.consumer.path));
    if(owned.sourceHash!==d.sourceHash||review.status!=='ACCEPTED'||d.review.sha256!==consumer.approvedCandidate.sha256)fail('AGENT_CONFIGURATION_INVALID');
    const accepted=[consumer.packet,consumer.protocol,consumer.postconditions].concat(consumer.runtimePins,consumer.sourcePins);
    for(const key of ['nativeProtocol','postconditions','providerPacket'])if(!accepted.some(p=>p.path===d[key].path&&p.sha256===d[key].sha256&&p.bytes===d[key].bytes))fail('AGENT_CONFIGURATION_INVALID');
    if(!review.pins?.some(p=>p.path===d.workingSeal.path&&p.sha256===d.workingSeal.sha256&&p.bytes===d.workingSeal.bytes))fail('AGENT_CONFIGURATION_INVALID');
    const working=JSON.parse(fs.readFileSync(d.workingSeal.path));
    if(working.writesClosed!==true||d.protocol.path!==path.join(d.apolloRepository,'dist/agent-protocol.cjs')||!working.inputs?.some(p=>p.path===d.protocol.path&&p.sha256===d.protocol.sha256&&p.bytes===d.protocol.bytes))fail('AGENT_CONFIGURATION_INVALID');
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
   const resolveNativePolicy=async({identity,packet:runPacket})=>{
    assertCurrent();const resolved=await wrappedInputs.resolveAgentRun(identity),view=typeof resolved.readContext==='function'?resolved.readContext():{context:runPacket.context};
    const scoped=require('./agent-figma-service').nativePromptContext(view.context.authoring,{},[],context,runPacket.version.spec,hash);
    assertCurrent();return{sourceHash:d.sourceHash,capabilities:Object.keys(n.operations),context:p.clone(scoped.policy),assertCurrent};
   };
   const createService=evalStore?options=>require('./agent-eval-service').createEvaluatedAgentService({createService:serviceFactory,evalStore,evidenceKind,...options}):serviceFactory;
   service=createService({inputs:wrappedInputs,cli,protocol:p,nativeProtocol:n,hash,resolveNativePolicy,executionEnvironment,
    validatePostconditions:args=>{assertCurrent();const result=checker.validatePostconditions(args);assertCurrent();return result;},traceRoot,readonlyRoot,ledgerFactory:d.apolloRepository?require(path.join(d.apolloRepository,"src/generation/context/ledger.js")).createEvidenceLedger:null,...serviceOptions});
   return service;
  }).catch(error=>{loading=null;throw error;});return loading;
 }
 return{loadService,isBusy:()=>service?.isBusy()||false};
}
function mountConfiguredAgentFigmaRoutes(app,options){const runtime=createConfiguredAgentFigmaRuntime(options);mountAgentFigmaRoutes(app,runtime);return runtime;}
function createConfiguredAgentFigmaHostRuntime({configFile,providerFactory,provider='codex',binary='codex',model='',environment=process.env,mcpConfigFile=null,dataRoot=process.env.APOLLO_DATA_ROOT}={}){
 if(dataRoot)return createDataMcpHost({configFile,providerFactory,provider,binary,model,environment,mcpConfigFile,dataRoot});
 let runtime=null,loading=null;
 async function loadService(){
  if(runtime)return runtime.loadService();if(loading)return loading;
  loading=Promise.resolve().then(async()=>{
   if(!path.isAbsolute(configFile||'')||typeof providerFactory!=='function')fail('AGENT_EXECUTION_UNAVAILABLE');
   const bytes=fs.readFileSync(configFile),configHash=sha(bytes),config=JSON.parse(bytes);
   let mcp=null,mcpHash=null;
   if(mcpConfigFile!==null){
    if(!path.isAbsolute(mcpConfigFile)||fs.realpathSync(mcpConfigFile)!==mcpConfigFile)fail('AGENT_MCP_UNAVAILABLE');
    const mcpBytes=fs.readFileSync(mcpConfigFile);mcpHash=sha(mcpBytes);mcp=JSON.parse(mcpBytes);
    const fields=['schemaVersion','name','url','fileKey','tools'];
    if(Object.keys(mcp).length!==fields.length||!fields.every(k=>Object.hasOwn(mcp,k))||mcp.schemaVersion!=='apollo.mcp-worker-config.v1'||mcp.name!=='apollo_figma_mcp'||mcp.url!=='https://mcp.figma.com/mcp'||!Array.isArray(mcp.tools)||!mcp.tools.includes('use_figma')||mcp.tools.some(t=>!['use_figma','get_screenshot'].includes(t)))fail('AGENT_MCP_UNAVAILABLE');
   }
   const keys=['schemaVersion','apolloRoot','currentConsumerFile','descriptorFile','frontendRoot','hostRoot'];
   if(!config||Object.keys(config).length!==keys.length||!keys.every(k=>Object.hasOwn(config,k))||config.schemaVersion!=='apollo.agent-figma-host-config.v1'||keys.slice(1).some(k=>!path.isAbsolute(config[k]||'')))fail('AGENT_CONFIGURATION_INVALID');
   fs.mkdirSync(config.frontendRoot,{recursive:true});fs.mkdirSync(config.hostRoot,{recursive:true});
   const generatedRoot=path.dirname(config.frontendRoot);
   if(fs.realpathSync(generatedRoot)!==generatedRoot||fs.realpathSync(config.frontendRoot)!==config.frontendRoot||fs.realpathSync(config.hostRoot)!==config.hostRoot||!config.hostRoot.startsWith(generatedRoot+path.sep)||config.hostRoot===config.frontendRoot||config.hostRoot.startsWith(config.frontendRoot+path.sep))fail('AGENT_CONFIGURATION_INVALID');
   const descriptor=JSON.parse(fs.readFileSync(config.descriptorFile));
   if(descriptor.schemaVersion!=='apollo.agent-figma-runtime-descriptor.v2'||descriptor.apolloRepository!==config.apolloRoot||descriptor.consumer?.path!==config.currentConsumerFile)fail('AGENT_CONFIGURATION_INVALID');
   if(mcp&&!descriptor.runtimeInputs.some(p=>p.path===mcpConfigFile&&p.sha256===mcpHash))fail('AGENT_MCP_CONFIG_UNPINNED');
   const app=path.join(config.apolloRoot,'.'),p=require(descriptor.protocol.path);
   const owned=require(path.join(app,'scripts/agent-figma-current-consumer.cjs')).loadOwnedFigmaProvider({consumerFile:config.currentConsumerFile,apolloRepository:config.apolloRoot});
   const assertCurrent=()=>{if(sha(fs.readFileSync(configFile))!==configHash||mcpConfigFile&&sha(fs.readFileSync(mcpConfigFile))!==mcpHash)fail('AGENT_RUNTIME_INPUTS_STALE');owned.assertCurrent();};
   const source=providerFactory(config),wrappedProvider={...source,readPromptContext:async input=>{assertCurrent();const value=await source.readPromptContext(input);value.assertCurrent();assertCurrent();return{...value,assertCurrent(){assertCurrent();value.assertCurrent();}};}};
   const inputs=require(path.join(app,'scripts/agent-run-inputs.cjs')).createAgentRunInputs({ownedFigmaProvider:owned,provider:wrappedProvider,protocol:p,hash:source.hash,skillsDirectory:path.join(app,'instructions/agent-generation'),frontendRoot:config.frontendRoot});
   let skills;
   if(mcp){const file=path.join(app,'instructions/agent-generation/figma-mcp.md'),bytes=fs.readFileSync(file);skills={figma:{id:'apollo-figma-mcp-profile',version:'0.2.0',sources:[{path:file,sha256:sha(bytes),bytes:bytes.length,name:'SKILL.md',prompt:true}]}};}
   else{const selected=require(path.join(app,'scripts/agent-generation-skills.cjs')).createGenerationSkills().select('figma',{executionProfile:'figma-owned-root-v1',sourceHash:owned.sourceHash});selected.assertCurrent();skills={figma:{id:selected.metadata.name,version:selected.metadata.version,sources:selected.metadata.files.map(pin=>({...pin,name:path.relative(path.dirname(selected.metadata.files[0].path),pin.path),prompt:true}))}};}
   const evalStore=require('./agent-eval-store').createAgentEvalStore({root:path.join(config.hostRoot,mcp?'mcp-run-evals':'run-evals'),protocol:p,hash:source.hash,skills});
   const cli=require('./agent-cli').createAgentCli({provider,binary,model,environment,generatedRoot,mcpConnection:mcp,usageRoot:path.join(config.hostRoot,'request-usage')});
   runtime=createConfiguredAgentFigmaRuntime({descriptorFile:config.descriptorFile,inputs,cli,evalStore,evidenceKind:mcp?'mcp-owned-root-experimental':'native-reported',traceRoot:path.join(config.hostRoot,mcp?'mcp-runtime-traces':'runtime-traces'),readonlyRoot:path.join(config.hostRoot,mcp?'mcp-readonly-workspaces':'readonly-workspaces'),serviceFactory:mcp?require('./agent-mcp-service').createAgentMcpService:createAgentFigmaService,serviceOptions:mcp?{mcpConnection:mcp,mcpNamespace:require(path.join(app,"src/generation/agent/figma/target.js")).MCP_NAMESPACE,assertComposition:require(path.join(app,"src/generation/agent/figma/target.js")).assertMcpComposition,usageRoot:path.join(config.hostRoot,'request-usage')}:{usageRoot:path.join(config.hostRoot,'request-usage')}});
   return runtime.loadService();
  }).catch(error=>{loading=null;throw error;});return loading;
 }
 return{loadService,isBusy:()=>runtime?.isBusy()||false};
}
// Runtime files are pinned once per process. Package snapshots are pinned once per run.
function createDataMcpHost({configFile,providerFactory,provider,binary,model,environment,mcpConfigFile,dataRoot}){
 let service=null,loading=null;
 async function loadService(){
  if(service)return service;if(loading)return loading;
  loading=Promise.resolve().then(()=>{
   if(!mcpConfigFile)fail('DATA_BUILT_IN_GENERATION_UNSUPPORTED');
   const pins=new Map(),read=file=>{if(!path.isAbsolute(file)||fs.realpathSync(file)!==file||!fs.lstatSync(file).isFile())fail('AGENT_CONFIGURATION_INVALID');const bytes=fs.readFileSync(file);pins.set(file,sha(bytes));return bytes;};
   const config=JSON.parse(read(configFile)),mcp=JSON.parse(read(mcpConfigFile));
   const portable=config.schemaVersion==='apollo.data-mcp-host-config.v1';
   const keys=portable?['schemaVersion','apolloRoot','frontendRoot','hostRoot']:['schemaVersion','apolloRoot','currentConsumerFile','descriptorFile','frontendRoot','hostRoot'];
   if(!portable&&config.schemaVersion!=='apollo.agent-figma-host-config.v1'||Object.keys(config).length!==keys.length||!keys.every(k=>Object.hasOwn(config,k))||keys.slice(1).some(k=>!path.isAbsolute(config[k]||'')))fail('AGENT_CONFIGURATION_INVALID');
   if(mcp.schemaVersion!=='apollo.mcp-worker-config.v1'||mcp.name!=='apollo_figma_mcp'||mcp.url!=='https://mcp.figma.com/mcp'||!(/^[a-zA-Z0-9_-]{6,128}$/).test(mcp.fileKey||'')||!Array.isArray(mcp.tools)||!mcp.tools.includes('use_figma')||mcp.tools.some(t=>!['use_figma','get_screenshot'].includes(t)))fail('AGENT_MCP_UNAVAILABLE');
   for(const root of [config.frontendRoot,config.hostRoot]){fs.mkdirSync(root,{recursive:true});if(fs.realpathSync(root)!==root)fail('AGENT_CONFIGURATION_INVALID');}
   const generatedRoot=path.dirname(config.frontendRoot);if(!config.hostRoot.startsWith(generatedRoot+path.sep)||config.hostRoot===config.frontendRoot||config.hostRoot.startsWith(config.frontendRoot+path.sep))fail('AGENT_CONFIGURATION_INVALID');
   const app=path.join(config.apolloRoot,'.');
   for(const name of ['dist/runtime.cjs','dist/agent-protocol.cjs',fs.existsSync(path.join(app,'portable-runtime.json'))?'portable-runtime.json':'dist/agent-figma-postconditions.cjs',"src/generation/agent/figma/source.json","src/generation/agent/figma/target.js","src/generation/agent/figma/mapping.js","src/generation/agent/figma/projection.js","src/generation/agent/figma/api.js","src/generation/context/resources.js","src/generation/context/ledger.js",'scripts/agent-run-inputs.cjs','instructions/agent-generation/figma-mcp.md','instructions/agent-generation/figma-owned.md'])read(path.join(app,name));
   const assertCurrent=()=>{for(const [file,pin]of pins)if(sha(fs.readFileSync(file))!==pin)fail('AGENT_RUNTIME_INPUTS_STALE');};
   const p=require(path.join(app,'dist/agent-protocol.cjs')),source=providerFactory(config);
   const dataReader=()=>{assertCurrent();return require('../data-packages').readGenerationData({root:dataRoot,apolloRoot:config.apolloRoot});};
   const inputs=require(path.join(app,'scripts/agent-run-inputs.cjs')).createAgentRunInputs({provider:source,dataReader,protocol:p,hash:source.hash,skillsDirectory:path.join(app,'instructions/agent-generation'),installedSkillsDirectory:require('../portable-runtime').installedSkillsDirectory(app),frontendRoot:config.frontendRoot});
   const file=path.join(app,'instructions/agent-generation/figma-mcp.md'),bytes=read(file),skills={figma:{id:'apollo-figma-mcp-profile',version:'0.2.0',sources:[{path:file,sha256:sha(bytes),bytes:bytes.length,name:'SKILL.md',prompt:true}]}};
   const evalStore=require('./agent-eval-store').createAgentEvalStore({root:path.join(config.hostRoot,'mcp-run-evals'),protocol:p,hash:source.hash,skills});
   const cli=require('./agent-cli').createAgentCli({provider,binary,model,environment,generatedRoot,mcpConnection:mcp,usageRoot:path.join(config.hostRoot,'request-usage')});
   const resolveNativePolicy=async({identity,packet})=>{
    assertCurrent();const resolved=inputs.resolveAgentRun(identity);resolved.assertCurrent();const view=resolved.readContext();
    const context=require('./agent-figma-service').nativePromptContext(view.context.authoring,{},[],resolved.figmaPolicy,packet.version.spec,source.hash);
    return{sourceHash:resolved.figmaSourceHash,context:p.clone(context.policy),assertCurrent(){assertCurrent();resolved.assertCurrent();}};
   };
   const target=require(path.join(app,"src/generation/agent/figma/target"));
   service=require('./agent-eval-service').createEvaluatedAgentService({createService:require('./agent-mcp-service').createAgentMcpService,evalStore,evidenceKind:'mcp-owned-root-experimental',
    inputs,cli,protocol:p,hash:source.hash,resolveNativePolicy,mcpConnection:mcp,ledgerFactory:require(path.join(app,"src/generation/context/ledger")).createEvidenceLedger,assertComposition:target.assertMcpComposition,mcpNamespace:target.MCP_NAMESPACE,
    traceRoot:path.join(config.hostRoot,'mcp-runtime-traces'),readonlyRoot:path.join(config.hostRoot,'mcp-readonly-workspaces')});
   assertCurrent();return service;
  }).catch(error=>{loading=null;throw error;});return loading;
 }
 return{loadService,isBusy:()=>service?.isBusy()||false};
}
function mountConfiguredAgentFigmaHostRoutes(app,options){const runtime=createConfiguredAgentFigmaHostRuntime(options);mountAgentFigmaRoutes(app,runtime);return runtime;}
function mountConfiguredAgentMcpRoutes(app,options){
 const configured=()=>(options.provider===undefined||options.provider==='codex')&&typeof options.mcpConfigFile==='string'&&path.isAbsolute(options.mcpConfigFile)&&fs.existsSync(options.mcpConfigFile);
 const runtime=configured()?createConfiguredAgentFigmaHostRuntime(options):null;
 require('./agent-mcp-service').mountAgentMcpRoutes(app,{configured,loadService:()=>{if(!runtime)fail('AGENT_MCP_UNAVAILABLE');return runtime.loadService();}});
 return runtime;
}
module.exports={mountConfiguredAgentMcpRoutes,createConfiguredAgentFigmaRuntime,mountConfiguredAgentFigmaRoutes,createConfiguredAgentFigmaHostRuntime,mountConfiguredAgentFigmaHostRoutes};
