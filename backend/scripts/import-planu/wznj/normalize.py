"""Normalizacja planow WZNJ (zima 2026/27) -> dane/wznj/plan.json dla importuj.ts.

Wejscie: siatki.json (programy z siatki godzin), lista.json (plany niestacjonarne-listy), siatka.json (plany
stacjonarne-siatki). Wyjscie: wersje programow (pozycje) i roczniki z drzewem grup i wpisami planu, gdzie
kazdy wpis wskazuje pozycje programu (przedmiot + semestr + specjalnosc), forme, grupy, czas i prowadzacych.

Uzycie: python normalize.py SIATKI LISTA SIATKA WYJSCIE
"""
import json
import re
import sys
import unicodedata

SIATKI, LISTA, SIATKA, OUT = sys.argv[1:5]

# ─── Programy ────────────────────────────────────────────────

SPEC_SHORT = {
    'Ekonomia Menedżerska': 'EM', 'Informatyka Gospodarcza': 'IG', 'Marketing i Handel': 'MiH',
    'Systemy Transportowe i Logistyczne': 'STiL', 'Turystyka i Hotelarstwo': 'TiH',
    'Zarządzanie Odnawialnymi Źródłami Energii': 'ZOZE', 'Biznes Elektroniczny': 'BE',
    'Rachunkowość i Zarządzanie Finansami': 'RiZF', 'Transport i Logistyka w Gospodarce Globalnej': 'TiLwGG',
    'Zarządzanie Przedsiębiorstwem': 'ZP', 'Inżynieria Jakości i Zarządzanie Produktem': 'IJiZP',
    'Usługi Żywieniowe i Dietetyka': 'UŻiD', 'Zarządzanie Jakością Usług': 'ZJU',
    'Menedżer Systemów Zarządzania': 'MSZ', 'Menedżer Usług Dietetycznych': 'MUD', 'Ochrona Wód i Gospodarka Odpadami': 'OWiGO',
}
FILES = {  # program -> plik siatki
    'ZAR-S1': 'z_i_st_0.pdf', 'ZAR-N1': 'z_i_nst_0.pdf', 'ZAR-S2': 'z_ii_st.pdf', 'ZAR-N2': 'z_ii_nst.pdf',
    'NOJ-S1': 'ij_i_st.pdf', 'NOJ-N1': 'ij_i_nst_0.pdf', 'IJ-S2': 'ij_ii_st.pdf', 'IJ-N2': 'ij_ii_nst_0.pdf',
}

siatki = json.load(open(SIATKI, encoding='utf-8'))


def cells_key(sems):
    return json.dumps(sems, sort_keys=True)


def form_hours(subject, cell):
    h = {k: int(round(cell.get(k, 0))) for k in 'WCLP'}
    h['S'] = 0
    if re.match(r'(?i)seminarium', subject):
        h = {'W': 0, 'C': 0, 'L': 0, 'P': 0, 'S': sum(h.values())}
    if re.match(r'(?i)(praktyka|praca dyplomowa|praca magisterska)', subject):
        h = {k: 0 for k in 'WCLPS'}
    return h


programs = {}
for code, fname in FILES.items():
    pages = [p for p in siatki if p['file'] == fname and p['rows']]
    specs = [SPEC_SHORT[p['meta']['spec']] for p in pages]
    common_rows = {}
    for p in pages:
        for r in p['rows']:
            if r['section'] != 'common':
                continue
            common_rows.setdefault(r['subject'], []).append((SPEC_SHORT[p['meta']['spec']], cells_key(r['sems']), r))
    entries = []
    for subj, lst in common_rows.items():
        keys = {k for _, k, _ in lst}
        if len(keys) == 1 and len(lst) == len(pages):
            entries.append({'subject': subj, 'spec': None, 'sems': lst[0][2]['sems']})
        else:
            for sp, _, r in lst:
                entries.append({'subject': subj, 'spec': sp, 'sems': r['sems']})
    for p in pages:
        sp = SPEC_SHORT[p['meta']['spec']]
        for r in p['rows']:
            if r['section'] == 'spec':
                entries.append({'subject': r['subject'], 'spec': sp, 'sems': r['sems']})
    total = max([int(s) for e in entries for s in e['sems']] + [max(p.get('semesters') or [1]) for p in pages])
    out_entries = []
    for e in entries:
        for s, c in e['sems'].items():
            h = form_hours(e['subject'], c)
            if sum(h.values()) == 0 and not c.get('e'):
                continue
            out_entries.append({'subject': e['subject'], 'spec': e['spec'], 'semester': int(s), **h,
                                'ects': int(round(c.get('e', 0))), 'exam': bool(c.get('exam'))})
    programs[code] = {'code': code, 'specs': specs, 'specNames': {SPEC_SHORT[p['meta']['spec']]: p['meta']['spec'] for p in pages},
                      'totalSemesters': total, 'entries': out_entries, 'source': fname}

