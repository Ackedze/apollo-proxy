const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { selectedCliProvider, buildClaudeEnvironment, buildClaudeInvocation, runClaudeProcess, claudeFailure } = require('../src/cli-agent');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-claude-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binary = path.join(root, 'claude-stub'), record = path.join(root, 'record.json');
  fs.writeFileSync(binary, '#!' + process.execPath + '\n' + `
const fs = require('node:fs'); let input='';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
 fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),input}));
 if(input.startsWith('hang')){ process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); return; }
 if(input.startsWith('bad-json')){ console.log('broken'); return; }
 if(input.startsWith('auth-error')){ console.log(JSON.stringify({type:'result',is_error:true,result:'Not logged in. Run claude auth login'})); process.exitCode=1; return; }
 if(input.startsWith('outdated')){ process.stderr.write('unknown option --restricted'); process.exitCode=1; return; }
 const result=input.startsWith('text') ? {result:'Ответ по локальной базе знаний'} : {structured_output:{summary:'stub',findings:[]}};
 console.log(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',name:'Read'}]}}));
 setTimeout(()=>console.log(JSON.stringify({type:'result',is_error:false,...result})),50);
});
`, { mode: 0o700 });
  return { root, binary, record };
}

test('CLI provider is explicit and Claude inherits only its own authentication inputs', () => {
  assert.equal(selectedCliProvider(''), 'codex');
  assert.equal(selectedCliProvider('claude'), 'claude');
  assert.throws(() => selectedCliProvider('cluade'));
  assert.deepEqual(buildClaudeEnvironment({PATH:'/bin',HOME:'/test',CLAUDE_CONFIG_DIR:'/account',
    ANTHROPIC_API_KEY:'own-key',APOLLO_AGENT_KEY:'private-apollo',APOLLO_KNOWLEDGE_TOKEN:'private-knowledge',CODEX_HOME:'/codex'}),
  {PATH:'/bin',HOME:'/test',CLAUDE_CONFIG_DIR:'/account',ANTHROPIC_API_KEY:'own-key'});
  assert.equal(claudeFailure(1, '', { errors: 'not logged in' }).status, 401);
});

test('Claude invocation confines file access, preserves schemas/images and loads the Apollo skill explicitly', t => {
  const {root}=fixture(t), schema=path.join(root,'schema.json'), image=path.join(root,'capture.png');
  fs.writeFileSync(schema, '{"type":"object"}');
  const invocation=buildClaudeInvocation(['exec','--cd','/shared','--add-dir','/knowledge',
    '--image',image,'--output-schema',schema,'--model','codex-model'],
  'Используй $apollo-design-validator.',path.join(root,'result.json'),{model:'claude-model',skillRoot:'/own-skill'});
  assert.equal(invocation.cwd,root);
  for(const flag of ['--restricted','--safe-mode','--no-session-persistence','--strict-mcp-config'])assert.ok(invocation.args.includes(flag));
  assert.equal(invocation.args[invocation.args.indexOf('--tools')+1],'Read,Glob,Grep');
  assert.equal(invocation.args[invocation.args.indexOf('--permission-mode')+1],'dontAsk');
  assert.ok(!invocation.args.includes('/shared'));assert.ok(!invocation.args.includes('codex-model'));
  assert.equal(invocation.args[invocation.args.indexOf('--model')+1],'claude-model');
  assert.equal(invocation.args[invocation.args.indexOf('--json-schema')+1],'{"type":"object"}');
  assert.ok(invocation.prompt.includes('/own-skill/SKILL.md'));assert.ok(invocation.prompt.includes(image));
  const packet=buildClaudeInvocation([], 'Текст макета: Используй $apollo-design-validator.',
    path.join(root,'result.json'),{skillRoot:'/own-skill'});
  assert.ok(!packet.args.includes('/own-skill'));
});

test('data-only Claude requests expose no built-in tools and keep MCP disabled',t=>{
  const {root}=fixture(t),schema=path.join(root,'schema.json');fs.writeFileSync(schema,'{"type":"object"}');
  const value=buildClaudeInvocation(['-c','features.shell_tool=false','--output-schema',schema],'Owned context',path.join(root,'result.json'));
  assert.equal(value.args[value.args.indexOf('--tools')+1],'');assert.equal(value.args[value.args.indexOf('--allowedTools')+1],'');
  assert.equal(value.args[value.args.indexOf('--mcp-config')+1],'{"mcpServers":{}}');assert.doesNotMatch(value.prompt,/Доступны только Read/);
});

