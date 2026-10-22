'use strict';
const {sourceOf,contentUrl,advertisedCommit}=require('../../scripts/git-data-cli');
const {validateManifest,sha}=require('./store');
const INDEX_URL='https://raw.githubusercontent.com/Ackedze/apollo-proxy/main/code-packages/current.json';
async function bytes(url,limit,token,request=fetch) {
  const r=await request(url,{redirect:'error',signal:AbortSignal.timeout(60000),headers:{'User-Agent':'ApolloProxyControl',
    'Cache-Control':'no-cache',...(token?{Authorization:'Bearer '+token}:{})}});
  if (!r.ok) throw Object.assign(Error('CODE_GIT_HTTP_'+r.status),{code:'CODE_GIT_HTTP_'+r.status});
  const parts=[];let length=0;
  for await(const part of r.body) { length+=part.length;if(length>limit)throw Error('CODE_DOWNLOAD_TOO_LARGE');parts.push(part); }
  return Buffer.concat(parts);
}
async function check(profile,{token,request=fetch}={}) {
  const source=sourceOf(INDEX_URL);
  const refs=await bytes('https://github.com/'+source.owner+'/'+source.repo+'.git/info/refs?service=git-upload-pack',1024*1024,token,request);
  const commit=advertisedCommit(refs,source.ref);
  const index=JSON.parse((await bytes(contentUrl(source,commit,source.file),512*1024,token,request)).toString());
  if(index?.schemaVersion!=='apollo.git-code-index.v1')throw Error('CODE_INDEX_INVALID');
  validateManifest(index.manifest,profile);
  if(!index.manifest.sourceCommit)throw Error('CODE_COMMIT_REQUIRED');
  const a=index.archive;
  if(!a || a.path!=='code-packages/releases/'+index.manifest.id+'.tgz' || !/^[a-f0-9]{64}$/.test(a.sha256 || '')
    || !Number.isSafeInteger(a.bytes) || a.bytes<1 || a.bytes>16*1024*1024)throw Error('CODE_INDEX_INVALID');
  return {sourceCommit:commit,manifest:index.manifest,archive:a,url:contentUrl(source,commit,a.path)};
}
async function download(selected,options={}) {
  const data=await bytes(selected.url,selected.archive.bytes,options.token,options.request);
  if(data.length!==selected.archive.bytes || sha(data)!==selected.archive.sha256)throw Error('CODE_ARCHIVE_INTEGRITY');
  return data;
}
module.exports={INDEX_URL,check,download};
