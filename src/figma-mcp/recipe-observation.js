'use strict';
// Serialized only from this trusted host module. Package data cannot supply code.
async function observeRecipeRoot(root,capture={}){
 const previousSkip=figma.skipInvisibleInstanceChildren;
 try{
 figma.skipInvisibleInstanceChildren=false;
 const fields='width height layoutMode layoutSizingHorizontal layoutSizingVertical minWidth minHeight maxWidth maxHeight paddingLeft paddingRight paddingTop paddingBottom itemSpacing counterAxisSpacing cornerRadius topLeftRadius topRightRadius bottomLeftRadius bottomRightRadius clipsContent'.split(' ');
 const limit=4096,nodes=[],seen=new Set(),original=new Map();let complete=true;
 const nativeFields=capture.nativeFields||fields.concat(['x','y','right','bottom','visible','insetTop','insetRight','insetBottom','insetLeft']);
 const safe=(n,k)=>{try{if(!(k in n))return null;const v=n[k];return typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)?v:null;}catch{return null;}};
 const properties=n=>{if(n.type!=='INSTANCE'||capture.propertyNames?.length===0)return {};try{const entries=Object.entries(n.componentProperties||{}).filter(([k])=>!capture.propertyNames||capture.propertyNames.some(name=>k===name||k.replace(/#[^#]+$/,'')===name));return JSON.parse(JSON.stringify(Object.fromEntries(entries)));}catch{return null;}};
 function readFacts(n,visible,selected){
  const wants=k=>!selected||selected.includes(k),facts={};if(wants('visible'))facts.visible=visible;
  for(const k of fields)if(wants(k)){const v=safe(n,k);if(v!==null)facts[k]=v;}
  if(wants('contentWidth')){const values=['width','paddingLeft','paddingRight'].map(k=>safe(n,k));if(values.every(Number.isFinite))facts.contentWidth=values[0]-values[1]-values[2];}
  if(!selected||selected.some(k=>k.startsWith('inset')))try{if([n.x,n.y,n.width,n.height,n.parent?.width,n.parent?.height,n.rotation].every(Number.isFinite)&&Math.abs(n.rotation)<.001)Object.assign(facts,{insetTop:n.y,insetLeft:n.x,insetBottom:n.parent.height-n.y-n.height,insetRight:n.parent.width-n.x-n.width});}catch{}
  try{if(wants('fillCount')&&Array.isArray(n.fills))facts.fillCount=n.fills.length;if(wants('gridGutter')||wants('gridColumns')){const grids=Array.isArray(n.layoutGrids)?n.layoutGrids.filter(g=>g.visible!==false&&g.pattern==='COLUMNS'):[];if(grids.length===1){if(Number.isFinite(grids[0].gutterSize))facts.gridGutter=grids[0].gutterSize;if(Number.isFinite(grids[0].count))facts.gridColumns=grids[0].count;}}}catch{}
  if(!selected||selected.some(k=>['x','y','right','bottom'].includes(k)))try{const b=n.absoluteBoundingBox;if(b&&[b.x,b.y,b.width,b.height].every(Number.isFinite))Object.assign(facts,{x:b.x,y:b.y,right:b.x+b.width,bottom:b.y+b.height});}catch{}
  return selected?Object.fromEntries(selected.filter(k=>Object.hasOwn(facts,k)).map(k=>[k,facts[k]])):facts;
 }
 function current(n,visible){
  const facts=readFacts(n,visible);
  const result={id:n.id,parentId:n.parent?.id||null,type:n.type,name:n.name,visible,facts,properties:properties(n),bindings:{},variables:{},resolved:{}};
  if(n.type==='TEXT'){try{result.text=n.characters;}catch{}}
  try{
   const source=n.boundVariables||{};
   for(const [field,value]of Object.entries(source))if((!capture.bindingFields||capture.bindingFields.includes(field))&&value?.type==='VARIABLE_ALIAS'&&typeof value.id==='string')result.bindings[field]=value.id;
   const paints=(!capture.bindingFields||capture.bindingFields.includes('fills'))&&Array.isArray(n.fills)?n.fills.filter(p=>p.visible!==false):[];
   if(paints.length===1&&paints[0].type==='SOLID'&&paints[0].boundVariables?.color?.type==='VARIABLE_ALIAS')result.bindings.fills=paints[0].boundVariables.color.id;
  }catch{}
  return result;
 }
 function walk(n,visible){
  if(seen.has(n.id)||nodes.length>=limit){complete=false;return;}
  seen.add(n.id);visible=visible&&n.visible!==false;const item=current(n,visible);nodes.push({node:n,item});
  original.set(n.id,JSON.stringify({item,children:'children'in n?n.children.map(c=>c.id):[]}));
  if('children'in n)for(const child of n.children)walk(child,visible);
 }
 let visible=true,parent=root.parent;while(parent){if('visible'in parent&&parent.visible===false)visible=false;parent=parent.parent;}
 walk(root,visible);
 const mainCache=new Map(),variableCache=new Map(),nativeById=new Map(),nativeFacts=new Map(),nativeChildren=new Map();
 const items=new Map(nodes.map(n=>[n.item.id,n.item])),nativeNeeded=new Set();
 for(const {item}of nodes)if(!capture.nativeTargets||capture.nativeTargets.some(m=>(m.type===undefined||m.type===item.type)&&(m.name===undefined||(Array.isArray(m.name)?m.name:[m.name]).includes(item.name)))){let n=item;while(n&&!nativeNeeded.has(n.id)){nativeNeeded.add(n.id);n=items.get(n.parentId);}}
 const main=async n=>{if(!mainCache.has(n.id))mainCache.set(n.id,Promise.resolve().then(()=>n.getMainComponentAsync()).catch(()=>null));return mainCache.get(n.id);};
 const variable=id=>{if(!variableCache.has(id))variableCache.set(id,Promise.resolve().then(()=>figma.variables.getVariableByIdAsync(id)).catch(()=>null));return variableCache.get(id);};
 const ids=[...new Set(nodes.flatMap(({item})=>Object.entries(item.bindings).filter(([field])=>!capture.variableFields||capture.variableFields.includes(field)||!capture.resolvedFields||capture.resolvedFields.includes(field)).map(([,id])=>id)))];
 const prefetchVariables=(async()=>{for(let i=0;i<ids.length;i+=64)await Promise.all(ids.slice(i,i+64).map(variable));})();
 const instances=nodes.filter(n=>n.item.type==='INSTANCE');
 for(let i=0;i<instances.length;i+=64)await Promise.all(instances.slice(i,i+64).map(n=>main(n.node)));
 await prefetchVariables;
 for(const {node,item}of nodes){
  let native=nativeById.get(node.id)||null;
  if(item.type==='INSTANCE'){
   const component=await main(node);
   if(component){item.componentKey=component.key;if(component.parent?.type==='COMPONENT_SET')item.familyKey=component.parent.key;else item.familyKey=component.key;if(nativeNeeded.has(item.id))native=component;}
  }
  if(native){
   if(!nativeFacts.has(native.id))nativeFacts.set(native.id,readFacts(native,true,nativeFields));item.native=nativeFacts.get(native.id);
   if('children'in node&&'children'in native){
    if(!nativeChildren.has(native.id)){const matches=new Map();for(const child of native.children){const key=JSON.stringify([child.type,child.name]);matches.set(key,matches.has(key)?null:child);}nativeChildren.set(native.id,matches);}
    const matches=nativeChildren.get(native.id);for(const child of node.children)if(nativeNeeded.has(child.id)){const saved=items.get(child.id),matching=saved&&matches.get(JSON.stringify([saved.type,saved.name]));if(matching)nativeById.set(child.id,matching);}
   }
  }
  for(const [field,id]of Object.entries(item.bindings)){
   if(capture.variableFields&&!capture.variableFields.includes(field)&&capture.resolvedFields&&!capture.resolvedFields.includes(field))continue;
   try{
    const resolvedVariable=await variable(id);
    if(resolvedVariable){if(!capture.variableFields||capture.variableFields.includes(field))item.variables[field]=resolvedVariable.key;if(!capture.resolvedFields||capture.resolvedFields.includes(field)){const value=resolvedVariable.resolveForConsumer(node).value;if(typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean'||typeof value==='string'||value&&['r','g','b'].every(k=>Number.isFinite(value[k])))item.resolved[field]=value;}}
   }catch{}
  }
 }
 // Async main/variable reads may yield to edits. Re-read every observed node and
 // edge after them; an unstable tree cannot authorize approval.
 for(const {node,item}of nodes){
  let actualVisible=true,n=node;while(n){if('visible'in n&&n.visible===false)actualVisible=false;n=n.parent;}
  const now=current(node,actualVisible);
  if(original.get(node.id)!==JSON.stringify({item:now,children:'children'in node?node.children.map(c=>c.id):[]}))complete=false;
 }
 const value={schemaVersion:'apollo.recipe-observation.v1',rootId:root.id,complete,nodes:nodes.map(n=>n.item)};
 if(JSON.stringify(value).length>6*1024*1024)return {schemaVersion:value.schemaVersion,rootId:root.id,complete:false,nodes:[],reason:'output-limit'};
 return value;
 }finally{figma.skipInvisibleInstanceChildren=previousSkip;}
}
module.exports={observeRecipeRoot};
