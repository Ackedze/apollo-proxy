'use strict';
const path=require('node:path');
const {openKnowledge}=require('./knowledge');
const {createLandingService,mountLandingRoutes}=require('./service');
const {createAgentCli}=require('../generation-agent/agent-cli');
const catalog=require('../skills/catalog'),releases=require('../data-release');
function mountConfiguredLandingRoutes(app,{environment=process.env,provider='codex',binary='codex',model='',root=path.join(require('../portable-runtime').stateRoot(environment),'landing'),releaseRoot=environment.APOLLO_RELEASE_ROOT,runtimeRoot=environment.APOLLO_PROJECT_ROOT}={}){
 let service;const sources=new Map();
 const knowledge=(skillId=catalog.LANDING_ID)=>{if(provider!=='codex')throw Object.assign(Error('LANDING_PROVIDER_UNSUPPORTED'),{code:'LANDING_PROVIDER_UNSUPPORTED',status:503});if(!sources.has(skillId))sources.set(skillId,openKnowledge({releaseRoot,runtimeRoot,skillId}));const source=sources.get(skillId);source.assertCurrent();return source;};
 function loadService(){
  if(!service)service=createLandingService({root,knowledge,createCli:fileKey=>createAgentCli({provider,binary,model,environment,generatedRoot:root,usageRoot:path.join(root,'usage'),trackUsage:require('../token-journal').trackCall,mcpConnection:fileKey?{name:'apollo_figma_mcp',url:'https://mcp.figma.com/mcp',fileKey,tools:['use_figma','get_screenshot']}:null})});
  return service;
 }
 function status(){
  try{const manifest=releases.readReleaseFiles(releaseRoot,runtimeRoot),skills=catalog.generationPackages(releaseRoot,manifest).map(entry=>({id:entry.id,name:entry.descriptor.name,description:entry.descriptor.description,platforms:entry.descriptor.generation?.platforms||['desktop']}));if(!skills.length)throw Object.assign(Error('LANDING_SKILL_UNAVAILABLE'),{code:'LANDING_SKILL_UNAVAILABLE'});const defaultSkillId=skills.some(skill=>skill.id===catalog.LANDING_ID)?catalog.LANDING_ID:skills[0].id,current=knowledge(defaultSkillId);return {available:provider==='codex',skills,defaultSkillId,skillVersion:current.skill.version,skillHash:current.skill.sha256,knowledgeVersion:current.knowledgeVersion,releaseId:current.id,platforms:['desktop'],placementModes:['new-section','section'],provider:'codex',mcpAuthentication:'VERIFIED_ON_EXECUTION'};}
  catch(e){return {available:false,code:e.code||'LANDING_DATA_REQUIRED',platforms:['desktop'],provider:'codex'};}
 }
 mountLandingRoutes(app,{loadService,status});
 return {loadService,isBusy:()=>service?.isBusy()||false};
}
module.exports={mountConfiguredLandingRoutes};
