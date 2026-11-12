#!/usr/bin/env python3
"""Run the formal text checks using the admitted rule data."""
import json
import re
import sys
import unicodedata

NBSP = '\u00a0'
NNBSP = '\u202f'
NBH = '\u2011'
SP = r'[ \u00a0\u202f]'

SKIP_ROLES = {'product_name', 'stub'}
KNOWN_ROLES = {'title', 'subtitle', 'description', 'button', 'link', 'label',
               'placeholder', 'hint', 'error', 'caption', 'tooltip', 'plate',
               'amount', 'status', 'tab', 'stepper', 'navigation', 'product_name',
               'stub'}
NO_DOT_ROLES = {'title', 'subtitle', 'button', 'link', 'tab', 'status', 'label',
                'placeholder', 'stepper', 'navigation'}
CAPITAL_ROLES = {'title', 'subtitle', 'description', 'button', 'label', 'hint',
                 'error', 'tooltip', 'tab'}

STUB_RX = re.compile(r'^\s*(text|title|subtitle|label|lorem ipsum.*|заголовок|'
                     r'подзаголовок|текст|описание|кнопка|button)\s*$', re.I)

GLUE_RX = re.compile(r'(?<![\w\-\u2011])([А-Яа-яЁё]{1,4})' + r'[ ]+' + r'(?=\S)')

CURRENCY_CODES = r'(?:RUB|USD|EUR|CNY|GBP|CHF|JPY|AED|KZT|BYN|AMD|KGS|TRY|HKD|BTC|ETH|USDT|pt\.)'
MONTHS_SHORT = r'(?:янв|фев|мар|апр|авг|сен|окт|ноя|дек)'
DAYS_SHORT = r'(?:пн|вт|ср|чт|пт|сб|вс)'
def norm(s):
    return unicodedata.normalize('NFC', s).replace(NBH, '-')


def item(t, **kw):
    base = {'screen': t.get('screen'), 'node': t.get('node'),
            'layer': t.get('layer'), 'role': t.get('role'), 'text': t['text']}
    base.update(kw)
    return base


def word_re(variant):
    v = norm(variant)
    v = re.sub(r'\s*\[[^\]]*\]\s*', '〔〕', v)
    esc = re.escape(v).replace('〔〕', r'\s+[а-яё][^.!?\n]*')
    esc = esc.replace(r'\ ', SP)
    return re.compile(r'(?<![\w-])' + esc + r'(?![\w-])')


def case_mode(write, avoid):
    if norm(write).lower() == norm(avoid).lower():
        return True
    return avoid[1:] != avoid[1:].lower()


def check_glossary(texts, glossary):
    findings, candidates = [], []
    for row in glossary:
        cs = case_mode(row['write'], row['avoid'])
        rx = word_re(row['avoid'])
        if not cs:
            rx = re.compile(rx.pattern, re.IGNORECASE)
        for t in texts:
            m = rx.search(norm(t['text']))
            if not m:
                continue
            need = rules['sectionRoles'].get(row['section'])
            role = t.get('role') or ''
            r = row
            if need:
                if role in KNOWN_ROLES and role not in need:
                    continue
                if role not in KNOWN_ROLES:
                    r = dict(row, needs_confirmation='yes',
                             context=(row['context'] + '; ' if row['context'] else '')
                             + copy['roleContext'].format(row['section'][:-1]))
            f = item(t, type=copy['policyType'] if row['section'] in
                     (copy['policySection1'], copy['policySection2']) else copy['glossaryType'],
                     rule=copy['glossaryPrefix'] + row['section'], severity=row['severity'],
                     found=m.group(0), write=row['write'], context=r['context'])
            (candidates if r['needs_confirmation'] == 'yes' else findings).append(f)
    return findings, candidates


