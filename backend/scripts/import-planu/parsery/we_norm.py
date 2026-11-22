"""Komorki planow WE (raw/*.json z we_st_el, we_ns_el, we_st_calc, we_ns_calc) -> rekordy zajec.

Wyjscie (JSON): {"structure": {cohortKey: {spec: {"slots": n, "cOf": [nr cw dla slotu]}}},
                 "records": [{cohort, sem, spec, day|date, start, end, raw, subject, form, slots,
                              room, person, pattern, fromIndex, toIndex, dates, src}],
                 "skipped": [...]}
Rekord to jedno zajecie w komorce; sloty = kolumny grup laboratoryjnych (1..n) w obrebie specjalnosci
(albo calego rocznika przed wyborem specjalnosci). Przedmiot dopasowany do pozycji programu rocznika.
Uzycie: python we_norm.py raw_dir entries.json out.json
"""
import difflib
import glob
import json
import os
import re
import sys
import unicodedata

RAW, ENTRIES, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

# plik -> (program, rok naboru, typ naboru, semestr, specjalnosc)
def config(name):
    m = re.match(r'(st|ns)-(i|m)-(e|eit|inf|st)-r(\d)s(\d)(?:-(\w+))?$', name)
    mode, deg, field, rok, sem, sp = m.groups()
    rok, sem = int(rok), int(sem)
    prog = {('e', 'i'): 'ET-{}1', ('e', 'm'): 'ET-{}2', ('eit', 'i'): 'EIT-{}1', ('eit', 'm'): 'EIT-{}2', ('inf', 'i'): 'INF-{}1', ('st', 'm'): 'STI-{}2'}[(field, deg)]
    prog = prog.format('S' if mode == 'st' else 'N')
    if deg == 'm' and mode == 'st':  # II st. stacjonarne: nabor letni, sem 2 = nabor L poprzedniego roku
        year, typ = 2025, 'S'
    else:
        year, typ = 2026 - (sem - 1) // 2, 'W'
    spec_map = {'eo': 'EAO', 'ap': 'AP', 'kss': 'KSS', 'oze': 'OZE', 'ep': 'EP', 'sist': 'SiST', 'em': 'EM', 'air': 'AIR',
                'aiim': 'AIiM', 'eiam': 'EiAM', 'aibsi': 'AiBSI', 'bitd': 'BTD', 'se': 'SE'}
    spec = spec_map.get(sp) if sp else None
    if prog == 'ET-N1' and year == 2024 and spec == 'EAO':
        spec = 'EA'  # niestacjonarne "EO" naboru 2024 = Elektroautomatyka
    return {'program': prog, 'year': year, 'type': typ, 'sem': sem, 'spec': spec, 'mode': 'FULL_TIME' if mode == 'st' else 'PART_TIME'}


def norm(s):
    s = unicodedata.normalize('NFD', s.lower().replace('ł', 'l'))
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9 ]+', ' ', s).split()


def despace(t):
    """Rozstrzelone litery ("F i z y k a [ L 5 ]") -> zlaczone."""
    toks = t.split(' ')
    out, run = [], []
    for tk in toks + ['  ']:
        if len(tk) == 1 and tk != ' ':
            run.append(tk)
            continue
        if len(run) >= 4:
            out.append(''.join(run))
        else:
            out.extend(run)
        run = []
        if tk != '  ':
            out.append(tk)
    return re.sub(r'\s+', ' ', ' '.join(out)).strip()


entries = json.load(open(ENTRIES))

FORM_TAG = r'\[\s*(W|ĆW\s*\d*|C\s*\d*|L\s*\d*|P\s*\d*(?:\s*/\s*L\s*\d+)?|B\s*\d*)\s*\]'
FORM_CALC = r'-\s*(W|Ć|L|P)\s*-(?:-?\s*(W|Ć|L|P)\s*-)?'
ROOM_RE = re.compile(r'(?<![\w/])(SALA\s+K\b|bud\.\s*H|[ABCFHI]\s?-?\d{1,3}[a-z]?\b(?:\(A\d+\))?)')
PERSON_RE = re.compile(r'((?:prof\.|dr|mgr|inż\.)(?:\s*hab\.)?(?:\s*inż\.)?)\s*([A-ZŁŚŻŹĆÓ][a-ząćęłńóśźż]+(?:-[A-ZŁŚŻŹĆ][a-ząćęłńóśźż]+)?)')
END_TOKENS = {'sem.', 'tyg.', 'tygodnie', 'tygodni', 'EO', 'AP', 'KSS', 'semestru', 'ON-LINE', 'online', 'K'}


