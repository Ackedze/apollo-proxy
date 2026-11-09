'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSourcePlanner}=require('../src/landing/source-plan');
const {selectHubDocuments}=require('../src/knowledge-routing/hub-documents');
const HUB='knowledge/data/ds-ai-hub/',SKILL='skills/landing/';
function fixture(){
 const resources=new Map(),bodies=new Map(),units=[];let stale=false,reads=0;
 const add=(id,body='rule')=>{const file=id.startsWith('skills/')||id.startsWith('workflow/')?id:HUB+id;resources.set(file,{file,sha256:'a'.repeat(64),bytes:100});bodies.set(file,body);return file;};
 const required=Array.from({length:10},(_,i)=>add('products/ab/patterns/required-'+i+'.md'));
 add('AGENTS.md');add('workflow/figma-use/SKILL.md');add('workflow/figma-generate-design/SKILL.md');add(SKILL+'SKILL.md');
 const refs=['brief','composition','page-layout','component-selection','content-and-assets','changes'];
 for(const name of refs)add(SKILL+'references/rules/'+name+'.md');
 add(SKILL+'references/proxy.md');add(SKILL+'references/run-contract.md');
 const skill={id:'landing',bodies:{'SKILL.md':refs.map(name=>'[rule](references/rules/'+name+'.md)').join('\n')+'\n[proxy](references/proxy.md)\n[run](references/run-contract.md)'},generation:{requiredResources:required,initialFiles:['SKILL.md'],initialQueries:['products/ab/components/','products/ab/patterns/']}};
 function component(folder,id,keyword){
  add('products/ab/components/'+folder+'/meta.json',{id,keywords:[keyword]});
  for(const [suffix,file] of [['.instructions','instructions.md'],['.adapter.figma','adapter.figma.md']]){const relative='products/ab/components/'+folder+'/'+file;add(relative);units.push({id:id+suffix,path:relative,platforms:['web'],targets:['figma']});}
 }
 component('benefits','BenefitsBlock','преимущества');for(let i=0;i<8;i++)component('other-'+i,'Other'+i,'дополнительный');
 const excluded=add('products/ab/patterns/code-only.md');units.push({id:'CodeOnly',path:excluded,platforms:['web'],targets:['code']});
 add('registry/index.json',{units});add('products/other/patterns/преимущества.md');
 const plan=createSourcePlanner({resources,skill,sourcePin:'accepted-pin',releaseId:'release',metadata:id=>{reads++;return bodies.get(id);},assertCurrent(){if(stale)throw Object.assign(Error('stale'),{code:'LANDING_DATA_STALE'});},routing:folder=>{
  const id=bodies.get(folder+'/meta.json').id;return selectHubDocuments({units,componentIds:[id],availableIds:[...resources.keys()]});
 }});
 return {plan,resources,required,excluded,stale:()=>{stale=true;},reads:()=>reads};
}
test('Russian brief finds component keywords and keeps required sources outside candidate limits',()=>{
 const f=fixture(),p=f.plan({phase:'structure',query:'Покажи преимущества и дополнительный блок'});
 assert.equal(p.sourcePin,'accepted-pin');assert.equal(p.phase,'structure');assert.equal(p.candidates[0].id,HUB+'products/ab/components/benefits/meta.json');
 assert.equal(p.candidates.length,6);for(const id of f.required)assert(p.required.some(row=>row.id===id));
 assert(p.candidates[0].beforeUse.some(row=>row.id.endsWith('/adapter.figma.md')));assert(p.candidates[0].beforeUse.every(row=>row.sha256==='a'.repeat(64)));
 assert(p.required.every(row=>row.readState==='unread'));assert(!JSON.stringify(p).includes('products/other/'));
 assert(Buffer.byteLength(JSON.stringify(p))<16384);assert.match(p.instruction,/not evidence of reading/);
});
test('structure/content and resume use existing linked skill phase references, with no inline rule copies',()=>{
 const f=fixture(),a=f.plan({phase:'structure'}),b=f.plan({phase:'content',resuming:true,providedIds:[SKILL+'SKILL.md']});
 assert(a.required.some(row=>row.id.endsWith('/brief.md')));assert(!a.required.some(row=>row.id.endsWith('/content-and-assets.md')));
 assert(b.required.some(row=>row.id.endsWith('/content-and-assets.md')));assert(b.required.some(row=>row.id.endsWith('/changes.md')));assert(!b.required.some(row=>row.id.endsWith('/composition.md')));
 assert.equal(b.required.find(row=>row.id===SKILL+'SKILL.md').readState,'provided-in-session');assert(b.required.every(row=>!Object.hasOwn(row,'text')));
});
test('unknown search and missing/inapplicable metadata preserve explicit gaps and fallback',()=>{
 const f=fixture(),p=f.plan({phase:'content',query:'code-only'});assert(!p.candidates.some(row=>row.id===f.excluded));assert(p.gaps.some(g=>g.code==='SOURCE_PLAN_NO_QUERY_MATCH'));assert(p.nextSearch.length);
 const second=fixture();second.resources.delete(HUB+'registry/index.json');const q=second.plan({phase:'structure',query:'преимущества'});assert(q.gaps.some(g=>g.code==='SOURCE_PLAN_METADATA_MISSING'));for(const id of second.required)assert(q.required.some(row=>row.id===id));
});
test('read ledger requires matching pin and complete observed ranges; old offsets alone stay partial',()=>{
 const f=fixture(),id=f.required[0],row={id,sha256:'a'.repeat(64),path:[],offset:0};
 const state=ledger=>f.plan({phase:'structure',ledger}).required.find(r=>r.id===id).readState;
 assert.equal(state([row]),'partial');assert.equal(state([{...row,returned:5,total:10,next:5}]),'partial');
 assert.equal(state([{...row,returned:5,total:10,next:5},{...row,offset:5,returned:5,total:10,next:null}]),'read');
 assert.equal(state([{...row,returned:20,total:10,next:null}]),'partial');assert.equal(state([{...row,returned:5,total:10,next:5},{...row,offset:5,returned:5,total:20,next:10}]),'partial');
 assert.equal(state([{...row,sha256:'b'.repeat(64),returned:10,total:10,next:null}]),'unread');assert.equal(state([{...row,path:['child'],returned:10,total:10,next:null}]),'unread');
});
test('cached index still checks source freshness and phase admission every time',()=>{
 const f=fixture();f.plan({phase:'structure'});const n=f.reads();f.plan({phase:'content'});assert.equal(f.reads(),n);assert.throws(()=>f.plan({phase:'other'}),{code:'LANDING_SOURCE_PHASE_INVALID'});f.stale();assert.throws(()=>f.plan({phase:'structure'}),{code:'LANDING_DATA_STALE'});
});
