#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
function selectConnection(home=path.resolve(__dirname,'..')){
 const store=path.resolve(home,'..','code-releases');
 if(!fs.lstatSync(store,{throwIfNoEntry:false}))return {api:require(path.join(home,'src/figma-mcp/connection')),assertCurrent(){if(fs.lstatSync(store,{throwIfNoEntry:false}))throw Object.assign(Error('Code changed'),{code:'CODE_CHANGED'});}};
 const code=require(path.join(home,'src/code-release/store')),state=code.readState(store);
 if(state.pending)throw Object.assign(Error('Code update in progress'),{code:'CODE_SELECTION_BUSY'});
 const root=code.versionRoot(store,state.current.id),profile=code.compatibility(home);
 function assertCurrent(){
  const current=code.readState(store);
  if(current.pending||current.current.id!==state.current.id||current.current.version!==state.current.version)throw Object.assign(Error('Code changed'),{code:'CODE_CHANGED'});
  if(fs.realpathSync(root)!==root)throw Error('Code root changed');
  const manifest=code.readRelease(root,profile);
  if(manifest.id!==current.current.id||manifest.version!==current.current.version)throw Object.assign(Error('Code identity changed'),{code:'CODE_CHANGED'});
 }
 assertCurrent();
 const file=path.join(root,'src/figma-mcp/connection.js');
 if(!fs.existsSync(file))throw Object.assign(Error('Current code does not support Figma connection'),{code:'CODE_UPDATE_REQUIRED'});
 const api=require(file);if(typeof api.login!=='function'||typeof api.checkConnection!=='function')throw Error('Unsupported connection API');
 return {api,assertCurrent};
}
async function main(){
 const [mode,flag,binary,...extra]=process.argv.slice(2);
 if(!['check','login'].includes(mode)||flag!=='--binary'||!binary||extra.length)throw Error('FIGMA_CONNECTION_ARGUMENTS_INVALID');
 const selected=selectConnection(),connection=selected.api;
 const controller=new AbortController(),abort=()=>controller.abort();
 process.on('SIGTERM',abort);process.on('SIGINT',abort);
 process.stdin.on('end',abort);process.stdin.on('error',abort);process.stdin.resume();process.stdin.unref?.();
 try{const value=await connection[mode==='login'?'login':'checkConnection']({binary,signal:controller.signal});selected.assertCurrent();const {privateError,...visible}=value;process.stdout.write(JSON.stringify(visible)+'\n');}
 finally{process.removeListener('SIGTERM',abort);process.removeListener('SIGINT',abort);process.stdin.destroy();}
}
if(require.main===module)main().catch(error=>{process.stdout.write(JSON.stringify({state:'unknown',reason:['CODE_CHANGED','CODE_SELECTION_BUSY'].includes(error.code)?error.code:'CODE_UPDATE_REQUIRED',server:'apollo_figma_mcp',fileAccessVerified:false})+'\n');process.exitCode=1;});

module.exports={selectConnection};
