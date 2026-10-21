const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{createContractDataOverview,mountContractRoutes}=require('../src/contracts/service');
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function source(id,revision=1,platform='desktop',deps=[]){const manual={component:{componentId:id,contractId:id,family:id,library:'Synthetic',platform},metadata:{revision,updatedAt:'2026-10-15'},componentDependencies:deps};return{manual,pin:{componentId:id,manualSourceHash:digest(manual)}};}
function fixture(){
 const child=source('child'),root=source('root',1,'desktop',[{componentId:'child',revision:1,manualSourceHash:child.pin.manualSourceHash}]),mobile=source('mobile',1,'mobile-web');let checkingRevision='first';
 const readChecking=()=>{const revision=checkingRevision;return{manifest:{id:revision},assertCurrent(){if(revision!==checkingRevision)throw Error('CONTRACT_RELEASE_CHANGED');},contracts:[root,child].map(c=>({source:{manual:c.manual},entry:{manualSourceHash:c.pin.manualSourceHash}}))};};
 const readTargetContext=async(input,target)=>({assertCurrent(){},packet:{contracts:input.platform==='desktop'?[root,child]:[mobile],mappings:(input.platform==='desktop'?[root,child]:[mobile]).map(c=>({id:c.pin.componentId+'.mapping',componentId:c.pin.componentId})),targetContext:{targetMapping:target==='figma'?{semanticMapping:{mappings:[{mappingId:'root.mapping',componentId:'root'}]}}:{bindings:[{componentId:'root'}]}}}});
 return{root,child,mobile,readChecking,readTargetContext,setRevision:v=>checkingRevision=v};
}
test('exact mapping and dependency closure differ from manual presence',async()=>{
 const result=await createContractDataOverview(fixture())();assert.equal(result.rows.length,3);
 const root=result.rows.find(r=>r.name==='root'),child=result.rows.find(r=>r.name==='child'),mobile=result.rows.find(r=>r.name==='mobile');
 for(const k of ['checking','figma','frontend'])assert.equal(root[k].status,'connected');
 assert.equal(child.figma.status,'dependency');assert.equal(child.frontend.status,'dependency');
 for(const k of ['checking','figma','frontend'])assert.equal(mobile[k].status,'not-connected');
 assert.equal(root.updatedAt,'2026-10-15');assert.equal(root.revision,1);assert.equal(result.executionAllowed,undefined);
});
test('overview rechecks verified release bytes instead of compiling the same release twice',async()=>{
 const f=fixture(),read=f.readChecking;let loads=0,checks=0;
 f.readChecking=()=>{loads++;return Object.assign(read(),{assertCurrent(){checks++;}});};
 const result=await createContractDataOverview(f)();assert.equal(result.sources.checking.status,'connected');assert.equal(loads,1);assert.equal(checks,2);
});
test('changed verified release checkpoint never reports checking as connected',async()=>{
 const f=fixture(),read=f.readChecking;
 f.readChecking=()=>Object.assign(read(),{assertCurrent(){throw Object.assign(Error('Release changed'),{code:'CONTRACT_V4_RELEASE_CHANGED'});}});
 const result=await createContractDataOverview(f)();assert.equal(result.sources.checking.status,'stale');assert(result.rows.every(row=>row.checking.status==='stale'));
});
test('different pinned versions stay separate; missing source date is unknown',async()=>{
 const f=fixture(),next=source('root',2);delete next.manual.metadata.updatedAt;next.pin.manualSourceHash=digest(next.manual);
 const base=f.readTargetContext;f.readTargetContext=async(i,t)=>{const c=await base(i,t);if(i.platform==='desktop')c.packet.contracts[0]=next;return c;};
 const v=await createContractDataOverview(f)(),rows=v.rows.filter(r=>r.name==='root');assert.equal(rows.length,2);assert.equal(rows.find(r=>r.revision===1).figma.status,'not-connected');assert.equal(rows.find(r=>r.revision===2).checking.status,'not-connected');assert.equal(rows.find(r=>r.revision===2).updatedAt,null);
});
test('stale/unconfigured readers preserve other sources and redact internal paths',async()=>{
 const f=fixture(),base=f.readTargetContext;f.readTargetContext=async(i,t)=>{if(t==='frontend')throw Object.assign(Error('/Users/private/token'),{code:'PRODUCER_INPUTS_STALE'});return base(i,t);};
 let v=await createContractDataOverview(f)();assert.equal(v.rows.find(r=>r.name==='root').figma.status,'connected');assert.equal(v.sources.frontend.status,'stale');assert.doesNotMatch(JSON.stringify(v),/\/Users\/|token|PRODUCER_/);
 v=await createContractDataOverview(Object.assign({},f,{nativeConfigured:false}))();assert.equal(v.sources.figma.status,'unavailable');assert.equal(v.rows.find(r=>r.name==='root').checking.status,'connected');
});
test('final readback refuses changed target or checking release',async()=>{
 const f=fixture(),base=f.readTargetContext;let checks=0,reads=0;
 f.readTargetContext=async(i,t)=>{const c=await base(i,t);if(t==='figma'&&i.platform==='desktop')c.assertCurrent=()=>{if(++checks>=3)throw Error('INPUTS_STALE');};return c;};
 const original=f.readChecking;f.readChecking=()=>{const loaded=original();return Object.assign(loaded,{assertCurrent(){if(++reads>=2)throw Error('CONTRACT_RELEASE_CHANGED');}});};
 const v=await createContractDataOverview(f)();assert.equal(v.rows.find(r=>r.name==='root').figma.status,'stale');assert.equal(v.sources.checking.status,'stale');
});
test('public route is no-store/unparameterized and precedes the id route; source details stay private',async()=>{
 const f=fixture();f.root.manual.privatePath='/Users/private/secret';f.root.manual.component.componentKey='private-key';const v=await createContractDataOverview(f)();assert.doesNotMatch(JSON.stringify(v),/private-key|privatePath|\/Users\/|componentKey/);
 const routes=[],app={get:(route,handler)=>routes.push({route,handler}),post(){}};mountContractRoutes(app,{releaseRoot:'/synthetic/missing',readTargetContext:f.readTargetContext,promptNativeConfigFile:'/synthetic/config'});
 const route=routes.find(r=>r.route==='/v2/contracts/data-overview');assert.ok(routes.indexOf(route)<routes.findIndex(r=>r.route==='/v2/contracts/:id'));
 function response(){return{code:200,headers:{},body:null,status(value){this.code=value;return this;},setHeader(k,v){this.headers[k]=v;},json(value){this.body=value;return this;}};}
 let res=response();await route.handler({query:{}},res);assert.equal(res.code,200);assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.body.schemaVersion,'apollo.contract-data.v1');res=response();await route.handler({query:{root:'/Users/private'}},res);assert.equal(res.code,400);assert.doesNotMatch(JSON.stringify(res.body),/\/Users\//);
});


