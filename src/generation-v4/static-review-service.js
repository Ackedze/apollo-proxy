// Review-only route. Source/config and receipt trust come from local operator context.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const V1='apollo.v4-static-review-request.v1-draft',V2='apollo.v4-static-review-request.v2-draft',SHA=/^[a-f0-9]{64}$/,ID=/^static-review:[1-9][0-9]{0,15}$/;
const fail=(code,status=503)=>{throw Object.assign(new Error(code),{code,status});};
const closed=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function loadReviewProvider(options={}){
 const workspace=path.resolve(options.workspaceRoot||process.env.APOLLO_V4_WORKSPACE_ROOT||path.resolve(__dirname,'../../../..'));
 const apollo=path.resolve(options.apolloRoot||process.env.APOLLO_V4_PROJECT_ROOT||path.join(workspace,'projects/Apollo-v3'));
 const producer=path.resolve(options.codeRoot||process.env.APOLLO_V4_CODE_ROOT||path.join(workspace,'arui-private'));
 const configFile=path.resolve(options.reviewConfigPath||path.join(__dirname,'static-review-config.json')),bytes=fs.readFileSync(configFile),config=JSON.parse(bytes);
 if(bytes.length>8192||!closed(config,['schemaVersion','manifestPin','reportPin'])||config.schemaVersion!=='apollo.v4-static-review-local-config.v1-draft')fail('STATIC_REVIEW_CONFIG_INVALID');
 function local(p){if(!closed(p,['path','sha256'])||!SHA.test(p.sha256)||typeof p.path!=='string'||path.isAbsolute(p.path)||p.path.includes('\\')||p.path.split('/').some(s=>!s||s==='.'||s==='..'))fail('STATIC_REVIEW_CONFIG_INVALID');return {path:path.join(producer,p.path),sha256:p.sha256};}
 const receiptPin=options.staticReviewReceiptPin||(process.env.APOLLO_STATIC_REVIEW_RECEIPT_PATH||process.env.APOLLO_STATIC_REVIEW_RECEIPT_SHA256?{path:process.env.APOLLO_STATIC_REVIEW_RECEIPT_PATH,sha256:process.env.APOLLO_STATIC_REVIEW_RECEIPT_SHA256}:undefined);
 const artifactRoots=options.staticReviewArtifactRoots||(process.env.APOLLO_STATIC_REVIEW_ARTIFACT_ROOT?[process.env.APOLLO_STATIC_REVIEW_ARTIFACT_ROOT]:[]);
 const trusted={producerRoot:producer,workspaceRoot:workspace,manifestPin:local(config.manifestPin),reportPin:local(config.reportPin),configPath:configFile,receiptPin,artifactRoots};
 const moduleFiles=['apps/apollo-v4/scripts/static-producer-review-inputs.cjs','apps/apollo-v4/scripts/static-review-consumer-binding.cjs','apps/apollo-v4/dist/runtime.cjs','packages/generation-core/dist/index.cjs','packages/component-contract-core/dist/core.cjs'].map(file=>path.join(apollo,file));
 const initialPins=new Map();
 for(const p of moduleFiles){if(!fs.existsSync(p))fail('STATIC_REVIEW_PROVIDER_NOT_BUILT');initialPins.set(p,sha(fs.readFileSync(p)));delete require.cache[require.resolve(p)];}
 initialPins.set(__filename,sha(fs.readFileSync(__filename)));
 const gen=require(path.join(apollo,'packages/generation-core/dist/index.cjs')),runtime=require(path.join(apollo,'apps/apollo-v4/dist/runtime.cjs')),reader=require(path.join(apollo,'apps/apollo-v4/scripts/static-producer-review-inputs.cjs'));
 const buildFile=path.join(apollo,'apps/apollo-v4/dist/build-inputs.json'),buildHash=sha(fs.readFileSync(buildFile));
 return {buildHash,hash:runtime.contractHash,validate:gen.validateStaticReviewResult,validateV2:gen.validateStaticBindingResult,async read(input,id,version=V1){
  const result=await reader.reviewStaticInput(input,trusted,id,buildHash,version);
  if(sha(fs.readFileSync(buildFile))!==buildHash||sha(fs.readFileSync(configFile))!==sha(bytes))fail('REVIEW_BUILD_STALE');
  for(const [p,hash]of initialPins)if(sha(fs.readFileSync(p))!==hash)fail('REVIEW_PORT_CHANGED');
  return result;
 }};
}
function mountStaticReviewRoutes(app,options={}){
 let active=false;
 app.post('/v4/generation/static-review',async(req,res)=>{
  try{
   const body=req.body;
   if(!closed(body,['schemaVersion','requestId','input','buildHash'])||![V1,V2].includes(body.schemaVersion)||!ID.test(body.requestId)||!SHA.test(body.buildHash)||Buffer.byteLength(JSON.stringify(body),'utf8')>1024*1024)fail('STATIC_REVIEW_REQUEST_INVALID',400);
   if(active)fail('STATIC_REVIEW_BUSY',409);active=true;
   try{
    const provider=options.reviewProvider||loadReviewProvider(options);
    if(body.buildHash!==provider.buildHash)fail('REVIEW_BUILD_STALE',409);
    const input=JSON.parse(JSON.stringify(body.input)),result=await provider.read(input,body.requestId,body.schemaVersion),validate=body.schemaVersion===V2?provider.validateV2:provider.validate;
    if(typeof validate!=='function'||!validate(result,{requestId:body.requestId,input,buildHash:body.buildHash},provider.hash)||Buffer.byteLength(JSON.stringify(result),'utf8')>256*1024)fail('STATIC_REVIEW_RESPONSE_INVALID');
    res.setHeader('Cache-Control','no-store');res.json({success:true,schemaVersion:body.schemaVersion===V2?'apollo.v4-static-review-response.v2-draft':'apollo.v4-static-review-response.v1-draft',result});
   }finally{active=false;}
  }catch(error){const code=/^[A-Z][A-Z0-9_]{1,79}$/.test(error.code||'')?error.code:'STATIC_REVIEW_READ_UNAVAILABLE';if(!res.headersSent&&!res.destroyed)res.status(error.status||503).json({success:false,code});}
 });
}
module.exports={mountStaticReviewRoutes,loadReviewProvider};
