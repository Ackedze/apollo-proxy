'use strict';
const path=require('node:path');
const {openKnowledge}=require('./knowledge');
const {createDirectLandingService,mountDirectLandingRoutes,FLOW}=require('./direct-service');
const {createAgentCli,DIRECT_FIGMA_TOOLS}=require('../generation-agent/agent-cli');
const catalog=require('../skills/catalog'),releases=require('../data-release');
function mountConfiguredLandingRoutes(app,{environment=process.env,provider='codex',binary='codex',model='',root=path.join(require('../portable-runtime').stateRoot(environment),'landing'),releaseRoot=environment.APOLLO_RELEASE_ROOT,runtimeRoot=environment.APOLLO_PROJECT_ROOT}={}){
 let service;const sources=new Map();
 const knowledge=(skillId=catalog.LANDING_ID)=>{
  if(provider!=='codex')throw Object.assign(Error('LANDING_PROVIDER_UNSUPPORTED'),{code:'LANDING_PROVIDER_UNSUPPORTED',status:503});
  if(!sources.has(skillId))sources.set(skillId,openKnowledge({releaseRoot,runtimeRoot,skillId}));const source=sources.get(skillId);source.assertCurrent();return source;
 };
 function loadService(){
  if(!service)service=createDirectLandingService({root,knowledge,createCli:(fileKey,source)=>createAgentCli({provider,binary,model,environment,generatedRoot:root,maxRuntimeMs:900000,usageRoot:path.join(root,'usage'),trackUsage:require('../token-journal').trackCall,mcpConnection:{name:'apollo_figma_mcp',url:'https://mcp.figma.com/mcp',fileKey,tools:DIRECT_FIGMA_TOOLS},knowledgeConnection:{releaseRoot,runtimeRoot,sourcePin:source.resumePin,skillId:source.skill.id}})});
  return service;
 }
 function status(){
  try{
   const manifest=releases.readReleaseFiles(releaseRoot,runtimeRoot),skills=catalog.generationPackages(releaseRoot,manifest).filter(entry=>entry.descriptor.generation?.workflow===FLOW).map(entry=>({id:entry.id,name:entry.descriptor.name,description:entry.descriptor.description,platforms:entry.descriptor.generation.platforms}));
   if(!skills.length)throw Object.assign(Error('LANDING_DIRECT_SKILL_REQUIRED'),{code:'LANDING_DIRECT_SKILL_REQUIRED'});
   const defaultSkillId=skills.some(s=>s.id===catalog.LANDING_ID)?catalog.LANDING_ID:skills[0].id,current=knowledge(defaultSkillId);
   return {available:provider==='codex',flow:FLOW,skills,defaultSkillId,skillVersion:current.skill.version,skillHash:current.skill.sha256,knowledgeVersion:current.knowledgeVersion,releaseId:current.id,platforms:['desktop'],placementModes:['new-section','section'],provider:'codex',mcpAuthentication:'CHECKED_BEFORE_EXECUTION'};
  }catch(e){return {available:false,flow:FLOW,code:e.code||'LANDING_DATA_REQUIRED',platforms:['desktop']};}
 }
 mountDirectLandingRoutes(app,{loadService,status});return {loadService,isBusy:()=>service?.isBusy()||false};
}
module.exports={mountConfiguredLandingRoutes};
