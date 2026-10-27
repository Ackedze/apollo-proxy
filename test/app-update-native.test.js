const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
test('app update resumes an owned running Proxy once and preserves mutable state',{skip:process.platform!=='darwin',timeout:30000},t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'app-update-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.resolve(__dirname,'../macos-app/Sources/ApolloProxyControl'),binary=path.join(root,'verify');
  const framework=path.resolve(source,'../../.build/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64');
  execFileSync('/usr/bin/swiftc',['-swift-version','6',path.join(source,'AppUpdater.swift'),path.join(source,'AppUpdateState.swift'),path.join(source,'ProxyRuntimeInstaller.swift'),path.join(__dirname,'fixtures/app-update/main.swift'),'-F',framework,'-framework','Sparkle','-Xlinker','-rpath','-Xlinker',framework,'-o',binary],{timeout:20000});
  assert.match(execFileSync(binary,{encoding:'utf8'}),/preservation PASS/);
});
