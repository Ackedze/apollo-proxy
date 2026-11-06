'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createLandingService,mountLandingRoutes}=require('../src/landing/service');
function step(kind,write=false){const value={kind,message:kind,query:'',offset:0,resources:[],resultJson:JSON.stringify({checkpoint:{sectionId:null,status:'partial',nextAction:'Next'}})};if(write)value.sectionPatch=null;else value.specJson=JSON.stringify({facts:[],decisions:[],questions:[],sections:[{id:'hero',role:'hero'}]});return value;}
function harness(t,run=async options=>step(options.profile==='landing-plan'?'build':'continue',options.profile!=='landing-plan')){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'landing-delete-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let calls=0;
 const source={id:'fixture',knowledgeVersion:'fixture',skill:{version:'0.3.0',sha256:'fixture'},assertCurrent(){},initial:{instructions:{},norms:[],workflow:[],resources:[]}};
 const make=()=>createLandingService({root,knowledge:()=>source,createCli:()=>({run:async options=>{calls++;return {result:await run(options),receipt:{usage:{actualInputTokens:1},mcp:{toolCalls:0}}};}})}),service=make();
 return {root,service,make,get calls(){return calls;},create:()=>service.create({pageId:'1:1',fileKey:'FixtureFile'}),request:chat=>({requestId:crypto.randomUUID(),revision:chat.revision,text:'Fixture brief'})};
}
test('deletion archives only the chosen inactive record and survives reload without model or Figma work',t=>{
 const h=harness(t),a=h.create(),b=h.create(),file=path.join(h.root,a.id+'.json'),archive=path.join(h.root,a.id+'.deleted.json'),before=fs.readFileSync(file);assert.deepEqual(h.service.remove(a.id,{revision:a.revision}),{id:a.id,deleted:true});assert.equal(fs.existsSync(file),false);assert.deepEqual(fs.readFileSync(archive),before);assert.deepEqual(h.service.list().map(c=>c.id),[b.id]);assert.throws(()=>h.service.poll(a.id),{code:'LANDING_CHAT_NOT_FOUND'});assert.equal(h.calls,0);
 const reload=h.make();assert.deepEqual(reload.list().map(c=>c.id),[b.id]);assert.throws(()=>reload.create({id:a.id,pageId:'1:1',fileKey:'FixtureFile'}),{code:'LANDING_CHAT_NOT_FOUND'});assert.equal(h.calls,0);
});
test('a lost delete response can be retried without changing its archive',t=>{
 const h=harness(t),c=h.create();h.service.remove(c.id,{revision:c.revision});const archive=path.join(h.root,c.id+'.deleted.json'),before=fs.readFileSync(archive);assert.deepEqual(h.make().remove(c.id,{revision:c.revision}),{id:c.id,deleted:true});assert.deepEqual(fs.readFileSync(archive),before);assert.deepEqual(h.make().list(),[]);
});
test('wrong revisions and unsafe IDs leave history untouched',t=>{
 const h=harness(t),c=h.create(),file=path.join(h.root,c.id+'.json'),before=fs.readFileSync(file);assert.throws(()=>h.service.remove(c.id,{revision:c.revision+1}),{code:'LANDING_REVISION_STALE'});
 for(const id of ['../../outside','INVALID',c.id+'/child'])assert.throws(()=>h.service.remove(id,{revision:0}),{code:'LANDING_CHAT_INVALID'});
 for(const body of [{},{revision:-1},{revision:'0'},{revision:0,all:true}])assert.throws(()=>h.service.remove(c.id,body),{code:'LANDING_CHAT_DELETE_INVALID'});
 assert.deepEqual(fs.readFileSync(file),before);assert.equal(h.service.list().length,1);assert.equal(h.calls,0);
});
test('running, awaiting-canvas and awaiting-readback chats refuse deletion',async t=>{
 let release;const h=harness(t,()=>new Promise(resolve=>release=resolve)),c=h.create();h.service.submit(c.id,h.request(c));const settled=h.service.whenSettled(c.id);assert.throws(()=>h.service.remove(c.id,{revision:1}),{code:'LANDING_BUSY'});release(step('build'));await settled;assert.equal(h.service.poll(c.id).status,'awaiting-canvas');assert.throws(()=>h.service.remove(c.id,{revision:1}),{code:'LANDING_BUSY'});
 const target={fileKey:'FixtureFile',pageId:'1:1',rootNodeId:'1:2',ownerNonce:'a'.repeat(64),leaseNonce:'b'.repeat(64)},readback={rootNodeId:'1:2',pageId:'1:1',ownerNonce:target.ownerNonce,leaseNonce:target.leaseNonce,outsideHash:'c'.repeat(64),nodeCount:1,instanceCount:0,sections:[],text:'',coverage:'tagged-sections-and-text'};
 h.service.canvas(c.id,{revision:1,target,readback});const written=h.service.whenSettled(c.id);release(step('continue',true));await written;assert.equal(h.service.poll(c.id).status,'awaiting-readback');assert.throws(()=>h.service.remove(c.id,{revision:1}),{code:'LANDING_BUSY'});h.service.cancel(c.id);assert.equal(h.service.list().length,1);
});
test('late measured worker completion after Stop cannot recreate removed history',async t=>{
 let release;const h=harness(t,()=>new Promise(resolve=>release=resolve)),c=h.create();h.service.submit(c.id,h.request(c));const settled=h.service.whenSettled(c.id);h.service.cancel(c.id);h.service.remove(c.id,{revision:1});const archive=path.join(h.root,c.id+'.deleted.json'),before=fs.readFileSync(archive);release(step('build'));await settled;
 assert.equal(fs.existsSync(path.join(h.root,c.id+'.json')),false);assert.deepEqual(fs.readFileSync(archive),before);assert.deepEqual(h.service.list(),[]);assert.throws(()=>h.make().poll(c.id),{code:'LANDING_CHAT_NOT_FOUND'});assert.equal(h.calls,1);
});
test('failed atomic rename preserves the visible chat and its bytes',t=>{
 const h=harness(t),c=h.create(),file=path.join(h.root,c.id+'.json'),before=fs.readFileSync(file),rename=fs.renameSync;fs.renameSync=(from,to)=>{if(to.endsWith('.deleted.json'))throw Object.assign(Error('fixture rename failure'),{code:'EACCES'});return rename(from,to);};
 try{assert.throws(()=>h.service.remove(c.id,{revision:0}),{code:'EACCES'});}finally{fs.renameSync=rename;}
 assert.deepEqual(fs.readFileSync(file),before);assert.equal(h.service.poll(c.id).id,c.id);assert.equal(h.service.list().length,1);
});
test('a symlink replacing a cached chat is refused without touching its target',t=>{
 const h=harness(t),c=h.create(),file=path.join(h.root,c.id+'.json'),outside=path.join(h.root,'outside.txt');fs.writeFileSync(outside,'keep');fs.unlinkSync(file);fs.symlinkSync(outside,file);assert.throws(()=>h.service.remove(c.id,{revision:0}),{code:'LANDING_STORAGE_UNSAFE'});assert.equal(fs.readFileSync(outside,'utf8'),'keep');assert.equal(fs.existsSync(path.join(h.root,c.id+'.deleted.json')),false);
});
test('routes advertise deletion independently of data availability and validate its response/error',t=>{
 const h=harness(t),routes=new Map(),app={get:(p,fn)=>routes.set('GET '+p,fn),post:(p,fn)=>routes.set('POST '+p,fn)};mountLandingRoutes(app,{loadService:()=>h.service,status:()=>({available:false,code:'LANDING_DATA_REQUIRED'})});
 const call=(route,req={})=>{const res={statusCode:200,status(n){this.statusCode=n;return this;},json(value){this.body=value;}};routes.get(route)(req,res);return res;};const status=call('GET /landing/status');assert.equal(status.body.chatDeletion,true);assert.equal(status.body.available,false);
 const c=h.create(),response=call('POST /landing/chats/:id/delete',{params:{id:c.id},body:{revision:0}});assert.deepEqual(response.body,{success:true,id:c.id,deleted:true});assert.equal(response.statusCode,200);assert.equal(h.calls,0);
 const invalid=call('POST /landing/chats/:id/delete',{params:{id:'../outside'},body:{revision:0}});assert.equal(invalid.statusCode,400);assert.equal(invalid.body.code,'LANDING_CHAT_INVALID');
});