def legend_of(lines):
    """Skroty i domyslni prowadzacy z objasnien: {skrot: (pelna nazwa, prowadzacy|None)}."""
    text = ' ; '.join(lines)
    text = text.replace('–', '-')
    out = {}
    for m in re.finditer(r'(?:(?<=^)|(?<=[\s,;:|]))([A-ZŁŚŻĆ][A-Za-zŁłŚśŻżĄąĘęÓóĆćŃńŹź.]{0,7})\s+-\s+([A-ZŁŚŻĄĘÓĆŃŹ][^;,]*?)(?=\s+[A-ZŁŚŻĆ][A-Za-zŁłŚśŻżĄąĘęÓóĆćŃńŹź.]{0,7}\s+-\s+[A-ZŁŚŻ]|[;,]|$)', text):
        abbr, rest = m.group(1).strip(), m.group(2).strip()
        if abbr in ('W', 'L', 'P', 'ĆW', 'B', 'C'):
            continue
        name = re.split(r'\s*\|\s*|\s+(?:prof\.|dr|mgr)\s|\s+gr\.', rest)[0].strip()
        pm = PERSON_RE.search(rest)
        out[abbr] = (name, pm.group(0) if pm else None)
    # "Algebra – dr Kwiatuszewska" (przedmiot - prowadzacy)
    for m in re.finditer(r'([A-ZŁŚŻ][a-ząćęłńóśźż]+(?:\s+[a-ząćęłńóśźż]+)*)\s+-\s+((?:prof\.|dr|mgr)[^;,|]*)', text):
        out.setdefault('#' + m.group(1).strip(), (m.group(1).strip(), PERSON_RE.search(m.group(2)).group(0) if PERSON_RE.search(m.group(2)) else None))
    return out


def footnotes_of(lines):
    out = {}
    for ln in lines:
        m = re.match(r'^(\d)\s+(.*)$', ln.strip())
        if m:
            out[m.group(1)] = m.group(2)
    return out


def acronyms(name):
    words = norm(name)
    a1 = ''.join(w[0] for w in words)
    a2 = ''.join(w[:2] if w[:2] in ('ch', 'cz', 'sz', 'rz') else w[0] for w in words)
    return {a1, a2}


def match_subject(raw, cands, legend):
    """Najlepsza pozycja programu dla napisu z komorki: (subject, score)."""
    r = raw.strip(' .,|-')
    if not r:
        return None, 0
    full = legend.get(r, (None,))[0] or legend.get(r.rstrip('.'), (None,))[0]
    tries = [full, r] if full else [r]
    alias = {'wf hala': 'Wychowanie fizyczne', 'wf': 'Wychowanie fizyczne', 'basen': 'Wychowanie fizyczne', 'j ang': 'Język angielski',
             'inf': 'Informatyka', 'fizyka': 'Fizyka', 'am': 'Analiza matematyczna'}
    a = alias.get(' '.join(norm(r)))
    if a:
        tries.insert(0, a)
    best, score = None, 0.0
    for t in tries:
        nt = norm(t)
        for c in cands:
            nc = norm(c)
            if nt == nc:
                s = 1.0
            elif nc[:len(nt)] == nt and len(nt) >= 1 and len(' '.join(nt)) >= 4:
                s = 0.93
            elif nt[:len(nc)] == nc:
                s = 0.9
            elif ''.join(nt) in acronyms(c) and len(''.join(nt)) >= 2:
                s = 0.88
            elif len(nt) <= len(nc) and all(nc[i].startswith(nt[i]) for i in range(len(nt))) and len(nt) >= 1 and sum(len(x) for x in nt) >= 3:
                s = 0.85
            else:
                st_, sc_ = {w[:5] for w in nt if len(w) > 2}, {w[:5] for w in nc if len(w) > 2}
                jac = len(st_ & sc_) / len(st_ | sc_) if st_ | sc_ else 0
                s = max(difflib.SequenceMatcher(None, ' '.join(nt), ' '.join(nc)).ratio() * 0.9, 0.8 if jac >= 0.6 else 0)
            if s > score:
                best, score = c, s
    return (best, score) if score >= 0.62 else (None, score)


