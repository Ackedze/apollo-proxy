#!/usr/bin/env node
'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const api=require('../src/code-release/store');
async function build({sourceRoot,home,version,output,commit}) {
  if(!/^[a-f0-9]{40}$/.test(commit || ''))throw Error('CODE_COMMIT_REQUIRED');
  const read=file=>execFileSync('git',['show',commit+':'+file],{cwd:sourceRoot,maxBuffer:32*1024*1024});
  const profile=api.compatibility(home);
  if(api.sha(read('package-lock.json'))!==profile.lock)throw Error('CODE_INCOMPATIBLE');
  const fileNames=execFileSync('git',['ls-tree','-r','--name-only',commit],{cwd:sourceRoot,encoding:'utf8'}).trim().split('\n').filter(api.allowedFile);
  await fs.mkdir(output,{recursive:true});
  const payload=path.join(output,'payload');
  const manifest=await api.snapshotCode({sourceRoot,destination:payload,version,sourceCommit:commit,profile,fileNames,read});
  const gitRoot=path.join(output,'code-packages');
  await fs.mkdir(path.join(gitRoot,'releases'),{recursive:true});
  const archive=path.join(gitRoot,'releases',manifest.id+'.tgz');
  execFileSync('/usr/bin/tar',['-czf',archive,'-C',payload,'.'],{env:{...process.env,COPYFILE_DISABLE:'1'},timeout:30000});
  const bytes=await fs.readFile(archive);
  const index={schemaVersion:'apollo.git-code-index.v1',manifest,archive:{path:'code-packages/releases/'+manifest.id+'.tgz',sha256:api.sha(bytes),bytes:bytes.length}};
  await fs.writeFile(path.join(gitRoot,'current.json'),JSON.stringify(index,null,2)+'\n',{flag:'wx'});
  return {index,archive};
}
async function main(args) {
  const opts={};for(let i=0;i<args.length;i+=2){if(!['--source','--home','--version','--out','--commit'].includes(args[i]) || !args[i+1])throw Error('CODE_BUILD_ARGUMENT_INVALID');opts[args[i].slice(2)]=args[i+1];}
  for(const key of ['source','home','version','out','commit'])if(!opts[key])throw Error('--'+key+' required');
  const result=await build({sourceRoot:path.resolve(opts.source),home:path.resolve(opts.home),version:opts.version,output:path.resolve(opts.out),commit:opts.commit});
  console.log(JSON.stringify({id:result.index.manifest.id,version:result.index.manifest.version,archive:result.archive,index:path.resolve(opts.out,'code-packages/current.json')}));
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={build};
