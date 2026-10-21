'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {budget}=require('./usage');
const {failureDiagnostic,readFailure}=require('./failure-diagnostic');
const {MCP_MAX_TOOL_CALLS,MCP_TOOL_TIMEOUT_MS}=require('./agent-cli');
const {createRecipeCatalog}=require('./recipe-catalog');
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status});};
const clone=v=>JSON.parse(JSON.stringify(v));
const PROFILE='experimental-mcp-owned-root-post-readback';
const LIMITS=Object.freeze({execInvocations:8,contextRequests:2,toolCalls:MCP_MAX_TOOL_CALLS,toolsPerExec:MCP_MAX_TOOL_CALLS,toolOutputBytes:65536,toolOutputsPerExecBytes:65536,toolMs:MCP_TOOL_TIMEOUT_MS,execMs:300000,runMs:900000});

// Standalone JavaScript recipes shipped to the MCP worker, with no workspace dependency.
function boundedMcpResult(value){const bytes=encodeURIComponent(JSON.stringify(value)).replace(/%[0-9A-F]{2}/g,'x').length;if(bytes>12000)throw Error('MCP_RESULT_SCOPE_TOO_LARGE: return fewer mapped fields or split the read');return value;}
async function createMcpInstance(component,expectedKey,parent,createdIds,mutatedIds){
 figma.skipInvisibleInstanceChildren=false;if(figma.skipInvisibleInstanceChildren!==false)throw Error('MCP_SOURCE_TRAVERSAL_UNKNOWN');
 if(component.type!=='COMPONENT'||component.key!==expectedKey)throw Error('MCP_SOURCE_KEY_MISMATCH');
 if(!Array.isArray(createdIds)||!Array.isArray(mutatedIds)||typeof parent?.appendChild!=='function')throw Error('MCP_INSTANCE_TRACKING_UNKNOWN');
 const fonts=new Map(),queue=[component],modes=JSON.parse(JSON.stringify(component.explicitVariableModes||{})),collections=[];let count=0;
 if(Object.keys(modes).length>64)throw Error('MCP_SOURCE_SCOPE_TOO_LARGE');
 for(const [id,mode]of Object.entries(modes)){const collection=await figma.variables.getVariableCollectionByIdAsync(id);if(!collection||!collection.modes.some(m=>m.modeId===mode))throw Error('MCP_SOURCE_MODE_UNKNOWN');collections.push([collection,mode]);}
 while(queue.length){const n=queue.shift();if(++count>512)throw Error('MCP_SOURCE_SCOPE_TOO_LARGE');
  if(n.type==='TEXT')for(const segment of n.getStyledTextSegments(['fontName'])){
   const font=segment.fontName;fonts.set(JSON.stringify(font),font);
   const bindings=n.boundVariables?.fontFamily||[];
   for(const alias of Array.isArray(bindings)?bindings:[bindings]){const variable=await figma.variables.getVariableByIdAsync(alias.id);if(!variable)throw Error('MCP_SOURCE_FONT_VARIABLE_UNKNOWN');for(const family of Object.values(variable.valuesByMode)){if(typeof family!=='string')throw Error('MCP_SOURCE_FONT_VARIABLE_UNKNOWN');const value={family,style:font.style};fonts.set(JSON.stringify(value),value);}}
  }
  if('children'in n)queue.push(...n.children);
 }
 if(fonts.size>32)throw Error('MCP_SOURCE_SCOPE_TOO_LARGE');for(const font of fonts.values())await figma.loadFontAsync(font);
 const instance=component.createInstance();createdIds.push(instance.id,...instance.findAll().map(n=>n.id));mutatedIds.push(parent.id,instance.id);parent.appendChild(instance);
 // Preserve component-owned transitions; ambient library modes must inherit from the new scene.
 for(const [collection,mode]of collections)instance.setExplicitVariableModeForCollection(collection,mode);
 for(const [collection,mode]of collections)if(instance.resolvedVariableModes[collection.id]!==mode)throw Error('MCP_SOURCE_MODE_MISMATCH');
 return instance;
}
async function readMcpSourceFacts(component,expectedKey){
 figma.skipInvisibleInstanceChildren=false;if(figma.skipInvisibleInstanceChildren!==false)throw Error('MCP_SOURCE_TRAVERSAL_UNKNOWN');
 if(component.type!=='COMPONENT'||component.key!==expectedKey)throw Error('MCP_SOURCE_KEY_MISMATCH');
 const owner=component.parent?.type==='COMPONENT_SET'?component.parent:component;
 if(component.children.length>64)throw Error('MCP_READ_SCOPE_TOO_LARGE');
 const children=[];for(const node of component.children){const row={id:node.id,type:node.type,name:node.name};if('componentPropertyReferences'in node)row.refs=node.componentPropertyReferences;
  if(node.type==='INSTANCE'){row.mainKey=(await node.getMainComponentAsync())?.key||null;row.properties=Object.entries(node.componentProperties).map(([name,p])=>({name,type:p.type,value:p.value}));}
  if(node.type==='SLOT'){if(node.children.length>64)throw Error('MCP_READ_SCOPE_TOO_LARGE');row.children=node.children.map(child=>({id:child.id,type:child.type,name:child.name}));}children.push(row);
 }
 return boundedMcpResult({scope:'direct-children-and-slot-payload-ids',subtreeComplete:false,id:component.id,key:component.key,type:component.type,width:component.width,height:component.height,variants:component.variantProperties,definitions:Object.entries(owner.componentPropertyDefinitions).map(([name,p])=>({name,type:p.type,defaultValue:p.defaultValue,variantOptions:p.variantOptions})),children});
}
async function compareMcpDefaults(source,instance){
 figma.skipInvisibleInstanceChildren=false;if(figma.skipInvisibleInstanceChildren!==false)throw Error('MCP_SOURCE_TRAVERSAL_UNKNOWN');
 const differences=[],contextualGeometry=[],queue=[{a:source,b:instance,path:'default',root:true,flow:false}];let nodesCompared=0;
 const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
 while(queue.length){const {a,b,path,root,flow}=queue.shift();if(++nodesCompared>512)throw Error('MCP_SOURCE_SCOPE_TOO_LARGE');
  const diff=field=>{if(differences.length>=64)throw Error('MCP_SOURCE_DIFFERENCE_LIMIT');differences.push({path:path+'.'+field,sourceNodeId:a.id,nodeId:b.id});};
  const birth=root&&a.type==='COMPONENT'&&b.type==='INSTANCE',reflow=flow||a.layoutSizingHorizontal==='FILL'||a.layoutSizingVertical==='FILL';
  if(a.type!==b.type&&!birth)diff('type');
  if(birth){if((await b.getMainComponentAsync())?.key!==a.key)diff('mainKey');if(!equal(a.variantProperties,b.variantProperties))diff('variantProperties');}
  // A variant's definition name is its variant expression; its instance inherits the set name.
  // Placement and FILL-derived bounds are layout results, not definition identity or editable style.
  const fields=['visible','opacity','blendMode','fills','strokes','fillStyleId','strokeStyleId','strokeWeight','strokeAlign','dashPattern','effects','effectStyleId','cornerRadius','topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius','rotation','layoutMode','paddingTop','paddingRight','paddingBottom','paddingLeft','itemSpacing','primaryAxisAlignItems','counterAxisAlignItems','primaryAxisSizingMode','counterAxisSizingMode','layoutSizingHorizontal','layoutSizingVertical','layoutAlign','layoutGrow','layoutPositioning','constraints','clipsContent','boundVariables','resolvedVariableModes'];
  if(!birth)fields.push('name');if(!root)fields.push('componentPropertyReferences');
  if(reflow)contextualGeometry.push({path,sourceNodeId:a.id,nodeId:b.id});else{fields.push('width','height');if(!root)fields.push('x','y','relativeTransform');}
  if(a.type==='TEXT'&&b.type==='TEXT')fields.push('characters','fontName','fontSize','lineHeight','letterSpacing','textStyleId','textAutoResize','textAlignHorizontal','textAlignVertical','textCase','textDecoration');
  for(const f of fields)if((f in a)!==(f in b)||f in a&&!equal(a[f],b[f]))diff(f);
  if(a.type==='TEXT'&&b.type==='TEXT'&&!equal(a.getStyledTextSegments(['fontName','fontSize','textStyleId','fills','letterSpacing','lineHeight','textCase','textDecoration']),b.getStyledTextSegments(['fontName','fontSize','textStyleId','fills','letterSpacing','lineHeight','textCase','textDecoration'])))diff('styledTextSegments');
  if(a.type==='INSTANCE'&&b.type==='INSTANCE'){if((await a.getMainComponentAsync())?.key!==(await b.getMainComponentAsync())?.key)diff('mainKey');if(!equal(a.componentProperties,b.componentProperties))diff('componentProperties');}
  const aa='children'in a?a.children:[],bb='children'in b?b.children:[];if(aa.length!==bb.length){diff('children.length');continue;}
  for(let i=0;i<aa.length;i++)queue.push({a:aa[i],b:bb[i],path:path+'.children['+i+']',root:false,flow:reflow});
 }
 return{equal:differences.length===0,sourceNodeId:source.id,nodeId:instance.id,nodesCompared,differences,contextualGeometry};
}

