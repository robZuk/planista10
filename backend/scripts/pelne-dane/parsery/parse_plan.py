#!/usr/bin/env python3
"""
Parser tabel "PLAN STUDIOW" z programow studiow UMG (pdftotext -layout).

Kazda tabela: kolumny Razem (W C L P S ECTS) i semestry (Sem. I.. z wlasnym zestawem
W/C/L/P/S/ECTS). Liczby stoja pod litera kolumny (godziny) albo wyrownane do prawej pod
"ECTS". Kazdy wiersz sprawdzamy: suma godzin z semestrow == kolumna Razem dla kazdej formy.

Wyjscie (JSON): { "tables": [ { "spec": "DUT"|null, "rows": [ {name, total{W..}, sems{nr: {W,C,L,P,S,ECTS}}, ok} ] } ] }
"""
import json, re, sys

ROMAN = {'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8}
KINDS = ['W', 'C', 'L', 'P', 'S', 'ECTS']


def tokens(line):
    return [(m.start(), m.end(), m.group()) for m in re.finditer(r'\S+', line)]


def parse_tables(text):
    lines = text.split('\n')
    tables = []
    i = 0
    while i < len(lines):
        if 'PLAN STUDI' not in lines[i]:
            i += 1
            continue
        # naglowek z semestrami i wiersz z literami kolumn
        sem_line = next((k for k in range(i, min(i + 8, len(lines))) if 'Sem.' in lines[k]), None)
        col_line = next((k for k in range(i, min(i + 10, len(lines))) if re.search(r'\bW\s+C\s+L\b', lines[k]) and 'ECTS' in lines[k]), None)
        if sem_line is None or col_line is None:
            i += 1
            continue
        # specjalnosc z kilku linii nad tabela: "w zakresie: ... (DUT)"
        ctx = ' '.join(lines[max(0, i - 8):i + 1])
        m = re.search(r'w zakresie:.*?\(([A-ZŻŹĆĄŚĘŁÓŃa-ząćęłńóśźż0-9]+)\)', ctx)
        spec = m.group(1) if m else None
        sems = [ROMAN.get(t[2].rstrip('.'), None) for t in tokens(lines[sem_line]) if t[2].rstrip('.') in ROMAN and t[2] != 'Sem.']
        cols = [t for t in tokens(lines[col_line]) if t[2] in KINDS]
        # grupy kolumn: kazda konczy sie na ECTS; pierwsza = Razem
        groups, cur = [], []
        for c in cols:
            cur.append(c)
            if c[2] == 'ECTS':
                groups.append(cur)
                cur = []
        if len(groups) < 2:
            i += 1
            continue
        colmap = []  # (center, groupIndex, kind)
        for gi, g in enumerate(groups):
            for (s, e, k) in g:
                colmap.append(((s + e) / 2 if k == 'ECTS' else s + 0.5, gi, k, s, e))
        rows = []
        k = col_line + 1
        pending_name = []
        def new_table(j):
            return 'PLAN STUDI' in lines[j] and any('Sem.' in lines[x] for x in range(j, min(j + 6, len(lines))))
        while k < len(lines) and 'Razem obci' not in lines[k] and not new_table(k):
            ln = lines[k]
            toks = tokens(ln)
            # numer strony "102.2" na poczatku linii pomijamy
            if toks and re.fullmatch(r'\d+\.\d+', toks[0][2]) and toks[0][0] < 8:
                toks = toks[1:]
            lp = toks[0] if toks and re.fullmatch(r'\d+\.', toks[0][2]) and toks[0][0] < 14 else None
            nums = [t for t in toks if re.fullmatch(r'\d+', t[2]) and t[0] > 70]
            words = [t for t in toks if t not in nums and t is not lp]
            if lp:
                name = ' '.join(w[2] for w in words if w[0] < 80).strip()
                row = {'lp': lp[2], 'name': name, 'parts': pending_name, 'nums': nums, 'after': []}
                rows.append(row)
                pending_name = []
            else:
                frag = ' '.join(w[2] for w in words if w[0] < 80).strip()
                if frag and not nums:
                    # fragment nazwy: przed wierszem z pustą nazwą albo po nim
                    if rows and rows[-1]['name'] == '' and not rows[-1]['after']:
                        rows[-1]['after'].append(frag)
                    else:
                        pending_name.append(frag)
            k += 1
        parsed = []
        for r in rows:
            name = ' '.join([*r['parts'], r['name'], *r['after']]).strip() if not r['name'] else r['name']
            if not r['name']:
                name = ' '.join([*r['parts'], *r['after']]).strip()
            total = {kk: 0 for kk in KINDS}
            semvals = {}
            razem = None
            for (s, e, v) in r['nums']:
                c = (s + e) / 2
                # najblizsza kolumna; liczba "Razem" (suma calkowita) stoi przed pierwsza grupa
                if e <= groups[0][0][0] - 1:
                    razem = int(v)
                    continue
                best = min(colmap, key=lambda cm: abs(cm[0] - (c if cm[2] == 'ECTS' else s + 0.5)))
                _, gi, kind, _, _ = best
                if gi == 0:
                    total[kind] = int(v)
                else:
                    sem = gi  # grupa 1 = Sem. I
                    semvals.setdefault(sem, {kk: 0 for kk in KINDS})[kind] += int(v)
            ok = all(sum(sv[kk] for sv in semvals.values()) == total[kk] for kk in ['W', 'C', 'L', 'P', 'S'])
            parsed.append({'lp': r['lp'], 'name': name, 'razem': razem, 'total': total, 'sems': semvals, 'ok': ok})
        tables.append({'spec': spec, 'semesters': len(groups) - 1, 'rows': parsed})
        i = k
    return tables


if __name__ == '__main__':
    text = open(sys.argv[1], encoding='utf-8').read()
    tables = parse_tables(text)
    json.dump({'tables': tables}, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for t in tables:
        bad = [r for r in t['rows'] if not r['ok']]
        print(f"tabela spec={t['spec']} semestrow={t['semesters']} wierszy={len(t['rows'])} niezgodnych={len(bad)}")
        for r in bad[:8]:
            print('  !', r['lp'], r['name'][:60], r['total'], {k: {kk: vv for kk, vv in v.items() if vv} for k, v in r['sems'].items()})
