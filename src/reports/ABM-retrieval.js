'use strict';
const fs=require('node:fs');
const {loadPattern,parentsFor,ruleText,numericKey,cleanRuleContent:clean}=require('./ABM-source');
const {tokens,expandTerms,canonicalTerms,isMoreRequest,isFollowup,recentTopic}=require('./ABM-search-terms');
const MAX_PACKET_CHARS=64000,MAX_RULES=128;
let cached;
function indexFor(source) {
  if(cached?.root===source.root&&cached.sha===source.contentSha256)return cached.rows;
  const patterns=fs.readdirSync(source.root).filter(file=>/^p_abm_.+\.md$/.test(file)).sort()
    .map(file=>{
      const pattern=loadPattern(source.root,file);
      if(!pattern)throw Object.assign(new Error('Некорректные метаданные паттерна АБМ.'),{code:'ABM_KNOWLEDGE_UNAVAILABLE',status:503});
      return pattern;
    });
  const rows=patterns.flatMap(pattern=>pattern.rules.map(rule=>{
    const parents=parentsFor(pattern,rule);
    const record={file:pattern.file,ruleId:rule.key,pattern:pattern.title,version:pattern.version,
      context:clean(rule.context),sectionTitles:rule.headings,
      parents:parents.map(parent=>({ruleId:parent.key,text:clean(parent.body)})),text:clean(rule.body)};
    return {record,section:pattern.file+'\n'+rule.context,meta:tokens(pattern.title+' '+pattern.metadata),
      keyTerms:canonicalTerms(tokens(rule.key)),heading:tokens(rule.key+' '+rule.headings.join(' ')),sectionHeadings:rule.headings,
      body:tokens(ruleText(rule.body)+' '+rule.context+' '+parents.map(parent=>parent.body).join(' '))};
  }));
  const df=new Map();
  for(const row of rows)for(const term of new Set([...row.meta,...row.heading,...row.body]))df.set(term,(df.get(term)||0)+1);
  for(const row of rows)row.weights=new Map([...new Set([...row.meta,...row.heading,...row.body])].map(term=>[
    term,Math.log(1+rows.length/(df.get(term)||1))*(Number(row.body.includes(term))+2*Number(row.heading.includes(term))+0.7*Number(row.meta.includes(term)))
  ]));
  cached={root:source.root,sha:source.contentSha256,rows};
  return rows;
}
// This exact representation is both budgeted here and serialized in the prompt.
function knowledgePayload(packet) {
  const selected=new Set(packet.rules.map(rule=>rule.file+':'+rule.ruleId));
  const contexts=[],contextIds=new Map(),patterns=new Map();
  const rules=packet.rules.map(rule=>{
    patterns.set(rule.file,{file:rule.file,title:rule.pattern,version:rule.version});
    const key=rule.file+'\n'+rule.context;
    if(!contextIds.has(key)) {
      const id='c'+(contexts.length+1);
      contextIds.set(key,id);
      contexts.push({id,file:rule.file,text:rule.context,sectionTitles:rule.sectionTitles});
    }
    return {file:rule.file,ruleId:rule.ruleId,text:rule.text,contextId:contextIds.get(key),
      parentRuleIds:rule.parents.map(parent=>parent.ruleId)};
  });
  return {patterns:[...patterns.values()],contexts,rules,
    matchedSections:(packet.matchedSections||[]).map(section=>{
      const ruleIds=section.ruleIds.filter(id=>selected.has(section.file+':'+id));
      return {file:section.file,title:section.title,ruleIds,complete:ruleIds.length===section.ruleIds.length};
    }).filter(section=>section.ruleIds.length),coverageLimited:Boolean(packet.coverageLimited)};
}
function uniqueRows(rows) {
  const seen=new Set();
  return rows.filter(row=>{
    const key=row.record.file+':'+row.record.ruleId;
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}
function includeChildren(rows,seeds) {
  const families=new Map();
  for(const row of seeds) {
    const key=numericKey(row.record.ruleId);
    if(!key)continue;
    if(!families.has(row.record.file))families.set(row.record.file,new Set());
    families.get(row.record.file).add(key);
  }
  return uniqueRows([...seeds,...rows.filter(row=>{
    const key=numericKey(row.record.ruleId);
    return key&&[...(families.get(row.record.file)||[])].some(parent=>key.startsWith(parent+'.'));
  })]);
}
function buildAbmKnowledgePacket(source,question,dialogue=[]) {
  const rows=indexFor(source),vocabulary=new Set(rows.flatMap(row=>[...row.weights.keys()]));
  const allParts=String(question).split(/[?\n;]+/u).map(part=>part.trim()).filter(Boolean);
  const parts=(allParts.length?allParts:[String(question)]).slice(0,12);
  const topicalVocabulary=new Set(canonicalTerms(rows.flatMap(row=>[...row.meta,...row.heading])));
  const genericFollowup=new Set(tokens('пример исключение ограничение условие подробности отличие почему если'));
  const hasSubject=value=>expandTerms(value,vocabulary).intentTerms.some(term=>topicalVocabulary.has(term)&&!genericFollowup.has(term));
  const continuation=value=>isMoreRequest(value)||(isFollowup(value)&&!hasSubject(value));
  const previous=recentTopic(dialogue,continuation);
  const historyUsed=continuation(question)&&Boolean(previous);
  const topic=historyUsed?previous:'';
  const expansions=parts.map(part=>expandTerms(isMoreRequest(part)?topic:topic?part+'\n'+topic:part,vocabulary));
  const queries=expansions.map(item=>item.terms);
  const score=(row,query)=>query.reduce((sum,term)=>sum+(row.weights.get(term)||0),0);
  const ranked=queries.map(query=>rows.map(row=>({row,score:score(row,query)}))
    .filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.row.record.file.localeCompare(b.row.record.file)||a.row.record.ruleId.localeCompare(b.row.record.ruleId)));
  const canonicalVocabulary=new Set(canonicalTerms([...vocabulary]));
  const matchedSections=[],frequency=new Map();
  for(const row of rows)for(const term of row.body)frequency.set(term,(frequency.get(term)||0)+1);
  const plans=queries.map((query,index)=>{
    const focused=[],headings=new Map();
    const intent=expansions[index].intentTerms.filter(term=>canonicalVocabulary.has(term));
    // A topic equal to a pattern title requests the pattern, not whichever
    // subsection happens to repeat that title. Specific qualifiers still narrow
    // retrieval normally (e.g. haptic + onboarding must not read every rule).
    const topicIntent=expansions[index].intentTerms;
    const topicFiles=new Set(rows.filter(row=>{
      const title=canonicalTerms(tokens(row.record.pattern));
      return topicIntent.length&&title.length&&topicIntent.every(term=>title.includes(term))
        &&title.every(term=>topicIntent.includes(term));
    }).map(row=>row.record.file));
    if(topicFiles.size) {
      const relevant=rows.filter(row=>topicFiles.has(row.record.file));
      for(const file of topicFiles)if(!matchedSections.some(section=>section.file===file&&section.title===relevant.find(row=>row.record.file===file).record.pattern))
        matchedSections.push({file,title:relevant.find(row=>row.record.file===file).record.pattern,
          ruleIds:relevant.filter(row=>row.record.file===file).map(row=>row.record.ruleId)});
      return relevant;
    }
    for(const row of rows)for(const title of row.sectionHeadings) {
      const matches=tokens(title).filter(term=>query.includes(term)).length;
      // A broad heading must not override a more specific question about an icon,
      // error or exception. Only a heading covering the query intent gets focus.
      const titleTerms=canonicalTerms(tokens(title));
      if(matches&&intent.length&&intent.every(term=>titleTerms.includes(term)))headings.set(row.record.file+'\n'+title,{file:row.record.file,title,matches});
    }
    const bestHeading=Math.max(0,...[...headings.values()].map(item=>item.matches));
    for(const hit of headings.values())if(hit.matches===bestHeading&&bestHeading>0) {
      const relevant=rows.filter(row=>row.record.file===hit.file&&row.sectionHeadings.includes(hit.title));
      if(!matchedSections.some(item=>item.file===hit.file&&item.title===hit.title))
        matchedSections.push({file:hit.file,title:hit.title,ruleIds:relevant.map(row=>row.record.ruleId)});
      focused.push(...relevant);
    }
    const broad=[];
    if(/(?:все|общие|какие|расскажи)[^?]*(?:правил|требован|паттерн)|ptrn:/iu.test(parts[index])) {
      const patterns=new Map();
      for(const row of rows)patterns.set(row.record.file,Math.max(patterns.get(row.record.file)||0,row.meta.filter(term=>query.includes(term)).length));
      const best=Math.max(0,...patterns.values());
      if(best)for(const row of rows)if(patterns.get(row.record.file)===best)broad.push(row);
    }
    // An explicitly named section (or a whole requested pattern) is already a
    // complete scope. Generic button/field matches must not crowd it out.
    if(focused.length||broad.length)return includeChildren(rows,[...focused,...broad]);
    // Reserve the core rules of every explicitly named subject. A four-component
    // question must not lose its definitions to highly ranked detailed guidelines.
    if(parts[index].includes(',')&&intent.length>1) {
      const groups=new Map();
      for(const row of rows) {
        if(!groups.has(row.section))groups.set(row.section,[]);
        groups.get(row.section).push(row);
      }
      const anchors=[...groups.values()].filter(group=>intent.every(term=>group.some(row=>row.keyTerms.includes(term))));
      const files=new Set(anchors.map(group=>group[0].record.file));
      // If the document itself groups all compared components, read that
      // pattern completely rather than expanding generic words across the corpus.
      if(files.size&&files.size<=3) {
        const related=rows.filter(row=>files.has(row.record.file));
        for(const file of files)if(!matchedSections.some(section=>section.file===file&&section.title===related.find(row=>row.record.file===file).record.pattern))
          matchedSections.push({file,title:related.find(row=>row.record.file===file).record.pattern,ruleIds:related.filter(row=>row.record.file===file).map(row=>row.record.ruleId)});
        return related;
      }
    }
    const direct=[];
    for(const term of intent) {
      const matches=rows.filter(row=>row.keyTerms.includes(term)).sort((a,b)=>{
        const depth=key=>(key.match(/\./g)||[]).length;
        return depth(a.record.ruleId)-depth(b.record.ruleId)||a.record.ruleId.localeCompare(b.record.ruleId)||a.record.file.localeCompare(b.record.file);
      });
      direct.push(...matches.slice(0,2));
    }
    const list=ranked[index];
    const threshold=0.4;
    const seeds=list.slice(0,8).filter(item=>item.score>=list[0].score*threshold).map(item=>item.row);
    const patterns=new Set();
    for(const item of list) {
      if(item.score<list[0].score*threshold||patterns.has(item.row.record.file))continue;
      patterns.add(item.row.record.file);seeds.push(item.row);
      if(patterns.size>=3)break;
    }
    const distinctive=query.filter(term=>(frequency.get(term)||Infinity)<=Math.max(12,rows.length*0.08))
      .sort((a,b)=>frequency.get(a)-frequency.get(b)).slice(0,2);
    for(const term of distinctive)for(const row of rows)if(row.body.includes(term))seeds.push(row);
    const related=includeChildren(rows,[...direct,...seeds]);
    const sections=new Set(related.map(row=>row.section));
    return uniqueRows([...related,...rows.filter(row=>sections.has(row.section))]);
  });
  const selected=[],seen=new Set(),omitted=new Set(),lookup=new Map(rows.map(row=>[row.record.file+':'+row.record.ruleId,row]));
  let chars=JSON.stringify(knowledgePayload({rules:selected,matchedSections})).length;
  const add=(row,allowance=Infinity)=>{
    const required=uniqueRows([...row.record.parents.map(parent=>lookup.get(row.record.file+':'+parent.ruleId)).filter(Boolean),row]);
    const pending=required.filter(item=>!seen.has(item.record.file+':'+item.record.ruleId));
    if(!pending.length)return 0;
    const next=[...selected,...pending.map(item=>item.record)];
    const size=JSON.stringify(knowledgePayload({rules:next,matchedSections})).length;
    if(size-chars>allowance)return 0; // Defer large groups until other subjects have a reservation.
    if(next.length>MAX_RULES||size>MAX_PACKET_CHARS){omitted.add(row.record.file+':'+row.record.ruleId);return 0;}
    const added=size-chars;
    chars=size;
    for(const item of pending){seen.add(item.record.file+':'+item.record.ruleId);selected.push(item.record);}
    return added;
  };
  // Reserve space for every question before any broad section can fill the packet.
  const spent=plans.map(()=>0),share=Math.floor(MAX_PACKET_CHARS/Math.max(1,plans.length));
  for(let depth=0;depth<3;depth++)plans.forEach((plan,index)=>{
    if(plan[depth])spent[index]+=add(plan[depth],Math.max(0,share-spent[index]));
  });
  const length=Math.max(0,...plans.map(plan=>plan.length));
  for(let depth=0;depth<length;depth++)for(const plan of plans)if(plan[depth])add(plan[depth]);
  const packet={rules:selected,matchedSections,indexedRules:rows.length,sourceSha:source.contentSha256,
    omittedCandidates:omitted.size,coverageLimited:omitted.size>0||allParts.length>parts.length};
  packet.chars=JSON.stringify(knowledgePayload(packet)).length;
  packet.diagnostics={queryCount:queries.length,historyUsed,typoCorrections:expansions.reduce((sum,item)=>sum+item.typoCorrections,0),
    noCandidates:plans.every(plan=>!plan.length),candidateRules:uniqueRows(plans.flat()).length,
    selectedRules:selected.length,omittedCandidates:omitted.size,queryCoverage:plans.map(plan=>plan.some(row=>seen.has(row.record.file+':'+row.record.ruleId)))};
  return packet;
}
module.exports={buildAbmKnowledgePacket,knowledgePayload,MAX_PACKET_CHARS,MAX_RULES,tokens};
