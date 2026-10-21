const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {importDataPackage}=require('../scripts/import-data-package'),{readDataContracts,readDataIndex,readGenerationData,sha}=require('../src/data-packages');
const apolloRoot=path.resolve(__dirname,'../../../projects/Apollo'),app=path.join(apolloRoot,'.'),runtimeFile=path.join(app,'dist/runtime.cjs'),runtime=require(runtimeFile),core=require(path.join(apolloRoot,'packages/component-contract-core/dist/core.cjs')),fixture=require(path.join(app,'tests/authoring-fixtures'));
function setup(t){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'apollo-data-'))),root=path.join(dir,'data');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return{dir,root};}
function zip(dir,source,name='input.zip',contract=runtime.loadAuthoringSource(source,{evaluationMode:'authoring-preview'}).contract){const file=path.join(dir,name);fs.writeFileSync(file,core.createZip([core.textZipEntry('contract.manual.json',source.manual),core.textZipEntry('compiled/component-contract.v2.json',contract)]));return file;}
function replaceIndex(root,change){const file=path.join(root,'manifest.json'),index=JSON.parse(fs.readFileSync(file));delete index.id;change(index);index.id=sha(JSON.stringify(index));fs.writeFileSync(file,JSON.stringify(index));}
test('ZIP import is data only; old snapshots survive atomic revision updates',async t=>{
 const {dir,root}=setup(t),source=fixture.source(),bundle=sha(fs.readFileSync(runtimeFile)),file=zip(dir,source);
 const first=await importDataPackage({root,apolloRoot,packages:[file]}),old=readDataContracts({root,runtimeFile});
 assert.equal(old.contracts.length,1);assert.equal(old.contracts[0].entry.revision,1);assert.equal(first.restartRequired,false);
 source.manual.metadata.revision++;const next=await importDataPackage({root,apolloRoot,packages:[zip(dir,source,'next.zip')]});
 old.assertCurrent();assert.notEqual(next.dataId,first.dataId);assert.equal(readDataContracts({root,runtimeFile}).contracts[0].entry.revision,2);assert.equal(sha(fs.readFileSync(runtimeFile)),bundle);
 assert(!fs.readdirSync(root).some(name=>name.endsWith('.cjs')));assert.equal(fs.existsSync(path.join(root,'.import.lock')),false);
});
test('a corrupted immutable selected artifact invalidates its run',async t=>{
 const {dir,root}=setup(t);await importDataPackage({root,apolloRoot,packages:[zip(dir,fixture.source())]});const shot=readDataContracts({root,runtimeFile});fs.appendFileSync(path.join(root,shot.contracts[0].entry.file),' ');assert.throws(()=>shot.assertCurrent(),/DATA_PACKAGE_STALE/);
});
test('exact pinned dependency survives a newer current version; missing pins refuse publication',async t=>{
 const {dir,root}=setup(t),nested=fixture.nested(),host=zip(dir,nested.source,'host.zip',nested.host);
 await assert.rejects(importDataPackage({root,apolloRoot,packages:[host]}),/DATA_DEPENDENCY_MISSING/);assert(!fs.existsSync(path.join(root,'manifest.json')));
 const child=zip(dir,nested.childSource,'child.zip',nested.child);await importDataPackage({root,apolloRoot,packages:[host,child]});const prior=fs.readFileSync(path.join(root,'manifest.json')),frozenChild=structuredClone(readDataContracts({root,runtimeFile}).contracts.find(c=>c.entry.componentId===nested.source.manual.component.componentId).source.dependencies[0]);
 nested.childSource.manual.metadata.revision++;
 await importDataPackage({root,apolloRoot,packages:[zip(dir,nested.childSource,'changed-child.zip')]});
 const current=readGenerationData({root,apolloRoot}),parent=current.contracts.find(c=>c.entry.componentId===nested.source.manual.component.componentId);
 assert.equal(current.contracts.find(c=>c.entry.componentId===nested.childSource.manual.component.componentId).entry.revision,2);
 assert.deepEqual(parent.source.dependencies[0],frozenChild);
 assert.equal(parent.source.dependencies[0].manual.metadata.revision,1);
 assert(current.versions.some(v=>v.componentId===nested.childSource.manual.component.componentId&&v.revision===1));
 const stable=fs.readFileSync(path.join(root,'manifest.json'));
 nested.source.manual.componentDependencies[0].revision=99;
 await assert.rejects(importDataPackage({root,apolloRoot,packages:[zip(dir,nested.source,'missing-version.zip',nested.host)]}),/DATA_DEPENDENCY_MISSING/);
 assert.deepEqual(fs.readFileSync(path.join(root,'manifest.json')),stable);

});
test('unsupported checking projection is indexed as a gap, never admitted for audit',async t=>{
 const {dir,root}=setup(t),source=fixture.source(),contract=runtime.loadAuthoringSource(source).contract;contract.rules[0].assert.expected={literal:.5};
 await importDataPackage({root,apolloRoot,packages:[zip(dir,source,'unsupported.zip',contract)]});const data=readGenerationData({root,apolloRoot});
 assert.equal(data.contracts.length,1);assert.equal(data.contracts[0].checkingAvailable,false);assert.equal(readDataContracts({root,runtimeFile}).contracts.length,0);assert.equal(data.index.catalog[0].checking.status,'not-connected');assert.equal(data.index.Ready,false);
});
test('invalid mapping update leaves the previous index current',async t=>{
 const {dir,root}=setup(t);await importDataPackage({root,apolloRoot,packages:[zip(dir,fixture.source())]});const prior=fs.readFileSync(path.join(root,'manifest.json')),bad=path.join(dir,'mapping.json');fs.writeFileSync(bad,JSON.stringify({semantic:{mappings:[]},typed:{bindings:[]}}));
 await assert.rejects(importDataPackage({root,apolloRoot,figma:[bad]}),/DATA_FIGMA_PROFILE_REQUIRED/);assert.deepEqual(fs.readFileSync(path.join(root,'manifest.json')),prior);assert(!fs.existsSync(path.join(root,'manifest.next.json')));
});
test('index checksum, runtime profile, and artifact path boundaries are mandatory',async t=>{
 const {dir,root}=setup(t);await importDataPackage({root,apolloRoot,packages:[zip(dir,fixture.source())]});const manifest=fs.readFileSync(path.join(root,'manifest.json'));
 replaceIndex(root,index=>{index.profileVersion='999';});assert.throws(()=>readDataContracts({root,runtimeFile}),/DATA_RUNTIME_INCOMPATIBLE/);
 fs.writeFileSync(path.join(root,'manifest.json'),manifest);replaceIndex(root,index=>{index.contracts[0].file='../outside.json';});assert.throws(()=>readDataContracts({root,runtimeFile}),/DATA_PACKAGE_INVALID/);
 fs.writeFileSync(path.join(root,'manifest.json'),manifest);const index=JSON.parse(manifest);index.Ready=true;fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(index));assert.throws(()=>readDataIndex(root),/DATA_INDEX_INVALID/);
});
test('arbitrary modules in data cannot select an executable runtime',async t=>{
 const {dir,root}=setup(t);await importDataPackage({root,apolloRoot,packages:[zip(dir,fixture.source())]});replaceIndex(root,index=>{index.runtime={file:'evil.cjs'};});fs.writeFileSync(path.join(root,'evil.cjs'),"throw Error('EXECUTED_DATA');");
 assert.equal(readDataContracts({root,runtimeFile}).runtime.RUNTIME_VERSION,runtime.RUNTIME_VERSION);
});
test('planning selection retains complete normative dependency closure and rejects unknown IDs',()=>{
 const {selectPlanningContext,mappingSelectionPrompt}=require('../src/generation-agent/prompt-service');
 const packet={contracts:[{pin:{componentId:'parent'},manual:{component:{family:'Parent'},semantics:{purpose:'Host'},componentDependencies:[{componentId:'child'}],rules:[{id:'all',conditions:['visible'],exceptions:['hidden']}] }},{pin:{componentId:'child'},manual:{component:{family:'Child'},rules:[{id:'child-rule'}]}},{pin:{componentId:'unused'},manual:{component:{family:'Unused'},rules:[]}}],mappings:[{id:'parent-map',componentId:'parent'},{id:'other',componentId:'unused'}],targetContext:{origin:'server-data-index',targetMapping:{bindings:[]}}};
 const before=JSON.stringify(packet),focused=selectPlanningContext(packet,['parent-map']);
 assert.deepEqual(focused.contracts.map(c=>c.pin.componentId),['parent','child']);assert.deepEqual(focused.contracts[0].manual,packet.contracts[0].manual);assert.deepEqual(focused.mappings,[packet.mappings[0]]);assert.equal(JSON.stringify(packet),before);
 assert.throws(()=>selectPlanningContext(packet,['invented']),/PROMPT_MAPPING_UNAVAILABLE/);assert.throws(()=>selectPlanningContext(packet,['parent-map','parent-map']),/PROMPT_MAPPING_UNAVAILABLE/);assert(!mappingSelectionPrompt({prompt:'Host'},packet).includes('child-rule'));
});
test('data references are portable and do not depend on the author workspace',async t=>{
 const {dir,root}=setup(t),manual=path.join(dir,'reference.json');fs.writeFileSync(manual,'{}');const bytes=fs.readFileSync(manual);
 await importDataPackage({root,apolloRoot,packages:[zip(dir,fixture.source())],seed:{frontend:{target:'frontend',context:{proof:{path:manual,sha256:sha(bytes),bytes:bytes.length}},bindings:[]}}});
 const relocated=path.join(dir,'another-install');fs.cpSync(root,relocated,{recursive:true});fs.rmSync(root,{recursive:true});fs.unlinkSync(manual);
 const data=readGenerationData({root:relocated,apolloRoot});assert.equal(path.dirname(data.frontend.context.proof.path),path.join(relocated,"shared"));data.assertCurrent();
});
test('copied references to the same manual have one authority record',async t=>{
 const {dir,root}=setup(t),s=fixture.source(),manual=path.join(dir,'manual.json');fs.writeFileSync(manual,JSON.stringify(s.manual));const bytes=fs.readFileSync(manual),record={pin:{path:manual,sha256:sha(bytes),bytes:bytes.length},manual:s.manual};
 const semantic={schemaVersion:'apollo.agent-figma-semantic-mapping.v1',mappings:[]},genericMapping={semantic,typed:{schemaVersion:'apollo.agent-figma-typed-native-binding-input.v1',bindings:[]},profiles:{choices:[],sourceDependencies:[Object.assign(profile(s,runtime.loadAuthoringSource(s).contract),{manual:record.pin})],actualPartDefinitions:[]},targets:{profiles:[]},manuals:[record,record],ruleLinks:{links:[]},denials:[]};
 await importDataPackage({root,apolloRoot,packages:[zip(dir,s)],seed:{native:{sourceHash:require(path.join(app,'dist/agent-figma-postconditions.cjs')).SOURCE_HASH,mappings:[],genericMapping},semantic}});
 assert.equal(readGenerationData({root,apolloRoot}).native.genericMapping.manuals.length,1);
});
test('verified data compiles once; cache is isolated and invalidated by runtime or data changes',async t=>{
 const {dir,root}=setup(t);await importDataPackage({root,apolloRoot,packages:[zip(dir,fixture.source())]});
 const wrapper=path.join(dir,'runtime.cjs'),counter='apolloCompile'+Date.now();
 fs.writeFileSync(wrapper,`const r=require(${JSON.stringify(runtimeFile)});module.exports=Object.assign({},r,{loadAuthoringSource(...a){global[${JSON.stringify(counter)}]=(global[${JSON.stringify(counter)}]||0)+1;return r.loadAuthoringSource(...a);}});`);
 t.after(()=>delete global[counter]);
 const first=readDataContracts({root,runtimeFile:wrapper}),expected=JSON.stringify(first.contracts);
 first.contracts[0].contract.rules.length=0;first.contracts[0].source.manual.metadata.revision=999;
 const second=readDataContracts({root,runtimeFile:wrapper});assert.equal(JSON.stringify(second.contracts),expected);assert.equal(global[counter],1);
 fs.appendFileSync(wrapper,'\n// installed runtime changed');readDataContracts({root,runtimeFile:wrapper});assert.equal(global[counter],2);
 const pin=second.index.contracts[0].compiledCache,file=path.join(root,pin.file),bytes=fs.readFileSync(file);fs.appendFileSync(file,' ');
 assert.throws(()=>readDataContracts({root,runtimeFile:wrapper}),/DATA_PACKAGE_STALE/);fs.writeFileSync(file,bytes);
 const index=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));index.contracts[0].evaluationMode='invented';
 assert.throws(()=>readDataContracts({root,runtimeFile:wrapper,index}),/DATA_INDEX_INVALID/);
 const source=fixture.source();source.manual.metadata.revision++;await importDataPackage({root,apolloRoot,packages:[zip(dir,source,'changed.zip')]});
 assert.equal(readDataContracts({root,runtimeFile:wrapper}).contracts[0].entry.revision,2);assert.equal(global[counter],3);
 // Changing installed runtime invalidates prior frozen runs even when data is preserved.
 assert.throws(()=>second.assertCurrent(),/DATA_RUNTIME_STALE/);
});
test('cached packages still reject symlink replacement on reads and frozen assertions',async t=>{
 const {dir,root}=setup(t);await importDataPackage({root,apolloRoot,packages:[zip(dir,fixture.source())]});const loaded=readDataContracts({root,runtimeFile});
 const file=path.join(root,loaded.index.contracts[0].file),target=path.join(dir,'copy.json');fs.copyFileSync(file,target);fs.unlinkSync(file);fs.symlinkSync(target,file);
 assert.throws(()=>loaded.assertCurrent(),/DATA_PACKAGE_INVALID/);assert.throws(()=>readDataContracts({root,runtimeFile}),/DATA_PACKAGE_INVALID/);
});
test('component data stays under its component revision and frozen reads reject ancestor symlinks',async t=>{
 const {dir,root}=setup(t),source=fixture.source();await importDataPackage({root,apolloRoot,packages:[zip(dir,source)]});
 const loaded=readDataContracts({root,runtimeFile}),entry=loaded.index.contracts[0],prefix='components/'+entry.componentId+'/r'+entry.revision+'/';
 for(const pin of [entry,entry.compiledCache,entry.archive])assert(pin.file.startsWith(prefix));
 const componentRoot=path.dirname(path.join(root,entry.file)),copy=path.join(dir,'component-copy');fs.cpSync(componentRoot,copy,{recursive:true});fs.rmSync(componentRoot,{recursive:true});fs.symlinkSync(copy,componentRoot,'dir');
 assert.throws(()=>loaded.assertCurrent(),/DATA_PACKAGE_INVALID/);assert.throws(()=>readDataContracts({root,runtimeFile}),/DATA_PACKAGE_INVALID/);
});

