'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),p=require('./protocol');
const {reportPath}=require('./filing');
const ENDPOINT='https://dwjnndpxzqizrcwpasrs.supabase.co/functions/v1/apollo-stats';
const digest=report=>crypto.createHash('sha256').update(p.canonical(report)).digest('hex');
function validReceiptPath(report,target){
 if(typeof target!=='string')return false;
 const expected=reportPath(report),stem=expected.slice(0,-5),hash=crypto.createHash('sha256').update(report.reportId).digest('hex');
 const legacy=`${report.excludeFromAnalytics?'apollo/tests':'apollo/metrics'}/${hash.slice(0,2)}/${hash}.json`;
 return target===expected||Array.from({length:9},(_,i)=>`${stem}-${i+2}.json`).includes(target)||target===legacy;
}
function createStatisticsDelivery(root,{request=require('../http-fetch').fetch,endpoint=ENDPOINT,timeoutMs=15000,retryMs=30000,maxBytes=33554432,onError=code=>console.warn('[Apollo][audit-statistics]',code)}={}){
 function ensureRoot(){fs.mkdirSync(root,{recursive:true,mode:0o700});if(!path.isAbsolute(root)||fs.realpathSync(root)!==root)throw Error('AUDIT_STATISTICS_UNSAFE_ROOT');}
 let flushing=false,closed=false,timer=null,dirty=false;
 const key=id=>crypto.createHash('sha256').update(id).digest('hex');
 const file=(id,suffix)=>path.join(root,key(id)+suffix);
 function read(target){const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>p.MAX_BYTES*2)throw Error('AUDIT_STATISTICS_UNSAFE_RECORD');return JSON.parse(fs.readFileSync(target,'utf8'));}
 function write(target,value){const temp=target+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});fs.linkSync(temp,target);}finally{fs.rmSync(temp,{force:true});}}
 function accept(report){
  if(!p.valid(report))throw Error('AUDIT_STATISTICS_REPORT_INVALID');ensureRoot();const payloadHash=digest(report),target=file(report.reportId,'.pending.json'),receiptFile=file(report.reportId,'.saved.json');
  for(const [candidate,state]of [[receiptFile,'repository-saved'],[target,'proxy-durable']])if(fs.existsSync(candidate)){const old=read(candidate);if(old.reportId!==report.reportId||old.payloadHash!==payloadHash)throw Error('AUDIT_STATISTICS_ID_CONFLICT');return{accepted:true,reportId:report.reportId,payloadHash,state};}
  let size=0;for(const name of fs.readdirSync(root))if(name.endsWith('.pending.json')){const stat=fs.lstatSync(path.join(root,name));if(stat.isSymbolicLink())throw Error('AUDIT_STATISTICS_UNSAFE_RECORD');size+=stat.size;}
  if(size+Buffer.byteLength(p.canonical(report))+512>maxBytes)throw Error('AUDIT_STATISTICS_QUEUE_FULL');
  try{write(target,{reportId:report.reportId,payloadHash,report});}catch(e){if(e.code!=='EEXIST')throw e;const old=read(target);if(old.reportId!==report.reportId||old.payloadHash!==payloadHash)throw Error('AUDIT_STATISTICS_ID_CONFLICT');}
  dirty=true;queueMicrotask(flush);return{accepted:true,reportId:report.reportId,payloadHash,state:'proxy-durable'};
 }
 async function upload(row){const abort=new AbortController();let t;
  try{return await Promise.race([(async()=>{const response=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Apollo-Stats-Layout':'v3'},body:p.canonical(row.report),signal:abort.signal});
   const bytes=await require('../http-fetch').readBytes(response,32768);const receipt=JSON.parse(bytes.toString('utf8'));
   if(!response.ok||receipt.ok!==true||receipt.reportId!==row.reportId||receipt.payloadHash!==row.payloadHash||receipt.repository!=='Ackedze/design-system_stats'||!validReceiptPath(row.report,receipt.path))throw Error('AUDIT_STATISTICS_REMOTE_RECEIPT_INVALID');
   return{reportId:row.reportId,payloadHash:row.payloadHash,path:receipt.path,repository:receipt.repository};})(),new Promise((_,reject)=>{t=setTimeout(()=>{abort.abort();reject(Error('AUDIT_STATISTICS_BODY_TIMEOUT'));},timeoutMs);})]);}finally{clearTimeout(t);}}
 async function flush(){if(closed||flushing)return;flushing=true;dirty=false;let remaining=false;
  try{ensureRoot();for(const name of fs.readdirSync(root).filter(n=>/^[a-f0-9]{64}\.pending\.json$/.test(n))){const target=path.join(root,name);
    try{const row=read(target);if(!p.valid(row.report)||row.reportId!==row.report.reportId||digest(row.report)!==row.payloadHash)throw Error('AUDIT_STATISTICS_CORRUPT_RECORD');
     const receipt=await upload(row),saved=file(row.reportId,'.saved.json');try{write(saved,receipt);}catch(e){if(e.code!=='EEXIST')throw e;const old=read(saved);if(old.payloadHash!==row.payloadHash)throw Error('AUDIT_STATISTICS_ID_CONFLICT');}
     fs.unlinkSync(target);
     // Old receipts can be re-established from the server's stable persisted filing path.
     const receipts=fs.readdirSync(root).filter(n=>/^[a-f0-9]{64}\.saved\.json$/.test(n));if(receipts.length>4096){const oldest=receipts.map(n=>({path:path.join(root,n),time:fs.lstatSync(path.join(root,n)).mtimeMs})).sort((a,b)=>a.time-b.time);for(const row of oldest.slice(0,receipts.length-4096))fs.unlinkSync(row.path);}
    }catch(e){remaining=true;onError(e.message);}
  }}catch(e){remaining=true;onError(e.message);}finally{flushing=false;if(dirty&&!closed)queueMicrotask(flush);else if(remaining&&!closed&&!timer){timer=setTimeout(()=>{timer=null;void flush();},retryMs);timer.unref?.();}}
 }
 function mount(app){app.post('/statistics/results',(req,res)=>{try{res.status(202).json(accept(req.body));}catch(e){onError(e.message);res.status(e.message==='AUDIT_STATISTICS_REPORT_INVALID'?400:e.message==='AUDIT_STATISTICS_ID_CONFLICT'?409:503).json({accepted:false,code:e.message});}});}
 queueMicrotask(flush);
 return{accept,flush,mount,close(){closed=true;clearTimeout(timer);},root};
}
module.exports={createStatisticsDelivery,digest,ENDPOINT,validReceiptPath};
