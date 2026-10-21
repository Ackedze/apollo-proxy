'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const {createRecipeCatalog}=require('./recipe-catalog');
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
// Pure planning input: only server configuration selects files; no run/workspace/model is created.
function createPromptTargetReader({configFile,nativeConfigFile,loadProvider}={}){
 return async function readTargetContext(input,target){
  if(!['frontend','figma'].includes(target))fail('PROMPT_TARGET_INVALID');
  if(process.env.APOLLO_DATA_ROOT){
   const provider=loadProvider(),base=await provider.readPromptContext(input),data=base.data,app=path.join(provider.apolloRoot,'.');
   if(target==='frontend'&&data.index.capabilities?.frontend===false)fail('AGENT_FRONTEND_CAPABILITY_UNAVAILABLE');
   let authoring=base.packet;
   if(target==='figma'&&data.native?.genericMapping)authoring=require(path.join(app,"src/generation/agent/figma/projection")).projectFigmaAuthoring(authoring,data.native.genericMapping,{manualReferences:true});
   if(target==='frontend'&&data.frontend)authoring=require(path.join(app,'scripts/agent-run-inputs.cjs')).projectFrontendAuthoring(authoring,data.frontend,{hash:provider.hash});
   const {genericMapping,...native}=data.native||{};
   const recipes=createRecipeCatalog();
   const projectionHelperPath=path.join(app,target==='figma'?"src/generation/agent/figma/projection.js":'scripts/agent-run-inputs.cjs'),skillFile=path.join(app,'instructions/agent-generation',target==='figma'?'figma-mcp.md':'frontend.md'),skill=fs.readFileSync(skillFile),skillHash=sha(skill);
   const packet={...authoring,targetContext:{target,origin:'server-data-index',scope:'planning-only',projectionHelperPath,dataDigest:data.index.id,recipeIndex:recipes.index(target),targetMapping:target==='figma'?{...native,semanticMapping:data.semantic}:data.frontend,ruleLinks:data.ruleLinks,bindingHelper:target==='frontend'?data.bindingHelper:null,skills:[{id:'apollo-data-'+target,text:skill.toString('utf8'),sha256:skillHash}],executionAllowed:false,Ready:false}};
   if(Buffer.byteLength(JSON.stringify(packet))>2097152)fail('PROMPT_CONTEXT_LIMIT');
   return{...base,packet,contracts:authoring.contracts.map(c=>c.pin),contextHash:provider.hash(packet),assertCurrent(){base.assertCurrent();recipes.assertCurrent();if(sha(fs.readFileSync(skillFile))!==skillHash)fail('PROMPT_TARGET_INPUTS_STALE');}};
  }
  if(typeof configFile!=='string'||!path.isAbsolute(configFile)||typeof loadProvider!=='function')fail('PROMPT_TARGET_CONTEXT_UNAVAILABLE');
  const pins=new Map();
  const read=file=>{try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024||fs.realpathSync(file)!==path.resolve(file))fail('PROMPT_TARGET_CONTEXT_UNAVAILABLE');const b=fs.readFileSync(file);pins.set(file,sha(b));return b;}catch(e){if(e.code?.startsWith('PROMPT_'))throw e;fail('PROMPT_TARGET_CONTEXT_UNAVAILABLE');}};
  let config;try{config=JSON.parse(read(configFile));}catch{fail('PROMPT_TARGET_CONTEXT_UNAVAILABLE');}
  if(config.schemaVersion!=='apollo.agent-runtime-config.v1'||!path.isAbsolute(config.apolloRoot||'')||!path.isAbsolute(config.mappingDirectory||''))fail('PROMPT_TARGET_CONTEXT_UNAVAILABLE');
  const app=path.join(config.apolloRoot,'.'),mapping=JSON.parse(read(path.join(config.mappingDirectory,target+'-mapping.json'))),ruleLinks=JSON.parse(read(path.join(config.mappingDirectory,'rule-links.json')));
  if(mapping.target!==target||!mapping.context||!mapping.bindings)fail('PROMPT_TARGET_CONTEXT_UNAVAILABLE');
  const bindingHelper=target==='frontend'?read(path.join(config.mappingDirectory,'bindings.ts')).toString('utf8'):null;
  const verifyNested=value=>{if(Array.isArray(value))value.forEach(verifyNested);else if(value&&typeof value==='object'){if(typeof value.path==='string'&&typeof value.sha256==='string'){if(!path.isAbsolute(value.path)||sha(read(value.path))!==value.sha256)fail('PROMPT_TARGET_INPUTS_STALE');}Object.values(value).forEach(verifyNested);}};
  verifyNested(mapping);
  const loaderFile=path.join(app,'scripts/agent-generation-skills.cjs'),profileFile=path.join(app,'instructions/agent-generation/skill-profile.json');read(loaderFile);const profile=JSON.parse(read(profileFile));
  let owned=null,semanticMapping=null;
  if(target==='figma'&&nativeConfigFile){
   if(!path.isAbsolute(nativeConfigFile))fail('PROMPT_TARGET_CONTEXT_UNAVAILABLE');
   const native=JSON.parse(read(nativeConfigFile)),keys=['schemaVersion','apolloRoot','currentConsumerFile','descriptorFile','frontendRoot','hostRoot'];
   if(!native||Object.keys(native).length!==keys.length||!keys.every(k=>Object.hasOwn(native,k))||native.schemaVersion!=='apollo.agent-figma-host-config.v1'||keys.slice(1).some(k=>!path.isAbsolute(native[k]||''))||native.apolloRoot!==config.apolloRoot)fail('PROMPT_TARGET_CONTEXT_UNAVAILABLE');
   const descriptor=JSON.parse(read(native.descriptorFile));
   if(descriptor.schemaVersion!=='apollo.agent-figma-runtime-descriptor.v2'||descriptor.apolloRepository!==native.apolloRoot||descriptor.consumer?.path!==native.currentConsumerFile)fail('PROMPT_TARGET_CONTEXT_UNAVAILABLE');
   const consumerLoader=path.join(app,'scripts/agent-figma-current-consumer.cjs');read(consumerLoader);
   owned=require(consumerLoader).loadOwnedFigmaProvider({consumerFile:native.currentConsumerFile,apolloRepository:native.apolloRoot});owned.assertCurrent();
   if(descriptor.sourceHash!==owned.sourceHash||descriptor.providerPacket?.path!==JSON.parse(read(native.currentConsumerFile)).packet.path)fail('PROMPT_TARGET_CONTEXT_UNAVAILABLE');
   semanticMapping=JSON.parse(read(path.join(app,'instructions/agent-generation/figma-owned-mapping.json')));
   if(semanticMapping.schemaVersion!=='apollo.agent-figma-semantic-mapping.v1'||semanticMapping.sourceHash!==owned.sourceHash||!Array.isArray(semanticMapping.mappings)||semanticMapping.mappings.some(m=>!m.mappingId||!m.componentId||!Array.isArray(m.choices)||m.choices.some(id=>!owned.packet.mappings.some(c=>c.id===id))))fail('PROMPT_TARGET_CONTEXT_UNAVAILABLE');
  }
  const selected=require(loaderFile).createGenerationSkills().select(target,target==='figma'?{executionProfile:'figma-owned-root-v1',sourceHash:owned?.sourceHash||profile.targets?.figma?.sourceHash}:{});
  const provider=loadProvider({apolloRoot:config.apolloRoot}),base=await provider.readPromptContext(input);base.assertCurrent();selected.assertCurrent();
  if(provider.hash(base.packet)!==base.contextHash)fail('PROMPT_TARGET_CONTEXT_INVALID');
  let authoring=base.packet,projectionHelperPath=null;if(owned?.packet.genericMapping){projectionHelperPath=path.join(app,"src/generation/agent/figma/projection.js");for(const name of ["generation/agent/figma/projection.js","generation/agent/figma/mapping.js","generation/agent/figma/api.js"]){const file=path.join(app,'src',name);read(file);delete require.cache[require.resolve(file)];}authoring=require(projectionHelperPath).projectFigmaAuthoring(base.packet,owned.packet.genericMapping);}
  if(target==='frontend'){
   projectionHelperPath=path.join(app,'scripts/agent-run-inputs.cjs');read(projectionHelperPath);delete require.cache[require.resolve(projectionHelperPath)];
   authoring=require(projectionHelperPath).projectFrontendAuthoring(base.packet,mapping,{hash:provider.hash,read});
  }
  // Planning uses logical admission data above; physical native targets remain in the owned execution packet.
  const {genericMapping:physicalNativeMapping,...planningMapping}=owned?.packet||{};
  const recipes=createRecipeCatalog();
  const packet={...authoring,targetContext:{target,origin:'server-configured-planning-input',scope:'planning-only',...(projectionHelperPath?{projectionHelperPath}:{}),recipeIndex:recipes.index(target),targetMapping:owned?{...planningMapping,semanticMapping}:mapping,ruleLinks,bindingHelper,skills:selected.skills,generationSkill:selected.metadata,executionAllowed:false,nativeExecutionAdmission:'NOT_GRANTED',Ready:false}};
  if(Buffer.byteLength(JSON.stringify(packet))>2097152)fail('PROMPT_CONTEXT_LIMIT');
  const assertCurrent=()=>{base.assertCurrent();selected.assertCurrent();owned?.assertCurrent();recipes.assertCurrent();for(const [file,pin]of pins)if(!fs.existsSync(file)||sha(fs.readFileSync(file))!==pin)fail('PROMPT_TARGET_INPUTS_STALE');};
  assertCurrent();return{...base,contracts:projectionHelperPath?authoring.contracts.map(c=>c.pin):base.contracts,packet,contextHash:provider.hash(packet),assertCurrent};
 };
}
module.exports={createPromptTargetReader};