test('planning keeps a historical manual only when the selected parent pins that version',()=>{
 const select=require('../src/generation-agent/prompt-service').selectPlanningContext;
 const packet={contracts:[{pin:{componentId:'parent',revision:1},manual:{component:{componentId:'parent'},componentDependencies:[{componentId:'child',revision:1,manualSourceHash:'old'}]}},{pin:{componentId:'child',revision:2,manualSourceHash:'new'},manual:{component:{componentId:'child'}}}],mappings:[{id:'parent-map',componentId:'parent'},{id:'child-map',componentId:'child'}],figmaMappingRecords:{semantic:{mappings:[]},typed:{bindings:[]},profiles:{choices:[],sourceDependencies:[{componentId:'child',revision:1,manualSemanticHash:'old'},{componentId:'child',revision:2,manualSemanticHash:'new'}]},manuals:[{manualReference:{componentId:'child',manualSourceHash:'new'}},{manual:{component:{componentId:'child'},metadata:{revision:1}}}]}};
 const child=select(packet,['child-map']);assert.equal(child.figmaMappingRecords.manuals.length,1);assert.deepEqual(child.figmaMappingRecords.profiles.sourceDependencies.map(d=>d.revision),[2]);
 const parent=select(packet,['parent-map']);assert.equal(parent.figmaMappingRecords.manuals.length,2);assert.deepEqual(parent.figmaMappingRecords.profiles.sourceDependencies.map(d=>d.revision),[1,2]);
});

