"""Plany WI -> dane/wi/plan.json (rekordy umieszczen) + raport niedopasowan.

Wejscie (scratchpad wi/): st1.json, st3.json (wi_st.py), ns.json (wi_xlsx.py); dane/wi/programy.json.
Rekord: {cohort: "INF-WI-S1:2026", sem, day|date, start, end, subject (nazwa z programu), form, group,
room, person, pattern (ALL/ODD/EVEN), fromIndex, toIndex, hours (ns: liczba blokow), src}.
Uzycie: python wi_plan.py <scratchpad wi> <dane/wi>
"""
import difflib
import json
import re
import sys
import unicodedata

FORM = {'W': 'LECTURE', 'ĆW': 'EXERCISE', 'C': 'EXERCISE', 'L': 'LAB', 'P': 'PROJECT'}
ROOM = r'(?:[A-Z]{1,2}\d{1,3}[a-z]?|K|Pływalnia|Centrum Sportu i Rekreacji)'
ENTRY = re.compile(r'(?P<subj>[A-ZŁŚŻŹĆ][^|]*?)\s+(?P<room>' + ROOM + r')\s+(?P<grp>W|ĆW\d|L\d|P\d)(?=\s|$)')
TITLE = r'(?:prof\. |dr hab\. |dr |mgr |inż\. )'
PERSON = re.compile(r'((?:' + TITLE + r')+(?:inż\. )?[A-ZŁŚŻŹĆ][\w\-]+(?:[ -][A-ZŁŚŻŹĆ][\w\-]+)*(?:, prof\.(?: UMG)?)?)')
MARK = re.compile(r'co 2\. tydz\. ([AB])|(I|II) poł\. sem\.')


def norm(s):
    s = unicodedata.normalize('NFKD', s.lower())
    s = ''.join(c for c in s if not unicodedata.combining(c)).replace('ł', 'l')
    s = re.sub(r'\b(i|ii|iii|iv|v|vi|vii)\b(,\s*)?', ' ', s)
    s = re.sub(r'[^a-z0-9 ]+', ' ', s)
    return ' '.join(s.split())


ALIAS = {
    'jezyk angielski': 'jezyk angielski',
    'wychowanie fizyczne': 'wychowanie fizyczne',
    'matematyka': 'matematyka',
    'programowanie syst robotycznych': 'programowanie systemow robotycznych',
    'teoria logika zb rozmytych przybl': 'teoria logika zbiorow rozmytych przyblizonych',
    'jezyk obcy': 'jezyk obcy',
}


def match_subject(raw, entries, sem):
    cands = [e for e in entries if str(sem) in e['sems'] or sem in e['sems']]
    n = norm(raw)
    n = ALIAS.get(n, n)
    if n == 'jezyk angielski':
        n = 'jezyk obcy' if any(norm(e['subject']).startswith('jezyk obcy') for e in cands) else n
    best, score = None, 0
    for e in cands:
        en = norm(e['subject'])
        if en == n or en.startswith(n) or n.startswith(en):
            s = 1.0
        else:
            s = difflib.SequenceMatcher(None, n, en).ratio()
        if s > score:
            best, score = e, s
    return (best['subject'], round(score, 2)) if best and score >= 0.72 else (None, round(score, 2))


def stationary_records(cells, cohort, sem):
    out = []
    for c in cells:
        lines = [l for l in c['lines']]
        m = re.search(r'(\d\d):(\d\d)\s*[–-]\s*(\d\d):(\d\d)', lines[0])
        start, end = f'{m.group(1)}:{m.group(2)}', f'{m.group(3)}:{m.group(4)}'
        body = lines[1:] + [l for sub in c['subs'] for l in sub]
        entries = []  # [{subj, room, grp, persons:[], marks:[]}]
        buf, last_batch = '', []
        for line in body:
            line = line.replace('–', '-')
            mk = MARK.findall(line)
            if mk and not ENTRY.search(line) and not PERSON.search(line):
                for k, (ab, half) in enumerate(mk):
                    tgt = last_batch[k] if k < len(last_batch) else (last_batch[-1] if last_batch else None)
                    if tgt is not None:
                        tgt['marks'].append(ab or half)
                continue
            if last_batch and not ENTRY.search(buf + ' ' + line) and (PERSON.search(line) or line.strip() in ('UMG',)):
                ps = PERSON.findall(line)
                if line.strip() == 'UMG' or not ps:
                    for t in last_batch:
                        if t['persons']:
                            t['persons'][-1] += ' UMG'
                    continue
                for k, p in enumerate(ps):
                    tgt = last_batch[k] if k < len(last_batch) else last_batch[-1]
                    tgt['persons'].append(p)
                continue
            buf = (buf + ' ' + line).strip()
            found = list(ENTRY.finditer(buf))
            if found and found[-1].end() >= len(buf.rstrip()) - 0:
                last_batch = []
                for f in found:
                    e = {'subj': f.group('subj').strip(), 'room': f.group('room'), 'grp': f.group('grp'), 'persons': [], 'marks': []}
                    entries.append(e)
                    last_batch.append(e)
                rest = MARK.findall(buf[found[-1].end():])
                for ab, half in rest:
                    last_batch[-1]['marks'].append(ab or half)
                buf = ''
        if buf:
            out.append({'cohort': cohort, 'sem': sem, 'day': c['day'], 'start': start, 'end': end, 'unparsed': buf, 'src': ' | '.join(c['lines'])})
        for e in entries:
            g = e['grp']
            form = 'LECTURE' if g == 'W' else FORM['ĆW'] if g.startswith('ĆW') else FORM[g[0]]
            group = 'ROOT' if g == 'W' else ('C' + g[2:]) if g.startswith('ĆW') else g
            pattern, fi, ti = 'ALL', None, None
            for mk in e['marks']:
                if mk == 'A':
                    pattern = 'ODD'
                elif mk == 'B':
                    pattern = 'EVEN'
                elif mk == 'I':
                    ti = 8
                elif mk == 'II':
                    fi = 9
            room = None if e['room'] in ('Pływalnia', 'Centrum Sportu i Rekreacji') else e['room']
            note = e['room'] if room is None else None
            out.append({'cohort': cohort, 'sem': sem, 'day': c['day'], 'start': start, 'end': end, 'raw': e['subj'], 'form': form,
                        'group': group, 'room': room, 'roomNote': note, 'person': e['persons'][0] if e['persons'] else None,
                        'pattern': pattern, 'fromIndex': fi, 'toIndex': ti})
    return out


