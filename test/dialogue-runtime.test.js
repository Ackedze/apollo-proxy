const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('Ask uses Proxy knowledge and a disposable directory without a user workspace or validator skill', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-dialogue-portable-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const knowledge = path.join(root, 'proxy-knowledge'), ds = path.join(knowledge, 'design-system_ab'), hub = path.join(knowledge, 'ds-ai-hub');
  function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
  write(path.join(ds, 'JSONS/apollo/indexes/componentContractIndex.json'), JSON.stringify({ schemaVersion: 2, packages: [{ componentKey: 'fixture', packagePath: 'fixture', artifacts: { contract: 'contract.json' } }] }));
  write(path.join(ds, 'JSONS/fixture/contract.json'), '{"name":"BackgroundPlate"}');
  write(path.join(ds, 'JSONS/apollo/designPatternRules.json'), '{"rules":[]}');
  write(path.join(ds, 'redpolrules/dictionary.json'), '{"rules":[]}');
  write(path.join(ds, 'patterns/fixture.md'), '# Fixture');
  for (const directory of ['products/ab/components', 'core/web/components']) fs.mkdirSync(path.join(hub, directory), { recursive: true });
  write(path.join(hub, 'products/ab/patterns/fixture.md'), '# Fixture');
  const binary = path.join(root, 'codex-stub'), record = path.join(root, 'record.json'), workspace = path.join(root, 'absent-user-workspace');
  write(binary, '#!' + process.execPath + '\n' + `const fs=require('fs');let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({args,cwd:process.cwd(),input}));fs.writeFileSync(args[args.indexOf('--output-last-message')+1],'Ответ по базе Proxy');});`);
  fs.chmodSync(binary, 0o700);
  const code = `const assert=require('node:assert/strict'),fs=require('fs');const {app,assertGenerationRuntimeReady}=require(${JSON.stringify(path.resolve(__dirname, '../server.js'))});
(async()=>{const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'codex',text:'Расскажи про BackgroundPlate'})});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.result,'Ответ по базе Proxy');const run=JSON.parse(fs.readFileSync(${JSON.stringify(record)}));assert.equal(fs.existsSync(run.cwd),false);assert.notEqual(run.cwd,${JSON.stringify(workspace)});assert.equal(run.args[run.args.indexOf('--cd')+1],run.cwd);assert.deepEqual(run.args.filter((a,i)=>run.args[i-1]==='--add-dir'),[${JSON.stringify(ds)}]);assert.equal(run.args[run.args.indexOf('--sandbox')+1],'read-only');assert.equal(run.args.includes('--output-schema'),false);assert(run.input.includes(${JSON.stringify(ds)}));assert.equal(fs.existsSync(${JSON.stringify(workspace)}),false);assert.throws(()=>assertGenerationRuntimeReady(),e=>e.code==='GENERATION_RUNTIME_NOT_READY');console.log('PASS');}finally{await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});`;
  const output = execFileSync(process.execPath, ['-e', code], { cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, { APOLLO_CLI_PROVIDER: 'codex', CODEX_BIN: binary, CODEX_WORKSPACE: workspace, CODEX_DESIGN_SYSTEM: ds, CODEX_DS_AI_HUB: hub, APOLLO_CODEX_KNOWLEDGE_SOURCE: 'design-system_ab', APOLLO_PROXY_MANAGED: '0' }), timeout: 15000 });
  assert.match(output, /PASS/);
});
