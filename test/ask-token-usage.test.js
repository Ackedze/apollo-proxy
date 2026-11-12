const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTokenJournal}=require('../src/token-journal');
const {withAskTokenUsage}=require('../src/reports/ask-token-usage');
test('usage is request-scoped; cached input is already included in the total',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ask-usage-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const journal=createTokenJournal(root);t.after(()=>journal.close());
 const first=journal.begin('First'),second=journal.begin('Second');
 async function measured(entry,input,output,cached,delay){return journal.within(entry,async()=>{
  const call=journal.call({provider:'claude'});call.event({type:'turn.started'});
  await new Promise(resolve=>setTimeout(resolve,delay));
  call.event({type:'turn.completed',usage:{input_tokens:input,output_tokens:output,cached_input_tokens:cached}});call.end();
  return journal.snapshotUsage();
 });}
 const [a,b]=await Promise.all([measured(first,100,20,80,10),measured(second,300,40,200,1)]);
 assert.deepEqual(a,{inputTokens:100,outputTokens:20,cachedInputTokens:80,totalTokens:120,calls:1});assert.equal(b.totalTokens,340);
 assert.equal(journal.snapshotUsage(),null);
 const response={result:'Answer',answerBlocks:[{kind:'text',text:'Answer'}]};
 assert.equal(withAskTokenUsage(response,a,false),response);
 const shown=withAskTokenUsage(response,a,true);assert.match(shown.result,/всего 120/);assert.match(shown.result,/кеш: 80/);
 assert.equal(shown.answerBlocks.map(b=>b.text).join('\n\n'),shown.result);assert.deepEqual(response.answerBlocks,[{kind:'text',text:'Answer'}]);
});
test('unknown usage is not shown as zero, while a request without model calls has zero usage',t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ask-usage-missing-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const journal=createTokenJournal(root);t.after(()=>journal.close());
 journal.within(journal.begin('Notice'),()=>{
  assert.equal(journal.snapshotUsage().totalTokens,0);
  const call=journal.call({provider:'claude'});call.end();
  const usage=journal.snapshotUsage();assert.equal(usage.totalTokens,null);
  const result=withAskTokenUsage({result:'Answer'},usage,true);assert(result.result.includes('не передал полный расход'));assert(!result.result.includes('всего 0'));
  const error=withAskTokenUsage({error:'Failed',code:'FIXTURE'},usage,true);assert.equal(error.code,'FIXTURE');assert(error.error.includes('не передал полный расход'));
 });
});
