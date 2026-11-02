'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {budget}=require('../generation-agent/usage');
const {openKnowledge}=require('./knowledge');
const {LANDING_ID,skillId:validSkillId}=require('../skills/catalog');
const checkpoints=require('./checkpoints');
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
const RESOURCE={type:'object',properties:{id:{type:'string'},mode:{type:'string',enum:['read','keys','summary']},path:{type:'array',items:{type:'string'}},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:16000}},required:['id','mode','path','offset','limit'],additionalProperties:false};
const STEP={type:'object',properties:{kind:{type:'string',enum:['list_resources','request_context','question','build','continue','finish']},message:{type:'string'},specJson:{type:'string'},query:{type:'string'},offset:{type:'integer'},resources:{type:'array',items:RESOURCE},resultJson:{type:'string'}},required:['kind','message','specJson','query','offset','resources','resultJson'],additionalProperties:false};
const WORKING=new Set(['running','awaiting-canvas','awaiting-readback']);
const READER_STATE='apollo.generation-reader.v1';
function createLandingService({root,knowledge=()=>openKnowledge({releaseRoot:process.env.APOLLO_RELEASE_ROOT,runtimeRoot:process.env.APOLLO_PROJECT_ROOT}),createCli,readNow=Date.now,waitForRetry=(ms,signal)=>delay(ms,undefined,{signal})}={}){
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
  if(WORKING.has(r.status)){r.status='interrupted';if(r.execution)r.execution.status='interrupted';r.message='Работа была прервана. Макет и история сохранены; перед продолжением перечитаем Figma.';save(r);}
  records.set(id,r);return r;
 }
 const view=r=>copy({schemaVersion:r.schemaVersion,id:r.id,skillId:r.skillId||LANDING_ID,skillName:r.skillName||'Лендинг',revision:r.revision,sequence:r.sequence,status:r.status,message:r.message,messages:r.messages,spec:r.spec,result:r.result,target:r.target,context:r.context,source:r.source,execution:r.execution||null,usage:r.usage,sources:r.sources,readback:r.readback,createdAt:r.createdAt,updatedAt:r.updatedAt,error:r.error||null,failures:r.failures||[]});
 const readerPin=source=>source.resumePin||sha([source.id,source.knowledgeVersion,source.skill,source.initial]);
 function rememberRead(job,row){
  const address=JSON.stringify([row.id,row.path,row.mode,row.offset]),value={address,...row},old=job.context.findIndex(v=>v.address===address);
  const success=!row.error&&!row.tooLarge&&typeof row.text==='string',previous=old<0?null:job.context[old],enriches=success&&(!previous||typeof previous.text!=='string'||row.text.length>previous.text.length);
  if(old<0)job.context.push(value);else if(enriches||typeof previous.text!=='string')job.context[old]=value;
  if(enriches&&!job.seenReads.has(sha(row))){job.seenReads.add(sha(row));job.readVersion++;}
 }
 function readerState(r,job){
  r.readerState={schemaVersion:READER_STATE,sourcePin:readerPin(job.source),reads:[...job.readRequests.values()].filter(v=>!v.row.error&&!v.row.tooLarge).map(v=>({request:v.request,rowHash:sha(v.row)})),indexes:job.indexes.map(v=>({query:v.query,offset:v.offset,rowHash:sha(v)}))};
 }
 function restoreReader(r,job){
  const state=r.readerState;if(!state||state.schemaVersion!==READER_STATE||state.sourcePin!==readerPin(job.source))return;
  if(!Array.isArray(state.reads)||!Array.isArray(state.indexes))fail('LANDING_READER_STATE_INVALID');
  for(const entry of state.reads){const row=job.source.read(entry.request);if(row.error||row.tooLarge||sha(row)!==entry.rowHash)fail('LANDING_READER_STATE_INVALID');rememberRead(job,row);job.readRequests.set(sha(entry.request),{request:entry.request,row});}
  for(const entry of state.indexes){const row=job.source.list(entry.query,entry.offset);if(sha(row)!==entry.rowHash)fail('LANDING_READER_STATE_INVALID');job.indexes.push(row);job.lastList=row;}
  if(Buffer.byteLength(JSON.stringify(job.context))>524288)fail('LANDING_CONTEXT_FULL');
  job.resourceFeedback={code:'RESTORED_CONFIRMED_CONTEXT',resources:job.context.length,indexes:job.indexes.length};
 }
 function create(body){
  const fields=Object.hasOwn(body||{},'placement')?['pageId','fileKey','placement']:['pageId','fileKey'];if(Object.hasOwn(body||{},'skillId'))fields.push('skillId');
  const skillId=body?.skillId||LANDING_ID;if(!validSkillId(skillId))fail('LANDING_CHAT_INVALID',400);
  if(!(exact(body,fields)||exact(body,['id',...fields])&&UUID.test(body.id||''))||Object.hasOwn(body,'placement')&&(!exact(body.placement,['mode','sectionId'])||!['new-section','section'].includes(body.placement.mode)||body.placement.mode==='section'&&!node(body.placement.sectionId)||body.placement.mode==='new-section'&&body.placement.sectionId!==null)||!node(body.pageId)||body.fileKey!==null&&!key(body.fileKey))fail('LANDING_CHAT_INVALID',400);
  const context={pageId:body.pageId,fileKey:body.fileKey};if(body.placement)context.placement=copy(body.placement);
  if(body.id&&(records.has(body.id)||fs.existsSync(file(body.id)))){const old=load(body.id);if(!equal(old.context,context)||(old.skillId||LANDING_ID)!==skillId)fail('LANDING_REQUEST_CONFLICT');return view(old);}
  const selected=knowledge(skillId);selected.assertCurrent();if(selected.skill.id&&selected.skill.id!==skillId)fail('LANDING_SKILL_UNAVAILABLE');
  const r={schemaVersion:'apollo.landing-chat.v1',id:body.id||crypto.randomUUID(),skillId,skillName:selected.skill.name||'Лендинг',revision:0,sequence:0,status:'draft',message:'Опишите задачу.',messages:[],spec:{version:0,facts:[],decisions:[],questions:[],sections:[]},result:null,target:null,context,source:null,usage:[],sources:[],readback:null,requests:[],createdAt:new Date(readNow()).toISOString()};records.set(r.id,r);save(r);return view(r);
 }
 const busy=()=>Array.from(records.values()).some(r=>WORKING.has(r.status));
 function assertJob(r,job){if(jobs.get(r.id)!==job||job.controller.signal.aborted||r.status==='cancelled')fail('LANDING_CANCELLED');job.source.assertCurrent();}
 function stopped(r,job,error){
  if(error.usage)r.usage.push(error.usage);if(jobs.get(r.id)!==job){if(error.usage)save(r);return;}
  if(r.execution&&job.phase==='write'){r.execution.status='interrupted';r.execution.nextAction='Independently reread the retained root before any further write.';r.execution.lastIssue={code:error.code||'LANDING_EXECUTION_FAILED',diagnostic:error.diagnostic||null};}
  r.status=error.code==='LANDING_CANCELLED'||error.code==='AGENT_CANCELLED'?'cancelled':'interrupted';r.error=r.error||{code:error.code||'LANDING_EXECUTION_FAILED',diagnostic:error.diagnostic||{stage:'landing-'+job.phase,modelStep:job.steps,lastQueries:(job.indexes||[]).map(row=>({query:row.query,offset:row.offset,total:row.total})),step:job.lastOutput||null,resourceRequest:job.resourceRequest||null}};r.failures=r.failures||[];r.failures.push({revision:r.revision,at:new Date(readNow()).toISOString(),error:copy(r.error)});r.message=r.status==='cancelled'?'Остановлено. История и созданный макет сохранены.':r.error.code==='AGENT_MODEL_CAPACITY'?'Модель временно перегружена. Выполненные шаги сохранены. Продолжите позже в этом чате.':r.target?'Продолжение остановлено. История и созданная область сохранены.':'Подготовка прервана. История сохранена; макет ещё не создавался.';save(r);jobs.delete(r.id);
 }
 function launch(r,job){job.promise=execute(r,job).catch(error=>stopped(r,job,error));return view(r);}
 function submit(id,body){
  const r=load(id);if(!exact(body,['requestId','revision','text'])||!UUID.test(body.requestId||'')||!Number.isSafeInteger(body.revision)||typeof body.text!=='string'||!body.text.trim()||body.text.length>32000)fail('LANDING_MESSAGE_INVALID',400);
  const previous=r.requests.find(row=>row.id===body.requestId);if(previous){if(previous.hash!==sha(body))fail('LANDING_REQUEST_CONFLICT');return view(r);}
  if(body.revision!==r.revision)fail('LANDING_REVISION_STALE');if(busy())fail('LANDING_BUSY');
  const source=knowledge(r.skillId||LANDING_ID),originalSections=copy(r.spec.sections);source.assertCurrent();
  const job={source,controller:new AbortController(),context:[],lastList:null,indexes:[],queries:new Map(),readRequests:new Map(),seenReads:new Set(),readVersion:0,noProgressReads:0,steps:0,toolCalls:0,phase:'plan',requestId:body.requestId,originalSections,requiresEditScope:!!r.target};restoreReader(r,job);
  r.revision++;r.error=null;r.requests.push({id:body.requestId,hash:sha(body)});r.messages.push({id:body.requestId,role:'user',text:body.text,revision:r.revision});r.source={releaseId:source.id,knowledgeVersion:source.knowledgeVersion,skillId:r.skillId||LANDING_ID,skillVersion:source.skill.version,skillHash:source.skill.sha256};r.status='running';r.message='Читаем бриф и правила выбранного навыка…';r.spec.version=r.revision;
  for(const row of source.initial.norms||[]){const fact={releaseId:source.id,id:row.id,sha256:row.sha256,path:row.path,mode:row.mode,offset:row.offset};if(!r.sources.some(v=>sha(v)===sha(fact)))r.sources.push(fact);}save(r);
  jobs.set(id,job);return launch(r,job);
 }
 function prompt(r,job){return [
  'Use the selected packaged generation skill below. Create an editable Desktop layout in the existing Figma file. Business facts come only from the brief and confirmed user answers. Proposals are not approvals. Ask material questions, then build section by section and support scoped follow-up. Never require a user checkout or Python in this Proxy adapter.',
  'The host canvasContext is authoritative: create only in that current file and page using its placement. Never ask for a Figma URL, fileKey, pageId or node ancestry when canvasContext already supplies them. A pasted URL is brief text and cannot redirect this chat. Use the supplied read-only resource index; do not perform repository contribution, queue or authentication workflows.',
  'Return exactly one STEP. specJson is the current complete JSON spec; keep stable section IDs and actual nodeId values. list_resources matches ALL query words as path substrings (AND), with offset pagination; use one component path per search, not a list of alternative names. request_context can read all selected IDs in one step; the host yields between read batches. request_context reads only listed IDs; for JSON inspect keys before selecting a path/range. A resource error is a failed read, not source evidence: retain successful batch reads, read keys at error.availablePath and choose an observed key; never substitute an invented asset. Existing step/context/tool budgets still apply. Non-JSON offset/limit are character ranges; JSON arrays use item ranges. Persist selected component/preset, public props/slots, assets and read sources in each section before writing. Use assetSources exact indexed IDs rather than guessing catalog path spellings. If a required asset category is unavailable, report that missing-resource gap as a question/limitation before build; do not search alternate names for the absent category or guess component keys. Read the full mandatory norms and skill-selected sources through this reader.',
  'question suspends for an actual user answer. build requests the owned canvas and independent readback; it does not execute a frozen ScreenSpec. After any bounded MCP work return continue or finish with actual IDs. Host independently rereads the canvas before the next write. finish includes resultJson with summary, checks (PASS/FAIL/UNKNOWN with evidence), issues and limits. No empty-root success, no guessed assets or claims of unobserved conformance. Ready=false.',
  'After the host supplies an owned target, do not request build again: perform bounded MCP work and return continue/finish, or request_context for missing indexed data. The host treats repeated build as a readback-only continuation, not a new canvas or a new edit scope.',
  'execution is host-owned: bootstrap creates/configures only the required host and page layout, with no section content; section permits only activeSectionId; verify is read-only and performs final structural/visual checks and screenshot. Work in small scripts, at most 2 MCP calls per turn, then return continue with resultJson={"checkpoint":{"sectionId":null or activeSectionId,"status":"partial" or "complete","nextAction":"specific remaining action"}}. A section can span multiple partial checkpoints. Do not create a later section or change confirmed other sections. Complete only with actual section nodeId; the host advances after independent readback. finish is allowed only in verify. Unknown outcomes and execution.lastIssue require inspecting existing nodes rather than replaying writes. Snapshot/sizing gaps remain FAIL/UNKNOWN, not success. Global budgets do not reset at checkpoints.',
  'Resource pages are bounded by serialized UTF-8 bytes. Follow the returned next offset, never requested offset+limit: a page may contain fewer items. next=null is end only for a successful read. For a single oversized item, read keys at availablePath and choose observed child fields. Already supplied resources/indexes are confirmed context: do not request them again. Use resourceFeedback and cached next cursors to make progress.',
  'For design-system JSONS/indexes component arrays, use mode=summary and path=["components"] to choose candidate names/categories first. This selection-only projection omits component keys and variant details: read a chosen entry in mode=read at its fullPath before selecting its published component/variant key. Summary is not available for normative documents and never replaces their full reading.',
  'For a follow-up on an existing landing, spec.editSectionIds must declare the requested sections and necessary dependencies before build. Preserve the complete spec entries of other sections, their IDs and canvas content. Host compares their before/after fingerprints. A question is preferable to changing unrelated sections.',
  'When target exists, use only apollo_figma_mcp.use_figma/get_screenshot, exact target.fileKey. Resolve target.rootNodeId and require parent id==(target.parentNodeId||target.pageId), its containing page==target.pageId, shared namespace apollolanding owner==ownerNonce and active==leaseNonce before every mutation. Write only inside that root. Tag section roots section=<spec section id> in apollolanding. Preserve all other sections during follow-up. Unknown write outcome requires a canvas read before any more writes. Never delete roots or user content for cleanup. Source/library/global style and variable definitions are protected. Load fonts, use confirmed published keys and allowed typed public slots. Screenshots and actual readback are required for technical/visual claims; unavailable evidence remains UNKNOWN.',
  job.source.initial.hostInstructions||'',
  job.phase==='write'?'CONSTRUCTION_RECIPES='+constructionRecipes+'\nUse these recipes for narrowed source API reads, font loading and preserving intrinsic source-owned modes. Never copy resolvedVariableModes into explicit scene modes. compareMcpDefaults is the pristine default SLOT payload guard: replace only a proved untouched default in a fresh owned instance through its documented typed SLOT; append/verify replacement before removing that payload. It does not permit deletion for cleanup. Normative and visual checking remain enabled.':'',
  JSON.stringify({skill:job.source.initial.instructions,selectedSkill:job.source.initial.selectedSkill||null,norms:job.source.initial.norms,workflow:job.phase==='write'?job.source.initial.workflow:[],source:r.source,initialIndex:job.source.initial.resources,initialIndexes:job.source.initial.indexes||[],assetSources:job.source.initial.assetSources||null,index:job.lastList,indexes:job.indexes,canvasContext:r.context,resources:job.context,resourceFeedback:job.resourceFeedback||null,dialogue:r.messages,spec:r.spec,target:job.phase==='write'?r.target:null,readback:job.phase==='write'?r.readback:null,execution:job.phase==='write'?r.execution:null,limits:{modelStepsRemaining:24-job.steps,toolsRemaining:96-job.toolCalls,writeCallsPerTurn:2,writeSoftRuntimeMs:90000}})
 ].join('\n');}
 async function execute(r,job){
  while(++job.steps<=24){
   assertJob(r,job);
   const directory=path.join(root,'work',r.id),trace=path.join(root,'traces',r.id);fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(trace,{recursive:true});
   job.lastOutput=null;job.resourceRequest=null;job.passSpec=copy(r.spec.sections);
   if(job.phase==='write'){r.execution.status='running';r.execution.elapsedMs=0;r.execution.toolCalls=0;job.passStarted=readNow();r.message=r.execution.stage==='bootstrap'?'Готовим контейнер…':r.execution.stage==='verify'?'Проверяем готовый макет…':'Собираем секцию '+r.execution.activeSectionId+'…';save(r);}
   const cli=createCli(r.context.fileKey);let out;
   for(let retry=0;;retry++){
    assertJob(r,job);const text=prompt(r,job);budget({prompt:text,schema:STEP,outputReserveChars:196608});
    try{
     out=await cli.run({workspace:directory,traceDirectory:trace,profile:job.phase==='write'?'landing-figma':'landing-plan',prompt:text,schema:STEP,signal:job.controller.signal,mcpBudget:{maxToolCalls:Math.min(job.phase==='write'?4:24,96-job.toolCalls),maxTotalToolOutputBytes:16*1024*1024},checkpointBudget:job.phase==='write'?{maxCompletedCalls:3,softRuntimeMs:90000}:null,onEvent:event=>{
      if(job.phase!=='write'||jobs.get(r.id)!==job||job.controller.signal.aborted||event.item?.type!=='mcp_tool_call'||!['item.started','item.completed'].includes(event.type))return;
      r.execution.operation=['use_figma','get_screenshot'].includes(event.item.tool)?'mcp.'+event.item.tool:null;r.execution.callId=typeof event.item.id==='string'?event.item.id.slice(0,120):null;r.execution.elapsedMs=Math.max(0,readNow()-job.passStarted);if(event.type==='item.started')r.execution.toolCalls++;
      r.message=`${r.execution.stage==='bootstrap'?'Готовим контейнер':r.execution.stage==='verify'?'Финальная проверка':'Собираем секцию '+r.execution.activeSectionId} · ${Math.round(r.execution.elapsedMs/1000)} с`;save(r);
     },diagnosticContext:{requestId:job.requestId,runId:r.id,stage:'landing-'+job.phase,modelStep:job.steps,rootNodeId:r.target?.rootNodeId||null,sectionId:job.phase==='write'?r.execution.activeSectionId:null,executionStage:job.phase==='write'?r.execution.stage:null}});break;
    }catch(error){
     if(job.phase==='write'&&(error.code==='AGENT_CHECKPOINT_REQUIRED'||error.code==='AGENT_TIMEOUT'&&error.usage?.toolCalls>0)){
      try{assertJob(r,job);}catch(guard){guard.usage=error.usage;throw guard;}if(error.usage)r.usage.push(error.usage);job.toolCalls+=error.usage?.toolCalls||0;if(job.toolCalls>96)fail('LANDING_TOOL_BUDGET');
      r.execution.status='awaiting-readback';r.execution.elapsedMs=Math.max(0,readNow()-job.passStarted);r.execution.lastIssue={code:error.code,diagnostic:error.diagnostic||null,nativeFailures:error.nativeFailures||[],nativeFailure:error.nativeFailure||null};r.execution.nextAction='Inspect the independent readback and actual public API after the observed error; never replay blindly or repeat unsupported variant values.';
      r.failures=r.failures||[];r.failures.push({revision:r.revision,at:new Date(readNow()).toISOString(),error:{code:error.code,diagnostic:error.diagnostic||null}});job.pending={kind:'continue',checkpoint:null,recovery:true};r.status='awaiting-readback';r.message='Проход остановлен. Перечитываем сохранённую секцию перед продолжением…';save(r);return;
     }
     // Only the tool-free planner can be replayed without a fresh canvas read.
     if(error.code!=='AGENT_MODEL_CAPACITY'||job.phase!=='plan'||retry>=2||job.steps>=24||job.controller.signal.aborted||jobs.get(r.id)!==job)throw error;
     if(error.usage)r.usage.push(error.usage);
     r.failures=r.failures||[];r.failures.push({revision:r.revision,at:new Date(readNow()).toISOString(),error:{code:error.code,diagnostic:error.diagnostic||null}});
     assertJob(r,job);const ms=[5000,15000][retry];
     r.message=`Модель временно перегружена. Повторим запрос через ${ms/1000} с (повтор ${retry+1} из 2).`;save(r);
     await waitForRetry(ms,job.controller.signal);assertJob(r,job);
     job.steps++;r.message='Повторяем запрос к модели. Прочитанные данные сохранены…';save(r);
    }
   }
   const step=out.result;
   try{assertJob(r,job);}catch(error){error.usage=out.receipt?.usage;throw error;}
   r.usage.push(out.receipt?.usage||null);
   job.lastOutput={kind:typeof step?.kind==='string'?step.kind.slice(0,80):null,resourceCount:Array.isArray(step?.resources)?step.resources.length:null,outputSha256:out.receipt?.outputSha256||null};
   if(!exact(step,Object.keys(STEP.properties))||!STEP.properties.kind.enum.includes(step.kind)||typeof step.message!=='string'||step.message.length>12000||!Array.isArray(step.resources))fail('LANDING_STEP_INVALID',502);
   const spec=json(step.specJson);if(!Array.isArray(spec.sections)||spec.sections.length>100||new Set(spec.sections.map(s=>s?.id)).size!==spec.sections.length||spec.sections.some(s=>!s||typeof s.id!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(s.id)))fail('LANDING_SPEC_INVALID',502);
   if(job.phase==='write')checkpoints.specScope(r.execution,job.passSpec,spec.sections);
   if(job.allowedSections&&job.originalSections.some(old=>!job.allowedSections.has(old.id)&&!equal(old,spec.sections.find(section=>section.id===old.id))))fail('LANDING_EDIT_SCOPE_INVALID',502);
   spec.target=Object.assign({},spec.target,{fileKey:r.context.fileKey,pageId:r.context.pageId,rootNodeId:r.target?.rootNodeId||null});if(r.context.placement)spec.target.placement=copy(r.context.placement);
   spec.version=r.revision;r.spec=spec;r.message=step.message;job.toolCalls+=out.receipt?.mcp?.toolCalls||0;if(job.toolCalls>96)fail('LANDING_TOOL_BUDGET');save(r);
   if(step.kind==='list_resources'){
    const list=job.source.list(step.query,step.offset),address=JSON.stringify([step.query,step.offset]),previous=job.queries.get(address);
    const repeats=previous&&previous.readVersion===job.readVersion?previous.repeats+1:1;
    job.queries.set(address,{readVersion:job.readVersion,repeats});job.lastList=list;
    const at=job.indexes.findIndex(row=>row.query===step.query&&row.offset===step.offset);if(at<0)job.indexes.push(list);else job.indexes[at]=list;
    if(repeats>=3)throw Object.assign(Error('LANDING_NO_PROGRESS'),{code:'LANDING_NO_PROGRESS',diagnostic:{stage:'landing-'+job.phase,query:step.query,offset:step.offset,total:list.total,repeatedQueries:repeats}});
    if(!step.resources.length){readerState(r,job);save(r);continue;}
   }
   if(step.kind==='request_context'||step.kind==='list_resources'){
    if(!step.resources.length)fail('LANDING_RESOURCE_INVALID');
    const before=job.readVersion;let cached=0;
    for(let i=0;i<step.resources.length;i++){
     const request=step.resources[i];job.resourceRequest={index:i,id:typeof request?.id==='string'?request.id.slice(0,512):null};assertJob(r,job);const address=sha(request),previous=job.readRequests.get(address),row=previous?.row||job.source.read(request);if(previous)cached++;else job.readRequests.set(address,{request:copy(request),row});
     rememberRead(job,row);const fact={releaseId:job.source.id,id:row.id,sha256:row.sha256,path:row.path,mode:row.mode,offset:row.offset};if(!row.error&&!row.tooLarge&&!r.sources.some(v=>sha(v)===sha(fact)))r.sources.push(fact);
     if(Buffer.byteLength(JSON.stringify(job.context))>524288)fail('LANDING_CONTEXT_FULL');
     // Yield for Stop/source freshness; eight is a scheduling slice, not an item cap.
     if((i+1)%8===0&&i+1<step.resources.length){readerState(r,job);save(r);await new Promise(resolve=>setImmediate(resolve));}
    }
    job.noProgressReads=job.readVersion===before?job.noProgressReads+1:0;
    job.resourceFeedback={code:job.readVersion===before?'ALREADY_READ_OR_FAILED':'CONTEXT_UPDATED',cached,consecutiveNoProgress:job.noProgressReads};
    job.resourceRequest=null;readerState(r,job);save(r);
    if(job.noProgressReads>=3)throw Object.assign(Error('LANDING_NO_PROGRESS'),{code:'LANDING_NO_PROGRESS',diagnostic:{stage:'landing-'+job.phase,repeatedRequests:job.noProgressReads,resourceFeedback:job.resourceFeedback,lastOutput:job.lastOutput}});
    continue;
   }
   if(step.kind==='question'){if(job.phase==='write'&&(out.receipt?.mcp?.toolCalls||0)>0)fail('LANDING_READBACK_REQUIRED');r.status='needs-input';r.messages.push({id:'answer:'+crypto.randomUUID(),role:'assistant',text:step.message,revision:r.revision});save(r);jobs.delete(r.id);return;}
   if(step.kind==='build'){
    if(!spec.sections.length)fail('LANDING_SPEC_INVALID',502);
    if(job.requiresEditScope){
     const allowed=spec.editSectionIds;if(!Array.isArray(allowed)||!allowed.length||new Set(allowed).size!==allowed.length||allowed.some(id=>!job.originalSections.concat(spec.sections).some(s=>s.id===id))||job.originalSections.some(old=>!allowed.includes(old.id)&&!equal(old,spec.sections.find(section=>section.id===old.id))))fail('LANDING_EDIT_SCOPE_INVALID',502);
     if(job.allowedSections&&!equal([...job.allowedSections].sort(),allowed.slice().sort()))fail('LANDING_EDIT_SCOPE_INVALID',502);
     job.allowedSections=new Set(allowed);
    }
    if(job.phase==='write'&&r.target){job.pending={...step,kind:'continue'};r.status='awaiting-readback';r.message='Перечитываем созданную область перед продолжением…';save(r);return;}
    r.status='awaiting-canvas';r.message=step.message||'Готовим область для лендинга…';job.phase='write';save(r);return;
   }
   if(job.phase!=='write'||!r.target)fail('LANDING_CANVAS_REQUIRED');
   if(!['continue','finish'].includes(step.kind))fail('LANDING_STEP_INVALID',502);
   job.pending={...step,checkpoint:checkpoints.checkpoint(r.execution,step.kind,json(step.resultJson))};r.execution.status='awaiting-readback';r.execution.elapsedMs=Math.max(0,readNow()-job.passStarted);r.status='awaiting-readback';r.message='Проверяем фактический результат в Figma…';save(r);return;
  }
  fail('LANDING_STEP_BUDGET');
 }
 function canvas(id,body){
  const r=load(id),job=jobs.get(id);if(!job||r.status!=='awaiting-canvas'||!exact(body,['revision','target','readback'])||body.revision!==r.revision)fail('LANDING_REVISION_STALE');try{assertJob(r,job);}catch(error){stopped(r,job,error);throw error;}
  const t=body.target;if(!(exact(t,['fileKey','pageId','rootNodeId','ownerNonce','leaseNonce'])||exact(t,['fileKey','pageId','rootNodeId','ownerNonce','leaseNonce','parentNodeId'])&&node(t.parentNodeId))||r.context.placement&&(!t.parentNodeId||r.context.placement.mode==='section'&&t.parentNodeId!==r.context.placement.sectionId)||!key(t.fileKey)||t.pageId!==r.context.pageId||!node(t.rootNodeId)||![t.ownerNonce,t.leaseNonce].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||r.context.fileKey&&r.context.fileKey!==t.fileKey||r.target&&['pageId','rootNodeId','ownerNonce','parentNodeId'].some(k=>r.target[k]!==t[k]))fail('LANDING_CANVAS_INVALID',400);
  validateReadback(body.readback,t);r.target=copy(t);r.context.fileKey=t.fileKey;r.readback=copy(body.readback);job.baseline=copy(body.readback);r.execution=checkpoints.start(r,readerPin(job.source),job.allowedSections);r.status='running';save(r);return launch(r,job);
 }
 function observation(id,body){
  const r=load(id),job=jobs.get(id);if(!job||r.status!=='awaiting-readback'||!exact(body,['revision','readback'])||body.revision!==r.revision)fail('LANDING_REVISION_STALE');
  try{assertJob(r,job);validateReadback(body.readback,r.target);
  if(body.readback.outsideHash!==job.baseline.outsideHash||job.allowedSections&&job.baseline.sections.some(old=>!job.allowedSections.has(old.sectionId)&&!body.readback.sections.some(row=>row.id===old.id&&row.fingerprint===old.fingerprint))){const error=Object.assign(Error('LANDING_UNREQUESTED_CONTENT_CHANGED'),{code:'LANDING_UNREQUESTED_CONTENT_CHANGED'});stopped(r,job,error);throw error;}
  checkpoints.protect(r.execution,job.baseline,body.readback);
  if(job.pending.kind!=='finish')checkpoints.observed(r.execution,job.baseline,body.readback,job.pending.checkpoint||null,r.spec,readNow());
  if(job.pending.recovery&&r.execution.activeSectionId){const row=body.readback.sections.find(s=>s.sectionId===r.execution.activeSectionId);if(row)r.spec.sections.find(s=>s.id===row.sectionId).nodeId=row.id;}
  r.readback=copy(body.readback);job.baseline=copy(body.readback);
  if(job.pending.kind==='finish'){
   const rows=r.readback.sections;if(!r.spec.sections.length||r.readback.instanceCount<1||r.spec.sections.some(section=>!rows.some(row=>row.sectionId===section.id&&row.id===section.nodeId)))fail('LANDING_RESULT_INCOMPLETE');
   const result=json(job.pending.resultJson);r.result={...result,revision:r.revision,figmaUrl:'https://www.figma.com/design/'+r.target.fileKey+'/Apollo?node-id='+encodeURIComponent(r.target.rootNodeId),rootNodeId:r.target.rootNodeId,Ready:false,checks:(Array.isArray(result.checks)?result.checks:[]).map(check=>({...check,origin:'agent-report'})),readbackHash:sha(r.readback)};r.execution.status='completed';r.status='completed';r.message=job.pending.message;r.messages.push({id:'answer:'+crypto.randomUUID(),role:'assistant',text:r.message,revision:r.revision});save(r);jobs.delete(id);return view(r);
  }
  job.pending=null;r.status='running';save(r);return launch(r,job);
  }catch(error){stopped(r,job,error);throw error;}
 }
 function validateReadback(v,t){if(!v||!exact(v,['rootNodeId','pageId','ownerNonce','leaseNonce','outsideHash','nodeCount','instanceCount','sections','text','coverage'])||['rootNodeId','pageId','ownerNonce','leaseNonce'].some(k=>v[k]!==t[k])||!/^([a-f0-9]{64})$/.test(v.outsideHash||'')||!Number.isSafeInteger(v.nodeCount)||v.nodeCount<1||!Number.isSafeInteger(v.instanceCount)||v.instanceCount<0||!Array.isArray(v.sections)||v.sections.length>100||new Set(v.sections.map(row=>row?.id)).size!==v.sections.length||new Set(v.sections.map(row=>row?.sectionId)).size!==v.sections.length||v.sections.some(row=>!row||!node(row.id)||typeof row.sectionId!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(row.sectionId)||!/^([a-f0-9]{64})$/.test(row.fingerprint||''))||typeof v.text!=='string'||v.text.length>64000||v.coverage!=='tagged-sections-and-text'||Buffer.byteLength(JSON.stringify(v))>262144)fail('LANDING_READBACK_INVALID',400);}
 function cancel(id){const r=load(id),job=jobs.get(id);if(job)job.controller.abort();jobs.delete(id);r.status='cancelled';if(r.execution)r.execution.status='cancelled';r.message='Остановлено. История и созданный макет сохранены.';save(r);return view(r);}
 function failure(id,body){
  const r=load(id);if(!exact(body,['revision','error'])||body.revision!==r.revision||!exact(body.error,['code','diagnostic'])||!/^LANDING_[A-Z_]{1,100}$/.test(body.error.code||'')||Buffer.byteLength(JSON.stringify(body.error))>4096)fail('LANDING_FAILURE_INVALID',400);
  const job=jobs.get(id);if(!job)return view(r);job.controller.abort();const error=Object.assign(Error(body.error.code),body.error);stopped(r,job,error);return view(r);
 }
 function list(){return fs.readdirSync(root).filter(name=>UUID.test(name.slice(0,-5))&&name.endsWith('.json')).map(name=>load(name.slice(0,-5))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(r=>({id:r.id,status:r.status,title:r.messages.find(m=>m.role==='user')?.text.slice(0,80)||r.skillName||'Лендинг',updatedAt:r.updatedAt}));}
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