def rhythm(text, cocount):
    """Wzor, zakres tygodni i daty z napisow ("I poł. sem.", "co 2 tyg.", "10 tygodni", "Zajęcia 8.10; ...")."""
    t = text.replace(' ', ' ')
    pat, f, to, dates = 'ALL', None, None, []
    if re.search(r'\bII\s*poł', t) or re.search(r'od\s+poł', t, re.I):
        f = 9
    elif re.search(r'\bI\s*poł', t) or re.search(r'do\s+poł', t, re.I):
        to = 8
    m = re.search(r'(\d+)\s*tygodni', t)
    if m and not re.search(r'co\s*2\s*tyg', t):
        to = int(m.group(1))
    if re.search(r'co\s*2\s*tyg', t):
        pat = 'ODD' if cocount == 0 else 'EVEN'
    for d, mth in re.findall(r'(\d{1,2})\.(\d{2})(?!\.\d{4})', t):
        mm = int(mth)
        if 1 <= mm <= 12 and re.search(r'[Zz]aj[eę]cia', t):
            dates.append(f'{2026 if mm >= 9 else 2027}-{mm:02d}-{int(d):02d}')
    if dates:
        pat = 'LIST'
    return pat, f, to, dates


def split_items(text):
    """Tekst komorki -> [(naglowek przed znacznikiem, znacznik formy, ogon)]."""
    marks = [(m.start(), m.end(), m.group(1), 'tag') for m in re.finditer(FORM_TAG, text)]
    marks += [(m.start(), m.end(), m.group(1) + ('+' + m.group(2) if m.group(2) else ''), 'calc') for m in re.finditer(FORM_CALC, text)]
    marks.sort()
    if not marks:
        return [(text, None, '')]
    items = []
    prev_end = 0
    for i, (s, e, form, kind) in enumerate(marks):
        seg = text[prev_end:s]
        # podzial segmentu: ogon poprzedniego zajecia | naglowek obecnego
        if i > 0:
            toks = seg.split()
            cut = 0
            for j, tk in enumerate(toks):
                if ROOM_RE.fullmatch(tk) or tk in END_TOKENS or re.fullmatch(r'[A-ZŁŚŻ][a-ząćęłńóśźż]+', tk) and j > 0 and toks[j - 1] in ('dr', 'mgr', 'prof.', 'hab.', 'inż.') or re.fullmatch(r'\d+', tk) or tk in ('|', 'z'):
                    cut = j + 1
            items[-1][2] += ' ' + ' '.join(toks[:cut])
            head = ' '.join(toks[cut:])
        else:
            head = seg
        items.append([head, (form, kind), ''])
        prev_end = e
    items[-1][2] += ' ' + text[prev_end:]
    return [(h.strip(' |'), f, t.strip(' |')) for h, f, t in items]


FORM_OF = {'W': 'LECTURE', 'Ć': 'EXERCISE', 'C': 'EXERCISE', 'L': 'LAB', 'P': 'PROJECT', 'B': 'LAB'}


def form_fallback(form, e):
    has = {'LECTURE': e['w'], 'EXERCISE': e['c'], 'LAB': e['l'], 'PROJECT': e['p'], 'SEMINAR': e['s']}
    order = {'LECTURE': ['LECTURE', 'EXERCISE'], 'EXERCISE': ['EXERCISE', 'SEMINAR', 'LAB', 'PROJECT'],
             'LAB': ['LAB', 'PROJECT', 'EXERCISE', 'SEMINAR'], 'PROJECT': ['PROJECT', 'LAB', 'EXERCISE'], 'SEMINAR': ['SEMINAR', 'EXERCISE']}[form]
    for f in order:
        if has[f]:
            return f
    return None


