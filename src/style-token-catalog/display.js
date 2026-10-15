'use strict';
const {VERSION,PERMISSIONS,stableKey,scalar,identity,validateRequest,canonical,digest,fail}=require('./display-protocol');

function createDisplayIndex(snapshot){
  const byIdentity=new Map(),localIds=new Map();
  for(const [sourceId,catalog] of snapshot.rawCatalogs){
    const source=snapshot.sources.get(sourceId);
    function add(kind,raw,pointer,collectionRecord=null){
      if(!stableKey(raw.key) || !scalar(raw.name,1000))fail('INVALID_DISPLAY_RESOURCE',503);
      const key=raw.key.toLowerCase(),collection=collectionRecord?{key:collectionRecord.key,name:collectionRecord.name}:null;
      const row={kind,key,raw,source,pointer,collectionRecord,collection,catalog,
        recordSha256:digest(raw),collectionSha256:collectionRecord?digest(collectionRecord):null,
        identityRecordSha256:digest({resource:raw,collection:collectionRecord})};
      const id=canonical([kind,key]);if(!byIdentity.has(id))byIdentity.set(id,[]);byIdentity.get(id).push(row);
      if(kind==='variable' && typeof raw.id==='string'){
        const local=canonical([sourceId,raw.id]);if(!localIds.has(local))localIds.set(local,[]);localIds.get(local).push(row);
      }
    }
    if(source.kind==='tokens')catalog.collections.forEach((collection,ci)=>{
      if(!stableKey(collection.key) || !scalar(collection.name,1000))fail('INVALID_DISPLAY_COLLECTION',503);
      const record=Object.assign({},collection);delete record.variables;
      collection.variables.forEach((v,vi)=>add('variable',v,`/collections/${ci}/variables/${vi}`,record));
    });
    else catalog.styles.forEach((style,i)=>add('style',style,`/styles/${i}`));
  }
  const indexId=digest({snapshotId:snapshot.snapshotId,readerCodeSha256:snapshot.readerCodeSha256});
  function aliases(row){
    if(row.kind!=='variable')return [];
    const result=[];
    for(const [modeId,value] of Object.entries(row.raw.valuesByMode||{})){
      if(!value || value.type!=='VARIABLE_ALIAS')continue;
      const modes=row.collectionRecord.modes.filter(m=>m.modeId===modeId);
      const alias={sourceId:row.source.id,collectionKey:row.collection.key,modeId,
        modeName:modes.length===1?modes[0].name:null,modeDeclared:modes.length===1,
        aliasId:typeof value.id==='string'?value.id:null,targetKind:'variable',targetKey:null,proof:'unavailable',targetLabel:null};
      if(alias.modeDeclared && scalar(value.id,300)){
        const embedded=identity('variable',value.id);
        if(embedded.key){alias.targetKey=embedded.key;alias.proof='embedded-stable-key';}
        else{
          const targets=localIds.get(canonical([row.source.id,value.id]))||[];
          if(targets.length===1){alias.targetKey=targets[0].key;alias.proof='exact-source-exported-id';}
          else if(targets.length>1)alias.proof='ambiguous-source-exported-id';
        }
      }
      result.push(alias);
    }
    return result;
  }
  function resolve(item){
    const parsed=identity(item.kind,item.reference);
    const result={kind:item.kind,reference:item.reference,stableKey:parsed.key,state:'unavailable',reason:parsed.reason,
      name:null,collection:null,duplicateState:'none',catalogNames:[],occurrences:[],aliases:[],notPackagedSourceIds:[],proposedMatches:[]};
    if(!parsed.key)return result;
    const kind=item.kind==='variable'?'tokens':'styles';
    const selected=item.sourceIds||[...snapshot.sources.values()].filter(s=>s.kind===kind).map(s=>s.id);
    if(selected.some(id=>!snapshot.sources.has(id))){result.reason='SOURCE_NOT_IN_INVENTORY';return result;}
    if(selected.some(id=>snapshot.sources.get(id).kind!==kind)){result.reason='RESOURCE_KIND_SOURCE_MISMATCH';return result;}
    result.notPackagedSourceIds=selected.filter(id=>snapshot.sources.get(id).availability==='not-packaged');
    const matches=(byIdentity.get(canonical([item.kind,parsed.key]))||[]).filter(r=>selected.includes(r.source.id));
    if(!matches.length){
      result.state=result.notPackagedSourceIds.length===selected.length?'not-packaged':'unavailable';
      result.reason=result.state==='not-packaged'?'SOURCE_NOT_PACKAGED':'KEY_NOT_IN_SELECTED_PACKAGED_SOURCES';return result;
    }
    result.occurrences=matches.map(r=>({sourceId:r.source.id,catalogName:r.catalog.meta.library,sourceName:r.catalog.meta.fileName,
      exportedAt:r.catalog.meta.generatedAt,sourceRawSha256:r.source.sha256,sourceCanonicalSha256:digest(r.catalog),
      sourceRecordSha256:r.recordSha256,collectionRecordSha256:r.collectionSha256,identityRecordSha256:r.identityRecordSha256,
      jsonPointer:r.pointer,name:r.raw.name,group:r.raw.group??null,collection:r.collection,sourceType:r.raw.resolvedType||r.raw.type||null}));
    result.catalogNames=[...new Set(matches.map(r=>r.catalog.meta.library))].sort();
    const identical=new Set(matches.map(r=>r.identityRecordSha256)).size===1;
    // V3 exports one EFFECT style as multiple effect rows sharing its exact key and label.
    const effectRows=item.kind==='style' && matches.every(r=>r.raw.value?.kind==='effect')
      && new Set(matches.map(r=>digest({name:r.raw.name,group:r.raw.group??null}))).size===1;
    if(!identical && !effectRows){result.state='ambiguous';result.reason='CONFLICTING_EXACT_KEY_RECORDS';result.duplicateState='conflicting-records';return result;}
    result.state='resolved';result.reason=null;result.name=matches[0].raw.name;result.collection=matches[0].collection;
    result.duplicateState=matches.length>1?(identical?'identical-records':'same-label-export-records'):'none';result.aliases=matches.flatMap(aliases);return result;
  }
  function query(value){
    const request=validateRequest(value);
    if(request.indexId!==indexId || request.contentVersion!==snapshot.contentVersion)fail('DISPLAY_INDEX_VERSION_MISMATCH',409);
    snapshot.assertFresh();
    return JSON.parse(canonical({protocolVersion:VERSION,indexId,resolverCodeSha256:snapshot.readerCodeSha256,
      contentVersion:snapshot.contentVersion,knowledge:snapshot.knowledge,permissions:PERMISSIONS,
      freshness:{state:'pinned-inputs-current',nativeFreshness:'unverified'},resources:request.resources.map(resolve)}));
  }
  function inventory(){
    snapshot.assertFresh();
    return JSON.parse(canonical({protocolVersion:VERSION,indexId,resolverCodeSha256:snapshot.readerCodeSha256,contentVersion:snapshot.contentVersion,
      knowledge:snapshot.knowledge,sources:snapshot.inventory().sources,permissions:PERMISSIONS}));
  }
  return {indexId,query,inventory};
}
module.exports={createDisplayIndex};
