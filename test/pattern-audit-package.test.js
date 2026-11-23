'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./pattern-audit.test'),{HUB}=require('../src/pattern-audit/knowledge');
const {mountConfiguredPatternRoutes}=require('../src/pattern-audit/runtime');
const apollo=process.env.APOLLO_PROJECT_ROOT||path.resolve(__dirname,'../../../projects/Apollo');
const p=require(path.join(apollo,'src/figma-audit/protocol'));
const {createPatternAuditClient}=require(path.join(apollo,'src/skills/pattern-audit/client'));
const {createFigmaAuditBridge}=require(path.join(apollo,'src/figma-audit/native'));
const step=(action,extra={})=>Object.assign({action,query:'',resourceId:'',offset:0,nodeIds:[],plan:[],checks:[],summary:'Synthetic MD-only check',gaps:[],excluded:[],documents:[]},extra);
test('independent endpoint completes native→MD→agent→report with exact saved input and owned exports',async t=>{
 const f=fixture(t),sourceId=HUB+'products/ab/patterns/layout.md',quote='Между самостоятельными блоками формы используйте 24 px.';
 const plan=[{id:'gap',sourceId,rule:'layout gap',targets:['root'],requiredFields:[{id:'gap-value',field:'itemSpacing',nodeId:'root',role:'target'}]}];
 const check={id:'gap',status:'FAIL',actual:'12 px',expected:'24 px',fix:'Use 24 px',reason:'Fixture gap differs from pinned MD.',severity:'error',sourceQuote:quote,evidenceIds:['native-1'],factBindings:[{factId:'gap-value',evidenceId:'native-1'}]};
 const actions=[step('read_document',{resourceId:sourceId}),step('plan',{plan}),step('read_nodes',{nodeIds:['root']}),step('begin_report'),step('finish',{checks:[check]})],prompts=[],routes=new Map();
 const app={get:(url,handler)=>routes.set('GET '+url,handler),post:(url,handler)=>routes.set('POST '+url,handler)};
 const mounted=mountConfiguredPatternRoutes(app,Object.assign({},f,{root:path.join(f.home,'runs'),environment:{},createCli:()=>({run:async options=>{
  const payload=JSON.parse(options.prompt);assert.equal(options.profile,'figma-audit');assert.equal(payload.overrideCoverage,null);assert.equal(payload.customizationFacts,null);
  assert.equal(payload.documentRouting,null);assert(!JSON.stringify(payload.initial).includes('componentContractIndex'));prompts.push(options.prompt);
  return {result:actions.shift(),receipt:{usage:{measurementId:'fixture-'+prompts.length,actualInputTokens:10,actualOutputTokens:2}}};
 }})}));
 const dispatch=(url,options={})=>{
  const u=new URL(url),request=u.pathname.match(/\/requests\/([^/]+)(?:\/cancel)?$/),run=u.pathname.match(/\/runs\/([^/]+)(?:\/(context|cancel|input))?$/);
  const route=request?u.pathname.replace(request[1],':requestId'):run?u.pathname.replace(run[1],':id'):u.pathname,handler=routes.get((options.method||'GET')+' '+route);assert(handler,route);
  let status=200,body;handler({body:options.body?JSON.parse(options.body):{},params:{requestId:request?decodeURIComponent(request[1]):undefined,id:run?.[1]},query:Object.fromEntries(u.searchParams)},{json:value=>{body=value;},status:value=>{status=value;return {json:v=>{body=v;}};}});return {ok:status===200,status,json:async()=>body};
 };
 const page={id:'page',type:'PAGE'},root={id:'root',name:'Selected form',type:'FRAME',parent:page,children:[],itemSpacing:12,fills:[]};page.selection=[root];
 let client;const bridge=createFigmaAuditBridge({api:{currentPage:page,viewport:{scrollAndZoomIntoView:()=>{}}},hash:JSON.stringify,post:message=>client.accept(message)});
 client=createPatternAuditClient({send:message=>bridge.accept(message),request:async(url,options)=>dispatch(url,options)});client.selection({id:'root',pageId:'page',valid:true});
 await client.start();const state=client.getState();assert.equal(state.status,'done',state.error);assert.equal(state.report.findings[0].status,'FAIL');assert.equal(state.report.skill.id,'pattern-audit');assert.equal(mounted.isBusy(),false);assert.equal(prompts.length,5);
 page.selection=[];client.selection({id:'',pageId:'page',valid:false});await client.focus('root');assert.deepEqual(page.selection,[root]);
 const input=await dispatch('http://localhost:3001/skills/pattern-audit/runs/'+state.run.runId+'/input?requestId='+state.run.requestId).json();
 assert.equal(input.success,true);assert.equal(input.input.steps.length,5);assert.deepEqual(input.input.steps.map(s=>s.prompt),prompts);
 const foreign=dispatch('http://localhost:3001/skills/pattern-audit/runs/'+state.run.runId+'/input?requestId=foreign');assert.equal(foreign.status,404);assert.equal((await foreign.json()).success,false);
 assert.equal(routes.has('GET /skills/figma-audit/status'),false,'pattern route must not alias old tool state');
});
test('the existing audit runtime keeps its default routes and disabled input-export',t=>{
 const f=fixture(t),routes=new Map(),app={get:(p,h)=>routes.set('GET '+p,h),post:(p,h)=>routes.set('POST '+p,h)};
 require('../src/figma-audit/runtime').mountConfiguredAuditRoutes(app,Object.assign({},f,{root:path.join(f.home,'legacy'),environment:{}}));
 assert(routes.has('GET /skills/figma-audit/status'));assert.equal(routes.has('GET /skills/figma-audit/runs/:id/input'),false);
});
