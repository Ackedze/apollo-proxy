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

test('decimal intent distinguishes paraphrases from unrelated numeric topics',()=>{
 const {numberSeparatorIntent,isNumberSeparatorRule}=require('../src/reports/ABM-search-terms');
 for(const q of ['После числа ставить точку или запятую?','Чем отделять копейки?','Как отделить дробную часть?','В числе нужна запятая?'])assert(numberSeparatorIntent(q),q);
 for(const q of ['Подробный ответ','Какой знак валюты ставить после суммы?','Как группировать тысячи в сумме?','Каким шрифтом писать копейки?','Какой цвет у 12.50 ₽?','Точка или запятая в дате?','Точка или запятая в номере телефона?','После числа в конце предложения ставить точку или запятую?','Точка или запятая в коде?'])assert(!numberSeparatorIntent(q),q);
 assert(numberSeparatorIntent('А можно точку вместо запятой?','Форматирование сумм'));
 assert(!isNumberSeparatorRule('Подробный ответ. Завершай точкой.'));
});

test('separate font weight is not confused with separating a fractional part',()=>{
 const {numberSeparatorIntent}=require('../src/reports/ABM-search-terms');
 assert(!numberSeparatorIntent('Копейки отдельно облегчать или весь текст regular делать?'));
});

test('Russian noun declensions share roots across topics instead of depending on the wording',()=>{
 for(const forms of [
 ['анимация','анимации','анимациям','анимациями','анимацией','анимацию','анимациях'],
 ['навигация','навигации','навигациям','навигацией','навигацию'],
 ['рекомендация','рекомендации','рекомендациям','рекомендациями'],
 ['состояние','состояния','состоянием','состоянию'],
 ])assert.equal(new Set(forms.flatMap(tokens)).size,1,forms.join(', '));
});
