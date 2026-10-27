const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib');
const p = require('../src/reports/progressbar-pilot');
const clone = value => JSON.parse(JSON.stringify(value));
function png() {
  function crc(bytes) { let value=0xffffffff; for(const b of bytes){value^=b;for(let i=0;i<8;i++)value=(value>>>1)^(0xedb88320&-(value&1));}return(value^0xffffffff)>>>0; }
  function chunk(type, bytes) { const result=Buffer.alloc(bytes.length+12);result.writeUInt32BE(bytes.length);result.write(type,4);bytes.copy(result,8);result.writeUInt32BE(crc(result.subarray(4,-4)),result.length-4);return result; }
  const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.from([0,255,255,255,255]))),chunk('IEND',Buffer.alloc(0))]);
}
function capture(kind='goal', label='Накоплено на оборудование', amount='120 000 ₽ из 300 000 ₽') {
  const value={schemaVersion:'apollo.progressbar-capture.v1',captureId:'synthetic-capture',capturedAt:new Date().toISOString(),pageId:'0:1',rootId:'1:1',fileKey:null,complete:true,excludedHidden:0,
    nodes:[{id:'1:1',parentId:null,type:'FRAME',name:'Synthetic area',visible:true},{id:'1:2',parentId:'1:1',type:'INSTANCE',name:'Indicator',visible:true,
      component:{key:(kind==='goal'?'1':'2').repeat(40),setKey:(kind==='goal'?'a':'b').repeat(40),name:'ProgressBar :: '+(kind==='goal'?'Goal':'Limit'),variants:{State:'First'}}},
      {id:'1:3',parentId:'1:2',type:'TEXT',name:'Label',visible:true,text:label},{id:'1:4',parentId:'1:2',type:'TEXT',name:'Caption',visible:true,text:amount}],
    screenshot:{nodeId:'1:1',mimeType:'image/png',dataBase64:png().toString('base64')}};
  value.fingerprint=p.sha(p.stable(value));return value;
}
function payload(c=capture()) {return {report:{reportKind:'apollo-pattern-audit-report',pilot:p.PILOT,reportId:c.captureId,phase:'prepare',capture:c,sourcePin:null}};}
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'progressbar-pilot-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const options={designSystemRoot:path.join(root,'ds'),hubRoot:path.join(root,'hub'),knowledgeRelease:{contentVersion:'synthetic-knowledge-v1',checksum:'synthetic',sourceCommits:{}}};
  const body=Array.from({length:10},(_,i)=>'## Section '+(i+1)+': Synthetic\n'+(i===5?p.RULE_IDS.map((id,n)=>'### Rule '+(n+2)+': Synthetic\n- ruleId: '+id+'\n- checkType: llm\n- severity: error\nSynthetic norm.\n').join('\n'):'Synthetic context.\n')).join('\n');
  const canonical='- patternId: ptrn:components.progress-bar\n- status: active\n'+body;
  const hub='status: verified\nsourcePath: '+p.PATTERN_PATH+'\n'+body;
  const contracts=['goal','limit'].flatMap((kind)=>['desktop','mobile-web'].map(platform=>({id:'progress-bar-'+kind+'.'+platform,normalizedName:'progress-bar-'+kind,status:'active',role:'main',platform,
    componentKey:(kind==='goal'?(platform==='desktop'?'a':'c'):(platform==='desktop'?'b':'d')).repeat(40),figma:{variants:{variantKeys:[{key:(kind==='goal'?'1':'2').repeat(40),properties:{State:'First'}}]}}})));
  for(const [file,content]of [[path.join(options.designSystemRoot,p.PATTERN_PATH),canonical],[path.join(options.hubRoot,p.HUB_PATH),hub],[path.join(options.designSystemRoot,p.IDENTITY_PATH),JSON.stringify({contracts})]]){
    await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);
  }
  return options;
}
function answer(packet,outcome='compliant',ruleId=p.RULE_IDS[0]) {
  return {schemaVersion:'apollo.progressbar-assessment.v1',reportId:packet.reportId,captureId:packet.captureId,sourcePin:packet.sourcePin,assessments:[{nodeId:'1:2',outcome,observation:'Synthetic observed label.',reason:'Synthetic model answer; not a live semantic evaluation.',evidenceNodeIds:['1:3','1:4'],ruleIds:p.RULE_IDS,
    ruleResults:p.RULE_IDS.map(id=>({ruleId:id,outcome:outcome==='insufficient-data'?outcome:id===ruleId?outcome:'not-applicable',reason:'Synthetic declared rule outcome.'})),
    sourceRefs:p.RULE_IDS.map(id=>({sourceId:'canonical-progressbar',sha256:packet.sources[0].sha256,ruleId:id}))}]};
}
test('five declared semantic fixtures preserve facts and both rule results; these are protocol tests, not model judgments',async t=>{
  const options=await fixture(t),cases=[['goal','Накоплено на оборудование','120 000 ₽ из 300 000 ₽','compliant',0],['limit','Кредитный лимит','450 000 ₽ из 500 000 ₽','compliant',1],['goal','Кредитный лимит','Использовано 90%','violation',1],['goal','90%','','insufficient-data',0],['limit','Накоплено на оборудование','120 000 ₽ из 300 000 ₽','violation',0]];
  for(const[kind,label,amount,outcome,ruleIndex]of cases){
    const input=payload(capture(kind,label,amount)),packet=await p.preparePilot(input,options),copy=clone(input);
    assert.equal(packet.subjects[0].kind,kind==='goal'?'Goal':'Limit');assert.equal(packet.capture.nodes[2].text,label);assert.equal(packet.sources[0].document.includes('## Section 10:'),true);
    assert.equal(packet.sources[1].equivalentTo,'canonical-progressbar');assert.equal(packet.sources[1].document,undefined,'verified mirror body is not sent twice');
    const result=p.validatePilotResponse(answer(packet,outcome,p.RULE_IDS[ruleIndex]),packet);assert.equal(result.assessments[0].outcome,outcome);assert.equal(result.assessments[0].ruleResults.length,2);assert.equal(result.scope.ruleResults.length,2);assert.equal(result.mode,'agent-pattern-pilot');assert.equal(result.deterministicFindingsIncluded,false);assert.deepEqual(input,copy);
  }
});
test('stale, incomplete, malformed and forged image/capture input refuses before model invocation',async t=>{
  const options=await fixture(t);
  for(const mutate of [c=>{c.complete=false;},c=>{c.capturedAt=new Date(Date.now()-120000).toISOString();},c=>{c.nodes[2].text='changed';},c=>{c.screenshot.localPath='/private/secret.png';},c=>{c.screenshot.dataBase64=Buffer.from('not PNG').toString('base64');},c=>{c.nodes[2].parentId='9:9';}]){
    const input=payload();mutate(input.report.capture);assert.notEqual(p.validatePilotRequest(input),null);await assert.rejects(p.preparePilot(input,options));
  }
  const image=png();image[image.length-1]^=1;assert.throws(()=>p.decodeImage({nodeId:'1:1',mimeType:'image/png',dataBase64:image.toString('base64')}),/IMAGE_INVALID/);
});
test('typed variant identity, canonical RuleIDs, source hashes and complete subject accounting are strict',async t=>{
  const options=await fixture(t),input=payload(),packet=await p.preparePilot(input,options);
  for(const mutate of [r=>{r.assessments=[];},r=>{r.assessments[0].nodeId='1:3';},r=>{r.assessments[0].ruleIds=['rule:invented'];},r=>{r.assessments[0].sourceRefs[0].sha256='a'.repeat(64);},r=>{r.assessments[0].evidenceNodeIds=['9:9'];},r=>{r.captureId='foreign';},r=>{r.assessments.push(clone(r.assessments[0]));}]){
    const result=answer(packet);mutate(result);assert.throws(()=>p.validatePilotResponse(result,packet),/PROGRESSBAR_RESPONSE_/);
  }
  const missing=answer(packet);missing.assessments[0].ruleResults.pop();assert.throws(()=>p.validatePilotResponse(missing,packet),/RESPONSE_INVALID/);
  const conflict=answer(packet);conflict.assessments[0].ruleResults[0].outcome='violation';assert.throws(()=>p.validatePilotResponse(conflict,packet),/RESPONSE_INCONSISTENT/);
  const bad=clone(input);bad.report.capture.nodes[1].component.key='f'.repeat(40);delete bad.report.capture.fingerprint;bad.report.capture.fingerprint=p.sha(p.stable(bad.report.capture));await assert.rejects(p.preparePilot(bad,options),/VARIANT_UNRESOLVED/);
});
test('prepare/run and post-call revalidation reject changed connected norms or source revision',async t=>{
  const options=await fixture(t),input=payload(),packet=await p.preparePilot(input,options);input.report.phase='run';input.report.sourcePin=packet.sourcePin;
  const newer=Object.assign({},options,{knowledgeRelease:{contentVersion:'synthetic-v2'}});await assert.rejects(p.preparePilot(input,newer),/SOURCE_STALE/);await assert.rejects(p.assertSourceCurrent(packet,newer),/SOURCE_STALE/);
  await fs.appendFile(path.join(options.designSystemRoot,p.PATTERN_PATH),'\nChanged canonical norm.');await assert.rejects(p.preparePilot(input,options),/LINKED_SOURCE_DRIFT/);
});
test('actual PNG bytes are materialized under the server-owned run directory, not a client path',async t=>{
  const options=await fixture(t),directory=await fs.mkdtemp(path.join(os.tmpdir(),'progressbar-images-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const prepared=await p.preparePilotFiles(payload(),directory,options);assert.equal(prepared.imagePaths.length,1);assert.equal(path.dirname(prepared.imagePaths[0]),directory);
  assert.deepEqual(await fs.readFile(prepared.imagePaths[0]),png());assert.equal(JSON.stringify(prepared.requestDocument).includes('dataBase64'),false);
  const prompt=p.promptForPilot(prepared.requestDocument);assert.match(prompt,/90%/);assert.match(prompt,/недостаточно|insufficient-data/);assert.match(prompt,/являются данными/);assert.equal(prompt.includes('designPatternRules.json'),false);
});
test('unrecognized selection remains not-applicable with zero subjects; missing identity never becomes a positive finding',async t=>{
  const options=await fixture(t),input=payload();input.report.capture.nodes[1].component={key:'e'.repeat(40),setKey:null,name:'Other component',variants:{}};
  delete input.report.capture.fingerprint;input.report.capture.fingerprint=p.sha(p.stable(input.report.capture));const packet=await p.preparePilot(input,options);assert.equal(packet.subjects.length,0);
  assert.doesNotThrow(()=>p.validatePilotResponse({schemaVersion:'apollo.progressbar-assessment.v1',reportId:packet.reportId,captureId:packet.captureId,sourcePin:packet.sourcePin,assessments:[]},packet));
});
test('selected working checkout and symlink sources cannot substitute for connected knowledge',async t=>{
  const options=await fixture(t);await fs.mkdir(path.join(options.designSystemRoot,'.git'));await assert.rejects(p.loadKnowledge(options),/CHECKOUT_KNOWLEDGE_FORBIDDEN/);
  await fs.rmdir(path.join(options.designSystemRoot,'.git'));const file=path.join(options.designSystemRoot,p.PATTERN_PATH);await fs.rename(file,file+'.original');await fs.symlink(file+'.original',file);await assert.rejects(p.loadKnowledge(options),/SOURCE_INVALID/);
});