function profile(source,contract){return{componentId:source.manual.component.componentId,revision:source.manual.metadata.revision,manualSemanticHash:runtime.contractHash(source.manual),compiledSemanticHash:runtime.contractHash(contract),dependencyPins:runtime.collectContractDependencies(contract)};}
function mapping(sourceDependencies){return{semantic:{schemaVersion:'apollo.agent-figma-semantic-mapping.v1',mappings:[]},typed:{schemaVersion:'apollo.agent-figma-typed-native-binding-input.v1',bindings:[]},profiles:{choices:[],profiles:[],sourceDependencies,actualPartDefinitions:[]},targets:{profiles:[]},manuals:[],ruleLinks:{links:[]},denials:[]};}

test('data semantic facade preserves source identity and refuses changed choices, keys and logical ports',()=>{
 const {dataSemanticFacade}=require('../src/data-packages/generation');
 const record={mappingId:'fixture.mapping',componentId:'fixture',choices:['choice'],ports:{Body:{kind:'slot',domain:['a']}}};
 const original={schemaVersion:'apollo.agent-figma-semantic-mapping.v1',sourceHash:'a'.repeat(64),mappings:[record]};
 const native={mappings:[{id:'choice',componentKey:'published-key',properties:{Size:'S'},rootCreateAllowed:true}],genericMapping:{semantic:{mappings:[structuredClone(record)]},profiles:{choices:[{id:'choice',key:'published-key',properties:{Size:'S'}}]}}};
 const options={semantic:original,native,source:{choices:[]},base:{mappings:[]},compatibility:'b'.repeat(64),dataDigest:'c'.repeat(64),pin:{file:'generation/pinned.json',sha256:'d'.repeat(64),bytes:123}};
 const before=structuredClone(original),facade=dataSemanticFacade(options);
 assert.deepEqual(original,before);assert.equal(facade.sourceHash,options.compatibility);assert.equal(facade.sourceRecord.originalSourceHash,original.sourceHash);assert.equal(facade.sourceRecord.sha256,options.pin.sha256);assert.equal(facade.dataDigest,options.dataDigest);assert.deepEqual(facade.mappings,original.mappings);
 for(const mutate of [o=>o.semantic.mappings[0].choices=['invented'],o=>o.native.mappings[0].componentKey='replaced',o=>o.native.mappings=[],o=>o.semantic.mappings[0].ports.Body.domain=['invented'],o=>o.native.genericMapping.semantic.mappings[0].componentId='other',o=>o.native.mappings.push(structuredClone(o.native.mappings[0])),o=>o.native.genericMapping.profiles.choices.push(structuredClone(o.native.genericMapping.profiles.choices[0])),o=>o.native.genericMapping.semantic.mappings.push(structuredClone(o.native.genericMapping.semantic.mappings[0]))]){
  const invalid=structuredClone(options);mutate(invalid);assert.throws(()=>dataSemanticFacade(invalid),{code:'DATA_SEMANTIC_MAPPING_INVALID'});
 }
 const legacy=structuredClone(options);legacy.base.mappings=legacy.native.genericMapping.semantic.mappings;legacy.source.choices=legacy.native.genericMapping.profiles.choices;delete legacy.native.genericMapping;
 assert.deepEqual(dataSemanticFacade(legacy).mappings,original.mappings);
});

