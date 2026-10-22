'use strict';
const {spawn}=require('node:child_process');
const os=require('node:os');
const {StringDecoder}=require('node:string_decoder');
const validModel=value=>typeof value==='string' && value.trim()===value && /^[A-Za-z0-9][A-Za-z0-9._:@/\[\]-]{0,255}$/.test(value);

function listCodexModels(binary,{timeoutMs=15000,environment=process.env,signal}={}) {
  return new Promise((resolve,reject)=>{
    const failure=()=>new Error('Не удалось получить список моделей Codex. Повторите попытку или укажите ID модели.');
    if(signal?.aborted){reject(failure());return;}
    const child=spawn(binary,['app-server','--listen','stdio://'],{cwd:os.tmpdir(),env:environment,shell:false,stdio:['pipe','pipe','pipe']});
    let settled=false,buffer='',bytes=0,id=0,pages=0,forceTimer;
    const models=new Map(),cursors=new Set(),decoder=new StringDecoder('utf8');
    const stop=(error,result)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
      child.stdin.end();child.kill('SIGTERM');forceTimer=setTimeout(()=>child.kill('SIGKILL'),1000);forceTimer.unref();
      if(error)reject(error);else resolve(result);
    };
    const onAbort=()=>stop(failure());
    const timer=setTimeout(()=>stop(failure()),timeoutMs);
    signal?.addEventListener('abort',onAbort,{once:true});
    const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
    const next=cursor=>{
      if(++pages>10){stop(failure());return;}
      send({id:++id,method:'model/list',params:{limit:100,includeHidden:false,...(cursor?{cursor}:{})}});
    };
    child.stdin.on('error',()=>stop(failure()));
    child.stderr.on('data',()=>{});
    child.on('error',()=>stop(failure()));
    child.on('close',()=>{clearTimeout(forceTimer);if(!settled)stop(failure());});
    child.stdout.on('data',chunk=>{
      bytes+=chunk.length;if(bytes>2*1024*1024){stop(failure());return;}
      buffer+=decoder.write(chunk);let end;
      while(!settled && (end=buffer.indexOf('\n'))!==-1){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
        let message;try{message=JSON.parse(line);}catch{stop(failure());return;}
        if(message.id!==id)continue;
        if(message.error || !message.result){stop(failure());return;}
        if(id===0){send({method:'initialized',params:{}});next();continue;}
        const result=message.result;if(!Array.isArray(result.data)){stop(failure());return;}
        for(const row of result.data){
          if(row.hidden===true)continue;
          if(!validModel(row.model)||typeof row.displayName!=='string'||!row.displayName.trim()){stop(failure());return;}
          models.set(row.model,{id:row.model,name:row.displayName.slice(0,120)});
        }
        if(result.nextCursor!=null){
          if(typeof result.nextCursor!=='string'||!result.nextCursor||cursors.has(result.nextCursor)){stop(failure());return;}
          cursors.add(result.nextCursor);next(result.nextCursor);
        }else stop(null,{models:[...models.values()]});
      }
    });
    send({id:0,method:'initialize',params:{clientInfo:{name:'apollo_proxy_model_picker',title:'Apollo Proxy',version:'1.4.0'}}});
  });
}

if(require.main===module){
  const controller=new AbortController();process.once('SIGTERM',()=>controller.abort());
  listCodexModels(process.argv[2],{signal:controller.signal}).then(value=>console.log(JSON.stringify(value)),error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={listCodexModels,validModel};
