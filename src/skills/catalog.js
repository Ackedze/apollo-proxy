'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ID='figma-layer-name-hygiene';
const FILES=['SKILL.md','profile.json','run/SKILL.md','run/profile.json'];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Object.assign(Error('SKILL_CATALOG_INVALID'),{code:'SKILL_CATALOG_INVALID'});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
const pin=v=>exact(v,['path','sha256','bytes'])&&/^[a-f0-9]{64}$/.test(v.sha256||'')&&Number.isSafeInteger(v.bytes)&&v.bytes>=0&&v.bytes<=65536;
function parse(bytes){try{return JSON.parse(bytes.toString());}catch{fail();}}
function catalogEntry(bytes){
  const value=parse(bytes);
  if(!exact(value,['schemaVersion','skills'])||value.schemaVersion!=='apollo.skill-catalog.v1'||!Array.isArray(value.skills)||value.skills.length!==1)fail();
  const entry=value.skills[0];
  if(!exact(entry,['id','path','sha256','bytes'])||entry.id!==ID||entry.path!==ID+'/manifest.json'||!pin({path:entry.path,sha256:entry.sha256,bytes:entry.bytes}))fail();
  return entry;
}
function packageFiles(bytes){
  const value=parse(bytes);
  if(!exact(value,['schemaVersion','id','version','name','description','executorId','files'])||value.schemaVersion!=='apollo.skill-package.v1'||value.id!==ID||value.executorId!=='apollo.layer-names'
    ||!/^\d+\.\d+\.\d+$/.test(value.version||'')||typeof value.name!=='string'||!value.name.length||value.name.length>120||typeof value.description!=='string'||value.description.length>1000
    ||!Array.isArray(value.files)||value.files.length!==FILES.length||new Set(value.files.map(p=>p?.path)).size!==FILES.length||value.files.some(p=>!pin(p)||!FILES.includes(p.path)))fail();
  return value.files;
}
function read(root,file){
  const target=path.join(root,file);
  try{const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(target)!==target||stat.size>65536)fail();return fs.readFileSync(target);}catch{fail();}
}
function readCatalog(root){
  root=path.resolve(root);const pins=[];
  function admitted(file,expected){const bytes=read(root,file);if(expected&&(bytes.length!==expected.bytes||sha(bytes)!==expected.sha256))fail();pins.push({file,sha256:sha(bytes)});return bytes;}
  const body=admitted('manifest.json'),entry=catalogEntry(body),files=packageFiles(admitted(entry.path,entry));
  for(const pin of files)admitted(ID+'/'+pin.path,pin);
  return {sha256:sha(body),assertCurrent(){for(const pin of pins)if(sha(read(root,pin.file))!==pin.sha256)fail();}};
}
module.exports={ID,FILES,sha,catalogEntry,packageFiles,readCatalog};