test('first portable profile preserves normal checking/MCP readers and exact closure while explicitly deferring frontend SDK',async t=>{
 const {projectPortableData,PORTABLE_PROFILE}=require('../scripts/build-data-release');
 const {dir,root}=setup(t),source=fixture.source(),sdk=path.join(dir,'private-sdk.js');
 fs.writeFileSync(sdk,"throw Error('SDK_PROOF_MUST_NOT_EXECUTE');");
 const sdkBytes=fs.readFileSync(sdk),genericMapping=mapping([profile(source,runtime.loadAuthoringSource(source).contract)]);
 await importDataPackage({root,apolloRoot,packages:[zip(dir,source)],seed:{native:{sourceHash:require(path.join(app,'dist/agent-figma-postconditions.cjs')).SOURCE_HASH,mappings:[],genericMapping},semantic:genericMapping.semantic,frontend:{target:'frontend',context:{proof:{path:sdk,sha256:sha(sdkBytes),bytes:sdkBytes.length}},bindings:[]}}});
 const before=fs.readFileSync(path.join(root,'manifest.json')),parent=JSON.parse(before),output=path.join(dir,'portable');
 const result=await projectPortableData({dataRoot:root,runtimeRoot:path.relative(process.cwd(),apolloRoot),output});
 assert.equal(result.index.parentDataId,parent.id);assert.notEqual(result.index.id,parent.id);assert.equal(result.index.deliveryProfile,PORTABLE_PROFILE);
 assert.equal(result.index.capabilities.frontend,false);assert(result.index.catalog.every(row=>row.frontend.status==='unavailable'));
 assert.equal(result.index.generation.frontend,undefined);assert.equal(result.index.generation.bindings,undefined);
 const data=readGenerationData({root:output,apolloRoot});assert.equal(data.assertCurrent,data.owned.assertCurrent);data.assertCurrent();assert.equal(data.contracts.length,1);data.owned.targets.assertMcpComposition({platform:'desktop',nodes:[]});
 for(const contract of data.index.contracts)data.reader.read(contract.archive);
 const files=[];function walk(folder){for(const item of fs.readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,item.name);item.isDirectory()?walk(file):files.push(file);}}walk(output);
 assert.deepEqual(files.sort(),[path.join(output,'manifest.json'),...data.reader.pins.keys()].sort());
 assert(files.every(file=>['.json','.zip'].includes(path.extname(file))));assert.equal(files.some(file=>fs.readFileSync(file).equals(sdkBytes)),false);
 const previous=process.env.APOLLO_DATA_ROOT;process.env.APOLLO_DATA_ROOT=output;
 try{
  const read=require('../src/generation-agent/prompt-target-context').createPromptTargetReader({loadProvider:()=>({apolloRoot,hash:runtime.contractHash,readPromptContext:async input=>({data,packet:data.prompt(input.platform),assertCurrent:data.assertCurrent})})});
  await assert.rejects(read({platform:'desktop'},'frontend'),{code:'AGENT_FRONTEND_CAPABILITY_UNAVAILABLE'});
  const host=require('../src/generation-agent/agent-runtime').createConfiguredAgentRuntime({environment:{},providerFactory(){throw Error('SDK must not load');}});
  await assert.rejects(host.loadService(),{code:'AGENT_FRONTEND_CAPABILITY_UNAVAILABLE'});
 }finally{if(previous===undefined)delete process.env.APOLLO_DATA_ROOT;else process.env.APOLLO_DATA_ROOT=previous;}
 assert.deepEqual(fs.readFileSync(path.join(root,'manifest.json')),before);
});
test('explicit mapping upgrades prune only unreferenced versions and keep old pinned children',async t=>{
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'apollo-mapping-upgrade-'))),root=path.join(dir,'data');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const n=fixture.nested(),oldHost=profile(n.source,n.host),oldChild=profile(n.childSource,n.child),genericMapping=mapping([oldHost,oldChild]);
 await importDataPackage({root,apolloRoot,packages:[zip(dir,n.source,'host.zip',n.host),zip(dir,n.childSource,'child.zip',n.child)],seed:{native:{mappings:[],sourceHash:require(apolloRoot+'/dist/agent-figma-postconditions.cjs').SOURCE_HASH,genericMapping},semantic:genericMapping.semantic}});
 n.childSource.manual.metadata.revision++;
 const child=runtime.loadAuthoringSource(n.childSource).contract,newChild=profile(n.childSource,child),childMap=path.join(dir,'child-map.json');fs.writeFileSync(childMap,JSON.stringify(mapping([newChild])));
 await importDataPackage({root,apolloRoot,packages:[zip(dir,n.childSource,'child2.zip',child)],figma:[childMap]});
 let loaded=readGenerationData({root,apolloRoot});assert.deepEqual(loaded.native.genericMapping.profiles.sourceDependencies.filter(d=>d.componentId===newChild.componentId).map(d=>d.revision),[1,2]);
 n.source.manual.metadata.revision++;Object.assign(n.source.manual.componentDependencies[0],{revision:newChild.revision,manualSourceHash:newChild.manualSemanticHash,compiledHash:newChild.compiledSemanticHash});
 const host=JSON.parse(JSON.stringify(core.compileManualSource(n.source.manual,n.source.variantEvidence,[child]).contract)),newHost=profile(n.source,host),file=zip(dir,n.source,'host2.zip',host),prior=fs.readFileSync(path.join(root,'manifest.json'));
 await assert.rejects(importDataPackage({root,apolloRoot,packages:[file]}),/DATA_MAPPING_CONTRACT_STALE/);assert.deepEqual(fs.readFileSync(path.join(root,'manifest.json')),prior);
 const hostMap=path.join(dir,'host-map.json');fs.writeFileSync(hostMap,JSON.stringify(mapping([newHost,newChild])));
 await importDataPackage({root,apolloRoot,packages:[file],figma:[hostMap]});loaded=readGenerationData({root,apolloRoot});
 assert.deepEqual(loaded.native.genericMapping.profiles.sourceDependencies.map(d=>[d.componentId,d.revision]).sort(),[[newHost.componentId,2],[newChild.componentId,2]].sort());
 const final=fs.readFileSync(path.join(root,'manifest.json'));
 for(const fake of [{...newChild,revision:99},{...newChild,compiledSemanticHash:'0'.repeat(64)},{...oldChild}]){
  fs.writeFileSync(childMap,JSON.stringify(mapping([fake])));
  await assert.rejects(importDataPackage({root,apolloRoot,figma:[childMap]}),/DATA_MAPPING_CONTRACT_STALE/);assert.deepEqual(fs.readFileSync(path.join(root,'manifest.json')),final);
 }
 loaded.assertCurrent();
});

