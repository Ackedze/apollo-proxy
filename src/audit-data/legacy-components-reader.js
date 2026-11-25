'use strict';
const fs=require('node:fs/promises');
const p=require('./protocol');
const {compileLegacyComponents}=require('./policies/liquid-glass');

function createLegacyComponentsReader({file,readIndex,readPolicy}){
 return async()=>{
  let bytes;
  if(file){
   try{
    const handle=await fs.open(file,'r');
    try{
     if((await handle.stat()).size>1024*1024)p.fail('AUDIT_LEGACY_COMPONENTS_CONFIG_INVALID');
     bytes=await handle.readFile();
    }finally{await handle.close();}
   }catch(error){if(error.code?.startsWith('AUDIT_'))throw error;p.fail('AUDIT_LEGACY_COMPONENTS_CONFIG_INVALID');}
  }else{
   if(!readPolicy)p.fail('AUDIT_LEGACY_COMPONENTS_NOT_CONFIGURED');
   bytes=await readPolicy();
  }
  let config;
  try{
   if(bytes.length>1024*1024)p.fail('AUDIT_LEGACY_COMPONENTS_CONFIG_INVALID');
   config=JSON.parse(bytes);
  }catch{p.fail('AUDIT_LEGACY_COMPONENTS_CONFIG_INVALID');}
  const result=compileLegacyComponents(await readIndex(),config);
  return Object.assign(result,{policySource:file?'local-override':'package',policySha256:p.sha(bytes)});
 };
}
module.exports={createLegacyComponentsReader};
