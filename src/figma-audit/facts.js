'use strict';
// Transport fact IDs, not design-system norms. Every extractor matches native.js.
const fields=Object.create(null),object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),number=v=>typeof v==='number'&&Number.isFinite(v),string=v=>typeof v==='string';
function direct(names,type,types=null,nullable=false){for(const name of names.split(' '))fields[name]={key:name,read:n=>Object.hasOwn(n,name)?n[name]:undefined,type,types,nullable};}
direct('x y width height layoutGrow itemSpacing counterAxisSpacing paddingLeft paddingRight paddingTop paddingBottom strokeWeight opacity cornerRadius',number);
direct('minWidth maxWidth minHeight maxHeight',number,null,true);
direct('fontSize fontWeight',number,['TEXT']);
direct('type name layoutMode layoutSizingHorizontal layoutSizingVertical primaryAxisSizingMode counterAxisSizingMode primaryAxisAlignItems counterAxisAlignItems layoutAlign fillStyleId strokeStyleId effectStyleId key',string);
direct('characters textStyleId textAutoResize textAlignHorizontal textAlignVertical',string,['TEXT']);
direct('visible',v=>typeof v==='boolean');
direct('absoluteBoundingBox boundVariables resolvedVariableModes explicitVariableModes',object);
direct('componentPropertyReferences',object,null,true);
direct('componentProperties',object,['INSTANCE']);
direct('componentPropertyDefinitions',object,['COMPONENT','COMPONENT_SET']);
direct('variantProperties',object,['COMPONENT','COMPONENT_SET'],true);
direct('fontName lineHeight letterSpacing',object,['TEXT']);
direct('fills strokes effects overrides variables styles',Array.isArray);
direct('textSegments',Array.isArray,['TEXT']);
function catalogue(name,read,type,types=null){fields['catalogue.'+name]={key:'catalogue',read:n=>read(n.catalogue),type,types,catalogue:true};}
catalogue('fontSize',n=>n?.text?.fontSize,number,['TEXT']);
catalogue('letterSpacing',n=>n?.text?.letterSpacing,number,['TEXT']);
catalogue('lineHeight',n=>n?.text?.lineHeight,v=>number(v)||string(v),['TEXT']);
catalogue('fontName',n=>n?.text?.fontName,string,['TEXT']);
catalogue('characters',n=>n?.text?.characters,string,['TEXT']);
catalogue('textStyleKey',n=>require('./catalogues').styleKey(n?.styles?.text?.styleKey),string,['TEXT']);
for(const key of ['fills','strokes','effects'])catalogue(key,n=>n?.[key],Array.isArray);
for(const key of ['layout','styles','componentInstance'])catalogue(key,n=>n?.[key],object);
for(const key of ['width','height','minWidth','maxWidth','minHeight','maxHeight','itemSpacing'])catalogue(key,n=>n?.layout?.[key],number);
for(const side of ['Left','Right','Top','Bottom'])catalogue('padding'+side,n=>n?.layout?.padding?.[side.toLowerCase()],number);
for(const axis of ['Horizontal','Vertical'])catalogue('layoutSizing'+axis,n=>n?.layout?.sizing?.[axis.toLowerCase()]??n?.['layoutSizing'+axis]??n?.layout?.['layoutSizing'+axis],string);
for(const key of ['opacity','radius'])catalogue(key,n=>n?.[key],number);
catalogue('visible',n=>n?.visible,v=>typeof v==='boolean');
fields['main.id']={key:'main',read:n=>n.main?.id,type:string,types:['INSTANCE']};
fields['main.key']={key:'main',read:n=>n.main?.key,type:string,types:['INSTANCE']};
fields['main.set.key']={key:'main',read:n=>n.main?.set?.key,type:string,types:['INSTANCE']};
fields['componentIdentity.key']={key:'componentIdentity',read:n=>n.componentIdentity?.key,type:string,types:['INSTANCE']};
function available(value,nullable=false,depth=0){if(value===undefined||depth>20)return false;if(value===null)return nullable;if(typeof value==='number')return Number.isFinite(value);if(typeof value==='string'||typeof value==='boolean')return true;if(typeof value!=='object')return false;if(Object.hasOwn(value,'unavailable')||value.availability==='UNAVAILABLE')return false;return Object.values(value).every(v=>available(v,false,depth+1));}
function within(snapshot,nodeId,rootId){const seen=new Set();for(let id=nodeId;id&&!seen.has(id);){if(id===rootId)return true;seen.add(id);id=snapshot.nodes.find(n=>n.id===id)?.parentId;}return false;}
function sourceRelated(run,nodeId,targetId,seen=new Set()){
 if(seen.has(nodeId))return false;seen.add(nodeId);const roots=new Set(run.sourceRoots.get(nodeId)||[]);if(run.sourceOwners.has(nodeId))roots.add(nodeId);
 for(const root of roots)for(const owner of run.sourceOwners.get(root)||[]){if(run.snapshot.nodes.some(n=>n.id===owner)){if(within(run.snapshot,owner,targetId)||within(run.snapshot,targetId,owner))return true;}else if(sourceRelated(run,owner,targetId,seen))return true;}
 return false;
}
function overrideFactField(field){return field==='styledTextSegments'?'textSegments':field;}
function factsRoles(run,nodeId,targetId){
 const actual=run.snapshot.nodes.find(n=>n.id===nodeId),context=run.snapshot.contextParents.find(n=>n.id===nodeId),roles=[];
 if(actual&&within(run.snapshot,nodeId,targetId))roles.push('target');
 if(actual&&within(run.snapshot,targetId,nodeId)||context&&context.forRootIds.some(root=>within(run.snapshot,targetId,root)))roles.push('context');
 if(run.sourceOwners&&run.sourceRoots&&sourceRelated(run,nodeId,targetId))roles.push('source');
 return roles;
}
function requirementValid(r){return object(r)&&Object.keys(r).sort().join(',')==='field,id,nodeId,role'&&['id','field','nodeId'].every(k=>typeof r[k]==='string'&&r[k].length>0&&r[k].length<=120)&&['target','context','source'].includes(r.role);}
function checkFacts(run,plan,check){
 const fail=(repairable=false,issue='FACT_BINDING_MISMATCH')=>{throw Object.assign(Error('AUDIT_FACT_BINDING_INVALID'),{code:'AUDIT_FACT_BINDING_INVALID',repairable,issue});},requirements=plan.requiredFields,bindings=check.factBindings;
 if(Array.isArray(bindings)&&bindings.some(b=>!run.evidence.has(b?.evidenceId)))fail(false,'EVIDENCE_NOT_HELD');
 if(!Array.isArray(bindings)||new Set(bindings.map(b=>b.factId)).size!==bindings.length||bindings.some(b=>!requirements.some(r=>r.id===b.factId)||!check.evidenceIds.includes(b.evidenceId)))fail(true);
 const gaps=[];
 if(!requirements.some(r=>r.role==='target'))gaps.push({factId:'target',reason:'NO_TARGET_FACT_DECLARED'});
 for(const requirement of requirements){
  const {field,nodeId,role,id}=requirement,target=plan.targets[0],actual=run.snapshot.nodes.find(n=>n.id===nodeId),context=run.snapshot.contextParents.find(n=>n.id===nodeId),known=actual||context||run.sourceTypes.has(nodeId)||run.sourceOwners.has(nodeId);
  if(fields[field]?.catalogue&&role!=='source')fail(sourceRelated(run,nodeId,target),'CATALOGUE_SOURCE_ROLE_REQUIRED');
  const related=role==='target'?Boolean(actual)&&within(run.snapshot,nodeId,target):role==='context'?Boolean(actual&&within(run.snapshot,target,nodeId)||context&&context.forRootIds.some(root=>within(run.snapshot,target,root))):sourceRelated(run,nodeId,target);
  if(known&&!related)fail(Boolean(actual)&&factsRoles(run,nodeId,target).length>0&&role!=='source','FACT_ROLE_SCOPE_MISMATCH');
  const binding=bindings.find(b=>b.factId===id);let reason;
  if(!known)reason='NODE_NOT_OBSERVED';else if(!Object.hasOwn(fields,field))reason='UNSUPPORTED_FACT';else if(!binding)reason='MISSING_BINDING';else{
   const evidence=run.evidence.get(binding.evidenceId),rows=evidence.kind==='source'?[evidence.result.root]:evidence.result.nodes,node=rows.find(n=>n?.id===nodeId),definition=fields[field],expectedType=actual?.type||context?.type||run.sourceTypes.get(nodeId);
   if(Boolean(definition.catalogue)!==(evidence.kind==='catalogue'))reason='FACT_SOURCE_KIND_MISMATCH';
   else if(!node||!Array.isArray(node.unavailable))reason='NO_DETAILED_NODE_FACTS';
   else if(node.availability==='UNAVAILABLE'||node.unavailable.includes('node')||node.unavailable.includes(definition.key))reason='UNAVAILABLE';
   else if(!expectedType||node.type!==expectedType)reason='NODE_TYPE_UNCONFIRMED';
   else if(definition.types&&!definition.types.includes(node.type))reason='FACT_NODE_TYPE_MISMATCH';
   else{const value=definition.read(node);if(!available(value,definition.nullable))reason='MISSING_OR_UNAVAILABLE_VALUE';else if(!(value===null&&definition.nullable)&&!definition.type(value))reason='FACT_TYPE_MISMATCH';}
  }
  if(reason)gaps.push({factId:id,reason});
 }
 return gaps;
}
function describeGaps(plan,gaps){
 const labels={CATALOGUE_BASELINE_NOT_DECLARED:'не заявлены данные соответствующего поля эталона',FACT_SOURCE_KIND_MISMATCH:'каталожное и native доказательства перепутаны',NO_TARGET_FACT_DECLARED:'не заявлены данные целевого узла',NODE_NOT_OBSERVED:'узел не прочитан',UNSUPPORTED_FACT:'поле не поддерживается текущим чтением',MISSING_BINDING:'нет ссылки на прочитанное значение',NO_DETAILED_NODE_FACTS:'есть только структура, свойства не прочитаны',NODE_TYPE_UNCONFIRMED:'тип узла не подтверждён',FACT_NODE_TYPE_MISMATCH:'поле не относится к этому типу узла',UNAVAILABLE:'данные недоступны',MISSING_OR_UNAVAILABLE_VALUE:'значение отсутствует или смешано',FACT_TYPE_MISMATCH:'получен другой тип значения'};
 return gaps.slice(0,6).map(g=>{const requirement=plan.requiredFields.find(r=>r.id===g.factId);return (requirement?.field||g.factId)+' — '+(labels[g.reason]||g.reason);}).join('; ')+(gaps.length>6?'; и ещё '+(gaps.length-6):'');
}
const fieldDefinitions=Object.keys(fields).map(id=>({id,nodeTypes:fields[id].types||null,hint:id==='textSegments'?'Native getStyledTextSegments observed subset; raw styledTextSegments metadata maps here. Other range properties remain unproven.':fields[id].catalogue?'Packaged catalogue baseline only; source role and catalogue evidence required. Not native data or a Hub norm.':id==='variantProperties'?'Definition only. INSTANCE variant parameters are read through componentProperties, not an alias of variantProperties.':''}));
function planIssues(run,plan,{scope=false}={}){
 const issues=[];
 for(const row of plan)for(const fact of row.requiredFields){
  const definition=fields[fact.field],type=run.snapshot.nodes.find(n=>n.id===fact.nodeId)?.type||run.snapshot.contextParents.find(n=>n.id===fact.nodeId)?.type||run.sourceTypes.get(fact.nodeId);
  if(scope){const roles=factsRoles(run,fact.nodeId,row.targets[0]);if(definition?.catalogue&&fact.role!=='source'||type&&!roles.includes(fact.role))issues.push({checkId:row.id,factId:fact.id,field:fact.field,nodeId:fact.nodeId,nodeType:type,role:fact.role,allowedRoles:definition?.catalogue?roles.filter(r=>r==='source'):roles,code:'FACT_ROLE_SCOPE_MISMATCH',hint:'Keep the exact node and rule target; use an allowed role only. No new read grant.'});}
  if(type&&definition?.types&&!definition.types.includes(type))issues.push({checkId:row.id,factId:fact.id,field:fact.field,nodeId:fact.nodeId,nodeType:type,allowedNodeTypes:definition.types,code:'FACT_NODE_TYPE_MISMATCH',hint:fieldDefinitions.find(f=>f.id===fact.field).hint});
 }
 return issues;
}
module.exports={overrideFactField,fieldDefinitions,planIssues,fieldIds:Object.keys(fields),requirementValid,checkFacts,describeGaps,within};
