'use strict';
const crypto=require('node:crypto'),equal=require('node:util').isDeepStrictEqual;
const {SLOT_CONTENT_REPLACEMENT}=require('../skills/catalog');
const {sameNode}=require('./native-state');
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=()=>{throw Object.assign(Error('LANDING_SLOT_REPLACEMENT_UNCONFIRMED'),{code:'LANDING_SLOT_REPLACEMENT_UNCONFIRMED',status:409});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&equal(Object.keys(v).sort(),keys.slice().sort());
function validate(recipe){
 if(!exact(recipe,['schemaVersion','id','containerKey','slot','defaultChildren'])||recipe.schemaVersion!=='apollo.slot-content-replacement.v1'||typeof recipe.id!=='string'||!/^[-.\w]{1,128}$/.test(recipe.id)||!/^[a-f0-9]{40}$/.test(recipe.containerKey||'')||!exact(recipe.slot,['type','name'])||recipe.slot.type!=='SLOT'||typeof recipe.slot.name!=='string'||!recipe.slot.name||recipe.slot.name.length>400)fail();
 let count=0;
 const nodes=(rows,depth)=>{
  if(!Array.isArray(rows)||rows.length>16||depth>8)fail();
  for(const n of rows){
   if(++count>128||!['FRAME','TEXT'].includes(n?.type)||!exact(n,['type','name','children'].concat(n.type==='TEXT'?['characters']:[]))||typeof n.name!=='string'||!n.name||n.name.length>400||!Array.isArray(n.children)||n.type==='TEXT'&&(typeof n.characters!=='string'||n.characters.length>4000||n.children.length))fail();
   nodes(n.children,depth+1);
  }
 };
 nodes(recipe.defaultChildren,0);if(!count)fail();return recipe;
}
function fromReads(id,sources,reads,decision,capability){
 if(capability!==SLOT_CONTENT_REPLACEMENT||typeof id!=='string'||decision.container.type!=='INSTANCE'||decision.mount.type!=='SLOT')fail();
 const found=[];
 for(const source of sources){
  const read=reads.find(r=>r.mode==='read'&&!r.error&&!r.tooLarge&&typeof r.text==='string'&&r.id===source.id&&r.sha256===source.sha256&&equal(r.path,source.path)&&r.offset===source.offset);
  if(!read)continue;
  for(const match of read.text.matchAll(/```apollo-slot-content-replacement\s*\n([\s\S]*?)\n```/g)){
   let recipe;try{recipe=JSON.parse(match[1]);}catch{fail();}
   if(recipe?.id===id){validate(recipe);if(recipe.containerKey!==decision.container.componentKey)fail();found.push({...recipe,source:{id:source.id,sha256:source.sha256,path:source.path,offset:source.offset}});}
  }
 }
 if(found.length!==1)fail();return found[0];
}
function subtree(nodes,parentId){
 const result=[],pending=nodes.filter(n=>n.parentId===parentId),seen=new Set();
 while(pending.length){const n=pending.shift();if(seen.has(n.id)||result.length>=128)fail();seen.add(n.id);result.push(n);pending.push(...nodes.filter(v=>v.parentId===n.id));}
 return result;
}
function bind(plan,base,readback,fresh){
 const recipe=plan?.slotContentRecipe;if(!recipe)return null;
 if(!fresh||!base||base.container.componentKey!==recipe.containerKey&&base.container.componentSetKey!==recipe.containerKey||base.mount.type!==recipe.slot.type||base.mount.name!==recipe.slot.name)fail();
 const nodes=subtree(readback.native.nodes,base.mount.id);
 const shape=parent=>nodes.filter(n=>n.parentId===parent).map(n=>({type:n.type,name:n.name,...(n.type==='TEXT'?{characters:n.characters}:{}),children:shape(n.id)}));
 if(nodes.some(n=>n.sectionId!==null)||!equal(shape(base.mount.id),recipe.defaultChildren))fail();
 return {sourcePin:plan.sourcePin,foundationPlanHash:sha(plan),rootNodeId:readback.rootNodeId,containerId:base.container.id,mountId:base.mount.id,nodes:JSON.parse(JSON.stringify(nodes)),...(readback.native.modeDefaults?{modeDefaults:readback.native.modeDefaults}:{}),consumed:false};
}
function removals(spec,state,before,after,base){
 const binding=state.slotContentReplacement;
 if(!binding||binding.consumed)return null;
 const ids=new Set(binding.nodes.map(n=>n.id)),missing=binding.nodes.filter(n=>!after.native?.nodes.some(v=>v.id===n.id));
 if(!missing.length)return null;
 const plan=spec?.foundation?.plan,active=state.activeSectionId,section=spec?.sections.find(s=>s.id===active),rows=after.sections.filter(s=>s.sectionId===active),node=base?.byId.get(rows[0]?.id),root=section?.structurePlan?.decision.root;
 if(!state.freshFoundation||state.recipeOperations!==SLOT_CONTENT_REPLACEMENT||state.stage!=='structure'||active!==state.queue[0]||state.structures.length||state.completed.length||before.sections.some(s=>s.sectionId!==active)||!plan||binding.sourcePin!==state.sourcePin||binding.foundationPlanHash!==sha(plan)||binding.rootNodeId!==before.rootNodeId||binding.rootNodeId!==after.rootNodeId||!base||base.container.id!==binding.containerId||base.mount.id!==binding.mountId||missing.length!==ids.size||rows.length!==1||!node||node.sectionId!==active||node.parentId!==binding.mountId||node.type!==root?.type||root.type==='INSTANCE'&&node.componentKey!==root.componentKey&&node.componentSetKey!==root.componentKey)fail();
 const actual=subtree(before.native.nodes,binding.mountId).filter(n=>n.sectionId!==active);
 if(actual.length!==ids.size||actual.some(n=>!binding.nodes.some(old=>n.id===old.id&&sameNode(old,n,{schemaVersion:binding.modeDefaults?'apollo.landing-native.v2':'apollo.landing-native.v1',modeDefaults:binding.modeDefaults},before.native))))fail();
 if(before.native.nodes.some(n=>n.parentId===binding.mountId&&!ids.has(n.id)&&n.sectionId!==active))fail();
 return {ids,blockId:node.id};
}
function retained(binding,readback,base){
 if(!binding)return true;
 if(!base||!readback.native?.nodes||base.container.id!==binding.containerId||base.mount.id!==binding.mountId||readback.rootNodeId!==binding.rootNodeId)return false;
 if(binding.consumed)return !readback.native.nodes.some(n=>binding.nodes.some(old=>old.id===n.id))&&readback.sections.some(s=>s.id===binding.blockId)&&base.byId.get(binding.blockId)?.parentId===binding.mountId;
 const actual=subtree(readback.native.nodes,binding.mountId).filter(n=>n.sectionId===null);
 return actual.length===binding.nodes.length&&actual.every(n=>binding.nodes.some(old=>n.id===old.id&&sameNode(old,n,{schemaVersion:binding.modeDefaults?'apollo.landing-native.v2':'apollo.landing-native.v1',modeDefaults:binding.modeDefaults},readback.native)));
}
module.exports={fromReads,bind,removals,retained};
