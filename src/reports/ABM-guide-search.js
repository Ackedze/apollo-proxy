'use strict';
const {tokens,expandTerms}=require('./ABM-search-terms');
// Search aliases are not translation rules or normative equivalences. A whole
// phrase must match: e.g. a generic hint is not necessarily a placeholder.
const PHRASES=[
 [['область нажатия','область касания','зона нажатия','зона касания','размер области нажатия'],['touch target','touch targets']],
 [['подпись кнопки','текст кнопки','название кнопки','нейминг кнопок'],['button label','button labels','button naming']],
 [['внутренний отступ'],['padding']],
 [['внешний отступ'],['margin','margins']],
 [['расстояние между элементами','интервал между элементами'],['spacing']],
 [['контраст','контрастность','контраст текста'],['contrast','contrast ratio']],
 [['цветовая роль','роль цвета'],['color role','color roles']],
 [['цвет поверхности'],['surface color']],
 [['высота поверхности'],['elevation']],
 [['тональная кнопка'],['filled tonal button']],
 [['состояние нажатия','состояние нажатой кнопки'],['pressed state']],
 [['выбранное состояние','состояние выбранного элемента'],['selected state']],
 [['отключенная кнопка','недоступное состояние'],['disabled state']],
 [['состояние фокуса','индикатор фокуса'],['focus state','focus indicator']],
 [['экранный диктор','программа экранного доступа'],['screen reader','screen readers']],
 [['вспомогательный текст','поддерживающий текст'],['supporting text','helper text']],
 [['плейсхолдер','заполнитель поля'],['placeholder']],
 [['нижняя шторка','модальная шторка'],['bottom sheet','bottom sheets']],
 [['снекбар','снэкбар'],['snackbar','snackbars']],
 [['масштабирование текста','увеличение текста'],['text scaling','text resizing']],
 [['тактильный отклик','тактильная обратная связь','виброотклик'],['haptic feedback','haptics']],
].map(([phrases,aliases])=>({phrases:phrases.map(tokens),terms:[...new Set(aliases.flatMap(tokens))],aliases:aliases.map(tokens)}));
const KNOWN=new Set(PHRASES.flatMap(row=>[...row.phrases.flat(),...row.terms]));
function expandGuideTerms(value,vocabulary=new Set()) {
 const raw=new Set(tokens(value));
 const base=expandTerms(value,new Set([...vocabulary,...KNOWN]));
 const matches=PHRASES.filter(row=>[...row.phrases,...row.aliases].some(phrase=>phrase.every(term=>raw.has(term))));
 const terms=new Set(base.terms);
 // The old generic spacing alias helps pattern lookup. For explicit guide
 // queries keep padding and margin separate rather than treating them as synonyms.
 if(matches.some(row=>row.terms.includes('padding')||row.terms.includes('margin')||row.terms.includes('spacing')))
  for(const term of ['padding','margin','margins','spacing'])terms.delete(term);
 for(const row of matches)for(const term of row.terms)terms.add(term);
 return {...base,terms:[...terms],matchedPhrases:matches.length,phrases:matches.flatMap(row=>row.aliases)};
}
// Metadata platform:android does not distinguish a phone from Wear/XR. Use the
// actual document/section scope, never the user's platform picker or body word
// mentions (a mobile rule can compare itself to desktop and still be relevant).
const NON_MOBILE=/\b(?:watches|watchos|apple\s+watch|wear\s*os|wearables?|xr|ar\s*\/\s*vr|virtual\s+reality|augmented\s+reality|visionos|macos|tvos|desktop|desktops|laptops?|computers?|televisions?|android\s+tv|google\s+tv|chrome\s*os|carplay|android\s+auto|automotive)\b|^(?:tv|apple tv)(?: interfaces?| devices?| layouts?| screens?)?$|час(?:ы|ов|ах)|телевизор|настольн[а-я]*\s+(?:компьютер|интерфейс)|автомобильн[а-я]*\s+интерфейс/iu;
const MOBILE_SCOPE=/\b(?:phones?|iphones?|tablets?|ipads?|foldables?|ios|ipados|mobile)\b|телефон|планшет|мобильн/iu;
function isMobileGuideSection(row) {
 return ![row.pattern,...(row.sectionTitles||[])].some(title=>NON_MOBILE.test(title)&&!MOBILE_SCOPE.test(title));
}

// null leaves the source choice unchanged; an empty family list explicitly selects patterns only.
function readGuideRequest(value) {
 const text=String(value),families=new Set();let generic=false,excluded=false;
 const negative=index=>/(?:^|\s)(?:не|без)\s+(?:(?:в|из|используй|показывай|ищи|бери)\s+)?$/iu.test(text.slice(0,index));
 const patterns=/(?<![\p{L}\p{N}])(?:только\s+(?:(?:по|из)\s+)?паттерн[а-я]*|only\s+patterns?)(?![\p{L}\p{N}])/giu;
 if([...text.matchAll(patterns)].some(match=>!negative(match.index)))return {families:[]};
 const names=/(?<![\p{L}\p{N}])(?:hig|hik|хи[гк]|human\s+interface\s+guidelines|material(?:\s*design)?(?:\s*[23])?|материал\s*[23])(?![\p{L}\p{N}])/giu;
 for(const match of text.matchAll(names)) {
  if(negative(match.index))continue;
  if(/^(?:hi[gk]|хи|human)/iu.test(match[0]))families.add('hig');
  else {const version=/[23]$/.exec(match[0])?.[0];for(const family of version?['material'+version]:['material2','material3'])families.add(family);}
 }
 const guides=/(?<![\p{L}\p{N}])(?:гайд(?:лайн)?(?:ы|а|е|у|ов|ам|ами|ах)?|guides?|guidelines?)(?![\p{L}\p{N}])/giu;
 for(const match of text.matchAll(guides))if(negative(match.index))excluded=true;else generic=true;
 return families.size||generic?{families:families.size?[...families]:['hig','material2','material3']}:excluded?{families:[]}:null;
}
const GUIDE_QUERY_WORDS=new Set(tokens('hig hik хиг хик human interface guide guides guidelines гайд гайды гайдах гайдов гайдлайн гайдлайны material material2 material3 design материал говорит говорят сказано написано написан рекомендует рекомендуют расскажи покажи what says say tell about'));
function guideTopicalTerms(terms) {return terms.filter(term=>!GUIDE_QUERY_WORDS.has(term)&&!/^\d+$/.test(term));}

module.exports={expandGuideTerms,isMobileGuideSection,readGuideRequest,guideTopicalTerms};