def autofix(text, role):
    notes, s = [], text

    def sub(rx, repl, note, flags=0):
        nonlocal s
        new, n = re.subn(rx, repl, s, flags=flags)
        if n and new != s:
            s = new
            notes.append(note)

    sub(r'(?<=\S) {2,}(?=\S)', ' ', copy['doubleSpace'])
    sub(r'"([^"\n]+)"', '«\\1»', copy['curlyQuotes'])
    sub(r'\b(' + MONTHS_SHORT + r')\.', r'\1', copy['monthPeriod'], re.I)
    sub(r'\b(' + DAYS_SHORT + r')\.(?=\s|$)', r'\1', copy['dayPeriod'], re.I)
    sub(r'\b(млн|млрд|трлн)\.', r'\1', copy['abbreviations'])
    sub(r'\b0(\d)(?=' + SP + r'+(?:янв|фев|мар|апр|ма[яй]|июн|июл|авг|сен|окт|ноя|дек))',
        r'\1', copy['dateZero'])
    sub(r'\b(\d+)\.(\d+)(?=' + SP + r'*(?:₽|%|млн|млрд|трлн))', r'\1,\2',
        copy['decimalComma'])
    sub(r'https?://(?:www\.)?', '', copy['urlScheme'])
    sub(r'(?<![\w/])www\.', '', copy['urlWww'])
    sub(r'(?<=[А-Яа-яЁёA-Za-z])–(?=[А-Яа-яЁёA-Za-z])', '-', copy['compoundDash'])
    sub(r'(?:(?<=\s)|^)-' + SP + r'?(?=\d[\d \u00a0\u202f]*(?:,\d+)?' + SP + r'*(?:₽|' + CURRENCY_CODES + r'))',
        '−', copy['minusSign'])
    sub(r'(?:(?<=\s)|^)([−+])' + SP + r'+(?=\d[\d \u00a0\u202f]*(?:,\d+)?' + SP + r'*(?:₽|' + CURRENCY_CODES + r'))',
        r'\1', copy['amountSign'])
    def phone(m):
        return m.group(0).replace(' ', NBSP)
    new = re.sub(r'(?:\+7|8)(?: \d{3} \d{3} \d{2} \d{2})', phone, s)
    if new != s:
        s = new
        notes.append(copy['phoneSpaces'])
    def regroup(m):
        num, tail = m.group(1), m.group(2)
        digits = re.sub(r'\D', '', num)
        if len(digits) < 5:
            return m.group(0)
        return '{:,}'.format(int(digits)).replace(',', NNBSP) + tail
    new = re.sub(r'(?<![\d,.№])(\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d{5,})(' + SP +
                 r'*(?:₽|%|' + CURRENCY_CODES + r'|млн|млрд|руб))', regroup, s)
    new = re.sub(r'(?<![\d,.\u00a0])(\d{1,3}(?:[ \u202f]\d{3})+)(?![\d\u00a0])()', regroup, new)
    if role == 'amount':
        new = re.sub(r'(?<![\d,.])(\d{5,})(?![\d])()', regroup, new)
    if new != s:
        s = new
        notes.append(copy['numberGroups'])
    sub(r'(?<=\d)[ \u00a0]*(?=₽)', NNBSP, copy['rubleSpace'])
    sub(r'(?<=млн|лрд|рлн)[ \u00a0]+(?=₽)', NNBSP, copy['rubleSpace'])
    sub(r'(?<=\d)[ \u00a0]+(?=' + CURRENCY_CODES + r'\b)', NNBSP, copy['currencySpace'])
    sub(r'(?<=\d) +(?=(?:млн|млрд|трлн)\b)', NBSP, copy['multiplierSpace'])
    sub(r'(?<=\d)' + SP + r'+%', '%', copy['percentSpace'])
    sub(r'№[ \u00a0]*(?=\d)', '№' + NNBSP, copy['numberSymbolSpace'])
    sub(r'~' + SP + r'+(?=\d)', '~', copy['approximationSpace'])
    sub(r'(?<=[\d%₽:])' + SP + r'*–' + SP + r'*(?=[\d−])', NNBSP + '–' + NNBSP,
        copy['rangeDash'])
    sub(r'(?<=\S) +—', NBSP + '—', copy['sentenceDash'])
    glued = []

    def glue(m):
        w = m.group(1)
        if w.lower() in rules['words']:
            glued.append(w)
            return w + NBSP
        return m.group(0)
    s = GLUE_RX.sub(glue, s)
    if glued:
        uniq = list(dict.fromkeys(glued))
        notes.append(copy['gluePrefix'] + ', '.join(f'«{w}»' for w in uniq))
    if role in CAPITAL_ROLES and re.match(r'^\s*[а-яё]', s):
        i = len(s) - len(s.lstrip())
        s = s[:i] + s[i].upper() + s[i + 1:]
        notes.append(copy['leadingCapital'])
    if role in NO_DOT_ROLES and re.search(r'(?<!\.)\.\s*$', s) and not re.search(r'\b(?:т\.\s?д|т\.\s?п|др|руб|г|ул|д)\.\s*$', s):
        s = re.sub(r'\.\s*$', '', s)
        notes.append(copy['trailingPeriod'])
    return s, list(dict.fromkeys(notes))


