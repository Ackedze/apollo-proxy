'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const families={hig:'HIG',material2:'Material 2',material3:'Material 3'};
const scalar=(text,key)=>(new RegExp('^'+key+':[ \\t]*(.*)$','m').exec(text)?.[1]||'').trim().replace(/^(["'])(.*)\1$/,'$2');
function layout(root) { return fs.existsSync(path.join(root,'patterns'))?'hub':'original'; }
function safeFile(root,file) {
 if(typeof file!=='string'||!(/^(?:patterns\/)?p_abm_[\p{L}\p{N}_-]+\.md$/u.test(file)||/^guides\/(hig|material2|material3)\/g_[\w-]+\.md$/.test(file)))return null;
 const full=path.join(root,file);
 if(fs.realpathSync(full)!==full)return null;
 let current=path.dirname(full);
 while(current!==root){if(fs.lstatSync(current).isSymbolicLink())return null;current=path.dirname(current);}
 return full;
}
function filesFor(root) {
 if(layout(root)==='original')return fs.readdirSync(root).filter(file=>/^p_abm_.+\.md$/.test(file)).sort();
 const files=[];
 for(const dir of ['patterns',...Object.keys(families).map(f=>'guides/'+f)]) {
  const full=path.join(root,dir);if(!fs.existsSync(full))continue;
  if(fs.lstatSync(full).isSymbolicLink())throw Error('Symlinked ABM directory');
  for(const item of fs.readdirSync(full,{withFileTypes:true})) {
   if(item.isSymbolicLink())throw Error('Symlinked ABM document');
   if(item.isFile()&&item.name.endsWith('.md'))files.push(dir+'/'+item.name);
  }
 }
 return files.sort();
}
function read(root,file) {
 const full=safeFile(root,file);if(!full)return null;
 const text=fs.readFileSync(full,'utf8');
 const front=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
 if(!front)return null;
 return {text,front:front[1],body:text.slice(front[0].length)};
}
function hubPatternMetadata(doc) {
 if(scalar(doc.front,'product')!=='abm'||!scalar(doc.front,'id').startsWith('ptrn:abm.'))return null;
 // Only the leading metadata block is eligible, never a statement inside a rule.
 const header=doc.body.split(/^##\s/m)[0];
 return header.split('\n').filter(line=>/^- (?:abmDocumentType|abmPatternType|abmPatternID|abmPatternTitle|platform|version|updatedAt|editor|tags|titlePage|figma_url):/.test(line)).map(line=>line.slice(2)).join('\n');
}
function loadGuide(root,file,clean) {
 const family=/^guides\/(hig|material2|material3)\//.exec(file)?.[1];if(!family)return null;
 const doc=read(root,file);if(!doc||scalar(doc.front,'product')!=='abm'||!scalar(doc.front,'id').startsWith('abm.guides.'+family+'.'))return null;
 const header=doc.body.split(/^##\s/m)[0];
 if(!/^- documentType:\s*PlatformGuide\s*$/m.test(header))return null;
 const title=/^#\s+(.+)$/m.exec(doc.body)?.[1]?.trim();if(!title)return null;
 const guideId=/^- guideID:\s*(.+)$/m.exec(header)?.[1]?.trim();
 const explicit=scalar(doc.front,'sourceUrl')||/^- sourceUrl:\s*(.+)$/m.exec(header)?.[1]?.trim();
 const sourceUrl=require('./ABM-guide-links').guideUrl({family,guideId,title,explicit});
 const platform=family==='hig'?'ios':'android';
 const expected=new RegExp('^platforms:\\s*\\[\\s*'+platform+'\\s*\\]\\s*$','m');
 if(!expected.test(doc.front))return null;
 const headings=[...doc.body.matchAll(/^(#{1,6})[ \t]+(.+)$/gm)],stack=[],rules=[];
 for(let i=0;i<headings.length;i++) {
  const h=headings[i],level=h[1].length;
  while(stack.length&&stack.at(-1).level>=level)stack.pop();stack.push({level,title:h[2]});
  if(stack.some(x=>/^(?:Resources|Change log|See also|Ресурсы|История изменений)$/i.test(x.title)))continue;
  if(family==='hig'&&stack.some(x=>/^(?:macOS|watchOS|tvOS|visionOS)$/i.test(x.title)))continue;
  let body=doc.body.slice(h.index+h[0].length,headings[i+1]?.index??doc.body.length);
  body=body.replace(/^- (?:documentType|guideID|guideTitle|platform|tags|sourceUrl):[^\n]*$/gm,'').replace(/<[^>]*>/g,'').replace(/\|/g,' ');
  body=clean(body);stack[stack.length-1].body=body;if(!body)continue;
  const names=stack.map(x=>x.title),key='G'+crypto.createHash('sha256').update(names.join('\n')+'\n'+i).digest('hex').slice(0,12);
  rules.push({key,body,headings:names,context:stack.slice(0,-1).map(item=>item.title+'\n'+(item.body||'')).join('\n\n')});
 }
 return {file,title,version:'',patternId:scalar(doc.front,'id'),metadata:family+' '+title+' '+platform,
  sourceType:'guide',family,guideLabel:families[family],platform,sourceUrl,guideTags:(/^- tags:\s*(.+)$/m.exec(header)?.[1]||'').split(',').map(tag=>tag.trim()),rules,examples:[]};
}
module.exports={filesFor,read,hubPatternMetadata,loadGuide,scalar,layout};
