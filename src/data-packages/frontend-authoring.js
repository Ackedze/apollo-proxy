'use strict';
// Read-only mapping/source correspondence for data imports; no frontend executor.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const clone=v=>JSON.parse(JSON.stringify(v));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
function projectFrontendAuthoring(packet,mapping,{hash,read=fs.readFileSync}={}){
 if(mapping?.target!=='frontend'||!Array.isArray(mapping.bindings)||typeof hash!=='function')fail('AGENT_MAPPING_INPUT_UNAVAILABLE');
 const result=clone(packet),bindings=[],ids=new Set();
 function pinned(p){
  if(!p||typeof p.path!=='string'||!path.isAbsolute(p.path)||fs.realpathSync(p.path)!==p.path||!/^[a-f0-9]{64}$/.test(p.sha256)||!Number.isSafeInteger(p.bytes)||p.bytes<0||p.bytes>64*1024*1024)fail('AGENT_MAPPING_SOURCE_INVALID');
  const stat=fs.lstatSync(p.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==p.bytes)fail('AGENT_MAPPING_SOURCE_STALE');
  const bytes=read(p.path);if(bytes.length!==p.bytes||sha(bytes)!==p.sha256)fail('AGENT_MAPPING_SOURCE_STALE');return bytes;
 }
 function pointer(root,value){if(value===undefined)return root;if(typeof value!=='string'||!value.startsWith('/'))fail('AGENT_MAPPING_SOURCE_INVALID');return value.split('/').slice(1).reduce((v,key)=>v?.[key.replace(/~1/g,'/').replace(/~0/g,'~')],root);}
 for(const binding of mapping.bindings){
  if(!binding.mappingId)continue;
  if(ids.has(binding.mappingId))fail('AGENT_MAPPING_DUPLICATE');ids.add(binding.mappingId);
  if(binding.platform&&binding.platform!=='universal'&&binding.platform!==packet.platform||result.mappings.some(m=>m.id===binding.mappingId))continue;
  const source=Object.values(mapping.context?.contracts||{}).find(c=>c.archive?.sha256===binding.contract?.archive?.sha256&&c.revision===binding.contract?.revision);
  if(!source||typeof binding.import?.module!=='string'||!(/^(?:arui-private(?:\/[A-Za-z0-9_-]+)+|@alfalab\/core-components\/[a-z][a-z0-9-]*)$/.test(binding.import.module))||typeof binding.import.export!=='string'||!Array.isArray(binding.ports))fail('AGENT_MAPPING_SOURCE_INVALID');
  pinned(source.archive);const manual=pointer(JSON.parse(pinned(source.manual).toString('utf8')),source.manualPointer);
  if(manual?.component?.componentId!==binding.componentId||manual.metadata?.revision!==source.revision||hash(manual)!==binding.contract.manual?.semanticHash||!Array.isArray(manual.rules))fail('AGENT_MAPPING_SOURCE_STALE');
  if(!manual.representations?.some(r=>r.id===binding.sourceRepresentationId&&[packet.platform,'universal'].includes(r.platform)))fail('AGENT_MAPPING_PLATFORM_UNAVAILABLE');
  if(binding.import.module.startsWith('@alfalab/core-components/')){
   const representation=manual.representations?.find(r=>r.id===binding.representationId&&r.kind==='code'&&[packet.platform,'universal','web'].includes(r.platform));
   if(representation?.locator?.package!==binding.import.module||representation.locator.export!==binding.import.export)fail('AGENT_MAPPING_SOURCE_INVALID');
   const leaf='@alfalab/core-components-'+binding.import.module.split('/')[2],dependencies=mapping.context?.dependencies;
   const packages=['@alfalab/core-components',leaf].map(name=>{const entry=dependencies?.[name];if(!entry||typeof entry.version!=='string')fail('AGENT_MAPPING_SOURCE_INVALID');const pkg=JSON.parse(pinned(entry.package));if(pkg.name!==name||pkg.version!==entry.version)fail('AGENT_MAPPING_SOURCE_STALE');return pkg;});
   if(packages[0].dependencies?.[leaf]!==packages[1].version)fail('AGENT_MAPPING_SOURCE_STALE');
   pinned(binding.sourceIndex);pinned(binding.sourceImplementation);
   if(!Array.isArray(binding.distributionInputs)||!binding.distributionInputs.length)fail('AGENT_MAPPING_SOURCE_INVALID');
   for(const input of binding.distributionInputs)pinned(input);
  }
  const prior=result.contracts.find(c=>c.pin.componentId===binding.componentId);
  if(prior&&prior.pin.manualSourceHash!==hash(manual))fail('AGENT_MAPPING_SOURCE_CONFLICT');
  if(!prior)result.contracts.push({pin:{componentId:binding.componentId,revision:source.revision,manualSourceHash:hash(manual),archiveSha256:source.archive.sha256,compiledHash:binding.contract.compiledHash||null,sourceStatus:'draft'},manual});
  for(const port of binding.ports)if(!manual.semanticApi?.some(p=>p.id===port.logical))fail('AGENT_MAPPING_PORT_INVALID');
  result.mappings.push({id:binding.mappingId,componentId:binding.componentId,kind:'component',platform:binding.platform,codeRepresentationId:binding.representationId,propertyMappings:binding.ports.map(p=>({from:p.logical,to:p.codePath,transform:typeof p.transform==='string'?p.transform:p.transform?.id})),codeApi:binding.ports,status:{fullContractParity:'not-confirmed'}});bindings.push(clone(binding));
 }
 result.frontendMappingRecords={bindings};return result;
}
module.exports={projectFrontendAuthoring};
