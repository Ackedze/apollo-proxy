'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {isolateAbmTools}=require('../src/reports/ABM-tool-isolation');

function fixture(t,mode='normal') {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'abm-tool-isolation-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const home=path.join(root,'home');fs.mkdirSync(home);
 const binary=path.join(root,'codex-stub'),mcp=path.join(root,'fake-mcp.js');
 const started=path.join(root,'mcp-started'),session=path.join(root,'session.json'),record=path.join(root,'commands.jsonl');
 const config='[mcp_servers.personal]\ncommand = '+JSON.stringify(process.execPath)+'\nargs = ['+JSON.stringify(mcp)+']\n'
  +(mode==='disabled-invalid-entry'?'[mcp_servers.legacy]\ntransport = "obsolete"\nenabled = false\n':'');
 fs.writeFileSync(path.join(home,'config.toml'),config);
 fs.writeFileSync(mcp,`const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(started)},'started\\n');
 const readline=require('node:readline').createInterface({input:process.stdin});
 readline.on('line',line=>{const m=JSON.parse(line);console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'private_tool',inputSchema:{type:'object'}}]}}));});`);
 fs.writeFileSync(binary,'#!'+process.execPath+'\n'+`
 const fs=require('node:fs'),{spawnSync}=require('node:child_process');const args=process.argv.slice(2);
 fs.appendFileSync(${JSON.stringify(record)},JSON.stringify(args)+'\\n');
 const config=fs.readFileSync(require('node:path').join(process.env.CODEX_HOME,'config.toml'),'utf8');
 const names=[...config.matchAll(/^\\[mcp_servers\\.([-\\w]+)\\]$/gm)].map(m=>m[1]);
 if(${JSON.stringify(mode)}==='disabled-invalid-entry'&&args.includes('mcp_servers.legacy.enabled=false'))process.exit(2);
 const enabled=names.filter(name=>name!=='legacy'&&(!args.includes('mcp_servers.'+name+'.enabled=false')||${JSON.stringify(mode)}==='ignores-disable'));
 if(args.includes('list')){console.log(${JSON.stringify(mode)}==='invalid'?'broken':JSON.stringify(names.map(name=>({name,enabled:enabled.includes(name)}))));process.exit(0);}
 const tools=[];
 for(const name of enabled){const p=spawnSync(process.execPath,[${JSON.stringify(mcp)}],{input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\\n',encoding:'utf8'});tools.push(...JSON.parse(p.stdout).result.tools.map(tool=>tool.name));}
 fs.writeFileSync(${JSON.stringify(session)},JSON.stringify({tools,args}));
 console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:1,cached_input_tokens:0}}));
 fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({ok:true}));
 `,{mode:0o700});
 const environment={PATH:process.env.PATH,HOME:home,CODEX_HOME:home,TMPDIR:os.tmpdir()};
 const output=path.join(root,'response.json');
 const settings=['features.shell_tool=false','features.apps=false','features.plugins=false','features.remote_plugin=false','web_search="disabled"'];
 const args=['exec',...settings.flatMap(s=>['-c',s]),'--output-last-message',output,'-'];
 return {root,home,binary,mcp,started,session,record,config,environment,output,args,settings};
}

test('ABM process disables an inherited fake MCP before the session; no server starts or tool is offered',t=>{
 const f=fixture(t);
 // Positive control: the preconfigured server really starts and advertises a tool without isolation.
 execFileSync(f.binary,f.args,{cwd:f.root,env:f.environment,input:'synthetic'});
 assert(fs.existsSync(f.started));assert.deepEqual(JSON.parse(fs.readFileSync(f.session)).tools,['private_tool']);
 fs.unlinkSync(f.started);fs.unlinkSync(f.session);fs.unlinkSync(f.record);
 const script=`const {runCodexProcess}=require(${JSON.stringify(path.resolve(__dirname,'../src/reports/process'))});
 runCodexProcess(${JSON.stringify(f.args)},'Synthetic question',${JSON.stringify(f.output)},null,'reading_design_system',
 {mode:'dialogue',dataOnly:true,workingDirectory:${JSON.stringify(f.root)}}).then(r=>{if(!r.ok)process.exitCode=1;}).catch(e=>{console.error(e.code);process.exitCode=1;});`;
 execFileSync(process.execPath,['-e',script],{cwd:f.root,env:{...f.environment,APOLLO_CLI_PROVIDER:'codex',CODEX_BIN:f.binary,
  CODEX_DESIGN_SYSTEM:f.root,CODEX_DS_AI_HUB:f.root,APOLLO_STATE_ROOT:path.join(f.root,'state')},timeout:10000});
 assert.equal(fs.existsSync(f.started),false);
 const session=JSON.parse(fs.readFileSync(f.session));assert.deepEqual(session.tools,[]);
 assert(session.args.includes('mcp_servers.personal.enabled=false'));
 for(const setting of f.settings)assert(session.args.includes(setting));
 const commands=fs.readFileSync(f.record,'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(commands.length,3);assert(commands.slice(0,2).every(args=>args.includes('list')));assert.equal(commands[2][0],'exec');
 assert.equal(fs.readFileSync(path.join(f.home,'config.toml'),'utf8'),f.config);
});

for(const mode of ['invalid','ignores-disable'])test('ABM rejects unverifiable MCP isolation before a session: '+mode,async t=>{
 const f=fixture(t,mode);
 await assert.rejects(isolateAbmTools(f.binary,f.args,f.environment,f.root),{code:'ABM_TOOL_ISOLATION_FAILED'});
 assert.equal(fs.existsSync(f.started),false);assert.equal(fs.existsSync(f.session),false);
 assert.equal(fs.readFileSync(path.join(f.home,'config.toml'),'utf8'),f.config);
});

test('ABM ignores an already disabled legacy MCP entry while disabling active servers',async t=>{
 const f=fixture(t,'disabled-invalid-entry');
 const args=await isolateAbmTools(f.binary,f.args,f.environment,f.root);
 assert(args.includes('mcp_servers.personal.enabled=false'));
 assert.equal(args.includes('mcp_servers.legacy.enabled=false'),false);
 assert.equal(fs.existsSync(f.started),false);
 assert.equal(fs.readFileSync(path.join(f.home,'config.toml'),'utf8'),f.config);
});
