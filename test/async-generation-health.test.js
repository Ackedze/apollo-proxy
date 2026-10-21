const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('health keeps asynchronous generation busy between HTTP callbacks and releases after terminal state', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-async-health-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proxy = path.resolve(__dirname, '..');
  const script = `
const assert=require('node:assert/strict');
const proxy=${JSON.stringify(proxy)},active={frontend:false,native:false,mcp:false};
require(proxy+'/src/generation/semantic-index').inspectSemanticIndex=()=>({ready:false,reason:'unit-test-no-model'});
for(const [file,methods] of [['agent-runtime',{mountConfiguredAgentRoutes:'frontend'}],['agent-figma-runtime',{mountConfiguredAgentFigmaHostRoutes:'native',mountConfiguredAgentMcpRoutes:'mcp'}]]){
 const name=proxy+'/src/generation-agent/'+file,module=require(name);
 for(const [method,key] of Object.entries(methods))module[method]=()=>({isBusy:async()=>active[key]});
}
const {app}=require(proxy+'/server');
const handler=app._router.stack.find(layer=>layer.route?.path==='/health').route.stack[0].handle;
const read=()=>new Promise((resolve,reject)=>Promise.resolve(handler({}, {json:resolve})).catch(reject));
(async()=>{
 for(const key of Object.keys(active)){
  active[key]=true;
  const health=await read();assert.equal(health.activeRequests,0);assert.equal(health.agent.busy,true,key);assert.equal(health.generation.busy,true,key);
  active[key]=false;
  const idle=await read();assert.equal(idle.agent.busy,false,key);assert.equal(idle.generation.busy,false,key);
 }
 console.log('async generation health PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});`;
  const env = { ...process.env, APOLLO_PROJECT_ROOT: path.join(root, 'no-checkout'), APOLLO_DATA_ROOT: '',
    APOLLO_RELEASE_ROOT: '', APOLLO_PROXY_MANAGED: '0', CODEX_WORKSPACE: path.join(root, 'no-workspace'),
    CODEX_DESIGN_SYSTEM: path.join(root, 'no-design-system'), CODEX_DS_AI_HUB: path.join(root, 'no-hub') };
  assert.match(execFileSync(process.execPath, ['-e', script], { cwd: root, env, encoding: 'utf8', timeout: 15000 }), /async generation health PASS/);
});