test('a universal contract never shows connected when one relevant platform reader failed',async()=>{
 const f=fixture(),universal=source('universal',1,'universal'),base=f.readTargetContext;
 f.readTargetContext=async(i,t)=>{if(i.platform==='mobile-web'&&t==='figma')throw Error('OFFLINE');const c=await base(i,t);c.packet.contracts.push(universal);c.packet.mappings.push({id:'universal.mapping',componentId:'universal'});if(t==='figma')c.packet.targetContext.targetMapping.semanticMapping.mappings.push({mappingId:'universal.mapping',componentId:'universal'});return c;};
 const v=await createContractDataOverview(f)();assert.equal(v.rows.find(r=>r.name==='universal').figma.status,'unavailable');assert.equal(v.rows.find(r=>r.name==='root').figma.status,'connected');assert.equal(v.sources.figma.status,'unavailable');
});

test('metadata index is prepared at startup and repeated/concurrent reads never reload packages or planning contexts',async()=>{
 const f=fixture(),checking=f.readChecking,target=f.readTargetContext;let checkingLoads=0,targetLoads=0;
 f.readChecking=()=>{checkingLoads++;return checking();};
 f.readTargetContext=async(...args)=>{targetLoads++;return target(...args);};
 const read=createContractDataOverview(f);await read.ready;
 assert.equal(checkingLoads,1);assert.equal(targetLoads,4);
 const results=await Promise.all(Array.from({length:20},()=>read()));
 assert.equal(checkingLoads,1);assert.equal(targetLoads,4);
 assert(results.every(v=>v.rows.length===3&&v.sources.checking.status==='connected'));
});

test('index invalidates changed source connections without recompiling or rebuilding a context',async()=>{
 const f=fixture(),checking=f.readChecking,target=f.readTargetContext;let loads=0,changed=false;
 f.readChecking=()=>{loads++;return checking();};
 f.readTargetContext=async(i,t)=>{const value=await target(i,t);if(t==='figma')value.assertCurrent=()=>{if(changed)throw Error('INPUTS_STALE');};return value;};
 const read=createContractDataOverview(f);await read.ready;assert.equal((await read()).sources.figma.status,'connected');
 changed=true;f.setRevision('second');const stale=await read();
 assert.equal(stale.sources.figma.status,'stale');assert.equal(stale.sources.checking.status,'stale');assert.equal(stale.sources.frontend.status,'connected');assert.equal(loads,1);
 changed=false;f.setRevision('first');assert.equal((await read()).sources.figma.status,'connected');
});

test('a metadata reader without a freshness checkpoint cannot claim a connected index',async()=>{
 const f=fixture(),checking=f.readChecking;f.readChecking=()=>{const loaded=checking();delete loaded.assertCurrent;return loaded;};
 const value=await createContractDataOverview(f)();assert.equal(value.sources.checking.status,'unavailable');assert.equal(value.sources.figma.status,'connected');
});
