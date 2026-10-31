'use strict';
function boundedMcpResult(value){const bytes=encodeURIComponent(JSON.stringify(value)).replace(/%[0-9A-F]{2}/g,'x').length;if(bytes>12000)throw Error('MCP_RESULT_SCOPE_TOO_LARGE: return fewer mapped fields or split the read');return value;}
async function createMcpInstance(component,expectedKey,parent,createdIds,mutatedIds){
 figma.skipInvisibleInstanceChildren=false;if(figma.skipInvisibleInstanceChildren!==false)throw Error('MCP_SOURCE_TRAVERSAL_UNKNOWN');
 if(component.type!=='COMPONENT'||component.key!==expectedKey)throw Error('MCP_SOURCE_KEY_MISMATCH');
 if(!Array.isArray(createdIds)||!Array.isArray(mutatedIds)||typeof parent?.appendChild!=='function')throw Error('MCP_INSTANCE_TRACKING_UNKNOWN');
 const fonts=new Map(),modes=JSON.parse(JSON.stringify(component.explicitVariableModes||{})),collections=[];
 if(Object.keys(modes).length>64)throw Error('MCP_SOURCE_SCOPE_TOO_LARGE');
 for(const [id,mode]of Object.entries(modes)){const collection=await figma.variables.getVariableCollectionByIdAsync(id);if(!collection||!collection.modes.some(m=>m.modeId===mode))throw Error('MCP_SOURCE_MODE_UNKNOWN');collections.push([collection,mode]);}
 for(const n of component.findAllWithCriteria({types:['TEXT']})){
  for(const segment of n.getStyledTextSegments(['fontName'])){
   const font=segment.fontName;fonts.set(JSON.stringify(font),font);
   const bindings=n.boundVariables?.fontFamily||[];
   for(const alias of Array.isArray(bindings)?bindings:[bindings]){const variable=await figma.variables.getVariableByIdAsync(alias.id);if(!variable)throw Error('MCP_SOURCE_FONT_VARIABLE_UNKNOWN');for(const family of Object.values(variable.valuesByMode)){if(typeof family!=='string')throw Error('MCP_SOURCE_FONT_VARIABLE_UNKNOWN');const value={family,style:font.style};fonts.set(JSON.stringify(value),value);}}
  }
 }
 if(fonts.size>32)throw Error('MCP_SOURCE_SCOPE_TOO_LARGE');for(const font of fonts.values())await figma.loadFontAsync(font);
 const instance=component.createInstance();createdIds.push(instance.id);mutatedIds.push(parent.id,instance.id);parent.appendChild(instance);
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
module.exports={boundedMcpResult,createMcpInstance,readMcpSourceFacts,compareMcpDefaults};