NS_SHEETS = {'Niestacjonarne I st. I sem.': ('INF-WI-N1:2026', 1), 'Niestacjonarne I st. III sem.': ('INF-WI-N1:2025', 3),
             'Niestacjonarne II st. I sem.': ('INF-WI-N2:2026', 1)}
NS = re.compile(r'^(?P<subj>.+?)\s+(?P<grp>W|C|L\d?|P\d?)\s*-\s*(?P<rest>.*)$')


def ns_records(items):
    out = []
    for it in items:
        cohort, sem = NS_SHEETS[it['sheet']]
        t = it['text']
        if t.upper().startswith('BRAK') or t.startswith('Legenda') or t.startswith('Zajęcia zdalne') or t.startswith('Zajęcia stacjonarne'):
            continue
        m = NS.match(t)
        if not m:
            out.append({'cohort': cohort, 'sem': sem, 'date': it['date'], 'start': it['start'], 'unparsed': t})
            continue
        rest = m.group('rest')
        hrs = re.search(r'(\d+(?:,\d)?)\s*h', rest)
        hours = float(hrs.group(1).replace(',', '.')) if hrs else 3.0
        tm = re.search(r'(\d{1,2}):(\d\d)\s*[–-]\s*(\d{1,2}):(\d\d)', rest)
        start = f'{int(tm.group(1)):02d}:{tm.group(2)}' if tm else it['start']
        rest_wo = re.sub(r'(\d+(?:,\d)?)\s*h', ' ', rest)
        rest_wo = re.sub(r'\d{1,2}:\d\d\s*[–-]\s*\d{1,2}:\d\d', ' ', rest_wo)
        rm = re.search(r'(?:^|[\s-])(' + r'[A-Z]{1,2}\d{1,3}[a-z]?|K' + r')(?=[\s-]|$)', rest_wo)
        room = rm.group(1) if rm else None
        person = rest_wo
        if rm:
            person = rest_wo[:rm.start(1)] + ' ' + rest_wo[rm.end(1):]
        person = ' '.join(person.replace(' - ', ' ').replace('-', ' ', 0).split()).strip(' -')
        person = re.sub(r'^-\s*', '', person).replace('inż..', 'inż.').replace('inż S.', 'inż. S.')
        g = m.group('grp')
        form = 'LECTURE' if g == 'W' else 'EXERCISE' if g == 'C' else FORM[g[0]]
        group = 'ROOT' if g == 'W' else 'C1' if g == 'C' else (g if len(g) > 1 else g + '1')
        nblocks = max(1, int(round(hours + 0.01)) if hours != 4.5 else 5)
        out.append({'cohort': cohort, 'sem': sem, 'date': it['date'], 'start': start, 'blocks': nblocks, 'hoursText': hours,
                    'raw': m.group('subj').strip(), 'form': form, 'group': group, 'room': room, 'person': person or None,
                    'pattern': 'ALL', 'fromIndex': None, 'toIndex': None})
    return out


def main():
    work, dane = sys.argv[1], sys.argv[2]
    progs = {p['program']: p for p in json.load(open(f'{dane}/programy.json', encoding='utf-8'))}
    recs = []
    recs += stationary_records(json.load(open(f'{work}/st1.json', encoding='utf-8')), 'INF-WI-S1:2026', 1)
    recs += stationary_records(json.load(open(f'{work}/st3.json', encoding='utf-8')), 'INF-WI-S1:2025', 3)
    recs += ns_records(json.load(open(f'{work}/ns.json', encoding='utf-8')))
    bad = []
    for r in recs:
        if 'unparsed' in r:
            bad.append(r)
            continue
        prog = progs[r['cohort'].split(':')[0]]
        subj, score = match_subject(r['raw'], prog['entries'], r['sem'])
        r['subject'], r['score'] = subj, score
        if not subj:
            bad.append(r)
    json.dump(recs, open(f'{dane}/plan.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    ok = [r for r in recs if r.get('subject')]
    print('rekordow', len(recs), 'dopasowanych', len(ok), 'problemow', len(bad))
    for r in bad:
        print('  !', r.get('cohort'), r.get('day') or r.get('date'), r.get('start'), r.get('raw') or r.get('unparsed'), r.get('score', ''))
    maps = sorted({(r['raw'], r['subject'], r['score']) for r in ok if r['score'] < 1})
    for m in maps:
        print('  ~', m)


main()
