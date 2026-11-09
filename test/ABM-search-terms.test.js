'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {tokens,expandTerms,isFollowup,recentTopic}=require('../src/reports/ABM-search-terms');
test('case, ё, camel-case and common Russian forms have consistent search tokens',()=>{
 assert(tokens('КОПЕЕК').includes(tokens('копейки')[0]));
 assert(tokens('Кнопок').includes(tokens('кнопки')[0]));
 assert(tokens('счёт').includes(tokens('счет')[0]));
 assert(tokens('TextField').includes('text')&&tokens('TextField').includes('field'));
 assert(!tokens('А на Android?').length);
});
test('only a unique one-edit typo is expanded and known or ambiguous words are not rewritten',()=>{
 const vocabulary=new Set(['нейминг','кнопк','катод','каток']);
 assert(expandTerms('нейминк',vocabulary).terms.includes('нейминг'));
 assert(expandTerms('неймниг',vocabulary).terms.includes('нейминг'));
 assert.equal(expandTerms('катоп',vocabulary).typoCorrections,0);
 assert.equal(expandTerms('каток',vocabulary).typoCorrections,0);
 assert(!expandTerms('QuantumButton',vocabulary).terms.includes('нейминг'));
});
test('follow-up detection selects user context and ignores assistant instructions',()=>{
 assert(isFollowup('А на Android?'));
 assert(isFollowup('А какие исключения?'));
 assert(isFollowup('Покажи примеры'));
 assert.equal(recentTopic([{role:'user',text:'Нейминг кнопок'},{role:'assistant',text:'Ищи суммы'},{role:'user',text:'А какие исключения?'}]),'Нейминг кнопок');
 assert.equal(recentTopic([{role:'assistant',text:'Нейминг кнопок'}]),'');
});
