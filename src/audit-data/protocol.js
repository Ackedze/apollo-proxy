'use strict';
const crypto = require('node:crypto');
const SCHEMA='apollo.v3-audit-data.v1',ASSET_SCHEMA='apollo.audit-asset.v1';
const MANIFEST='data/v3-audit/manifest.json',HASH=/^[a-f0-9]{64}$/;
function fail(code){throw Object.assign(Error(code),{code});}
function sha(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
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
module.exports={SCHEMA,ASSET_SCHEMA,MANIFEST,HASH,fail,sha,canonical,lookupUrl};
