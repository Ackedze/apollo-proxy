'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createRootLifecycle,rootScript,verifiedRoot,sectionBounds}=require('../src/figma-mcp/root-lifecycle');
const NAME='apollo_figma_mcp',URL='https://mcp.figma.com/mcp',UUID='12345678-1234-4234-8234-123456789abc';
const input={fileKey:'FixtureFile',pageId:'1:2',parentId:'1:2',type:'SECTION',chatId:UUID,ownerNonce:'a'.repeat(64),rootId:null};
function graph(){
 const nodes=new Map(),mutations=[];let seq=0;
 function node(type,id){const n={id:id||'30:'+ ++seq,type,parent:null,children:[],visible:true,x:0,y:0,width:100,height:100,rotation:0,shared:{},getSharedPluginData(ns,k){assert.equal(ns,'apollolanding');return this.shared[k]||'';},setSharedPluginData(ns,k,v){assert.equal(ns,'apollolanding');this.shared[k]=v;mutations.push(['tag',this.id,k]);},appendChild(c){if(c.parent)c.parent.children=c.parent.children.filter(x=>x!==c);c.parent=this;this.children.push(c);mutations.push(['append',this.id,c.id]);},resizeWithoutConstraints(w,h){this.width=w;this.height=h;mutations.push(['resize',this.id,w,h]);}};nodes.set(n.id,n);return n;}
 const page=node('PAGE','1:2'),other=node('PAGE','9:9');
 const figma={getNodeByIdAsync:async id=>nodes.get(id)||null,createSection:()=>node('SECTION'),createFrame:()=>node('FRAME')};
 const execute=code=>new vm.Script('(async()=>{'+code+'})()').runInNewContext({figma});
 return {node,nodes,page,other,mutations,execute};
}
const schema=keys=>({type:'object',properties:Object.fromEntries(keys.map(k=>[k,{type:'string'}])),required:keys,additionalProperties:false});
function transport(g,scenario='ok'){
 const messages=[],options=[],kills=[],launchArgs=[];
 const spawnProcess=(binary,args,opts)=>{
  assert.equal(binary,'fake-codex');assert.deepEqual(args.slice(-2),['app-server','--stdio']);assert(args.includes('mcp_oauth_credentials_store="auto"'));assert(args.includes('features.shell_tool=false'));assert(args.some(a=>a.startsWith('mcp_servers={apollo_figma_mcp=')));assert.equal(opts.shell,false);assert.equal(opts.env.SECRET,undefined);options.push(opts);launchArgs.push(args);
  const child=new EventEmitter();child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();
  const close=code=>{if(child.exitCode!==null)return;child.exitCode=code;queueMicrotask(()=>child.emit('close',code));};child.kill=sig=>{kills.push(sig);close(143);};
  const launch=launchArgs.length;
  child.stdin=new Writable({write(b,enc,cb){const m=JSON.parse(b);messages.push(m);cb();if(!m.id||!m.method)return;
   if(scenario==='hang')return;
   if(scenario==='interactive'&&m.method==='initialize'){queueMicrotask(()=>child.stdout.write(JSON.stringify({id:'approval',method:'item/tool/requestApproval',params:{}})+'\n'));return;}
   if(scenario==='turn'&&m.method==='initialize'){queueMicrotask(()=>child.stdout.write(JSON.stringify({method:'turn/started'})+'\n'));return;}
   Promise.resolve().then(async()=>{
    const inherited=scenario==='merged'?Object.fromEntries(['node_repl','alfa_corp','figma'].map(n=>[n,{enabled:!args.includes('mcp_servers.'+n+'.enabled=false')}])):scenario==='foreign-server'?{foreign:{enabled:true,url:'https://invalid'}}:scenario==='unsafe-server'?{'bad.name':{enabled:true}}:{};
    let result={};if(m.method==='config/read')result={config:{mcp_servers:{...inherited,[NAME]:{enabled:true,url:URL,enabled_tools:['create_session','use_figma']}}}};
    if(m.method==='thread/start')assert(Object.values(inherited).every(v=>v.enabled===false),'no inherited MCP server can start');
    if(m.method==='thread/start'){assert.equal(m.params.ephemeral,true);assert.equal(m.params.approvalPolicy,'never');assert.equal(m.params.sandbox,'read-only');result={thread:{id:UUID}};}
    if(m.method==='mcpServerStatus/list')result={data:[{name:NAME,httpOrigin:'https://mcp.figma.com',authStatus:scenario==='auth'?'notLoggedIn':'oAuth',tools:{create_session:{inputSchema:schema(['fileKey','description'])},use_figma:{inputSchema:schema(['fileKey','sessionId','skillNames','description','code'])}}}],nextCursor:null};
    if(m.method==='mcpServer/tool/call'){
     assert.equal(m.params.server,NAME);assert.equal(m.params.arguments.fileKey,input.fileKey);
     if(scenario==='progress')child.stdout.write(JSON.stringify({method:'item/mcpToolCall/progress',params:{itemId:'host-tool',message:'Running tool',threadId:UUID,turnId:UUID}})+'\n');
     if(scenario==='remote-timeout'&&m.params.tool==='use_figma')throw Error('request timed out after 30 seconds SECRET_SENTINEL');
     const paging=scenario==='paged'||scenario==='paged-change';
     const code=m.params.arguments.code||'';
     const firstPage=code.includes('offset:0,size:packed.data.length');
     if(scenario==='paged-change'&&paging&&launch>1&&m.params.tool==='use_figma'&&!firstPage)
      g.pagingNode.name='Changed between pages';
     if((scenario==='output-limit'||paging&&launch===1)&&m.params.tool==='use_figma')result={isError:true,content:[{type:'text',text:'Tool output exceeds size limit SECRET_SENTINEL'}]};
     else if(scenario==='tool-error')result={isError:true,content:[]};
     else result={content:[{type:'text',text:JSON.stringify(m.params.tool==='create_session'?{sessionId:UUID}:await g.execute(m.params.arguments.code))}]};
    }
    child.stdout.write(JSON.stringify({id:m.id,result})+'\n');
   }).catch(e=>child.stdout.write(JSON.stringify({id:m.id,error:{code:-32000,message:e.message}})+'\n'));
  },final(cb){
   cb();
   if(scenario==='slow-first-close'&&launch===1){
    const keepAlive=setTimeout(()=>close(0),1800);
    child.once('close',()=>clearTimeout(keepAlive));
    return;
   }
   close(0);
  }});return child;
 };
 const adapter=createRootLifecycle({binary:'fake-codex',environment:{HOME:'/fake',PATH:'/usr/bin',SECRET:'never'},spawnProcess,timeoutMs:scenario==='hang'?25:1000,checkConnection:async()=>({state:'configured'})});
 return {adapter,messages,options,kills,launchArgs};
}
test('fixed native bootstrap and read use canonical keys and preserve existing user nodes',async()=>{
 const g=graph(),foreign=g.node('FRAME');g.page.appendChild(foreign);const original=JSON.stringify(foreign.shared),t=transport(g),r=await t.adapter.inspect(input,{create:true}),root=verifiedRoot(r,input);
 assert.equal(root.owner,input.ownerNonce);assert.equal(root.chat,input.chatId);assert.equal(g.nodes.get(root.id).shared.ownerNonce,undefined);assert.equal(JSON.stringify(foreign.shared),original);
 const before=g.mutations.length,again=await t.adapter.inspect({...input,rootId:root.id});assert.equal(verifiedRoot(again,{...input,rootId:root.id}).id,root.id);assert.equal(g.mutations.length,before);
 assert(t.messages.every(m=>!m.method||!m.method.startsWith('turn/')));assert.equal(t.messages.filter(m=>m.method==='mcpServer/tool/call').length,4);assert(t.options.every(o=>!fs.existsSync(o.cwd)));
});
test('actual host RPC runs the trusted complete observer and changes no canvas nodes',async()=>{
 const g=graph(),t=transport(g),created=await t.adapter.inspect(input,{create:true}),root=g.nodes.get(created.root.id),child=g.node('FRAME');root.name='Root';child.name='Child';root.appendChild(child);
 const before=g.mutations.length,result=await t.adapter.inspect({...input,rootId:root.id},{observe:true});
 assert.equal(result.root.observation.schemaVersion,'apollo.recipe-observation.v1');assert.equal(result.root.observation.complete,true);assert.equal(result.root.observation.nodes.length,2);assert.equal(g.mutations.length,before);
 assert(t.messages.every(m=>!m.method?.startsWith('turn/')));assert(t.options.every(o=>!fs.existsSync(o.cwd)));
});
test('remote timeouts and output limits survive as safe host diagnostics',async()=>{
 for(const [scenario,code,kind]of [['remote-timeout','LANDING_ROOT_MCP_TIMEOUT','timeout'],['output-limit','LANDING_ROOT_MCP_OUTPUT_LIMIT','output-limit']]){
  const t=transport(graph(),scenario);await assert.rejects(t.adapter.inspect(input,{create:true}),e=>{
   assert.equal(e.code,code);assert.equal(JSON.parse(e.diagnostic).kind,kind);assert(!JSON.stringify(e).includes('SECRET_SENTINEL'));return true;
  });assert(t.options.every(o=>!fs.existsSync(o.cwd)));
 }
});
test('output cap recovers with a full paged snapshot and refuses mixing pages after an edit',async t=>{
 for(const scenario of ['paged','paged-change'])await t.test(scenario,async()=>{
  const g=graph();
  const {root}=await g.execute(rootScript(input,true));
  const frame=g.node('FRAME');
  g.nodes.get(root.id).appendChild(frame);
  for(let i=0;i<400;i++){
   const field=g.node('FRAME');
   field.name=crypto.createHash('sha256').update('fixture-layer-'+i).digest('hex');
   frame.appendChild(field);
   g.pagingNode=field;
  }
  g.mutations.length=0;
  const wire=transport(g,scenario), owned={...input,rootId:root.id};
  const observed=wire.adapter.inspect(owned,{observe:true});
  if(scenario==='paged-change')await assert.rejects(observed,{code:'LANDING_ROOT_OBSERVATION_CHANGED'});
  else{
   const actual=verifiedRoot(await observed,owned);
   assert.equal(actual.observation.complete,true);
   assert.equal(actual.observation.nodes.length,402);
   assert.equal(actual.observation.nodes.at(-1).name,g.pagingNode.name);
  }
  assert(wire.messages.filter(m=>m.params?.tool==='use_figma').length>=3);
  assert.deepEqual(g.mutations,[]);
 });
});
test('a close timeout retries a read once and never replays creation',async t=>{
 for(const create of [false,true])await t.test(create?'create':'read',async()=>{
  const g=graph(),wire=transport(g,'slow-first-close');
  if(create)await assert.rejects(wire.adapter.inspect(input,{create:true}),{code:'LANDING_ROOT_MCP_CLOSE_TIMEOUT'});
  else{
   const {root}=await g.execute(rootScript(input,true));
   const owned={...input,rootId:root.id};
   assert.equal(verifiedRoot(await wire.adapter.inspect(owned),owned).id,root.id);
  }
  assert.equal(wire.messages.filter(m=>m.params?.tool==='use_figma').length,create?1:2);
 });
});
test('only read-only observe receives its own finite read budget and cancellation still stops it',async()=>{
 const g=graph(),t=transport(g),created=await t.adapter.inspect(input,{create:true}),target={...input,rootId:created.root.id};
 await t.adapter.inspect(target,{observe:true});await t.adapter.inspect(target,{fit:true});
 assert(t.launchArgs[0].some(a=>a.includes('tool_timeout_sec=30')));assert(t.launchArgs[1].some(a=>a.includes('tool_timeout_sec=60')));assert(t.launchArgs[2].some(a=>a.includes('tool_timeout_sec=30')));
 const cancelled=transport(g,'hang'),controller=new AbortController();await assert.rejects(cancelled.adapter.inspect(target,{observe:true,signal:controller.signal,onProcess(){controller.abort();}}),{code:'AGENT_CANCELLED'});assert.equal(cancelled.kills.length,1);
});
test('merged user servers are disabled only in private argv before any thread, discovery or native call',async()=>{
 const g=graph(),t=transport(g,'merged');verifiedRoot(await t.adapter.inspect(input,{create:true}),input);
 assert.equal(t.options.length,2);assert.deepEqual(t.messages.slice(0,3).map(m=>m.method),['initialize','initialized','config/read']);assert.equal(t.messages.filter(m=>m.method==='thread/start').length,1);assert.equal(t.messages.filter(m=>m.method==='mcpServerStatus/list').length,1);
 assert.equal(t.messages.filter(m=>m.method==='mcpServer/tool/call').length,2);assert(t.options.every(o=>!fs.existsSync(o.cwd)));assert.equal(g.page.children.length,1);
 const refused=transport(graph(),'foreign-server');await assert.rejects(refused.adapter.inspect(input,{create:true}),{code:'LANDING_ROOT_MCP_ISOLATION_FAILED'});assert.equal(refused.options.length,2);assert(!refused.messages.some(m=>['thread/start','mcpServerStatus/list','mcpServer/tool/call'].includes(m.method)));
 const unsafe=transport(graph(),'unsafe-server');await assert.rejects(unsafe.adapter.inspect(input,{create:true}),{code:'LANDING_ROOT_MCP_ISOLATION_FAILED'});assert.equal(unsafe.options.length,1);assert(!unsafe.messages.some(m=>m.method==='thread/start'));
 const cancelled=transport(graph(),'merged'),controller=new AbortController();await assert.rejects(cancelled.adapter.inspect(input,{create:true,signal:controller.signal,onProcess(){if(cancelled.options.length===2)controller.abort();}}),{code:'AGENT_CANCELLED'});assert.equal(cancelled.options.length,2);assert.equal(cancelled.kills.length,1);assert(!cancelled.messages.some(m=>m.method==='thread/start'));assert(cancelled.options.every(o=>!fs.existsSync(o.cwd)));
});
test('aliases, wrong owner/chat/type/location, ambiguity and missing root are not canonical ownership',async()=>{
 for(const scenario of ['alias','owner','chat','type','page','missing','ambiguous']){
  const g=graph(),value=await g.execute(rootScript(input,true)),id=value.root.id,n=g.nodes.get(id);
  if(scenario==='alias'){n.shared={ownerNonce:input.ownerNonce,chatId:input.chatId};}
  if(scenario==='owner')n.shared.owner='wrong';if(scenario==='chat')n.shared.chat='wrong';if(scenario==='type')n.type='FRAME';if(scenario==='page')g.other.appendChild(n);if(scenario==='missing'){g.nodes.delete(id);g.page.children=[];}
  if(scenario==='ambiguous'){const other=g.node('SECTION');other.shared={...n.shared};g.page.appendChild(other);}
  const baseline=g.mutations.length,out=await g.execute(rootScript({...input,rootId:id},false));assert.throws(()=>verifiedRoot(out,{...input,rootId:id}));assert.equal(g.mutations.length,baseline);
  const fit=await g.execute(rootScript({...input,rootId:id},false,true));assert.notEqual(fit.state,'found');assert.equal(g.mutations.length,baseline);
 }
});
test('SECTION fit trims excess or grows missing bounds without touching children; FRAME and unknown bounds refuse',async()=>{
 for(const size of [50,800]){
  const g=graph(),v=await g.execute(rootScript(input,true)),n=g.nodes.get(v.root.id);n.width=size;n.height=size;const child=g.node('FRAME');Object.assign(child,{x:20,y:10,width:1140,height:324});n.appendChild(child);const geom=JSON.stringify([child.x,child.y,child.width,child.height]);
  const t=transport(g),v2=await t.adapter.inspect({...input,rootId:n.id},{fit:true}),r=verifiedRoot(v2,{...input,rootId:n.id});assert.deepEqual([r.width,r.height],[1160,334]);assert.equal(JSON.stringify([child.x,child.y,child.width,child.height]),geom);assert.equal(sectionBounds(r).status,'passed');
  child.x=-10;const before=g.mutations.length;assert.equal((await g.execute(rootScript({...input,rootId:n.id},false,true))).state,'fit-unavailable');assert.equal(g.mutations.length,before);
 }
 assert.equal(sectionBounds({type:'FRAME'}),null);assert.equal(sectionBounds({type:'SECTION',width:100,height:100,childrenComplete:false}).status,'unknown');assert.equal(sectionBounds({type:'SECTION',width:100,height:100,childrenComplete:true,children:[{id:'x',x:0,y:0,width:200,height:100}]}).status,'failed');
});
test('fit detects unsupported native resizing and any unexpected child reflow; invalid input never dispatches',async()=>{
 const g=graph(),v=await g.execute(rootScript(input,true)),n=g.nodes.get(v.root.id),child=g.node('FRAME');n.appendChild(child);
 n.resizeWithoutConstraints=undefined;let result=await g.execute(rootScript({...input,rootId:n.id},false,true));assert.equal(result.state,'fit-unavailable');
 n.width=800;n.resizeWithoutConstraints=function(w,h){this.width=w;this.height=h;child.width=99;};result=await g.execute(rootScript({...input,rootId:n.id},false,true));assert.equal(result.state,'fit-changed-children');assert.throws(()=>verifiedRoot(result,{...input,rootId:n.id}),{code:'LANDING_ROOT_BOUNDS_UNCONFIRMED'});
 const t=transport(graph());await assert.rejects(t.adapter.inspect({...input,fileKey:'bad/../path'},{create:true}),{code:'LANDING_ROOT_INPUT_INVALID'});assert.equal(t.messages.length,0);
});
test('host transport refuses auth, interactive/model events, foreign server, error, timeout and cancellation',async()=>{
 for(const scenario of ['auth','interactive','turn','foreign-server','tool-error','hang']){
  const t=transport(graph(),scenario);await assert.rejects(t.adapter.inspect(input,{create:true}));assert(!t.messages.some(m=>m.method==='turn/start'));assert(t.options.every(o=>!fs.existsSync(o.cwd)));
 }
 const t=transport(graph(),'hang'),c=new AbortController(),pending=t.adapter.inspect(input,{create:true,signal:c.signal,onProcess(){assert.equal(t.options.length,1);c.abort();}});await assert.rejects(pending,{code:'AGENT_CANCELLED'});assert.equal(t.options.length,1);assert.equal(t.kills.length,1);
 const before=transport(graph()),cancelled=new AbortController();cancelled.abort();await assert.rejects(before.adapter.inspect(input,{create:true,signal:cancelled.signal}),{code:'AGENT_CANCELLED'});assert.equal(before.options.length,0);assert.equal(before.kills.length,0);
});
test('documented native tool progress passes and process-record failure closes its child and scratch',async()=>{
 const p=transport(graph(),'progress');verifiedRoot(await p.adapter.inspect(input,{create:true}),input);assert(p.options.every(o=>!fs.existsSync(o.cwd)));assert.equal(p.kills.length,0);
 const t=transport(graph());await assert.rejects(t.adapter.inspect(input,{create:true,onProcess(){throw Object.assign(Error('save failed'),{code:'FIXTURE_RECORD_FAILED'});}}),{code:'FIXTURE_RECORD_FAILED'});assert.equal(t.kills.length,1);assert(t.options.every(o=>!fs.existsSync(o.cwd)));assert.equal(t.messages.length,0);
});
test('SECTION fit refuses rotated or unknown direct-child rotation without resizing',async()=>{
 for(const rotation of [45,undefined,NaN]){
  const g=graph(),v=await g.execute(rootScript(input,true)),n=g.nodes.get(v.root.id),child=g.node('FRAME');n.appendChild(child);child.rotation=rotation;const before=g.mutations.length;
  const result=await g.execute(rootScript({...input,rootId:n.id},false,true));assert.equal(result.state,'fit-unavailable');assert.equal(g.mutations.length,before);
 }
});
test('actual service, CLI adapter and host RPC compose bootstrap, native read/fit and same-chat resume',async t=>{
 const {createDirectLandingService,FLOW}=require('../src/landing/direct-service'),g=graph(),wire=transport(g,'merged'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'root-service-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const id=crypto.randomUUID(),runs=[];let stage='needs-input';
 const source={id:'data',resumePin:'b'.repeat(64),knowledgeVersion:'hub',assertCurrent(){},fileAccess:{hub:'/hub',skill:'/skill',workflow:'/workflow'},fileRead:()=>null,skill:{id:'other-skill',name:'Fixture',generation:{workflow:FLOW}},initial:{instructions:{'SKILL.md':'Fixture'},selectedSkill:{id:'other-skill'}}};
 const {createAgentCli,DIRECT_FIGMA_TOOLS}=require('../src/generation-agent/agent-cli');
 const modelSpawns=[];
 const modelSpawn=(binary,args,options)=>{
  assert.equal(binary,'fake-codex');assert(args.includes('exec'));assert(args.includes('--model'));assert.equal(args[args.indexOf('--model')+1],'fixed-model');modelSpawns.push(args);
  const child=new EventEmitter();child.pid=987999999;child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();let prompt='';
  child.kill=()=>{child.exitCode=143;queueMicrotask(()=>child.emit('close',143));};
  const emit=v=>child.stdout.write(JSON.stringify(v)+'\n');
  child.stdin=new Writable({write(b,enc,done){prompt+=b;done();},final(done){done();Promise.resolve().then(async()=>{
   const ctx=JSON.parse(prompt.trim().split('\n').at(-1)),stored=JSON.parse(fs.readFileSync(path.join(dir,id+'.json')));assert.equal(stored.target.rootNodeId,ctx.target.rootNodeId);assert(g.nodes.has(ctx.target.rootNodeId));runs.push(ctx);
   emit({type:'thread.started',thread_id:UUID});
   if(stage!=='needs-input'){
    const code='const root=await figma.getNodeByIdAsync('+JSON.stringify(ctx.target.rootNodeId)+');const child=figma.createFrame();root.appendChild(child);child.resizeWithoutConstraints(1140,324);return {target:'+JSON.stringify({rootNodeId:ctx.target.rootNodeId,pageId:input.pageId,parentNodeId:input.parentId,ownerNonce:ctx.target.ownerNonce})+',createdNodeIds:[child.id]};';
    const item={id:'model-canvas',type:'mcp_tool_call',server:NAME,tool:'use_figma',arguments:{fileKey:input.fileKey,code},status:'in_progress'};emit({type:'item.started',item});const result=await g.execute(code);emit({type:'item.completed',item:{...item,status:'completed',result:{content:[{type:'text',text:JSON.stringify(result)}]}}});
   }
   emit({type:'turn.completed',usage:{input_tokens:10,output_tokens:5}});
   fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({status:stage,message:'Fixture',rootNodeId:stage==='needs-input'?null:ctx.target.rootNodeId,checkpoint:'Fixture',checks:[],issues:[]}));child.exitCode=0;child.emit('close',0);
  }).catch(error=>{child.stderr.write(error.stack);child.exitCode=1;child.emit('close',1);});}});return child;
 };
 const opts={root:dir,knowledge:()=>source,rootLifecycle:wire.adapter,isProcessAlive:()=>false,createCli:()=>createAgentCli({binary:'fake-codex',model:'fixed-model',generatedRoot:dir,maxRuntimeMs:2000,environment:{HOME:'/fixture'},spawnProcess:modelSpawn,checkMcp:async()=>({state:'connected'}),mcpConnection:{name:NAME,url:URL,fileKey:input.fileKey,tools:DIRECT_FIGMA_TOOLS},knowledgeConnection:{releaseRoot:'/installed-data',runtimeRoot:'/installed-runtime',sourcePin:source.resumePin,skillId:'other-skill',files:source.fileAccess}})};
 let service=createDirectLandingService(opts);service.create({id,fileKey:input.fileKey,pageId:input.pageId,placement:{mode:'new-section',sectionId:null},skillId:'other-skill'});
 service.submit(id,{revision:0,requestId:crypto.randomUUID(),text:'Clarify'});await service.settled(id);const first=service.poll(id),rootId=first.target.rootNodeId;assert.equal(first.status,'needs-input');assert.equal(g.page.children.length,1);
 stage='needs-structure-approval';service=createDirectLandingService(opts);service.submit(id,{revision:1,requestId:crypto.randomUUID(),text:'Answer'});await service.settled(id);const last=service.poll(id);assert.equal(last.status,'needs-structure-approval');assert.equal(last.target.rootNodeId,rootId);assert.equal(g.page.children.length,1);assert.deepEqual([g.nodes.get(rootId).width,g.nodes.get(rootId).height],[1140,324]);assert(modelSpawns[1].includes('resume'));assert(modelSpawns[1].includes(UUID));assert.equal(runs.length,2);assert.equal(last.execution.hostMcpCallsUsed,10);assert.equal(last.execution.rootReadRequired,false);
 assert(wire.messages.every(m=>m.method!=='turn/start'));assert.equal(last.execution.rootReadback.owner,first.execution.ownerNonce);
});
test('configured runtime wires the host lifecycle with the exact binary, environment and model',t=>{
 const {createDirectLandingService,FLOW}=require('../src/landing/direct-service');assert.equal(typeof createDirectLandingService,'function');
 const runtime=require.resolve('../src/landing/runtime'),helper=require.resolve('../src/figma-mcp/root-lifecycle'),knowledge=require.resolve('../src/landing/knowledge');
 const old=new Map([runtime,helper,knowledge].map(p=>[p,require.cache[p]]));const calls=[];
 const source={id:'data',resumePin:'pin',knowledgeVersion:'hub',assertCurrent(){},skill:{id:'other',name:'Other',generation:{workflow:FLOW}}};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'root-runtime-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 try{
  require.cache[helper]={id:helper,filename:helper,loaded:true,exports:{createRootLifecycle:opts=>{calls.push(opts);return {inspect(){throw Error('No live reads in wiring test');}};}}};
  require.cache[knowledge]={id:knowledge,filename:knowledge,loaded:true,exports:{openKnowledge:()=>source}};delete require.cache[runtime];
  const environment={HOME:'/fixture'},mounted=require(runtime).mountConfiguredLandingRoutes({get(){},post(){}},{root:dir,environment,binary:'fixed-cli',model:'fixed-model'}),service=mounted.loadService();
  service.create({id:crypto.randomUUID(),skillId:'other',fileKey:input.fileKey,pageId:input.pageId,placement:{mode:'new-section',sectionId:null}});
  assert.deepEqual(calls,[{environment,binary:'fixed-cli',model:'fixed-model'}]);assert.equal(mounted.loadService(),service);
 }finally{for(const [p,value] of old){if(value)require.cache[p]=value;else delete require.cache[p];}}
});
