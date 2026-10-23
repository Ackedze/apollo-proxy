#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const catalog=require('../src/skills/catalog');
function write(file,value){
  const temp=file+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,file);}finally{fs.rmSync(temp,{force:true});}
}
function build({sourceRoot,runtimeRoot,indexPath}){
  sourceRoot=path.resolve(sourceRoot);runtimeRoot=path.resolve(runtimeRoot);indexPath=path.resolve(indexPath);
  const indexBytes=fs.readFileSync(indexPath),index=JSON.parse(indexBytes);
  if(index.schemaVersion!=='apollo.git-data-index.v1'||index.runtimeId!==require('../src/data-release').readRuntime(runtimeRoot).id)throw Error('SKILL_RUNTIME_INCOMPATIBLE');
  const repoRoot=path.resolve(path.dirname(indexPath),'../..');
  if(path.relative(repoRoot,sourceRoot).split(path.sep).join('/')!=='apollo/skills')throw Error('SKILL_SOURCE_PATH_INVALID');
  const legacy=require('../src/skills/layer-names').loadSkill(runtimeRoot,{skillsRoot:sourceRoot});
  const run=require('../src/skills/run-skill').readRunProfile(path.join(sourceRoot,catalog.ID,'run'));
  const packagePath=path.join(sourceRoot,catalog.ID,'manifest.json');
  const descriptor=JSON.parse(fs.readFileSync(packagePath));
  descriptor.files=catalog.FILES.map(file=>{
    const target=path.join(sourceRoot,catalog.ID,file),stat=fs.lstatSync(target);
    if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(target)!==target||stat.size>65536)throw Error('SKILL_CATALOG_INVALID');
    const bytes=fs.readFileSync(target);return{path:file,sha256:catalog.sha(bytes),bytes:bytes.length};
  });
  const packageBytes=Buffer.from(JSON.stringify(descriptor,null,2)+'\n');catalog.packageFiles(packageBytes);
  write(packagePath,descriptor);
  write(path.join(sourceRoot,'manifest.json'),{schemaVersion:'apollo.skill-catalog.v1',skills:[{id:catalog.ID,path:catalog.ID+'/manifest.json',sha256:catalog.sha(packageBytes),bytes:packageBytes.length}]});
  const admitted=catalog.readCatalog(sourceRoot),bytes=fs.readFileSync(path.join(sourceRoot,'manifest.json'));
  legacy.assertCurrent();run.assertCurrent();admitted.assertCurrent();
  if(!fs.readFileSync(indexPath).equals(indexBytes))throw Error('GIT_DATA_INDEX_CHANGED');
  write(indexPath,{...index,skills:{path:'apollo/skills/manifest.json',sha256:admitted.sha256,bytes:bytes.length}});
  return{skillsSourceSha256:admitted.sha256,index:indexPath};
}
if(require.main===module){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){const key={'--source':'sourceRoot','--runtime':'runtimeRoot','--index':'indexPath'}[args[i]];if(!key||!args[i+1])throw Error('Expected --source ROOT --runtime ROOT --index FILE');options[key]=args[i+1];}
  for(const key of ['sourceRoot','runtimeRoot','indexPath'])if(!options[key])throw Error('Missing '+key);
  try{console.log(JSON.stringify(build(options)));}catch(error){console.error(error.code||error.message);process.exitCode=1;}
}
module.exports={build};
