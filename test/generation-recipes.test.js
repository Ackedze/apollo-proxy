const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRecipeCatalog,mountRecipeRoutes}=require('../src/generation-agent/recipe-catalog');
function plateSpec(count=4){
 const items=Array.from({length:count},(_,i)=>({kind:'component',id:'plate'+i,mappingId:'arui-private.background-plate.slot.desktop',props:{Type:'Primary',Skeleton:'False'},slots:{Slot:[]}})),rows=[];
 for(let i=0;i<count;i+=2)rows.push({kind:'stack',id:'row'+i,direction:'horizontal',gap:24,children:items.slice(i,i+2).map(n=>n.id)});
 return{schemaVersion:'apollo.screen-spec.v2-experimental',id:'plate-test',platform:'desktop',viewport:{width:1600,height:900},root:'content',nodes:[{kind:'component',id:'content',mappingId:'arui-private.corporate-content.desktop',props:{},slots:{body:rows.map(n=>n.id)}},...rows,...items],states:{initial:'default',values:['default']},events:[],transitions:[],unresolved:[],capabilityGaps:[]};
}
test('index is compact, contains target-specific readiness and no construction bodies or workspace paths',()=>{
 const c=createRecipeCatalog(),index=c.index();assert.equal(index.recipes.length,1);assert.equal(index.recipes[0].adapters.frontend,'not-tested');assert.equal(c.index('frontend').recipes.length,0);assert(Buffer.byteLength(JSON.stringify(index))<2048);assert(!JSON.stringify(index).includes('assembly'));assert(!JSON.stringify(c.get(index.recipes[0].id)).includes('/Users/'));assert.throws(()=>c.index('shell'),/RECIPE_TARGET_INVALID/);assert.throws(()=>c.get('../../etc/passwd'),/RECIPE_NOT_FOUND/);
});
test('selection preserves the tested count, exact tree, variants, empty content and viewport boundaries',()=>{
 const c=createRecipeCatalog();for(const n of [4,5])assert.equal(c.select(plateSpec(n)).selected.length,1);
 const wrapped=plateSpec();wrapped.nodes.push({kind:'stack',id:'wrapper',direction:'vertical',gap:24,children:wrapped.nodes[0].slots.body});wrapped.nodes[0].slots.body=['wrapper'];assert.equal(c.select(wrapped).selected.length,1);
 const cases=[s=>s.viewport.width=1200,s=>s.platform='mobile-web',s=>s.nodes.at(-1).props.Type='Secondary',s=>s.nodes.at(-1).slots.Slot=['text'],s=>s.nodes.push({kind:'component',id:'button',mappingId:'unrelated'}),s=>s.nodes[1].gap=32,s=>s.nodes[1].children.reverse()&&s.nodes[1].children.push(s.nodes[1].children[0]),s=>s.nodes[0].props.background='red'];
 for(const change of cases){const s=plateSpec();change(s);assert.equal(c.select(s).selected.length,0);}
 assert.equal(c.select(plateSpec(6)).selected.length,0);
});
test('changing a recipe after catalog creation refuses further delivery instead of using stale bytes',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apollo-recipes-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'catalog.json');fs.copyFileSync(path.join(__dirname,'../recipes/catalog.json'),file);const c=createRecipeCatalog({file});fs.appendFileSync(file,'\n');assert.throws(()=>c.select(plateSpec()),/RECIPE_CATALOG_STALE/);assert.throws(()=>c.index(),/RECIPE_CATALOG_STALE/);
});
test('metadata and body endpoints serve JSON without an agent call',()=>{
 const routes=new Map();mountRecipeRoutes({get:(url,fn)=>routes.set(url,fn)});let body,status=200,cache;
 const res={setHeader:(k,v)=>cache=v,json:v=>body=v,status:n=>{status=n;return res;}};
 routes.get('/recipes')({query:{}},res);assert.equal(body.recipes[0].id,'layout.two-column-plates');assert.equal(cache,'no-store');
 routes.get('/recipes/:id')({params:{id:'layout.two-column-plates'}},res);assert.equal(body.recipe.assembly.length,7);
 routes.get('/recipes/:id')({params:{id:'missing'}},res);assert.equal(status,404);assert.equal(body.code,'RECIPE_NOT_FOUND');
});
module.exports={plateSpec};
