'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {budget}=require('../generation-agent/usage');
const {openKnowledge}=require('./knowledge');
const constructionRecipes=Object.values(require('./figma-recipes')).map(fn=>fn.toString()).join('\n');
const equal=require('node:util').isDeepStrictEqual;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const key=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{6,128}$/.test(v);
const node=v=>typeof v==='string'&&/^[a-zA-Z0-9:;_-]{1,512}$/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
const copy=v=>JSON.parse(JSON.stringify(v));
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status});};
const sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function json(text,max=262144){
 if(typeof text!=='string'||Buffer.byteLength(text)>max)fail('LANDING_OUTPUT_INVALID',502);
 const value=JSON.parse(text);let count=0;
 function visit(v,depth){if(++count>50000||depth>32)fail('LANDING_OUTPUT_INVALID',502);if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(k))fail('LANDING_OUTPUT_INVALID',502);visit(x,depth+1);}}
 visit(value,0);if(!value||typeof value!=='object'||Array.isArray(value))fail('LANDING_OUTPUT_INVALID',502);return value;
}
const RESOURCE={type:'object',properties:{id:{type:'string'},mode:{type:'string',enum:['read','keys']},path:{type:'array',items:{type:'string'}},offset:{type:'integer'},limit:{type:'integer'}},required:['id','mode','path','offset','limit'],additionalProperties:false};
const STEP={type:'object',properties:{kind:{type:'string',enum:['list_resources','request_context','question','build','continue','finish']},message:{type:'string'},specJson:{type:'string'},query:{type:'string'},offset:{type:'integer'},resources:{type:'array',items:RESOURCE},resultJson:{type:'string'}},required:['kind','message','specJson','query','offset','resources','resultJson'],additionalProperties:false};
const WORKING=new Set(['running','awaiting-canvas','awaiting-readback']);
function createLandingService({root,knowledge=()=>openKnowledge({releaseRoot:process.env.APOLLO_RELEASE_ROOT,runtimeRoot:process.env.APOLLO_PROJECT_ROOT}),createCli,readNow=Date.now}={}){
 if(!path.isAbsolute(root||'')||typeof createCli!=='function')fail('LANDING_CONFIGURATION_INVALID',503);
 fs.mkdirSync(root,{recursive:true,mode:0o700});if(fs.realpathSync(root)!==root)fail('LANDING_STORAGE_UNSAFE',503);
 const records=new Map(),jobs=new Map();
 const file=id=>{if(!UUID.test(id||''))fail('LANDING_CHAT_INVALID',400);return path.join(root,id+'.json');};
 function save(r){
  r.sequence++;r.updatedAt=new Date(readNow()).toISOString();const bytes=JSON.stringify(r,null,2)+'\n';if(Buffer.byteLength(bytes)>4*1024*1024)fail('LANDING_CHAT_FULL',503);
  const target=file(r.id),temp=target+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});fs.renameSync(temp,target);}finally{fs.rmSync(temp,{force:true});}
 }
 function load(id){
  if(records.has(id))return records.get(id);const target=file(id);let r;
  try{const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)fail('LANDING_STORAGE_UNSAFE',503);r=JSON.parse(fs.readFileSync(target,'utf8'));}catch(e){if(e.code==='ENOENT')fail('LANDING_CHAT_NOT_FOUND',404);throw e;}
  if(r.schemaVersion!=='apollo.landing-chat.v1'||r.id!==id)fail('LANDING_STORAGE_INVALID',503);
  if(WORKING.has(r.status)){r.status='interrupted';r.message='Работа была прервана. Макет и история сохранены; перед продолжением перечитаем Figma.';save(r);}
  records.set(id,r);return r;
 }
 const view=r=>copy({schemaVersion:r.schemaVersion,id:r.id,revision:r.revision,sequence:r.sequence,status:r.status,message:r.message,messages:r.messages,spec:r.spec,result:r.result,target:r.target,context:r.context,source:r.source,usage:r.usage,sources:r.sources,readback:r.readback,createdAt:r.createdAt,updatedAt:r.updatedAt,error:r.error||null,failures:r.failures||[]});
 function create(body){
  if(!(exact(body,['pageId','fileKey'])||exact(body,['id','pageId','fileKey'])&&UUID.test(body.id||''))||!node(body.pageId)||body.fileKey!==null&&!key(body.fileKey))fail('LANDING_CHAT_INVALID',400);
  const context={pageId:body.pageId,fileKey:body.fileKey};
  if(body.id&&(records.has(body.id)||fs.existsSync(file(body.id)))){const old=load(body.id);if(!equal(old.context,context))fail('LANDING_REQUEST_CONFLICT');return view(old);}
  const r={schemaVersion:'apollo.landing-chat.v1',id:body.id||crypto.randomUUID(),revision:0,sequence:0,status:'draft',message:'Опишите задачу лендинга.',messages:[],spec:{version:0,facts:[],decisions:[],questions:[],sections:[]},result:null,target:null,context,source:null,usage:[],sources:[],readback:null,requests:[],createdAt:new Date(readNow()).toISOString()};records.set(r.id,r);save(r);return view(r);
 }
 const busy=()=>Array.from(records.values()).some(r=>WORKING.has(r.status));
 function assertJob(r,job){if(jobs.get(r.id)!==job||job.controller.signal.aborted||r.status==='cancelled')fail('LANDING_CANCELLED');job.source.assertCurrent();}
 function stopped(r,job,error){
  if(error.usage)r.usage.push(error.usage);if(jobs.get(r.id)!==job){if(error.usage)save(r);return;}
  r.status=error.code==='LANDING_CANCELLED'||error.code==='AGENT_CANCELLED'?'cancelled':'interrupted';r.error=r.error||{code:error.code||'LANDING_EXECUTION_FAILED',diagnostic:error.diagnostic||null};r.failures=r.failures||[];r.failures.push({revision:r.revision,at:new Date(readNow()).toISOString(),error:copy(r.error)});r.message=r.status==='cancelled'?'Остановлено. История и созданный макет сохранены.':'Продолжение остановлено. История и частичный макет сохранены.';save(r);jobs.delete(r.id);
 }
 function launch(r,job){job.promise=execute(r,job).catch(error=>stopped(r,job,error));return view(r);}
 function submit(id,body){
  const r=load(id);if(!exact(body,['requestId','revision','text'])||!UUID.test(body.requestId||'')||!Number.isSafeInteger(body.revision)||typeof body.text!=='string'||!body.text.trim()||body.text.length>32000)fail('LANDING_MESSAGE_INVALID',400);
  const previous=r.requests.find(row=>row.id===body.requestId);if(previous){if(previous.hash!==sha(body))fail('LANDING_REQUEST_CONFLICT');return view(r);}
  if(body.revision!==r.revision)fail('LANDING_REVISION_STALE');if(busy())fail('LANDING_BUSY');
  const source=knowledge(),originalSections=copy(r.spec.sections);source.assertCurrent();r.revision++;r.error=null;r.requests.push({id:body.requestId,hash:sha(body)});r.messages.push({id:body.requestId,role:'user',text:body.text,revision:r.revision});r.source={releaseId:source.id,knowledgeVersion:source.knowledgeVersion,skillVersion:source.skill.version,skillHash:source.skill.sha256};r.status='running';r.message='Читаем бриф и правила лендинга…';r.spec.version=r.revision;
  for(const row of source.initial.norms||[]){const fact={releaseId:source.id,id:row.id,sha256:row.sha256,path:row.path,mode:row.mode,offset:row.offset};if(!r.sources.some(v=>sha(v)===sha(fact)))r.sources.push(fact);}save(r);
  const job={source,controller:new AbortController(),context:[],lastList:null,steps:0,toolCalls:0,phase:'plan',requestId:body.requestId,originalSections};jobs.set(id,job);return launch(r,job);
 }
 function prompt(r,job){return [
  'Use the canonical landing skill below. First Desktop landing in an existing Figma file. Business facts come only from the brief and confirmed user answers. Proposals are not approvals. Ask material questions, then build section by section and support scoped follow-up. Never require a user checkout or Python in this Proxy adapter.',
  'Return exactly one STEP. specJson is the current complete JSON spec; keep stable section IDs and actual nodeId values. list_resources searches the pinned index by path words, with offset pagination. request_context reads only listed IDs; for JSON inspect keys before selecting a path/range. Non-JSON offset/limit are character ranges; JSON arrays use item ranges. Persist selected component/preset, public props/slots, assets and read sources in each section before writing. Read hub manifest, landing-pages, business-segment-styles, draft-layout and CorporateContent rules through this reader.',
  'question suspends for an actual user answer. build requests the owned canvas and independent readback; it does not execute a frozen ScreenSpec. After any bounded MCP work return continue or finish with actual IDs. Host independently rereads the canvas before the next write. finish includes resultJson with summary, checks (PASS/FAIL/UNKNOWN with evidence), issues and limits. No empty-root success, no guessed assets or claims of unobserved conformance. Ready=false.',
  'For a follow-up on an existing landing, spec.editSectionIds must declare the requested sections and necessary dependencies before build. Preserve the complete spec entries of other sections, their IDs and canvas content. Host compares their before/after fingerprints. A question is preferable to changing unrelated sections.',
  'When target exists, use only apollo_figma_mcp.use_figma/get_screenshot, exact target.fileKey. Resolve target.rootNodeId and require parent pageId, shared namespace apollolanding owner==ownerNonce and active==leaseNonce before every mutation. Write only inside that root. Tag the CorporateContent instance role=host and section roots section=<spec section id> in apollolanding. Preserve all other sections during follow-up. Unknown write outcome requires a canvas read before any more writes. Never delete roots or user content for cleanup. Source/library/global style and variable definitions are protected. Load fonts, use confirmed published keys and allowed typed public slots. Screenshots and actual readback are required for technical/visual claims; unavailable evidence remains UNKNOWN.',
  job.phase==='write'?'CONSTRUCTION_RECIPES='+constructionRecipes+'\nUse these recipes for narrowed source API reads, font loading and preserving intrinsic source-owned modes. Never copy resolvedVariableModes into explicit scene modes. compareMcpDefaults is the pristine default SLOT payload guard: replace only a proved untouched default in a fresh owned instance through its documented typed SLOT; append/verify replacement before removing that payload. It does not permit deletion for cleanup. Normative and visual checking remain enabled.':'',
  JSON.stringify({skill:job.source.initial.instructions,norms:job.source.initial.norms,workflow:job.phase==='write'?job.source.initial.workflow:[],source:r.source,initialIndex:job.source.initial.resources,index:job.lastList,resources:job.context,dialogue:r.messages,spec:r.spec,target:job.phase==='write'?r.target:null,readback:r.readback,limits:{modelStepsRemaining:24-job.steps,toolsRemaining:96-job.toolCalls}})
 ].join('\n');}
 async function execute(r,job){
  while(++job.steps<=24){
   assertJob(r,job);const text=prompt(r,job);budget({prompt:text,schema:STEP,outputReserveChars:196608});
   const directory=path.join(root,'work',r.id),trace=path.join(root,'traces',r.id);fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(trace,{recursive:true});
   const cli=createCli(r.context.fileKey),out=await cli.run({workspace:directory,traceDirectory:trace,profile:job.phase==='write'?'landing-figma':'landing-plan',prompt:text,schema:STEP,signal:job.controller.signal,mcpBudget:{maxToolCalls:Math.min(24,96-job.toolCalls),maxTotalToolOutputBytes:16*1024*1024},diagnosticContext:{requestId:job.requestId,runId:r.id,stage:'landing-'+job.phase,modelStep:job.steps,rootNodeId:r.target?.rootNodeId||null}});
   assertJob(r,job);const step=out.result;
   if(!exact(step,Object.keys(STEP.properties))||!STEP.properties.kind.enum.includes(step.kind)||typeof step.message!=='string'||step.message.length>12000||!Array.isArray(step.resources)||step.resources.length>8)fail('LANDING_STEP_INVALID',502);
   const spec=json(step.specJson);if(!Array.isArray(spec.sections)||spec.sections.length>100||new Set(spec.sections.map(s=>s?.id)).size!==spec.sections.length||spec.sections.some(s=>!s||typeof s.id!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(s.id)))fail('LANDING_SPEC_INVALID',502);
   if(job.allowedSections&&job.originalSections.some(old=>!job.allowedSections.has(old.id)&&!equal(old,spec.sections.find(section=>section.id===old.id))))fail('LANDING_EDIT_SCOPE_INVALID',502);
   spec.version=r.revision;r.spec=spec;r.message=step.message;r.usage.push(out.receipt?.usage||null);job.toolCalls+=out.receipt?.mcp?.toolCalls||0;if(job.toolCalls>96)fail('LANDING_TOOL_BUDGET');save(r);
   if(step.kind==='list_resources'){job.lastList=job.source.list(step.query,step.offset);continue;}
   if(step.kind==='request_context'){
    if(!step.resources.length)fail('LANDING_RESOURCE_INVALID');const rows=step.resources.map(request=>job.source.read(request));
    for(const row of rows){const address=JSON.stringify([row.id,row.path,row.mode,row.offset]);const old=job.context.findIndex(v=>v.address===address);if(old>=0)job.context[old]={address,...row};else job.context.push({address,...row});const fact={releaseId:job.source.id,id:row.id,sha256:row.sha256,path:row.path,mode:row.mode,offset:row.offset};if(!row.tooLarge&&!r.sources.some(v=>sha(v)===sha(fact)))r.sources.push(fact);}
    if(Buffer.byteLength(JSON.stringify(job.context))>524288)fail('LANDING_CONTEXT_FULL');save(r);continue;
   }
   if(step.kind==='question'){if(job.phase==='write'&&(out.receipt?.mcp?.toolCalls||0)>0)fail('LANDING_READBACK_REQUIRED');r.status='needs-input';r.messages.push({id:'answer:'+crypto.randomUUID(),role:'assistant',text:step.message,revision:r.revision});save(r);jobs.delete(r.id);return;}
   if(step.kind==='build'){
    if(!spec.sections.length)fail('LANDING_SPEC_INVALID',502);
    if(r.target){
     const allowed=spec.editSectionIds;if(!Array.isArray(allowed)||!allowed.length||new Set(allowed).size!==allowed.length||allowed.some(id=>!job.originalSections.concat(spec.sections).some(s=>s.id===id))||job.originalSections.some(old=>!allowed.includes(old.id)&&!equal(old,spec.sections.find(section=>section.id===old.id))))fail('LANDING_EDIT_SCOPE_INVALID',502);
     job.allowedSections=new Set(allowed);
    }
    r.status='awaiting-canvas';r.message=step.message||'Готовим область для лендинга…';job.phase='write';save(r);return;
   }
   if(job.phase!=='write'||!r.target)fail('LANDING_CANVAS_REQUIRED');
   if(!['continue','finish'].includes(step.kind))fail('LANDING_STEP_INVALID',502);
   job.pending=step;r.status='awaiting-readback';r.message='Проверяем фактический результат в Figma…';save(r);return;
  }
  fail('LANDING_STEP_BUDGET');
 }
 function canvas(id,body){
  const r=load(id),job=jobs.get(id);if(!job||r.status!=='awaiting-canvas'||!exact(body,['revision','target','readback'])||body.revision!==r.revision)fail('LANDING_REVISION_STALE');try{assertJob(r,job);}catch(error){stopped(r,job,error);throw error;}
  const t=body.target;if(!exact(t,['fileKey','pageId','rootNodeId','ownerNonce','leaseNonce'])||!key(t.fileKey)||t.pageId!==r.context.pageId||!node(t.rootNodeId)||![t.ownerNonce,t.leaseNonce].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||r.context.fileKey&&r.context.fileKey!==t.fileKey||r.target&&['pageId','rootNodeId','ownerNonce'].some(k=>r.target[k]!==t[k]))fail('LANDING_CANVAS_INVALID',400);
  validateReadback(body.readback,t);r.target=copy(t);r.context.fileKey=t.fileKey;r.readback=copy(body.readback);job.baseline=copy(body.readback);r.status='running';save(r);return launch(r,job);
 }
 function observation(id,body){
  const r=load(id),job=jobs.get(id);if(!job||r.status!=='awaiting-readback'||!exact(body,['revision','readback'])||body.revision!==r.revision)fail('LANDING_REVISION_STALE');
  try{assertJob(r,job);validateReadback(body.readback,r.target);
  if(body.readback.outsideHash!==job.baseline.outsideHash||job.allowedSections&&job.baseline.sections.some(old=>!job.allowedSections.has(old.sectionId)&&!body.readback.sections.some(row=>row.id===old.id&&row.fingerprint===old.fingerprint))){const error=Object.assign(Error('LANDING_UNREQUESTED_CONTENT_CHANGED'),{code:'LANDING_UNREQUESTED_CONTENT_CHANGED'});stopped(r,job,error);throw error;}
  r.readback=copy(body.readback);job.baseline=copy(body.readback);
  if(job.pending.kind==='finish'){
   const rows=r.readback.sections;if(!r.spec.sections.length||r.readback.instanceCount<1||r.spec.sections.some(section=>!rows.some(row=>row.sectionId===section.id&&row.id===section.nodeId)))fail('LANDING_RESULT_INCOMPLETE');
   const result=json(job.pending.resultJson);r.result={...result,revision:r.revision,figmaUrl:'https://www.figma.com/design/'+r.target.fileKey+'/Apollo?node-id='+encodeURIComponent(r.target.rootNodeId),rootNodeId:r.target.rootNodeId,Ready:false,checks:(Array.isArray(result.checks)?result.checks:[]).map(check=>({...check,origin:'agent-report'})),readbackHash:sha(r.readback)};r.status='completed';r.message=job.pending.message;r.messages.push({id:'answer:'+crypto.randomUUID(),role:'assistant',text:r.message,revision:r.revision});save(r);jobs.delete(id);return view(r);
  }
  job.pending=null;r.status='running';save(r);return launch(r,job);
  }catch(error){stopped(r,job,error);throw error;}
 }
 function validateReadback(v,t){if(!v||!exact(v,['rootNodeId','pageId','ownerNonce','leaseNonce','outsideHash','nodeCount','instanceCount','sections','text','coverage'])||['rootNodeId','pageId','ownerNonce','leaseNonce'].some(k=>v[k]!==t[k])||!/^([a-f0-9]{64})$/.test(v.outsideHash||'')||!Number.isSafeInteger(v.nodeCount)||v.nodeCount<1||!Number.isSafeInteger(v.instanceCount)||v.instanceCount<0||!Array.isArray(v.sections)||v.sections.length>100||new Set(v.sections.map(row=>row?.id)).size!==v.sections.length||new Set(v.sections.map(row=>row?.sectionId)).size!==v.sections.length||v.sections.some(row=>!row||!node(row.id)||typeof row.sectionId!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(row.sectionId)||!/^([a-f0-9]{64})$/.test(row.fingerprint||''))||typeof v.text!=='string'||v.text.length>64000||v.coverage!=='tagged-sections-and-text'||Buffer.byteLength(JSON.stringify(v))>262144)fail('LANDING_READBACK_INVALID',400);}
 function cancel(id){const r=load(id),job=jobs.get(id);if(job)job.controller.abort();jobs.delete(id);r.status='cancelled';r.message='Остановлено. История и созданный макет сохранены.';save(r);return view(r);}
 function failure(id,body){
  const r=load(id);if(!exact(body,['revision','error'])||body.revision!==r.revision||!exact(body.error,['code','diagnostic'])||!/^LANDING_[A-Z_]{1,100}$/.test(body.error.code||'')||Buffer.byteLength(JSON.stringify(body.error))>4096)fail('LANDING_FAILURE_INVALID',400);
  const job=jobs.get(id);if(!job)return view(r);job.controller.abort();const error=Object.assign(Error(body.error.code),body.error);stopped(r,job,error);return view(r);
 }
 function list(){return fs.readdirSync(root).filter(name=>UUID.test(name.slice(0,-5))&&name.endsWith('.json')).map(name=>load(name.slice(0,-5))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(r=>({id:r.id,status:r.status,title:r.messages.find(m=>m.role==='user')?.text.slice(0,80)||'Лендинг',updatedAt:r.updatedAt}));}
 return {create,submit,canvas,observation,cancel,failure,list,poll:id=>view(load(id)),isBusy:busy,whenSettled:id=>jobs.get(id)?.promise||Promise.resolve()};
}
function mountLandingRoutes(app,{loadService,status}){
 const error=(res,e)=>res.status(e.status||503).json({success:false,code:/^(LANDING|AGENT)_[A-Z_]+$/.test(e.code||'')?e.code:'LANDING_UNAVAILABLE'});
 app.get('/landing/status',(_req,res)=>{try{res.json({success:true,...status()});}catch(e){error(res,e);}});
 app.get('/landing/chats',(_req,res)=>{try{res.json({success:true,chats:loadService().list()});}catch(e){error(res,e);}});
 app.post('/landing/chats',(req,res)=>{try{res.json({success:true,chat:loadService().create(req.body)});}catch(e){error(res,e);}});
 app.get('/landing/chats/:id',(req,res)=>{try{res.json({success:true,chat:loadService().poll(req.params.id)});}catch(e){error(res,e);}});
 for(const [route,method]of [['messages','submit'],['canvas','canvas'],['observation','observation'],['cancel','cancel'],['failure','failure']])app.post('/landing/chats/:id/'+route,(req,res)=>{try{res.json({success:true,chat:loadService()[method](req.params.id,req.body)});}catch(e){error(res,e);}});
}
module.exports={createLandingService,mountLandingRoutes,STEP};
