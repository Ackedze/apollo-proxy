'use strict';
const index=require('./ABM-guide-links.json');
function safeGuideUrl(value,family) {
 if(typeof value!=='string'||/[\x00-\x20]/.test(value))return null;
 try {
  const url=new URL(value);
  const hosts={hig:'developer.apple.com',material2:'m2.material.io',material3:'m3.material.io'};
  if(url.protocol!=='https:'||url.hostname!==hosts[family]||url.username||url.password||url.port||url.search)return null;
  if(family==='hig'&&!/^\/design\/human-interface-guidelines(?:\/|$)/.test(url.pathname))return null;
  if(family!=='hig'&&url.pathname==='/')return null;
  return url.href.replace(/\(/g,'%28').replace(/\)/g,'%29');
 }catch{return null;}
}
function guideUrl({family,guideId,title,explicit}) {
 if(explicit)return safeGuideUrl(explicit,family);
 const entry=index.entries[guideId];
 return entry&&entry.family===family&&entry.title===title?safeGuideUrl(entry.url,family):null;
}
module.exports={guideUrl,safeGuideUrl};
