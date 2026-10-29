const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const source=fs.readFileSync(path.join(__dirname,'../macos-app/scripts/build-app.sh'),'utf8');
const publicKey=Buffer.alloc(32,7).toString('base64');
function bootstrap(keyAvailable){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'apollo-sparkle-bootstrap-')),proxy=path.join(root,'proxy'),scripts=path.join(proxy,'macos-app/scripts'),bin=path.join(root,'bin'),tools=path.join(proxy,'macos-app/.build/artifacts/sparkle/Sparkle/bin');
 fs.mkdirSync(scripts,{recursive:true});fs.mkdirSync(bin);fs.writeFileSync(path.join(proxy,'package.json'),JSON.stringify({version:'1.4.4'}));
 fs.copyFileSync(path.join(__dirname,'../macos-app/scripts/sparkle-key.sh'),path.join(scripts,'sparkle-key.sh'));
 const marker=source.indexOf('echo "[3/7] Creating universal launcher..."');assert(marker>0);
 fs.writeFileSync(path.join(scripts,'build-app.sh'),source.slice(0,marker)+'\nprintf "\\nBOOTSTRAP_RESULT=%s|%s\\n" "$SPARKLE_FEED_URL" "$SPARKLE_PUBLIC_KEY"\n');
 const mockSwift=['#!/bin/bash','set -eu','[[ "$1" == build ]]','mkdir -p "$BOOTSTRAP_TOOL_DIR"','if [[ "$BOOTSTRAP_KEY_AVAILABLE" == yes ]]; then','  printf \'#!/bin/bash\\nprintf "%%s\\\\n" "$BOOTSTRAP_PUBLIC_KEY"\\n\' > "$BOOTSTRAP_TOOL_DIR/generate_keys"','else','  printf \'#!/bin/bash\\necho "key unavailable" >&2\\nexit 1\\n\' > "$BOOTSTRAP_TOOL_DIR/generate_keys"','fi','chmod +x "$BOOTSTRAP_TOOL_DIR/generate_keys"',''].join('\n');
 fs.writeFileSync(path.join(bin,'swift'),mockSwift,{mode:0o755});
 assert(!fs.existsSync(tools),'Sparkle artifacts must be absent before the first Swift build');
 try{return spawnSync('bash',[path.join(scripts,'build-app.sh')],{encoding:'utf8',timeout:15000,env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,CODESIGN_IDENTITY:'-',NOTARY_KEYCHAIN_PROFILE:'',REQUIRE_NOTARIZATION:'0',APOLLO_APPCAST_URL:'',APOLLO_SPARKLE_PUBLIC_KEY:'',APOLLO_APP_BUILD_NUMBER:'2026102901',APOLLO_PROXY_SOURCE_ROOT:proxy,BOOTSTRAP_TOOL_DIR:tools,BOOTSTRAP_PUBLIC_KEY:publicKey,BOOTSTRAP_KEY_AVAILABLE:keyAvailable?'yes':'no'}});}
 finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('first app build reads the existing Sparkle key after Swift bootstraps its tools',()=>{
 const result=bootstrap(true);assert.equal(result.status,0,result.stderr);assert(result.stdout.includes('BOOTSTRAP_RESULT=https://github.com/Ackedze/apollo-proxy/releases/latest/download/appcast.xml|'+publicKey));
});
test('app preparation refuses a missing existing key instead of emitting an app without updates',()=>{
 const result=bootstrap(false);assert.notEqual(result.status,0);assert.match(result.stderr,/Cannot read the existing Sparkle key/);assert(!result.stdout.includes('BOOTSTRAP_RESULT='));
});
