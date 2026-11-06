'use strict';
const crypto=require('node:crypto'),nativeState=require('./native-state'),plan=require('./native-plan');
const sha=v=>crypto.createHash('sha256').update(plan.stable(v)).digest('hex');
const enabled=r=>r.source?.skeletonExecutor===plan.VERSION;
const affirmative=text=>/^(?:ок|ok|окей|да|подходит|структура подходит|всё (?:ок|подходит|хорошо)|да,? (?:всё ок|подходит|структура подходит))[.!\s]*$/iu.test(text.trim());
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
function structure(record){return {sourcePin:record.execution.sourcePin,rootNodeId:record.target.rootNodeId,ownerNonce:record.target.ownerNonce,foundation:record.spec.foundation?.plan,sections:record.spec.sections.map(s=>({id:s.id,role:s.role,contentShape:s.contentShape,nodeId:s.nodeId,structurePlan:s.structurePlan,nativeBindings:s.nativeBindings}))};}
function anchors(record){
 const ids=new Set([...(record.spec.foundation?.nativeBindings||[]),...record.spec.sections.flatMap(s=>s.nativeBindings||[])].map(b=>b.nodeId));
 return record.readback.native.nodes.filter(n=>ids.has(n.id)).map(n=>({id:n.id,parentId:n.parentId,type:n.type,componentKey:n.componentKey||null,componentSetKey:n.componentSetKey||null,nativeKey:n.nativeKey}));
}
function suspend(record,now){
 if(!enabled(record)||record.execution.stage!=='prepare-content'||record.execution.structureApproval?.status==='accepted')return false;
 const e=record.execution;
 if(e.structures.length!==e.queue.length||record.spec.sections.some(s=>!record.readback.sections.some(n=>n.id===s.nodeId&&n.sectionId===s.id)))fail('LANDING_STRUCTURE_UNCONFIRMED');
 const order=record.readback.sections.map(s=>s.sectionId);if(!plan.equal(order,record.spec.sections.map(s=>s.id)))fail('LANDING_STRUCTURE_UNCONFIRMED');
 e.structureApproval={id:crypto.randomUUID(),status:'pending',revision:record.revision,sourcePin:e.sourcePin,rootNodeId:record.target.rootNodeId,ownerNonce:record.target.ownerNonce,structureHash:sha(structure(record)),readbackHash:sha(record.readback),anchors:anchors(record),order,atUtc:new Date(now).toISOString()};
 e.stage='approve-structure';e.activeSectionId=null;e.activePlanHash=null;e.status='awaiting-structure-approval';record.status='needs-structure-approval';record.message='Каркас создан. Структура подходит? Подтверди её, чтобы перейти к текстам и иллюстрациям, или опиши, что изменить.';
 record.messages.push({id:'structure:'+e.structureApproval.id,role:'assistant',text:record.message,revision:record.revision});return true;
}
function assertDecision(record,body,sourcePin){
 const a=record.execution?.structureApproval;
 if(!enabled(record)||record.status!=='needs-structure-approval'||a?.status!=='pending'||a.id!==body.approvalId||a.revision!==body.revision||a.structureHash!==body.structureHash||a.structureHash!==sha(structure(record))||a.sourcePin!==sourcePin||a.rootNodeId!==record.target.rootNodeId||a.ownerNonce!==record.target.ownerNonce)fail('LANDING_STRUCTURE_APPROVAL_STALE');
 return a;
}
function assertAllowed(record,readback=record.readback){
 if(!enabled(record))return;
 const a=record.execution.structureApproval;
 if(a?.status!=='accepted'||a.structureHash!==sha(structure(record))||a.sourcePin!==record.execution.sourcePin||a.rootNodeId!==record.target.rootNodeId||a.ownerNonce!==record.target.ownerNonce)fail('LANDING_STRUCTURE_APPROVAL_REQUIRED');
 const byId=new Map(readback.native.nodes.map(n=>[n.id,n]));
 for(const anchor of a.anchors){const n=byId.get(anchor.id);if(!n||Object.entries(anchor).some(([field,value])=>(n[field]??null)!==value))fail('LANDING_APPROVED_STRUCTURE_CHANGED');}
 if(!plan.equal(readback.sections.map(s=>s.sectionId),a.order))fail('LANDING_APPROVED_STRUCTURE_CHANGED');
 for(const s of record.spec.sections)plan.confirm(s.structurePlan.decision.layout.nativePlan,s.nativeBindings,readback,'structure',require('./checkpoints').foundationNodes(record.spec,readback)?.mount.id);
}
function assertFresh(record,before,after){assertAllowed(record,after);if(!nativeState.sameReadback(before,after))fail('LANDING_STRUCTURE_APPROVAL_STALE');}
function reanchorConsumedDefault(record,before,after){
 const e=record.execution,binding=e.slotContentReplacement;
 if(!enabled(record)||!binding?.consumed||after.sections.some(s=>s.id===binding.blockId))return;
 const revision=e.structureRevision,prior=revision?.sections.find(s=>s.id===binding.blockId),first=record.spec.sections[0],row=after.sections.find(s=>s.id===first?.nodeId&&s.sectionId===first.id),base=require('./checkpoints').foundationNodes(record.spec,after);
 const checkpointHash=first&&crypto.createHash('sha256').update(JSON.stringify(first.structurePlan)).digest('hex');
 if(!e.freshFoundation||revision?.status!=='requested'||revision.sourcePin!==e.sourcePin||revision.rootNodeId!==record.target.rootNodeId||revision.ownerNonce!==record.target.ownerNonce||!prior||!before.sections.some(s=>s.id===prior.id&&s.fingerprint===prior.fingerprint)||!row||!base||base.mount.id!==binding.mountId||base.container.id!==binding.containerId||base.byId.get(row.id)?.parentId!==binding.mountId||first.structurePlan?.sourcePin!==e.sourcePin||!e.structures.some(s=>s.id===row.id&&s.sectionId===first.id&&s.planHash===checkpointHash))fail('LANDING_SLOT_REPLACEMENT_UNCONFIRMED');
 plan.confirm(first.structurePlan.decision.layout.nativePlan,first.nativeBindings,after,'structure',base.mount.id);
 e.slotContentReplacement={...binding,blockId:row.id,rebindings:(binding.rebindings||[]).concat({fromBlockId:binding.blockId,toBlockId:row.id,requestId:revision.requestId,readbackHash:sha(after)}).slice(-32)};
}
module.exports={enabled,affirmative,sha,structure,suspend,assertDecision,assertAllowed,assertFresh,reanchorConsumedDefault};
