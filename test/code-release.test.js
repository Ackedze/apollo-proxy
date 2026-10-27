'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync,spawn}=require('node:child_process');
const {once}=require('node:events');
const api=require('../src/code-release/store'),git=require('../src/code-release/git');
const cli=require('../scripts/code-release-cli');
const express=require('express');
const fakeServer=`const http=require('node:http');const s=http.createServer((q,r)=>r.end(JSON.stringify({ok:true,proxy:{name:'apollo-proxy',codeId:process.env.APOLLO_CODE_RELEASE_ID,codeSupervisorPid:Number(process.env.APOLLO_CODE_SUPERVISOR_PID)}}))).listen(0,'127.0.0.1',()=>process.send({type:'apollo-proxy-ready',id:process.env.APOLLO_CODE_RELEASE_ID,port:s.address().port}));process.on('message',m=>{if(m.type==='apollo-code-confirmed'){console.log('CONFIRMED '+process.env.APOLLO_CODE_VERSION);console.log('WORKSPACE '+process.env.CODEX_WORKSPACE);}});process.stdin.resume();const stop=()=>s.close(()=>process.exit(0));process.stdin.on('end',stop);process.on('SIGTERM',stop);`;
async function fixture(t) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'apollo-code-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const home=path.join(root,'proxy'),store=path.join(root,'code-releases');
  await fs.mkdir(path.join(home,'node_modules'),{recursive:true});
  await fs.writeFile(path.join(home,'package.json'),JSON.stringify({version:'1.0.0',dependencies:{}}));
  await fs.writeFile(path.join(home,'package-lock.json'),'{}');
  await fs.writeFile(path.join(home,'node_modules/.package-lock.json'),'{}');
  await fs.writeFile(path.join(home,'server.js'),fakeServer);
  await fs.writeFile(path.join(home,'.env'),'CODEX_MODEL=keep-me\n');
  await fs.mkdir(path.join(home,'.local/token-journal'),{recursive:true});
  await fs.writeFile(path.join(home,'.local/token-journal/user.json'),'existing tokens');
  await fs.writeFile(path.join(home,'auth-history-fixture'),'untouched');
  const before={};for(const f of ['.env','.local/token-journal/user.json','auth-history-fixture','node_modules/.package-lock.json','package-lock.json'])before[f]=await fs.readFile(path.join(home,f));
  await api.ensureStore({home,store});
  async function preserved(){for(const [name,bytes]of Object.entries(before))assert.deepEqual(await fs.readFile(path.join(home,name)),bytes,name);}
  return {root,home,store,preserved};
}
async function release(f,{version='1.1.0',server=fakeServer}={}) {
  const source=await fs.mkdtemp(path.join(f.root,'source-'));
  await fs.writeFile(path.join(source,'server.js'),server);
  await fs.copyFile(path.join(f.home,'package.json'),path.join(source,'package.json'));
  const payload=path.join(f.root,'payload-'+crypto.randomUUID());
  const manifest=await api.snapshotCode({sourceRoot:source,destination:payload,version,sourceCommit:'a'.repeat(40),profile:api.compatibility(f.home)});
  const archive=path.join(f.root,manifest.id+'.tgz');
  execFileSync('/usr/bin/tar',['-czf',archive,'-C',payload,'.'],{env:{...process.env,COPYFILE_DISABLE:'1'}});
  return {manifest,archive,payload};
}
function launch(f,timeout=1500,env={}) {
  const supervisor=path.resolve(__dirname,'../src/code-release/supervisor');
  const child=spawn(process.execPath,['-e',`require(${JSON.stringify(supervisor)}).supervise(${JSON.stringify({home:f.home,store:f.store,startTimeoutMs:timeout})}).then(c=>process.exitCode=c).catch(e=>{console.error(e);process.exitCode=1})`],{stdio:['pipe','pipe','pipe'],env:{...process.env,...env}});
  let output='',stderr='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>stderr+=b);
  async function ready(version) {
    const deadline=Date.now()+7000;
    while(!output.includes('CONFIRMED '+version)) {
      if(child.exitCode!==null || Date.now()>deadline)throw Error('did not start: '+stderr+' '+output);
      await new Promise(r=>setTimeout(r,20));
    }
  }
  async function stop(){if(child.exitCode!==null)return;child.kill('SIGTERM');await once(child,'exit');}
  return {child,ready,stop,stderr:()=>stderr,stdout:()=>output};
}
test('a complete app build replaces the JS overlay and keeps the previous immutable bytes',async t=>{
  const f=await fixture(t),old=api.readState(f.store).current;
  const r=await release(f);await api.installArchive({...f,...r});
  await api.finishLaunch(f,r.manifest.id);
  await fs.writeFile(path.join(f.home,'.bundle-build-id'),'local-app-build-2\n');
  await fs.writeFile(path.join(f.home,'server.js'),fakeServer+'\n// new bundled code\n');
  const next=await api.ensureStore(f);
  assert.notEqual(next.current.id,r.manifest.id);assert.equal(next.pending,null);assert.equal(next.previous,null);
  assert.equal(next.bundleBuild,'local-app-build-2');
  assert.equal((await api.ensureStore(f)).current.id,next.current.id);
  assert.match(await fs.readFile(path.join(api.versionRoot(f.store,next.current.id),'server.js'),'utf8'),/new bundled code/);
  assert.ok(await fs.stat(api.versionRoot(f.store,old.id)));assert.ok(await fs.stat(api.versionRoot(f.store,r.manifest.id)));
  await f.preserved();
});
test('immutable code update, launch confirmation and rollback preserve settings, auth/history and journal',async t=>{
  const f=await fixture(t),seed=api.readState(f.store).current;
  const r=await release(f);await api.installArchive({...f,...r});
  assert.equal(api.readState(f.store).current.id,seed.id);assert.equal(api.readState(f.store).pending.id,r.manifest.id);
  let running=launch(f);t.after(()=>running.stop());await running.ready('1.1.0');
  let state=api.readState(f.store);assert.equal(state.current.id,r.manifest.id);assert.equal(state.previous.id,seed.id);assert.equal(state.pending,null);
  await running.stop();await api.rollback(f);running=launch(f);await running.ready(seed.version);
  state=api.readState(f.store);assert.equal(state.current.id,seed.id);assert.equal(state.previous.id,r.manifest.id);
  await running.stop();await f.preserved();
});
test('failed or timed-out candidate returns to the working version; interrupted attempt is not retried',async t=>{
  const f=await fixture(t),seed=api.readState(f.store).current;
  for(const [i,server] of [`throw Error('bad release');`,`setInterval(()=>{},1000);`,fakeServer.replace('ok:true','ok:false')].entries()) {
    const r=await release(f,{version:'1.2.'+i,server});
    await api.installArchive({...f,...r});const running=launch(f,150);t.after(()=>running.stop());
    await running.ready(seed.version);assert.match(running.stderr(),/ROLLED_BACK/);
    const state=api.readState(f.store);assert.equal(state.current.id,seed.id);assert.equal(state.pending,null);assert.equal(state.lastFailure.id,r.manifest.id);
    await running.stop();
  }
  const r=await release(f,{version:'1.2.3'});await api.installArchive({...f,...r});
  const selected=await api.beginLaunch(f);assert.equal(selected.candidate,true);
  const again=await api.beginLaunch(f);assert.equal(again.id,seed.id);assert.equal(api.readState(f.store).lastFailure.code,'CODE_START_INTERRUPTED');
  await f.preserved();
});
test('damaged, extra-file, symlink and incompatible archives never change selection',async t=>{
  const f=await fixture(t),r=await release(f),before=await fs.readFile(path.join(f.store,'state.json'));
  const incompatible={...r.manifest,compatibility:{...r.manifest.compatibility,node:'0.0.0'}};delete incompatible.id;incompatible.id=require('../src/data-release').idOf(incompatible);
  await assert.rejects(api.installArchive({...f,...r,manifest:incompatible}),/CODE_INCOMPATIBLE/);
  const broken=path.join(f.root,'broken.tgz');await fs.writeFile(broken,'bad archive');
  await assert.rejects(api.installArchive({...f,...r,archive:broken}));
  await fs.writeFile(path.join(r.payload,'unlisted.js'),'unverified');
  const extra=path.join(f.root,'extra.tgz');execFileSync('/usr/bin/tar',['-czf',extra,'-C',r.payload,'.']);
  await assert.rejects(api.installArchive({...f,...r,archive:extra}),/CODE_PAYLOAD_EXTRA_FILE/);
  await fs.unlink(path.join(r.payload,'unlisted.js'));await fs.symlink(f.home,path.join(r.payload,'link'));
  const linked=path.join(f.root,'linked.tgz');execFileSync('/usr/bin/tar',['-czf',linked,'-C',r.payload,'.']);
  await assert.rejects(api.installArchive({...f,...r,archive:linked}),/regular files/);
  assert.deepEqual(await fs.readFile(path.join(f.store,'state.json')),before);await f.preserved();
});
test('Git check pins one trusted commit and verifies archive bytes before installation',async t=>{
  const f=await fixture(t),r=await release(f),data=await fs.readFile(r.archive),commit='b'.repeat(40);
  const index={schemaVersion:'apollo.git-code-index.v1',manifest:r.manifest,archive:{path:'code-packages/releases/'+r.manifest.id+'.tgz',bytes:data.length,sha256:api.sha(data)}};
  const line=commit+' refs/heads/main\n',refs=Buffer.from((Buffer.byteLength(line)+4).toString(16).padStart(4,'0')+line+'0000');
  const urls=[];
  const request=async url=>{urls.push(String(url));return new Response(String(url).includes('/info/refs?')?refs:String(url).endsWith('/current.json')?JSON.stringify(index):data);};
  const selected=await git.check(api.compatibility(f.home),{request});assert.equal(selected.sourceCommit,commit);
  assert.deepEqual(await git.download(selected,{request}),data);
  assert(urls.slice(1).every(url=>url.startsWith('https://raw.githubusercontent.com/Ackedze/apollo-proxy/'+commit+'/')));
  await assert.rejects(git.download(selected,{request:async()=>new Response(Buffer.from('bad'))}),/CODE_ARCHIVE_INTEGRITY/);
  const status=await cli.run('check',{...f,request});assert.equal(status.updateAvailable,true);
  const offline=await cli.run('check',{...f,request:async()=>new Response('',{status:404})});assert.equal(offline.checkError,'CODE_GIT_HTTP_404');assert.equal(offline.current.id,api.readState(f.store).current.id);
  await f.preserved();
});
test('authenticated idle barrier refuses active work and closes the race with new work',async t=>{
  const f=await fixture(t),app=express(),key='c'.repeat(64);let active=true,now=100;
  const maintenance=require('../src/code-release/maintenance').createMaintenance({key,busy:async()=>active,now:()=>now});maintenance.mount(app);
  app.get('/health',(_q,res)=>res.json({ok:true,proxy:{codeSupervisorPid:process.pid}}));app.get('/work',(_q,res)=>res.json({success:true}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const url='http://127.0.0.1:'+server.address().port;
  await fs.writeFile(path.join(f.home,'.env'),'PORT='+server.address().port+'\n');
  await fs.writeFile(path.join(f.store,'control.json'),JSON.stringify({pid:process.pid,key}),{mode:0o600});
  const before=await fs.readFile(path.join(f.store,'state.json'));
  await assert.rejects(cli.acquireIdle(f),/CODE_PROXY_BUSY/);assert.deepEqual(await fs.readFile(path.join(f.store,'state.json')),before);
  assert.equal((await fetch(url+'/work')).status,200);
  active=false;const release=await cli.acquireIdle(f);assert.equal((await fetch(url+'/work')).status,503);
  assert.equal((await fetch(url+'/health')).status,200);
  assert.equal((await fetch(url+'/code-update/release',{method:'POST'})).status,403);
  assert.equal((await fetch(url+'/work')).status,503);await release();assert.equal((await fetch(url+'/work')).status,200);
  const prepared=await cli.run('prepare-app-update',f);
  assert.ok(prepared.appUpdateLease);assert.equal((await fetch(url+'/work')).status,503);
  const oldLease=process.env.APOLLO_APP_UPDATE_LEASE;process.env.APOLLO_APP_UPDATE_LEASE=prepared.appUpdateLease;
  try {await cli.run('release-app-update',f);}finally{if(oldLease===undefined)delete process.env.APOLLO_APP_UPDATE_LEASE;else process.env.APOLLO_APP_UPDATE_LEASE=oldLease;}
  assert.equal((await fetch(url+'/work')).status,200);
  assert.deepEqual(await fs.readFile(path.join(f.store,'state.json')),before);
  await cli.acquireIdle(f);now+=120001;assert.equal((await fetch(url+'/work')).status,200);
});
test('publisher reads the pinned commit and excludes env, dependencies and mutable history',async t=>{
  const f=await fixture(t),source=path.join(f.root,'publisher-source');await fs.mkdir(source);
  for(const name of ['server.js','package.json','package-lock.json','.env','auth-history-fixture'])await fs.copyFile(path.join(f.home,name),path.join(source,name));
  execFileSync('git',['init','-q'],{cwd:source});execFileSync('git',['add','.'],{cwd:source});
  execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture'],{cwd:source});
  const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
  await fs.writeFile(path.join(source,'server.js'),'throw Error("uncommitted");');
  const built=await require('../scripts/build-code-release').build({sourceRoot:source,home:f.home,version:'1.4.1',output:path.join(f.root,'built'),commit});
  assert.equal(built.index.manifest.sourceCommit,commit);
  assert.deepEqual(built.index.manifest.files.map(p=>p.file),['package.json','server.js']);
  assert.equal(await fs.readFile(path.join(f.root,'built/payload/server.js'),'utf8'),fakeServer);
  assert.match(built.archive,/code-packages\/releases\/[a-f0-9]{64}\.tgz$/);
  await api.installArchive({...f,archive:built.archive,manifest:built.index.manifest});
  await f.preserved();
});
test('supervisor parent EOF stops its worker; startup gate waits for confirmation',async t=>{
  const f=await fixture(t),running=launch(f);t.after(()=>running.stop());
  await running.ready(api.readState(f.store).current.version);
  running.child.stdin.end();await once(running.child,'exit');assert.equal(running.child.exitCode,0);
  assert.equal(await fs.stat(path.join(f.store,'control.json')).then(()=>true,()=>false),false);
  const app=express(),id='d'.repeat(64);let reads=0;
  require('../src/code-release/maintenance').createMaintenance({key:'e'.repeat(64),launchId:id,busy:async()=>false}).mount(app);
  app.get('/work',(_q,res)=>{reads++;res.json({success:true});});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const url='http://127.0.0.1:'+server.address().port+'/work';assert.equal((await fetch(url)).status,503);assert.equal(reads,0);
  process.emit('message',{type:'apollo-code-confirmed',id:'wrong'});assert.equal((await fetch(url)).status,503);
  process.emit('message',{type:'apollo-code-confirmed',id});assert.equal((await fetch(url)).status,200);assert.equal(reads,1);
});
test('actual Proxy launches from code store with fixed home, counts partial requests and preserves parent lifetime',async t=>{
  const f=await fixture(t),source=path.resolve(__dirname,'..');
  await fs.rm(f.store,{recursive:true,force:true});
  for(const name of api.codeFiles(source)) {
    await fs.mkdir(path.dirname(path.join(f.home,name)),{recursive:true});
    await fs.copyFile(path.join(source,name),path.join(f.home,name));
  }
  await fs.copyFile(path.join(source,'package-lock.json'),path.join(f.home,'package-lock.json'));
  await fs.rm(path.join(f.home,'node_modules'),{recursive:true,force:true});
  await fs.symlink(path.join(source,'node_modules'),path.join(f.home,'node_modules'));
  const net=require('node:net'),probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(r=>probe.close(r));
  const config='CODEX_MODEL=keep-me\nPORT='+port+'\n';await fs.writeFile(path.join(f.home,'.env'),config);
  const hub=path.join(f.home,'fixture-hub');
  await fs.mkdir(path.join(hub,'products/ab/patterns'),{recursive:true});
  await fs.mkdir(path.join(hub,'products/ab/components/fixture'),{recursive:true});
  await fs.writeFile(path.join(hub,'products/ab/patterns/fixture.md'),'# Pattern: Fixture\n');
  await fs.writeFile(path.join(hub,'products/ab/components/fixture/meta.json'),JSON.stringify({id:'Fixture'}));
  const running=launch(f,8000,{PORT:String(port),HOST:'127.0.0.1',CODEX_DESIGN_SYSTEM:path.join(f.home,'no-ds'),
    CODEX_DS_AI_HUB:hub,APOLLO_PROJECT_ROOT:path.join(f.home,'no-apollo'),
    APOLLO_RELEASE_ROOT:'',APOLLO_DATA_ROOT:''});t.after(()=>running.stop());
  const until=async check=>{const deadline=Date.now()+8000;while(Date.now()<deadline){if(running.child.exitCode!==null)throw Error(running.stderr());try{const value=await check();if(value)return value;}catch{}await new Promise(r=>setTimeout(r,20));}throw Error('actual Proxy timeout '+running.stderr());};
  const url='http://127.0.0.1:'+port;
  const health=await until(async()=>{const r=await fetch(url+'/health');return r.ok?await r.json():null;});
  assert.equal(health.proxy.codeSupervisorPid,running.child.pid);
  assert.equal(health.proxy.codeId,api.readState(f.store).current.id);
  await until(async()=>(await fetch(url+'/not-a-route')).status===404);
  const req=require('node:http').request(url+'/analyze',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'1000'}});
  req.on('error',()=>{});req.write('{');
  await until(async()=>(await(await fetch(url+'/health')).json()).activeRequests>0);
  await assert.rejects(cli.acquireIdle(f),/CODE_PROXY_BUSY/);
  req.destroy();await until(async()=>(await(await fetch(url+'/health')).json()).activeRequests===0);
  const release=await cli.acquireIdle(f);assert.equal((await fetch(url+'/not-a-route')).status,503);await release();
  running.child.stdin.end();await once(running.child,'exit');assert.equal(running.child.exitCode,0);
  assert.equal(await fs.readFile(path.join(f.home,'.env'),'utf8'),config);
  assert.equal(await fs.readFile(path.join(f.home,'.local/token-journal/user.json'),'utf8'),'existing tokens');
  assert.equal(await fs.readFile(path.join(f.home,'auth-history-fixture'),'utf8'),'untouched');
});
test('stored code corruption recovers the verified previous version without changing user files',async t=>{
  const f=await fixture(t),seed=api.readState(f.store).current,r=await release(f);
  await api.installArchive({...f,...r});const selected=await api.beginLaunch(f);await api.finishLaunch(f,selected.id);
  const file=path.join(api.versionRoot(f.store,r.manifest.id),'server.js');await fs.chmod(file,0o600);await fs.writeFile(file,'changed after install');
  const state=await api.ensureStore(f);assert.equal(state.current.id,seed.id);assert.equal(state.lastFailure.code,'CODE_CURRENT_INVALID');
  await f.preserved();
});
test('CLI update joins commit-pinned download with idle admission; local rollback works without Git',async t=>{
  const f=await fixture(t),r=await release(f),data=await fs.readFile(r.archive),commit='f'.repeat(40),key='e'.repeat(64);
  const lock=await fs.readFile(path.join(f.home,'node_modules/.package-lock.json'));
  await fs.writeFile(path.join(f.home,'node_modules/.package-lock.json'),'{"version":"1.4.2"}');
  const primary=await release(f),primaryData=await fs.readFile(primary.archive);
  await fs.writeFile(path.join(f.home,'node_modules/.package-lock.json'),lock);
  const index={schemaVersion:'apollo.git-code-index.v1',manifest:primary.manifest,
    archive:{path:'code-packages/releases/'+primary.manifest.id+'.tgz',bytes:primaryData.length,sha256:api.sha(primaryData)},
    alternatives:[{manifest:r.manifest,archive:{path:'code-packages/releases/'+r.manifest.id+'.tgz',bytes:data.length,sha256:api.sha(data)}}]};
  const line=commit+' refs/heads/main\n',refs=Buffer.from((Buffer.byteLength(line)+4).toString(16).padStart(4,'0')+line+'0000');
  let active=true,downloads=0;
  const app=express();require('../src/code-release/maintenance').createMaintenance({key,busy:async()=>active}).mount(app);
  app.get('/health',(_q,res)=>res.json({ok:true,proxy:{codeSupervisorPid:process.pid}}));
  app.get('/work',(_q,res)=>res.end('work'));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port,config='PORT='+server.address().port+'\n';
  await fs.writeFile(path.join(f.home,'.env'),config);
  await fs.writeFile(path.join(f.store,'control.json'),JSON.stringify({pid:process.pid,key}));
  const request=async(url,options)=>{
    if(String(url).startsWith('http://127.0.0.1:'))return fetch(url,options);
    if(String(url).includes('/info/refs?'))return new Response(refs);
    if(String(url).endsWith('/current.json'))return new Response(JSON.stringify(index));
    downloads++;return new Response(data);
  };
  await assert.rejects(cli.run('update',{...f,request}),/CODE_PROXY_BUSY/);
  assert.equal(downloads,0);assert.equal(api.readState(f.store).pending,null);
  active=false;const result=await cli.run('update',{...f,request});assert.equal(result.restartRequired,true);
  assert.equal(result.pending.id,r.manifest.id);assert.equal(downloads,1);assert.equal((await fetch(url+'/work')).status,503);
  await new Promise(resolve=>server.close(resolve));
  const running=launch(f);t.after(()=>running.stop());await running.ready(r.manifest.version);await running.stop();
  const rolled=await cli.run('rollback',{...f,request:async(url,options)=>{assert(String(url).startsWith('http://127.0.0.1:'));return fetch(url,options);}});
  assert.equal(rolled.restartRequired,true);assert.equal(rolled.pending.id,result.current.id);
  assert.equal(await fs.readFile(path.join(f.home,'.env'),'utf8'),config);
  assert.equal(await fs.readFile(path.join(f.home,'.local/token-journal/user.json'),'utf8'),'existing tokens');
});
test('supervisor retains the configured workspace from the unchanged installed env',async t=>{
  const f=await fixture(t),workspace=path.join(f.root,'kept workspace'),config='CODEX_WORKSPACE='+workspace+'\n';
  await fs.writeFile(path.join(f.home,'.env'),config);
  const running=launch(f);t.after(()=>running.stop());await running.ready(api.readState(f.store).current.version);
  assert(running.stdout().includes('WORKSPACE '+workspace));await running.stop();
  assert.equal(await fs.readFile(path.join(f.home,'.env'),'utf8'),config);
});

