'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{StringDecoder}=require('node:string_decoder');
const connection=require('./connection');
const {observeRecipeRoot}=require('./recipe-observation');
const {SCHEMA:PACKED,packObservation,unpackObservation}=require('./observation-codec');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,NODE=/^[\w:;-]{1,512}$/;
const OBSERVATION_PAGE_SIZE = 12000;
const MAX_OBSERVATION_PAGES = 12;
const fail=code=>{throw Object.assign(Error(code),{code});};
function validateInput(input){
 if(!input||!/^[-\w]{6,128}$/.test(input.fileKey||'')||!NODE.test(input.pageId||'')||!NODE.test(input.parentId||'')||!UUID.test(input.chatId||'')||!(/^[a-f0-9]{64}$/).test(input.ownerNonce||'')||!['SECTION','FRAME'].includes(input.type)||input.rootId!==null&&!NODE.test(input.rootId||'')||input.type==='SECTION'&&input.parentId!==input.pageId)fail('LANDING_ROOT_INPUT_INVALID');
}
function observationFingerprint(data) {
 let a = 2166136261, b = 0x85ebca77;
 for (let i = 0; i < data.length; i++) {
  const char = data.charCodeAt(i);
  a = Math.imul(a ^ char, 16777619);
  b = Math.imul(b ^ char, 0x27d4eb2d);
 }
 return `${a >>> 0}:${b >>> 0}`;
}
// Only these host-authored operations run here; no agent-supplied JavaScript is accepted.
function rootScript(input,create,fit=false,observe=false,capture,observationOffset){
 validateInput(input);
 const pageObservation = Number.isSafeInteger(observationOffset);
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
 ${observe?`if(root.type!==p.type||root.parent?.id!==p.parentId||containing?.id!==p.pageId||tags(root).owner!==p.ownerNonce||tags(root).chat!==p.chatId||matches.length!==1||matches[0]!==root.id)return {state:"changed"};
 const observed=await (${observeRecipeRoot.toString()})(root,${JSON.stringify(capture||{})});
 const packed=(${packObservation.toString()})(observed);
 const observation=${pageObservation?`{offset:${observationOffset},size:packed.data.length,fingerprint:(${observationFingerprint.toString()})(packed.data),codeCount:packed.codeCount,data:packed.data.slice(${observationOffset},${observationOffset+OBSERVATION_PAGE_SIZE})}`:'JSON.stringify(packed)'};
 let finalPage=root;while(finalPage&&finalPage.type!=="PAGE")finalPage=finalPage.parent;if(tags(root).owner!==p.ownerNonce||tags(root).chat!==p.chatId||root.parent?.id!==p.parentId||finalPage?.id!==p.pageId)return {state:"changed"};`:''}
 return {state:"found",created,matches,root:{id:root.id,type:root.type,parentId:root.parent?root.parent.id:null,pageId:containing?containing.id:null,...tags(root),width:root.width,height:root.height,childrenComplete:children.length<=2048,children:readBounds()${observe?',observation':''}}};`;
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
 if(!value||value.isError||value.structuredContent?.error)throw transportError(value,'mcp-tool');
 if(value.structuredContent&&typeof value.structuredContent==='object')return value.structuredContent;
 for(const c of value.content||[])if(c.type==='text'){let v;try{v=JSON.parse(c.text.replace(/\n?Figma Debug UUID: [\w-]+/g,''));}catch{continue;}if(v?.error)throw transportError(v,'mcp-tool');if(v&&typeof v==='object')return v;}
 fail('LANDING_ROOT_MCP_FAILED');
}
function transportError(value,layer){
 const strings=[];
 function scan(v,depth=0){if(depth>6||strings.length>=32)return;if(typeof v==='string')strings.push(v.slice(0,16384));else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v))if(['message','error','data','text','structuredContent','content'].includes(k)||Array.isArray(v))scan(x,depth+1);}
 scan(value);const text=strings.join('\n'),kind=/timed?\s*out|timeout|deadline/i.test(text)?'timeout':/output.{0,20}(?:limit|large)|too (?:big|large)|exceed.{0,20}(?:size|bytes|limit)/i.test(text)?'output-limit':'remote-error';
 const code=kind==='timeout'?'LANDING_ROOT_MCP_TIMEOUT':kind==='output-limit'?'LANDING_ROOT_MCP_OUTPUT_LIMIT':layer==='json-rpc'?'LANDING_ROOT_MCP_RPC':'LANDING_ROOT_MCP_FAILED';
 // Remote messages may contain canvas text or credentials. Keep only safe classes.
 const diagnostic=JSON.stringify({layer,kind,rpcCode:typeof value?.code==='number'?value.code:null,errorTypes:[...new Set(text.match(/\b(?:TypeError|ReferenceError|RangeError|SyntaxError|InternalError|TimeoutError)\b/g)||[])],messageBytes:Buffer.byteLength(text)});
 return Object.assign(Error(code),{code,diagnostic});
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
  if(failure||closed)return;buffer+=decoder.write(b);if(Buffer.byteLength(buffer)>8*1048576){stop('LANDING_ROOT_MCP_OUTPUT_LIMIT');return;}
  let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;let m;try{m=JSON.parse(line);}catch{stop('LANDING_ROOT_MCP_PROTOCOL');return;}
   if(m.method&&m.id!==undefined){send({id:m.id,error:{code:-32601,message:'Interactive requests are unavailable during host root operations'}});stop('LANDING_ROOT_MCP_INTERACTIVE');return;}
   if(m.method&&(/^(?:turn\/|item\/)/.test(m.method)&&m.method!=='item/mcpToolCall/progress'||/oauth|elicitation|approval|authRequired/i.test(m.method))){stop('LANDING_ROOT_MCP_UNEXPECTED_EVENT');return;}
   if(m.id!==undefined){const p=pending.get(m.id);if(p){pending.delete(m.id);if(m.error)p.reject(transportError(m.error,'json-rpc'));else p.resolve(m.result);}}
  }
 });
 child.once('error',()=>stop('LANDING_ROOT_CLI_UNAVAILABLE'));
 child.once('close',code=>{closed=true;clearTimeout(timer);clearTimeout(forceTimer);clearTimeout(closeTimer);signal?.removeEventListener('abort',cancel);for(const p of pending.values())p.reject(Object.assign(Error('LANDING_ROOT_MCP_CLOSED'),{code:failure||'LANDING_ROOT_MCP_CLOSED'}));pending.clear();resolveClose({code,failure});});
 signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 try{onProcess?.(child.pid);}catch(e){stop(e.code||'LANDING_ROOT_PROCESS_RECORD_FAILED');}
 return {rpc(method,params){if(failure||closed)fail(failure||'LANDING_ROOT_MCP_CLOSED');const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});send({id,method,params});});},initialized(){send({method:'initialized',params:{}});},async close(){if(!closed){child.stdin.end();closeTimer=setTimeout(()=>stop('LANDING_ROOT_MCP_CLOSE_TIMEOUT'),750);closeTimer.unref?.();}return done;}};
}
function createRootLifecycle({binary='codex',environment:source=process.env,model='',spawnProcess=spawn,checkConnection=connection.checkConnection,timeoutMs=45000}={}){
 async function inspectOnce(input,{create=false,fit=false,observe=false,capture,signal,onProcess,onToolCall},paged=false) {
  validateInput(input);if(create&&input.rootId||fit&&(!input.rootId||create||input.type!=='SECTION'))fail('LANDING_ROOT_INPUT_INVALID');
  if(capture!==undefined&&(!capture||Object.keys(capture).some(k=>!['nativeFields','propertyNames','bindingFields','variableFields','resolvedFields','nativeTargets'].includes(k))||['bindingFields','variableFields','resolvedFields'].some(k=>capture[k]!==undefined&&(!Array.isArray(capture[k])||capture[k].length>64||capture[k].some(v=>typeof v!=='string'||!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(v))))||capture.nativeTargets!==undefined&&(!Array.isArray(capture.nativeTargets)||capture.nativeTargets.length>256||capture.nativeTargets.some(m=>!m||Array.isArray(m)||Object.keys(m).some(k=>!['type','name'].includes(k))||m.type!==undefined&&(typeof m.type!=='string'||m.type.length>64)||m.name!==undefined&&!(typeof m.name==='string'&&m.name.length<=512||Array.isArray(m.name)&&m.name.length>0&&m.name.length<=64&&m.name.every(n=>typeof n==='string'&&n.length<=512))))||!Array.isArray(capture.nativeFields)||capture.nativeFields.length>64||capture.nativeFields.some(k=>typeof k!=='string'||!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(k))||!Array.isArray(capture.propertyNames)||capture.propertyNames.length>256||capture.propertyNames.some(k=>typeof k!=='string'||!k||k.length>512)))fail('LANDING_ROOT_INPUT_INVALID');
  const config=await checkConnection({binary,environment:source,signal,spawnProcess,configurationOnly:true,timeoutMs:Math.min(timeoutMs,35000)});
  if(config.state!=='configured')fail(config.state==='cancelled'?'AGENT_CANCELLED':config.state==='config_conflict'?'AGENT_MCP_CONFIG_CONFLICT':'AGENT_MCP_CONNECTION_UNVERIFIED');
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'apollo-root-'));
  const readOnlyObserve=observe&&!create&&!fit;
  const operationTimeoutMs=readOnlyObserve?Math.max(timeoutMs,paged?240000:90000):timeoutMs;
  const settings=['features.shell_tool=false','features.multi_agent=false','features.skip_host_skill_discovery=true','skills.include_instructions=false','skills.bundled.enabled=false','project_doc_max_bytes=0','web_search="disabled"','mcp_servers={apollo_figma_mcp={'+connection.serverConfig(['create_session','use_figma'])+',tool_timeout_sec='+(readOnlyObserve?60:30)+'}}'];
  let c,operationError;
  const open=async disabled=>{
   c=client({binary,args:['-a','never',...connection.settings(),...[...settings,...disabled.map(name=>'mcp_servers.'+name+'.enabled=false')].flatMap(v=>['-c',v]),'app-server','--stdio'],environment:connection.environment(source),cwd,signal,timeoutMs:operationTimeoutMs,spawnProcess,onProcess});
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
   const call=async(tool,args)=>{validateArguments(status.tools?.[tool]?.inputSchema,args);onToolCall?.({tool,phase:create?'bootstrap':fit?'fit':observe?'observe':'read'});return objectResult(await c.rpc('mcpServer/tool/call',{threadId:thread,server:connection.NAME,tool,arguments:args}));};
   const session=await call('create_session',{fileKey:input.fileKey,description:'Apollo host root lifecycle; no model turn or component assembly.'});
   if(!UUID.test(session.sessionId||''))fail('LANDING_ROOT_MCP_PROTOCOL');
   const read = offset => call('use_figma',{fileKey:input.fileKey,sessionId:session.sessionId,skillNames:'figma-use',description:create?'Create or reuse only the empty canonical chat root.':fit?'Fit only the verified organizational SECTION to its visible direct-child layout bounds.':observe?'Read the complete owned root and actual native recipe facts without writing.':'Read canonical chat root ownership, location and direct-child bounds.',code:rootScript(input,create,fit,observe,capture,offset)});
   const value=await read(paged?0:undefined);
   if (paged) {
    const root = verifiedRoot(value, input);
    const {size, fingerprint, codeCount} = root.observation || {};
    if (!Number.isSafeInteger(size) || size < 1 || size > OBSERVATION_PAGE_SIZE * MAX_OBSERVATION_PAGES) fail('LANDING_ROOT_MCP_OUTPUT_LIMIT');
    let data = '';
    for (let offset = 0; offset < size; offset += OBSERVATION_PAGE_SIZE) {
     const page = offset === 0 ? root.observation : verifiedRoot(await read(offset), input).observation;
     const expectedLength = Math.min(size - offset, OBSERVATION_PAGE_SIZE);
     if (page?.offset !== offset || page.size !== size || page.fingerprint !== fingerprint || page.codeCount !== codeCount ||
      typeof page.data !== 'string' || page.data.length !== expectedLength) fail('LANDING_ROOT_OBSERVATION_CHANGED');
     data += page.data;
    }
    if (observationFingerprint(data) !== fingerprint) fail('LANDING_ROOT_OBSERVATION_CHANGED');
    root.observation = unpackObservation({schemaVersion:PACKED, compression:'lzw-bits-base64',codeCount,data});
   }
   if(typeof value.root?.observation==='string'){let packed;try{packed=JSON.parse(value.root.observation);}catch{fail('LANDING_ROOT_OBSERVATION_INVALID');}value.root.observation=unpackObservation(packed);}
   else if(value.root?.observation?.schemaVersion===PACKED)value.root.observation=unpackObservation(value.root.observation);
   return value;
  }catch(error){
   operationError=error;
   throw error;
  }finally{
   const terminal=c?await c.close():{code:0};await fs.rm(cwd,{recursive:true,force:true});
   if(signal?.aborted)fail('AGENT_CANCELLED');
   if(!operationError&&(terminal.failure||terminal.code!==0))fail(terminal.failure||'LANDING_ROOT_MCP_CLOSED');
  }
 }
 return {async inspect(input, options = {}) {
  try {
   return await inspectOnce(input, options);
  } catch (error) {
   if (options.create || options.fit || options.signal?.aborted) throw error;
   if (error.code === 'LANDING_ROOT_MCP_CLOSE_TIMEOUT') return inspectOnce(input, options);
   if (options.observe && error.code === 'LANDING_ROOT_MCP_OUTPUT_LIMIT') return inspectOnce(input, options, true);
   throw error;
  }
 }};
}
module.exports={createRootLifecycle,rootScript,verifiedRoot,sectionBounds};
