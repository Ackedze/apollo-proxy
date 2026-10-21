'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const REQUEST=/^generation-frontend:[a-f0-9]{16}:[1-9][0-9]{0,15}$/,SHA=/^[a-f0-9]{64}$/;
const fail=(code,status=503)=>{throw Object.assign(new Error(code),{code,status});};
const closed=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
function mountFrontendRoutes(app,options,loadProvider){
 const jobs=new Map(),artifacts=new Map(),cancelled=new Map();let active=null;
 function error(res,e){const code=SHA.test(e.code||'')?'FRONTEND_EXECUTION_FAILED':/^[A-Z][A-Z0-9_]{1,79}$/.test(e.code||e.message||'')?e.code||e.message:'FRONTEND_EXECUTION_FAILED';if(!res.headersSent&&!res.destroyed)res.status(e.status||(code==='SOURCE_COMPILE'?422:503)).json({success:false,code});}
 async function cleanup(job){job.signal.abort();if(job.host)await job.host.rollback();if(job.receipt?.artifact)artifacts.delete(job.receipt.artifact.id);}
 app.post('/generation/frontend/execute',async(req,res)=>{
  let job;
  try{
   const b=req.body;
   if(!closed(b,['requestId','spec','planHash','pins'])||!REQUEST.test(b.requestId)||!SHA.test(b.planHash)||Buffer.byteLength(JSON.stringify(b))>1024*1024)fail('FRONTEND_REQUEST_INVALID',400);
   if(cancelled.has(b.requestId))fail('GENERATION_SESSION_STALE',409);if(jobs.size>=32)fail('GENERATION_PROXY_BUSY',409);
   if(active)fail('GENERATION_PROXY_BUSY',409);if(jobs.has(b.requestId))fail('FRONTEND_REQUEST_REPLAY',409);
   job={id:b.requestId,planHash:b.planHash,signal:new AbortController(),host:null,receipt:null};jobs.set(job.id,job);active=job;
   const timeout=setTimeout(()=>job.signal.abort(),65000);timeout.unref();
   const close=()=>{if(!res.writableEnded)job.signal.abort();};res.on('close',close);
   try{
    const provider=options.provider||loadProvider(options);
    if(provider.validate(b.spec).length)fail('SCREEN_SCHEMA',400);
    const context=await provider.readContext(b.spec),plan=provider.planning.createCompositionPlan(b.spec,context,provider.hash);
    if(provider.hash(plan)!==b.planHash||provider.hash(plan.pins)!==provider.hash(b.pins))fail('STALE_PLAN',409);
    provider.planning.requirePreflight(plan,context,provider.hash,'frontend');
    const host=options.frontendHostFactory?options.frontendHostFactory({provider,signal:job.signal.signal}):provider.createFrontendHost({apolloRoot:provider.apolloRoot,repo:provider.repo,readContext:provider.readContext,hash:provider.hash,signal:job.signal.signal,
      // Deliberately absent until General/owners accept an exact profile/bank.
      readAcceptedProfile:options.readAcceptedFrontendProfile||(()=>null),commandRoot:options.commandRoot||path.join(provider.apolloRoot,'frontend-commands')});
    job.host=host;
    const receipt=await provider.adapter.executeFrontend(plan,provider.hash,host);
    if(job.signal.signal.aborted){await cleanup(job);fail('GENERATION_SESSION_STALE',409);}
    if(receipt.artifact){try{provider.planning.requirePreflight(plan,await provider.readContext(plan.spec),provider.hash,'frontend');await host.assertFresh(plan);}catch(e){await cleanup(job);throw e;}}
    job.receipt=receipt;
    if(receipt.artifact)artifacts.set(receipt.artifact.id,{job,root:host.artifactRoot(),manifest:receipt.artifact});
    res.json({success:true,schemaVersion:'apollo.v4-frontend-execution.v1-experimental',requestId:job.id,planHash:b.planHash,receiptHash:provider.hash(receipt),receipt});
   }finally{clearTimeout(timeout);res.off('close',close);active=null;const expire=setTimeout(()=>{cleanup(job).catch(()=>{});jobs.delete(job.id);},15*60*1000);expire.unref();}
  }catch(e){if(job)await cleanup(job).catch(()=>{});error(res,e);}
 });
 app.post('/generation/frontend/cancel',async(req,res)=>{
  try{const b=req.body;if(!closed(b,['requestId','planHash'])||!REQUEST.test(b.requestId)||!SHA.test(b.planHash))fail('FRONTEND_REQUEST_INVALID',400);
   if(!cancelled.has(b.requestId)){if(cancelled.size>=32)cancelled.delete(cancelled.keys().next().value);cancelled.set(b.requestId,b.planHash);const expire=setTimeout(()=>cancelled.delete(b.requestId),15*60*1000);expire.unref();}
   const job=jobs.get(b.requestId);if(job&&job.planHash!==b.planHash)fail('STALE_PLAN',409);if(job)await cleanup(job);res.json({success:true});
  }catch(e){error(res,e);}
 });
 app.get('/generation/frontend/artifacts/:id/*',(req,res)=>{
  try{const entry=artifacts.get(req.params.id),rel=req.params[0];if(!entry||!entry.root)fail('FRONTEND_ARTIFACT_UNAVAILABLE',404);
   const file=entry.manifest.files.find(f=>f.path===rel);if(!file)fail('FRONTEND_ARTIFACT_UNAVAILABLE',404);
   const absolute=path.resolve(entry.root,rel),real=fs.realpathSync(absolute);if(!real.startsWith(fs.realpathSync(entry.root)+path.sep))fail('FRONTEND_ARTIFACT_UNAVAILABLE',404);
   const bytes=fs.readFileSync(real);if(bytes.length!==file.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==file.sha256)fail('FRONTEND_ARTIFACT_STALE',409);
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.type(path.extname(rel)).send(bytes);
  }catch(e){error(res,e);}
 });
 return {async dispose(){for(const job of jobs.values())await cleanup(job);jobs.clear();artifacts.clear();cancelled.clear();}};
}
module.exports={mountFrontendRoutes};
