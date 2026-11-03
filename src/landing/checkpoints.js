'use strict';
const crypto=require('node:crypto'),equal=require('node:util').isDeepStrictEqual;
const SCHEMA='apollo.landing-checkpoints.v1';
const WORKFLOW=require('../skills/catalog').STAGED_WORKFLOW,STAGED_SCHEMA='apollo.landing-checkpoints.v2';
const staged=state=>state?.workflow===WORKFLOW;
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
function preparationBudget(sections,profile){
 if(profile?.workflow===WORKFLOW){const reservedSteps=3*sections.length+5;return {sectionCount:sections.length,recoverySteps:2,reservedSteps,modelLimit:48,limit:Math.max(0,Math.min(6,48-reservedSteps))};}
 if(!sections.length)return null;
 const recoverySteps=2,reservedSteps=sections.length+3+recoverySteps;
 return {sectionCount:sections.length,recoverySteps,reservedSteps,limit:Math.max(0,24-reservedSteps)};
}
function start(record,sourcePin,allowedSections){
 if(staged(record.source))return stagedStart(record,sourcePin,allowedSections);
 const queue=record.spec.sections.filter(s=>!allowedSections||allowedSections.has(s.id)).map(s=>s.id);
 const previous=record.execution,compatible=previous?.schemaVersion===SCHEMA&&previous.status!=='completed'&&previous.sourcePin===sourcePin&&previous.rootNodeId===record.target.rootNodeId&&previous.ownerNonce===record.target.ownerNonce&&equal(previous.queue,queue);
 const completed=compatible?(previous.completed||[]).filter(old=>old.specHash===sha(record.spec.sections.find(s=>s.id===old.sectionId))&&record.readback.sections.some(row=>row.sectionId===old.sectionId&&row.id===old.id&&row.fingerprint===old.fingerprint)):[];
 // A resumed incomplete root is inspected by the worker; it is never recreated.
 const stage=compatible&&previous.stage!=='bootstrap'?'section':'bootstrap';
 const activeSectionId=stage==='section'?queue.find(id=>!completed.some(row=>row.sectionId===id))||null:null;
 return {schemaVersion:SCHEMA,sourcePin,rootNodeId:record.target.rootNodeId,ownerNonce:record.target.ownerNonce,queue,completed,stage:stage==='section'&&!activeSectionId?'verify':stage,activeSectionId,status:'ready',lastCheckpoint:compatible?previous.lastCheckpoint:null,apiObservations:compatible?previous.apiObservations||[]:[],screenshots:compatible?previous.screenshots||[]:[],operation:null,callId:null,elapsedMs:0,toolCalls:0,recoveriesWithoutProgress:0,nextAction:'Inspect the current root and resume only the assigned work unit.'};
}
function protect(state,before,after){
 if(staged(state))return stagedProtect(state,before,after);
 const active=state.stage==='section'?state.activeSectionId:null;
 if(state.stage!=='bootstrap'&&before.native&&after.native){
  const stable=row=>{const value={...row};for(const key of ['x','y','width','height'])delete value[key];return value;};
  if(before.native.nodes.some(old=>old.sectionId!==active&&!after.native.nodes.some(row=>row.id===old.id&&equal(stable(old),stable(row))))||after.native.nodes.some(row=>!before.native.nodes.some(old=>old.id===row.id)&&row.sectionId!==active))fail('LANDING_SECTION_SCOPE_CHANGED');
 }
 if(before.sections.some(old=>old.sectionId!==active&&!after.sections.some(row=>row.sectionId===old.sectionId&&row.id===old.id&&row.fingerprint===old.fingerprint))||after.sections.some(row=>!before.sections.some(old=>old.sectionId===row.sectionId)&&row.sectionId!==active))fail('LANDING_SECTION_SCOPE_CHANGED');
}
function specScope(state,before,after){
 if(!equal(before.map(s=>s.id),after.map(s=>s.id))||before.some(old=>old.id!==state.activeSectionId&&!equal(old,after.find(s=>s.id===old.id))))fail('LANDING_SECTION_SCOPE_CHANGED');
}
function sectionPatch(state,kind,patch){
 if(patch===null)return null;
 if(kind!=='continue'||state.stage!==(staged(state)?'structure':'section')||!patch||typeof patch!=='object'||Array.isArray(patch)||!equal(Object.keys(patch).sort(),['sectionId','nodeId'].sort())||patch.sectionId!==state.activeSectionId||typeof patch.nodeId!=='string'||!/^[a-zA-Z0-9:;_-]{1,512}$/.test(patch.nodeId))fail('LANDING_SECTION_PATCH_INVALID');
 return {sectionId:patch.sectionId,nodeId:patch.nodeId};
}
function confirmPatch(spec,patch,readback){
 if(!patch)return spec;
 if(!readback.sections.some(row=>row.sectionId===patch.sectionId&&row.id===patch.nodeId))fail('LANDING_SECTION_PATCH_UNCONFIRMED');
 return {...spec,sections:spec.sections.map(section=>section.id===patch.sectionId?{...section,nodeId:patch.nodeId}:section)};
}
function refinement(state,result,point,patch,reads,toolCalls){
 const value=result.technicalPatch;
 if(value===undefined)return null;
 const active=(state.stage==='section'||staged(state)&&['structure','content'].includes(state.stage))&&state.activeSectionId;
 if(!active||patch||point?.status!=='partial'||toolCalls||!value||!equal(Object.keys(value).sort(),['sectionId','baseRevision','sources','decision'].sort())||value.sectionId!==active||!Number.isSafeInteger(value.baseRevision)||value.baseRevision<0||typeof value.decision!=='string'||!value.decision.trim()||value.decision.length>2000||!Array.isArray(value.sources)||!value.sources.length||value.sources.length>8)fail('LANDING_TECHNICAL_PATCH_INVALID');
 for(const source of value.sources){
  if(!source||!equal(Object.keys(source).sort(),['id','sha256','path','offset','observation'].sort())||typeof source.observation!=='string'||!source.observation.trim()||source.observation.length>1500||!reads.some(row=>!row.error&&!row.tooLarge&&row.mode==='read'&&typeof row.text==='string'&&row.id===source.id&&row.sha256===source.sha256&&equal(row.path,source.path)&&row.offset===source.offset))fail('LANDING_TECHNICAL_SOURCE_UNCONFIRMED');
 }
 return value;
}
function refine(spec,state,patch,before,after){
 if(sha(before)!==sha(after))fail('LANDING_TECHNICAL_CANVAS_CHANGED');
 const section=spec.sections.find(s=>s.id===state.activeSectionId),revision=section.technicalDecisions?.length||0;
 if(patch.baseRevision!==revision)fail('LANDING_TECHNICAL_REVISION_STALE');
 // This append-only technical decision cannot replace story, slots, facts or another section.
 return {...spec,sections:spec.sections.map(s=>s.id!==section.id?s:{...s,technicalDecisions:(s.technicalDecisions||[]).concat({revision:revision+1,sourcePin:state.sourcePin,readbackHash:sha(after),origin:'agent-source-interpretation',decision:patch.decision,sources:patch.sources})})};
}
function apiObservations(result){
 const rows=result.apiObservations;
 if(rows===undefined)return [];
 if(!Array.isArray(rows)||rows.length>8||rows.some(row=>typeof row!=='string'||!row.trim()||row.length>1500))fail('LANDING_API_OBSERVATIONS_INVALID');
 return rows;
}
function checkpoint(state,step,result){
 if(step==='finish'){if(state.stage!=='verify')fail('LANDING_CHECKPOINT_REQUIRED');return null;}
 const point=result.checkpoint;
 if(!point||!equal(Object.keys(point).sort(),['sectionId','status','nextAction'].sort())||point.sectionId!==(staged(state)?state.activeSectionId:state.stage==='section'?state.activeSectionId:null)||!['partial','complete'].includes(point.status)||typeof point.nextAction!=='string'||point.nextAction.length>1000)fail('LANDING_CHECKPOINT_INVALID');
 return point;
}
function observed(state,before,after,point,spec,now){
 if(staged(state))return stagedObserved(state,before,after,point,spec,now);
 const unit={stage:state.stage,sectionId:state.activeSectionId,operation:state.operation,elapsedMs:state.elapsedMs,toolCalls:state.toolCalls};
 protect(state,before,after);
 const progressed=sha(before)!==sha(after);
 if(!point){state.recoveriesWithoutProgress=progressed?0:state.recoveriesWithoutProgress+1;if(state.recoveriesWithoutProgress>=3)fail('LANDING_NO_PROGRESS');}
 else{
  state.recoveriesWithoutProgress=0;state.nextAction=point.nextAction;
  if(point.status==='complete'){
   if(state.stage==='section'){
    const section=spec.sections.find(s=>s.id===state.activeSectionId),row=after.sections.find(s=>s.sectionId===state.activeSectionId&&s.id===section?.nodeId);if(!row)fail('LANDING_RESULT_INCOMPLETE');
    state.completed.push({...row,specHash:sha(section)});
   }
   state.activeSectionId=state.queue.find(id=>!state.completed.some(s=>s.sectionId===id))||null;state.stage=state.activeSectionId?'section':'verify';
  }
 }
 state.lastCheckpoint={...unit,atUtc:new Date(now).toISOString(),readbackHash:sha(after),sectionIds:after.sections.map(s=>s.sectionId),complete:point?.status==='complete'};state.status='ready';state.operation=null;state.callId=null;
 return state;
}
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&equal(Object.keys(value).sort(),keys.slice().sort());
const nodeDescriptor=(value,role=false)=>exact(value,role?['role','type','componentKey']:['type','componentKey'])&&['FRAME','INSTANCE','SLOT'].includes(value.type)&&(value.type==='INSTANCE'?/^[a-f0-9]{40}$/.test(value.componentKey||''):value.componentKey===null)&&(!role||typeof value.role==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(value.role));
const matchesNode=(node,descriptor)=>node&&descriptor&&node.type===descriptor.type&&(descriptor.type!=='INSTANCE'||node.componentKey===descriptor.componentKey||node.componentSetKey===descriptor.componentKey);
const matchesProps=(node,props)=>Object.entries(props).every(([name,value])=>{const actual=node?.componentProperties?.[name];return actual!==undefined&&actual?.type!=='TEXT'&&equal(actual&&typeof actual==='object'&&Object.hasOwn(actual,'value')?actual.value:actual,value);});
function foundationNodes(spec,readback){
 const plan=spec.foundation?.plan?.decision,nodes=readback.native?.nodes||[];
 if(!plan)return null;
 const containers=nodes.filter(n=>n.role===plan.container.role),mounts=nodes.filter(n=>n.role===plan.mount.role),byId=new Map(nodes.map(n=>[n.id,n]));
 const descendant=(child,parent)=>{for(let n=child;n;n=byId.get(n.parentId))if(n.id===parent.id)return true;return false;};
 const container=containers[0],mount=mounts[0],root=byId.get(readback.rootNodeId);
 if(containers.length!==1||mounts.length!==1||!matchesNode(container,plan.container)||!matchesNode(mount,plan.mount)||!root||!descendant(container,root)||!descendant(mount,container))return null;
 return {container,mount,descendant,byId};
}
function preparationPatch(state,result,point,binding,reads,toolCalls){
 const value=result.preparationPatch;
 if(value===undefined)return null;
 if(!staged(state)||!state.stage.startsWith('prepare-')||toolCalls||binding||point?.status!=='complete'||!exact(value,['stage','sectionId','baseRevision','sources','decision'])||value.stage!==state.stage||value.sectionId!==state.activeSectionId||!Number.isSafeInteger(value.baseRevision)||value.baseRevision<0||!Array.isArray(value.sources)||!value.sources.length||value.sources.length>24)fail('LANDING_PREPARATION_PATCH_INVALID');
 for(const source of value.sources)if(!exact(source,['id','sha256','path','offset','observation'])||typeof source.observation!=='string'||!source.observation.trim()||source.observation.length>1500||!reads.some(row=>!row.error&&!row.tooLarge&&row.mode==='read'&&typeof row.text==='string'&&row.id===source.id&&row.sha256===source.sha256&&equal(row.path,source.path)&&row.offset===source.offset))fail('LANDING_PREPARATION_SOURCE_UNCONFIRMED');
 const d=value.decision,observedKey=(key,id=null,selectedPath=null)=>value.sources.some(source=>(id===null||source.id===id&&equal(source.path,selectedPath))&&reads.some(row=>row.id===source.id&&row.sha256===source.sha256&&equal(row.path,source.path)&&row.offset===source.offset&&row.mode==='read'&&typeof row.text==='string'&&row.text.includes(key)));
 if(state.stage==='prepare-foundation'){
  if(!exact(d,['container','mount','layout'])||!nodeDescriptor(d.container,true)||!nodeDescriptor(d.mount,true)||!d.layout||typeof d.layout!=='object'||Array.isArray(d.layout))fail('LANDING_PREPARATION_PATCH_INVALID');
  if([d.container,d.mount].some(node=>node.componentKey&&!observedKey(node.componentKey)))fail('LANDING_PREPARATION_SOURCE_UNCONFIRMED');
 }else if(state.stage==='prepare-structure'){
  if(!exact(d,['root','props','slots','layout'])||!nodeDescriptor(d.root)||!d.props||typeof d.props!=='object'||Array.isArray(d.props)||!Array.isArray(d.slots)||d.slots.length>64||d.slots.some(s=>typeof s!=='string'||s.length>400)||!d.layout||typeof d.layout!=='object'||Array.isArray(d.layout))fail('LANDING_PREPARATION_PATCH_INVALID');
  if(d.root.componentKey&&!observedKey(d.root.componentKey))fail('LANDING_PREPARATION_SOURCE_UNCONFIRMED');
 }else if(state.stage==='prepare-content'){
  if(!exact(d,['texts','assets'])||!Array.isArray(d.texts)||d.texts.length>64||!Array.isArray(d.assets)||d.assets.length>32||d.texts.some(t=>!exact(t,['target','value','factIds'])||typeof t.target!=='string'||!t.target||t.target.length>400||typeof t.value!=='string'||t.value.length>4000||!Array.isArray(t.factIds)||t.factIds.some(id=>typeof id!=='string'))||d.assets.some(a=>!exact(a,['target','kind','key','resourceId','path'])||typeof a.target!=='string'||!a.target||a.target.length>400||!['component','image'].includes(a.kind)||!/^[-\w]{1,128}$/.test(a.key||'')||!value.sources.some(s=>s.id===a.resourceId&&equal(s.path,a.path))))fail('LANDING_PREPARATION_PATCH_INVALID');
  if(d.assets.some(asset=>!observedKey(asset.key,asset.resourceId,asset.path)))fail('LANDING_PREPARATION_SOURCE_UNCONFIRMED');
 }else fail('LANDING_PREPARATION_PATCH_INVALID');
 return value;
}
function confirmPreparation(spec,state,patch,before,after){
 if(!patch)return spec;
 if(sha(before)!==sha(after))fail('LANDING_PREPARATION_CANVAS_CHANGED');
 const field=state.stage==='prepare-foundation'?'foundation':state.stage==='prepare-structure'?'structurePlan':'contentPlan',subject=field==='foundation'?spec.foundation:spec.sections.find(s=>s.id===state.activeSectionId),previous=field==='foundation'?subject?.plan:subject?.[field];
 if(patch.baseRevision!==(previous?.revision||0))fail('LANDING_PREPARATION_REVISION_STALE');
 if(state.stage==='prepare-content'&&patch.decision.texts.some(t=>t.factIds.some(id=>!spec.facts?.some(f=>f.id===id))))fail('LANDING_CONTENT_FACT_UNCONFIRMED');
 if(state.stage==='prepare-foundation'&&before.sections.length&&previous&&!equal(previous.decision,patch.decision))fail('LANDING_FOUNDATION_SCOPE_CHANGED');
 const plan={revision:patch.baseRevision+1,decision:patch.decision,sources:patch.sources,sourcePin:state.sourcePin,readbackHash:sha(after),origin:'agent-source-interpretation'},sourceIds=[...new Set([...(subject?.sourceIds||[]),...patch.sources.map(s=>s.id)])];
 state.prepared={stage:state.stage,sectionId:state.activeSectionId,planHash:sha(plan)};
 if(field==='foundation')return {...spec,foundation:{...spec.foundation,plan,sourceIds}};
 return {...spec,sections:spec.sections.map(s=>s.id===state.activeSectionId?{...s,[field]:plan,sourceIds}:s)};
}
function stagedStart(record,sourcePin,allowedSections){
 const queue=record.spec.sections.filter(s=>!allowedSections||allowedSections.has(s.id)).map(s=>s.id),old=record.execution;
 const compatible=old?.schemaVersion===STAGED_SCHEMA&&old.sourcePin===sourcePin&&old.rootNodeId===record.target.rootNodeId&&old.ownerNonce===record.target.ownerNonce&&equal(old.queue,queue)&&old.status!=='completed';
 const structures=compatible?(old.structures||[]).filter(row=>{const s=record.spec.sections.find(s=>s.id===row.sectionId);return s&&row.planHash===sha(s.structurePlan)&&record.readback.sections.some(n=>n.id===row.id&&n.sectionId===s.id);}):[];
 const completed=compatible?(old.completed||[]).filter(row=>{const s=record.spec.sections.find(s=>s.id===row.sectionId);return s&&row.planHash===sha(s.contentPlan)&&record.readback.sections.some(n=>n.id===row.id&&n.sectionId===s.id&&n.fingerprint===row.fingerprint);}):[];
 if(compatible&&(old.completed||[]).length!==completed.length)fail('LANDING_CHECKPOINT_STALE');
 const kept=compatible&&(old.stage.startsWith('prepare-')||['foundation','structure','content'].includes(old.stage)||old.stage==='verify'&&completed.length===queue.length&&structures.length===queue.length&&foundationNodes(record.spec,record.readback));
 return {schemaVersion:STAGED_SCHEMA,workflow:WORKFLOW,sourcePin,rootNodeId:record.target.rootNodeId,ownerNonce:record.target.ownerNonce,queue,structures,completed,stage:kept?old.stage:'prepare-foundation',activeSectionId:kept?old.activeSectionId:null,prepared:null,activePlanHash:kept?old.activePlanHash||null:null,status:'ready',lastCheckpoint:compatible?old.lastCheckpoint:null,apiObservations:compatible?old.apiObservations||[]:[],screenshots:compatible?old.screenshots||[]:[],operation:null,callId:null,elapsedMs:0,toolCalls:0,recoveriesWithoutProgress:0,nextAction:'Prepare only the assigned unit from the selected skill and its sources; inspect and preserve retained work.'};
}
function stagedProtect(state,before,after){
 const active=['structure','content'].includes(state.stage)?state.activeSectionId:null;
 if(state.stage.startsWith('prepare-')&&sha(before)!==sha(after))fail('LANDING_PREPARATION_CANVAS_CHANGED');
 if(state.stage==='foundation'){
  if(before.sections.length&&sha(before)!==sha(after))fail('LANDING_FOUNDATION_SCOPE_CHANGED');
  if(after.sections.length!==before.sections.length)fail('LANDING_SECTION_SCOPE_CHANGED');
  return;
 }
 const stable=row=>{const value={...row};for(const key of ['x','y','width','height'])delete value[key];return value;};
 if(before.native&&after.native&&(before.native.nodes.some(old=>old.sectionId!==active&&!after.native.nodes.some(row=>row.id===old.id&&equal(stable(old),stable(row))))||after.native.nodes.some(row=>!before.native.nodes.some(old=>old.id===row.id)&&row.sectionId!==active)))fail('LANDING_SECTION_SCOPE_CHANGED');
 if(before.sections.some(old=>old.sectionId!==active&&!after.sections.some(row=>row.sectionId===old.sectionId&&row.id===old.id&&row.fingerprint===old.fingerprint))||after.sections.some(row=>!before.sections.some(old=>old.sectionId===row.sectionId)&&row.sectionId!==active))fail('LANDING_SECTION_SCOPE_CHANGED');
}
function stagedObserved(state,before,after,point,spec,now){
 stagedProtect(state,before,after);const unit={stage:state.stage,sectionId:state.activeSectionId,operation:state.operation,elapsedMs:state.elapsedMs,toolCalls:state.toolCalls};
 if(!point){state.recoveriesWithoutProgress=sha(before)===sha(after)?state.recoveriesWithoutProgress+1:0;if(state.recoveriesWithoutProgress>=3)fail('LANDING_NO_PROGRESS');}
 else{
  state.recoveriesWithoutProgress=0;state.nextAction=point.nextAction;
  if(point.status==='complete'){
   const section=spec.sections.find(s=>s.id===state.activeSectionId);
   if(state.stage.startsWith('prepare-')){
    const field=state.stage==='prepare-foundation'?spec.foundation?.plan:section?.[state.stage==='prepare-structure'?'structurePlan':'contentPlan'];if(!field||field.sourcePin!==state.sourcePin||state.prepared?.stage!==state.stage||state.prepared.sectionId!==state.activeSectionId||state.prepared.planHash!==sha(field))fail('LANDING_PREPARATION_REQUIRED');
    state.activePlanHash=sha(field);state.prepared=null;state.stage=state.stage.slice('prepare-'.length);
   }else if(state.stage==='foundation'){
    if(!foundationNodes(spec,after))fail('LANDING_FOUNDATION_UNCONFIRMED');state.activeSectionId=state.queue[0]||null;state.stage=state.activeSectionId?'prepare-structure':'verify';
   }else if(['structure','content'].includes(state.stage)){
    const row=after.sections.find(n=>n.sectionId===section?.id&&n.id===section?.nodeId),base=foundationNodes(spec,after),node=base?.byId.get(row?.id);
    if(!row||!base||!matchesNode(node,section.structurePlan?.decision.root)||!matchesProps(node,section.structurePlan.decision.props)||!base.descendant(node,base.mount))fail('LANDING_STRUCTURE_UNCONFIRMED');
    if(state.stage==='structure'){
     state.structures=state.structures.filter(s=>s.sectionId!==section.id).concat({...row,planHash:sha(section.structurePlan)});
     state.activeSectionId=state.queue.find(id=>!state.structures.some(s=>s.sectionId===id))||state.queue[0]||null;state.stage=state.structures.length===state.queue.length?'prepare-content':'prepare-structure';
    }else{
     const decision=section.contentPlan?.decision,nodes=after.native.nodes.filter(n=>n.sectionId===section.id);
     if(!decision||decision.texts.some(t=>!nodes.some(n=>n.type==='TEXT'&&n.characters===t.value))||decision.assets.some(a=>!nodes.some(n=>a.kind==='component'?(n.componentKey===a.key||n.componentSetKey===a.key):n.imageHashes?.some(i=>i.imageHash===a.key))))fail('LANDING_CONTENT_UNCONFIRMED');
     state.completed=state.completed.filter(s=>s.sectionId!==section.id).concat({...row,planHash:sha(section.contentPlan)});state.activeSectionId=state.queue.find(id=>!state.completed.some(s=>s.sectionId===id))||null;state.stage=state.activeSectionId?'prepare-content':'verify';
    }
   }else if(state.stage==='verify')fail('LANDING_CHECKPOINT_REQUIRED');
  }
 }
 state.lastCheckpoint={...unit,atUtc:new Date(now).toISOString(),readbackHash:sha(after),sectionIds:after.sections.map(s=>s.sectionId),complete:point?.status==='complete'};state.status='ready';state.operation=null;state.callId=null;return state;
}
function stagedPrompt(phase){
 if(phase==='plan')return 'Return exactly one planning STEP with a SHORT whole-page specJson outline: confirmed brief facts/answers, stable section IDs, each role and contentShape (counts, CTA behavior, required media type). Resolve material brief questions first. Do not read component packages or choose final copy/exact assets for future units. build requests native section/root creation; the selected skill/pattern determines the foundation afterward. Outline is bounded to6model calls. Proxy retains the complete plan.';
 return 'Return exactly one WRITE_STEP; never return specJson or copies of the full plan. Proxy owns stage/activeSectionId and stores the plan. Sequence: prepare-foundation -> foundation -> (prepare-structure -> structure) for EACH section -> (prepare-content -> content) for EACH section -> verify. Foundation component, mount, grid and spacing come ONLY from selected skill/pattern sources, not generic host defaults. Preparation uses the Proxy reader without MCP. Read only current-unit instructions, applicable manual contracts or explicit documented fallback, and relevant technical references. Complete preparation with sectionPatch:null, resultJson.checkpoint:{sectionId:activeSectionId,status:"complete",nextAction}, preparationPatch:{stage,sectionId,baseRevision,sources:[{id,sha256,path,offset,observation}],decision}. Cite actually read normative/selection ranges, not an index listing; baseRevision is0 or the current plan revision. Host persists this narrow delta only after unchanged independent readback. Never put business facts, other sections, a replacement plan or node bindings into the delta. Foundation decision is exactly {container:{role,type,componentKey},mount:{role,type,componentKey},layout:{source-derived settings}}. Descriptor type FRAME/INSTANCE/SLOT; componentKey is the observed40hex key for INSTANCE, otherwise null; roles are declared here and tagged in apollolanding. Structure decision is exactly {root:{type,componentKey},props:{public settings},slots:[public slot names],layout:{source-derived settings}}. Content decision is exactly {texts:[{target,value,factIds:[existing spec fact IDs]}],assets:[{target,kind:"component"|"image",key,resourceId,path}]}; each asset cites its actually read selection range in sources. foundation creates only the accepted foundation; structure creates/updates only the active skeleton, preserving source placeholder content. Only structure continue may bind sectionPatch:{sectionId,nodeId}; all other units require null. All skeletons must finish before content. content fills only the active existing section from contentPlan; confirm exact text, asset identities and layout. Work in at most2MCP calls per turn. After any bounded write return continue with checkpoint:{sectionId:activeSectionId,status:"partial"|"complete",nextAction}. Partial keeps the same unit; host independently rereads before advancement. verify is read-only; finish only there. After content obtain delivered screenshots of every section and page; inspect and return visualReviews:{scope,modelStep,callId,verdict,evidence}[] matching execution.screenshots and critical norm checks with evidence. Tag and prove foundation native types/keys/containment according to spec.foundation.plan.decision. Missing evidence/font or critical UNKNOWN preserves needs-verification, Ready=false, owner acceptance pending. A retained partial root is inspected, never recreated. All48model/96MCP counters span automatic transitions/retries; no-progress, Stop, source freshness, ownership and scope guards remain.';
}
function assertPrepared(spec,state){
 if(!staged(state)||!['foundation','structure','content'].includes(state.stage))return;
 const section=spec.sections.find(s=>s.id===state.activeSectionId),plan=state.stage==='foundation'?spec.foundation?.plan:section?.[state.stage==='structure'?'structurePlan':'contentPlan'];
 if(!plan||plan.sourcePin!==state.sourcePin||sha(plan)!==state.activePlanHash)fail('LANDING_PREPARATION_REQUIRED');
}
module.exports={SCHEMA,WORKFLOW,staged,start,protect,specScope,sectionPatch,confirmPatch,checkpoint,observed,preparationBudget,refinement,refine,apiObservations,preparationPatch,confirmPreparation,foundationNodes,stagedPrompt,assertPrepared};
