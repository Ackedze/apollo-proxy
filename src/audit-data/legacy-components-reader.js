'use strict';
const fs=require('node:fs/promises');
const p=require('./protocol');
const {compileLegacyComponents}=require('./policies/liquid-glass');

function createLegacyComponentsReader({file,readIndex,readPackage}){
 return async()=>{
  let policyBytes,indexBytes;
  if(file){
   try{
    const handle=await fs.open(file,'r');
    try{
     if((await handle.stat()).size>1024*1024)p.fail('AUDIT_LEGACY_COMPONENTS_CONFIG_INVALID');
     policyBytes=await handle.readFile();
    }finally{await handle.close();}
   }catch(error){if(error.code?.startsWith('AUDIT_'))throw error;p.fail('AUDIT_LEGACY_COMPONENTS_CONFIG_INVALID');}
  }else{
   if(!readPackage)p.fail('AUDIT_LEGACY_COMPONENTS_NOT_CONFIGURED');
   ({policy:policyBytes,index:indexBytes}=await readPackage());
  }
  let config;
  try{
   if(policyBytes.length>1024*1024)p.fail('AUDIT_LEGACY_COMPONENTS_CONFIG_INVALID');
   config=JSON.parse(policyBytes);
  }catch{p.fail('AUDIT_LEGACY_COMPONENTS_CONFIG_INVALID');}
  const result=compileLegacyComponents(file?await readIndex():indexBytes,config);
  return Object.assign(result,{policySource:file?'local-override':'package',policySha256:p.sha(policyBytes)});
 };
}
module.exports={createLegacyComponentsReader};
