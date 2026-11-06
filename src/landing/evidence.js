'use strict';
const crypto=require('node:crypto');
const nativeState=require('./native-state');
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code,status:409});};
function validateNative(readback,target){
 const native=readback.native;if(native===undefined)return;
 if(!native||!['apollo.landing-native.v1','apollo.landing-native.v2'].includes(native.schemaVersion)||!Array.isArray(native.nodes)||native.nodes.length!==readback.nodeCount||native.nodes.length>nativeState.MAX_NODES)fail('LANDING_READBACK_INVALID');
 if(nativeState.isV2(native)&&native.nodes[0]?.parentId!==(target.parentNodeId||target.pageId))fail('LANDING_READBACK_INVALID');
 if(nativeState.isV2(native)&&(!native.modeDefaults||typeof native.modeDefaults!=='object'||Array.isArray(native.modeDefaults)||Object.keys(native.modeDefaults).length>128||Object.entries(native.modeDefaults).some(([id,mode])=>!id||id.length>512||['__proto__','prototype','constructor'].includes(id)||typeof mode!=='string'||!mode||mode.length>128)))fail('LANDING_READBACK_INVALID');
 const seen=new Set();
 for(const [index,row]of native.nodes.entries()){
  if(!row||typeof row.id!=='string'||!/^[\w:;-]{1,512}$/.test(row.id)||seen.has(row.id)||typeof row.type!=='string'||typeof row.name!=='string'||typeof row.role!=='string'||index===0&&(row.id!==target.rootNodeId||row.type!=='FRAME')||index>0&&!seen.has(row.parentId))fail('LANDING_READBACK_INVALID');
  seen.add(row.id);
 }
 if(readback.sections.some(section=>!native.nodes.some(n=>n.id===section.id&&n.sectionId===section.sectionId)))fail('LANDING_READBACK_INVALID');
}
function screenshot(event,state,modelStep){
 const item=event.item;
 if(event.type!=='item.completed'||item?.tool!=='get_screenshot'||item.status!=='completed'||item.error||item.result?.isError)return null;
 let args=item.arguments;try{if(typeof args==='string')args=JSON.parse(args);}catch{return null;}
 const nodeId=args?.nodeId||args?.node_id,images=(Array.isArray(item.result?.content)?item.result.content:[]).filter(row=>row.type==='image'&&typeof row.data==='string'&&row.data.length);
 if(typeof nodeId!=='string'||!/^[-\w:;]{1,512}$/.test(nodeId))return null;
 return {modelStep,callId:item.id,nodeId,sectionId:state.activeSectionId,images:images.map(row=>({mimeType:row.mimeType||null,sha256:crypto.createHash('sha256').update(Buffer.from(row.data,'base64')).digest('hex'),bytes:Buffer.from(row.data,'base64').length})),origin:'mcp-delivery'};
}
function renderHash(readback,nodeId){const section=readback.sections.find(s=>s.id===nodeId);return sha((readback.native?.nodes||[]).filter(n=>nodeId===readback.rootNodeId||n.sectionId===section?.sectionId));}
function assess(record,result){
 const nodes=record.readback.native?.nodes;if(!nodes)fail('LANDING_NATIVE_EVIDENCE_REQUIRED');
 const byId=new Map(nodes.map(n=>[n.id,n])),hosts=nodes.filter(n=>n.role==='host'),bodies=nodes.filter(n=>n.role==='body');
 const descendant=(child,ancestor)=>{for(let n=child;n;n=byId.get(n.parentId)){if(n.id===ancestor.id)return true;}return false;};
 const staged=record.source?.workflow===require('./checkpoints').WORKFLOW,foundation=staged?require('./checkpoints').foundationNodes(record.spec,record.readback):null;
 const host=staged?foundation?.container:hosts[0],body=staged?foundation?.mount:bodies[0],expected=record.spec.host?.componentKey;
 const hostValid=staged?!!foundation:hosts.length===1&&host.type==='INSTANCE'&&typeof expected==='string'&&expected.length>0&&(host.componentKey===expected||host.componentSetKey===expected);
 const contained=hostValid&&(staged||bodies.length===1&&body.type==='SLOT')&&descendant(body,host)&&record.spec.sections.every(s=>descendant(byId.get(s.nodeId),body));
 const order=nodes.filter(n=>record.spec.sections.some(s=>s.nodeId===n.id)).map(n=>n.id),expectedOrder=record.spec.sections.map(s=>s.nodeId);
 if(!contained||JSON.stringify(order)!==JSON.stringify(expectedOrder))fail('LANDING_RESULT_INCOMPLETE');
 const screenshots=record.execution.screenshots||[],reviews=Array.isArray(result.visualReviews)?result.visualReviews:[];
 const scopes=record.spec.sections.map(s=>({id:s.id,nodeId:s.nodeId})).concat({id:'page',nodeId:record.target.rootNodeId});
 const visual=scopes.map(scope=>{
  const proofFor=review=>screenshots.find(s=>s.callId===review.callId&&s.modelStep===review.modelStep&&s.nodeId===scope.nodeId&&s.images.length&&!s.superseded&&s.readbackHash&&s.nativeHash===renderHash(record.readback,s.nodeId)&&s.fingerprints&&record.readback.sections.every(row=>s.nodeId!==record.target.rootNodeId&&row.id!==s.nodeId||s.fingerprints[row.id]===row.fingerprint));
  const review=reviews.slice().reverse().find(r=>r?.scope===scope.id&&['PASS','FAIL','UNKNOWN'].includes(r.verdict)&&typeof r.evidence==='string'&&r.evidence.trim()&&r.evidence.length<=2000&&proofFor(r));
  const proof=review&&proofFor(review);
  return {scope:scope.id,verdict:proof?review.verdict:'UNKNOWN',origin:'agent-visual-report',evidence:proof?review.evidence:'No matching delivered image and review for the current fingerprint',screenshot:proof||null};
 });
 const checks=Array.isArray(result.checks)?result.checks:[],critical=checks.filter(c=>c?.critical!==false),normsComplete=critical.length>0&&critical.every(c=>c.verdict==='PASS'&&typeof c.evidence==='string'&&c.evidence.trim());
 const missingFonts=nodes.filter(n=>n.type==='TEXT'&&n.hasMissingFont===true).map(n=>n.id);
 const unknownFonts=nodes.filter(n=>n.type==='TEXT'&&(n.hasMissingFont!==false||!n.fontName||n.fontName==='FIGMA_MIXED')).map(n=>n.id);
 const visualComplete=visual.every(v=>v.verdict==='PASS');
 return {complete:normsComplete&&visualComplete&&!missingFonts.length&&!unknownFonts.length,structure:{verdict:'PASS',origin:'host-native',hostNodeId:host.id,hostComponentKey:host.componentKey,bodyNodeId:body.id,sectionIds:expectedOrder,readbackHash:sha(record.readback)},norms:{verdict:normsComplete?'PASS':'UNKNOWN',origin:'agent-report'},visual,missingFonts,unknownFonts,ownerAcceptance:'PENDING',limits:['Native facts prove recorded structure and values, not all design-system norms or visual judgement.','MCP image delivery and an agent review are recorded separately; owner acceptance is pending.']};
}
module.exports={validateNative,screenshot,assess,renderHash};
