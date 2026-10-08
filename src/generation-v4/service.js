// V4 ScreenSpec contract pipeline. Independent of legacy /v1/generation/plan.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const fail = (code, status=503) => { throw Object.assign(new Error(code),{code,status}); };
function workspaceRoot() {
  const checkout = path.resolve(__dirname,'../../../..');
  return process.env.APOLLO_V4_WORKSPACE_ROOT || (fs.existsSync(path.join(checkout,'projects/Apollo-v3')) ? checkout : path.join(os.homedir(),'Desktop/workplace'));
}
function loadProvider(options={}) {
  const workspace = path.resolve(options.workspaceRoot || workspaceRoot());
  const apollo = path.resolve(options.apolloRoot || process.env.APOLLO_V4_PROJECT_ROOT || path.join(workspace,'projects/Apollo-v3'));
  const repo = path.resolve(options.codeRoot || process.env.APOLLO_V4_CODE_ROOT || path.join(workspace,'arui-private'));
  const catalog = path.resolve(options.catalog || process.env.APOLLO_V4_CONTRACT_CATALOG || path.join(workspace,'shared/design-system_ab/experiments/current-contract-packages'));
  for (const file of ['apps/apollo-v4/dist/runtime.cjs','packages/generation-core/dist/planning.cjs','apps/apollo-v4/scripts/generation-code-connect-inputs.js'])
    if (!fs.existsSync(path.join(apollo,file))) fail('GENERATION_PROVIDER_NOT_BUILT');
  // A rebuild may happen while Proxy stays up: never keep an old bundled planner/runtime.
  for (const file of ['apps/apollo-v4/dist/runtime.cjs','packages/generation-core/dist/planning.cjs',
    'packages/adapter-frontend/dist/index.cjs','packages/adapter-frontend/host/frontend-host.cjs','packages/adapter-frontend/host/frontend-toolchain.cjs','packages/adapter-frontend/host/frontend-render.cjs','packages/adapter-frontend/host/frontend-browser.cjs',
    'packages/generation-core/dist/index.cjs','packages/component-contract-core/dist/core.cjs',
    'apps/apollo-v4/scripts/generation-code-connect-inputs.js','apps/apollo-v4/scripts/generation-package-inputs.js',
    'apps/apollo-v4/scripts/generation-current-producer.js','apps/apollo-v4/scripts/generation-representation-evidence.js']) {
    const absolute=path.join(apollo,file); if(fs.existsSync(absolute)) delete require.cache[require.resolve(absolute)];
  }
  // Resolve from the configured checkout, not from any prompt/request field.
  const runtime = require(path.join(apollo,'apps/apollo-v4/dist/runtime.cjs'));
  const planning = require(path.join(apollo,'packages/generation-core/dist/planning.cjs'));
  const {createCodeConnectReader} = require(path.join(apollo,'apps/apollo-v4/scripts/generation-code-connect-inputs.js'));
  const adapter=require(path.join(apollo,'packages/adapter-frontend/dist/index.cjs'));
  const {createFrontendHost}=require(path.join(apollo,'packages/adapter-frontend/host/frontend-host.cjs'));
  return {apolloRoot:apollo,repo,planning,adapter,createFrontendHost,hash:runtime.contractHash,validate:planning.validateScreenSpec,
    readContext:createCodeConnectReader({repo,catalog,workspaceRoot:workspace,hash:runtime.contractHash})};
}
function mountGenerationV4Routes(app, options={}) {
  require('./static-review-service').mountStaticReviewRoutes(app,options);
  const frontend=require('./frontend-service').mountFrontendRoutes(app,options,loadProvider);
  let active = false;
  app.post('/v4/generation/context', async (req,res) => {
    try {
      const body = req.body;
      if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length!==1 || !Object.hasOwn(body,'spec')
        || Buffer.byteLength(JSON.stringify(body),'utf8')>1024*1024) fail('SCREEN_SCHEMA',400);
      if (active) fail('GENERATION_PROXY_BUSY',409);
      active = true;
      try {
        const provider = options.provider || loadProvider(options);
        if (provider.validate(body.spec).length) fail('SCREEN_SCHEMA',400);
        const spec = JSON.parse(JSON.stringify(body.spec)), context = await provider.readContext(spec);
        res.json({success:true,schemaVersion:'apollo.v4-generation-context.v1-experimental',specHash:provider.hash(spec),contextHash:provider.hash(context),context});
      } finally { active = false; }
    } catch (error) {
      const code = typeof error.code==='string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code) ? error.code : /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message||'') ? error.message : 'GENERATION_INPUTS_UNAVAILABLE';
      // No source bytes, paths, filenames, subprocess details or private reports in errors.
      res.status(error.status || (code==='SOURCE_COMPILE'?422:503)).json({success:false,code,error:code});
    }
  });
  return frontend;
}
module.exports = {mountGenerationV4Routes,loadProvider};
