'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ID='figma-layer-name-hygiene';
const FILES=['SKILL.md','profile.json','run/SKILL.md','run/profile.json'];
const LANDING_ID='ab-generate-custom-landing';
const LANDING_FILES=['SKILL.md','references/figma-workflow.md','references/run-contract.md','references/proxy.md'];
const GENERATION_EXECUTOR='apollo.figma-mcp';
const GENERATION_CAPABILITY='figma-mcp-skills-v1';
const STAGED_WORKFLOW='staged-content-v1';
const SLOT_CONTENT_REPLACEMENT='slot-content-replacement-v1';
const skillId=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
const instructionPath=value=>typeof value==='string'&&(value==='SKILL.md'||/^references\/[A-Za-z0-9_.\/-]+\.(md|json)$/.test(value))&&!value.split('/').some(part=>!part||part==='.'||part==='..');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Object.assign(Error('SKILL_CATALOG_INVALID'),{code:'SKILL_CATALOG_INVALID'});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
const pin=v=>exact(v,['path','sha256','bytes'])&&/^[a-f0-9]{64}$/.test(v.sha256||'')&&Number.isSafeInteger(v.bytes)&&v.bytes>=0&&v.bytes<=65536;
function parse(bytes){try{return JSON.parse(bytes.toString());}catch{fail();}}
function catalogEntries(bytes){
  const value=parse(bytes);
  if(!exact(value,['schemaVersion','skills'])||value.schemaVersion!=='apollo.skill-catalog.v1'||!Array.isArray(value.skills)||!value.skills.length||new Set(value.skills.map(e=>e?.id)).size!==value.skills.length||!value.skills.some(e=>e?.id===ID))fail();
  for(const entry of value.skills)if(!exact(entry,['id','path','sha256','bytes'])||!skillId(entry.id)||entry.path!==entry.id+'/manifest.json'||!pin({path:entry.path,sha256:entry.sha256,bytes:entry.bytes}))fail();
  return value.skills;
}
function catalogEntry(bytes){return catalogEntries(bytes).find(e=>e.id===ID);}
function packageFiles(bytes,expectedId=ID){
  const value=parse(bytes);
  if(value.schemaVersion==='apollo.skill-package.v2'){
    const profile=value.generation;
    if(!exact(value,['schemaVersion','id','version','name','description','executorId','files','generation'])||!skillId(expectedId)||expectedId===ID||value.id!==expectedId||value.executorId!==GENERATION_EXECUTOR||!/^\d+\.\d+\.\d+$/.test(value.version||'')||typeof value.name!=='string'||!value.name.length||value.name.length>120||typeof value.description!=='string'||value.description.length>1000
      ||!Array.isArray(value.files)||!value.files.length||!value.files.some(p=>p.path==='SKILL.md')||new Set(value.files.map(p=>p?.path)).size!==value.files.length||value.files.some(p=>!pin(p)||!instructionPath(p.path))
      ||!exact(profile,['platforms','requiredResources','initialQueries','initialFiles','hostInstructions'].concat(Object.hasOwn(profile||{},'workflow')?['workflow']:[]).concat(Object.hasOwn(profile||{},'recipeOperations')?['recipeOperations']:[]))||Object.hasOwn(profile||{},'workflow')&&profile.workflow!==STAGED_WORKFLOW||Object.hasOwn(profile||{},'recipeOperations')&&(profile.recipeOperations!==SLOT_CONTENT_REPLACEMENT||profile.workflow!==STAGED_WORKFLOW)||!Array.isArray(profile.platforms)||profile.platforms.length!==1||profile.platforms[0]!=='desktop'
      ||!Array.isArray(profile.requiredResources)||!profile.requiredResources.length||new Set(profile.requiredResources).size!==profile.requiredResources.length||profile.requiredResources.some(id=>typeof id!=='string'||!/^knowledge\/data\/(ds-ai-hub|design-system_ab)\/.+\.(md|json|yaml|yml|txt)$/.test(id)||id.split('/').some(p=>!p||p==='.'||p==='..'))
      ||!Array.isArray(profile.initialQueries)||profile.initialQueries.some(q=>typeof q!=='string'||q.length>256)||!Array.isArray(profile.initialFiles)||!profile.initialFiles.includes('SKILL.md')||new Set(profile.initialFiles).size!==profile.initialFiles.length||profile.initialFiles.some(file=>!value.files.some(pin=>pin.path===file))||typeof profile.hostInstructions!=='string'||profile.hostInstructions.length>12000)fail();
    return value.files;
  }
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
function generationPackages(root,manifest){
 return manifest.files.filter(pin=>/^skills\/[a-z0-9][a-z0-9-]{0,79}\/manifest\.json$/.test(pin.file)).map(pin=>{
  const id=pin.file.split('/')[1],bytes=fs.readFileSync(path.join(root,pin.file)),descriptor=parse(bytes);
  if(bytes.length!==pin.bytes||sha(bytes)!==pin.sha256)fail();
  packageFiles(bytes,id);if(id!==LANDING_ID&&descriptor.executorId!==GENERATION_EXECUTOR)fail();
  return{id,descriptor,files:descriptor.files};
 });
}
module.exports={ID,FILES,LANDING_ID,LANDING_FILES,GENERATION_EXECUTOR,GENERATION_CAPABILITY,STAGED_WORKFLOW,SLOT_CONTENT_REPLACEMENT,skillId,instructionPath,sha,catalogEntry,catalogEntries,packageFiles,readCatalog,generationPackages};
