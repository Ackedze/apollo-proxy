'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const fail=()=>{throw Object.assign(Error('AUDIT_PERSIST_FAILED'),{code:'AUDIT_PERSIST_FAILED',status:503});};
function createAuditRequestStore(root){
 if(!path.isAbsolute(root))fail();fs.mkdirSync(root,{recursive:true});const receipts=path.join(root,'requests');fs.mkdirSync(receipts,{recursive:true,mode:0o700});
 function current(){for(const directory of [root,receipts])if(fs.realpathSync(directory)!==directory||!fs.lstatSync(directory).isDirectory())fail();}
 function read(file,limit,optional=false){current();let stat;try{stat=fs.lstatSync(file);}catch(e){if(optional&&e.code==='ENOENT')return null;fail();}if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(file)!==file||stat.size>limit)fail();try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{fail();}}
 function write(file,value,exclusive=false){current();const temp=file+'.'+crypto.randomUUID()+'.tmp';let fd;try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;if(exclusive){fs.linkSync(temp,file);fs.unlinkSync(temp);}else fs.renameSync(temp,file);}catch(e){if(e.code==='EEXIST')throw Object.assign(Error('AUDIT_REQUEST_REPLAY'),{code:'AUDIT_REQUEST_REPLAY',status:409});fail();}finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temp,{force:true});}}
 function valid(value,requestId){if(!value||value.schemaVersion!==1||value.requestId!==requestId||!['admitted','cancelled','historical'].includes(value.status)||value.runId!==null&&!uuid(value.runId)||value.fingerprint!==null&&!/^[a-f0-9]{64}$/.test(value.fingerprint)||value.status==='admitted'&&(!value.runId||!value.fingerprint))fail();return value;}
 const file=requestId=>path.join(receipts,hash(requestId)+'.json'),intent=requestId=>path.join(root,hash(requestId)+'.cancel.json');
 function readRequest(requestId){
  if(typeof requestId!=='string'||!requestId.length||requestId.length>120)fail();const cancelled=read(intent(requestId),2048,true),receipt=read(file(requestId),2048,true);
  if(cancelled){valid(cancelled,requestId);if(cancelled.status!=='cancelled')fail();if(receipt){valid(receipt,requestId);if(receipt.runId!==cancelled.runId||receipt.fingerprint!==cancelled.fingerprint)fail();}return cancelled;}
  if(receipt)return valid(receipt,requestId);
  // ponytail: new/missing IDs scan saved runs; add a durable index if large histories make admission slow.
  let recovered=null;for(const entry of fs.readdirSync(root)){if(!/^[a-f0-9-]{36}\.json$/.test(entry))continue;const run=read(path.join(root,entry),64*1024*1024);if(!run||!uuid(run.runId)||entry!==run.runId+'.json'||typeof run.requestId!=='string')fail();if(run.requestId!==requestId)continue;if(recovered&&recovered.runId!==run.runId)fail();recovered={schemaVersion:1,requestId,runId:run.runId,fingerprint:/^[a-f0-9]{64}$/.test(run.requestFingerprint||'')?run.requestFingerprint:null,status:'historical'};}
  if(recovered)write(file(requestId),recovered,true);return recovered;
 }
 function writeRequest(value){
  valid(value,value.requestId);const previous=readRequest(value.requestId);
  if(value.status==='admitted'&&previous)throw Object.assign(Error('AUDIT_REQUEST_REPLAY'),{code:'AUDIT_REQUEST_REPLAY',status:409});
  if(previous&&(previous.runId!==value.runId||previous.fingerprint!==value.fingerprint))fail();
  // A separate cancel intent survives a missing receipt, including before start.
  if(value.status==='cancelled')write(intent(value.requestId),value);write(file(value.requestId),value,!previous);
 }
 function guarded(fn){return(...args)=>{try{return fn(...args);}catch(e){if(['AUDIT_PERSIST_FAILED','AUDIT_REQUEST_REPLAY'].includes(e.code))throw e;fail();}};}
 return {readRequest:guarded(readRequest),writeRequest:guarded(writeRequest),readRun:guarded(function(receipt){valid(receipt,receipt.requestId);if(!receipt.runId)return null;const run=read(path.join(root,receipt.runId+'.json'),64*1024*1024,true);if(run&&(run.runId!==receipt.runId||run.requestId!==receipt.requestId))fail();return run;})};
}
module.exports={createAuditRequestStore};