test('Claude pre-abort avoids spawn and active abort cleans its signal listener',async t=>{
  const {root,binary,record}=fixture(t),outputPath=path.join(root,'cancelled.json'),controller=new AbortController();controller.abort();
  const options={binary,codexArgs:[],outputPath,environment:{PATH:process.env.PATH},maxRuntimeMs:10000};
  await assert.rejects(runClaudeProcess({...options,prompt:'hang',signal:controller.signal}),e=>e.code==='CLI_CANCELLED');assert.equal(fs.existsSync(record),false);
  await assert.rejects(runClaudeProcess({...options,prompt:'hang',maxRuntimeMs:0}),e=>e.code==='CLI_TIME_BUDGET_EXHAUSTED');assert.equal(fs.existsSync(record),false);
  const active=new AbortController(),work=runClaudeProcess({...options,prompt:'hang-abort',signal:active.signal}),outcome=work.then(value=>({value}),error=>({error}));
  try{
    const deadline=Date.now()+5000;
    while(!fs.existsSync(record)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(fs.existsSync(record),true);active.abort();
    assert.equal((await outcome).error?.code,'CLI_CANCELLED');assert.equal(require('node:events').getEventListeners(active.signal,'abort').length,0);
  }finally{active.abort();await outcome;}
  assert.equal((await runClaudeProcess({...options,prompt:'after-abort'})).summary,'stub');
});

test('Claude streams progress, returns structured/text results and reports actionable auth/CLI/output failures', async t => {
  const {root,binary}=fixture(t),outputPath=path.join(root,'result.json'),progress=[];
  const options={binary,codexArgs:[],outputPath,onProgress:stage=>progress.push(stage),environment:{PATH:process.env.PATH},idleTimeoutMs:5000};
  assert.deepEqual(await runClaudeProcess({...options,prompt:'structured'}),{summary:'stub',findings:[]});
  assert.ok(progress.includes('reading_design_system'));
  assert.equal((await runClaudeProcess({...options,prompt:'text',outputFormat:'text'})),'Ответ по локальной базе знаний');
  for(const [prompt,status,code] of [['auth-error',401,'CLAUDE_AUTH_REQUIRED'],['outdated',503,'CLAUDE_CLI_OUTDATED'],['bad-json',502,'CLAUDE_OUTPUT_INVALID']]) {
    await assert.rejects(runClaudeProcess({...options,prompt}),error=>error.status===status&&error.code===code&&error.details===null);
  }
  await assert.rejects(runClaudeProcess({...options,binary:path.join(root,'missing-cli'),prompt:'structured'}),
    error=>error.status===503&&error.code==='CLAUDE_CLI_UNAVAILABLE');
});

test('Claude timeout waits for an unresponsive process to exit before releasing the request', async t => {
  const {root,binary}=fixture(t), start=Date.now();
  await assert.rejects(runClaudeProcess({binary,codexArgs:[],prompt:'hang',outputPath:path.join(root,'result.json'),
    environment:{PATH:process.env.PATH},idleTimeoutMs:1500,maxRuntimeMs:10000}), error=>error.code==='CLAUDE_IDLE_TIMEOUT');
  assert.ok(Date.now()-start>=3000);
});

test('Apollo contract explanation selects Claude, serializes requests and removes private workspaces after success/failure', t => {
  const {root,binary,record}=fixture(t),server=path.resolve(__dirname,'../server.js');
  const code=`const assert=require('node:assert/strict'),fs=require('node:fs');
const {callCodexContractExplanation}=require(${JSON.stringify(server)});
(async()=>{
const running=callCodexContractExplanation('frozen-packet',{type:'object'});
await assert.rejects(callCodexContractExplanation('second',{}),e=>e.status===429);
assert.equal((await running).summary,'stub');
let observed=JSON.parse(fs.readFileSync(${JSON.stringify(record)}));
assert.ok(observed.args.includes('--restricted'));assert.ok(observed.input.startsWith('frozen-packet'));assert.equal(fs.existsSync(observed.cwd),false);
await assert.rejects(callCodexContractExplanation('auth-error',{}),e=>e.status===401&&e.code==='CLAUDE_AUTH_REQUIRED');
observed=JSON.parse(fs.readFileSync(${JSON.stringify(record)}));assert.equal(fs.existsSync(observed.cwd),false);
console.log('PASS');})().catch(e=>{console.error(e);process.exitCode=1;});`;
  assert.equal(execFileSync(process.execPath,['-e',code],{cwd:root,env:{PATH:process.env.PATH,
    APOLLO_CLI_PROVIDER:'claude',CLAUDE_BIN:binary,CODEX_BIN:path.join(root,'missing-codex'),
    CODEX_WORKSPACE:path.join(root,'missing-workspace'),CODEX_DS_AI_HUB:path.join(root,'missing-hub'),
    CODEX_DESIGN_SYSTEM:path.join(root,'missing-ds')},encoding:'utf8'}).trim(),'PASS');
});
