const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
test('native code update presents versions and safe actions for current/update/offline/pending states',{skip:process.platform!=='darwin',timeout:30000},t=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'code-ui-'));t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  const source=path.resolve(__dirname,'../macos-app/Sources/ApolloProxyControl');
  const binary=path.join(temporary,'ui-test');
  execFileSync('/usr/bin/swiftc',[path.join(source,'KnowledgeCommandRunner.swift'),path.join(source,'CodeReleaseCommand.swift'),path.join(__dirname,'fixtures/code-release/main.swift'),'-o',binary],{timeout:20000});
  assert.match(execFileSync(binary,{encoding:'utf8'}),/presentation PASS/);
});

test('native runtime channel migration updates former defaults while preserving custom channels and decoding pending data', { skip: process.platform !== 'darwin', timeout: 30000 }, t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'data-channel-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const source = path.resolve(__dirname, '../macos-app/Sources/ApolloProxyControl'), binary = path.join(temporary, 'channel-test');
  const main = path.join(temporary, 'main.swift');
  fs.writeFileSync(main, `import Foundation
let prefix="https://raw.githubusercontent.com/Ackedze/design-system_ab/main/"
let previous=String(repeating:"a",count:64), next=String(repeating:"b",count:64)
let bundled=prefix+"apollo/runtimes/"+next+"/data-packages/current.json"
for old in [prefix+"apollo/data-packages/current.json",prefix+"apollo/channels/stable/data-packages/current.json",prefix+"apollo/runtimes/"+previous+"/data-packages/current.json"] {
 precondition(DataChannelMigration.replacement(configured:old,bundled:bundled,previousRuntimeIDs:[previous]) == bundled)
}
for custom in ["https://example.test/own.json",prefix+"apollo/runtimes/"+String(repeating:"c",count:64)+"/data-packages/current.json",bundled] {
 precondition(DataChannelMigration.replacement(configured:custom,bundled:bundled,previousRuntimeIDs:[previous]) == nil)
}
precondition(DataChannelMigration.replacement(configured:nil,bundled:bundled,previousRuntimeIDs:[]) == bundled)
let status=try JSONDecoder().decode(KnowledgeCommandStatus.self,from:Data("{\\"current\\":null,\\"runtimeMigrationRequired\\":true,\\"activationRequired\\":false}".utf8))
precondition(status.runtimeMigrationRequired == true && status.activationRequired == false && status.current == nil)
print("channel migration PASS")
`);
  execFileSync('/usr/bin/swiftc', [path.join(source, 'KnowledgeCommandRunner.swift'), path.join(source, 'DataChannelMigration.swift'), main, '-o', binary], { timeout: 20000 });
  assert.match(execFileSync(binary, { encoding: 'utf8' }), /channel migration PASS/);
});
