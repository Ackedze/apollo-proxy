#!/usr/bin/env node
'use strict';
const fs=require('node:fs/promises'),syncFs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const api=require('../src/code-release/store'),git=require('../src/code-release/git');
function publicStatus(state,extra={}) {
  const short=r=>r?{id:r.id,version:r.version}:null;
  return {success:true,current:short(state.current),previous:short(state.previous),pending:short(state.pending),
    lastFailure:state.lastFailure || null,...extra};
}
async function acquireIdle({home,store,request=fetch}) {
  let control;try {control=JSON.parse(await fs.readFile(path.join(store,'control.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const env=require('dotenv').parse(await fs.readFile(path.join(home,'.env')).catch(error=>{if(error.code==='ENOENT')return '';throw error;}));
  const port=process.env.PORT || env.PORT || '3001';
  if(!/^\d{1,5}$/.test(port) || Number(port)>65535)throw Error('CODE_PORT_INVALID');
  const url='http://127.0.0.1:'+port;
  let health;
  try {
    const r=await request(url+'/health',{signal:AbortSignal.timeout(2000)});
    if(!r.ok)throw Error('CODE_PROXY_NOT_READY');health=await r.json();
  }catch(error){
    if(error.cause?.code!=='ECONNREFUSED')throw error;
    if(control?.pid){try{process.kill(control.pid,0);throw Error('CODE_PROXY_NOT_READY');}catch(e){if(e.code!=='ESRCH')throw e;}}
    return async()=>{};
  }
  if(!control || health?.proxy?.codeSupervisorPid!==control.pid || !/^[a-f0-9]{64}$/.test(control.key || ''))throw Error('CODE_EXTERNAL_PROXY');
  const lease=crypto.randomUUID(),headers={'x-apollo-code-key':control.key,'x-apollo-code-lease':lease};
  const r=await request(url+'/code-update/prepare',{method:'POST',headers,signal:AbortSignal.timeout(5000)});
  const value=await r.json();if(!r.ok || !value.success)throw Error(value.code || 'CODE_PROXY_BUSY');
  const release=async()=>{await request(url+'/code-update/release',{method:'POST',headers,signal:AbortSignal.timeout(5000)}).catch(()=>{});};
  release.lease=lease;return release;
}
async function run(command,{home,store,request=fetch,token=process.env.APOLLO_CODE_TOKEN}) {
  const options={home,store};let state=syncFs.existsSync(path.join(store,'state.json'))?api.readState(store):await api.ensureStore(options);
  if(command==='status')return publicStatus(state);
  if(command==='prepare-app-update') {
    const release=await acquireIdle({home,store,request});
    return publicStatus(state,{appUpdatePrepared:true,appUpdateLease:release.lease || null});
  }
  if(command==='release-app-update') {
    const lease=process.env.APOLLO_APP_UPDATE_LEASE;
    if(!/^[a-f0-9-]{36}$/.test(lease || ''))throw Error('CODE_LEASE_INVALID');
    const control=JSON.parse(await fs.readFile(path.join(store,'control.json'),'utf8'));
    const env=require('dotenv').parse(await fs.readFile(path.join(home,'.env'))),port=process.env.PORT || env.PORT || '3001';
    if(!/^\d{1,5}$/.test(port) || Number(port)>65535 || !/^[a-f0-9]{64}$/.test(control.key || ''))throw Error('CODE_PORT_INVALID');
    const response=await request('http://127.0.0.1:'+port+'/code-update/release',{method:'POST',headers:{'x-apollo-code-key':control.key,'x-apollo-code-lease':lease},signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('CODE_LEASE_RELEASE_FAILED');
    return publicStatus(state);
  }
  if(command==='check') {
    try {const selected=await git.check(api.compatibility(home),{token,request});
      return publicStatus(state,{updateAvailable:selected.manifest.id!==state.current.id,available:{id:selected.manifest.id,version:selected.manifest.version}});
    }catch(error){return publicStatus(state,{updateAvailable:false,checkError:error.code || error.message});}
  }
  let selected;
  if(command==='update') {
    selected=await git.check(api.compatibility(home),{token,request});
    if(selected.manifest.id===state.current.id)return publicStatus(state,{updateAvailable:false});
  }else if(command!=='rollback')throw Error('CODE_COMMAND_INVALID');
  const release=await acquireIdle({home,store,request});let keepLease=false,tmp;
  try {
    if(command==='rollback')state=await api.rollback(options);
    else {
      const data=await git.download(selected,{token,request});tmp=path.join(store,'.download-'+crypto.randomUUID()+'.tgz');
      await fs.writeFile(tmp,data,{flag:'wx',mode:0o600});
      state=await api.installArchive({...options,archive:tmp,manifest:selected.manifest});
    }
    keepLease=Boolean(state.pending);return publicStatus(state,{restartRequired:keepLease});
  }finally{if(tmp)await fs.rm(tmp,{force:true});if(!keepLease)await release();}
}
async function main(argv) {
  const [command,...args]=argv;let home=path.resolve(__dirname,'..');
  if(args.length){if(args.length!==2 || args[0]!=='--home')throw Error('CODE_ARGUMENT_INVALID');home=path.resolve(args[1]);}
  if(!['status','check','update','rollback','prepare-app-update','release-app-update'].includes(command))throw Error('CODE_COMMAND_INVALID');
  const result=await run(command,{home,store:path.join(home,'..','code-releases')});console.log(JSON.stringify(result));
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.log(JSON.stringify({success:false,code:error.code || error.message,error:error.message}));process.exitCode=1;});
module.exports={publicStatus,acquireIdle,run};
