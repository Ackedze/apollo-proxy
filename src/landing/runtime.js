'use strict';
const path=require('node:path');
const {openKnowledge}=require('./knowledge');
const {createLandingService,mountLandingRoutes}=require('./service');
const {createAgentCli}=require('../generation-agent/agent-cli');
function mountConfiguredLandingRoutes(app,{environment=process.env,provider='codex',binary='codex',model='',root=path.join(require('../portable-runtime').stateRoot(environment),'landing'),releaseRoot=environment.APOLLO_RELEASE_ROOT,runtimeRoot=environment.APOLLO_PROJECT_ROOT}={}){
 let service,source;
 const knowledge=()=>{if(provider!=='codex')throw Object.assign(Error('LANDING_PROVIDER_UNSUPPORTED'),{code:'LANDING_PROVIDER_UNSUPPORTED',status:503});if(!source)source=openKnowledge({releaseRoot,runtimeRoot});source.assertCurrent();return source;};
 function loadService(){
  if(!service)service=createLandingService({root,knowledge,createCli:fileKey=>createAgentCli({provider,binary,model,environment,generatedRoot:root,usageRoot:path.join(root,'usage'),trackUsage:require('../token-journal').trackCall,mcpConnection:fileKey?{name:'apollo_figma_mcp',url:'https://mcp.figma.com/mcp',fileKey,tools:['use_figma','get_screenshot']}:null})});
  return service;
 }
 function status(){
  try{const current=knowledge();return {available:provider==='codex',skillVersion:current.skill.version,skillHash:current.skill.sha256,knowledgeVersion:current.knowledgeVersion,releaseId:current.id,platforms:['desktop'],placementModes:['new-section','section'],provider:'codex',mcpAuthentication:'VERIFIED_ON_EXECUTION'};}
  catch(e){return {available:false,code:e.code||'LANDING_DATA_REQUIRED',platforms:['desktop'],provider:'codex'};}
 }
 mountLandingRoutes(app,{loadService,status});
 return {loadService,isBusy:()=>service?.isBusy()||false};
}
module.exports={mountConfiguredLandingRoutes};