function mcpGenerationContext(context){
 const value=clone(context);delete value.ruleLinks;
 for(const contract of value.authoring?.contracts||[])if(contract.manual){contract.validation={status:'not-run',ruleCount:contract.manual.rules?.length||0};delete contract.manual.rules;}
 return value;
}
function mcpDecisionPrompt(r,mcpConnection,toolAllowance){
 if(typeof r.mcpNamespace!=='string'||!/^[a-zA-Z0-9_.]+$/.test(r.mcpNamespace))fail('AGENT_MCP_NAMESPACE_INVALID');
 return 'Owner instruction: GENERATION ONLY. Build the frozen ScreenSpec; design-system checking is disabled for this MCP run. Do not run RuleIR, normative audits, whole-source/default comparisons, cross-adapter certification or automatic compliance-repair loops. Ready=false means unchecked Draft, not blocked generation. Contracts and rules remain unchanged on the server; this execution view retains construction APIs/mappings and omits validation rule bodies/ledger. Missing acceptance-only evidence is not a prerequisite for construction.\n'
  +'Use only apollo_figma_mcp.use_figma/get_screenshot, exact configured file and isolated owned root. Before a mutation resolve scope.rootNodeId, require its sharedPluginData namespace '+r.mcpNamespace+'/key owner equal ownerNonce and exact parent pageId. Load that page once per call. Never edit outside the root, sources, libraries, styles or variables; never create another root. Import exact accepted published keys and use mapped native typed ports. Preserve published default colors and fonts; no guessed tokens or replacement primitives. Load required fonts before text/mode mutations. Tag declared nodes with setSharedPluginData("'+r.mcpNamespace+'","screenNodeId",specNodeId), and physical actions with shared '+r.mcpNamespace+'/actionId for traceability; tags are not validation. Unknown write outcome or ownership stops mutation and preserves the root.\n'
  +'HOST_MCP_INSTRUCTIONS contains complete proxy-bundled workflow files, including figma-use/SKILL.md and figma-generate-design/SKILL.md plus their API references. They are already loaded as text in this exec, not unavailable filesystem pointers. Read these inline bodies; do not attempt shell/file/other tool access to load them again. The owner explicitly disabled validation, so workflow audit/screenshot/acceptance steps are not requested. Exact component choices are supplied by the host mapping; unrelated Code Connect/codebase discovery is outside this run. Call use_figma with skillNames="figma-use,figma-generate-design" (a string), a description, fileKey and JavaScript.\n'
  +'Use SOURCE_READ_RECIPE for bounded source facts and createMcpInstance for fresh instances/fonts/intrinsic modes. Scene context belongs to the owned root; transparent layouts and component roots inherit it. Never copy resolvedVariableModes to explicit modes. Preserve intrinsic source-owned Body/Slot transitions. CONSTRUCTION_RECIPES contains only matching server-owned recipes; apply their construction rules within the frozen spec, preserve every declared node/ID, and use current host mappings as authority. Recipes do not grant Ready or enable checking. Do not fetch unrelated recipes. Do not compare each published instance against its entire definition. compareMcpDefaults is provided ONLY as the destructive SLOT default-payload guard: normal replacement is allowed solely in a fresh owned instance, exact mapped native SLOT, frozen replacement content, proven untouched default payload; append and verify replacement before removing only that payload. Never use removal as failure cleanup or delete other generated/user content. Always return actual created/mutated/removed IDs. Keep related construction work in bounded calls and continue with returned IDs. Never retry an uncertain mutation.\n'
  +'The host collector records only root ownership/preservation, not ScreenSpec or component conformance. Return finish when construction is done; the root receipt cannot certify content quality. Return capabilityGap for an actual unsupported construction operation, not missing verification/manual coverage. request_context is only for missing registered construction resources. CONTEXT_VIEW has the complete registry index and cumulative delivery IDs; do not re-request delivered resources. Keep output within boundedMcpResult; per-tool60s,24 total calls and all run/context limits remain.\n'
  +'ADMISSION='+JSON.stringify({identity:r.identity,scope:r.scope,fileKey:mcpConnection.fileKey,sourceHash:r.policy.sourceHash,guaranteeProfile:PROFILE,sharedPluginDataNamespace:r.mcpNamespace,limits:LIMITS,toolsThisExec:toolAllowance})
  +'\nDRAFT_EXECUTION='+JSON.stringify({mode:'generation-only',validation:'not-run',Ready:false})
  +'\nCONSTRUCTION_RECIPES='+JSON.stringify(r.constructionRecipes||null)
  +'\nSOURCE_READ_RECIPE='+JSON.stringify(boundedMcpResult.toString()+'\n'+readMcpSourceFacts.toString()+'\n'+createMcpInstance.toString()+'\n'+compareMcpDefaults.toString())
  +'\nHOST_MCP_INSTRUCTIONS='+JSON.stringify(r.packet.skills)+'\nTASK='+JSON.stringify(r.packet.input)+'\nSCREEN_VERSION='+JSON.stringify(r.packet.version)+'\nCONTEXT_VIEW='+JSON.stringify({manifestHash:r.view.manifestHash,viewHash:r.view.viewHash,sourceHash:r.view.sourceHash,versionHash:r.view.versionHash,availableResources:r.packet.context?.resourceEnvelope?.manifest?.entries||[],resourceIds:r.view.resourceIds||[],requestedResourceIds:r.requestedResourceIds||[]})+'\nWORKING_CONTEXT='+JSON.stringify(mcpGenerationContext(r.view.context));
}