# wersje dla naboru letniego: semestry zamienione parami (1<->2, 3<->4, ...), ostatni nieparzysty bez zmian
for code in list(programs):
    pr = programs[code]
    n = pr['totalSemesters']
    def sw(k, n=n):
        if k % 2 == 1:
            return k + 1 if k + 1 <= n else k
        return k - 1
    # nabor letni: siatka bez zmian; przedmioty z "sasiedniego" semestru, ktore plan realizuje teraz,
    # przenosimy do biezacego semestru rocznika (match_entry z partner=True)
    programs[code + '@L'] = {**pr, 'code': code + '@L', 'entries': [dict(e) for e in pr['entries']]}

# ─── Dopasowanie przedmiotow ─────────────────────────────────

STOP = {'i', 'w', 'z', 'na', 'do', 'oraz', 'a', 'o', 'od', 'dla', 'we', 'ze', '-', '–'}


def fold(s):
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn').replace('ł', 'l')
    return s


ALIASES = [(r'\bszj\b', 'systemow zarzadzania jakoscia'), (r'\bmgr\b', 'magisterskie'), (r'\bdypl\b', 'dyplomowe'),
           (r'\bj\.?\s*obcy', 'jezyk obcy'), (r'jezyk angielski', 'jezyk obcy'), (r'\bwyk\.?\s*monogr\w*', 'wyklad monograficzny'),
           (r'menagement', 'management'), (r'p[lł]ywalni\w*|basen\w*|\bwf\b|fitness', 'wychowanie fizyczne'),
           (r'^seminarium$', 'seminarium dyplomowe')]


def toks(s):
    f = fold(s)
    for a, b in ALIASES:
        f = re.sub(a, b, f)
    return [t for t in re.split(r'[^a-z0-9]+', f) if t and t not in STOP]


def despace(text):
    """'N A U K I   O   O R G A N I Z A C J I' -> 'NAUKI O ORGANIZACJI' (slowa rozdziela wiele spacji)."""
    def fix(chunk):
        parts = chunk.split(' ')
        if len(parts) >= 3 and all(len(p) == 1 for p in parts if p):
            return ''.join(parts)
        return chunk
    return re.sub(r'\s+', ' ', '  '.join(fix(c) for c in re.split(r' {2,}', text))).strip()


def score(plan_name, entry_name):
    """Ile slow wpisu pokrywaja kolejne slowa planu (prefiksy — skroty typu 'Zarządz.')."""
    p, e = toks(plan_name), toks(entry_name)
    if not p or not e:
        return 0
    if ' '.join(p) == ' '.join(e):
        return 100
    i = j = hit = 0
    while i < len(p) and j < len(e):
        a, b = p[i], e[j]
        if b.startswith(a) or a.startswith(b) or (len(a) >= 4 and b[:4] == a[:4]):
            hit += 1
            i += 1
            j += 1
        else:
            j += 1
    roman = lambda xs: [x for x in xs if not re.fullmatch(r'[ivx]+', x)]
    pe = len(roman(e)) or 1
    if hit < len(roman(p)) * 0.7:
        return 0
    return 90 * hit / max(pe, len(roman(p)))


def match_entry(prog, semester, specs_ok, name):
    sems = [semester]
    if prog.endswith('@L'):
        sems.append(semester - 1 if semester % 2 == 0 else semester + 1)
    best, bs = None, 0
    for e in programs[prog]['entries']:
        if e['semester'] not in sems or (e['spec'] is not None and e['spec'] not in specs_ok):
            continue
        sc = score(name, e['subject']) - (1 if e['semester'] != semester else 0)
        if sc > bs:
            best, bs = e, sc
    if best and bs >= 44 and best['semester'] != semester:
        best['semester'] = semester  # przeniesienie w wersji naboru letniego
    return best if bs >= 44 else None


