const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {listCodexModels,validModel}=require('../scripts/list-agent-models');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'model-catalog-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const binary=path.join(root,'catalog'),record=path.join(root,'calls');
 fs.writeFileSync(binary,'#!'+process.execPath+'\n'+`
const fs=require('fs'),readline=require('readline');
fs.writeFileSync(${JSON.stringify(record)},JSON.stringify(process.argv.slice(2))+'\\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(record)},m.method+'\\n');
 if(process.env.MODEL_TEST_MODE==='hang')return;
 if(m.method==='initialize'){console.log(JSON.stringify({id:m.id,result:{}}));return;}
 if(m.method!=='model/list')return;
 const mode=process.env.MODEL_TEST_MODE;
 if(mode==='error'){console.log(JSON.stringify({id:m.id,error:{message:'fixture failure'}}));return;}
 if(mode==='malformed'){console.log('broken');return;}
 const data=m.params.cursor?[{model:'fixture-b',displayName:'Вторая модель'}]:[{model:'fixture-a',displayName:'Первая модель'},{model:'hidden',displayName:'Hidden',hidden:true}];
 const nextCursor=mode==='cursor-loop'||!m.params.cursor?'next':null;
 const bytes=Buffer.from(JSON.stringify({id:m.id,result:{data,nextCursor}})+'\\n'),split=bytes.findIndex(x=>x>127)+1;
 process.stdout.write(bytes.subarray(0,split));setTimeout(()=>process.stdout.write(bytes.subarray(split)),5);
});`,{mode:0o700});
 return {binary,record};
}
test('model catalog performs metadata handshake only, paginates, filters hidden models and preserves Unicode',async t=>{
 const f=fixture(t);assert.deepEqual(await listCodexModels(f.binary),{models:[{id:'fixture-a',name:'Первая модель'},{id:'fixture-b',name:'Вторая модель'}]});
 const calls=fs.readFileSync(f.record,'utf8').trim().split('\n');assert.deepEqual(JSON.parse(calls.shift()),['app-server','--listen','stdio://']);
 assert.deepEqual(calls,['initialize','initialized','model/list','model/list']);
});
test('catalog failures and cancellation never return a fabricated model list',async t=>{
 const f=fixture(t);
 for(const mode of ['error','malformed','cursor-loop','hang'])await assert.rejects(listCodexModels(f.binary,{environment:{...process.env,MODEL_TEST_MODE:mode},timeoutMs:mode==='hang'?250:5000}),/список моделей/);
 await assert.rejects(listCodexModels('/missing-model-cli'),/список моделей/);
 await assert.rejects(listCodexModels(f.binary,{signal:AbortSignal.abort()}),/список моделей/);
});
test('model IDs accept provider IDs and reject argument/control injection',()=>{
 for(const id of ['fixture-model','claude-version@20261022','sonnet[1m]','arn:aws:bedrock:region:model/version'])assert(validModel(id));
 for(const id of ['','--model','bad model','sonnet\n','x\ny','a'.repeat(257)])assert(!validModel(id));
});