def check_autofix(texts):
    findings, fixed_map = [], {}
    for t in texts:
        fixed, notes = autofix(t['text'], t.get('role'))
        fixed_map[id(t)] = fixed
        if not notes or fixed == t['text']:
            continue
        findings.append(item(t, type=copy['typographyType'], rule=copy['autofixRule'],
                             severity='🟡', found='; '.join(notes),
                             write='; '.join(notes).capitalize(), fixed_text=fixed,
                             context=''))
    return findings, fixed_map


def check_rules(texts, fixed_map):
    findings, candidates = [], []
    for t in texts:
        role = t.get('role') or ''
        txt = norm(fixed_map.get(id(t), t['text']))
        for name, rx, sev, msg, confirm, roles in rules['checks']:
            if roles is not None and role not in roles:
                continue
            if name == copy['singleParagraphRule'] and re.search(r'\n\s*\n', txt):
                continue
            for m in re.finditer(rx, txt):
                f = item(t, type=copy['typographyType'], rule=copy['guidePrefix'] + name, severity=sev,
                         found=m.group(0), write=msg, context='')
                (candidates if confirm else findings).append(f)
                break
        if role == 'plate':
            m = re.match(r'^\s*([а-яё])', txt)
            if m:
                candidates.append(item(t, type=copy['typographyType'], rule=copy['plateCapitalRule'],
                                       severity='🟡', found=txt[:20],
                                       write=copy['plateCapitalMessage'],
                                       context=''))
        if role == 'button':
            words = re.findall(r'[А-ЯЁA-Za-zа-яё][\w-]*', txt)
            caps = [w for w in words[1:] if w[0].isupper()]
            if caps:
                candidates.append(item(t, type=copy['typographyType'], rule=copy['buttonCapitalRule'],
                                       severity='🟡', found=', '.join(caps),
                                       write=copy['buttonCapitalMessage'],
                                       context=copy['buttonCapitalContext']))
        if role == 'link':
            low = txt.strip().lower().rstrip('.,;:')
            if low in rules['vagueLinks']:
                findings.append(item(t, type=copy['policyType'], rule=copy['vagueLinkRule'],
                                     severity='🔴', found=txt,
                                     write=copy['vagueLinkMessage'],
                                     context=''))
            if re.search(r'[.,;:]\s*$', txt):
                findings.append(item(t, type=copy['typographyType'], rule=copy['linkPunctuationRule'],
                                     severity='🟡', found=txt[-1],
                                     write=copy['linkPunctuationMessage'], context=''))
            if len(re.findall(r'\S+', txt)) > 4:
                candidates.append(item(t, type=copy['policyType'], rule=copy['linkLengthRule'],
                                       severity='🟡', found=txt,
                                       write=copy['linkLengthMessage'], context=''))
    return findings, candidates


def check_hygiene(texts):
    out = []
    for t in texts:
        role = t.get('role') or ''
        if role == 'stub' or STUB_RX.match(t['text']):
            out.append(item(t, type=copy['hygieneType'], rule=copy['stubRule'],
                            severity='ℹ️', found=t['text'],
                            write=copy['stubMessage']))
        elif role not in KNOWN_ROLES:
            out.append(item(t, type=copy['hygieneType'], rule=copy['unknownRoleRule'],
                            severity='ℹ️', found=t.get('layer') or '',
                            write=copy['unknownRoleMessage']))
        if t.get('opacity') is not None and t['opacity'] == 0:
            out.append(item(t, type=copy['hygieneType'], rule=copy['transparentRule'],
                            severity='ℹ️', found='opacity 0',
                            write=copy['transparentMessage']))
    return out