def elective_pool(prog, semester, specs_ok, form):
    pools = [e for e in programs[prog]['entries'] if e['semester'] == semester and re.match(r'(?i)(przedmioty wybieralne|przedmiot.*do wyboru|wyk.ad monograficzny)', e['subject'])
             and (e['spec'] is None or e['spec'] in specs_ok)]
    pools.sort(key=lambda e: (0 if 'puli' in e['subject'] else 1, -(e['W'] + e['C'])))
    return pools[0] if pools else None

# ─── Wspolne: prowadzacy, sale, formy ────────────────────────

TITLE = r'(?:prof\.?\s*(?:dr\s*hab\.?\s*)?(?:inż\.?\s*)?|dr\s*hab\.?\s*(?:inż\.?\s*)?|dr\s*inż\.?\s*|dr\.?\s*|mgr\s*inż\.?\s*|mgr\.?\s*|nż\s*)'
SURNAME = r'([A-ZŁŚŻŹĆ][a-ząćęłńóśźż]+(?:\s*-\s*[A-ZŁŚŻŹĆ][a-ząćęłńóśźż]+)?)'
TEACHER_RE = re.compile(r'(?i:' + TITLE + r')\s*(?:[A-ZŁŚŻ]\.\s*)*' + SURNAME)
ROOM_RE = re.compile(r'(?:\bs\.?\s*(?:s\.)?\s*([A-FH])?\s*-?\s*(\d{1,3})\s*([A-Za-z])?\b)|(?:\b([A-FH])\s*-?\s*(\d{2,3})\s*([aA])?\b)')


def teachers_in(text):
    out = []
    for m in TEACHER_RE.finditer(text):
        sn = re.sub(r'\s*-\s*', '-', m.group(1))
        if sn.lower() in ('poł', 'sem', 'lab', 'sala'):
            continue
        out.append((m.start(), sn))
        # nazwiska po ukosniku bez tytulu: "Prof.M.Popek/Dereszewska"
        rest = text[m.end():]
        for m2 in re.finditer(r'^\s*/\s*(?:[A-ZŁŚŻ]\.\s*)*' + SURNAME, rest):
            out.append((m.end() + m2.start(1), re.sub(r'\s*-\s*', '-', m2.group(1))))
    return out


def rooms_in(text):
    out = []
    if re.search(r'(?i)\b(teams|on-?line|zdalnie)\b', text):
        out.append((re.search(r'(?i)\b(teams|on-?line|zdalnie)\b', text).start(), 'ONLINE'))
    for m in ROOM_RE.finditer(text):
        if m.group(2):
            letter, num, suf = m.group(1) or 'B', m.group(2), m.group(3) or ''
        else:
            letter, num, suf = m.group(4), m.group(5), m.group(6) or ''
        if not num:
            continue
        if len(num) == 4:
            continue
        out.append((m.start(), f'{letter}{num}{suf.lower()}'))
    return out


def dates_in(text):
    out = []
    for m in re.finditer(r'\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b', text):
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        y = y + 2000 if y < 100 else y
        if 1 <= d <= 31 and 1 <= mo <= 12:
            out.append((m.start(), f'{y:04d}-{mo:02d}-{d:02d}'))
    return out


FORM_WORDS = [
    (r'(?i)\bwyk[łl]\w*|(?<![A-Za-z])-\s*W\b|\bW\b(?!\s*\d)|\bw\.(?=\s|\)|$)', 'W'),
    (r'(?i)\bsemin\w*|\bsem\.?(?=\s|$)', 'S'),
    (r'(?i)\blab\w*\.?|(?<![A-Za-z])L\s*\d+|\bL\b', 'L'),
    (r'(?i)\bprojekt\w*|(?<![A-Za-z])P\s*\d+', 'P'),
    (r'(?i)ćw\w*|\bcw\w*|(?<![A-Za-z])C\s*\d+|(?<![A-Za-z])-\s*C\b|\bgr\.?\s*\d|\bgrupa\s*\d', 'C'),
]


def form_of(text):
    hits = []
    for rx, f in FORM_WORDS:
        m = re.search(rx, text)
        if m:
            hits.append((m.start(), f))
    if not hits:
        return None
    # "wyklad grupa 1" — wyklad wygrywa z "grupa"
    if any(f == 'W' for _, f in hits) and not any(f in 'LPS' for _, f in hits):
        return 'W'
    return min(hits)[1]


