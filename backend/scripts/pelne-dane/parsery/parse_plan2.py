#!/usr/bin/env python3
"""Ogolniejszy parser tabel PLAN STUDIOW z PDF-ow WM (pdftotext -layout).
Obsluguje: Lp z kropka i bez, kolumny l/p, P/S, p\\s, liczby z 'E' (egzamin) i ulamkami (0,7),
godziny tygodniowe (x15) albo laczne, moduly specjalnosci pod tabela ("MODUL IEI").
Wyjscie jak parse_plan.py; wiersze maja pola sems{nr:{W,C,L,P,S,ECTS}} w GODZINACH NA SEMESTR."""
import json, re, sys

ROMAN = {'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8}
KMAP = {'w': 'W', 'c': 'C', 'l': 'L', 'l/p': 'L', 'p': 'P', 'p/s': 'P', 'p\\s': 'P', 's': 'S', 'ects': 'ECTS', 'ect': 'ECTS'}
FORMS = ['W', 'C', 'L', 'P', 'S']
NUM = re.compile(r'\d+(,\d+)?E?')

def toks(line):
    return [(m.start(), m.end(), m.group()) for m in re.finditer(r'\S+', line)]

def val(t):
    return float(t.rstrip('E').replace(',', '.'))

def colmap_from(line):
    cols = [(s, e, KMAP[t.lower()]) for s, e, t in toks(line) if t.lower() in KMAP]
    groups, cur = [], []
    for c in cols:
        cur.append(c)
        if c[2] == 'ECTS':
            groups.append(cur); cur = []
    return groups

def assign(nums, groups, offset):
    """nums -> {grupa: {forma: wartosc}}; ECTS po srodku, godziny po lewej krawedzi (z tolerancja)."""
    flat = [(gi, k, s, e) for gi, g in enumerate(groups) for (s, e, k) in g]
    out = {}
    for (s, e, t) in nums:
        if t == 'D':
            continue
        c = (s + e) / 2
        best = min(flat, key=lambda f: abs(((f[2] + f[3]) / 2) - c))
        gi, k = best[0], best[1]
        out.setdefault(gi + offset, {kk: 0.0 for kk in FORMS + ['ECTS']})[k] += val(t)
    return out

def parse(text):
    L = text.split('\n')
    tables = []
    i = 0
    while i < len(L):
        if 'PLAN STUDI' not in L[i]:
            i += 1; continue
        win = range(i, min(i + 16, len(L)))
        sem_line = next((k for k in win if L[k].count('Sem.') >= 2), None)
        col_line = next((k for k in win if len(colmap_from(L[k])) >= 2), None)
        razem = next((t for k in range(i, (col_line or i) + 2) for t in toks(L[k]) if t[2] == 'Razem'), None)
        nazwa = next((t for k in range(i, (col_line or i) + 2) for t in toks(L[k]) if t[2] == 'Nazwa'), None)
        if sem_line is None or col_line is None or razem is None:
            i += 1; continue
        ctx = '\n'.join(L[max(0, i - 60):i + 1])
        sm = re.findall(r'Specjalno\S*:\s+(.+)', ctx)
        spec = sm[-1].strip() if sm else None
        groups = colmap_from(L[col_line])
        # Razem stoi przed pierwsza grupa; liczbe Razem rozpoznajemy po polozeniu
        first_col = groups[0][0][0]
        cut = razem[0] - 6
        lp_max = (nazwa[0] if nazwa else 20)
        rows, pending = [], []
        k = col_line + 1
        while k < len(L):
            ln = L[k]
            if re.search(r'Razem obci|RAZEM|Liczba godzin tygodniowo', ln):
                break
            if 'PLAN STUDI' in ln and k > col_line + 3:
                # kontynuacja tabeli na nastepnej stronie: nowy naglowek, ten sam uklad kolumn
                nc = next((x for x in range(k, min(k + 16, len(L))) if len(colmap_from(L[x])) >= 2), None)
                nr = next((t for x in range(k, (nc or k) + 2) for t in toks(L[x]) if t[2] == 'Razem'), None)
                if nc is None or nr is None:
                    k += 1
                    continue
                groups = colmap_from(L[nc]); first_col = groups[0][0][0]; cut = nr[0] - 6
                k = nc + 1
                continue
            tt = toks(ln)
            if tt and re.fullmatch(r'\d+\.\d+', tt[0][2]) and tt[0][0] < 8:
                tt = tt[1:]
            lp = tt[0] if tt and re.fullmatch(r'\d+\.?', tt[0][2]) and tt[0][0] < lp_max and len(tt) > 1 and not NUM.fullmatch(tt[1][2]) else None
            nums = [t for t in tt if t[0] >= cut and (NUM.fullmatch(t[2]) or t[2] == 'D') and t is not lp]
            words = [t for t in tt if t[0] < cut and t is not lp]
            name = ' '.join(w[2] for w in words).strip()
            if lp:
                tot = None
                rn = [t for t in nums if t[1] <= first_col - 1]
                rest = [t for t in nums if t[1] > first_col - 1]
                if rn: tot = val(rn[0][2]) if rn[0][2] != 'D' else 0
                g = assign(rest, groups, 0)
                rows.append({'lp': lp[2].rstrip('.'), 'name': ' '.join([*pending, name]).strip(), 'razem': tot, 'g': g})
                pending = []
            elif name and not nums:
                if rows and len(name) < 60 and not rows[-1].get('more') and (k - 1 >= 0) and rows and rows[-1]['name'] and ln.startswith(' ' * 8):
                    pending.append(name)
            k += 1
        tables.append({'spec': spec, 'semesters': len(groups) - 1, 'groups': groups, 'rows': rows, 'end': k})
        i = k
    # moduly specjalnosci pod tabela: "MODUL X  SEM. VI  SEM. VII", nastepnie linia kolumn
    mods = []
    for k, ln in enumerate(L):
        m = re.match(r'\s*MODU\S*\s+(\S+)', ln)
        if not m:
            continue
        semline = next((x for x in range(k, max(-1, k - 40), -1) if re.search(r'SEM\.\s+[IVX]+', L[x])), None)
        cl = next((x for x in range(k, min(k + 2, len(L))) if len(colmap_from(L[x])) >= 1), None)
        if semline is None or cl is None:
            continue
        sems = [ROMAN[t[2]] for t in toks(L[semline]) if t[2] in ROMAN]
        groups = colmap_from(L[cl])
        name_cut = groups[0][0][0] - 3
        rows = []
        x = cl + 1
        while x < len(L) and 'RAZEM' not in L[x]:
            tt = toks(L[x])
            nums = [t for t in tt if t[0] >= name_cut and NUM.fullmatch(t[2])]
            name = ' '.join(t[2] for t in tt if t[0] < name_cut)
            if name and nums:
                g = assign(nums, groups, 0)
                rows.append({'lp': '', 'name': name, 'razem': None, 'g': {sems[gi]: v for gi, v in g.items() if gi < len(sems)}, 'mod': True})
            x += 1
        mods.append({'spec': m.group(1), 'rows': rows})
    return tables, mods

def finalize(tables, mods):
    out = []
    for t in tables:
        rows = t['rows']
        # tryb: tygodniowy (x15) albo laczny
        def sums(r, f):
            return sum(v[f] for gi, v in r['g'].items() if gi > 0)
        tot_ok = sum(all(abs(sums(r, f) - r['g'].get(0, {}).get(f, 0)) < 0.6 for f in FORMS) for r in rows)
        wk_ok = sum(all(abs(sums(r, f) * 15 - r['g'].get(0, {}).get(f, 0)) < 8 for f in FORMS) for r in rows)
        mult = 15 if wk_ok > tot_ok else 1
        res = []
        for r in rows:
            if re.search(r'Modu|Moodu', r['name']):
                continue
            sems = {}
            for gi, v in r['g'].items():
                if gi == 0: continue
                hv = {f: round(v[f] * mult) for f in FORMS}
                hv['ECTS'] = round(v['ECTS'])
                if any(hv.values()): sems[gi] = hv
            total = {f: round(r['g'].get(0, {}).get(f, 0)) for f in FORMS}
            ok = all(abs(sum(s[f] for s in sems.values()) - total[f]) <= (8 if mult == 15 else 0) for f in FORMS)
            fixed = False
            if not ok and sems and sum(total.values()) > 0:
                # kolumny Razem sa pewne; rozklad na semestry proporcjonalnie do godzin semestru
                w = {k: sum(v[f] for f in FORMS) or 1 for k, v in sems.items()}
                W = sum(w.values())
                new = {k: {f: 0 for f in FORMS} | {'ECTS': v['ECTS']} for k, v in sems.items()}
                for f in FORMS:
                    left = total[f]
                    ks = sorted(new)
                    for idx, k in enumerate(ks):
                        h = left if idx == len(ks) - 1 else min(left, int(round(total[f] * w[k] / W / 5.0)) * 5)
                        new[k][f] = h; left -= h
                sems = {k: v for k, v in new.items() if any(v[f] for f in FORMS)}
                fixed = True
            res.append({'lp': r['lp'], 'name': r['name'], 'razem': r['razem'], 'total': total, 'sems': sems, 'ok': ok, 'fixed': fixed})
        out.append({'spec': t['spec'], 'semesters': t['semesters'], 'mode': 'tyg' if mult == 15 else 'lacznie', 'rows': res})
    mmult = 15 if (out and out[0].get('mode') == 'tyg') else 1
    for m in mods:
        res = []
        for r in m['rows']:
            sems = {}
            for sem, v in r['g'].items():
                hv = {f: round(v[f] * mmult) for f in FORMS}; hv['ECTS'] = round(v['ECTS'])
                if any(hv.values()): sems[sem] = hv
            res.append({'lp': '', 'name': r['name'], 'razem': None, 'total': {f: sum(s[f] for s in sems.values()) for f in FORMS}, 'sems': sems, 'ok': True})
        out.append({'spec': m['spec'], 'module': True, 'rows': res})
    return out

if __name__ == '__main__':
    tables, mods = parse(open(sys.argv[1], encoding='utf-8').read())
    out = finalize(tables, mods)
    json.dump({'tables': out}, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for t in out:
        bad = [r for r in t['rows'] if not r['ok']]
        print(f"  tabela spec={t['spec']} sem={t.get('semesters')} tryb={t.get('mode','modul')} wierszy={len(t['rows'])} zle={len(bad)} godz={sum(sum(s[f] for f in FORMS) for r in t['rows'] for s in r['sems'].values())}")
        for r in bad[:4]:
            print('    !', r['lp'], r['name'][:45], r['total'], {k: {kk: vv for kk, vv in v.items() if vv} for k, v in r['sems'].items()})