test('manual pruning preserves pinned child versions and active aliases, rejecting stale authority atomically',async t=>{
 const {dir,root}=setup(t),n=fixture.nested();
 const record=(manual,name)=>{const file=path.join(dir,name);fs.writeFileSync(file,JSON.stringify(manual));const b=fs.readFileSync(file);return{pin:{path:file,sha256:sha(b),bytes:b.length},manual};};
 const host1=record(n.source.manual,'host1.json'),child1=record(n.childSource.manual,'child1.json'),genericMapping=mapping([profile(n.source,n.host),profile(n.childSource,n.child)]);genericMapping.manuals=[host1,child1];
 await importDataPackage({root,apolloRoot,packages:[zip(dir,n.source,'host1.zip',n.host),zip(dir,n.childSource,'child1.zip',n.child)],seed:{native:{mappings:[],sourceHash:require(path.join(app,'dist/agent-figma-postconditions.cjs')).SOURCE_HASH,genericMapping},semantic:genericMapping.semantic}});
 const child2Source=structuredClone(n.childSource);child2Source.manual.metadata.revision=2;const child2Contract=runtime.loadAuthoringSource(child2Source).contract,child2=record(child2Source.manual,'child2.json'),childMap=mapping([profile(child2Source,child2Contract)]),mapFile=path.join(dir,'mapping.json');childMap.manuals=[child2];fs.writeFileSync(mapFile,JSON.stringify(childMap));
 await importDataPackage({root,apolloRoot,packages:[zip(dir,child2Source,'child2.zip',child2Contract)],figma:[mapFile]});
 let data=readGenerationData({root,apolloRoot});assert.deepEqual(data.native.genericMapping.manuals.filter(m=>m.manual.component.componentId===child1.manual.component.componentId).map(m=>m.manual.metadata.revision).sort(),[1,2]);
 const host2Source=structuredClone(n.source);host2Source.manual.metadata.revision=2;const host2Contract=runtime.loadAuthoringSource(host2Source).contract,host2=record(host2Source.manual,'host2.json'),hostMap=mapping([profile(host2Source,host2Contract)]);hostMap.manuals=[host2];fs.writeFileSync(mapFile,JSON.stringify(hostMap));
 await importDataPackage({root,apolloRoot,packages:[zip(dir,host2Source,'host2.zip',host2Contract)],figma:[mapFile]});
 data=readGenerationData({root,apolloRoot});assert.equal(data.native.genericMapping.manuals.length,3);assert(!data.native.genericMapping.manuals.some(m=>m.manual.component.componentId===host1.manual.component.componentId&&m.manual.metadata.revision===1));
 const alias=mapping([]),RuleID=host1.manual.rules[0].id;alias.manuals=[host1];alias.typed.bindings=[{mappingId:'legacy-proof',port:'root',type:'BOOLEAN',normativeSource:{...host1.pin,pointer:'/rules/0',RuleIDs:[RuleID]}}];alias.ruleLinks.links=[{RuleID,source:host1.pin}];fs.writeFileSync(mapFile,JSON.stringify(alias));
 await importDataPackage({root,apolloRoot,figma:[mapFile]});data=readGenerationData({root,apolloRoot});assert(data.native.genericMapping.manuals.some(m=>m.manual.component.componentId===host1.manual.component.componentId&&m.manual.metadata.revision===1));
 assert.equal(require(path.join(app,'src/generation/agent/figma/mapping')).createMappingAdapter(data.native.genericMapping).port('legacy-proof','root').type,'BOOLEAN');
 const current=fs.readFileSync(path.join(root,'manifest.json'));alias.typed.bindings[0].normativeSource.sha256='0'.repeat(64);fs.writeFileSync(mapFile,JSON.stringify(alias));
 await assert.rejects(importDataPackage({root,apolloRoot,figma:[mapFile]}),/DATA_REFERENCE_STALE/);assert.deepEqual(fs.readFileSync(path.join(root,'manifest.json')),current);data.assertCurrent();
});

