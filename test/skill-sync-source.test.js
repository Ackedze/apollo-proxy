const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const script=process.env.APOLLO_SKILL_SYNC_TEST_SCRIPT||path.resolve(__dirname,'../scripts/sync-codex-skill.js');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'skill-sync-source-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const proxy=path.join(root,'services/proxy'),file=path.join(proxy,'scripts/sync-codex-skill.js');fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(script,file);
 const skill=relative=>{const p=path.join(root,relative);fs.mkdirSync(path.join(p,'references'),{recursive:true});fs.writeFileSync(path.join(p,'SKILL.md'),'# '+relative);for(const name of ['audit-response.schema.json','pattern-assessment-response.schema.json'])fs.writeFileSync(path.join(p,'references',name),JSON.stringify({type:'object',properties:{},required:[],additionalProperties:false}));return p;};
 const target=skill('services/proxy/codex-workspace/.agents/skills/apollo-design-validator'),fallback=skill('projects/Apollo-v2/.agents/skills/apollo-design-validator');
 return{root,target,fallback,skill,run(source){const env={...process.env};delete env.APOLLO_SKILL_SOURCE_ROOT;if(source!==undefined)env.APOLLO_SKILL_SOURCE_ROOT=source;return spawnSync(process.execPath,[file],{env,encoding:'utf8'});}};
}
for(const kind of ['missing','file','skill-directory'])test('explicit '+kind+' skill source fails before touching target despite valid defaults',t=>{
 const f=fixture(t),before=fs.readFileSync(path.join(f.target,'SKILL.md'),'utf8'),source=path.join(f.root,'explicit');
 if(kind==='file')fs.writeFileSync(source,'not a directory');if(kind==='skill-directory')fs.mkdirSync(path.join(source,'SKILL.md'),{recursive:true});
 const r=f.run(source);assert.notEqual(r.status,0);assert.match(r.stderr,/Canonical Apollo skill is missing/);assert.equal(fs.readFileSync(path.join(f.target,'SKILL.md'),'utf8'),before);
});
test('existing explicit source is authoritative; omitted override retains default resolution',t=>{
 const f=fixture(t),source=f.skill('explicit-valid');assert.equal(f.run(source).status,0);assert.equal(fs.readFileSync(path.join(f.target,'SKILL.md'),'utf8'),'# explicit-valid');
 assert.equal(f.run().status,0);assert.equal(fs.readFileSync(path.join(f.target,'SKILL.md'),'utf8'),'# projects/Apollo-v2/.agents/skills/apollo-design-validator');
});
test('explicit target validates in place and malformed schema never replaces its contents',t=>{
 const f=fixture(t),before=fs.readFileSync(path.join(f.target,'SKILL.md'),'utf8');assert.equal(f.run(f.target).status,0);assert.equal(fs.readFileSync(path.join(f.target,'SKILL.md'),'utf8'),before);
 const source=f.skill('invalid-schema');fs.writeFileSync(path.join(source,'references/audit-response.schema.json'),'invalid');assert.notEqual(f.run(source).status,0);assert.equal(fs.readFileSync(path.join(f.target,'SKILL.md'),'utf8'),before);
});
