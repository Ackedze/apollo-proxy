'use strict';
const path=require('node:path'),fs=require('node:fs');
const {openKnowledge}=require('./knowledge');
const {createDirectLandingService,mountDirectLandingRoutes,FLOW}=require('./direct-service');
const {createAgentCli,DIRECT_FIGMA_TOOLS}=require('../generation-agent/agent-cli');
const {createRootLifecycle}=require('../figma-mcp/root-lifecycle');
const catalog=require('../skills/catalog'),releases=require('../data-release');
function retainedReleaseRoot(releaseRoot,releaseId){
 if(!releaseId)return releaseRoot;
 const current=JSON.parse(fs.readFileSync(path.join(releaseRoot,'manifest.json'),'utf8'));
 if(current.id===releaseId)return releaseRoot;
 const versions=path.dirname(releaseRoot),store=path.dirname(versions);
 const fail=()=>{throw Object.assign(Error('LANDING_DATA_STALE'),{code:'LANDING_DATA_STALE',status:409});};
 if(!/^[a-f0-9]{64}$/.test(releaseId)||path.basename(versions)!=='versions')fail();
 let state;try{state=JSON.parse(fs.readFileSync(path.join(store,'state.json'),'utf8'));}catch{fail();}
 if(state.schemaVersion!==releases.STORE_SCHEMA)fail();
 const target=path.join(versions,releaseId),entry=[state.current,state.previous].find(e=>e?.contentVersion===releaseId&&e.path===target);
 if(!entry||fs.realpathSync(target)!==target)fail();
 return target;
}
function mountConfiguredLandingRoutes(app,{environment=process.env,provider='codex',binary='codex',model='',root=path.join(require('../portable-runtime').stateRoot(environment),'landing'),releaseRoot=environment.APOLLO_RELEASE_ROOT,runtimeRoot=environment.APOLLO_PROJECT_ROOT}={}){
 let service;const sources=new Map();
 const knowledge=(skillId=catalog.LANDING_ID,releaseId)=>{
  if(provider!=='codex')throw Object.assign(Error('LANDING_PROVIDER_UNSUPPORTED'),{code:'LANDING_PROVIDER_UNSUPPORTED',status:503});
  const selectedRoot=retainedReleaseRoot(releaseRoot,releaseId),cacheKey=skillId+':'+selectedRoot;
  if(!sources.has(cacheKey))sources.set(cacheKey,openKnowledge({releaseRoot:selectedRoot,runtimeRoot,skillId}));const source=sources.get(cacheKey);source.assertCurrent();return source;
 };
 function loadService(){
  if(!service)service=createDirectLandingService({root,knowledge,rootLifecycle:createRootLifecycle({binary,environment,model}),createCli:(fileKey,source,mode)=>createAgentCli({provider,binary,model,environment,generatedRoot:root,maxRuntimeMs:900000,usageRoot:path.join(root,'usage'),trackUsage:require('../token-journal').trackCall,mcpConnection:{name:'apollo_figma_mcp',url:'https://mcp.figma.com/mcp',fileKey,tools:DIRECT_FIGMA_TOOLS},knowledgeConnection:{releaseRoot:source.releaseRoot||releaseRoot,runtimeRoot,sourcePin:source.resumePin,skillId:source.skill.id,files:mode==='B'?source.fileAccess:null}})});
  return service;
 }
 function status(){
  try{
   const manifest=releases.readReleaseFiles(releaseRoot,runtimeRoot),skills=catalog.generationPackages(releaseRoot,manifest).filter(entry=>entry.descriptor.generation?.workflow===FLOW).map(entry=>({id:entry.id,name:entry.descriptor.name,description:entry.descriptor.description,platforms:entry.descriptor.generation.platforms}));
   if(!skills.length)throw Object.assign(Error('LANDING_DIRECT_SKILL_REQUIRED'),{code:'LANDING_DIRECT_SKILL_REQUIRED'});
   const defaultSkillId=skills.some(s=>s.id===catalog.LANDING_ID)?catalog.LANDING_ID:skills[0].id,current=knowledge(defaultSkillId);
   return {available:provider==='codex',flow:FLOW,skills,defaultSkillId,skillVersion:current.skill.version,skillHash:current.skill.sha256,knowledgeVersion:current.knowledgeVersion,releaseId:current.id,recipeVerification:current.skill.generation?.verification||null,platforms:['desktop'],placementModes:['new-section','section'],provider:'codex',mcpAuthentication:'CHECKED_BEFORE_EXECUTION',knowledgePilot:['A','B']};
  }catch(e){return {available:false,flow:FLOW,code:e.code||'LANDING_DATA_REQUIRED',platforms:['desktop']};}
 }
 mountDirectLandingRoutes(app,{loadService,status});return {loadService,isBusy:()=>service?.isBusy()||false};
}
module.exports={mountConfiguredLandingRoutes,retainedReleaseRoot};