def codes_in(text, form):
    """Numery grup: 'C 1', 'L12', 'LAB 7', 'ĆW 1', 'gr. 7, 8', 'grupa 1', 'gr.1,2,3' — wszystkie wystapienia."""
    text = ROOM_RE.sub(' ', re.sub(r'\bs\.\s*[A-FH]?\s*-?\s*\d+[A-Za-z]?', ' ', text))
    text = re.sub(r'\d{1,2}[.:]\d{2}(\s*-\s*\d{1,2}[.:]\d{2})?', ' ', text)
    text = re.sub(r'\d{1,2}\.\d{1,2}\.\d{2,4}', ' ', text)
    pats = {'C': r'(?:\bC|ćw\w*|cw\w*|\bgr\.?|\bgrupa)\s*\.?\s*(\d+(?:\s*(?:,|i)\s*\d+)*)',
            'L': r'(?:\bL|lab\w*\.?)\s*(\d+(?:\s*(?:,|i)\s*\d+)*)',
            'P': r'(?:\bP)\s*(\d+(?:\s*(?:,|i)\s*\d+)*)',
            'S': r'(?:\bS)\s*(\d+)',
            'W': r'(?:\bgrupa|\bgr\.?)\s*(\d+)'}
    out = []
    for m in re.finditer(pats.get(form, r'$^'), text, re.I):
        out += [int(x) for x in re.findall(r'\d+', m.group(1)) if 0 < int(x) <= 20]
    return sorted(set(out))


# ─── Roczniki i pliki planow ─────────────────────────────────

COHORTS = [
    # program, rok naboru, typ, semestr, zrodla [(typ, plik, arkusz|None, specjalnosc|None)]
    ('ZAR-N1', 2026, 'WINTER', 1, [('lista', 'i_rok_1_stop-zarz-05.11.2026.xlsx', None, None)]),
    ('ZAR-N2', 2026, 'WINTER', 1, [('lista', '2_stop-i-rok_1-sem_zarz-19.11.2026.xlsx', None, None)]),
    ('ZAR-N2', 2025, 'SUMMER', 2, [('lista', '2_stop-i-rok_2-sem_tilwgg_rizf_zp_19.11.2026_0.xlsx', 'TiLwGG', 'TiLwGG'),
                                   ('lista', '2_stop-i-rok_2-sem_tilwgg_rizf_zp_19.11.2026_0.xlsx', 'RiZF', 'RiZF'),
                                   ('lista', '2_stop-i-rok_2-sem_tilwgg_rizf_zp_19.11.2026_0.xlsx', 'ZP', 'ZP')]),
    ('ZAR-N1', 2025, 'WINTER', 3, [('lista', 'ii_rok_1_stop-stil_em_mih_6.11.2026.xlsx', 'STiL', 'STiL'),
                                   ('lista', 'ii_rok_1_stop-stil_em_mih_6.11.2026.xlsx', 'EM', 'EM'),
                                   ('lista', 'ii_rok_1_stop-stil_em_mih_6.11.2026.xlsx', 'MiH', 'MiH')]),
    ('ZAR-N2', 2025, 'WINTER', 3, [('lista', '2_stop-ii-rok_3-sem_tilwgg_rizf_zp_13.11.2026.xlsx', 'TiLwGG', 'TiLwGG'),
                                   ('lista', '2_stop-ii-rok_3-sem_tilwgg_rizf_zp_13.11.2026.xlsx', 'RiZF', 'RiZF'),
                                   ('lista', '2_stop-ii-rok_3-sem_tilwgg_rizf_zp_13.11.2026.xlsx', 'ZP', 'ZP')]),
    ('ZAR-N1', 2024, 'WINTER', 5, [('lista', 'iii_rok_1_stop-stil_em_mih_04.11.2026.xlsx', 'STiL', 'STiL'),
                                   ('lista', 'iii_rok_1_stop-stil_em_mih_04.11.2026.xlsx', 'EM', 'EM'),
                                   ('lista', 'iii_rok_1_stop-stil_em_mih_04.11.2026.xlsx', 'MiH', 'MiH')]),
    ('NOJ-N1', 2026, 'WINTER', 1, [('lista', 'ij-i-sem_1.xlsx', None, None)]),
    ('NOJ-N1', 2025, 'WINTER', 3, [('lista', 'ii-rok-ijizp-3-sem_0.xlsx', None, 'IJiZP')]),
    ('NOJ-N1', 2024, 'WINTER', 5, [('lista', 'iii-rok-ijizp-5-sem_0.xlsx', None, 'IJiZP')]),
    ('IJ-N2', 2026, 'WINTER', 1, [('lista', 'i-msu-i-sem-msz_3.xlsx', None, 'MSZ'), ('lista', 'i-msu-i-sem-owigo_3.xlsx', None, 'OWiGO')]),
    ('IJ-N2', 2025, 'SUMMER', 2, [('lista', 'plan-msz-msu-ii-sem.xlsx', None, 'MSZ')]),
    ('IJ-N2', 2025, 'WINTER', 3, [('lista', 'plan-msz-msu-iii-sem.xlsx', None, 'MSZ')]),
    ('ZAR-S1', 2026, 'WINTER', 1, [('siatka', '_i-rok-1-st_zarz_zima-od-23.11.2026_1.xlsx', None, None)]),
    ('ZAR-S2', 2026, 'WINTER', 1, [('siatka', 'i-rok-2-st_zarz_zima-od-23.11.2026.xlsx', None, None)]),
    ('ZAR-S1', 2025, 'WINTER', 3, [('siatka', '_ii-rok-1-st_zarz_zima_2026-2027_02.10.2026.xlsx', None, None)]),
    ('ZAR-S2', 2025, 'WINTER', 3, [('siatka', 'ii-rok-2-st_zarz_zima_2026-2027_05.11.2026.xlsx', None, None)]),
    ('ZAR-S1', 2024, 'WINTER', 5, [('siatka', '_iii-rok-1-st_zarz_zima_2026-2027_20.11.2026_0.xlsx', None, None)]),
    ('NOJ-S1', 2026, 'WINTER', 1, [('siatka', 'plan-i-rok-2026-zima_3.xls', None, None)]),
    ('IJ-S2', 2025, 'SUMMER', 2, [('siatka', 'plan-msu-ii-sem-zima-2026_0.xls', None, None)]),
    ('NOJ-S1', 2025, 'WINTER', 3, [('siatka', 'plan-ii-rok-zima-2026_2.xls', None, 'IJiZP')]),
    ('NOJ-S1', 2024, 'WINTER', 5, [('siatka', 'plan-iii-rok-zima-2026.xls', None, 'IJiZP')]),
]
# roczniki bez planu w tym semestrze (tylko nowa wersja programu)
EXTRA_COHORTS = [('IJ-S2', 2026, 'SUMMER', 0), ('IJ-N2', 2026, 'WINTER', 1)]