test('embedded manual authority keeps an omitted pointer wildcard and preserves ambiguity',async t=>{
 for(const count of [1,2])await t.test(`${count} embedded authority records`,async t=>{
  const {dir,root}=setup(t),source=fixture.source(),manual=structuredClone(source.manual);manual.metadata.revision=99;
  const file=path.join(dir,'embedded.json');fs.writeFileSync(file,JSON.stringify({first:manual,second:manual}));const bytes=fs.readFileSync(file),pin={path:file,sha256:sha(bytes),bytes:bytes.length},genericMapping=mapping([]),RuleID=manual.rules[0].id;
  genericMapping.manuals=[{pin,manualPointer:'/first',manual},...(count===2?[{pin,manualPointer:'/second',manual}]:[])];
  genericMapping.typed.bindings=[{mappingId:'embedded-proof',port:'root',type:'BOOLEAN',normativeSource:{...pin,pointer:'/rules/0',RuleIDs:[RuleID]}}];genericMapping.ruleLinks.links=[{RuleID,source:pin}];
  await importDataPackage({root,apolloRoot,packages:[zip(dir,source)],seed:{native:{mappings:[],sourceHash:require(path.join(app,'dist/agent-figma-postconditions.cjs')).SOURCE_HASH,genericMapping},semantic:genericMapping.semantic}});
  const data=readGenerationData({root,apolloRoot});assert.equal(data.native.genericMapping.manuals.length,count);
  const adapter=require(path.join(app,'src/generation/agent/figma/mapping')).createMappingAdapter(data.native.genericMapping);
  if(count===1)assert.equal(adapter.port('embedded-proof','root').type,'BOOLEAN');else assert.throws(()=>adapter.port('embedded-proof','root'),/FIGMA_PORT_AUTHORITY_UNAVAILABLE/);
 });
});