test('Git selects only an exact compatible alternative; old readers retain the unchanged primary',async t=>{
  const f=await fixture(t),legacy=await release(f),legacyBytes=await fs.readFile(legacy.archive);
  const legacyLock=await fs.readFile(path.join(f.home,'node_modules/.package-lock.json'));
  await fs.writeFile(path.join(f.home,'node_modules/.package-lock.json'),'{"version":"1.4.2"}');
  const primary=await release(f),primaryBytes=await fs.readFile(primary.archive);
  await fs.writeFile(path.join(f.home,'node_modules/.package-lock.json'),legacyLock);
  const entry=(r,data)=>({manifest:r.manifest,archive:{path:'code-packages/releases/'+r.manifest.id+'.tgz',bytes:data.length,sha256:api.sha(data)}});
  const primaryEntry=entry(primary,primaryBytes),legacyEntry=entry(legacy,legacyBytes);
  let index={schemaVersion:'apollo.git-code-index.v1',...primaryEntry,alternatives:[legacyEntry]};
  const commit='b'.repeat(40),line=commit+' refs/heads/main\n';
  const refs=Buffer.from((Buffer.byteLength(line)+4).toString(16).padStart(4,'0')+line+'0000'),urls=[];
  const request=async url=>{
    urls.push(String(url));
    return new Response(String(url).includes('/info/refs?')?refs:String(url).endsWith('/current.json')?JSON.stringify(index)
      :String(url).endsWith('/'+legacy.manifest.id+'.tgz')?legacyBytes:primaryBytes);
  };
  // The original reader only consumes primary manifest/archive; extra alternatives cannot change it.
  const oldModule={exports:{}};
  const oldSource=await fs.readFile(path.join(__dirname,'fixtures/code-release/git-v1.js'),'utf8');
  const localRequire=require('node:module').createRequire(require.resolve('../src/code-release/git'));
  new Function('require','module','exports',oldSource)(localRequire,oldModule,oldModule.exports);
  assert.equal((await oldModule.exports.check(primary.manifest.compatibility,{request})).manifest.id,primary.manifest.id);
  assert.equal((await git.check(primary.manifest.compatibility,{request})).manifest.id,primary.manifest.id);
  const selected=await git.check(api.compatibility(f.home),{request});
  assert.equal(selected.manifest.id,legacy.manifest.id);
  assert.deepEqual(await git.download(selected,{request}),legacyBytes);
  assert(urls.filter(url=>!url.includes('/info/refs?')).every(url=>url.startsWith('https://raw.githubusercontent.com/Ackedze/apollo-proxy/'+commit+'/')));
  for(const [key,value] of Object.entries({launcher:2,node:'0.0.0',platform:'other',dependencies:'0'.repeat(64),lock:'0'.repeat(64),installed:'0'.repeat(64)})) {
    await assert.rejects(git.check({...api.compatibility(f.home),[key]:value},{request}),/CODE_INCOMPATIBLE/);
  }
  await api.installArchive({...f,archive:legacy.archive,manifest:selected.manifest});
  assert.equal(api.readState(f.store).pending.id,legacy.manifest.id);
  const pristine=structuredClone(index);
  index.alternatives[0].archive.path='untrusted.tgz';
  await assert.rejects(git.check(api.compatibility(f.home),{request}),/CODE_INDEX_INVALID/);
  index=structuredClone(pristine);index.alternatives[0].manifest.files[0].sha256='0'.repeat(64);
  await assert.rejects(git.check(api.compatibility(f.home),{request}),/CODE_MANIFEST_INVALID/);
  index={...pristine,alternatives:{}};
  await assert.rejects(git.check(api.compatibility(f.home),{request}),/CODE_INDEX_INVALID/);
  index={...pristine,alternatives:Array(9).fill(legacyEntry)};
  await assert.rejects(git.check(api.compatibility(f.home),{request}),/CODE_INDEX_INVALID/);
  await f.preserved();
});