lista = json.load(open(LISTA, encoding='utf-8'))
siatka = json.load(open(SIATKA, encoding='utf-8'))
problems = []

FORM_FROM_GROUP = {'wykład': 'W', 'wdw': 'W', 'sem.': 'S', 'sem': 'S', 'semin.': 'S'}


def parse_lista_item(it, spec):
    subj = it['subject']
    grp = (it.get('group') or '').strip()
    form, code = None, []
    g = grp.lower()
    if g in FORM_FROM_GROUP:
        form = FORM_FROM_GROUP[g]
    else:
        m = re.fullmatch(r'([CLPS])\s*(\d*)', grp)
        if m:
            form = m.group(1)
            code = [int(m.group(2))] if m.group(2) else []
    name = subj
    m = re.match(r'^(.*?)\s*-\s*(W|WdW|C\d*|L\d*|P\d*|S|sem\.?|semin\.?)\s*$', subj)
    if m:
        name = m.group(1)
        suf = m.group(2)
        if not form:
            form = {'W': 'W', 'WdW': 'W'}.get(suf, suf[0].upper())
            code = [int(x) for x in re.findall(r'\d+', suf)]
    else:
        m = re.match(r'^(.*?)\s+(W|CW|Cw|ĆW|Ćw|C|Lab\s*\d*|lab\s*\d*|L\s*\d*|P\s*\d*)\s*$', subj)
        if m:
            name = m.group(1)
            suf = m.group(2)
            f = suf[0].upper()
            form = form or ('C' if f in 'CĆ' else f)
            code = code or [int(x) for x in re.findall(r'\d+', suf)]
    elective = g == 'wdw' or bool(re.search(r'(?i)wybieraln', subj))
    teachers = [t.strip() for t in re.split(r'[/,]', it.get('teacher') or '') if t.strip() and not t.strip().lower().startswith('prac')]
    room = it.get('room') or ''
    rooms = rooms_in(room) if room else []
    return {'name': name.strip(), 'form': form, 'codes': code, 'elective': elective, 'teachers': teachers,
            'room': rooms[0][1] if rooms else ('ONLINE' if re.search(r'(?i)teams|on-?line', room) else None), 'roomText': room}


