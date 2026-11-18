'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {expandGuideTerms,isMobileGuideSection}=require('../src/reports/ABM-guide-search');
const {expandTerms}=require('../src/reports/ABM-search-terms');
test('guide phrase aliases bridge Russian design questions to English without conflating nearby concepts',()=>{
 for(const [query,terms] of [
  ['Размер области нажатия',['touch','target']],['Подпись кнопки',['button','label']],
  ['Внешние отступы',['margin']],['Внутренние отступы',['padding']],
  ['Расстояние между элементами',['spacing']],['Состояние нажатия',['pressed']],
  ['Выбранное состояние',['selected']],['Экранный диктор',['screen','reader']],
  ['Тактильный отклик',['haptic']],['Контраст текста',['contrast']],
 ])for(const term of terms)assert(expandGuideTerms(query).terms.includes(term),query+' -> '+term);
 assert(!expandGuideTerms('Внешний отступ').terms.includes('padding'));
 assert(!expandGuideTerms('Внутренний отступ').terms.includes('margin'));
 assert(!expandGuideTerms('Расстояние между элементами').terms.includes('padding'));
 assert(!expandGuideTerms('Выбранное состояние').terms.includes('pressed'));
 assert(!expandGuideTerms('Состояние нажатия').terms.includes('selected'));
 assert(!expandGuideTerms('Подсказка').terms.includes('placeholder'));
 assert(!expandGuideTerms('Тост').terms.includes('snackbar'));
 assert(!expandGuideTerms('Тень').terms.includes('elevation'));
 assert(!expandTerms('Область нажатия').terms.includes('touch'),'guide aliases do not change the pattern vocabulary');
});
test('device scope excludes whole non-mobile guides and nested sections but keeps shared phone and tablet guidance',()=>{
 for(const scope of ['Design for watches — Styles','Design for immersive XR — Interaction','macOS','Desktop layouts','Android TV','TV','Apple TV','CarPlay','Wear OS'])
  assert.equal(isMobileGuideSection({pattern:'Buttons',sectionTitles:['Buttons',scope,'Best practices']}),false,scope);
 assert.equal(isMobileGuideSection({pattern:'Design for watches — Foundations',sectionTitles:['Physical buttons']}),false);
 for(const title of ['iOS','Android','iPadOS','Tablets','Foldables','Phone layouts','Adaptive layouts','Mobile and desktop layouts','Integrating with the TV app'])
  assert.equal(isMobileGuideSection({pattern:'Buttons',sectionTitles:['Buttons',title]}),true,title);
 assert(isMobileGuideSection({pattern:'Buttons',sectionTitles:['Best practices'],text:'Unlike desktop, phones use touch targets.'}));
});
