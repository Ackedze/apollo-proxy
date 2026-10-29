const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createStatisticsDelivery,digest}=require('../src/audit-statistics/delivery');
const sample=id=>({schemaVersion:2,reportKind:'apollo-audit-metrics',reportId:id,runId:'run',sourceReportId:null,origin:'contract-area',operation:'check',status:'failed',startedAt:'2026-10-29T00:00:00.000Z',durationMs:1,versions:{plugin:'0.4.1',build:'build1',runtime:'runtime1',data:null,knowledge:null},scope:{platform:'Desktop',rootCount:null,scannedNodes:null},metrics:null,excludeFromAnalytics:false});
const wait=async check=>{for(let i=0;i<500;i++){if(check())return;await new Promise(r=>setTimeout(r,2));}throw Error('bounded wait');};
const root=()=>fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'apollo-result-stats-'));
const request=async(_url,options)=>{const r=JSON.parse(options.body);return new Response(JSON.stringify({ok:true,reportId:r.reportId,payloadHash:digest(r),repository:'Ackedze/design-system_stats',path:'apollo/metrics/test/'+r.reportId+'.json'}));};
test('local durable receipt precedes remote save; restart forwards and repeated ID is idempotent',async()=>{
 const dir=root(),errors=[];let a=createStatisticsDelivery(dir,{request:async()=>{throw Error('OFFLINE');},onError:e=>errors.push(e)});
 try{const r=sample('restart');assert.equal(a.accept(r).state,'proxy-durable');await wait(()=>errors.includes('OFFLINE'));assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.pending.json')).length,1);a.close();a=createStatisticsDelivery(dir,{request,onError:e=>errors.push(e)});await wait(()=>fs.readdirSync(dir).some(n=>n.endsWith('.saved.json')));assert.equal(a.accept(r).state,'repository-saved');assert.throws(()=>a.accept(Object.assign({},r,{durationMs:2})),/CONFLICT/);assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.saved.json')).length,1);}finally{a.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('two producers cannot overwrite and poison row does not block a valid report',async()=>{
 const dir=root(),errors=[];fs.writeFileSync(path.join(dir,'a'.repeat(64)+'.pending.json'),'bad');const a=createStatisticsDelivery(dir,{request,onError:e=>errors.push(e)}),b=createStatisticsDelivery(dir,{request,onError:e=>errors.push(e)});
 try{assert.equal(a.accept(sample('one')).accepted,true);assert.equal(b.accept(sample('two')).accepted,true);await wait(()=>fs.readdirSync(dir).filter(n=>n.endsWith('.saved.json')).length===2);assert.ok(fs.existsSync(path.join(dir,'a'.repeat(64)+'.pending.json')));assert.ok(errors.length>0);}finally{a.close();b.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('incorrect remote receipt and body timeout preserve pending report',async()=>{
 for(const mode of ['wrong','stalled']){const dir=root(),errors=[];const a=createStatisticsDelivery(dir,{timeoutMs:10,retryMs:1000,onError:e=>errors.push(e),request:async()=>mode==='wrong'?new Response(JSON.stringify({ok:true,reportId:'wrong',payloadHash:'0'.repeat(64)})):new Response(new ReadableStream({start(){}}))});
  try{a.accept(sample(mode));await wait(()=>errors.some(e=>/RECEIPT|TIMEOUT/.test(e)));assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.pending.json')).length,1);assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.saved.json')).length,0);}finally{a.close();fs.rmSync(dir,{recursive:true,force:true});}}
});
test('quota refusal and invalid report retain previously accepted bytes',()=>{
 const dir=root(),a=createStatisticsDelivery(dir,{maxBytes:1,onError:()=>{}});try{assert.throws(()=>a.accept(sample('quota')),/QUEUE_FULL/);assert.throws(()=>a.accept(Object.assign(sample('bad'),{snapshot:{text:'PRIVATE'}})),/REPORT_INVALID/);assert.equal(fs.readdirSync(dir).length,0);}finally{a.close();fs.rmSync(dir,{recursive:true,force:true});}
});
