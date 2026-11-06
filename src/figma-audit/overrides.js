'use strict';
// Native metadata creates coverage obligations, never DS rules or visual evidence.
const crypto=require('node:crypto');
const VERSION='node-field-overrides-v1';
const fail=code=>{throw Object.assign(Error(code),{code});};
const id=(kind,value)=>kind+'-'+crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=v=>typeof v==='string'&&v.length>0&&v.length<=120;

function createOverrideInventory(snapshot,{maxBytes=400000,fieldKey=field=>field}={}){
 const nodes=new Map(snapshot.nodes.map(n=>[n.id,n]));
 let owners=new Map(snapshot.nodes.filter(n=>n.type==='INSTANCE'&&n.visible!==false).map(n=>[n.id,{ownerId:n.id,availability:'UNAVAILABLE',reason:'NOT_READ',entries:[],evidenceId:null}]));
 function within(nodeId,ownerId){
  const seen=new Set();for(let n=nodes.get(nodeId);n&&!seen.has(n.id);n=nodes.get(n.parentId)){if(n.id===ownerId)return true;seen.add(n.id);}return false;
 }
 function visible(nodeId){
  const seen=new Set();for(let n=nodes.get(nodeId);n&&!seen.has(n.id);n=nodes.get(n.parentId)){if(n.visible===false)return false;seen.add(n.id);}return true;
 }
 function metadata(node,evidenceId){
  const row={ownerId:node.id,availability:'UNAVAILABLE',reason:'OVERRIDES_UNAVAILABLE',entries:[],evidenceId};
  if(!Array.isArray(node.overrides)||Array.isArray(node.unavailable)&&node.unavailable.includes('overrides'))return row;
  const entries=new Map();let invalid=false;
  for(const entry of node.overrides){
   if(!entry||!text(entry.id)||!Array.isArray(entry.overriddenFields)){invalid=true;continue;}
   if(!entries.has(entry.id))entries.set(entry.id,new Set());
   for(const field of entry.overriddenFields){if(text(field))entries.get(entry.id).add(field);else invalid=true;}
  }
  row.entries=Array.from(entries,([nodeId,fields])=>({nodeId,fields:Array.from(fields).sort()})).sort((a,b)=>a.nodeId.localeCompare(b.nodeId));
  row.availability=invalid?'UNAVAILABLE':'AVAILABLE';row.reason=invalid?'OVERRIDE_METADATA_INVALID':'';return row;
 }
 function observe(rows,evidenceId,context={}){
  const next=new Map(owners),records=[];
  for(const node of rows){
   if(!owners.has(node.id)||node.type!=='INSTANCE'||node.scope==='parent-context')continue;
   const record=metadata(node,evidenceId),old=owners.get(node.id);
   if(old.availability==='AVAILABLE'&&(record.availability!=='AVAILABLE'||JSON.stringify(record.entries)!==JSON.stringify(old.entries)))fail('AUDIT_STALE');
   next.set(node.id,record);records.push(record);
  }
  if(Buffer.byteLength(JSON.stringify(Array.from(next.values())))>maxBytes)fail('AUDIT_CONTEXT_BUDGET');
  const previous=owners;owners=next;
  try{report(Object.assign({coverage:()=>({})},context));}catch(error){owners=previous;throw error;}
  return records;
 }
 function report({plan=[],published=new Map(),coverage,provisional=true,freshness='UNVERIFIED'}={}){
  const changes=new Map();
  for(const owner of owners.values())for(const entry of owner.entries)for(const field of entry.fields){
   const key=JSON.stringify([entry.nodeId,field]);
   if(!changes.has(key))changes.set(key,{id:id('override',[entry.nodeId,field]),kind:'field',nodeId:entry.nodeId,field,ownerIds:[],evidenceIds:[]});
   const row=changes.get(key);row.ownerIds.push(owner.ownerId);if(owner.evidenceId&&!row.evidenceIds.includes(owner.evidenceId))row.evidenceIds.push(owner.evidenceId);
  }
  const checks=Array.from(changes.values(),row=>{
   const node=nodes.get(row.nodeId),related=row.ownerIds.some(owner=>within(row.nodeId,owner));
   row.scope=!node?'UNOBSERVED':!related?'OUTSIDE_OWNER':!visible(node.id)?'HIDDEN':'READABLE';
   const factField=fieldKey(row.field);if(factField!==row.field)row.factField=factField;row.name=node?.name||row.nodeId;row.focusId=row.scope==='READABLE'?row.nodeId:row.ownerIds[0];
   const matches=plan.filter(p=>p.targets.length===1&&within(row.nodeId,p.targets[0])&&p.requiredFields.some(f=>f.nodeId===row.nodeId&&fieldKey(f.field)===fieldKey(row.field)&&f.role==='target'));
   row.checkIds=matches.map(p=>p.id);const results=matches.map(p=>published.get(p.id)),missing=results.some(r=>!r),statuses=results.filter(Boolean).map(r=>r.status);
   row.needsAssessment=row.scope==='READABLE'&&(!matches.length||missing)&&!statuses.includes('FAIL');
   if(row.scope==='UNOBSERVED'||row.scope==='HIDDEN'&&!results.some(Boolean)){row.status='NOT_CHECKED';row.reason='Изменённое поле относится к недоступной или скрытой ветви. Новое право чтения не предоставлено.';}
   else if(row.scope==='OUTSIDE_OWNER'){row.status='UNKNOWN';row.reason='Ссылка на изменение не подтверждена вложенностью экземпляра.';}
   else if(statuses.includes('FAIL')){row.status='FAIL';row.reason='Связанная проверка по DS AI HUB подтвердила нарушение.';}
   else if(!matches.length||missing||statuses.includes('NOT_CHECKED')){row.status='NOT_CHECKED';row.reason=!matches.length?'В плане нет проверки этого узла и изменённого поля.':'Оценка связанной проверки не получена или не выполнена.';}
   else if(statuses.includes('UNKNOWN')){row.status='UNKNOWN';row.reason='Для связанной проверки недостаточно подтверждённых данных.';}
   else if(statuses.includes('PASS')){row.status='PASS';row.reason='Связанные проверки подтвердили допустимость изменения.';}
   else{row.status='NOT_APPLICABLE';row.reason='Связанные проверки подтвердили неприменимость нормы.';}
   return row;
  });
  for(const owner of owners.values())if(owner.availability!=='AVAILABLE'&&owner.reason!=='NOT_READ')checks.push({id:id('override-scan',owner.ownerId),kind:'scan',nodeId:owner.ownerId,field:null,name:nodes.get(owner.ownerId).name,focusId:owner.ownerId,ownerIds:[owner.ownerId],evidenceIds:owner.evidenceId?[owner.evidenceId]:[],scope:'SCAN_UNAVAILABLE',status:'UNKNOWN',reason:'Полный перечень изменений экземпляра недоступен. Отсутствие перечня не означает отсутствие изменений.',scanReason:owner.reason,checkIds:[],needsAssessment:false});
  checks.sort((a,b)=>a.id.localeCompare(b.id));
  // Reserve bounded host explanations and the largest pending view before committing observations/plans.
  const pendingView=checks.map(c=>({id:c.id,nodeId:c.nodeId,field:c.field,factField:c.factField,checkIds:c.checkIds}));
  const size=Buffer.byteLength(JSON.stringify({checks:checks.map(c=>Object.assign({},c,{status:'NOT_APPLICABLE',reason:'',needsAssessment:false})),pending:pendingView}))+512*checks.length;
  if(size>maxBytes)fail('AUDIT_CONTEXT_BUDGET');
  const measured=Object.assign({},coverage(checks),{basis:'observed-node-field-overrides and unavailable scans; not all Hub rules'});
  return {version:VERSION,provisional,freshness,inventory:{instances:owners.size,scanned:Array.from(owners.values()).filter(o=>o.availability==='AVAILABLE').length,pendingScans:Array.from(owners.values()).filter(o=>o.reason==='NOT_READ').length,fieldChanges:changes.size,unavailableScans:checks.filter(c=>c.kind==='scan').length},coverage:measured,checks,pending:checks.filter(c=>c.needsAssessment).map(c=>({id:c.id,nodeId:c.nodeId,field:c.field,factField:c.factField,checkIds:c.checkIds}))};
 }
 report({coverage:()=>({})});
 return {observe,report};
}
module.exports={VERSION,createOverrideInventory};