records, skipped, structure = [], [], {}


def add_structure(cfg, nslots, cof):
    key = f"{cfg['program']}:{cfg['year']}{cfg['type']}"
    st = structure.setdefault(key, {'sem': cfg['sem'], 'mode': cfg['mode'], 'specs': {}})
    st['specs'][cfg['spec'] or ''] = {'slots': nslots, 'cOf': cof}
    return key


for path in sorted(glob.glob(os.path.join(RAW, '*.json'))):
    name = os.path.basename(path)[:-5]
    cfg = config(name)
    data = json.load(open(path))[0]
    cands_e = [e for e in entries if e['program'] == cfg['program'] and e['y'] == cfg['year'] and e['ty'] == cfg['type'] and e['semester'] == cfg['sem']
               and (e['spec'] == '' or cfg['spec'] is None or e['spec'] == cfg['spec'])]
    if not cands_e:
        skipped.append(f'{name}: brak pozycji programu ({cfg})')
        continue
    cands = sorted({e['subject'] for e in cands_e})
    # objasnienia
    leg_lines, foot = [], {}
    for pg in data['pages']:
        leg_lines += pg.get('legend', []) or []
        for b in pg.get('blocks', []):
            if b['day'] is None:
                for c in b['cells']:
                    leg_lines += c['lines']
    legend = legend_of(leg_lines)
    foot = footnotes_of(leg_lines)

    # sloty (kolumny grup)
    cells = []  # (when, start, end, slots(None=wszystkie), lines)
    if name.startswith(('st-i-e-', 'st-m-e-')):
        pg = data['pages'][0]
        cols = pg['columns']
        lcol = [c[-1] for c in cols]
        cnum = [int(re.search(r'\d+', c[0]).group()) if re.search(r'\d+', c[0]) else 1 for c in cols]
        nslots = len(cols) if len(cols) > 1 else 1
        cof = [cnum[i] for i in range(nslots)]
        for c in pg['cells']:
            cells.append(({'day': c['day']}, c['start'], c['end'], list(range(c['c0'] + 1, c['c1'] + 2)) if nslots > 1 else None, c['lines']))
    elif name.startswith(('ns-i-e-', 'ns-m-e-')):
        allt = ' '.join(' '.join(c['lines']) for pg in data['pages'] for c in pg['cells'])
        allt = despace(allt)
        ls = [int(x) for x in re.findall(r'\[\s*L\s*(\d+)', allt)] + [int(x) for x in re.findall(r'\[\s*P\s*(\d+)', allt)]
        cs = [int(x) for x in re.findall(r'\[\s*ĆW\s*(\d+)', allt)]
        nslots = max(ls) if ls else (max(cs) if cs else 1)
        nc = max(cs) if cs else 1
        per = max(1, -(-nslots // nc))
        cof = [min(nc, i // per + 1) for i in range(nslots)]
        for pg in data['pages']:
            for c in pg['cells']:
                cells.append(({'date': c['date'] if c['date'] >= '2026-08' else '2027' + c['date'][4:]}, c['start'], c['end'], None, c['lines']))
    elif name.startswith('st-'):
        nslots, cof = 1, [1]
        for pg in data['pages']:
            for b in pg.get('blocks', []):
                if b['day'] is None:
                    continue
                labs = [re.search(r'lab\.?\s*(\d+)', ' '.join(col)) for col in b['columns']]
                nums = [int(m.group(1)) for m in labs if m]
                if len(nums) > nslots:
                    nslots = len(nums)
                    cw = ' '.join(' '.join(col) for col in b['columns'])
                    ncw = max([int(x) for x in re.findall(r'(?:ćw\.?|ćwiczeniowa)\s*(\d+)', cw)] or [1])
                    per = max(1, -(-nslots // ncw))
                    cof = [min(ncw, i // per + 1) for i in range(nslots)]
        for pg in data['pages']:
            for b in pg.get('blocks', []):
                if b['day'] is None:
                    continue
                ncols = len(b['columns'])
                for c in b['cells']:
                    sl = list(range(c['c0'] + 1, c['c1'] + 2)) if ncols > 1 and ncols == nslots else None
                    cells.append(({'day': b['day']}, f"{c['start']:02d}:15", f"{c['end']:02d}:00", sl, c['lines']))
    else:  # ns EiT
        nslots = data.get('ngroups', 1)
        ncw = max(1, nslots // 2) if nslots >= 4 else 1
        per = max(1, -(-nslots // ncw))
        cof = [min(ncw, i // per + 1) for i in range(nslots)]
        for pg in data['pages']:
            for z in pg['zjazdy']:
                for c in z['cells']:
                    sl = list(range(c['g0'], c['g1'] + 1)) if nslots > 1 else None
                    if sl and len(sl) >= nslots:
                        sl = None
                    cells.append(({'date': c['date']}, f"{c['start']:02d}:00", f"{c['end']:02d}:00", sl, c['lines']))
    key = add_structure(cfg, nslots, cof)

    seen = set()
    for when, start, end, slots, lines in cells:
        text = despace(' '.join(lines))
        if re.fullmatch(r'[\d\s–-]+', text):
            continue
        if not text or re.search(r'Objaśnienia|BASENOWYCH|Inauguracja|Podpisywanie|zajęcia zdalne|dyspozycji Dziekana|^\d+-\d+$', text):
            continue
        items = split_items(text)
        if len(items) == 1 and ' / ' in items[0][0]:
            h, f_, t_ = items[0]
            a_, b_ = h.split(' / ', 1)
            items = [(a_ + ' I poł.', f_, t_ + ' I poł. sem.'), (b_, f_, t_ + ' II poł. sem.')]
        cocount = 0
        prev_subj = None
        alt_pair = False
        hrs = [int(x) for x in re.findall(r'\((\d+)\s*h\)', text)]
        nblk = max(1, int(end[:2]) - int(start[:2])) if ':' in start else 1
        seq_weeks = -(-hrs[0] // nblk) if len(hrs) >= 2 else None
        item_no = -1
        for head, form, tail in items:
            body = f'{head} {tail}'
            # przypisy: samotna cyfra po nazwie
            for d in re.findall(r'(?<![\w.,;-])(\d)(?![\w.:-])', head + ' ' + tail):
                if d in foot:
                    body += ' ' + foot[d]
            raw = re.sub(r'\b(gr\.?\s*[\d,]+|SALA\s+K|C\d+[a-z]?)\b', '', head).strip(' |-')
            raw = re.sub(r'\s+\d$', '', raw).strip()
            raw = re.sub(r'^\d\s+', '', raw)
            raw = re.sub(r'\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}', '', raw).strip(' ►')
            toks_r = raw.split()
            if 1 < len(toks_r) <= 4 and all(len(t) <= 3 for t in toks_r) and len(''.join(toks_r)) <= 6:
                raw = ''.join(toks_r)
            if not raw and form and form[0].strip().startswith('B'):
                raw = 'Basen'
            subj, score = match_subject(raw, cands, legend)
            rest = re.sub(r'\b(do|od|poł\.?(sem\.)?|połowy|semestru|sem\.|godz\.?)\b|\(\d+h\)|[/\d\s.,:-]', '', raw)
            if prev_subj and (not subj or not rest):
                if not rest:
                    subj, score = prev_subj, 0.7
                    if raw.strip() == '/':
                        alt_pair = True
            if not subj:
                skipped.append(f'{name} {when} {start}: "{raw}" ({text[:80]})')
                continue
            prev_subj = subj
            e_opts = [e for e in cands_e if e['subject'] == subj]
            e = sorted(e_opts, key=lambda x: x['spec'] != (cfg['spec'] or ''))[0]
            # forma
            if form:
                f0, kind = form
                letter = f0.strip()[0]
                fm = FORM_OF.get(letter, 'LECTURE')
            else:
                if slots is None:
                    fm = 'LECTURE' if e['w'] else 'EXERCISE'
                elif len(slots) == 1:
                    fm = 'LAB'
                else:
                    fm = 'EXERCISE'
            if re.match(r'Seminarium', subj):
                fm = 'SEMINAR'
            fm2 = form_fallback(fm, e)
            if not fm2:
                skipped.append(f'{name} {when} {start}: {subj} — brak formy {fm} w programie')
                continue
            # grupy (sloty)
            sl = slots
            ftxt = form[0] if form else ''
            mnum = re.search(r'(\d+)', ftxt.split('/')[0]) if ftxt else None
            if mnum:
                n = int(mnum.group(1))
                if ftxt.strip().startswith(('Ć', 'C')):
                    sl = [i + 1 for i in range(nslots) if cof[i] == n] or None
                else:
                    sl = [n] if n <= nslots else None
            mg = re.search(r'gr\.?\s*([\d,]+)', body)
            if mg and nslots > 1:
                nums = [int(x) for x in mg.group(1).split(',') if x]
                if fm2 == 'EXERCISE' and all(n <= max(cof) for n in nums) and len(nums) == 1 and (slots is None or len(slots) > 1):
                    sl = [i + 1 for i in range(nslots) if cof[i] in nums]
                elif (fm2 in ('LAB', 'PROJECT') or len(nums) > 1) and not (slots and len(slots) == 1):
                    sl = [n for n in nums if n <= nslots]
            if fm2 == 'LECTURE':
                sl = None
            item_no += 1
            pat, fidx, tidx, dates = rhythm(body, cocount)
            if alt_pair:
                pat = 'EVEN'
                if records and records[-1]['subject'] == subj and records[-1]['pattern'] == 'ALL':
                    records[-1]['pattern'] = 'ODD'
            if seq_weeks and re.search(r'\(\d+\s*h\)', body):
                if item_no == 0:
                    fidx, tidx = None, seq_weeks
                else:
                    fidx, tidx = seq_weeks + 1, None
            if pat in ('ODD', 'EVEN'):
                cocount += 1
            # P2/L2 I/II pol.: dwa zajecia
            forms = [fm2]
            if ftxt and '/' in ftxt and 'I/II' in body.replace(' ', ''):
                forms = ['PROJECT', 'LAB']
            if ftxt and '+' in ftxt:
                forms = [FORM_OF[x[0]] for x in ftxt.split('+')]
                pat = 'ODD'
            rm = ROOM_RE.search(tail) or ROOM_RE.search(head)
            room = None
            if rm:
                room = rm.group(1)
                room = 'K' if room.startswith('SALA') else 'H (hala)' if room.startswith('bud') else re.sub(r'[\s-]', '', room).split('(')[0]
            if re.search(r'ON-?LINE|online', body, re.I):
                room = None
            pm = PERSON_RE.search(tail) or PERSON_RE.search(head)
            person = pm.group(0) if pm else None
            if not person:
                for k, (nm, pers) in legend.items():
                    if pers and (nm == subj or k == raw or k == '#' + subj):
                        person = pers
                        break
            for k, f_ in enumerate(forms):
                ff, tt = fidx, tidx
                pp = pat
                if len(forms) == 2 and '+' not in (ftxt or ''):
                    ff, tt = (None, 8) if k == 0 else (9, None)
                if len(forms) == 2 and '+' in (ftxt or ''):
                    pp = 'ODD' if k == 0 else 'EVEN'
                if form_fallback(f_, e) != f_:
                    continue
                rec = {'cohort': key, 'sem': cfg['sem'], 'spec': cfg['spec'], **when, 'start': start, 'end': end, 'raw': raw, 'subject': subj, 'score': round(score, 2),
                       'form': f_, 'slots': sl, 'room': room, 'person': person, 'pattern': pp, 'fromIndex': ff, 'toIndex': tt, 'dates': dates, 'src': name}
                sig = json.dumps({k2: v for k2, v in rec.items() if k2 not in ('raw', 'score')}, sort_keys=True)
                if sig in seen:
                    continue
                seen.add(sig)
                records.append(rec)

json.dump({'structure': structure, 'records': records, 'skipped': skipped}, open(OUT, 'w'), ensure_ascii=False, indent=1)
print('rekordow', len(records), 'pominietych', len(skipped))
