const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');

test('native editing menu routes shortcuts and activation accepts a pasted secret', {skip:process.platform!=='darwin',timeout:30000}, t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'apollo-editing-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.resolve(__dirname,'../macos-app/Sources/ApolloProxyControl'),binary=path.join(root,'verify');
  const startup=fs.readFileSync(path.join(source,'main.swift'),'utf8');
  assert.match(startup,/func applicationDidFinishLaunching[\s\S]*?AppEditingMenu\.install\(\)/);
  execFileSync('/usr/bin/swiftc',['-swift-version','6','-module-cache-path',path.join(root,'cache'),path.join(source,'AppEditingMenu.swift'),path.join(source,'DataActivation.swift'),path.join(__dirname,'fixtures/app-editing-menu/main.swift'),'-o',binary],{timeout:20000});
  assert.match(execFileSync(binary,{encoding:'utf8',timeout:10000}),/editing shortcuts PASS/);
});
