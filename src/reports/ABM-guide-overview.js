'use strict';
const {tokens,canonicalTerms}=require('./ABM-search-terms');
const FRAMING=new Set(tokens('the a an understanding overview introduction foundations foundation system systems principles using guide guidelines вид виды тип типы разновидности существуют перечисли список обзор доступные'));
const concepts=value=>canonicalTerms(tokens(value)).filter(term=>!FRAMING.has(term));
function equalTopic(a,b) {return a.length&&b.length&&a.every(term=>b.includes(term))&&b.every(term=>a.includes(term));}
function guideOverview(rows,query) {
 const intent=canonicalTerms(query).filter(term=>!FRAMING.has(term));
 if(!intent.length)return null;
 const eligible=rows.filter(row=>!row.record.guideTags?.some(tag=>['case-study','material-studies'].includes(tag))
   ||concepts(row.record.pattern).every(term=>intent.includes(term)));
 const primary=new Set(eligible.filter(row=>equalTopic(intent,concepts(row.record.pattern))).map(row=>row.record.file));
 const anchors=eligible.filter(row=>row.sectionHeadings.length>1&&equalTopic(intent,concepts(row.sectionHeadings.at(-1))));
 const sections=eligible.filter(row=>anchors.some(anchor=>anchor.record.file===row.record.file
  &&anchor.sectionHeadings.every((title,index)=>row.sectionHeadings[index]===title)));
 if(!primary.size&&!sections.length)return null;
 const documents=[...primary].map(file=>eligible.filter(row=>row.record.file===file&&tokens(row.record.text).length>=2)
  .sort((a,b)=>a.sectionHeadings.length-b.sectionHeadings.length))
  .sort((a,b)=>a.reduce((n,row)=>n+row.record.text.length,0)-b.reduce((n,row)=>n+row.record.text.length,0));
 const result=[...documents.map(doc=>doc[0]).filter(Boolean),...sections.sort((a,b)=>b.record.text.length-a.record.text.length)];
 for(const doc of documents)result.push(...doc.slice(1));
 return result;
}
module.exports={guideOverview};