def normalize_lista(prog, sem, src_list, cohort):
    items = []
    for kind, fname, sheet_prefix, spec in src_list:
        sheets = [s for s in lista if s['file'] == fname and (sheet_prefix is None or s['sheet'].strip().startswith(sheet_prefix))]
        if not sheets:
            problems.append(f'{prog} {sem}: brak arkusza {fname} {sheet_prefix}')
        for sh in sheets:
            for it in sh['items']:
                if 'subject' not in it:
                    continue
                p = parse_lista_item(it, spec)
                specs_ok = [spec] if spec else ([] if not any(s_ for _, _, _, s_ in src_list) else programs[prog]['specs'])
                if re.match(r'(?i)(spotkanie|inauguracja|szkolenie)', p['name']):
                    continue
                e = match_entry(prog, sem, specs_ok, p['name'])
                pooled = False
                if not e:
                    e = elective_pool(prog, sem, specs_ok, p['form'])
                    pooled = bool(e)
                    if e:
                        problems.append(f'{prog} sem {sem} [{spec}] {fname}: do puli "{e["subject"]}": "{it["subject"]}"')
                if not e:
                    problems.append(f'{prog} sem {sem} [{spec}] {fname}: nie ma w programie: "{it["subject"]}"')
                    continue
                items.append({'cycle': 'ZJAZD', 'date': it['date'], 'start': it['start'], 'end': it['end'],
                              'entry': {'subject': e['subject'], 'spec': e['spec']}, 'scopeSpec': spec if e['spec'] is None and spec else e['spec'],
                              'planSubject': p['name'], 'form': p['form'] or 'W', 'codes': p['codes'], 'teachers': p['teachers'],
                              'room': p['room'], 'roomText': p['roomText'], 'source': f'{fname}:{it["row"]}'})
    # wyklady wspolne powtarzaja sie w kazdym arkuszu specjalnosci — jeden wpis
    seen, out = set(), []
    for x in items:
        k = (x['date'], x['start'], x['entry']['subject'], x['form'], tuple(x['codes']), x['room'], tuple(x['teachers']),
             x['scopeSpec'] if (x['form'] != 'W' or x['entry']['spec']) else None)
        if k in seen:
            continue
        seen.add(k)
        if x['form'] == 'W' and not x['entry']['spec']:
            x['scopeSpec'] = None
        out.append(x)
    return out

# ─── Siatki stacjonarne: dzielenie komorki na przedmioty ─────


def spec_columns(sheet, prog):
    cols = []
    for r, c, v in sheet['header_cells']:
        if r < 2:
            continue
        for code in programs[prog]['specs']:
            if re.search(r'(?<![A-Za-zŁŻ])' + re.escape(code) + r'(?![A-Za-z])', v):
                cols.append((c, code))
    cols.sort()
    return cols


def specs_for(cols, c0, c1, right):
    if not cols:
        return []
    res = []
    for i, (c, code) in enumerate(cols):
        end = (cols[i + 1][0] - 1) if i + 1 < len(cols) else right
        if not (c1 < c or c0 > end):
            res.append(code)
    return res


def find_subjects(text, prog, sem, specs_ok):
    """Wystapienia przedmiotow programu w tekscie (poczatek, koniec, wpis) — zachlannie najdluzsze."""
    words = [(m.start(), m.end(), m.group(0)) for m in re.finditer(r'[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż0-9]+\.?', text)]
    cands = [e for e in programs[prog]['entries'] if e['semester'] == sem and (e['spec'] is None or e['spec'] in specs_ok)]
    found = []
    i = 0
    while i < len(words):
        best = None
        for e in cands:
            et = toks(e['subject'])
            if not et:
                continue
            j, k, hit, last = i, 0, 0, None
            while j < len(words) and k < len(et):
                wt = toks(words[j][2])
                if not wt:
                    j += 1
                    continue
                a = wt[0]
                b = et[k]
                if len(a) >= 3 and (b.startswith(a.rstrip('.')) or (len(a) >= 4 and a[:4] == b[:4])) or a == b:
                    hit += 1
                    last = j
                    j += 1
                    k += 1
                elif a in STOP:
                    j += 1
                elif k > 0 and b in STOP:
                    k += 1
                else:
                    break
            need = max(1, min(len([t for t in et if not re.fullmatch(r'[ivx]+', t)]), 2))
            if hit >= need and (k >= len(et) * 0.5 or hit >= 2):
                if not best or hit > best[2]:
                    best = (words[i][0], words[last][1], hit, e)
        if best:
            found.append(best)
            while i < len(words) and words[i][0] < best[1]:
                i += 1
        else:
            i += 1
    return found