def run(payload, glossary):
    texts = [t for t in payload.get('texts', []) if (t.get('text') or '').strip()]
    hygiene = check_hygiene(texts)
    stub_nodes = {h['node'] for h in hygiene if h['rule'] == copy['stubRule']}
    checkable = [t for t in texts
                 if t.get('role') not in SKIP_ROLES and t.get('node') not in stub_nodes]
    gf, gc = check_glossary(checkable, glossary)
    af, fixed_map = check_autofix(checkable)
    rf, rc = check_rules(checkable, fixed_map)
    findings, cands = gf + af + rf, gc + rc
    return {'findings': findings, 'model_candidates': cands, 'hygiene': hygiene,
            'stats': {'texts': len(texts), 'checked': len(checkable),
                      'glossary_pairs': len(glossary), 'findings': len(findings),
                      'model_candidates': len(cands), 'hygiene': len(hygiene)}}


def validate_rules(data):
    if (not isinstance(data, dict) or data.keys() !=
            {'schemaVersion', 'checks', 'words', 'vagueLinks', 'sectionRoles', 'copy'} or data['schemaVersion'] != 1):
        raise ValueError('Invalid UX-writer rule profile')

    def valid_text(value):
        return isinstance(value, str) and 0 < len(value) <= 1024

    def text_list(values):
        return isinstance(values, list) and 0 < len(values) <= 256 and all(map(valid_text, values))

    required_copy = {
        'abbreviations', 'amountSign', 'approximationSpace', 'autofixRule',
        'buttonCapitalContext', 'buttonCapitalMessage', 'buttonCapitalRule', 'compoundDash',
        'curlyQuotes', 'currencySpace', 'dateZero', 'dayPeriod',
        'decimalComma', 'doubleSpace', 'glossaryPrefix', 'glossaryType',
        'gluePrefix', 'guidePrefix', 'hygieneType', 'leadingCapital',
        'linkLengthMessage', 'linkLengthRule', 'linkPunctuationMessage', 'linkPunctuationRule',
        'minusSign', 'monthPeriod', 'multiplierSpace', 'numberGroups',
        'numberSymbolSpace', 'percentSpace', 'phoneSpaces', 'plateCapitalMessage',
        'plateCapitalRule', 'policySection1', 'policySection2', 'policyType',
        'rangeDash', 'roleContext', 'rubleSpace', 'sentenceDash',
        'singleParagraphRule', 'stubMessage', 'stubRule', 'trailingPeriod',
        'transparentMessage', 'transparentRule', 'typographyType', 'unknownRoleMessage',
        'unknownRoleRule', 'urlScheme', 'urlWww', 'vagueLinkMessage',
        'vagueLinkRule',
    }
    if (not text_list(data['words']) or not text_list(data['vagueLinks'])
            or not isinstance(data['sectionRoles'], dict) or not data['sectionRoles']
            or not all(valid_text(k) and text_list(v) for k, v in data['sectionRoles'].items())
            or not isinstance(data['copy'], dict) or data['copy'].keys() != required_copy
            or not all(map(valid_text, data['copy'].values()))
            or not isinstance(data['checks'], list) or not 0 < len(data['checks']) <= 64):
        raise ValueError('Invalid UX-writer rule profile')
    checks = []
    for row in data['checks']:
        if (not isinstance(row, list) or len(row) != 6 or not all(map(valid_text, row[:4]))
                or not isinstance(row[4], bool) or (row[5] is not None and not text_list(row[5]))):
            raise ValueError('Invalid UX-writer check')
        checks.append([row[0], re.compile(row[1]), *row[2:]])
    return {**data, 'checks': checks, 'words': frozenset(data['words']), 'vagueLinks': frozenset(data['vagueLinks'])}


if __name__ == '__main__':
    request = json.load(sys.stdin)
    try:
        rules = validate_rules(request['rules'])
    except (ValueError, re.error):
        sys.exit(65)
    copy = rules['copy']
    print(json.dumps(run(request['input'], request['glossary']), ensure_ascii=False))