function createAgentMcpService({inputs,cli,protocol:p,hash,resolveNativePolicy,traceRoot,readonlyRoot,mcpConnection,ledgerFactory,assertComposition,mcpNamespace,recipeCatalog=createRecipeCatalog()}={}){
 if(!inputs||!cli||!p||!hash||typeof resolveNativePolicy!=='function'||typeof ledgerFactory!=='function'||typeof assertComposition!=='function'||typeof mcpNamespace!=='string'||!/^[a-zA-Z0-9_.]+$/.test(mcpNamespace)||mcpConnection?.name!=='apollo_figma_mcp'||mcpConnection.url!=='https://mcp.figma.com/mcp'||!(/^[a-zA-Z0-9_-]{6,128}$/.test(mcpConnection.fileKey||'')))fail('AGENT_MCP_UNAVAILABLE',503);
 const runs=new Map(),admitted=new Map(),seen=new Set();
 const stepSchema={type:'object',properties:{kind:{type:'string',enum:['finish','request_context','capabilityGap']},message:{type:'string',maxLength:2048},resourceIds:{type:'array',maxItems:16,items:{type:'string',pattern:'^context:[a-f0-9]{64}$'}}},required:['kind','message','resourceIds'],additionalProperties:false};
 function progress(r,kind,message){if(r.progress.length>=256)fail('AGENT_PROGRESS_LIMIT');r.progress.push({sequence:++r.sequence,kind,message:String(message).slice(0,2048)});}
 function snapshot(r){const v={schemaVersion:'apollo.mcp-run-snapshot.v1',identity:r.identity,generationMethod:'mcp',guaranteeProfile:PROFILE,sequence:r.sequence,status:r.status,capabilities:['mcp.use_figma','mcp.get_screenshot'],progress:r.progress,pendingOperation:r.pendingOperation,result:r.result,gaps:r.gaps,usage:r.usage,firstFailure:r.firstFailure||null,contextViewHash:r.view.viewHash,parentRequestId:r.packet.context.parentRequestId||null,evidenceLedger:r.ledger.view(),preservation:r.preservation||{status:'NOT_CONFIRMED'},limits:LIMITS};v.snapshotHash=hash(v);
  // Readback and async usage updates can change public state without a progress message.
  if(r.lastSnapshot?.sequence===v.sequence&&r.lastSnapshot.snapshotHash!==v.snapshotHash){v.sequence=++r.sequence;v.snapshotHash=p.hashWithout(v,'snapshotHash');}
  if(!p.bounded(v,2097152))fail('AGENT_MCP_SNAPSHOT_LIMIT');r.lastSnapshot={sequence:v.sequence,snapshotHash:v.snapshotHash};return clone(v);}
 function find(identity){if(!p.validIdentity(identity))fail('AGENT_REQUEST_INVALID',400);const r=runs.get(identity.runId);if(!r)fail('AGENT_RUN_NOT_FOUND',404);if(!p.sameIdentity(identity,r.identity))fail('AGENT_RUN_STALE');return r;}
 async function current(r){if(r.controller.signal.aborted)fail('AGENT_CANCELLED');if(Date.now()>=r.deadline)fail('AGENT_RUN_TIMEOUT',504);recipeCatalog.assertCurrent();await r.resolved.assertCurrent();await r.policy.assertCurrent();}
 function artifact(r,evidenceHash=null){return{rootNodeId:r.scope.rootNodeId,pageId:r.scope.pageId,fileKey:r.scope.fileKey||r.fileCorrelated?mcpConnection.fileKey:null,url:r.scope.fileKey||r.fileCorrelated?'https://www.figma.com/design/'+mcpConnection.fileKey+'/Apollo?node-id='+encodeURIComponent(r.scope.rootNodeId):null,leaseNonce:r.scope.ownerNonce,evidenceHash};}
 function finish(r,status,message,checks=[]){r.status=status;r.pendingOperation=null;r.result={message,validationMode:'generation-only',artifact:artifact(r,r.lastReadback?.evidenceHash||null),checks:clone(checks),writesPerformed:r.toolCalls>0,acceptedWriteOperations:[],Ready:false};progress(r,'check',message);}
 function stop(r,code,error=null){if(['completed','failed','blocked','cancelled'].includes(r.status))return;const diagnostic=readFailure(typeof error?.diagnostic==='string'?error.diagnostic:JSON.stringify(error?.diagnostic||null))||failureDiagnostic(code,{...r.identity,rootNodeId:r.scope.rootNodeId,stage:r.workerInFlight?'mcp-worker':'mcp-host',phase:r.status},'err:'+crypto.randomUUID());if(!r.firstFailure)r.firstFailure={diagnostic,usageMeasurementId:error?.usage?.measurementId||null,originalDiagnostic:error?.diagnostic||null};r.gaps.push({code,message:JSON.stringify(diagnostic)});if(r.workerInFlight)r.unknownMutation=true;r.controller.abort();r.rejectReadback?.(Object.assign(Error(code),{code}));r.pendingOperation=null;r.gaps.push({code,message:'MCP остановлен. Корень сохраняется; фактическое состояние требует независимого readback.'});finish(r,code==='AGENT_CANCELLED'?'cancelled':'failed',code,r.lastReadback?.checks||[]);inputs.invalidate(r.identity);}
 async function admit(body){
  const keys=['schemaVersion','input','version','target','parentIdentity','generationMethod'].concat(Object.hasOwn(body||{},'plannerRequestId')?['plannerRequestId']:[]);
  if(!p.closed(body,keys)||body.schemaVersion!=='apollo.agent-draft-request.v1'||body.target!=='figma-owned'||body.generationMethod!=='mcp'||!p.validScreenVersion(body.version))fail('AGENT_DRAFT_INVALID',400);
  const value=await inputs.admitDraft(Object.assign(clone(body),{target:'figma'}));
  const resolved=await inputs.resolveAgentRun(value.identity);await resolved.assertCurrent();
  if(typeof resolved.readContext!=='function'||resolved.packet.context.generationMethod!=='mcp')fail('AGENT_CONTEXT_REFERENCE_REQUIRED',503);
  (resolved.assertComposition||assertComposition)(resolved.packet.spec);
  const view=resolved.readContext(),componentIds={};
  for(const m of view.context.authoring.mappings||[])componentIds[m.id||m.mappingId]=m.componentId;
  for(const m of view.context.authoring.figmaMappingRecords?.semantic?.mappings||[])componentIds[m.mappingId]=m.componentId;
  if(admitted.size>=16)fail('AGENT_RUN_LIMIT',429);
  admitted.set(value.identity.runId,{resolved,view});
  return{identity:value.identity,version:value.version,generationMethod:'mcp',componentIds,guaranteeProfile:PROFILE};
 }
 async function start(body){
  if(!p.closed(body,['identity','scope'])||!p.validIdentity(body.identity)||!p.closed(body.scope,['schemaVersion','identity','versionHash','sourceHash','fileKey','pageId','rootNodeId','ownerNonce','guaranteeProfile'])||body.scope.guaranteeProfile!==PROFILE||typeof body.scope.pageId!=='string'||body.scope.pageId.length>512||typeof body.scope.rootNodeId!=='string'||body.scope.rootNodeId.length>512||body.scope.schemaVersion!=='apollo.mcp-owned-scope.v1'||!p.sameIdentity(body.scope.identity,body.identity))fail('AGENT_MCP_SCOPE_INVALID',400);
  if(runs.has(body.identity.runId)){const r=find(body.identity);if(hash(r.scope)!==hash(body.scope))fail('AGENT_RUN_STALE');return snapshot(r);}
  if(seen.has(body.identity.runId)||seen.size>=4096)fail('AGENT_RUN_REPLAY');
  const admission=admitted.get(body.identity.runId);if(!admission)fail('AGENT_RUN_STALE');
  const resolved=admission.resolved,packet=resolved.packet,policy=await resolveNativePolicy({identity:body.identity,packet});
  await resolved.assertCurrent();await policy.assertCurrent();
  if(!p.sameIdentity({runId:packet.runId,revision:packet.revision,specHash:packet.specHash,contextHash:packet.contextHash,target:packet.target},body.identity)||hash(packet.context)!==body.identity.contextHash||hash(packet.spec)!==body.identity.specHash||packet.context.generationMethod!=='mcp'||body.scope.sourceHash!==policy.sourceHash||body.scope.versionHash!==packet.version.versionHash||body.scope.fileKey!==null&&body.scope.fileKey!==mcpConnection.fileKey||typeof body.scope.rootNodeId!=='string'||typeof body.scope.ownerNonce!=='string'||!/^[a-f0-9]{64}$/.test(body.scope.ownerNonce))fail('AGENT_MCP_SCOPE_STALE');
  const r={identity:clone(body.identity),scope:clone(body.scope),mcpNamespace,resolved,packet,policy,view:admission.view,ledger:ledgerFactory({hash,sourceHash:policy.sourceHash,versionHash:packet.version.versionHash}),controller:new AbortController(),deadline:Date.now()+LIMITS.runMs,status:'queued',sequence:0,progress:[],gaps:[],pendingOperation:null,result:null,usage:[],toolCalls:0,execs:0,contextRequests:0,requestedResourceIds:[],lastReadback:null,readSequence:0};
  r.constructionRecipes=recipeCatalog.select(packet.spec);
  if(runs.size>=16){const old=Array.from(runs).find(([,v])=>['completed','failed','blocked','cancelled'].includes(v.status));if(!old)fail('AGENT_RUN_LIMIT');runs.delete(old[0]);}admitted.delete(r.identity.runId);runs.set(r.identity.runId,r);seen.add(r.identity.runId);progress(r,'context','MCP · только генерация · проверка отключена · Draft');
  if(r.constructionRecipes.selected.length)progress(r,'context','Рецепт: '+r.constructionRecipes.selected.map(v=>v.id+' r'+v.revision).join(', ')+' · catalog '+r.constructionRecipes.catalogHash);
  const timer=setTimeout(()=>stop(r,'AGENT_RUN_TIMEOUT'),LIMITS.runMs);timer.unref?.();
  r.job=execute(r).catch(error=>{r.usage.push(error.usage||null);r.toolCalls+=error.usage?.toolCalls||0;for(const fact of (error.nativeFailures||[]).slice(0,8))progress(r,'tool','Наблюдавшийся сбой MCP: '+JSON.stringify(fact));const failure=readFailure(typeof error.diagnostic==='string'?error.diagnostic:JSON.stringify(error.diagnostic||null));r.unknownMutation=(error.usage?.toolCalls||0)>0||r.workerInFlight&&!['input-budget','spawn'].includes(failure?.stage);return stop(r,/^AGENT_[A-Z_]+$/.test(error.code||'')?error.code:'AGENT_MCP_EXECUTION_FAILED',error);}).finally(()=>clearTimeout(timer));return snapshot(r);
 }
 async function askReadback(r,kind){
  await current(r);if(r.pendingOperation||r.observationInFlight)fail('AGENT_MCP_READBACK_PENDING');
  r.status='awaiting-operation';r.pendingOperation={kind,nonce:crypto.randomBytes(24).toString('hex'),scope:clone(r.scope)};progress(r,'tool',kind==='retain'?'Подтверждаем сохранность корня без проверки макета.':'Получаем ссылку на результат; проверка макета отключена.');
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Object.assign(Error('AGENT_MCP_READBACK_TIMEOUT'),{code:'AGENT_MCP_READBACK_TIMEOUT'})),15000);timer.unref?.();r.resolveReadback=value=>{clearTimeout(timer);resolve(value);};r.rejectReadback=error=>{clearTimeout(timer);reject(error);};});
 }
 async function observation(body){
  if(!p.closed(body,['identity','nonce','readback']))fail('AGENT_MCP_READBACK_INVALID',400);
  const r=find(body.identity),op=r.pendingOperation,v=body.readback;
  if(!op||r.status!=='awaiting-operation'||r.observationInFlight||body.nonce!==op.nonce)fail('AGENT_OBSERVATION_REPLAY');
  if(!v||v.schemaVersion!=='apollo.mcp-fixed-readback.v1'||!p.sameIdentity(v.identity,r.identity)||v.versionHash!==r.packet.version.versionHash||v.sourceHash!==r.policy.sourceHash||hash(v.scope)!==hash({pageId:r.scope.pageId,rootNodeId:r.scope.rootNodeId,ownerNonce:r.scope.ownerNonce})||v.Ready!==false||v.evidenceHash!==p.hashWithout(v,'evidenceHash')||!Number.isSafeInteger(v.sequence)||v.sequence<=r.readSequence||!Array.isArray(v.facts)||v.facts.length>512||new Set(v.facts.map(f=>f.id)).size!==v.facts.length||!Array.isArray(v.checks)||v.checks.length>256||!v.checks.every(p.validCheck)||!p.bounded(v,2097152))fail('AGENT_MCP_READBACK_INVALID',400);
  if(v.validationMode!=='generation-only')fail('AGENT_MCP_PLUGIN_RELOAD_REQUIRED');
  if(v.checks.length||Object.keys(v.normRefs||{}).length)fail('AGENT_MCP_READBACK_INVALID',400);
  const captured=v.facts[0];if(v.facts.length!==1||captured.id!==r.scope.rootNodeId||captured.parentId!==r.scope.pageId||captured.type!=='FRAME'||!Array.isArray(captured.children)||captured.children.length>512||captured.children.some(id=>typeof id!=='string'||id.length>512))fail('AGENT_MCP_READBACK_INVALID',400);
  const refs=v.normRefs||{},components=new Map();
  for(const m of (r.view.context.authoring?.mappings||[]).concat(r.view.context.authoring?.figmaMappingRecords?.semantic?.mappings||[]))components.set(m.id||m.mappingId,m.componentId);
  if(!refs||typeof refs!=='object'||Array.isArray(refs)||Object.keys(refs).length>256)fail('AGENT_MCP_READBACK_INVALID',400);
  for(const [id,ref]of Object.entries(refs)){const node=r.packet.spec.nodes.find(n=>n.id===ref?.screenNodeId);if(!p.closed(ref,['screenNodeId','RuleID','componentId'])||!node||components.get(node.mappingId)!==ref.componentId||typeof ref.RuleID!=='string'||!ref.RuleID.length||ref.RuleID.length>1024||id!=='mcp-rule-'+hash([ref.screenNodeId,ref.RuleID]).slice(0,32)||!v.checks.some(c=>c.id===id))fail('AGENT_MCP_READBACK_INVALID',400);}
  r.observationInFlight=true;
  try{await current(r);r.readSequence=v.sequence;r.lastReadback=clone(v);r.pendingOperation=null;r.status='running';
   const oldFacts=new Map((r.previousFacts||[]).filter(f=>f.screenNodeId).map(f=>[f.screenNodeId,f]));
   const currentFacts=new Map(v.facts.map(f=>[f.id,f]));
   for(const f of v.facts.filter(f=>f.screenNodeId)){
    let parent=currentFacts.get(f.parentId),parentSubject=r.scope.rootNodeId;const visited=new Set();
    while(parent&&!visited.has(parent.id)){visited.add(parent.id);if(parent.screenNodeId){parentSubject=parent.screenNodeId;break;}parent=currentFacts.get(parent.parentId);}
    const prior=oldFacts.get(f.screenNodeId);if(!prior||prior.parentId!==f.parentId)r.ledger.reparent(f.screenNodeId,parentSubject);else if(hash(prior)!==hash(f))r.ledger.invalidate(f.screenNodeId);
   }
   r.previousFacts=clone(v.facts);if(r.lastWorkerReceipt?.mcp?.argumentScopeValidated&&r.lastWorkerReceipt.mcp.targetFileKey===mcpConnection.fileKey&&v.checks.every(c=>!/^mcp-(binding-set|root-topology|source|actions)/.test(c.id)||c.status==='passed'))r.fileCorrelated=true;
   for(const c of v.checks){const ref=v.normRefs?.[c.id],{subject,RuleID,scope}=r.ledger.address(c,ref);const previous=r.ledger.view().entries.find(e=>e.subject===subject&&e.RuleID===RuleID&&e.scope===scope);const row={sourceHash:r.policy.sourceHash,versionHash:r.packet.version.versionHash,subject,RuleID,scope,status:c.status,evidenceHash:c.evidenceHash};if(previous)row.supersedes=previous.entryHash;r.ledger.record(row);} 
   r.resolveReadback(clone(v));
  }finally{r.observationInFlight=false;}
  return snapshot(r);
 }
 async function execute(r){
  await current(r);const workspace=path.join(readonlyRoot,hash(r.identity)),trace=path.join(traceRoot,hash(r.identity));await fs.mkdir(workspace,{recursive:true});await fs.mkdir(trace,{recursive:true});
  for(let attempt=1;attempt<=LIMITS.execInvocations;attempt++){
   await current(r);r.execs++;r.status='running';progress(r,attempt===1?'agent':'repair','MCP worker exec '+attempt+'; число внутренних model iterations неизвестно.');
   const runtimeBudgetMs=Math.max(1,Math.min(LIMITS.execMs,r.deadline-Date.now()-30000)),toolAllowance=Math.min(LIMITS.toolsPerExec,LIMITS.toolCalls-r.toolCalls);if(toolAllowance<=0)fail('AGENT_MCP_TOOL_LIMIT',429);
   // A timeout bounds one in-flight call; count limits and elapsed exec/run deadlines are independent.
   if(runtimeBudgetMs<LIMITS.toolMs+30000)fail('AGENT_EXECUTION_TIME_BUDGET',504);
   const prompt=mcpDecisionPrompt(r,mcpConnection,toolAllowance);
   budget({prompt,schema:stepSchema,outputReserveChars:163840,deadline:r.deadline,callbackCount:1,callbackMs:LIMITS.toolMs+15000});
   r.workerInFlight=true;const out=await cli.run({workspace,profile:'figma-mcp',prompt,schema:stepSchema,traceDirectory:trace,signal:r.controller.signal,runtimeBudgetMs,mcpBudget:{maxToolCalls:toolAllowance,maxTotalToolOutputBytes:LIMITS.toolOutputsPerExecBytes},diagnosticContext:{...r.identity,stage:'mcp-executor',rootNodeId:r.scope.rootNodeId,requestId:r.packet.context.parentRequestId||null,modelStep:attempt,sourceHash:r.policy.sourceHash}});
   r.workerInFlight=false;await current(r);const step=out.result;if(!p.closed(step,['kind','message','resourceIds'])||!['finish','request_context','capabilityGap'].includes(step.kind)||typeof step.message!=='string'||step.message.length>2048||!Array.isArray(step.resourceIds)||step.resourceIds.length>16)fail('AGENT_STEP_INVALID',502);
   const calls=out.receipt?.mcp?.toolCalls??0;if(!Number.isSafeInteger(calls)||calls<0||calls>toolAllowance)fail('AGENT_MCP_TOOL_LIMIT');r.usage.push(out.receipt?.usage||null);r.lastWorkerReceipt=out.receipt;r.toolCalls+=calls;if(r.toolCalls>LIMITS.toolCalls)fail('AGENT_MCP_TOOL_LIMIT');for(const fact of (out.receipt?.mcp?.nativeFailures||[]).slice(0,8)){if(fact.code==='FIGMA_MCP_TRANSPORT_TIMEOUT'&&fact.safeToRetryWithoutCanvasRead!==true)r.unknownMutation=true;progress(r,'tool','Наблюдавшийся сбой MCP: '+JSON.stringify(fact));}
   const readback=await askReadback(r,'read');await current(r);
   if(step.kind==='capabilityGap'){finish(r,'blocked',step.message,readback.checks);return;}
   if(step.kind==='request_context'){
    if(!step.resourceIds.length||r.pendingOperation||r.observationInFlight)fail('AGENT_CONTEXT_REQUEST_LIMIT');
    if(new Set(step.resourceIds).size!==step.resourceIds.length)fail('AGENT_CONTEXT_REFERENCE_STALE');
    const missing=step.resourceIds.filter(id=>!r.view.resourceIds.includes(id));
    if(!missing.length){progress(r,'context','Повторно запрошены уже доставленные ресурсы: '+step.resourceIds.join(', '));throw Object.assign(Error('AGENT_CONTEXT_NO_PROGRESS'),{code:'AGENT_CONTEXT_NO_PROGRESS',diagnostic:failureDiagnostic('AGENT_CONTEXT_NO_PROGRESS',{...r.identity,rootNodeId:r.scope.rootNodeId,sourceHash:r.policy.sourceHash,modelStep:attempt,phase:'running',stage:'context-delivery',operation:'request_context'},'err:'+crypto.randomUUID())});}
    if(++r.contextRequests>LIMITS.contextRequests)fail('AGENT_CONTEXT_REQUEST_LIMIT');
    const requestedResourceIds=r.requestedResourceIds.concat(missing);
    r.view=r.resolved.readContext(requestedResourceIds);r.requestedResourceIds=requestedResourceIds;progress(r,'context','Ресурсы доставлены накопительно: '+requestedResourceIds.join(', ')+'; полный обязательный view сохранён, native proof не менялся.');continue;
   }
   if(step.resourceIds.length)fail('AGENT_STEP_INVALID');
   const root=readback.facts.find(f=>f.id===r.scope.rootNodeId);
   if(!root?.children?.length){finish(r,'blocked','Генерация не создала содержимое. Пустой корень сохранён; проверка макета не выполнялась.',[]);return;}
   const retained=await askReadback(r,'retain');await current(r);
   r.preservation={status:'OBSERVED_RETAINED',evidenceHash:retained.evidenceHash,sequence:retained.sequence};finish(r,'completed',step.message+' · Макет сохранён без проверки. MCP Draft, Ready=false.',retained.checks);return;
  }
  fail('AGENT_STEP_LIMIT');
 }
 async function preservation(body){
  if(!p.closed(body,['identity','scopeNonce','readback']))fail('AGENT_MCP_READBACK_INVALID');
  const r=find(body.identity),v=body.readback;
  if(!['failed','blocked','cancelled'].includes(r.status)||body.scopeNonce!==r.scope.ownerNonce||!v||v.schemaVersion!=='apollo.mcp-fixed-readback.v1'||!p.sameIdentity(v.identity,r.identity)||v.versionHash!==r.packet.version.versionHash||v.sourceHash!==r.policy.sourceHash||hash(v.scope)!==hash({pageId:r.scope.pageId,rootNodeId:r.scope.rootNodeId,ownerNonce:r.scope.ownerNonce})||v.evidenceHash!==p.hashWithout(v,'evidenceHash')||v.sequence<=r.readSequence||!v.facts?.some(f=>f.id===r.scope.rootNodeId&&f.parentId===r.scope.pageId)||!Array.isArray(v.checks)||v.checks.length>256||!v.checks.every(p.validCheck)||!p.bounded(v,2097152))fail('AGENT_MCP_PRESERVATION_INVALID');
  if(v.validationMode!=='generation-only'||v.checks.length||Object.keys(v.normRefs||{}).length)fail('AGENT_MCP_PLUGIN_RELOAD_REQUIRED');
  r.readSequence=v.sequence;r.preservation={status:r.unknownMutation?'ROOT_OBSERVED_REMOTE_WRITE_UNCERTAIN':'OBSERVED_PRESERVED',evidenceHash:v.evidenceHash,sequence:v.sequence};r.lastReadback=clone(v);r.result.artifact=artifact(r,v.evidenceHash);r.result.checks=clone(v.checks.filter(c=>c.id!=='mcp-preservation')).concat({id:'mcp-preservation',status:r.unknownMutation?'unknown':'passed',origin:'tool-observation',message:r.unknownMutation?'Корень прочитан; завершение удалённой записи остаётся неизвестным.':'Корень сохранён и независимо прочитан после остановки.',evidenceHash:v.evidenceHash});progress(r,'check','Фактический preservation readback записан; исходный terminal status сохранён.');return snapshot(r);
 }
 async function poll(body){if(!p.closed(body,['runId','revision','specHash','contextHash','target','afterSequence'])||!Number.isSafeInteger(body.afterSequence)||body.afterSequence<0)fail('AGENT_REQUEST_INVALID');const r=find(Object.fromEntries(['runId','revision','specHash','contextHash','target'].map(k=>[k,body[k]])));if(body.afterSequence>r.sequence)fail('AGENT_SEQUENCE_STALE');if(!['completed','failed','blocked','cancelled'].includes(r.status))try{await current(r);}catch(error){stop(r,error.code||'AGENT_RUN_STALE',error);}return snapshot(r);}
 async function cancel(body){const wrapped=p.closed(body,['identity','reason']),r=find(wrapped?body.identity:body),reason=wrapped&&/^AGENT_[A-Z_]+$/.test(body.reason)?body.reason:'AGENT_CANCELLED';stop(r,reason);return snapshot(r);}
 return{admit,start,poll,observation,preservation,cancel,isBusy:()=>Array.from(runs.values()).some(r=>!p.TERMINAL.includes(r.status)),whenSettled:identity=>find(identity).job};
}
function mountAgentMcpRoutes(app,{loadService,configured=()=>false}){
 app.get('/agent/mcp/status',(_req,res)=>res.json({success:true,method:'mcp',configured:configured(),connection:'apollo_figma_mcp',guaranteeProfile:PROFILE,readiness:'REQUIRED_WORKER_INIT_AND_INDEPENDENT_READBACK',limits:LIMITS}));
 for(const [route,method]of [['drafts','admit'],['runs','start'],['runs/poll','poll'],['runs/observation','observation'],['runs/cancel','cancel'],['runs/preservation','preservation']])app.post('/agent/mcp/'+route,async(req,res)=>{try{const service=await loadService(),value=await service[method](req.body);res.setHeader('Cache-Control','no-store');res.json(method==='admit'?Object.assign({success:true},value):{success:true,run:value});}catch(error){res.status(error.status||503).json({success:false,code:/^AGENT_[A-Z_]+$/.test(error.code||'')?error.code:'AGENT_MCP_UNAVAILABLE'});}});
}
module.exports={createAgentMcpService,mountAgentMcpRoutes,PROFILE,LIMITS,mcpDecisionPrompt,readMcpSourceFacts,boundedMcpResult,createMcpInstance,compareMcpDefaults,mcpGenerationContext};
