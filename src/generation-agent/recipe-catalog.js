'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v));
const fail=(code,status=503)=>{throw Object.assign(Error(code),{code,status});};

// Server-owned construction data. Never execute recipe text or accept a client file path.
function createRecipeCatalog({file=path.join(__dirname,'../../recipes/catalog.json')}={}){
 const bytes=fs.readFileSync(file);if(bytes.length>262144)fail('RECIPE_CATALOG_LIMIT');
 const pin=digest(bytes),data=JSON.parse(bytes),ids=new Set();
 if(data.schemaVersion!=='apollo.recipe-catalog.v1'||!Array.isArray(data.recipes)||data.recipes.length>32)fail('RECIPE_CATALOG_INVALID');
 for(const r of data.recipes){
  if(!/^[a-z][a-z0-9.-]{0,95}$/.test(r.id)||ids.has(r.id)||!Number.isSafeInteger(r.revision)||r.revision<1||typeof r.purpose!=='string'||r.purpose.length>512||!['figma','frontend'].every(t=>['authoring-verified','not-tested'].includes(r.adapters?.[t]?.status))||!r.match||!Array.isArray(r.match.itemCounts)||r.match.itemCounts.some(n=>!Number.isSafeInteger(n)||n<1)||typeof r.match.rootMappingId!=='string'||typeof r.match.itemMappingId!=='string'||!Array.isArray(r.assembly))fail('RECIPE_CATALOG_INVALID');
  ids.add(r.id);
  const m=r.match;if(m.kind!=='uniform-grid'||!['desktop','mobile-web'].includes(m.platform)||!m.viewport||!Object.values(m.viewport).every(n=>Number.isSafeInteger(n)&&n>0)||typeof m.rootSlot!=='string'||!Number.isSafeInteger(m.columns)||m.columns<1||!Number.isFinite(m.gap)||m.gap<0||!m.itemProps||typeof m.itemProps!=='object'||typeof r.planning!=='string'||r.planning.length>512)fail('RECIPE_CATALOG_INVALID');
 }
 const assertCurrent=()=>{try{if(digest(fs.readFileSync(file))!==pin)fail('RECIPE_CATALOG_STALE');}catch{fail('RECIPE_CATALOG_STALE');}};
 const metadata=r=>({id:r.id,revision:r.revision,purpose:r.purpose,sha256:digest(JSON.stringify(r)),applicability:clone(r.match),planning:r.planning,adapters:{figma:r.adapters.figma.status,frontend:r.adapters.frontend.status},Ready:false});
 function index(target='figma'){if(!['figma','frontend'].includes(target))fail('RECIPE_TARGET_INVALID',400);assertCurrent();return{schemaVersion:data.schemaVersion,catalogHash:pin,target,recipes:data.recipes.filter(r=>r.adapters[target]?.status==='authoring-verified').map(metadata)};}
 function get(id){assertCurrent();const r=data.recipes.find(r=>r.id===id);if(!r)fail('RECIPE_NOT_FOUND',404);return clone(r);}
 function select(spec){
  assertCurrent();const available=index('figma');
  const recipes=data.recipes.filter(r=>r.adapters.figma.status==='authoring-verified').filter(r=>{
   const m=r.match,nodes=spec?.nodes||[],components=nodes.filter(n=>n.kind==='component'),items=components.filter(n=>n.mappingId===m.itemMappingId),root=nodes.find(n=>n.id===spec.root);
   if(spec.platform!==m.platform||spec.viewport?.width!==m.viewport.width||spec.viewport?.height!==m.viewport.height||root?.mappingId!==m.rootMappingId||!m.itemCounts.includes(items.length)||components.length!==items.length+1||components.filter(n=>n.mappingId===m.rootMappingId).length!==1)return false;
   // An empty-plate recipe must never replace requested content, appearance, or actions.
   if(items.some(n=>Object.values(n.slots||{}).some(v=>!Array.isArray(v)||v.length)||n.actions||Object.entries(n.props||{}).some(([k,v])=>!Object.hasOwn(m.itemProps,k)||m.itemProps[k]!==v)))return false;
   if(Object.keys(root.props||{}).length||root.actions||Object.keys(root.slots||{}).some(k=>k!==m.rootSlot))return false;
   const byId=new Map(nodes.map(n=>[n.id,n]));let children=root.slots?.[m.rootSlot];if(!Array.isArray(children))return false;
   // A legacy planner may add one vertical wrapper. Preserve its declared node when present.
   if(children.length===1&&byId.get(children[0])?.kind==='stack'&&byId.get(children[0]).direction==='vertical'){
    const wrapper=byId.get(children[0]);if(wrapper.gap!==m.gap)return false;children=wrapper.children;
   }
   const ordered=[];for(const id of children){const row=byId.get(id);if(row?.kind!=='stack'||row.direction!=='horizontal'||row.gap!==m.gap||row.children.length<1||row.children.length>m.columns)return false;ordered.push(...row.children);}
   return ordered.length===items.length&&new Set(ordered).size===items.length&&ordered.every(id=>items.some(n=>n.id===id))&&children.length===Math.ceil(items.length/m.columns)&&children.slice(0,-1).every(id=>byId.get(id).children.length===m.columns);
  }).map(clone);
  return{catalogHash:pin,index:available.recipes,selected:recipes,Ready:false};
 }
 return{index,get,select,assertCurrent};
}
function mountRecipeRoutes(app,{catalog=createRecipeCatalog()}={}){
 const respond=(res,action)=>{try{const value=action();res.setHeader('Cache-Control','no-store');res.json({success:true,...value});}catch(e){res.status(e.status||503).json({success:false,code:e.code||'RECIPE_CATALOG_UNAVAILABLE'});}};
 app.get('/recipes',(req,res)=>respond(res,()=>catalog.index(req.query.target||'figma')));
 app.get('/recipes/:id',(req,res)=>respond(res,()=>({recipe:catalog.get(req.params.id)})));
}
module.exports={createRecipeCatalog,mountRecipeRoutes};
