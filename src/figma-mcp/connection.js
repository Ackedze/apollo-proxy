'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const NAME='apollo_figma_mcp',URL='https://mcp.figma.com/mcp';
const DIRECT_FIGMA_TOOLS=['use_figma','get_screenshot','create_session','get_libraries','search_design_system','get_metadata'];
const ENV=['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','LANG','LC_ALL','CODEX_HOME'];
const environment=source=>Object.fromEntries(ENV.filter(k=>typeof source[k]==='string').map(k=>[k,source[k]]));
const serverConfig=tools=>'url='+JSON.stringify(URL)+',enabled=true,required=true,startup_readiness="connection",startup_timeout_sec=30'+(tools?',enabled_tools='+JSON.stringify(tools):'');
const credentialsConfig='mcp_oauth_credentials_store="auto"';
const settings=()=>['-c',credentialsConfig,'-c','features.plugins=false','-c','features.remote_plugin=false','-c','features.apps=false'];
const result=(state,reason)=>({state,reason,server:NAME,checkedAt:new Date().toISOString(),fileAccessVerified:false});
function authRequired(text){return typeof text==='string'&&/auth(?:entication)? required|reauthenticationRequired|invalid_grant|(?:HTTP[^\n]{0,30})?\b401\b/i.test(text);}
function executionAuthRequired(stderr){
 // A file/tool permission error and another MCP server's login are separate failures.
 return typeof stderr==='string'&&stderr.split('\n').some(line=>{const i=line.indexOf(NAME);return i>=0&&authRequired(line.slice(i+NAME.length).split(/;|\bapollo_knowledge\b/)[0]);});
}
function configurationState(config){
 if(!config||typeof config!=='object'||Array.isArray(config))return result('unknown','CONFIG_UNVERIFIED');
 const servers=config.mcp_servers;
 if(servers!==undefined&&(servers===null||typeof servers!=='object'||Array.isArray(servers)))return result('unknown','CONFIG_UNVERIFIED');
 if(!servers||!Object.hasOwn(servers,NAME))return result('not_connected','NOT_CONFIGURED');
 const entry=servers[NAME],plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),empty=v=>v===null||plain(v)&&Object.keys(v).length===0;
 const allowed={url:v=>v===URL,enabled:v=>v===true,environment_id:v=>v==='local',required:v=>v===true,
  tool_timeout_sec:v=>v===null||v===60,startup_timeout_sec:v=>v===null||v===30,startup_readiness:v=>v==='connection',default_tools_approval_mode:v=>v==='approve',
  http_headers:empty,env_http_headers:empty,bearer_token_env_var:v=>v===null,http_headers_helper:v=>v===null,
  enabled_tools:v=>v===null||Array.isArray(v)&&v.length===DIRECT_FIGMA_TOOLS.length&&new Set(v).size===v.length&&v.every(t=>DIRECT_FIGMA_TOOLS.includes(t)),
  disabled_tools:v=>v===null||Array.isArray(v)&&v.length===0};
 if(!plain(entry)||entry.url!==URL||Object.entries(entry).some(([k,v])=>!Object.hasOwn(allowed,k)||!allowed[k](v)))return result('config_conflict','CONFIG_CONFLICT');
 return result('configured','CONFIG_PARITY_VERIFIED');
}
function classify(row){
 if(!row||row.name!==NAME||row.httpOrigin!==new global.URL(URL).origin)return result('unknown','CONNECTION_UNVERIFIED');
 if(row.runtimeStatus==='authenticationRequired'||authRequired(row.toolsError))return {...result(row.authStatus==='oAuth'?'reauthentication_required':'not_connected','AUTH_REQUIRED'),privateError:typeof row.toolsError==='string'?row.toolsError.slice(0,8192):'Authentication required for '+NAME};
 if(row.authStatus==='notLoggedIn')return result('not_connected','AUTH_REQUIRED');
 if(row.authStatus==='oAuth'&&typeof row.serverInfo?.name==='string'&&typeof row.serverInfo?.version==='string'&&row.serverCapabilities&&typeof row.serverCapabilities==='object'&&!Array.isArray(row.serverCapabilities)&&row.tools?.use_figma?.name==='use_figma'&&!row.toolsError&&[null,undefined,'connected'].includes(row.runtimeStatus))return result('connected','LIVE_DISCOVERY');
 return {...result('unknown','CONNECTION_UNVERIFIED'),privateError:typeof row.toolsError==='string'?row.toolsError.slice(0,8192):''};
}
function stop(child,signal='SIGTERM'){
 if(!child||child.exitCode!==null)return;
 try{process.kill(-child.pid,signal);}catch{try{child.kill(signal);}catch{}}
}
async function command({binary,args,env,cwd,signal,timeoutMs,spawnProcess=spawn,onMessage}){
 if(signal?.aborted)return {cancelled:true};
 return new Promise(resolve=>{
  let child,done=false,buffer='',stderr='',timer,forceTimer,timedOut=false,cancelled=false,protocolError=false;
  const finish=value=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(forceTimer);signal?.removeEventListener('abort',cancel);resolve({...value,timedOut,cancelled,protocolError,stderr});};
  const terminate=()=>{stop(child);forceTimer=setTimeout(()=>stop(child,'SIGKILL'),500);forceTimer.unref?.();};
  const cancel=()=>{cancelled=true;terminate();};
  try{child=spawnProcess(binary,args,{cwd,env,detached:process.platform!=='win32',shell:false,stdio:['pipe','pipe','pipe']});}catch{return finish({unavailable:true});}
  const send=v=>{if(!done&&!child.stdin.destroyed)child.stdin.write(JSON.stringify(v)+'\n');};
  child.stdin.on('error',()=>{});
  child.stdout.on('data',bytes=>{
   if(!onMessage||protocolError||done)return; // OAuth URLs and credentials never enter the UI or logs.
   buffer+=bytes.toString('utf8');if(Buffer.byteLength(buffer)>1048576){protocolError=true;terminate();return;}
   let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;
    try{onMessage(JSON.parse(line),send,child);}catch{protocolError=true;terminate();return;}
   }
  });
  child.stderr.on('data',bytes=>{if(onMessage)stderr=(stderr+bytes.toString('utf8')).slice(-8192);});
  child.once('error',()=>finish({unavailable:true}));child.once('close',code=>finish({exitCode:code}));
  timer=setTimeout(()=>{timedOut=true;terminate();},timeoutMs);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  if(onMessage)send({id:1,method:'initialize',params:{clientInfo:{name:'apollo_proxy_figma_connection',version:'1'},capabilities:{explicitGatewayOauth:true}}});
 });
}
async function checkConnection({binary='codex',environment:source=process.env,signal,timeoutMs=35000,spawnProcess=spawn,configurationOnly=false}={}){
 if(['HOME','CODEX_HOME'].some(k=>typeof source[k]==='string'&&!path.isAbsolute(source[k])))return result('unknown','ENVIRONMENT_UNVERIFIED');
 const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'apollo-figma-check-'));let value;
 try{
  const response=await command({binary,args:[...settings(),'app-server','--stdio'],env:environment(source),cwd,signal,timeoutMs,spawnProcess,onMessage(message,send,child){
   if(message.id===1){if(message.error){value=result('unknown','CLI_PROTOCOL_UNAVAILABLE');child.stdin.end();return;}send({method:'initialized',params:{}});send({id:2,method:'config/read',params:{includeLayers:false}});}
   else if(message.id===2){
    value=message.error?result('unknown','CONFIG_UNVERIFIED'):configurationState(message.result?.config);
    if(value.state!=='configured'||configurationOnly){child.stdin.end();return;}
    send({id:3,method:'mcpServerStatus/list',params:{serverName:NAME,detail:'toolsAndAuthOnly'}});
   }
   else if(message.id===3){value=message.error?result('unknown','CLI_PROTOCOL_UNAVAILABLE'):classify(message.result?.data?.length===1&&!message.result.nextCursor?message.result.data[0]:null);child.stdin.end();}
   else if(message.id!==undefined&&message.method)send({id:message.id,error:{code:-32601,message:'Interactive requests are unavailable during connection checks'}});
  }});
  if(response.cancelled)return result('cancelled','CANCELLED');
  if(response.timedOut)return result('unknown','CHECK_TIMEOUT');
  if(response.unavailable)return result('unknown','CLI_UNAVAILABLE');
  if(response.protocolError||response.exitCode!==0)return {...result('unknown','CLI_PROTOCOL_UNAVAILABLE'),privateError:response.stderr};
  return value||result('unknown','CONNECTION_UNVERIFIED');
 }finally{await fs.rm(cwd,{recursive:true,force:true});}
}
async function login(options={}){
 const {binary='codex',environment:source=process.env,signal,timeoutMs=600000,spawnProcess=spawn}=options;
 const started=Date.now(),remaining=()=>Math.max(1,timeoutMs-(Date.now()-started));
 const inspect=await checkConnection({...options,configurationOnly:true,timeoutMs:Math.min(35000,remaining())});
 if(!['configured','not_connected'].includes(inspect.state))return inspect;
 const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'apollo-figma-login-'));
 const invoke=async args=>{
  const response=await command({binary,args,env:environment(source),cwd,signal,timeoutMs:remaining(),spawnProcess});
  if(response.cancelled)return result('cancelled','CANCELLED');
  if(response.timedOut)return result('unknown','LOGIN_TIMEOUT');
  if(response.unavailable)return result('unknown','CLI_UNAVAILABLE');
  if(response.exitCode!==0)return result('unknown','LOGIN_FAILED');
  return null;
 };
 try{
  if(inspect.reason==='NOT_CONFIGURED'){
   const error=await invoke([...settings(),'mcp','add',NAME,'--url',URL]);if(error)return error;
   // Some Codex versions complete OAuth in `add`; do not open a second flow.
   const added=await checkConnection({...options,timeoutMs:Math.min(35000,remaining())});
   if(added.reason==='NOT_CONFIGURED')return result('unknown','REGISTRATION_FAILED');
   if(added.state!=='not_connected')return added;
  }
  if(remaining()<=1)return result('unknown','LOGIN_TIMEOUT');
  const error=await invoke([...settings(),'mcp','login',NAME]);if(error)return error;
  return checkConnection({...options,timeoutMs:Math.min(35000,remaining())});
 }finally{await fs.rm(cwd,{recursive:true,force:true});}
}
module.exports={NAME,URL,ENV,DIRECT_FIGMA_TOOLS,environment,serverConfig,credentialsConfig,settings,checkConnection,login,executionAuthRequired};