def split_cell(text, prog, sem, specs_ok):
    subs = find_subjects(text, prog, sem, specs_ok)
    if not subs:
        return []
    segs = []
    for i, (a, b, _, e) in enumerate(subs):
        end = subs[i + 1][0] if i + 1 < len(subs) else len(text)
        segs.append({'entry': e, 'text': text[a:end], 'start': a, 'end': end})
    # prowadzacy, sale, daty: z calej komorki, przydzial do segmentow wg pozycji (najblizszy wczesniejszy
    # segment bez wlasnych), a gdy brak — kolejno
    T = teachers_in(text)
    R = rooms_in(text)
    D = dates_in(text)
    for kind, lst in (('teachers', T), ('rooms', R), ('dates', D)):
        own = {i: [v for p, v in lst if s['start'] <= p < s['end']] for i, s in enumerate(segs)}
        free = [i for i in own if not own[i]]
        # nadmiar w ostatnim segmencie (np. "dr A 05.10 s. 411 mgr B 12.10 s. 403") — rozdziel na puste segmenty
        last = len(segs) - 1
        if free and len(own[last]) > 1 and kind != 'teachers' or (free and kind == 'teachers' and len(own[last]) >= len(free) + 1):
            extra = own[last][:]
            take = extra[: len(free)] if len(extra) > len(free) else extra[:-1]
            for i, v in zip(free, take):
                own[i] = [v]
            own[last] = extra[len(take):]
        if kind == 'rooms':
            allv = [v for _, v in lst]
            for i in own:
                if not own[i] and allv:
                    own[i] = [allv[-1]]
        if kind == 'teachers':
            allv = [v for _, v in lst]
            for i in own:
                if not own[i] and len(allv) == 1:
                    own[i] = allv
        for i, s in enumerate(segs):
            s[kind] = own[i]
    return segs


def rhythm(seg_text, full_text, idx, n_alt):
    t = fold(seg_text)
    r = {}
    if re.search(r'\bi\s*p(ol|\.)', t) or 'i pol' in t or 'i p.s' in t or 'i poł' in seg_text.lower():
        r['half'] = 1
    if re.search(r'\bii\s*p(ol|\.)', t) or 'ii pol' in t or 'ii p.s' in t:
        r['half'] = 2
    if re.search(r'co\s*2\s*t', t):
        r['alt'] = True
    m = re.search(r'\bod\s+(\d{1,2}\.\d{1,2}\.\d{2,4})', seg_text)
    if m:
        r['fromDate'] = dates_in(m.group(1))[0][1]
    lst = re.search(r'\(((?:\d{1,2}\.\d{1,2}\.\d{2,4}[.,;\s]*){2,})\)', seg_text)
    if lst:
        r['dates'] = [d for _, d in dates_in(lst.group(1))]
    m = re.search(r'(?i)(\d+)\s*tygodni', seg_text)
    if m:
        r['weeks'] = int(m.group(1))
    return r


spec_cols_seen = {}


