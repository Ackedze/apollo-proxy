'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const release=require('../src/data-release'),catalog=require('../src/skills/catalog');
const {build}=require('../scripts/build-skill-catalog');
const {updateFromGit}=require('../scripts/git-data-cli');
const sha=catalog.sha;
const json=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
test('Git skill-only delivery admits both profiles, preserves contracts/knowledge/runtime and supports no-op, refusal and rollback',{timeout:120000},async t=>{
  const inputs={runtimeRoot:process.env.APOLLO_TEST_RUNTIME_ROOT,releaseRoot:process.env.APOLLO_TEST_RELEASE_ROOT,skillsRoot:process.env.APOLLO_TEST_SKILLS_ROOT};
  for(const [key,value] of Object.entries(inputs))assert(value&&path.isAbsolute(value),'Configure immutable '+key+' for this integration test');
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'skill-git-delivery-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const sourceRoot=path.join(root,'repo/apollo/skills'),indexPath=path.join(root,'repo/apollo/data-packages/current.json');
  fs.mkdirSync(path.dirname(indexPath),{recursive:true});fs.cpSync(inputs.skillsRoot,sourceRoot,{recursive:true});
  const settings={storeRoot:path.join(root,'store'),seedRoot:inputs.releaseRoot,runtimeRoot:inputs.runtimeRoot};
  const first=await release.ensureStore(settings),beforeRuntime=fs.readFileSync(path.join(inputs.runtimeRoot,'portable-runtime.json'));
  const frozen=['contracts/manifest.json','knowledge/manifest.json'].map(file=>[file,fs.readFileSync(path.join(first.state.current.path,file))]);
  const runtime=release.readRuntime(inputs.runtimeRoot),dataId=first.state.current.dataId;
  json(indexPath,{schemaVersion:'apollo.git-data-index.v1',runtimeId:runtime.id,snapshot:{path:'apollo/data-packages/'+dataId+'/contracts.tgz',sha256:'0'.repeat(64),bytes:1,dataId}});
  function changeInstructions(label){
    for(const [folder,version,field] of [['','0.1.99','files'],['run','0.2.99','instructions']]){
      const dir=path.join(sourceRoot,catalog.ID,folder),file=path.join(dir,'SKILL.md'),profilePath=path.join(dir,'profile.json');
      const text=fs.readFileSync(file,'utf8')+'\n'+label+'\n',profile=JSON.parse(fs.readFileSync(profilePath));
      fs.writeFileSync(file,text);profile.version=version;
      if(field==='files')Object.assign(profile.files[0],{sha256:sha(Buffer.from(text)),bytes:Buffer.byteLength(text)});
      else profile.instructions={sha256:sha(Buffer.from(text)),bytes:Buffer.byteLength(text)};
      json(profilePath,profile);
    }
    return build({sourceRoot,runtimeRoot:inputs.runtimeRoot,indexPath});
  }
  const published=changeInstructions('SYNTHETIC_REMOTE_SKILL_RULE');
  const commit='c'.repeat(40),pkt=text=>(Buffer.byteLength(text)+4).toString(16).padStart(4,'0')+text;
  const calls=[];let corrupt=false,missing=false;
  const request=async(url)=>{
    calls.push(url);
    if(url.includes('/info/refs?'))return new Response(pkt(commit+' refs/heads/main\n')+'0000');
    const prefix='https://raw.githubusercontent.com/example/data/'+commit+'/';assert(url.startsWith(prefix),'Git files must use one exact commit');
    const relative=decodeURI(url.slice(prefix.length));assert(!relative.endsWith('.tgz'),'Unchanged contracts must not be downloaded');
    assert(relative==='apollo/data-packages/current.json'||relative.startsWith('apollo/skills/'));
    if(missing&&relative.endsWith('/run/SKILL.md'))return new Response('',{status:404});
    return new Response(corrupt&&relative.endsWith('/run/SKILL.md')?'corrupted':fs.readFileSync(path.join(root,'repo',relative)));
  };
  const args={settings,ensured:first,url:'https://raw.githubusercontent.com/example/data/main/apollo/data-packages/current.json',producerRoot:path.resolve(__dirname,'..'),request};
  assert.equal((await updateFromGit({...args,command:'check'})).updateAvailable,true);assert.equal(calls.length,2);
  const updated=await updateFromGit({...args,command:'update'});
  const admitted=release.readReleaseFiles(updated.releaseRoot,inputs.runtimeRoot);
  assert.equal(admitted.skillsSourceSha256,published.skillsSourceSha256);
  assert.equal(updated.current.dataId,dataId);assert.equal(updated.current.knowledgeVersion,first.state.current.knowledgeVersion);
  const main=require('../src/skills/layer-names').loadSkill(inputs.runtimeRoot,{releaseRoot:updated.releaseRoot});
  const run=require('../src/skills/run-skill').loadRunSkill(inputs.runtimeRoot,{releaseRoot:updated.releaseRoot});
  assert.equal(main.version,'0.1.99');assert.equal(run.version,'0.2.99');
  assert.match(main.instructions,/SYNTHETIC_REMOTE_SKILL_RULE/);assert.match(run.instructions,/SYNTHETIC_REMOTE_SKILL_RULE/);main.assertCurrent();run.assertCurrent();
  for(const [file,bytes] of frozen)assert.deepEqual(fs.readFileSync(path.join(updated.releaseRoot,file)),bytes);
  const ensured={state:await release.readState(settings.storeRoot)},state=fs.readFileSync(path.join(settings.storeRoot,'state.json'));
  const beforeNoop=calls.length;assert.equal((await updateFromGit({...args,ensured,command:'update'})).updateAvailable,false);assert.equal(calls.length-beforeNoop,2);
  assert.deepEqual(fs.readFileSync(path.join(settings.storeRoot,'state.json')),state);
  const declared=JSON.parse(fs.readFileSync(indexPath)),legacy={...declared};delete legacy.skills;json(indexPath,legacy);
  assert.equal((await updateFromGit({...args,ensured,command:'update'})).updateAvailable,false);
  assert.deepEqual(fs.readFileSync(path.join(settings.storeRoot,'state.json')),state);json(indexPath,declared);
  changeInstructions('SECOND_SYNTHETIC_RULE');corrupt=true;
  await assert.rejects(updateFromGit({...args,ensured,command:'update'}),/checksum/);
  assert.deepEqual(fs.readFileSync(path.join(settings.storeRoot,'state.json')),state);
  corrupt=false;missing=true;await assert.rejects(updateFromGit({...args,ensured,command:'update'}),/HTTP 404/);
  assert.deepEqual(fs.readFileSync(path.join(settings.storeRoot,'state.json')),state);
  const restored=await release.rollbackStore(settings);assert.equal(restored.current.contentVersion,first.state.current.contentVersion);
  assert.deepEqual(fs.readFileSync(path.join(inputs.runtimeRoot,'portable-runtime.json')),beforeRuntime);
  assert.deepEqual(fs.readFileSync(path.join(restored.current.path,'knowledge/manifest.json')),frozen[1][1]);
});
