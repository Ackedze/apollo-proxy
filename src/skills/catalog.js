'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ID='figma-layer-name-hygiene';
const FILES=['SKILL.md','profile.json','run/SKILL.md','run/profile.json'];
const LANDING_ID='ab-generate-custom-landing';
const LANDING_FILES=['SKILL.md','references/figma-workflow.md','references/run-contract.md','references/proxy.md'];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Object.assign(Error('SKILL_CATALOG_INVALID'),{code:'SKILL_CATALOG_INVALID'});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
const pin=v=>exact(v,['path','sha256','bytes'])&&/^[a-f0-9]{64}$/.test(v.sha256||'')&&Number.isSafeInteger(v.bytes)&&v.bytes>=0&&v.bytes<=65536;
function parse(bytes){try{return JSON.parse(bytes.toString());}catch{fail();}}
function catalogEntries(bytes){
  const value=parse(bytes);
  if(!exact(value,['schemaVersion','skills'])||value.schemaVersion!=='apollo.skill-catalog.v1'||!Array.isArray(value.skills)||!value.skills.length||value.skills.length>2||new Set(value.skills.map(e=>e?.id)).size!==value.skills.length||!value.skills.some(e=>e?.id===ID))fail();
  for(const entry of value.skills)if(!exact(entry,['id','path','sha256','bytes'])||![ID,LANDING_ID].includes(entry.id)||entry.path!==entry.id+'/manifest.json'||!pin({path:entry.path,sha256:entry.sha256,bytes:entry.bytes}))fail();
  return value.skills;
}
function catalogEntry(bytes){return catalogEntries(bytes).find(e=>e.id===ID);}
function packageFiles(bytes,expectedId=ID){
  const value=parse(bytes);
  const files=expectedId===ID?FILES:expectedId===LANDING_ID?LANDING_FILES:null;
  if(!files||!exact(value,['schemaVersion','id','version','name','description','executorId','files'])||value.schemaVersion!=='apollo.skill-package.v1'||value.id!==expectedId||value.executorId!==(expectedId===ID?'apollo.layer-names':'apollo.landing')
    ||!/^\d+\.\d+\.\d+$/.test(value.version||'')||typeof value.name!=='string'||!value.name.length||value.name.length>120||typeof value.description!=='string'||value.description.length>1000
    ||!Array.isArray(value.files)||value.files.length!==files.length||new Set(value.files.map(p=>p?.path)).size!==files.length||value.files.some(p=>!pin(p)||!files.includes(p.path)))fail();
  return value.files;
}
function read(root,file){
  const target=path.join(root,file);
  try{const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(target)!==target||stat.size>65536)fail();return fs.readFileSync(target);}catch{fail();}
}
function readCatalog(root){
  root=path.resolve(root);const pins=[];
  function admitted(file,expected){const bytes=read(root,file);if(expected&&(bytes.length!==expected.bytes||sha(bytes)!==expected.sha256))fail();pins.push({file,sha256:sha(bytes)});return bytes;}
  const body=admitted('manifest.json'),entries=catalogEntries(body).map(entry=>{
    const bytes=admitted(entry.path,entry),files=packageFiles(bytes,entry.id);
    for(const pin of files)admitted(entry.id+'/'+pin.path,pin);
    return {id:entry.id,descriptor:parse(bytes),files};
  });
  return {sha256:sha(body),entries,assertCurrent(){for(const pin of pins)if(sha(read(root,pin.file))!==pin.sha256)fail();}};
}
module.exports={ID,FILES,LANDING_ID,LANDING_FILES,sha,catalogEntry,catalogEntries,packageFiles,readCatalog};
