'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {budget}=require('../generation-agent/usage');
const {openKnowledge}=require('./knowledge');
const {LANDING_ID,skillId:validSkillId}=require('../skills/catalog');
const checkpoints=require('./checkpoints');
const evidence=require('./evidence');
const {componentRequests,promptContext,isIndexPrefix}=require('./context');
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
const WRITE_PROPERTIES={...STEP.properties,sectionPatch:{type:['object','null'],properties:{sectionId:{type:'string'},nodeId:{type:'string'}},required:['sectionId','nodeId'],additionalProperties:false}};
delete WRITE_PROPERTIES.specJson;
const WRITE_STEP={type:'object',properties:WRITE_PROPERTIES,required:Object.keys(WRITE_PROPERTIES),additionalProperties:false};
const WORKING=new Set(['running','awaiting-canvas','awaiting-readback']);
const READER_STATE='apollo.generation-reader.v1';
const stagedJob=job=>job.source.skill.generation?.workflow===checkpoints.WORKFLOW;
const modelLimit=job=>stagedJob(job)?48:24;
const preparationUnit=job=>job.phase==='write'&&stagedJob(job)&&job.recordStage?.startsWith('prepare-');
const unitMessage=e=>({'prepare-foundation':'Подбираем основу по навыку',foundation:'Создаём основу','prepare-structure':'Подготавливаем каркас блока',structure:'Собираем каркас блока','prepare-content':'Подготавливаем контент блока',content:'Заполняем блок',verify:'Проверяем готовый макет',bootstrap:'Готовим контейнер',section:'Собираем секцию'}[e.stage]||'Продолжаем сборку')+(e.activeSectionId?' '+e.activeSectionId:'');
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
 const view=r=>copy({schemaVersion:r.schemaVersion,id:r.id,skillId:r.skillId||LANDING_ID,skillName:r.skillName||'Лендинг',revision:r.revision,sequence:r.sequence,status:r.status,message:r.message,messages:r.messages,spec:r.spec,result:r.result,target:r.target,context:r.context,source:r.source,planning:r.planning||null,execution:r.execution||null,usage:r.usage,sources:r.sources,readback:r.readback,createdAt:r.createdAt,updatedAt:r.updatedAt,error:r.error||null,failures:r.failures||[]});
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
  r.status=error.code==='LANDING_CANCELLED'||error.code==='AGENT_CANCELLED'?'cancelled':'interrupted';r.error=r.error||{code:error.code||'LANDING_EXECUTION_FAILED',diagnostic:error.diagnostic||{stage:'landing-'+job.phase,modelStep:job.steps,lastQueries:(job.indexes||[]).map(row=>({query:row.query,offset:row.offset,total:row.total})),step:job.lastOutput||null,resourceRequest:job.resourceRequest||null}};r.failures=r.failures||[];r.failures.push({revision:r.revision,at:new Date(readNow()).toISOString(),error:copy(r.error)});r.message=r.status==='cancelled'?'Остановлено. История и созданный макет сохранены.':r.error.code==='AGENT_ROUTING_TIMEOUT'?'Не удалось подключить модель за отведённое время. План и прочитанные источники сохранены; можно продолжить в этом чате.':r.error.code==='LANDING_PREPARATION_BUDGET'?'Подготовка достигла своего лимита. План и прочитанные источники сохранены; недостающие данные указаны в диагностике.':r.error.code==='AGENT_MODEL_CAPACITY'?'Модель временно перегружена. Выполненные шаги сохранены. Продолжите позже в этом чате.':r.target?'Продолжение остановлено. История и созданная область сохранены.':'Подготовка прервана. История сохранена; макет ещё не создавался.';save(r);jobs.delete(r.id);
 }
 function launch(r,job){job.promise=execute(r,job).catch(error=>stopped(r,job,error));return view(r);}
 function submit(id,body){
  const r=load(id);if(!exact(body,['requestId','revision','text'])||!UUID.test(body.requestId||'')||!Number.isSafeInteger(body.revision)||typeof body.text!=='string'||!body.text.trim()||body.text.length>32000)fail('LANDING_MESSAGE_INVALID',400);
  const previous=r.requests.find(row=>row.id===body.requestId);if(previous){if(previous.hash!==sha(body))fail('LANDING_REQUEST_CONFLICT');return view(r);}
  if(body.revision!==r.revision)fail('LANDING_REVISION_STALE');if(busy())fail('LANDING_BUSY');
  const source=knowledge(r.skillId||LANDING_ID),originalSections=copy(r.spec.sections);source.assertCurrent();
  const job={source,controller:new AbortController(),context:[],lastList:null,indexes:[],queries:new Map(),readRequests:new Map(),seenReads:new Set(),readVersion:0,noProgressReads:0,steps:0,toolCalls:0,phase:'plan',requestId:body.requestId,originalSections,originalSpec:copy(r.spec),requiresEditScope:!!r.target};restoreReader(r,job);
  r.revision++;r.error=null;r.planning=null;r.requests.push({id:body.requestId,hash:sha(body)});r.messages.push({id:body.requestId,role:'user',text:body.text,revision:r.revision});r.source={releaseId:source.id,knowledgeVersion:source.knowledgeVersion,skillId:r.skillId||LANDING_ID,skillVersion:source.skill.version,skillHash:source.skill.sha256};if(stagedJob(job))r.source.workflow=checkpoints.WORKFLOW;if(source.skill.generation&&((r.skillId||LANDING_ID)===LANDING_ID||stagedJob(job)))r.source.nativeEvidenceVersion=1;r.status='running';r.message='Читаем бриф и правила выбранного навыка…';r.spec.version=r.revision;
  for(const row of source.initial.norms||[]){const fact={releaseId:source.id,id:row.id,sha256:row.sha256,path:row.path,mode:row.mode,offset:row.offset};if(!r.sources.some(v=>sha(v)===sha(fact)))r.sources.push(fact);}save(r);
  jobs.set(id,job);return launch(r,job);
 }
 const preparationFor=(r,job)=>job.phase==='plan'&&job.source.skill.generation?checkpoints.preparationBudget(r.spec.sections,job.source.skill.generation):null;
 function planningProgress(r,job,prepared=false){
  const budget=preparationFor(r,job);if(!budget)return;
  r.planning={...budget,usedSteps:job.steps,remainingSteps:Math.max(0,budget.limit-job.steps),status:prepared?'prepared':'reading'};
  if(!prepared&&job.steps>=budget.limit){
   r.planning.status='budget-exhausted';
   const unresolved=(Array.isArray(r.spec.openSelections)?r.spec.openSelections:[]).filter(s=>typeof s==='string').slice(0,10).map(s=>s.slice(0,500));
   throw Object.assign(Error('LANDING_PREPARATION_BUDGET'),{code:'LANDING_PREPARATION_BUDGET',diagnostic:{stage:'landing-plan',modelStep:job.steps,planning:copy(r.planning),unresolved,lastOutput:job.lastOutput}});
  }
 }
 function prompt(r,job){const current=promptContext(r,job);job.visibleReads=new Set(current.resources.map(row=>row.address));return [
  'Use the selected packaged generation skill below. Create an editable Desktop layout in the existing Figma file. Business facts come only from the brief and confirmed user answers. Proposals are not approvals. Ask material questions, then build section by section and support scoped follow-up. Never require a user checkout or Python in this Proxy adapter.',
  'The host canvasContext is authoritative: create only in that current file and page using its placement. Never ask for a Figma URL, fileKey, pageId or node ancestry when canvasContext already supplies them. A pasted URL is brief text and cannot redirect this chat. Use the supplied read-only resource index; do not perform repository contribution, queue or authentication workflows.',
  stagedJob(job)?checkpoints.stagedPrompt(job.phase):job.phase==='plan'?'Return exactly one planning STEP with the complete specJson and stable section IDs. Batch required reads and reserve budget for bootstrap, each section and final verification. Persist selected components/presets, props/slots, assets and read sources before build.':'Return exactly one WRITE_STEP. The complete accepted spec is owned and persisted by Proxy: treat it as read-only context and NEVER return specJson, a replacement spec, or copies of section metadata. Return only sectionPatch:null or {sectionId:execution.activeSectionId,nodeId:actualSectionRootId} for a section continue. Bootstrap, verify, resource reads and questions require sectionPatch:null. The host admits node IDs only after independent readback. Keep the existing checkpoint in resultJson for continue; finish returns only the result report. Generic skill instructions to return a full spec apply only to planning, not this write transport.',
  'list_resources matches ALL query words as path substrings (AND), with offset pagination; use one component path per search, not a list of alternative names. request_context can read all selected IDs in one step; the host yields between read batches. request_context reads only listed IDs; for JSON inspect keys before selecting a path/range. A resource error is a failed read, not source evidence: retain successful batch reads, read keys at error.availablePath and choose an observed key; never substitute an invented asset. Existing step/context/tool budgets still apply. Non-JSON offset/limit are character ranges; JSON arrays use item ranges. Use assetSources exact indexed IDs rather than guessing catalog path spellings. If a required asset category is unavailable, report that missing-resource gap as a question/limitation before build; do not search alternate names or guess component keys. Read the full mandatory norms and skill-selected sources through this reader.',
  'During a generation-profile active section you can persist a technical refinement without asking a business question: return continue with sectionPatch:null and resultJson={checkpoint:{sectionId,status:"partial",nextAction},technicalPatch:{sectionId,baseRevision,sources:[{id,sha256,path,offset,observation}],decision}}. Cite actually read resource ranges. baseRevision is the number of that section technicalDecisions. No MCP calls in this refinement turn. Host admits it only after an unchanged independent readback; the next turn can execute it. It is an append-only API/construction decision, never permission to alter business facts, text, CTA, section order, global host or unrelated sections; those changes require explicit replanning. After actual API inspection, continue.resultJson may carry apiObservations:[short literal findings] to retain them across passes; these are agent reports, not independent proof.',
  'question suspends for an actual user answer. build requests the owned canvas and independent readback; it does not execute a frozen ScreenSpec. After any bounded MCP work return continue or finish with actual IDs. Host independently rereads the canvas before the next write. finish includes resultJson with summary, checks (PASS/FAIL/UNKNOWN with evidence), issues and limits. No empty-root success, no guessed assets or claims of unobserved conformance. Ready=false.',
  stagedJob(job)?'':r.source?.nativeEvidenceVersion===1?'Generation-profile bootstrap must tag the actual CorporateContent instance role=host and its documented native Body SLOT role=body in apollolanding; keep spec.host.componentKey from a read source. Independent native evidence records keys, parent links, props, fonts, image hashes and modes. Before finish, obtain delivered screenshots for every section and the whole owned root using their exact node IDs, inspect them, and return visualReviews:[{scope:sectionId or "page",modelStep,callId,verdict:"PASS"|"FAIL"|"UNKNOWN",evidence}]. Match execution.screenshots. A URL or a completed screenshot call without an image is not visual evidence. Report critical norm checks with evidence and critical:true; explicitly mark noncritical unknowns. Missing images, failed/missing-font checks or critical UNKNOWN preserve the assembly as needs-verification, never as verified completion. Ready=false.':'',
  'After the host supplies an owned target, do not request build again: perform bounded MCP work and return continue/finish, or request_context for missing indexed data. The host treats repeated build as a readback-only continuation, not a new canvas or a new edit scope.',
  stagedJob(job)?'':'execution is host-owned: bootstrap creates/configures only the required host and page layout, with no section content; section permits only activeSectionId; verify is read-only and performs final structural/visual checks and screenshot. Work in small scripts, at most 2 MCP calls per turn, then return continue with resultJson={"checkpoint":{"sectionId":null or activeSectionId,"status":"partial" or "complete","nextAction":"specific remaining action"}}. A section can span multiple partial checkpoints. Do not create a later section or change confirmed other sections. Complete only with actual section nodeId; the host advances after independent readback. finish is allowed only in verify. Unknown outcomes and execution.lastIssue require inspecting existing nodes rather than replaying writes. Snapshot/sizing gaps remain FAIL/UNKNOWN, not success. Global budgets do not reset at checkpoints.',
  'Resource pages are bounded by serialized UTF-8 bytes. Follow the returned next offset, never requested offset+limit: a page may contain fewer items. next=null is end only for a successful read. For a single oversized item, read keys at availablePath and choose observed child fields. Already supplied resources/indexes are confirmed context: do not request them again. Use resourceFeedback and cached next cursors to make progress.',
  stagedJob(job)?'limits.preparation bounds only the short outline; future component/asset/API preparation belongs to its assigned unit after canvas creation.':'When limits.preparation is provided, it reserves build, bootstrap, each declared section, final verification and two partial/recovery turns within the same24 model calls. Batch planning reads before its limit. A preparation boundary preserves the plan, confirmed reads and unresolved gap; it never authorizes a build with missing required sources or capabilities.',
  'For design-system JSONS/indexes component arrays, use mode=summary and path=["components"] to choose candidate names/categories first. This selection-only projection omits component keys and variant details: read a chosen entry in mode=read at its fullPath before selecting its published component/variant key. Summary is not available for normative documents and never replaces their full reading. A list_resources query may be a folder prefix, but a folder is never a readable resource. Copy exact file IDs from index.resources[].id and follow index.next for further search results; do not put the query prefix in resources. INDEX_PREFIX_NOT_RESOURCE feedback means that prefix was not read and supplies no source evidence.',
  'For a generation-profile plan, record sourceIds (exact read resource IDs) on each section. Proxy retains all reads; during section execution only these bodies and workflow reads are repeated. availableReads lists retained addresses; request_context can expose any needed read again. Historical indexes are metadata only; list_resources can reopen an exact index. Listing one exact Hub component folder automatically reads its Figma instructions, adapter, keys and cookbook in the same host step; other searches remain discovery only. Technical workflow bodies are deferred until execution.',
  'For a follow-up on an existing landing, spec.editSectionIds must declare the requested sections and necessary dependencies before build. Preserve the complete spec entries of other sections, their IDs and canvas content. Host compares their before/after fingerprints. A question is preferable to changing unrelated sections.',
  'When target exists, use only apollo_figma_mcp.use_figma/get_screenshot, exact target.fileKey. Resolve target.rootNodeId and require parent id==(target.parentNodeId||target.pageId), its containing page==target.pageId, shared namespace apollolanding owner==ownerNonce and active==leaseNonce before every mutation. Write only inside that root. Tag section roots section=<spec section id> in apollolanding. Preserve all other sections during follow-up. Unknown write outcome requires a canvas read before any more writes. Never delete roots or user content for cleanup. Source/library/global style and variable definitions are protected. Load fonts, use confirmed published keys and allowed typed public slots. Screenshots and actual readback are required for technical/visual claims; unavailable evidence remains UNKNOWN.',
  job.source.initial.hostInstructions||'',
  job.phase==='write'?'CONSTRUCTION_RECIPES='+constructionRecipes+'\nUse these recipes for narrowed source API reads, font loading and preserving intrinsic source-owned modes. Never copy resolvedVariableModes into explicit scene modes. compareMcpDefaults is the pristine default SLOT payload guard: replace only a proved untouched default in a fresh owned instance through its documented typed SLOT; append/verify replacement before removing that payload. It does not permit deletion for cleanup. Normative and visual checking remain enabled.':'',
  JSON.stringify({skill:job.source.initial.instructions,selectedSkill:job.source.initial.selectedSkill||null,norms:job.source.initial.norms,workflow:job.phase==='write'?job.source.initial.workflow:[],source:r.source,initialIndex:job.source.initial.resources,initialIndexes:job.source.initial.indexes||[],assetSources:job.source.initial.assetSources||null,index:job.lastList,...current,canvasContext:r.context,resourceFeedback:job.resourceFeedback||null,dialogue:r.messages,spec:r.spec,target:job.phase==='write'?r.target:null,readback:job.phase==='write'?r.readback:null,execution:job.phase==='write'?r.execution:null,limits:{modelStepsRemaining:modelLimit(job)-job.steps,modelStepsLimit:modelLimit(job),toolsRemaining:96-job.toolCalls,writeCallsPerTurn:2,writeSoftRuntimeMs:90000,preparation:preparationFor(r,job)}})
 ].join('\n');}
 async function execute(r,job){
  while(++job.steps<=modelLimit(job)){
   assertJob(r,job);const preparing=preparationFor(r,job);if(preparing)r.planning={...preparing,usedSteps:job.steps,remainingSteps:Math.max(0,preparing.limit-job.steps),status:'reading'};
   const directory=path.join(root,'work',r.id),trace=path.join(root,'traces',r.id);fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(trace,{recursive:true});
   job.lastOutput=null;job.resourceRequest=null;job.passSpec=copy(r.spec.sections);
   if(job.phase==='write'){checkpoints.assertPrepared(r.spec,r.execution);job.recordStage=r.execution.stage;r.execution.status='running';r.execution.elapsedMs=0;r.execution.toolCalls=0;job.passStarted=readNow();r.message=unitMessage(r.execution)+'…';save(r);}
   const cli=createCli(r.context.fileKey),schema=job.phase==='write'?WRITE_STEP:STEP;let out;
   for(let retry=0;;retry++){
    assertJob(r,job);const text=prompt(r,job);budget({prompt:text,schema,outputReserveChars:196608});
    try{
     out=await cli.run({workspace:directory,traceDirectory:trace,profile:job.phase==='write'&&!preparationUnit(job)?'landing-figma':'landing-plan',prompt:text,schema,signal:job.controller.signal,mcpBudget:{maxToolCalls:Math.min(job.phase==='write'?4:24,96-job.toolCalls),maxTotalToolOutputBytes:16*1024*1024},checkpointBudget:job.phase==='write'&&!preparationUnit(job)?{maxCompletedCalls:3,softRuntimeMs:90000}:null,onEvent:event=>{
      if(job.phase!=='write'||jobs.get(r.id)!==job||job.controller.signal.aborted||event.item?.type!=='mcp_tool_call'||!['item.started','item.completed'].includes(event.type))return;
      if(event.type==='item.started'&&event.item.tool==='use_figma')for(const old of r.execution.screenshots||[])if(old.modelStep===job.steps&&!old.readbackHash)old.superseded=true;
      const shot=evidence.screenshot(event,r.execution,job.steps);if(shot)r.execution.screenshots=(r.execution.screenshots||[]).concat(shot).slice(-96);
      r.execution.operation=['use_figma','get_screenshot'].includes(event.item.tool)?'mcp.'+event.item.tool:null;r.execution.callId=typeof event.item.id==='string'?event.item.id.slice(0,120):null;r.execution.elapsedMs=Math.max(0,readNow()-job.passStarted);if(event.type==='item.started')r.execution.toolCalls++;
      r.message=`${unitMessage(r.execution)} · ${Math.round(r.execution.elapsedMs/1000)} с`;save(r);
     },diagnosticContext:{requestId:job.requestId,runId:r.id,stage:'landing-'+job.phase,modelStep:job.steps,rootNodeId:r.target?.rootNodeId||null,sectionId:job.phase==='write'?r.execution.activeSectionId:null,executionStage:job.phase==='write'?r.execution.stage:null}});break;
    }catch(error){
     if(job.phase==='write'&&(error.code==='AGENT_CHECKPOINT_REQUIRED'||error.code==='AGENT_TIMEOUT'&&error.usage?.toolCalls>0)){
      try{assertJob(r,job);}catch(guard){guard.usage=error.usage;throw guard;}if(error.usage)r.usage.push(error.usage);job.toolCalls+=error.usage?.toolCalls||0;if(job.toolCalls>96)fail('LANDING_TOOL_BUDGET');
      r.execution.status='awaiting-readback';r.execution.elapsedMs=Math.max(0,readNow()-job.passStarted);r.execution.lastIssue={code:error.code,diagnostic:error.diagnostic||null,nativeFailures:error.nativeFailures||[],nativeFailure:error.nativeFailure||null};r.execution.nextAction='Inspect the independent readback and actual public API after the observed error; never replay blindly or repeat unsupported variant values.';
      r.failures=r.failures||[];r.failures.push({revision:r.revision,at:new Date(readNow()).toISOString(),error:{code:error.code,diagnostic:error.diagnostic||null}});job.pending={kind:'continue',checkpoint:null,recovery:true};r.status='awaiting-readback';r.message='Проход остановлен. Перечитываем сохранённую секцию перед продолжением…';save(r);return;
     }
     // Only the tool-free planner can be replayed without a fresh canvas read.
     if(error.code!=='AGENT_MODEL_CAPACITY'||job.phase!=='plan'||retry>=2||job.steps>=modelLimit(job)||job.steps>=(preparationFor(r,job)?.limit??modelLimit(job))||job.controller.signal.aborted||jobs.get(r.id)!==job)throw error;
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
   if(!exact(step,Object.keys(schema.properties))||!schema.properties.kind.enum.includes(step.kind)||typeof step.message!=='string'||step.message.length>12000||!Array.isArray(step.resources))fail('LANDING_STEP_INVALID',502);
   const patch=job.phase==='write'?checkpoints.sectionPatch(r.execution,step.kind,step.sectionPatch):null;
   const spec=job.phase==='write'?copy(r.spec):json(step.specJson);if(!Array.isArray(spec.sections)||spec.sections.length>100||new Set(spec.sections.map(s=>s?.id)).size!==spec.sections.length||spec.sections.some(s=>!s||typeof s.id!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(s.id)))fail('LANDING_SPEC_INVALID',502);
   if(job.phase==='write')checkpoints.specScope(r.execution,job.passSpec,spec.sections);
   if(job.allowedSections&&job.originalSections.some(old=>!job.allowedSections.has(old.id)&&!equal(old,spec.sections.find(section=>section.id===old.id))))fail('LANDING_EDIT_SCOPE_INVALID',502);
   spec.target=Object.assign({},spec.target,{fileKey:r.context.fileKey,pageId:r.context.pageId,rootNodeId:r.target?.rootNodeId||null});if(r.context.placement)spec.target.placement=copy(r.context.placement);
   spec.version=r.revision;r.spec=spec;r.message=step.message;job.toolCalls+=out.receipt?.mcp?.toolCalls||0;if(job.toolCalls>96)fail('LANDING_TOOL_BUDGET');save(r);
   if(job.phase==='write'&&!['continue','finish','build'].includes(step.kind)&&(out.receipt?.mcp?.toolCalls||0)>0)fail('LANDING_READBACK_REQUIRED');
   let indexPrefixFeedback=null;
   if(step.kind==='list_resources'){
    const list=job.source.list(step.query,step.offset),address=JSON.stringify([step.query,step.offset]),previous=job.queries.get(address);
    const repeats=previous&&previous.readVersion===job.readVersion?previous.repeats+1:1;
    job.queries.set(address,{readVersion:job.readVersion,repeats});job.lastList=list;
    const at=job.indexes.findIndex(row=>row.query===step.query&&row.offset===step.offset);if(at<0)job.indexes.push(list);else job.indexes[at]=list;
    if(repeats>=3)throw Object.assign(Error('LANDING_NO_PROGRESS'),{code:'LANDING_NO_PROGRESS',diagnostic:{stage:'landing-'+job.phase,query:step.query,offset:step.offset,total:list.total,repeatedQueries:repeats}});
    if(job.source.skill.generation){
     const unread=step.resources.filter(request=>isIndexPrefix(list,request));
     if(unread.length){indexPrefixFeedback={code:'INDEX_PREFIX_NOT_RESOURCE',unreadIds:[...new Set(unread.map(request=>request.id))],hint:'The search prefix is not a file and was not read. Select exact IDs from index.resources[].id; use index.next to list the next page.'};job.resourceFeedback=indexPrefixFeedback;}
     step.resources=step.resources.filter(request=>!isIndexPrefix(list,request)).concat(componentRequests(list));
    }
    if(!step.resources.length){readerState(r,job);save(r);planningProgress(r,job);continue;}
   }
   if(step.kind==='request_context'||step.kind==='list_resources'){
    if(!step.resources.length)fail('LANDING_RESOURCE_INVALID');
    const before=job.readVersion;let cached=0,deferred=0;const requests=step.resources.slice();const automatic=step.kind==='list_resources'&&job.source.skill.generation;
    let exposed=false;
    for(let i=0;i<requests.length;i++){
     const request=requests[i];if(job.phase==='plan'&&job.source.skill.generation&&(request.id.startsWith('workflow/')||stagedJob(job)&&!request.id.startsWith('skills/')&&!job.source.initial.norms.some(row=>row.id===request.id))){deferred++;continue;}job.resourceRequest={index:i,id:typeof request?.id==='string'?request.id.slice(0,512):null};assertJob(r,job);const address=sha(request),previous=job.readRequests.get(address),row=previous?.row||job.source.read(request);if(previous){cached++;exposed=!!job.source.skill.generation&&!previous.row.error&&!previous.row.tooLarge&&!!job.visibleReads&&!job.visibleReads.has(JSON.stringify([previous.row.id,previous.row.path,previous.row.mode,previous.row.offset]))||exposed;}else job.readRequests.set(address,{request:copy(request),row});
     rememberRead(job,row);if(job.phase==='write'&&job.source.skill.generation){const active=r.execution.activeSectionId?r.spec.sections.find(s=>s.id===r.execution.activeSectionId):stagedJob(job)?(r.spec.foundation||=( {sourceIds:[]} )):null;if(active&&Array.isArray(active.sourceIds)&&!active.sourceIds.includes(row.id)&&!row.error&&!row.tooLarge)active.sourceIds.push(row.id);}
     if(automatic&&row.next!==null&&row.next!==undefined&&!row.error&&!row.tooLarge)requests.push({...request,offset:row.next});const fact={releaseId:job.source.id,id:row.id,sha256:row.sha256,path:row.path,mode:row.mode,offset:row.offset};if(!row.error&&!row.tooLarge&&!r.sources.some(v=>sha(v)===sha(fact)))r.sources.push(fact);
     if(Buffer.byteLength(JSON.stringify(job.context))>524288)fail('LANDING_CONTEXT_FULL');
     // Yield for Stop/source freshness; eight is a scheduling slice, not an item cap.
     if((i+1)%8===0&&i+1<requests.length){readerState(r,job);save(r);await new Promise(resolve=>setImmediate(resolve));}
    }
    job.noProgressReads=job.readVersion===before&&!exposed?job.noProgressReads+1:0;
    job.resourceFeedback={code:job.readVersion===before?'ALREADY_READ_OR_FAILED':'CONTEXT_UPDATED',cached,deferredToExecution:deferred,consecutiveNoProgress:job.noProgressReads};
    if(indexPrefixFeedback)job.resourceFeedback.indexPrefixes=indexPrefixFeedback;
    job.resourceRequest=null;readerState(r,job);save(r);
    if(job.noProgressReads>=3)throw Object.assign(Error('LANDING_NO_PROGRESS'),{code:'LANDING_NO_PROGRESS',diagnostic:{stage:'landing-'+job.phase,repeatedRequests:job.noProgressReads,resourceFeedback:job.resourceFeedback,lastOutput:job.lastOutput}});
    planningProgress(r,job);
    continue;
   }
   if(step.kind==='question'){if(job.phase==='write'&&(out.receipt?.mcp?.toolCalls||0)>0)fail('LANDING_READBACK_REQUIRED');r.status='needs-input';r.messages.push({id:'answer:'+crypto.randomUUID(),role:'assistant',text:step.message,revision:r.revision});save(r);jobs.delete(r.id);return;}
   if(step.kind==='build'){
    if(!spec.sections.length)fail('LANDING_SPEC_INVALID',502);
    if(stagedJob(job)){
     if(!Array.isArray(spec.facts)||new Set(spec.facts.map(f=>f?.id)).size!==spec.facts.length||spec.facts.some(f=>!f||typeof f.id!=='string'||!/^[-a-zA-Z0-9_]{1,120}$/.test(f.id))||spec.sections.some(section=>typeof section.role!=='string'||!section.role.trim()||!section.contentShape||typeof section.contentShape!=='object'||Array.isArray(section.contentShape)))fail('LANDING_SPEC_INVALID',502);
     if(Array.isArray(spec.questions)&&spec.questions.some(q=>q?.status==='open'))fail('LANDING_BRIEF_UNRESOLVED');
    }
    if(stagedJob(job)&&job.steps>(preparationFor(r,job)?.limit??6))fail('LANDING_PREPARATION_BUDGET');planningProgress(r,job,true);
    if(job.requiresEditScope){
     const normalized=value=>{const {version,target,...rest}=value;return rest;};
     const continuing=stagedJob(job)&&r.execution?.workflow===checkpoints.WORKFLOW&&r.execution.sourcePin===readerPin(job.source)&&r.execution.status!=='completed'&&equal(normalized(job.originalSpec),normalized(spec));
     const allowed=continuing?r.execution.queue:spec.editSectionIds;if(!Array.isArray(allowed)||!allowed.length||new Set(allowed).size!==allowed.length||allowed.some(id=>!job.originalSections.concat(spec.sections).some(s=>s.id===id))||job.originalSections.some(old=>!allowed.includes(old.id)&&!equal(old,spec.sections.find(section=>section.id===old.id))))fail('LANDING_EDIT_SCOPE_INVALID',502);
     if(job.allowedSections&&!equal([...job.allowedSections].sort(),allowed.slice().sort()))fail('LANDING_EDIT_SCOPE_INVALID',502);
     job.allowedSections=new Set(allowed);
    }
    if(job.phase==='write'&&r.target){job.pending={...step,kind:'continue'};r.status='awaiting-readback';r.message='Перечитываем созданную область перед продолжением…';save(r);return;}
    r.status='awaiting-canvas';r.message=step.message||'Готовим область для лендинга…';job.phase='write';save(r);return;
   }
   if(job.phase!=='write'||!r.target)fail('LANDING_CANVAS_REQUIRED');
   if(!['continue','finish'].includes(step.kind))fail('LANDING_STEP_INVALID',502);
   const result=json(step.resultJson),point=checkpoints.checkpoint(r.execution,step.kind,result);
   if(preparationUnit(job)&&(out.receipt?.mcp?.toolCalls||0))fail('LANDING_PREPARATION_CANVAS_CHANGED');
   const prepared=checkpoints.preparationPatch(r.execution,result,point,patch,job.context.concat(job.source.initial.norms||[]),out.receipt?.mcp?.toolCalls||0);
   const technical=job.source.skill.generation?checkpoints.refinement(r.execution,result,point,patch,job.context.concat(job.source.initial.norms||[]),out.receipt?.mcp?.toolCalls||0):null;
   if(!job.source.skill.generation&&Object.hasOwn(result,'technicalPatch'))fail('LANDING_TECHNICAL_PATCH_INVALID');
   job.pending={...step,sectionPatch:patch,checkpoint:point,preparationPatch:prepared,technicalPatch:technical,apiObservations:checkpoints.apiObservations(result)};r.execution.status='awaiting-readback';r.execution.elapsedMs=Math.max(0,readNow()-job.passStarted);r.status='awaiting-readback';r.message='Проверяем фактический результат в Figma…';save(r);return;
  }
  fail('LANDING_STEP_BUDGET');
 }
 function canvas(id,body){
  const r=load(id),job=jobs.get(id);if(!job||r.status!=='awaiting-canvas'||!exact(body,['revision','target','readback'])||body.revision!==r.revision)fail('LANDING_REVISION_STALE');try{assertJob(r,job);}catch(error){stopped(r,job,error);throw error;}
  const t=body.target;if(!(exact(t,['fileKey','pageId','rootNodeId','ownerNonce','leaseNonce'])||exact(t,['fileKey','pageId','rootNodeId','ownerNonce','leaseNonce','parentNodeId'])&&node(t.parentNodeId))||r.context.placement&&(!t.parentNodeId||r.context.placement.mode==='section'&&t.parentNodeId!==r.context.placement.sectionId)||!key(t.fileKey)||t.pageId!==r.context.pageId||!node(t.rootNodeId)||![t.ownerNonce,t.leaseNonce].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||r.context.fileKey&&r.context.fileKey!==t.fileKey||r.target&&['pageId','rootNodeId','ownerNonce','parentNodeId'].some(k=>r.target[k]!==t[k]))fail('LANDING_CANVAS_INVALID',400);
  validateReadback(body.readback,t);if(r.source.nativeEvidenceVersion===1&&!body.readback.native)fail('LANDING_NATIVE_EVIDENCE_REQUIRED');r.target=copy(t);r.context.fileKey=t.fileKey;r.readback=copy(body.readback);job.baseline=copy(body.readback);r.execution=checkpoints.start(r,readerPin(job.source),job.allowedSections);r.status='running';save(r);return launch(r,job);
 }
 function observation(id,body){
  const r=load(id),job=jobs.get(id);if(!job||r.status!=='awaiting-readback'||!exact(body,['revision','readback'])||body.revision!==r.revision)fail('LANDING_REVISION_STALE');
  try{assertJob(r,job);validateReadback(body.readback,r.target);if(r.source.nativeEvidenceVersion===1&&!body.readback.native)fail('LANDING_NATIVE_EVIDENCE_REQUIRED');
  if(body.readback.outsideHash!==job.baseline.outsideHash||job.allowedSections&&job.baseline.sections.some(old=>!job.allowedSections.has(old.sectionId)&&!body.readback.sections.some(row=>row.id===old.id&&row.fingerprint===old.fingerprint))){const error=Object.assign(Error('LANDING_UNREQUESTED_CONTENT_CHANGED'),{code:'LANDING_UNREQUESTED_CONTENT_CHANGED'});stopped(r,job,error);throw error;}
  checkpoints.protect(r.execution,job.baseline,body.readback);
  if(job.pending.technicalPatch)r.spec=checkpoints.refine(r.spec,r.execution,job.pending.technicalPatch,job.baseline,body.readback);
  if(job.pending.apiObservations?.length)r.execution.apiObservations=(r.execution.apiObservations||[]).concat({modelStep:job.steps,sectionId:r.execution.activeSectionId,sourcePin:r.execution.sourcePin,readbackHash:sha(body.readback),origin:'agent-report',findings:job.pending.apiObservations}).slice(-24);
  const preparedSpec=checkpoints.confirmPreparation(r.spec,r.execution,job.pending.preparationPatch,job.baseline,body.readback);
  let confirmedSpec=checkpoints.confirmPatch(preparedSpec,job.pending.sectionPatch||null,body.readback);
  if(job.pending.recovery&&r.execution.activeSectionId){const row=body.readback.sections.find(s=>s.sectionId===r.execution.activeSectionId);if(row)confirmedSpec=checkpoints.confirmPatch(r.spec,{sectionId:row.sectionId,nodeId:row.id},body.readback);}
  if(job.pending.kind!=='finish')checkpoints.observed(r.execution,job.baseline,body.readback,job.pending.checkpoint||null,confirmedSpec,readNow());
  for(const shot of r.execution.screenshots||[])if(!shot.readbackHash){shot.readbackHash=sha(body.readback);shot.nativeHash=evidence.renderHash(body.readback,shot.nodeId);shot.fingerprints=Object.fromEntries(body.readback.sections.map(s=>[s.id,s.fingerprint]));}
  r.spec=confirmedSpec;r.readback=copy(body.readback);job.baseline=copy(body.readback);
  if(job.pending.kind==='finish'){
   const rows=r.readback.sections;if(!r.spec.sections.length||!stagedJob(job)&&r.readback.instanceCount<1||r.spec.sections.some(section=>!rows.some(row=>row.sectionId===section.id&&row.id===section.nodeId)))fail('LANDING_RESULT_INCOMPLETE');
   const result=json(job.pending.resultJson),verification=r.source.nativeEvidenceVersion===1?evidence.assess(r,result):null;r.result={...result,revision:r.revision,figmaUrl:'https://www.figma.com/design/'+r.target.fileKey+'/Apollo?node-id='+encodeURIComponent(r.target.rootNodeId),rootNodeId:r.target.rootNodeId,Ready:false,checks:(Array.isArray(result.checks)?result.checks:[]).map(check=>({...check,origin:'agent-report'})),readbackHash:sha(r.readback)};if(verification)r.result.verification=verification;r.execution.status='completed';r.status=verification&&!verification.complete?'needs-verification':'completed';r.execution.status=r.status;r.message=r.status==='needs-verification'?'Макет собран. Проверки пока неполные; ограничения и доказательства сохранены в подробностях.':job.pending.message;r.messages.push({id:'answer:'+crypto.randomUUID(),role:'assistant',text:r.message,revision:r.revision});save(r);jobs.delete(id);return view(r);
  }
  job.pending=null;r.status='running';save(r);return launch(r,job);
  }catch(error){stopped(r,job,error);throw error;}
 }
 function validateReadback(v,t){if(!v||!exact(v,['rootNodeId','pageId','ownerNonce','leaseNonce','outsideHash','nodeCount','instanceCount','sections','text','coverage'].concat(Object.hasOwn(v||{},'native')?['native']:[]))||['rootNodeId','pageId','ownerNonce','leaseNonce'].some(k=>v[k]!==t[k])||!/^([a-f0-9]{64})$/.test(v.outsideHash||'')||!Number.isSafeInteger(v.nodeCount)||v.nodeCount<1||!Number.isSafeInteger(v.instanceCount)||v.instanceCount<0||!Array.isArray(v.sections)||v.sections.length>100||new Set(v.sections.map(row=>row?.id)).size!==v.sections.length||new Set(v.sections.map(row=>row?.sectionId)).size!==v.sections.length||v.sections.some(row=>!row||!node(row.id)||typeof row.sectionId!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(row.sectionId)||!/^([a-f0-9]{64})$/.test(row.fingerprint||''))||typeof v.text!=='string'||v.text.length>64000||v.coverage!=='tagged-sections-and-text'||Buffer.byteLength(JSON.stringify(v))>262144)fail('LANDING_READBACK_INVALID',400);evidence.validateNative(v,t);}
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
module.exports={createLandingService,mountLandingRoutes,STEP,WRITE_STEP};