def normalize_siatka(prog, sem, src_list, cohort):
    items = []
    for kind, fname, _, fixed_spec in src_list:
        for sh in [s for s in siatka if s['file'] == fname]:
            scols = spec_columns(sh, prog)
            spec_cols_seen[(cohort['program'], cohort['year'], cohort['type'])] = [c for _, c in scols]
            right = sh['cols'][1] - 1
            for cell in sh['cells']:
                text = ' '.join(despace(x) for x in cell['lines'])
                if re.search(r'(?i)warunki', text):
                    continue
                if re.search(r'(?i)p[łl]ywalni|basen|\bWF\b|wychowanie fizyczne|fitness', text) and not re.search(r'(?i)wychowanie fizyczne', ' '.join(e['subject'] for e in programs[prog]['entries'] if e['semester'] == sem)):
                    continue
                cs = specs_for(scols, cell['c0'], cell['c1'], right) if scols else ([fixed_spec] if fixed_spec else [])
                specs_ok = cs or ([fixed_spec] if fixed_spec else [])
                segs = split_cell(text, prog, sem, specs_ok)
                if not segs:
                    problems.append(f'{prog} sem {sem} {fname} {cell["day"][:3]} {cell["start"]}: nie rozpoznano: "{text[:90]}"')
                    continue
                alts = [i for i, s in enumerate(segs) if re.search(r'co\s*2\s*t', fold(s['text']))]
                for i, s in enumerate(segs):
                    form = form_of(s['text'][len(s['entry']['subject']) // 3:]) or form_of(s['text'])
                    e = s['entry']
                    if not form:
                        form = 'W' if e['W'] and (cell['c1'] - cell['c0'] >= 3 or not (e['C'] or e['L'] or e['P'])) else ('C' if e['C'] else 'L' if e['L'] else 'P' if e['P'] else 'S' if e['S'] else 'W')
                    if re.match(r'(?i)seminarium', e['subject']):
                        form = 'S'
                    codes = codes_in(s['text'], form)
                    r = rhythm(s['text'], text, i, len(alts))
                    if r.get('alt') and not s['dates'] and len(alts) > 1:
                        r['altOrder'] = alts.index(i) if i in alts else 0
                    items.append({'cycle': 'WEEK', 'day': cell['day'], 'start': cell['start'], 'end': cell['end'],
                                  'entry': {'subject': e['subject'], 'spec': e['spec']},
                                  'scopeSpec': e['spec'] or (cs[0] if len(cs) == 1 and form != 'W' else None),
                                  'planSubject': s['text'][:80], 'form': form, 'codes': codes, 'teachers': s['teachers'],
                                  'room': s['rooms'][0] if s['rooms'] else None, 'rooms': s['rooms'], 'firstDate': s['dates'][0] if s['dates'] and r.get('alt') else None,
                                  'rhythm': r, 'cols': [cell['c0'], cell['c1']], 'source': f'{fname}:{cell["day"][:3]}{cell["start"]}'})
    return items

# ─── Drzewa grup ─────────────────────────────────────────────


def group_tree(items, prog):
    """Grupy wg etykiet z planu: zakres (rocznik albo specjalnosc) -> {C: [kody], L: [...], P: [...]}"""
    scopes = {}
    for x in items:
        if x['form'] in 'CLPS' and x['codes']:
            sc = x['scopeSpec'] or ''
            for c in x['codes']:
                scopes.setdefault(sc, {}).setdefault(x['form'], set()).add(c)
    out = {}
    for sc, d in scopes.items():
        out[sc] = {k: sorted(v) for k, v in d.items() if k != 'S'}
    return out


result = {'programs': programs, 'cohorts': [], 'problems': problems}
for prog0, year, typ, sem, srcs in COHORTS:
    prog = prog0 + '@L' if typ == 'SUMMER' else prog0
    co = {'program': prog0, 'version': prog, 'year': year, 'type': typ, 'semester': sem}
    if srcs[0][0] == 'lista':
        items = normalize_lista(prog, sem, srcs, co)
    else:
        items = normalize_siatka(prog, sem, srcs, co)
    specs = sorted({x['scopeSpec'] for x in items if x['scopeSpec']} | {s for _, _, _, s in srcs if s} | set(spec_cols_seen.get((prog0, year, typ), [])))
    lecture_halves = sorted({c for x in items if x['form'] == 'W' for c in x['codes']})
    co.update({'specs': specs, 'groups': group_tree(items, prog), 'lectureHalves': lecture_halves if len(lecture_halves) > 1 else [], 'items': items})
    result['cohorts'].append(co)
for prog, year, typ, sem in EXTRA_COHORTS:
    if not any(c['program'] == prog and c['year'] == year and c['type'] == typ for c in result['cohorts']):
        result['cohorts'].append({'program': prog, 'version': prog + ('@L' if typ == 'SUMMER' else ''), 'year': year, 'type': typ, 'semester': sem, 'specs': [], 'groups': {}, 'lectureHalves': [], 'items': []})
json.dump(result, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for c in result['cohorts']:
    print(c['program'], c['year'], c['type'][0], 'sem', c['semester'], 'wpisow', len(c['items']), 'spec', c['specs'], 'grupy', c['groups'], 'wyklady', c['lectureHalves'])
print('problemow', len(problems))
