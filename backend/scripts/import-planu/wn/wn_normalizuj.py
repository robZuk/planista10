"""Plany WN (st.json z wn_arktur.py, nst.json z wn_nst.py) + programy.json -> dane/wn/plan.json.

Rekord = jedno zajecie do umieszczenia: program, rocznik, specjalnosc, przedmiot z programu (dopasowany
do skrotu/nazwy w planie), forma, grupy (kolumny arkusza), czas, sala, prowadzacy, rytm.
Uzycie: python wn_normalizuj.py st.json nst.json programy.json wyjscie.json
"""
import json
import re
import sys
import unicodedata

# plan -> (program, rok naboru, typ naboru, semestr, specjalnosc)
ST = {
    'p560.html': ('TR-S1', 2026, 'W', 1, 'TiL'), 'p550.html': ('TR-S1', 2025, 'W', 3, 'TiL'),
    'p551.html': ('TR-S1', 2024, 'W', 5, 'TiL'), 'p552.html': ('TR-S1', 2023, 'W', 7, 'TiL'),
    'p561.html': ('NAW-S1', 2026, 'W', 1, None), 'p559.html': ('NAW-S1', 2025, 'W', 3, None),
    'p555.html': ('NAW-S1', 2024, 'W', 5, None), 'p556.html': ('TR-S2', 2025, 'S', 2, 'MSTiL'),
}
NST = {
    'TiL_I.pdf': ('TR-N1', 2026, 'W', 1, 'TiL'), 'TiL_II.pdf': ('TR-N1', 2025, 'W', 3, 'TiL'),
    'TiL_III.pdf': ('TR-N1', 2024, 'W', 5, 'TiL'), 'TiL_IV.pdf': ('TR-N1', 2023, 'W', 7, 'TiL'),
    'TM_I.pdf': ('NAW-N1', 2026, 'W', 1, None), 'TM_II.pdf': ('NAW-N1', 2025, 'W', 3, None),
    'TM_III.pdf': ('NAW-N1', 2024, 'W', 5, None),
    'MSTiL_I.pdf': ('TR-N2', 2026, 'W', 1, 'MSTiL'), 'MSTiL_II.pdf': ('TR-N2', 2025, 'W', 3, 'MSTiL'),
}
SKIP = re.compile(r'^(przerwa|wolne|spotkanie organizacyjne|inauguracja|zajęcia zdalne|dzień wolny)', re.I)
SMALL = {'i', 'w', 'z', 'na', 'oraz', 'do', 'dla', 'we', 'ze', 'a', 'o', 'od'}
ALIAS = {'joa': 'język angielski', 'wf': 'wychowanie fizyczne', 'astro': 'astronawigacja', 'mater': 'materiałoznawstwo',
         'inf': 'informatyka', 'naw': 'nawigacja', 'fiz': 'fizyka', 'ma': 'matematyka', 'pm': 'prawo morskie',
         'paut': 'podstawy automatyki', 'pm': 'przewozy morskie', 'eto': 'elektrotechnika okrętowa', 'bhp': 'bezpieczeństwo i higiena pracy',
         'gld': 'zarządzanie globalnymi', 'głd': 'zarządzanie globalnymi', 'gład': 'zarządzanie globalnymi', 'globalnełańcuchydostaw': 'zarządzanie globalnymi',
         'przedmiotfakultatywny': 'wykład fakultatywny', 'seminariummagisterskie': 'seminarium dyplomowe'}
PREFIX_ALIAS = [('naw', 'nawigacja'), ('przedmiot fakultatywny', 'wykład fakultatywny'), ('globalne łańcuchy', 'zarządzanie globalnymi'),
                ('seminarium magisterskie', 'seminarium dyplomowe')]


def chunks_match(raw, cand):
    """Skrot z wielkich liter z doklejonymi poczatkami slow (ITr, ŚTr, PIRI) wobec nazwy."""
    parts = re.findall(r'[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]*|[a-ząćęłńóśźż]+', raw)
    words = [w for w in re.split(r'[\s\-]+', cand) if w]
    while len(parts) > len(words) and parts[-1] in ('I', 'II', 'V', 'X'):
        parts = parts[:-1]
    if not parts or len(parts) > len(words):
        return False
    for pa, w in zip(parts, words):
        if not w.lower().startswith(pa.lower()):
            return False
    rest = words[len(parts):]
    return all(re.fullmatch(r'[IVX]+', w) for w in rest)


def fold(s):
    return unicodedata.normalize('NFC', s).lower().strip()


def base(s):
    s = fold(s)
    s = re.sub(r'[\(\)\.,;:]', ' ', s)
    toks = [t for t in s.split() if not re.fullmatch(r'[ivx]+|\d+', t)]
    return ' '.join(toks)


