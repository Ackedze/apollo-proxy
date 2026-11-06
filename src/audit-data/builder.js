'use strict';
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process');
const {createRequire}=require('node:module');
const p=require('./protocol');
const POLICY_URL='https://ackedze.github.io/design-system_ab/JSONS/apollo/v3-audit-policies.json';
const PREPARATION_FILE='dist/v3-audit-preparation.cjs';
function preparationFromRuntime(runtimeRoot){
 // This is installed code verified by the existing runtime manifest, never a
 // JavaScript path or executable supplied by a data package.
 const runtime=require('../data-release').readRuntime(runtimeRoot);
 const pin=runtime.files.find(row=>row.file===PREPARATION_FILE);
 if(!pin||runtime.capabilities?.auditDataPreparation!==p.SCHEMA)p.fail('AUDIT_PREPARATION_CODE_REQUIRED');
 const file=path.resolve(runtimeRoot,PREPARATION_FILE),bytes=sync.readFileSync(file);
 if(bytes.length!==pin.bytes||p.sha(bytes)!==pin.sha256)p.fail('AUDIT_PREPARATION_CODE_CHANGED');
 const module={exports:{}};
 new Function('require','module','exports',bytes.toString('utf8'))(createRequire(file),module,module.exports);
 return module.exports;
}
async function buildAuditData({designRoot,abmRoot,packageRoot,preparation,sourceCommits={}}){
 if(!preparation||preparation.VERSION!=='apollo.v3-audit-preparation.v1'||typeof preparation.describeSources!=='function'||typeof preparation.preparePolicies!=='function')p.fail('AUDIT_PREPARATION_CODE_REQUIRED');
 const roots={'design-system_ab':await fs.realpath(designRoot),'desing-system_abm':await fs.realpath(abmRoot)};
 const output=path.join(packageRoot,'data/v3-audit');
 await fs.mkdir(path.join(packageRoot,'data'),{recursive:true});
 await fs.mkdir(output,{recursive:false}); await fs.mkdir(path.join(output,'assets'));
 const records=new Map(),physical=new Map();
 function locate(url){
  const canonical=p.lookupUrl(url),parsed=new URL(canonical),match=/^\/(design-system_ab|desing-system_abm)\/(.+)$/.exec(parsed.pathname);
  if(!match)p.fail('AUDIT_DATA_URL_UNDECLARED');
  const repo=match[1],relative=decodeURIComponent(match[2]);
  if(relative.includes('\\')||relative.split('/').some(part=>!part||part==='.'||part==='..')||path.isAbsolute(relative))p.fail('AUDIT_DATA_SOURCE_PATH_INVALID');
  return {repo,relative,file:path.join(roots[repo],relative),url:canonical};
 }
 async function bytesAt(source){
  const stat=await fs.lstat(source.file);
  if(!stat.isFile()||await fs.realpath(source.file)!==source.file)p.fail('AUDIT_DATA_SOURCE_PATH_INVALID');
  return fs.readFile(source.file);
 }
 async function read(url,role,channels=[]){
  const source=locate(url),bytes=await bytesAt(source),sha256=p.sha(bytes),id=p.sha(source.repo+'\0'+source.relative);
  let row=records.get(id);
  if(row&&(row.sha256!==sha256||row.bytes!==bytes.length))p.fail('AUDIT_DATA_SOURCE_CHANGED');
  if(!row){row={id,sha256,bytes:bytes.length,urls:[],roles:[],channels:[],source:{repo:source.repo,path:source.relative}};records.set(id,row);physical.set(id,source);}
  row.urls=Array.from(new Set(row.urls.concat(source.url))).sort();
  if(role)row.roles=Array.from(new Set(row.roles.concat(role))).sort();
  row.channels=Array.from(new Set(row.channels.concat(channels))).sort();
  return bytes;
 }
 const readJson=async url=>JSON.parse((await read(url)).toString('utf8'));
 try{
  const plan=await preparation.describeSources(readJson);
  for(const source of plan.sources)for(const role of source.roles)await read(source.url,role,source.channels);
  // Text audit continues to use the existing plain redpol/pattern projection;
  // these JSONs also belong to the captured complete audit source inventory.
  for(const entry of await fs.readdir(path.join(roots['design-system_ab'],'redpolrules'),{withFileTypes:true})){
   if(entry.isFile()&&entry.name.endsWith('.json'))await read('https://ackedze.github.io/design-system_ab/redpolrules/'+encodeURIComponent(entry.name),'text-redpolicy');
  }
  const main=await readJson(plan.entryUrl),index=await readJson(plan.policyIndexUrl);
  const policy=await preparation.preparePolicies(index,readJson,main.baseUrl||'');
  const policyBytes=Buffer.from(JSON.stringify(policy)),policyId=p.sha(POLICY_URL);
  if([...records.values()].some(row=>row.urls.includes(POLICY_URL)))p.fail('AUDIT_DATA_SOURCE_COLLISION');
  records.set(policyId,{id:policyId,sha256:p.sha(policyBytes),bytes:policyBytes.length,urls:[POLICY_URL],roles:['normalized-v3-policy'],channels:['Desktop','MobileWeb','iOS','Android']});
  for(const row of records.values()){
   const bytes=row.id===policyId?policyBytes:await bytesAt(physical.get(row.id));
   if(p.sha(bytes)!==row.sha256||bytes.length!==row.bytes)p.fail('AUDIT_DATA_SOURCE_CHANGED');
   const compressed=zlib.gzipSync(bytes,{level:6});
   const envelope=Buffer.from(JSON.stringify({schemaVersion:p.ASSET_SCHEMA,encoding:'gzip-base64',sha256:row.sha256,bytes:row.bytes,data:compressed.toString('base64')})+'\n');
   const storagePath='data/v3-audit/assets/'+row.id+'.json';
   await fs.writeFile(path.join(packageRoot,storagePath),envelope,{flag:'wx'});
   row.storage={path:storagePath,sha256:p.sha(envelope),bytes:envelope.length,encoding:'gzip-base64'};
  }
  for(const repo of Object.keys(roots)){
   if(!sourceCommits[repo])sourceCommits[repo]=execFileSync('git',['-C',roots[repo],'rev-list','-1','HEAD','--','JSONS','redpolrules'],{encoding:'utf8'}).trim();
   if(!/^[a-f0-9]{40}$/.test(sourceCommits[repo]))p.fail('AUDIT_DATA_SOURCE_COMMIT_INVALID');
  }
  const body={schemaVersion:p.SCHEMA,entryUrl:plan.entryUrl,policyFileId:policyId,preparationVersion:preparation.VERSION,sourceCommits:Object.assign({},sourceCommits),files:Array.from(records.values()).sort((a,b)=>a.id.localeCompare(b.id))};
  const manifest=Object.assign({},body,{dataId:p.sha(p.canonical(body))});
  await fs.writeFile(path.join(packageRoot,p.MANIFEST),JSON.stringify(manifest)+'\n',{flag:'wx'});
  const sourcePins=[];
  for(const [id,source] of physical){
   const row=records.get(id),bytes=await bytesAt(source);
   if(bytes.length!==row.bytes||p.sha(bytes)!==row.sha256)p.fail('AUDIT_DATA_SOURCE_CHANGED');
   sourcePins.push({path:source.file,repo:source.repo,relative:source.relative,bytes:row.bytes,sha256:row.sha256});
  }
  return {manifest,sourcePins};
 }catch(error){await fs.rm(output,{recursive:true,force:true});throw error;}
}
module.exports={buildAuditData,preparationFromRuntime,POLICY_URL,PREPARATION_FILE};
