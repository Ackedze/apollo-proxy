'use strict';
const path=require('node:path');
const {loadPackageSnapshot}=require('./inventory');
const {VERSION,HASH,exactKeys,canonical,digest,fail}=require('./protocol');
const {scalar}=require('./display-protocol');
const {createDisplayIndex}=require('./display');
const {createReadApi}=require('./router');
const {VERSION:DISPLAY_VERSION,PERMISSIONS}=require('./display-protocol');
const MAX_RESPONSE_BYTES=8*1024*1024;
const POST_PATHS=['/v1/style-token-catalog/catalogs','/v1/style-token-catalog/query','/v2/resources/display-names/resolve'];
function installStyleTokenCatalogParser(app){
  const parse=require('express').json({limit:65536,strict:false});
  app.use((req,res,next)=>req.method==='POST' && POST_PATHS.includes(req.path)?parse(req,res,next):next());
}
function createCatalogProvider({designSystemRoot,knowledgeRelease={}}){
  const packageRoot=path.resolve(designSystemRoot,'../..');
  let provider;
  return function getProvider(){
    if(path.resolve(designSystemRoot)!==path.join(packageRoot,'data','design-system_ab'))fail('PACKAGED_CATALOG_ROOT_REQUIRED',503);
    if(provider){provider.snapshot.assertFresh();return provider;}
    let snapshot;
    try{snapshot=loadPackageSnapshot(packageRoot,knowledgeRelease);}
    catch(e){if(e.status)throw e;fail('CATALOG_PACKAGE_UNAVAILABLE',503);}
    const display=createDisplayIndex(snapshot);
    async function catalogs(value,{signal}={}){
      if(signal?.aborted)fail('READ_CANCELLED',499);
      if(Buffer.byteLength(canonical(value))>65536)fail('QUERY_TOO_LARGE',413);
      exactKeys(value,['protocolVersion','snapshotId','contentVersion','sourceIds']);
      if(typeof value.protocolVersion!=='string')fail();
      if(value.protocolVersion!==VERSION)fail('PROTOCOL_VERSION_MISMATCH',409);
      if(typeof value.snapshotId!=='string' || !HASH.test(value.snapshotId))fail();
      if(!scalar(value.contentVersion,200))fail();
      if(!Array.isArray(value.sourceIds) || !value.sourceIds.length || value.sourceIds.length>32 || new Set(value.sourceIds).size!==value.sourceIds.length)fail();
      for(const id of value.sourceIds)if(!scalar(id,300))fail();
      if(value.snapshotId!==snapshot.snapshotId || value.contentVersion!==snapshot.contentVersion)fail('SNAPSHOT_VERSION_MISMATCH',409);
      const results=[];
      for(const id of value.sourceIds){
        if(signal?.aborted)fail('READ_CANCELLED',499);
        const source=snapshot.sources.get(id);
        if(!source)fail('SOURCE_NOT_IN_INVENTORY',404);
        if(source.availability!=='available')fail('SOURCE_NOT_PACKAGED',503);
        const catalog=snapshot.rawCatalogs.get(id);
        results.push({sourceId:id,kind:source.kind,sourceSha256:source.sha256,sourceCanonicalSha256:digest(catalog),
          provenance:source.provenance,loaderMeta:source.kind==='styles'?{fileName:source.deliveryFileName,
            library:catalog.meta.library||catalog.meta.fileName||source.deliveryFileName}:catalog.meta,catalog});
        await new Promise(resolve=>setImmediate(resolve));
      }
      if(signal?.aborted)fail('READ_CANCELLED',499);
      snapshot.assertFresh();
      const response={protocolVersion:VERSION,snapshotId:snapshot.snapshotId,readerCodeSha256:snapshot.readerCodeSha256,
        knowledge:snapshot.knowledge,catalogs:results,freshness:{state:'pinned-inputs-current',nativeFreshness:'unverified'},
        bindingPermission:false};
      const encoded=canonical(response);
      if(Buffer.byteLength(encoded)>MAX_RESPONSE_BYTES)fail('CATALOG_RESPONSE_TOO_LARGE',413);
      return JSON.parse(encoded);
    }
    provider={snapshot,display,catalogs};return provider;
  };
}
function mountStyleTokenCatalogRoutes(app,options){
  const provider=createCatalogProvider(options),api=createReadApi(provider);
  app.use(api.handler);
  app.use((e,req,res,next)=>{
    if(!POST_PATHS.includes(req.path)
      || !['entity.parse.failed','entity.too.large'].includes(e.type))return next(e);
    const code=e.type==='entity.too.large'?'QUERY_TOO_LARGE':'INVALID_JSON';
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.status(e.type==='entity.too.large'?413:400).json(req.path==='/v2/resources/display-names/resolve'
      ?{protocolVersion:DISPLAY_VERSION,state:'unavailable',resources:[],error:{code},permissions:PERMISSIONS}
      :{protocolVersion:VERSION,ok:false,error:code,bindingPermission:false});
  });
  return provider;
}
module.exports={createCatalogProvider,mountStyleTokenCatalogRoutes,installStyleTokenCatalogParser,MAX_RESPONSE_BYTES};
