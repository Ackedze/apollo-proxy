'use strict';
const path=require('node:path');
const {createAuditDataReader}=require('./reader');
function mountAuditDataRoutes(app,{designSystemRoot,knowledgeRoot}){
 // Only a managed knowledge package can satisfy this reader. A checkout root
 // has no accepted knowledge manifest; there is no Git or local-source fallback.
 const reader=createAuditDataReader({knowledgeRoot:knowledgeRoot||path.resolve(designSystemRoot,'../..')});
 const route=(work,send=(res,value)=>res.json(value))=>async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{if(Object.keys(req.query||{}).length)throw Object.assign(Error('AUDIT_DATA_REQUEST_INVALID'),{code:'AUDIT_DATA_REQUEST_INVALID'});send(res,await work(req));}
  catch(error){const code=/^AUDIT_[A-Z_]+$/.test(error.code||'')?error.code:error.code==='ENOENT'?'AUDIT_DATA_PACKAGE_MISSING':'AUDIT_DATA_UNAVAILABLE';res.status(code==='AUDIT_DATA_REQUEST_INVALID'?400:code.includes('CHANGED')||code.includes('MISMATCH')?409:503).json({error:code});}
 };
 app.get('/v1/audit-data/manifest',route(()=>reader.manifest()));
 app.get('/v1/audit-data/compact-index',route(()=>reader.compactIndex(),(res,bytes)=>{res.set('Content-Type','application/json; charset=utf-8');res.send(bytes);}));
 app.get('/v1/audit-data/:dataId/assets/:fileId',route(req=>reader.asset(req.params.dataId,req.params.fileId)));
 return reader;
}
module.exports={mountAuditDataRoutes};