def initials(name):
    out = ''
    for w in re.split(r'[\s\-]+', name.strip()):
        if not w or re.fullmatch(r'[IVX]+|\d+', w):
            continue
        out += w[0].lower() if w.lower() in SMALL else w[0].upper()
    return out


def match_subject(raw, cands):
    """cands: lista nazw przedmiotow z programu (semestr rocznika). Zwraca nazwe albo None."""
    r = base(raw)
    if not r:
        return None
    bys = {base(c): c for c in cands}
    if r in bys:
        return bys[r]
    # nazwa z planu zaczyna sie od nazwy z programu (Nawigacja-Ort-Loks) albo odwrotnie
    for b, c in sorted(bys.items(), key=lambda kv: -len(kv[0])):
        if b and (r.startswith(b) or b.startswith(r)) and len(min(r, b, key=len)) >= 4:
            return c
    for pre, target in PREFIX_ALIAS:
        if fold(raw).startswith(pre):
            for b, c in bys.items():
                if b.startswith(base(target)):
                    return c
    key = re.sub(r'[\d\s\-]+', '', fold(raw))
    if key in ALIAS:
        a = base(ALIAS[key])
        for b, c in bys.items():
            if b.startswith(a):
                return c
    raw_letters = re.sub(r'[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]', '', raw)
    for c in cands:
        if initials(c) == raw_letters:
            return c
    for c in cands:
        if initials(c).lower() == raw_letters.lower() and len(raw_letters) >= 2:
            return c
    hits = [c for c in cands if chunks_match(raw_letters, c)]
    if len(hits) == 1:
        return hits[0]
    # prefiks skrotu (FIZ, MA, Astro, Mater, NAW1)
    k = fold(raw_letters)
    if len(k) >= 2:
        hits = [c for b, c in bys.items() if b.startswith(k)]
        if len(hits) == 1:
            return hits[0]
    return None


def program_index(programy):
    """(program, rok, typ) -> wersja; zwraca funkcje kandydatow i godzin."""
    idx = {}
    for v in programy:
        for y, t in v['cohorts']:
            idx[(v['program'], y, t)] = v
    return idx


def types_for(version, subject, sem, spec):
    out = {}
    for e in version['entries']:
        if e['subject'] == subject and e['sem'] == sem and e['spec'] in (None, spec):
            for k, v in e['cell'].items():
                if k in ('W', 'C', 'L', 'S'):
                    out[k] = out.get(k, 0) + v
    return out


FORM = {'W': 'LECTURE', 'C': 'EXERCISE', 'L': 'LAB', 'S': 'SEMINAR', 'P': 'PROJECT'}


def infer_form(raw, subject, avail, span, ncols, has_person):
    if 'seminarium' in subject.lower():
        return 'S'
    nonw = [k for k in ('C', 'L', 'S') if avail.get(k)]
    full = span == ncols
    if avail.get('W') and (full or ncols == 1) and (has_person or len(raw) > 6 or not nonw):
        return 'W'
    if len(nonw) == 1:
        return nonw[0]
    if 'C' in nonw and 'L' in nonw:
        return 'C' if span > 1 else 'L'
    if nonw:
        return nonw[0]
    return 'W'


def parse_rhythm(notes):
    r = {'half': None, 'parity': False}
    for n in notes:
        n2 = n.lower()
        if '1 poł' in n2:
            r['half'] = 1
        if '2 poł' in n2:
            r['half'] = 2
        if 'co 2 tyg' in n2 or 'co dwa tyg' in n2:
            r['parity'] = True
    return r


def norm_person(p):
    """'Nazwisko Imie' albo 'Nazwisko Imie, tytul' -> (nazwisko, imie, tytul)."""
    if not p:
        return None
    p = p.strip()
    title = ''
    if ',' in p:
        p, title = p.split(',', 1)
        title = title.strip()
    toks = p.split()
    if len(toks) < 2:
        return None
    return {'last': toks[0], 'first': ' '.join(toks[1:]), 'title': title}


def norm_room(room, place):
    if not room:
        return None
    room = room.split(',')[0].split()[0] if room.split() else room
    r = room.strip()
    rl = r.lower()
    if rl in ('on-line', 'online', 'sala'):
        return None
    if rl in ('aula',):
        return 'Aula (Morska)' if 'mors' in (place or '').lower() else 'Aula WN'
    if rl.startswith('aula'):
        return 'Aula (Morska)'
    if rl == 'basen':
        return 'Basen'
    if rl in ('mw', 'lab'):
        return 'lab MW'
    if re.fullmatch(r'\d+[a-z]?', r):
        return 'N' + r
    return r


