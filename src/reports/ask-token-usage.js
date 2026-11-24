'use strict';
const number=value=>new Intl.NumberFormat('ru-RU').format(value);
function withAskTokenUsage(response,usage,enabled=false) {
 if(!enabled)return response;
 let text;
 if(!usage||usage.totalTokens===null)text='Токены: агент не передал полный расход.';
 else {
  const cached=usage.cachedInputTokens===null?'':` (из них кеш: ${number(usage.cachedInputTokens)})`;
  text=`Токены: всего ${number(usage.totalTokens)} · вход ${number(usage.inputTokens)}${cached} · выход ${number(usage.outputTokens)}.`;
 }
 const footer='*'+text+'*',result={...response,tokenUsage:usage};
 if(typeof response.result==='string') {
  result.result=response.result+'\n\n'+footer;
  if(Array.isArray(response.answerBlocks))result.answerBlocks=[...response.answerBlocks,{kind:'text',text:footer}];
 }else if(typeof response.error==='string')result.error=response.error+'\n\n'+text;
 return result;
}
module.exports={withAskTokenUsage};
