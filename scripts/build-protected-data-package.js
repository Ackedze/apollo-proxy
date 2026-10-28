#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const releases = require('../src/data-release'), protectedData = require('../src/data-packages/protected');

async function buildProtectedDataPackage({releaseRoot,runtimeRoot,output,name='@apollo/data',version,tarballUrl,activation,password}) {
  const manifest = await releases.validateRelease(releaseRoot,{runtimeRoot});
  const key = protectedData.accessKey(activation,{password});
  output = path.resolve(output); await fs.mkdir(output);
  const staging = path.join(output,'.private'), root = path.join(output,'package');
  await fs.mkdir(staging,{mode:0o700}); await fs.mkdir(root);
  try {
    await fs.cp(releaseRoot,path.join(staging,'package'),{recursive:true,dereference:false});
    const payload = path.join(staging,'data.tgz');
    execFileSync('/usr/bin/tar',['-czf',payload,'-C',staging,'package'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
    const bytes = await fs.readFile(payload);
    if (bytes.length > releases.MAX_ARCHIVE_BYTES) throw Error('DATA_PACKAGE_TOO_LARGE');
    const seal = protectedData.encrypt(bytes,key,activation.keyId+':'+manifest.id);
    await fs.writeFile(path.join(root,'payload.enc'),seal.body,{flag:'wx'});
    await fs.writeFile(path.join(root,'encryption.json'),JSON.stringify({schemaVersion:protectedData.PACKAGE_SCHEMA,keyId:activation.keyId,
      contentVersion:manifest.id,iv:seal.iv,tag:seal.tag})+'\n',{flag:'wx'});
    await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name,version,description:'Encrypted Apollo data',license:'UNLICENSED',files:['payload.enc','encryption.json']})+'\n',{flag:'wx'});
    const packed = JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',output],{
      cwd:root,encoding:'utf8',env:{...process.env,npm_config_cache:path.join(staging,'npm-cache')}}))[0];
    const tarballPath = path.join(output,packed.filename), archive = await fs.readFile(tarballPath);
    const npm = {name,version,tarballUrl,bytes:archive.length,integrity:'sha512-'+crypto.createHash('sha512').update(archive).digest('base64'),dataId:manifest.id};
    require('../src/data-packages/npm').validateReference(npm);
    if (npm.integrity !== packed.integrity) throw Error('NPM_DATA_INTEGRITY_INVALID');
    const descriptor = {schemaVersion:'apollo.git-data-index.v3',runtimeId:manifest.runtimeId,activation,npm};
    await fs.writeFile(path.join(output,'current.json'),JSON.stringify(descriptor,null,2)+'\n',{flag:'wx'});
    return {descriptor,tarballPath,packageRoot:root};
  } finally { await fs.rm(staging,{recursive:true,force:true}); }
}
if (require.main === module) {
  const opts={};
  for(let i=2;i<process.argv.length;i+=2){const key={'--release':'releaseRoot','--runtime':'runtimeRoot','--output':'output','--version':'version','--tarball-url':'tarballUrl','--activation':'activationPath'}[process.argv[i]];
    if(!key||!process.argv[i+1])throw Error('Invalid protected package argument.');opts[key]=process.argv[i+1];}
  (async()=>{let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>4096)throw Error('DATA_ACTIVATION_INPUT_INVALID');}
    const access=JSON.parse(input);opts.password=access.password;
    try { opts.activation=JSON.parse(await fs.readFile(opts.activationPath,'utf8')); }
    catch(error) {
      if(error.code!=='ENOENT')throw error;
      opts.activation=protectedData.createActivation(opts.password);
      await fs.mkdir(path.dirname(path.resolve(opts.activationPath)),{recursive:true});
      await fs.writeFile(opts.activationPath,JSON.stringify(opts.activation,null,2)+'\n',{flag:'wx'});
    }
    console.log(JSON.stringify(await buildProtectedDataPackage(opts)));
  })().catch(error=>{console.error(error.code||'PROTECTED_DATA_BUILD_FAILED');process.exitCode=1;});
}
module.exports = {buildProtectedDataPackage};
