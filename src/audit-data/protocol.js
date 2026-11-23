'use strict';
const crypto = require('node:crypto');
const SCHEMA='apollo.v3-audit-data.v1',ASSET_SCHEMA='apollo.audit-asset.v1';
const MANIFEST='data/v3-audit/manifest.json',HASH=/^[a-f0-9]{64}$/;
const COMPACT_INDEX='JSONS/apollo/indexes/athena-audit.json';
const PACKAGED_COMPACT_INDEX='data/design-system_ab/'+COMPACT_INDEX;
const MAX_COMPACT_INDEX_BYTES=32*1024*1024;
function fail(code){throw Object.assign(Error(code),{code});}
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function validateCompactIndex(bytes){
 if(!bytes.length||bytes.length>MAX_COMPACT_INDEX_BYTES)fail('AUDIT_ATHENA_INDEX_INVALID');
 let document;
 try{document=JSON.parse(bytes);}catch{fail('AUDIT_ATHENA_INDEX_INVALID');}
 if(document?.schema!=='apollo.embedded-audit.v1'||typeof document.dataId!=='string'||!HASH.test(document.dataId)||
  document.payload?.manifest?.schema!=='apollo.offline-audit-index.v1'||document.payload.manifest.version!==1||
  sha(JSON.stringify(document.payload))!==document.dataId)fail('AUDIT_ATHENA_INDEX_INVALID');
 return document.dataId;
}
function canonical(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 fail('AUDIT_DATA_INVALID');
}
function lookupUrl(value){
 if(typeof value!=='string'||value.length>4096)fail('AUDIT_DATA_URL_UNDECLARED');
 const url=value.split(/[?#]/,1)[0];
 if(!/^https:\/\/(?:ackedze\.github\.io\/(?:design-system_ab|desing-system_abm)\/|raw\.githubusercontent\.com\/Ackedze\/(?:design-system_ab|desing-system_abm)\/main\/)/.test(url))fail('AUDIT_DATA_URL_UNDECLARED');
 return url.replace(/^https:\/\/raw\.githubusercontent\.com\/Ackedze\/(design-system_ab|desing-system_abm)\/main\//,'https://ackedze.github.io/$1/');
}
module.exports={SCHEMA,ASSET_SCHEMA,MANIFEST,HASH,COMPACT_INDEX,PACKAGED_COMPACT_INDEX,MAX_COMPACT_INDEX_BYTES,validateCompactIndex,fail,sha,canonical,lookupUrl};
