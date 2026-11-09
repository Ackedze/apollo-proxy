'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process'),{setTimeout:delay}=require('node:timers/promises');
const release=require('../src/data-release');
const root=path.resolve(__dirname,'..'),managed=path.join(root,'src/data-release/managed-command.js');
async function until(check){for(let i=0;i<200;i++){if(check())return;await delay(20);}throw Error('Lifecycle deadline exceeded');}
function launch(executable,args,env={}){
  const child=spawn(executable,args,{env:{...process.env,...env},stdio:['pipe','pipe','pipe']});let output='',error='';
  child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  return {child,exited,output:()=>output,error:()=>error};
}
test('owned native knowledge command stops on quit, forced parent death and deadline; each permits relaunch', {skip:process.platform!=='darwin',timeout:60000},async t=>{
  const temporary=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-lifecycle-')));t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  const sources=path.join(root,'macos-app/Sources/ApolloProxyControl'),binary=path.join(temporary,'runner'),fixture=path.join(__dirname,'fixtures/knowledge-command/hold.js');
  execFileSync('/usr/bin/swiftc',['-swift-version','6','-module-cache-path',path.join(temporary,'cache'),path.join(sources,'KnowledgeCommandRunner.swift'),path.join(sources,'ProxyProcessLifecycle.swift'),path.join(__dirname,'fixtures/knowledge-command/main.swift'),'-o',binary],{timeout:40000});
  for(const mode of ['normal','force','timeout'])await t.test(mode,async()=>{
    const folder=path.join(temporary,mode);fs.mkdirSync(folder);const run=launch(binary,[process.execPath,fixture,managed,folder,mode]);
    t.after(()=>{if(run.child.exitCode===null&&run.child.signalCode===null)run.child.kill('SIGKILL');});
    await until(()=>run.output().includes('READY '));const held=JSON.parse(fs.readFileSync(path.join(folder,'held.json')));assert.equal(held.lock.pid,held.pid);
    if(mode==='force')run.child.kill('SIGKILL');else if(mode==='normal')run.child.stdin.end();
    const exit=await run.exited;assert.equal(exit.code,mode==='force'?null:0,run.error());
    if(mode==='normal')assert.match(run.output(),/OWNED_CHILD_STOPPED/);if(mode==='timeout')assert.match(run.output(),/TIMEOUT_OK/);
    await until(()=>{try{process.kill(held.pid,0);return false;}catch(e){assert.equal(e.code,'ESRCH');return true;}});
    const result=execFileSync(binary,[process.execPath,fixture,managed,folder,'success'],{encoding:'utf8',timeout:5000});assert.match(result,/RELAUNCH_OK/);assert(!fs.existsSync(path.join(folder,'store/.update.lock')));
  });
  const oversized=path.join(temporary,'oversized');fs.mkdirSync(oversized);assert.match(execFileSync(binary,[process.execPath,fixture,managed,oversized,'oversized'],{encoding:'utf8',timeout:5000}),/INPUT_REJECTED/);assert(!fs.existsSync(path.join(oversized,'store')));
});

test('managed Git CLI completes one bounded private line while stdin stays open; standalone EOF remains compatible',async t=>{
  const folder=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-input-')));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  fs.mkdirSync(path.join(folder,'seed'));fs.writeFileSync(path.join(folder,'seed/.activation-required'),'');
  const args=[path.join(root,'scripts/git-data-cli.js'),'ensure','--store',path.join(folder,'store'),'--seed',path.join(folder,'seed'),'--runtime',path.join(folder,'runtime')];
  const run=launch(process.execPath,['--require',managed,...args],{APOLLO_DATA_INPUT:'1',APOLLO_DATA_MANAGED:'1',APOLLO_DATA_TIMEOUT_MS:'2000'});
  t.after(()=>{if(run.child.exitCode===null)run.child.kill('SIGKILL');});run.child.stdin.write('{}\n');
  assert.equal((await run.exited).code,0,run.error());assert.equal(JSON.parse(run.output()).activationRequired,true);
  const standalone=launch(process.execPath,args,{APOLLO_DATA_INPUT:'1',APOLLO_DATA_MANAGED:'0'});standalone.child.stdin.end('{}');assert.equal((await standalone.exited).code,0);assert.equal(JSON.parse(standalone.output()).activationRequired,true);
});
test('managed private input rejects malformed, oversized and trailing data without echoing it',async t=>{
  for(const input of ['private-secret\n',JSON.stringify({password:'x'.repeat(4096)})+'\n','{}\nextra']){
    const folder=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-invalid-')));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
    const run=launch(process.execPath,['--require',managed,path.join(root,'scripts/git-data-cli.js'),'ensure','--store',path.join(folder,'store'),'--seed',path.join(folder,'seed'),'--runtime',path.join(folder,'runtime')],{APOLLO_DATA_INPUT:'1',APOLLO_DATA_MANAGED:'1',APOLLO_DATA_TIMEOUT_MS:'2000'});
    run.child.stdin.write(input);assert.equal((await run.exited).code,1);assert.equal(JSON.parse(run.output()).error,'DATA_ACTIVATION_INPUT_INVALID');assert(!run.output().includes('private-secret'));assert(!fs.existsSync(path.join(folder,'store')));
  }
});
test('a managed contender never steals a foreign live updater lock',async t=>{
  const folder=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-foreign-')));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const bytes=JSON.stringify({pid:process.pid});fs.writeFileSync(path.join(folder,'.update.lock'),bytes);
  await assert.rejects(release.withLock(folder,async()=>assert.fail('stole live lock')),{code:'DATA_RELEASE_BUSY'});assert.equal(fs.readFileSync(path.join(folder,'.update.lock'),'utf8'),bytes);
});
