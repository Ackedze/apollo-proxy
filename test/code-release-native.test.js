const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
test('native code update presents versions and safe actions for current/update/offline/pending states',{skip:process.platform!=='darwin',timeout:30000},t=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'code-ui-'));t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  const source=path.resolve(__dirname,'../macos-app/Sources/ApolloProxyControl');
  const binary=path.join(temporary,'ui-test');
  execFileSync('/usr/bin/swiftc',[path.join(source,'KnowledgeCommandRunner.swift'),path.join(source,'CodeReleaseCommand.swift'),path.join(__dirname,'fixtures/code-release/main.swift'),'-o',binary],{timeout:20000});
  assert.match(execFileSync(binary,{encoding:'utf8'}),/presentation PASS/);
});
