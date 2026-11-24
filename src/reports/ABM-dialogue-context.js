'use strict';
const MAX_HISTORY_ITEMS=30,MAX_HISTORY_CHARS=12000;
function sourceReferences(dialogue) {
 const refs=new Map();
 for(const entry of dialogue) {
  if(entry?.role!=='assistant'||typeof entry.text!=='string')continue;
  for(const match of entry.text.matchAll(/(?:^|\n)Гайд: (HIG|Material 2|Material 3) — (?:\[([^\]\n]+)\](?:\([^\n]*\))?|([^\n]+))/gu)) {
   const family={HIG:'hig','Material 2':'material2','Material 3':'material3'}[match[1]],title=(match[2]||match[3]).trim();
   const key=family+':'+title;refs.delete(key);refs.set(key,{family,title,label:match[1]});
  }
 }
 return [...refs.values()];
}
function compact(text,limit,role) {
 if(text.length<=limit)return text;
 const references=role==='assistant'?sourceReferences([{role,text}]).slice(-1).map(ref=>'Гайд: '+ref.label+' — '+ref.title.slice(0,80)).join('\n'):'';
 const room=limit-(references?references.length+1:0);
 const head=Math.floor((room-3)*0.7);
 return text.slice(0,head)+'\n…\n'+text.slice(-(room-head-3))+(references?'\n'+references:'');
}
// Keep a bounded excerpt of every exchange, without a summarizing model call.
function normalizeAbmDialogue(value) {
 if(!Array.isArray(value))return [];
 const entries=value.filter(entry=>['user','assistant'].includes(entry?.role)&&typeof entry.text==='string'&&entry.text.trim()).slice(-MAX_HISTORY_ITEMS);
 return entries.map((entry,index)=>({role:entry.role,text:compact(entry.text.trim(),index===entries.length-1?5000:index===entries.length-2?1400:200,entry.role)}));
}
module.exports={normalizeAbmDialogue,sourceReferences,MAX_HISTORY_ITEMS,MAX_HISTORY_CHARS};
