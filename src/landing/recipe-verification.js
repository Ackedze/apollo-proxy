'use strict';
const crypto=require('node:crypto');
const SCHEMA='apollo.recipe-verification.v1',OBSERVATION='apollo.recipe-observation.v1';
const CONTENT_INVENTORY='content-inventory';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const scalar=v=>['string','boolean'].includes(typeof v)||typeof v==='number'&&Number.isFinite(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const fail=()=>{throw Object.assign(Error('LANDING_VERIFICATION_INVALID'),{code:'LANDING_VERIFICATION_INVALID',status:503});};
const keys=(v,allowed)=>object(v)&&Object.keys(v).every(k=>allowed.includes(k));
function matchShape(m,ancestor=false){
 if(!keys(m,['type','name','familyKeys','componentKeys','properties','fields','visible',...(ancestor?[]:['withoutAncestor'])]))return false;
 return (!Object.hasOwn(m,'type')||typeof m.type==='string')&&(!Object.hasOwn(m,'name')||typeof m.name==='string'||Array.isArray(m.name)&&m.name.length>0&&m.name.every(v=>typeof v==='string'))&&
 ['familyKeys','componentKeys'].every(k=>!Object.hasOwn(m,k)||Array.isArray(m[k])&&m[k].length>0&&m[k].every(v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v)))&&
 (!Object.hasOwn(m,'properties')||object(m.properties)&&Object.entries(m.properties).every(([k,v])=>k.length>0&&k.length<=512&&(scalar(v)||Array.isArray(v)&&v.length>0&&v.length<=16&&v.every(scalar))))&&
 (!Object.hasOwn(m,'fields')||object(m.fields)&&Object.entries(m.fields).every(([k,v])=>FIELDS.has(k)&&scalar(v)))&&
 (!Object.hasOwn(m,'visible')||typeof m.visible==='boolean')&&(!Object.hasOwn(m,'withoutAncestor')||matchShape(m.withoutAncestor,true));
}
function pathShape(v){return Array.isArray(v)&&v.length>0&&v.length<=12&&v.every(s=>keys(s,['relation','match'])&&['self','children','descendants','parent'].includes(s.relation)&&matchShape(s.match));}
function assertionShape(a,condition=false){
 if(!keys(a,['id','label','targets','op','field','equals','oneOf','min','max','native','tolerance','other','otherField','comparator'])||!pathShape(a.targets)||!['count','value','same','compare','inside'].includes(a.op)||condition&&a.op!=='value')return false;
 if(!condition&&(typeof a.id!=='string'||!a.id||typeof a.label!=='string'||!a.label))return false;
 if(a.tolerance!==undefined&&(!finite(a.tolerance)||a.tolerance<0||a.tolerance>2))return false;
 if(['value','same','compare'].includes(a.op)&&(typeof a.field!=='string'||!a.field||a.field.length>512))return false;
 if(a.op==='count')return ['min','max'].some(k=>Object.hasOwn(a,k))&&['min','max'].every(k=>!Object.hasOwn(a,k)||Number.isSafeInteger(a[k])&&a[k]>=0&&a[k]<=4096)&&!(a.min!==undefined&&a.max!==undefined&&a.min>a.max);
 if(a.op==='value')return ['equals','oneOf','min','max','native'].filter(k=>Object.hasOwn(a,k)).length===1&&
 (!Object.hasOwn(a,'equals')||scalar(a.equals))&&(!Object.hasOwn(a,'oneOf')||Array.isArray(a.oneOf)&&a.oneOf.length>0&&a.oneOf.every(scalar))&&
 ['min','max'].every(k=>!Object.hasOwn(a,k)||finite(a[k]))&&(!Object.hasOwn(a,'native')||a.native===true);
 return !['compare','inside'].includes(a.op)||pathShape(a.other)&&(a.otherField===undefined||typeof a.otherField==='string')&&(a.op!=='compare'||['eq','lte','gte'].includes(a.comparator));
}
function readProfile(skill){
 const reference=skill.generation?.verification,recoveryBody=skill.bodies?.['references/recovery.json'];
 if(reference===undefined){if(recoveryBody!==undefined)fail();return null;}
 if(!keys(reference,['schemaVersion','file'])||reference.schemaVersion!==SCHEMA||typeof reference.file!=='string'||!reference.file.startsWith('references/'))fail();
 let value;try{value=JSON.parse(skill.bodies?.[reference.file]);}catch{fail();}
 if(!keys(value,['schemaVersion','rules'])||value.schemaVersion!==SCHEMA||!Array.isArray(value.rules)||!value.rules.length||value.rules.length>100)fail();
 const ids=new Set();
 for(const rule of value.rules){
  if(!keys(rule,['id','label','source','stages','scope','minScopes','when','assertions'])||typeof rule.id!=='string'||!rule.id||ids.has(rule.id)||typeof rule.label!=='string'||!rule.label||typeof rule.source!=='string'||!rule.source||!Array.isArray(rule.stages)||!rule.stages.length||rule.stages.some(s=>!['structure','content'].includes(s))||!pathShape(rule.scope)||![0,1].includes(rule.minScopes)||!Array.isArray(rule.assertions)||!rule.assertions.length||rule.assertions.length>100||rule.assertions.some(a=>!assertionShape(a))||rule.when!==undefined&&(!Array.isArray(rule.when)||!rule.when.length||rule.when.some(a=>!assertionShape(a,true))))fail();
  if(new Set(rule.assertions.map(a=>a.id)).size!==rule.assertions.length)fail();ids.add(rule.id);
  if(rule.id===CONTENT_INVENTORY){
   const labels=rule.assertions.map(({id})=>id.split('.')[0]);
   if(rule.minScopes!==1||rule.when||!rule.stages.includes('structure')||!rule.stages.includes('content')||
      rule.scope.length!==1||rule.scope[0].relation!=='self'||Object.keys(rule.scope[0].match).length||
      !labels.includes('sections')||!labels.includes('slots')||
      rule.assertions.some(a=>a.op!=='count'||!/^(?:sections|slots|family)\.[A-Za-z0-9-]+$/.test(a.id)))fail();
  }
 }
 let declaration=value;
 if(recoveryBody!==undefined){
  let recovery;try{recovery=JSON.parse(recoveryBody);}catch{fail();}
  if(!keys(recovery,['schemaVersion','repairStructure'])||recovery.schemaVersion!=='apollo.recipe-recovery.v1'||typeof recovery.repairStructure!=='boolean')fail();
  declaration={schemaVersion:value.schemaVersion,repairStructure:recovery.repairStructure,rules:value.rules};
 }
 return {declaration,sha256:hash(declaration),file:reference.file,contentInventory:value.rules.find(rule=>rule.id===CONTENT_INVENTORY)||null};
}
function property(node,name){
 const entries=Object.entries(node.properties||{}).filter(([k])=>k===name||k.replace(/#[^#]+$/,'')===name);
 if(entries.length!==1||!scalar(entries[0][1]?.value)||typeof entries[0][1].value==='boolean'&&entries[0][1].type!=='BOOLEAN')return undefined;
 return {key:entries[0][0],type:entries[0][1].type,value:entries[0][1].value};
}
const FIELDS=new Set('familyKey componentKey width height contentWidth x y right bottom insetTop insetRight insetBottom insetLeft layoutMode layoutSizingHorizontal layoutSizingVertical minWidth minHeight maxWidth maxHeight paddingLeft paddingRight paddingTop paddingBottom itemSpacing counterAxisSpacing cornerRadius topLeftRadius topRightRadius bottomLeftRadius bottomRightRadius fillCount gridGutter gridColumns clipsContent visible'.split(' '));
function fact(node,field,native=false){
 if(native)return FIELDS.has(field)?node.native?.[field]:undefined;
 if(field==='familyKey'||field==='componentKey')return typeof node[field]==='string'?node[field]:undefined;
 if(field.startsWith('property:'))return property(node,field.slice(9))?.value;
 for(const [prefix,group]of [['binding:','bindings'],['variable:','variables'],['resolved:','resolved']])if(field.startsWith(prefix)){const key=field.slice(prefix.length);return Object.hasOwn(node[group]||{},key)?node[group][key]:undefined;}
 return FIELDS.has(field)?node.facts?.[field]:undefined;
}
function matches(node,m,byId){
 const values=[];
 if(m.type!==undefined)values.push(node.type===m.type);
 if(m.name!==undefined)values.push((Array.isArray(m.name)?m.name:[m.name]).includes(node.name));
 if(m.visible!==undefined)values.push(typeof node.visible==='boolean'?node.visible===m.visible:null);
 for(const [field,key]of [['familyKeys','familyKey'],['componentKeys','componentKey']])if(m[field])values.push(node.type!=='INSTANCE'&&node.type!=='COMPONENT'?false:typeof node[key]==='string'?m[field].includes(node[key]):null);
 for(const [name,value]of Object.entries(m.properties||{})){const read=property(node,name);values.push(read?(Array.isArray(value)?value:[value]).includes(read.value):null);}
 for(const [field,value]of Object.entries(m.fields||{})){const read=fact(node,field);values.push(read===undefined?null:read===value);}
 if(m.withoutAncestor){let p=byId.get(node.parentId),seen=new Set(),unknown=false,found=false;while(p&&!seen.has(p.id)){seen.add(p.id);const result=matches(p,m.withoutAncestor,byId);if(result===true){found=true;break;}if(result===null)unknown=true;p=byId.get(p.parentId);}values.push(found?false:unknown?null:true);}
 return values.includes(false)?false:values.includes(null)?null:true;
}
function select(scope,path,nodes,byId){
 let current=[scope],unknown=false;
 for(const step of path){
  const next=new Map();
  for(const node of current){
   let candidates;
   if(step.relation==='self')candidates=[node];
   else if(step.relation==='parent')candidates=byId.has(node.parentId)?[byId.get(node.parentId)]:[];
   else if(step.relation==='children')candidates=nodes.filter(n=>n.parentId===node.id);
   else candidates=nodes.filter(n=>{let p=byId.get(n.parentId),seen=new Set();while(p&&!seen.has(p.id)){if(p.id===node.id)return true;seen.add(p.id);p=byId.get(p.parentId);}return false;});
   for(const candidate of candidates){const admitted=matches(candidate,step.match,byId);if(admitted===null)unknown=true;if(admitted)next.set(candidate.id,candidate);}
  }
  current=[...next.values()];
 }
 return {nodes:current,unknown};
}
function checkAssertion(a,scope,nodes,byId){
 const selected=select(scope,a.targets,nodes,byId),targets=selected.nodes,tolerance=a.tolerance??.5,observed=[];
 if(selected.unknown)return {status:'unknown',observed,reason:'Не удалось определить все совпадения селектора.'};
 if(a.op==='count')return {status:(a.min===undefined||targets.length>=a.min)&&(a.max===undefined||targets.length<=a.max)?'passed':'failed',observed:{count:targets.length,ids:targets.map(n=>n.id)}};
 if(!targets.length)return {status:'unknown',observed,reason:'Обязательная цель не найдена.'};
 let other;
 if(a.other){const selection=select(scope,a.other,nodes,byId);if(selection.unknown||selection.nodes.length!==1)return {status:'unknown',observed,reason:'Не подтверждён единственный объект сравнения.'};other=selection.nodes[0];}
 const equal=(v,w)=>finite(v)&&finite(w)?Math.abs(v-w)<=tolerance:v===w;
 let status='passed',first;
 for(const target of targets){
  const value=fact(target,a.field||''),entry={id:target.id};let passed;
  if(a.op==='inside'){
   const v=['x','y','right','bottom'].map(k=>fact(target,k)),w=['x','y','right','bottom'].map(k=>fact(other,k));entry.bounds=v;entry.container={id:other.id,bounds:w};
   if([...v,...w].every(finite))passed=v[0]>=w[0]-tolerance&&v[1]>=w[1]-tolerance&&v[2]<=w[2]+tolerance&&v[3]<=w[3]+tolerance;
  }else{
   entry.value=value;if(a.field.startsWith('property:'))entry.property=property(target,a.field.slice(9));
   if(value!==undefined){
    if(a.op==='same'){if(first===undefined)first=value;passed=equal(value,first);}
    if(a.op==='value'){
     if(Object.hasOwn(a,'equals'))passed=equal(value,a.equals);
     if(a.oneOf)passed=a.oneOf.some(v=>equal(v,value));
     if(a.min!==undefined&&finite(value))passed=value>=a.min-tolerance;
     if(a.max!==undefined&&finite(value))passed=value<=a.max+tolerance;
     if(a.native){entry.native=fact(target,a.field,true);if(entry.native!==undefined)passed=equal(value,entry.native);}
    }
    if(a.op==='compare'){entry.other={id:other.id,value:fact(other,a.otherField||a.field)};const w=entry.other.value;if(w!==undefined)passed=a.comparator==='eq'?equal(value,w):finite(value)&&finite(w)?a.comparator==='lte'?value<=w+tolerance:value>=w-tolerance:undefined;}
   }
  }
  observed.push(entry);if(passed===undefined)status='unknown';else if(!passed&&status!=='unknown')status='failed';
 }
 return {status,observed};
}
function evaluate(profile,snapshot,{rootId,revision,sourcePin,stage}){
 const base={schemaVersion:'apollo.recipe-verification-result.v1',rootId,revision,sourcePin,stage,profileHash:profile.sha256,snapshotHash:hash(snapshot??null)},checks=[];
 const invalid=message=>({...base,passed:false,checks:[{name:'Фактическая проверка макета',status:'unknown',evidence:message}]});
 if(snapshot?.schemaVersion!==OBSERVATION||snapshot.rootId!==rootId||snapshot.complete!==true||!Array.isArray(snapshot.nodes)||!snapshot.nodes.length||snapshot.nodes.length>4096)return invalid('Не получено полное свежее чтение принадлежащего чату корня.');
 const nodes=snapshot.nodes,byId=new Map(nodes.map(n=>[n.id,n]));
 if(byId.size!==nodes.length||!byId.has(rootId)||nodes.some(n=>typeof n.id!=='string'||n.id!==rootId&&!byId.has(n.parentId)))return invalid('Дерево фактических слоёв неполно или неоднозначно.');
 const root=byId.get(rootId);
 for(const rule of profile.declaration.rules.filter(r=>r.stages.includes(stage))){
  const scopes=select(root,rule.scope,nodes,byId);
  const add=(id,status,evidence)=>checks.push({name:rule.label+(id?' · '+id:''),status,evidence:JSON.stringify({ruleId:rule.id,source:rule.source,...evidence})});
  if(scopes.unknown){add('', 'unknown',{reason:'Не подтверждено полное покрытие области.'});continue;}
  if(scopes.nodes.length<rule.minScopes){add('', 'failed',{reason:'Обязательная область не найдена.'});continue;}
  for(const scope of scopes.nodes){
   const conditions=(rule.when||[]).map(a=>checkAssertion(a,scope,nodes,byId));
   if(conditions.some(c=>c.status==='unknown')){add('', 'unknown',{scope:scope.id,reason:'Применимость условия не подтверждена.',conditions});continue;}
   if(conditions.some(c=>c.status==='failed'))continue;
   for(const a of rule.assertions){
    const result=checkAssertion(a,scope,nodes,byId);
    const section=a.id.startsWith('sections.');
    if(rule.id===CONTENT_INVENTORY&&(section||a.id.startsWith('slots.'))&&result.status==='passed'){
     result.structureHash=hash(result.observed.ids.map(id=>{
      const node=byId.get(id);return [id,node.parentId,node.type,section?node.familyKey:null];
     }));
    }
    add(a.label,result.status,{scope:scope.id,assertionId:a.id,expected:a,...result});
   }
  }
 }
 if(!checks.length)return invalid('Для стадии нет подтверждённых обязательных условий.');
 return {...base,passed:checks.every(c=>c.status==='passed'),checks:checks.sort((a,b)=>Number(a.status==='passed')-Number(b.status==='passed'))};
}
function captureForProfile(profile){
 const nativeFields=new Set(),propertyNames=new Set(),bindingFields=new Set(),variableFields=new Set(),resolvedFields=new Set(),nativeTargets=new Map();
 function inspect(value){
  if(!value||typeof value!=='object')return;
  if(value.native===true&&typeof value.field==='string'&&FIELDS.has(value.field)){
   nativeFields.add(value.field);const match=value.targets?.at(-1)?.match||{},target={};for(const key of ['type','name'])if(match[key]!==undefined)target[key]=match[key];nativeTargets.set(JSON.stringify(target),target);
  }
  if(typeof value.field==='string'&&value.field.startsWith('property:'))propertyNames.add(value.field.slice(9));
  if(typeof value.otherField==='string'&&value.otherField.startsWith('property:'))propertyNames.add(value.otherField.slice(9));
  for(const field of [value.field,value.otherField])if(typeof field==='string')for(const [prefix,fields]of [['binding:',bindingFields],['variable:',variableFields],['resolved:',resolvedFields]])if(field.startsWith(prefix)){const name=field.slice(prefix.length);fields.add(name);bindingFields.add(name);}
  if(value.properties&&typeof value.properties==='object')for(const name of Object.keys(value.properties))propertyNames.add(name);
  for(const child of Object.values(value))if(typeof child==='object')inspect(child);
 }
 inspect(profile.declaration);return {nativeFields:[...nativeFields],propertyNames:[...propertyNames],bindingFields:[...bindingFields],variableFields:[...variableFields],resolvedFields:[...resolvedFields],nativeTargets:[...nativeTargets.values()]};
}
function readContentInventory(profile,receipt){
 const rule=profile.contentInventory;
 if(!rule)return null;
 const observed=new Map();
 for(const check of receipt.checks){
  if(!check.evidence.startsWith('{'))continue;
  const evidence=JSON.parse(check.evidence);
  if(evidence.ruleId===rule.id&&evidence.scope===receipt.rootId&&check.status==='passed')observed.set(evidence.assertionId,evidence);
 }
 const families=new Map(),sections={},slots=new Set(),structureHashes=[];
 for(const {id} of rule.assertions){
  const evidence=observed.get(id),[kind,label]=id.split('.');
  if(!evidence)return null;
  const ids=evidence.observed.ids;
  if(evidence.structureHash)structureHashes.push(evidence.structureHash);
  if(kind==='sections')sections[label]=ids;
  if(kind==='slots')for(const nodeId of ids)slots.add(nodeId);
  if(kind==='family')for(const nodeId of ids){
   if(families.has(nodeId))return null;
   families.set(nodeId,label);
  }
 }
 if(!Object.values(sections).some(ids=>ids.length))return null;
 return {sections,slots:[...slots],families:Object.fromEntries(families),structureHash:hash(structureHashes)};
}
function confirmsBlockers(receipt, blockers) {
 if (!receipt.passed || !blockers.length) return false;
 const identity = ({ruleId, assertionId, scope}) => JSON.stringify([ruleId, assertionId, scope]);
 const passed = new Set(receipt.checks.map(check => identity(JSON.parse(check.evidence))));
 return blockers.every(check => {
  try {
   const claim = JSON.parse(check.evidence);
   return keys(claim, ['ruleId', 'assertionId', 'scope']) &&
    Object.keys(claim).length === 3 &&
    Object.values(claim).every(value => typeof value === 'string' && value.length > 0) &&
    passed.has(identity(claim));
  } catch {
   return false;
  }
 });
}
module.exports={SCHEMA,OBSERVATION,readProfile,evaluate,hash,captureForProfile,confirmsBlockers,readContentInventory};
