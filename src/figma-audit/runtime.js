'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createAuditService}=require('./service');
const {openAuditKnowledge}=require('./knowledge');
const tokenJournal=require('../token-journal');
function mountConfiguredAuditRoutes(app,{environment=process.env,provider='codex',binary='codex',model='',releaseRoot=environment.APOLLO_RELEASE_ROOT,runtimeRoot=environment.APOLLO_PROJECT_ROOT,root=path.join(require('../portable-runtime').stateRoot(environment),'figma-audit'),createCli=options=>require('../generation-agent/agent-cli').createAgentCli(options),isUnavailable=()=>false}={}){
 let service;
 function source(){if(provider!=='codex')throw Object.assign(Error('AUDIT_PROVIDER_UNSUPPORTED'),{code:'AUDIT_PROVIDER_UNSUPPORTED',status:503});return openAuditKnowledge({releaseRoot,runtimeRoot});}
 function load(){
  if(service)return service;source();const installed=require('../data-release').readRuntime(runtimeRoot);if(!installed.files.some(p=>p.file==='src/figma-audit/protocol.js'))throw Object.assign(Error('AUDIT_RUNTIME_INCOMPATIBLE'),{code:'AUDIT_RUNTIME_INCOMPATIBLE',status:503});const p=require(path.join(runtimeRoot,'src/figma-audit/protocol.js'));
  fs.mkdirSync(root,{recursive:true});if(fs.realpathSync(root)!==root)throw Error('AUDIT_ROOT_INVALID');
  const cli=createCli({provider,binary,model,environment,generatedRoot:root,usageRoot:path.join(root,'usage'),trackUsage:require('../token-journal').trackCall,maxRuntimeMs:300000});
  service=createAuditService({protocol:p,knowledge:source,isUnavailable,
   persist:run=>{if(['completed','failed','cancelled'].includes(run.status))tokenJournal.current()?.finishNamed('figma-audit:'+run.requestId,run.status);const target=path.join(root,run.runId+'.json'),tmp=target+'.tmp';fs.writeFileSync(tmp,JSON.stringify(run,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,target);},
   invoke:async({runId,requestId,step,phase,prompt,schema,signal})=>{
    const workspace=path.join(root,runId,'workspace'),traceDirectory=path.join(root,runId,'traces');fs.mkdirSync(workspace,{recursive:true});fs.mkdirSync(traceDirectory,{recursive:true});
    fs.writeFileSync(path.join(traceDirectory,'step-'+step+'.input.json'),JSON.stringify({runId,requestId,phase,prompt,schema}),{flag:'wx',mode:0o600});
    const journal=tokenJournal.current(),key='figma-audit:'+requestId;journal?.startNamed(key,'Навык · Проверка по DSI Hub');
    const execute=()=>cli.run({workspace,traceDirectory,profile:'figma-audit',prompt,schema,signal,diagnosticContext:{runId,requestId,stage:'audit-'+phase,modelStep:step}});const output=journal?await journal.withinNamed(key,execute):await execute();fs.writeFileSync(path.join(traceDirectory,'step-'+step+'.output.json'),JSON.stringify({result:output.result,usage:output.receipt.usage}),{flag:'wx',mode:0o600});return {result:output.result,usage:output.receipt.usage};
   }});return service;
 }
 const respond=handler=>(req,res)=>{try{res.json({success:true,...handler(req)});}catch(e){res.status(e.status||503).json({success:false,code:e.code||'AUDIT_UNAVAILABLE'});}};
 const prefix='/skills/figma-audit';
 app.get(prefix+'/status',respond(()=>{const k=source();return {available:true,skill:k.skill,releaseId:k.id,knowledgeVersion:k.knowledgeVersion,readOnly:true};}));
 app.post(prefix+'/runs',respond(req=>({run:load().start(req.body)})));
 app.get(prefix+'/runs/:id',respond(req=>({run:load().get(req.params.id,req.query.requestId)})));
 app.post(prefix+'/runs/:id/context',respond(req=>({run:load().context(req.params.id,req.body)})));
 app.post(prefix+'/runs/:id/cancel',respond(req=>({run:load().cancel(req.params.id,req.body?.requestId)})));
 return {isBusy:()=>service?.isBusy()||false};
}
module.exports={mountConfiguredAuditRoutes};
