'use strict';
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const nullable=schema=>({anyOf:[schema,{type:'null'}]});
const string=(maxLength=4000)=>({type:'string',maxLength});
const array=(items,maxItems)=>Object.assign({type:'array',items},maxItems===undefined?{}:{maxItems});
const integer={type:'integer',minimum:0};
const reference={$ref:'#/$defs/value'};
const entry=object({key:{type:'string'},value:reference});
const map=object({entries:array(entry)});
const source=object({id:string(512),sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},path:array(string(400),32),offset:integer,observation:string(1500)});
const descriptor=role=>object(Object.assign(role?{role:string(120)}:{},{type:{type:'string',enum:['FRAME','INSTANCE','SLOT']},componentKey:nullable({type:'string',pattern:'^[a-f0-9]{40}$'})}));
const checkpoint=object({sectionId:nullable(string(120)),status:{type:'string',enum:['partial','complete']},nextAction:string(1000)});
const technical=object({sectionId:string(120),baseRevision:integer,sources:array(source,8),decision:string(2000)});
const report=object({summary:{type:'string'},checks:array(object({name:{type:'string'},verdict:{type:'string',enum:['PASS','FAIL','UNKNOWN']},evidence:{type:'string'},critical:{type:'boolean'}})),visualReviews:array(object({scope:string(120),modelStep:integer,callId:string(120),verdict:{type:'string',enum:['PASS','FAIL','UNKNOWN']},evidence:string(2000)})),issues:array({type:'string'}),limits:array({type:'string'})});
const decisions={
 'prepare-foundation':object({container:descriptor(true),mount:descriptor(true),layout:map,slotContentReplacement:nullable(string(400))}),
 'prepare-structure':object({root:descriptor(false),props:map,slots:array(string(400),64),layout:map}),
 'prepare-content':object({texts:array(object({target:string(400),value:string(4000),factIds:array(string(120),100)}),64),assets:array(object({target:string(400),kind:{type:'string',enum:['component','image']},key:string(128),resourceId:string(512),path:array(string(400),32)}),32)})
};
const native=require('./native-plan');
const enumeration=values=>({type:'string',enum:values});
const nativeKey={type:'string',pattern:'^[a-f0-9]{40}$'};
const logicalId={type:'string',pattern:'^[a-zA-Z][\\w-]{0,79}$'};
const nativeProps=object({entries:array(object({key:string(400),value:{type:['string','boolean'],maxLength:512}}))});
function nativeSettings(library=false){
 const names=Object.keys(native.fields).filter(name=>!library||native.sizeFields.has(name));
 const choices=names.map(name=>object({key:enumeration([name]),value:Array.isArray(native.fields[name])?{type:typeof native.fields[name][0],enum:native.fields[name]}:{type:'number',minimum:0,maximum:100000}}));
 return object({fields:object({entries:array({anyOf:choices},names.length)}),bindings:object({entries:array(object({key:enumeration(names.filter(name=>native.fields[name]==='number')),value:nativeKey}),names.length)}),modes:array(object({collection:string(400),mode:string(128)}),32)});
}
function nativeTree(stage){
 const common={id:logicalId,parent:{type:'string',pattern:'^(\\$root|\\$mount|[a-zA-Z][\\w-]{0,79})$'},role:nullable({type:'string',pattern:'^[a-z][a-z0-9-]{0,39}$'})};
 const selector=()=>array(object({type:enumeration(['FRAME','SLOT','INSTANCE']),name:string(400)}),12);
 const nodes=[
  object({...common,kind:enumeration(['layout']),name:nullable(string(400)),layout:nativeSettings()}),
  object({...common,kind:enumeration(['instance']),name:nullable(string(400)),key:nativeKey,importType:enumeration(['COMPONENT','COMPONENT_SET']),props:nativeProps,layout:nativeSettings(true)}),
  object({...common,kind:enumeration(['slot']),selector:selector(),layout:object({})}),
  object({...common,kind:enumeration(['configure']),selector:selector(),props:nativeProps,layout:nativeSettings(true)})
 ];
 return object({schemaVersion:enumeration([native.SCHEMA]),rootId:logicalId,mountId:stage==='prepare-foundation'?logicalId:{type:'null'},rootLayout:stage==='prepare-foundation'?nativeSettings():object({}),nodes:array({anyOf:nodes},64)});
}
function nativeDecision(stage){
 const layout=object({nativePlan:nativeTree(stage)});
 return stage==='prepare-foundation'?object({container:descriptor(true),mount:descriptor(true),layout,slotContentReplacement:nullable(string(400))}):object({root:descriptor(false),props:map,slots:array(string(400),64),layout});
}
function decodeNative(value,field){
 const settings=(v,p)=>Object.keys(v).length?{fields:decodeMap(v.fields,p+'.fields'),bindings:decodeMap(v.bindings,p+'.bindings'),modes:v.modes}:{};
 return {...value,rootLayout:settings(value.rootLayout,field+'.rootLayout'),nodes:value.nodes.map((node,i)=>{
  const n={...node,layout:settings(node.layout,field+'.nodes['+i+'].layout')};
  if(n.role===null)delete n.role;if(n.name===null)delete n.name;
  if(n.props)n.props=decodeMap(n.props,field+'.nodes['+i+'].props');return n;
 })};
}
function schema(stage,nativeWire=false){
 const typedNative=nativeWire&&['prepare-foundation','prepare-structure'].includes(stage);
 const preparation=decisions[stage]?object({stage:{type:'string',enum:[stage]},sectionId:nullable(string(120)),baseRevision:integer,sources:array(source,24),decision:typedNative?nativeDecision(stage):decisions[stage]}):null;
 const value=object({kind:{type:'string',enum:['list_resources','request_context','question','continue','finish']},message:string(12000),query:string(512),offset:integer,resources:array(object({id:string(512),mode:{type:'string',enum:['read','keys','summary']},path:array(string(400),32),offset:integer,limit:{type:'integer',minimum:1,maximum:16000}})),sectionPatch:stage==='structure'?nullable(object({sectionId:string(120),nodeId:string(512)})):{type:'null'},payload:nullable(object({checkpoint:nullable(checkpoint),preparationPatch:preparation?nullable(preparation):{type:'null'},technicalPatch:['structure','content'].includes(stage)?nullable(technical):{type:'null'},apiObservations:array(string(1500),8),report:stage==='verify'?nullable(report):{type:'null'}}))});
 value.$defs={value:{anyOf:[{type:['string','number','boolean','null']},{type:'array',items:reference},map]}};return value;
}
const type=value=>value===null?'null':Array.isArray(value)?'array':typeof value;
function invalid(field,expected,value){
 throw Object.assign(Error('LANDING_STEP_PAYLOAD_INVALID'),{code:'LANDING_STEP_PAYLOAD_INVALID',status:502,diagnostic:{field:field.slice(0,700),expected:expected.slice(0,300),received:value===undefined?'missing':value!==null&&typeof value==='object'?type(value)+' keys: '+Object.keys(value).join(',').slice(0,180):(type(value)+': '+JSON.stringify(value)).slice(0,180)}});
}
// Validate only the closed schema forms emitted above; semantic admission stays in checkpoints.
function validate(value,root){
 let count=0;
 const matches=(v,t)=>t==='integer'?Number.isSafeInteger(v):t==='number'?typeof v==='number'&&Number.isFinite(v):t==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):type(v)===t;
 function visit(v,s,field,depth){
  if(s.$ref)return visit(v,root.$defs[s.$ref.split('/').at(-1)],field,depth);
  if(s.anyOf){const candidates=s.anyOf.filter(c=>(c.$ref||!c.type||(Array.isArray(c.type)?c.type:[c.type]).some(t=>matches(v,t)))&&(!c.properties||Object.entries(c.properties).every(([key,rule])=>!rule.enum||rule.enum.includes(v?.[key]))));if(candidates.length!==1)invalid(field,'one declared type',v);return visit(v,candidates[0],field,depth);}
  if(++count>50000||depth>32)invalid(field,'bounded payload',v);
  if(!(Array.isArray(s.type)?s.type:[s.type]).some(t=>matches(v,t)))invalid(field,String(s.type),v);
  if(s.enum&&!s.enum.includes(v))invalid(field,'one of: '+s.enum.join(', '),v);
  if(typeof v==='string'&&(v.length>(s.maxLength??Infinity)||s.pattern&&!new RegExp(s.pattern).test(v)))invalid(field,'bounded declared string',v);
  if(typeof v==='number'&&(!Number.isFinite(v)||v<(s.minimum??-Infinity)||v>(s.maximum??Infinity)))invalid(field,'bounded number',v);
  if(Array.isArray(v)){if(v.length>(s.maxItems??Infinity))invalid(field,'bounded array',v);v.forEach((item,i)=>visit(item,s.items,field+'['+i+']',depth+1));}
  else if(v!==null&&typeof v==='object'){
   const extra=Object.keys(v).find(key=>!Object.hasOwn(s.properties,key)),missing=s.required.find(key=>!Object.hasOwn(v,key));
   if(extra!==undefined)invalid(field+'.'+extra,'field is not allowed'+(v.kind?' for kind='+v.kind:'')+'; expected keys: '+s.required.join(','),v[extra]);
   if(missing!==undefined)invalid(field+'.'+missing,'required field',undefined);
   for(const key of Object.keys(v))visit(v[key],s.properties[key],field+'.'+key,depth+1);
  }
 }
 let bytes;try{bytes=Buffer.byteLength(JSON.stringify(value));}catch{invalid('step','serializable bounded data',value);}
 if(bytes>262144)invalid('step','at most262144 UTF-8 bytes',value);visit(value,root,'step',0);
}
function decodeMap(value,field){
 const result={};
 for(const entry of value.entries){
  if(['__proto__','prototype','constructor'].includes(entry.key)||Object.hasOwn(result,entry.key))invalid(field+'.entries','unique nonreserved keys',entry.key);
  result[entry.key]=decodeValue(entry.value,field+'.'+entry.key);
 }
 return result;
}
function decodeValue(value,field){return Array.isArray(value)?value.map((item,i)=>decodeValue(item,field+'['+i+']')):value!==null&&typeof value==='object'?decodeMap(value,field):value;}
function read(step,stage,nativeWire=false){
 const typedNative=nativeWire&&['prepare-foundation','prepare-structure'].includes(stage);
 validate(step,schema(stage,nativeWire));
 if(!['continue','finish'].includes(step.kind)){if(step.payload!==null)invalid('step.payload','null for a reader/question step',step.payload);return {};}
 if(step.payload===null)invalid('step.payload','current-step object',null);
 const payload=step.payload,result={};
 if(step.kind==='finish'){
  if(stage!=='verify'||payload.report===null||payload.checkpoint!==null||payload.preparationPatch!==null||payload.technicalPatch!==null)invalid('step.payload','verify report only',payload);
  return Object.assign({},payload.report,{apiObservations:payload.apiObservations});
 }
 if(payload.checkpoint===null||payload.report!==null)invalid('step.payload.checkpoint','checkpoint without report',payload.checkpoint);
 result.checkpoint=payload.checkpoint;result.apiObservations=payload.apiObservations;
 if(decisions[stage]&&payload.checkpoint.status==='complete'&&payload.preparationPatch===null)invalid('step.payload.preparationPatch','complete current preparation',null);
 if(payload.preparationPatch!==null){
  const patch=payload.preparationPatch,decision=Object.assign({},patch.decision);
  if(Object.hasOwn(decision,'layout'))decision.layout=typedNative?{nativePlan:decodeNative(decision.layout.nativePlan,'step.payload.preparationPatch.decision.layout.nativePlan')}:decodeMap(decision.layout,'step.payload.preparationPatch.decision.layout');
  if(Object.hasOwn(decision,'props'))decision.props=decodeMap(decision.props,'step.payload.preparationPatch.decision.props');
  if(decision.slotContentReplacement===null)delete decision.slotContentReplacement;
  result.preparationPatch=Object.assign({},patch,{decision});
 }
 if(payload.technicalPatch!==null)result.technicalPatch=payload.technicalPatch;
 return result;
}
const instructions='STAGED_STEP_WIRE: Return the exact schema with payload as an object (or null for reader/question steps), never resultJson or JSON inside a string. payload contains checkpoint, preparationPatch, technicalPatch, apiObservations and report; unused optional fields are null and apiObservations is an array. The current stage alone determines admitted fields. A complete preparation requires its preparationPatch. The recipe ID belongs ONLY in payload.preparationPatch.decision.slotContentReplacement (string or null); a value elsewhere is rejected. technicalPatch.decision is a nonempty plain string of at most2000characters. Outside the explicitly declared native preparation schema, dynamic props/layout maps use {entries:[{key,value}]}, including nested object values; arrays/scalars stay arrays/scalars. This is a lossless technical encoding, not permission to invent DS values. Keys are exact, unique and nonreserved; no JSON strings, coercion or automatic relocation. report in verify finish has summary, checks[{name,verdict,evidence,critical}], visualReviews[{scope,modelStep,callId,verdict,evidence}], issues:string[] and limits:string[]. Treat execution.protocolIssue as a rejected reply: correct only that current step after host readback; never repeat or replay a possible scene write. Existing source, scope, owner and evidence guards still apply.';
const nativeInstructions='NATIVE SKELETON: The landing-plan wrapper is tool-free for this model turn; its generic no-write wording does not negate previous native writes. Report existing canvas work from target/readback/execution.nativeOperations, never claim that nothing was written after those facts confirm it. When source.skeletonExecutor=native-layout-v1, foundation and structure are executed by the plugin without an agent/MCP turn. In prepare-foundation/prepare-structure provide decision.layout.nativePlan, a data tree, never JS. For native preparation the wire decision.layout is a plain {nativePlan:...} object, NOT an entries map. nativePlan/nodes/settings/selector/modes are plain schema objects; ONLY settings.fields, settings.bindings and node.props use {entries:[{key,value}]}. Supply fields/bindings/modes explicitly in settings; use empty entries/arrays when absent. role/name may be null only where declared and are omitted when decoded. kind=slot has NO name or props field: its existing name belongs only to selector segments; selecting never renames it. rootLayout uses the same settings envelope, with layoutMode/etc inside rootLayout.fields, never directly in rootLayout. A block rootLayout and slot layout are exactly {}. Its decoded shape is {schemaVersion:"apollo.native-skeleton.v1",rootId:"stableLogicalId",mountId:"bodyLogicalId" or null,rootLayout:{},nodes:[{id,parent,kind,key,importType,selector,role,name,props,layout}]}. nodes are parent-before-child. Foundation root parent=$root; block root parent=$mount. Exactly one root. kind=instance imports a read published key with importType=COMPONENT or COMPONENT_SET; props are public structural BOOLEAN/VARIANT/INSTANCE_SWAP, never TEXT. kind=layout creates a transparent FRAME with explicit source-derived layout.fields.layoutMode=VERTICAL or HORIZONTAL. kind=slot selects a documented actual SLOT from its created instance using selector:[{type,name},...] with unique direct children per segment; tag foundation mount role, preserve its bindings/layout. kind=configure selects a nested INSTANCE and sets only its public non-TEXT props; selector paths may traverse FRAME/INSTANCE/SLOT. New children can enter an instance only through a selected native SLOT. Omit irrelevant optional node fields. rootId names the plan root node: its type/key/role match decision.container for foundation; its type/key match decision.root for a block. Foundation mountId names the mount node whose type/role match decision.mount; block mountId=null. Root instance props equal decision.props for a block. layout={fields:{native sizing/alignment/padding/gap properties},bindings:{numericProperty:readVariableKey},modes:[{collection:actualCollectionName,mode:sourceSelectedModeName}]}; library instances admit sizing fields only, slot layout must be empty. Foundation rootLayout configures the owned outer frame; block rootLayout={}. Runtime has no DS defaults: all values/modes/keys follow read Hub rules. Cite every imported component/swap/variable key in sources, including retained figma-keys/overview after a correction. execution.nativeIssue contains observed API facts; reprepare only the current unit using actual definitions, without inventing aliases or dropping obligations. Proxy asks for explicit structure approval after all skeletons. Content preparation and content/MCP writes are blocked until approval; if rejected, replan only the requested structure and the plugin rebuilds it before a new approval. In structural replanning preserve the accepted foundation, stable existing section IDs and editSectionIds covering additions/removals/requested changes. Final copy/assets belong after approval. Content preserves approved native anchors, structural props and section order.';
module.exports={schema,read,instructions,nativeInstructions};