def main():
    st, nst, programy, out = (json.load(open(sys.argv[i], encoding='utf-8')) for i in (1, 2, 3)) + (sys.argv[4],) if False else (None,) * 4
    st = json.load(open(sys.argv[1], encoding='utf-8'))
    nst = json.load(open(sys.argv[2], encoding='utf-8'))
    programy = json.load(open(sys.argv[3], encoding='utf-8'))
    out = sys.argv[4]
    pidx = program_index(programy)
    records, unmatched = [], {}

    def cands_for(key, sem, spec):
        v = pidx[key]
        return v, sorted({e['subject'] for e in v['entries'] if e['sem'] == sem and e['spec'] in (None, spec)})

    for d in st:
        if d['file'] not in ST:
            continue
        prog, y, t, sem, spec = ST[d['file']]
        v, cands = cands_for((prog, y, t), sem, spec)
        cols = d['columns'] or ['A1']
        ncols = len(cols)
        for c in d['cells']:
            for e in c['entries']:
                raw = e['subject']
                if not raw or SKIP.match(raw):
                    continue
                subj = match_subject(raw, cands)
                if not subj:
                    unmatched.setdefault(f'{prog} {y}{t} s{sem}', set()).add(raw)
                    continue
                avail = types_for(v, subj, sem, spec)
                span = c['c1'] - c['c0'] + 1
                form = infer_form(raw, subj, avail, span, ncols, bool(e['person']))
                start = c['start']
                if e['time']:
                    hh, mm = map(int, e['time'].split(':'))
                    start = hh * 60 + mm
                dur = c['end'] - c['start']
                rh = parse_rhythm(e['notes'])
                records.append({'mode': 'FULL_TIME', 'program': prog, 'year': y, 'type': t, 'sem': sem, 'spec': spec,
                                'source': d['file'], 'raw': raw, 'subject': subj, 'form': FORM[form],
                                'groups': [cols[i] if i < ncols else f'GR.{i + 1:02d}' for i in range(c['c0'], c['c1'] + 1)],
                                'allGroups': cols, 'day': c['day'], 'start': start, 'end': start + dur,
                                'room': norm_room(e['room'], 'Morska' if e['room'] and 'Morska' in e['room'] else 'JP II'),
                                'person': norm_person(e['person']), 'from': e['from'], 'weeks': e['weeks'], 'half': rh['half'], 'parity': rh['parity']})
    for d in nst:
        if d['file'] not in NST:
            continue
        prog, y, t, sem, spec = NST[d['file']]
        v, cands = cands_for((prog, y, t), sem, spec)
        for day in d['days']:
            for c in day['cells']:
                lines = c['lines']
                if not lines or SKIP.match(lines[0]):
                    continue
                raw = lines[0]
                subj = match_subject(raw, cands)
                if not subj:
                    unmatched.setdefault(f'{prog} {y}{t} s{sem}', set()).add(raw)
                    continue
                avail = types_for(v, subj, sem, spec)
                letter = lines[1].strip()[:1] if len(lines) > 1 else ''
                form = {'W': 'W', 'C': 'C', 'L': 'L', 'S': 'S', 'J': 'C', 'P': 'L'}.get(letter)
                if not form or (form not in avail and avail):
                    form = form if form in avail else infer_form(raw, subj, avail, len(c['groups']), len(day['groups']), len(lines) > 2)
                person = None
                for ln in lines[1:]:
                    m = re.match(r'^(?:[WCLSJ]\s+)?([A-ZĄĆĘŁŃÓŚŹŻ][\w\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+(?:-[A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźż]+)?\s+[A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźż]+)(?:,\s*(.*))?$', ln.strip())
                    if m and len(ln.strip()) > 3 and ln.strip() not in ('W', 'C', 'L'):
                        person = norm_person(m.group(1) + (', ' + m.group(2) if m.group(2) else ''))
                        break
                records.append({'mode': 'PART_TIME', 'program': prog, 'year': y, 'type': t, 'sem': sem, 'spec': spec,
                                'source': d['file'], 'raw': raw, 'subject': subj, 'form': FORM[form],
                                'groups': c['groups'], 'allGroups': day['groups'], 'date': day['date'],
                                'start': c['start'], 'end': c['end'], 'room': norm_room(c['room'], day['place']),
                                'online': (c['room'] or '').upper().replace('-', '') == 'ONLINE' or 'ON' in (day['place'] or '').upper(),
                                'person': person})
    json.dump(records, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('rekordow', len(records))
    for k, v in sorted(unmatched.items()):
        print('NIEDOPASOWANE', k, sorted(v))


main()
