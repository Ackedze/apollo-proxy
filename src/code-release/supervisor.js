'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {fork}=require('node:child_process');
const storeApi=require('./store');

async function supervise({home,store,startTimeoutMs=30000}) {
  const key=crypto.randomBytes(32).toString('hex');
  let child,stopping=false,timer,force,settling=false;
  const control=path.join(store,'control.json');
  const options={home,store};
  const settings=require('dotenv').parse(await fs.readFile(path.join(home,'.env')).catch(error=>{if(error.code==='ENOENT')return '';throw error;}));
  let selected=await storeApi.beginLaunch(options);
  const temporary=control+'.'+crypto.randomUUID();
  await fs.writeFile(temporary,JSON.stringify({pid:process.pid,key})+'\n',{mode:0o600,flag:'wx'});
  await fs.rename(temporary,control);
  function stop() {
    if(stopping)return;stopping=true;clearTimeout(timer);
    if(!child){process.exitCode=0;return;}
    child.stdin.end();child.kill('SIGTERM');
    force=setTimeout(()=>child?.kill('SIGKILL'),3000);force.unref();
  }
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  process.stdin.once('end',stop);process.stdin.resume();
  async function cleanup() {
    clearTimeout(timer);clearTimeout(force);
    process.stdin.pause();process.stdin.removeListener('end',stop);
    process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
    try {if(JSON.parse(await fs.readFile(control,'utf8')).pid===process.pid)await fs.unlink(control);}catch{}
  }
  return new Promise((resolve,reject)=>{
    async function launch() {
      if(stopping){await cleanup();resolve(0);return;}
      let ready=false,failure=null,confirmation=null;settling=false;
      const env={...process.env,APOLLO_PROXY_HOME:home,APOLLO_CODE_RELEASE_ID:selected.id,
        APOLLO_CODE_VERSION:selected.version,APOLLO_CODE_UPDATE_KEY:key,
        APOLLO_CODE_SUPERVISOR_PID:String(process.pid),APOLLO_PROXY_MANAGED:'1',
        NODE_PATH:path.join(home,'node_modules'),CODEX_WORKSPACE:process.env.CODEX_WORKSPACE || settings.CODEX_WORKSPACE || path.join(home,'codex-workspace')};
      child=fork(path.join(selected.path,'server.js'),[],{cwd:home,env,stdio:['pipe','inherit','inherit','ipc']});
      timer=setTimeout(()=>{failure='CODE_START_TIMEOUT';child.kill('SIGTERM');force=setTimeout(()=>child.kill('SIGKILL'),3000);force.unref();},startTimeoutMs);
      child.on('message',async message=>{
        if(ready || settling || stopping || message?.type!=='apollo-proxy-ready' || message.id!==selected.id)return;
        settling=true;
        confirmation=(async()=>{
          if(!Number.isInteger(message.port) || message.port<1 || message.port>65535)throw Error('CODE_START_HEALTH_FAILED');
          const response=await fetch('http://127.0.0.1:'+message.port+'/health',{signal:AbortSignal.timeout(5000)});
          const health=await response.json();
          if(!response.ok || health.ok!==true || health.proxy?.name!=='apollo-proxy' || health.proxy.codeId!==selected.id
            || health.proxy.codeSupervisorPid!==process.pid || child.exitCode!==null || stopping || failure)throw Error('CODE_START_HEALTH_FAILED');
          return storeApi.finishLaunch(options,selected.id);
        })();
        try {
          await confirmation;
          ready=true;settling=false;clearTimeout(timer);
          if(child.connected)child.send({type:'apollo-code-confirmed',id:selected.id},()=>{});
          console.error('[Apollo code] READY '+selected.version+' '+selected.id);
        }catch(error){ready=false;settling=false;failure='CODE_CONFIRM_FAILED';child.kill('SIGTERM');force=setTimeout(()=>child.kill('SIGKILL'),3000);force.unref();}
      });
      child.once('error',error=>{failure=error.code || 'CODE_START_FAILED';});
      child.once('exit',async(code,signal)=>{
        clearTimeout(timer);clearTimeout(force);
        try {
          if(confirmation)await confirmation.catch(()=>{});
          clearTimeout(force);
          if(!ready && selected.candidate && !stopping) {
            await storeApi.finishLaunch(options,selected.id,failure || 'CODE_START_FAILED');
            console.error('[Apollo code] ROLLED_BACK '+selected.version+' '+(failure || 'CODE_START_FAILED'));
            selected=await storeApi.beginLaunch(options);await launch();return;
          }
          await cleanup();resolve(stopping?0:code ?? (signal?1:0));
        }catch(error){await cleanup();reject(error);}
      });
    }
    launch().catch(async error=>{await cleanup();reject(error);});
  });
}
module.exports={supervise};
