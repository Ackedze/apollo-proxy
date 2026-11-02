'use strict';
const crypto=require('node:crypto'),equal=require('node:util').isDeepStrictEqual;
const SCHEMA='apollo.landing-checkpoints.v1';
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
function start(record,sourcePin,allowedSections){
 const queue=record.spec.sections.filter(s=>!allowedSections||allowedSections.has(s.id)).map(s=>s.id);
 const previous=record.execution,compatible=previous?.schemaVersion===SCHEMA&&previous.status!=='completed'&&previous.sourcePin===sourcePin&&previous.rootNodeId===record.target.rootNodeId&&previous.ownerNonce===record.target.ownerNonce&&equal(previous.queue,queue);
 const completed=compatible?(previous.completed||[]).filter(old=>old.specHash===sha(record.spec.sections.find(s=>s.id===old.sectionId))&&record.readback.sections.some(row=>row.sectionId===old.sectionId&&row.id===old.id&&row.fingerprint===old.fingerprint)):[];
 // A resumed incomplete root is inspected by the worker; it is never recreated.
 const stage=compatible&&previous.stage!=='bootstrap'?'section':'bootstrap';
 const activeSectionId=stage==='section'?queue.find(id=>!completed.some(row=>row.sectionId===id))||null:null;
 return {schemaVersion:SCHEMA,sourcePin,rootNodeId:record.target.rootNodeId,ownerNonce:record.target.ownerNonce,queue,completed,stage:stage==='section'&&!activeSectionId?'verify':stage,activeSectionId,status:'ready',lastCheckpoint:compatible?previous.lastCheckpoint:null,operation:null,callId:null,elapsedMs:0,toolCalls:0,recoveriesWithoutProgress:0,nextAction:'Inspect the current root and resume only the assigned work unit.'};
}
function protect(state,before,after){
 const active=state.stage==='section'?state.activeSectionId:null;
 if(before.sections.some(old=>old.sectionId!==active&&!after.sections.some(row=>row.sectionId===old.sectionId&&row.id===old.id&&row.fingerprint===old.fingerprint))||after.sections.some(row=>!before.sections.some(old=>old.sectionId===row.sectionId)&&row.sectionId!==active))fail('LANDING_SECTION_SCOPE_CHANGED');
}
function specScope(state,before,after){
 if(!equal(before.map(s=>s.id),after.map(s=>s.id))||before.some(old=>old.id!==state.activeSectionId&&!equal(old,after.find(s=>s.id===old.id))))fail('LANDING_SECTION_SCOPE_CHANGED');
}
function sectionPatch(state,kind,patch){
 if(patch===null)return null;
 if(kind!=='continue'||state.stage!=='section'||!patch||typeof patch!=='object'||Array.isArray(patch)||!equal(Object.keys(patch).sort(),['sectionId','nodeId'].sort())||patch.sectionId!==state.activeSectionId||typeof patch.nodeId!=='string'||!/^[a-zA-Z0-9:;_-]{1,512}$/.test(patch.nodeId))fail('LANDING_SECTION_PATCH_INVALID');
 return {sectionId:patch.sectionId,nodeId:patch.nodeId};
}
function confirmPatch(spec,patch,readback){
 if(!patch)return spec;
 if(!readback.sections.some(row=>row.sectionId===patch.sectionId&&row.id===patch.nodeId))fail('LANDING_SECTION_PATCH_UNCONFIRMED');
 return {...spec,sections:spec.sections.map(section=>section.id===patch.sectionId?{...section,nodeId:patch.nodeId}:section)};
}
function checkpoint(state,step,result){
 if(step==='finish'){if(state.stage!=='verify')fail('LANDING_CHECKPOINT_REQUIRED');return null;}
 const point=result.checkpoint;
 if(!point||!equal(Object.keys(point).sort(),['sectionId','status','nextAction'].sort())||point.sectionId!==(state.stage==='section'?state.activeSectionId:null)||!['partial','complete'].includes(point.status)||typeof point.nextAction!=='string'||point.nextAction.length>1000)fail('LANDING_CHECKPOINT_INVALID');
 return point;
}
function observed(state,before,after,point,spec,now){
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
module.exports={SCHEMA,start,protect,specScope,sectionPatch,confirmPatch,checkpoint,observed};
