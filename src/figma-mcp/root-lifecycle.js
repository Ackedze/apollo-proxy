'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{StringDecoder}=require('node:string_decoder');
const connection=require('./connection');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,NODE=/^[\w:;-]{1,512}$/;
const fail=code=>{throw Object.assign(Error(code),{code});};
function validateInput(input){
 if(!input||!/^[-\w]{6,128}$/.test(input.fileKey||'')||!NODE.test(input.pageId||'')||!NODE.test(input.parentId||'')||!UUID.test(input.chatId||'')||!(/^[a-f0-9]{64}$/).test(input.ownerNonce||'')||!['SECTION','FRAME'].includes(input.type)||input.rootId!==null&&!NODE.test(input.rootId||'')||input.type==='SECTION'&&input.parentId!==input.pageId)fail('LANDING_ROOT_INPUT_INVALID');
}
// Only these host-authored operations run here; no agent-supplied JavaScript is accepted.
function rootScript(input,create,fit=false){
 validateInput(input);
 return `const p=${JSON.stringify(input)};
 const parent=await figma.getNodeByIdAsync(p.parentId);let page=parent;while(page&&page.type!=="PAGE")page=page.parent;
 if(!parent||!page||page.id!==p.pageId||parent.type!==(p.type==="SECTION"?"PAGE":"SECTION"))return {state:"invalid-parent"};
 const tags=n=>({owner:n.getSharedPluginData("apollolanding","owner"),chat:n.getSharedPluginData("apollolanding","chat")});
 const matches=parent.children.filter(n=>{const t=tags(n);return t.owner===p.ownerNonce||t.chat===p.chatId||n.getSharedPluginData("apollolanding","ownerNonce")===p.ownerNonce||n.getSharedPluginData("apollolanding","chatId")===p.chatId;}).map(n=>n.id);
 if(matches.length>1)return {state:"ambiguous",matches};
 let root=p.rootId?await figma.getNodeByIdAsync(p.rootId):matches.length?await figma.getNodeByIdAsync(matches[0]):null,created=false;
 if(!root&&${create?'true':'false'}&&!p.rootId&&!matches.length){
  try{root=p.type==="SECTION"?figma.createSection():figma.createFrame();root.setSharedPluginData("apollolanding","owner",p.ownerNonce);root.setSharedPluginData("apollolanding","chat",p.chatId);parent.appendChild(root);created=true;matches.push(root.id);}
  catch(e){return {state:"write-failed",candidateId:root?root.id:null,matches};}
 }
 if(!root)return {state:"absent",matches};
 let containing=root;while(containing&&containing.type!=="PAGE")containing=containing.parent;
 const children="children" in root?root.children:[],readBounds=()=>children.slice(0,2048).filter(n=>n.visible!==false).map(n=>({id:n.id,x:n.x,y:n.y,width:n.width,height:n.height,rotation:n.rotation})),bounds=readBounds();
 ${fit?`if(root.type!=="SECTION"||root.id!==p.rootId||root.parent?.id!==p.parentId||containing?.id!==p.pageId||tags(root).owner!==p.ownerNonce||tags(root).chat!==p.chatId||matches.length!==1||matches[0]!==root.id)return {state:"fit-refused"};
 if(children.length>2048||!bounds.length||bounds.some(b=>![b.x,b.y,b.width,b.height,b.rotation].every(Number.isFinite)||Math.abs(b.rotation)>.001||b.x<0||b.y<0||b.width<0||b.height<0))return {state:"fit-unavailable"};
 const width=Math.max(...bounds.map(b=>b.x+b.width)),height=Math.max(...bounds.map(b=>b.y+b.height));
 if(width<=0||height<=0||typeof root.resizeWithoutConstraints!=="function")return {state:"fit-unavailable"};
 try{if(Math.abs(root.width-width)>.5||Math.abs(root.height-height)>.5)root.resizeWithoutConstraints(width,height);}catch(e){return {state:"write-failed",candidateId:root.id,matches};}
 if(JSON.stringify(bounds)!==JSON.stringify(readBounds()))return {state:"fit-changed-children",candidateId:root.id,matches};`:''}
 return {state:"found",created,matches,root:{id:root.id,type:root.type,parentId:root.parent?root.parent.id:null,pageId:containing?containing.id:null,...tags(root),width:root.width,height:root.height,childrenComplete:children.length<=2048,children:readBounds()}};`;
}
function verifiedRoot(value,input){
 validateInput(input);const r=value?.root;
 if(value?.state==='ambiguous'||Array.isArray(value?.matches)&&value.matches.length>1)fail('LANDING_ROOT_AMBIGUOUS');
 if(value?.state==='write-failed')fail('LANDING_ROOT_WRITE_UNCONFIRMED');
 if(value?.state?.startsWith('fit-'))fail('LANDING_ROOT_BOUNDS_UNCONFIRMED');
 if(value?.state!=='found'||!r)fail('LANDING_TARGET_UNCONFIRMED');
 if(!NODE.test(r.id||'')||input.rootId&&r.id!==input.rootId||r.type!==input.type||r.pageId!==input.pageId||r.parentId!==input.parentId||r.owner!==input.ownerNonce||r.chat!==input.chatId)fail('LANDING_TARGET_CHANGED');
 if(!Array.isArray(value.matches)||value.matches.length!==1||value.matches[0]!==r.id)fail('LANDING_TARGET_UNCONFIRMED');
 return r;
}
function sectionBounds(root){
 const check={name:'Границы SECTION',status:'unknown',evidence:'Не получены полные размеры корня и видимых прямых дочерних слоёв.'};
 if(root.type!=='SECTION')return null;
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 if(![root.width,root.height].every(v=>finite(v)&&v>0)||root.childrenComplete!==true||!Array.isArray(root.children)||!root.children.length||root.children.some(c=>![c.x,c.y,c.width,c.height].every(finite)||c.width<0||c.height<0))return check;
 const outside=root.children.filter(c=>c.x<-.5||c.y<-.5||c.x+c.width>root.width+.5||c.y+c.height>root.height+.5);
 return {...check,status:outside.length?'failed':'passed',evidence:JSON.stringify({id:root.id,width:root.width,height:root.height,children:root.children,outside:outside.map(c=>c.id)})};
}
function objectResult(value){
 if(!value||value.isError||value.structuredContent?.error)fail('LANDING_ROOT_MCP_FAILED');
 if(value.structuredContent&&typeof value.structuredContent==='object')return value.structuredContent;
 for(const c of value.content||[])if(c.type==='text'){try{const v=JSON.parse(c.text.replace(/\n?Figma Debug UUID: [\w-]+/g,''));if(v&&typeof v==='object'&&!v.error)return v;}catch{}}
 fail('LANDING_ROOT_MCP_FAILED');
}
function validateArguments(schema,args){
 if(schema?.type!=='object'||schema.additionalProperties!==false||!Array.isArray(schema.required)||schema.required.some(k=>!Object.hasOwn(args,k)))fail('LANDING_ROOT_MCP_SCHEMA_CHANGED');
 for(const [k,v] of Object.entries(args)){
  const s=schema.properties?.[k];if(s?.type!=='string'||typeof v!=='string'||s.minLength&&v.length<s.minLength||s.maxLength&&v.length>s.maxLength||s.pattern&&!new RegExp(s.pattern).test(v)||s.enum&&!s.enum.includes(v)||s.format&&!(s.format==='uuid'&&UUID.test(v)))fail('LANDING_ROOT_MCP_SCHEMA_CHANGED');
 }
}
function client({binary,args,environment,cwd,signal,timeoutMs,spawnProcess,onProcess}){
 if(signal?.aborted)fail('AGENT_CANCELLED');
 let child,seq=0,buffer='',failure=null,closed=false,closeTimer,forceTimer,resolveClose;
 const decoder=new StringDecoder('utf8'),pending=new Map(),done=new Promise(resolve=>resolveClose=resolve);
 const kill=sig=>{if(closed||child?.exitCode!=null)return;try{if(child?.pid)process.kill(-child.pid,sig);else child?.kill(sig);}catch{child?.kill(sig);}};
 const stop=code=>{if(failure||closed)return;failure=code;for(const p of pending.values())p.reject(Object.assign(Error(code),{code}));pending.clear();kill('SIGTERM');forceTimer=setTimeout(()=>kill('SIGKILL'),500);forceTimer.unref?.();};
 const cancel=()=>stop('AGENT_CANCELLED'),timer=setTimeout(()=>stop('LANDING_ROOT_MCP_TIMEOUT'),timeoutMs);
 const send=value=>{if(!closed&&!child.stdin.destroyed)child.stdin.write(JSON.stringify(value)+'\n');};
 try{child=spawnProcess(binary,args,{cwd,env:environment,shell:false,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});}catch{clearTimeout(timer);fail('LANDING_ROOT_CLI_UNAVAILABLE');}
 child.stdin.on('error',()=>stop('LANDING_ROOT_MCP_PROTOCOL'));child.stderr.on('data',()=>{});
 child.stdout.on('data',b=>{
  if(failure||closed)return;buffer+=decoder.write(b);if(Buffer.byteLength(buffer)>1048576){stop('LANDING_ROOT_MCP_OUTPUT_LIMIT');return;}
  let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;let m;try{m=JSON.parse(line);}catch{stop('LANDING_ROOT_MCP_PROTOCOL');return;}
   if(m.method&&m.id!==undefined){send({id:m.id,error:{code:-32601,message:'Interactive requests are unavailable during host root operations'}});stop('LANDING_ROOT_MCP_INTERACTIVE');return;}
   if(m.method&&(/^(?:turn\/|item\/)/.test(m.method)&&m.method!=='item/mcpToolCall/progress'||/oauth|elicitation|approval|authRequired/i.test(m.method))){stop('LANDING_ROOT_MCP_UNEXPECTED_EVENT');return;}
   if(m.id!==undefined){const p=pending.get(m.id);if(p){pending.delete(m.id);if(m.error)p.reject(Object.assign(Error('LANDING_ROOT_MCP_RPC'),{code:'LANDING_ROOT_MCP_RPC'}));else p.resolve(m.result);}}
  }
 });
 child.once('error',()=>stop('LANDING_ROOT_CLI_UNAVAILABLE'));
 child.once('close',code=>{closed=true;clearTimeout(timer);clearTimeout(forceTimer);clearTimeout(closeTimer);signal?.removeEventListener('abort',cancel);for(const p of pending.values())p.reject(Object.assign(Error('LANDING_ROOT_MCP_CLOSED'),{code:failure||'LANDING_ROOT_MCP_CLOSED'}));pending.clear();resolveClose({code,failure});});
 signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 try{onProcess?.(child.pid);}catch(e){stop(e.code||'LANDING_ROOT_PROCESS_RECORD_FAILED');}
 return {rpc(method,params){if(failure||closed)fail(failure||'LANDING_ROOT_MCP_CLOSED');const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});send({id,method,params});});},initialized(){send({method:'initialized',params:{}});},async close(){if(!closed){child.stdin.end();closeTimer=setTimeout(()=>stop('LANDING_ROOT_MCP_CLOSE_TIMEOUT'),750);closeTimer.unref?.();}return done;}};
}
function createRootLifecycle({binary='codex',environment:source=process.env,model='',spawnProcess=spawn,checkConnection=connection.checkConnection,timeoutMs=45000}={}){
 return {async inspect(input,{create=false,fit=false,signal,onProcess,onToolCall}={}){
  validateInput(input);if(create&&input.rootId||fit&&(!input.rootId||create||input.type!=='SECTION'))fail('LANDING_ROOT_INPUT_INVALID');
  const config=await checkConnection({binary,environment:source,signal,spawnProcess,configurationOnly:true,timeoutMs:Math.min(timeoutMs,35000)});
  if(config.state!=='configured')fail(config.state==='cancelled'?'AGENT_CANCELLED':config.state==='config_conflict'?'AGENT_MCP_CONFIG_CONFLICT':'AGENT_MCP_CONNECTION_UNVERIFIED');
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'apollo-root-'));
  const settings=['features.shell_tool=false','features.multi_agent=false','features.skip_host_skill_discovery=true','skills.include_instructions=false','skills.bundled.enabled=false','project_doc_max_bytes=0','web_search="disabled"','mcp_servers={apollo_figma_mcp={'+connection.serverConfig(['create_session','use_figma'])+',tool_timeout_sec=30}}'];
  let c;
  const open=async disabled=>{
   c=client({binary,args:['-a','never',...connection.settings(),...[...settings,...disabled.map(name=>'mcp_servers.'+name+'.enabled=false')].flatMap(v=>['-c',v]),'app-server','--stdio'],environment:connection.environment(source),cwd,signal,timeoutMs,spawnProcess,onProcess});
   await c.rpc('initialize',{clientInfo:{name:'apollo_proxy_root',version:'1'},capabilities:{experimentalApi:true,explicitGatewayOauth:true}});c.initialized();
   return (await c.rpc('config/read',{includeLayers:false,cwd})).config;
  };
  try{
   let actual=await open([]);
   // app-server merges MCP tables with user config; an inline map does not replace it.
   const inherited=Object.entries(actual?.mcp_servers||{}).filter(([name,value])=>name!==connection.NAME&&value.enabled!==false).map(([name])=>name);
   if(inherited.length){
    if(inherited.length>128||inherited.some(name=>!/^[a-zA-Z0-9_-]{1,128}$/.test(name)))fail('LANDING_ROOT_MCP_ISOLATION_FAILED');
    const probe=await c.close();c=null;if(probe.failure||probe.code!==0)fail(probe.failure||'LANDING_ROOT_MCP_CLOSED');
    actual=await open(inherited);
   }
   const enabled=Object.entries(actual?.mcp_servers||{}).filter(([,v])=>v.enabled!==false);
   if(enabled.length!==1||enabled[0][0]!==connection.NAME)fail('LANDING_ROOT_MCP_ISOLATION_FAILED');
   const entry=enabled[0][1];
   if(entry.url!==connection.URL||JSON.stringify(entry.enabled_tools)!==JSON.stringify(['create_session','use_figma'])||entry.bearer_token_env_var||entry.http_headers_helper||Object.keys(entry.http_headers||{}).length||Object.keys(entry.env_http_headers||{}).length)fail('AGENT_MCP_CONFIG_CONFLICT');
   const thread=(await c.rpc('thread/start',{cwd,ephemeral:true,approvalPolicy:'never',sandbox:'read-only',...(model?{model}:{}),dynamicTools:[]})).thread?.id;
   if(!UUID.test(thread||''))fail('LANDING_ROOT_MCP_PROTOCOL');
   const inventory=await c.rpc('mcpServerStatus/list',{threadId:thread,serverName:connection.NAME,detail:'toolsAndAuthOnly'}),status=inventory.data?.[0];
   if(inventory.data?.length!==1||inventory.nextCursor||status?.name!==connection.NAME||status.httpOrigin!==new URL(connection.URL).origin||status.authStatus!=='oAuth'||status.toolsError||![null,undefined,'connected'].includes(status.runtimeStatus))fail(status?.authStatus==='notLoggedIn'||status?.runtimeStatus==='authenticationRequired'?'AGENT_MCP_AUTH_REQUIRED':'AGENT_MCP_CONNECTION_UNVERIFIED');
   const call=async(tool,args)=>{validateArguments(status.tools?.[tool]?.inputSchema,args);onToolCall?.({tool,phase:create?'bootstrap':fit?'fit':'read'});return objectResult(await c.rpc('mcpServer/tool/call',{threadId:thread,server:connection.NAME,tool,arguments:args}));};
   const session=await call('create_session',{fileKey:input.fileKey,description:'Apollo host root lifecycle; no model turn or component assembly.'});
   if(!UUID.test(session.sessionId||''))fail('LANDING_ROOT_MCP_PROTOCOL');
   const value=await call('use_figma',{fileKey:input.fileKey,sessionId:session.sessionId,skillNames:'figma-use',description:create?'Create or reuse only the empty canonical chat root.':fit?'Fit only the verified organizational SECTION to its visible direct-child layout bounds.':'Read canonical chat root ownership, location and direct-child bounds.',code:rootScript(input,create,fit)});
   return value;
  }finally{
   const terminal=c?await c.close():{code:0};await fs.rm(cwd,{recursive:true,force:true});
   if(signal?.aborted)fail('AGENT_CANCELLED');
   if(terminal.failure||terminal.code!==0)fail(terminal.failure||'LANDING_ROOT_MCP_CLOSED');
  }
 }};
}
module.exports={createRootLifecycle,rootScript,verifiedRoot,sectionBounds};
