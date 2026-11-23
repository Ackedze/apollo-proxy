'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),zlib=require('node:zlib');
const knowledge=require('../knowledge-package'),p=require('./protocol');
const stamp=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
function createAuditDataReader({knowledgeRoot}){
 const root=path.resolve(knowledgeRoot);let canonicalRoot,cache=null,opening=null;
 let compact=null;
 async function safeFile(relative,expected){
  if(!knowledge.isSafeRelativePath(relative))p.fail('AUDIT_DATA_PATH_INVALID');
  canonicalRoot=canonicalRoot||await fs.realpath(root);
  const file=path.join(root,relative),stat=await fs.lstat(file,{bigint:true});
  if(!stat.isFile()||await fs.realpath(file)!==path.join(canonicalRoot,relative))p.fail('AUDIT_DATA_PATH_INVALID');
  if(expected&&stat.size!==BigInt(expected.bytes))p.fail('AUDIT_DATA_ASSET_MISMATCH');
  return {file,stat,stamp:stamp(stat)};
 }
 async function readPinned(relative,expected){
  const before=await safeFile(relative,expected),bytes=await fs.readFile(before.file),after=await safeFile(relative,expected);
  if(before.stamp!==after.stamp||expected&&(bytes.length!==expected.bytes||p.sha(bytes)!==expected.sha256))p.fail('AUDIT_DATA_SOURCE_CHANGED');
  return {bytes,stamp:after.stamp};
 }
 async function assertCurrent(snapshot){
  if((await safeFile('manifest.json')).stamp!==snapshot.packageStamp||(await safeFile(p.MANIFEST)).stamp!==snapshot.auditStamp)p.fail('AUDIT_DATA_SOURCE_CHANGED');
 }
 async function open(){
  if(cache){try{await assertCurrent(cache);return cache;}catch(error){if(error.code!=='AUDIT_DATA_SOURCE_CHANGED')throw error;cache=null;}}
  if(opening)return opening;
  opening=(async()=>{
   const outer=await readPinned('manifest.json'),manifest=knowledge.validateManifest(JSON.parse(outer.bytes));
   const declared=new Map(manifest.artifacts.map(row=>[row.path,row]));
   const auditPin=declared.get(p.MANIFEST);if(!auditPin)p.fail('AUDIT_DATA_PACKAGE_MISSING');
   const audit=await readPinned(p.MANIFEST,{bytes:auditPin.size,sha256:auditPin.sha256}),document=JSON.parse(audit.bytes),body=Object.assign({},document);delete body.dataId;
   if(document.schemaVersion!==p.SCHEMA||!p.HASH.test(document.dataId||'')||p.sha(p.canonical(body))!==document.dataId||!Array.isArray(document.files)||!document.files.length)p.fail('AUDIT_DATA_INVALID');
   const byId=new Map(),byUrl=new Map();
   for(const row of document.files){
    if(!row||!p.HASH.test(row.id||'')||!p.HASH.test(row.sha256||'')||!Number.isSafeInteger(row.bytes)||row.bytes<0||byId.has(row.id)||!Array.isArray(row.urls)||!row.urls.length)p.fail('AUDIT_DATA_INVALID');
    const location='data/v3-audit/assets/'+row.id+'.json',stored=declared.get(location);
    if(row.storage?.path!==location||row.storage.encoding!=='gzip-base64'||!stored||row.storage.sha256!==stored.sha256||row.storage.bytes!==stored.size)p.fail('AUDIT_DATA_CLOSURE_INCOMPLETE');
    byId.set(row.id,row);
    for(const url of row.urls){const key=p.lookupUrl(url),previous=byUrl.get(key);if(previous&&previous!==row.id)p.fail('AUDIT_DATA_URL_AMBIGUOUS');byUrl.set(key,row.id);}
   }
   if(!byId.has(document.policyFileId)||!byUrl.has(p.lookupUrl(document.entryUrl)))p.fail('AUDIT_DATA_CLOSURE_INCOMPLETE');
   const snapshot={document,byId,packageStamp:outer.stamp,auditStamp:audit.stamp};await assertCurrent(snapshot);cache=snapshot;return snapshot;
  })().finally(()=>{opening=null;});return opening;
 }
 return {
  async compactIndex(){
   try{
    const outer=await readPinned('manifest.json');
    if(compact?.packageStamp===outer.stamp&&(await safeFile(p.PACKAGED_COMPACT_INDEX)).stamp===compact.fileStamp){
     if((await safeFile('manifest.json')).stamp!==outer.stamp)p.fail('AUDIT_DATA_SOURCE_CHANGED');
     return compact.bytes;
    }
    const manifest=knowledge.validateManifest(JSON.parse(outer.bytes));
    const pin=manifest.artifacts.find(row=>row.path===p.PACKAGED_COMPACT_INDEX);
    if(!pin)p.fail('AUDIT_ATHENA_INDEX_MISSING');
    if(pin.size>p.MAX_COMPACT_INDEX_BYTES)p.fail('AUDIT_ATHENA_INDEX_INVALID');
    const stored=await readPinned(pin.path,{bytes:pin.size,sha256:pin.sha256});
    p.validateCompactIndex(stored.bytes);
    if((await safeFile('manifest.json')).stamp!==outer.stamp)p.fail('AUDIT_DATA_SOURCE_CHANGED');
    compact={packageStamp:outer.stamp,fileStamp:stored.stamp,bytes:stored.bytes};
    return stored.bytes;
   }catch(error){if(error.code==='ENOENT')p.fail('AUDIT_ATHENA_INDEX_MISSING');throw error;}
  },
  async manifest(){try{const snapshot=await open();return JSON.parse(JSON.stringify(snapshot.document));}catch(error){if(error.code==='ENOENT')p.fail('AUDIT_DATA_PACKAGE_MISSING');throw error;}},
  async asset(dataId,fileId){
   if(!p.HASH.test(dataId||'')||!p.HASH.test(fileId||''))p.fail('AUDIT_DATA_REQUEST_INVALID');
   const snapshot=await open();if(snapshot.document.dataId!==dataId)p.fail('AUDIT_DATA_CHANGED_RELOAD_REQUIRED');
   const row=snapshot.byId.get(fileId);if(!row)p.fail('AUDIT_DATA_ASSET_UNDECLARED');
   const stored=await readPinned(row.storage.path,{bytes:row.storage.bytes,sha256:row.storage.sha256}),envelope=JSON.parse(stored.bytes);
   if(envelope.schemaVersion!==p.ASSET_SCHEMA||envelope.encoding!=='gzip-base64'||envelope.bytes!==row.bytes||envelope.sha256!==row.sha256||typeof envelope.data!=='string'||!envelope.data.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.data))p.fail('AUDIT_DATA_ASSET_MISMATCH');
   const compressed=Buffer.from(envelope.data,'base64');if(compressed.toString('base64')!==envelope.data)p.fail('AUDIT_DATA_ASSET_MISMATCH');
   let bytes;try{bytes=zlib.gunzipSync(compressed,{maxOutputLength:Math.max(1,row.bytes)});}catch(_){p.fail('AUDIT_DATA_ASSET_MISMATCH');}
   if(bytes.length!==row.bytes||p.sha(bytes)!==row.sha256)p.fail('AUDIT_DATA_ASSET_MISMATCH');
   const text=bytes.toString('utf8');if(!Buffer.from(text,'utf8').equals(bytes))p.fail('AUDIT_DATA_ASSET_MISMATCH');
   await assertCurrent(snapshot);return {dataId,fileId,sha256:row.sha256,text};
  },
 };
}
module.exports={createAuditDataReader};
