'use strict';
const p=require('../protocol');
const key=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const fail=code=>p.fail('AUDIT_LEGACY_COMPONENTS_'+code);

function compileLegacyComponents(bytes,config){
 p.validateCompactIndex(bytes);
 const index=JSON.parse(bytes),rows=index.payload.components?.rows;
 if(!rows||!Array.isArray(index.payload.sources?.sources))fail('INDEX_INVALID');
 if(config?.schemaVersion!==1||config.platform!=='iOS'||!Array.isArray(config.families)||
    !config.families.length||config.families.length>256)fail('CONFIG_INVALID');
 const sources=new Map(index.payload.sources.sources.map(source=>[source.id,source]));
 const families=new Map();
 for(const entry of config.families){
  if(!entry||!key(entry.key)||families.has(entry.key)||typeof entry.name!=='string'||!entry.name.trim()||
     typeof entry.fileKey!=='string'||!/^[a-zA-Z0-9]{6,128}$/.test(entry.fileKey)||
     typeof entry.allowLocalSupplement!=='boolean')fail('CONFIG_INVALID');
  const row=Object.hasOwn(rows,entry.key)?rows[entry.key]:null;
  if(row&&(row.type!=='component'||row.conflicts?.length||!row.platforms?.includes(config.platform)))fail('IDENTITY_CONFLICT');
  if(!row&&!entry.allowLocalSupplement)fail('CATALOG_ENTRY_MISSING');
  const catalogSources=row?(row.sources||[]).map(id=>sources.get(id)):[];
  if(row&&(!catalogSources.length||catalogSources.some(source=>!source||source.fileKey!==entry.fileKey)))fail('IDENTITY_CONFLICT');
  if(entry.variantCondition!==undefined){
   const condition=entry.variantCondition;
   if(!condition||typeof condition!=='object'||typeof condition.property!=='string'||!condition.property.trim()||condition.equals!=='False'||
      !condition.variantValues||Array.isArray(condition.variantValues)||typeof condition.variantValues!=='object'||
      (condition.missingPropertyValue!==undefined&&condition.missingPropertyValue!=='False')||
      (condition.valueSource!==undefined&&(condition.valueSource!=='instance-properties'||condition.missingPropertyValue!=='False')))fail('CONFIG_INVALID');
   for(const [variantKey,value] of Object.entries(condition.variantValues)){
    if(!key(variantKey)||!['False','True'].includes(value))fail('CONFIG_INVALID');
    const variant=rows[variantKey];
    if(variant&&(variant.type!=='variant'||variant.componentKey!==entry.key))fail('IDENTITY_CONFLICT');
   }
  }
  families.set(entry.key,{key:entry.key,name:row?.name||entry.name,sourceName:entry.name,fileKey:entry.fileKey,
   source:row?'catalog':'local-supplement',catalogStatus:row?.status||null,
   catalogSources:catalogSources.map(source=>({catalogPath:source.catalogPath,fileKey:source.fileKey})),variantKeys:[],
   variantCondition:entry.variantCondition||null});
 }
 for(const [variantKey,row] of Object.entries(rows)){
  if(row.type!=='variant'||!families.has(row.componentKey))continue;
  if(!key(variantKey)||families.has(variantKey)||row.platforms&&!row.platforms.includes(config.platform))fail('IDENTITY_CONFLICT');
  families.get(row.componentKey).variantKeys.push(variantKey);
 }
 for(const family of families.values()){
  const row=rows[family.key];
  // Standalone published components can be their own default variant.
  if(row?.defaultVariant===family.key)family.variantKeys.push(family.key);
  family.variantKeys.sort();
 }
 const result={schemaVersion:'apollo.legacy-components.v1',status:'draft',platform:config.platform,
  sourceIndexDataId:index.dataId,families:Array.from(families.values()),
  coverage:{localVariantKeysAvailable:false,localVariantMatching:'requires-component-set-key',
   detachedMatching:false,structuralMatching:false,nameFallback:false}};
 result.registryId=p.sha(JSON.stringify(result));
 return result;
}

module.exports={compileLegacyComponents};
