#!/usr/bin/env python3
"""Laczy sparsowane programy (WN HTML, WM PDF) w jeden plik programy.json dla generatora.
Program: {semesters, source, specs:[{short,name}], entries:[{name, sem, spec, W,C,L,P,S, ects}]}.
Przy kilku specjalnosciach wiersz identyczny we wszystkich (nazwa+semestr+godziny) = wspolny."""
import json, re, sys
S = sys.argv[1]
FORMS = ['W', 'C', 'L', 'P', 'S']
SKIP = re.compile(r'Praktyk|Praca dyplom|Egzamin dyplom|Przygotowanie pracy', re.I)

def clean(name):
    name = re.sub(r'\s*\*+$', '', name.strip())
    return re.sub(r'\s+', ' ', name)[:120]

def rows_of(table):
    out = []
    for r in table['rows']:
        if SKIP.search(r['name']) or not r['name']:
            continue
        for sem, v in r['sems'].items():
            h = {f: int(v.get(f, 0)) for f in FORMS}
            if sum(h.values()) == 0:
                continue
            out.append({'name': clean(r['name']), 'sem': int(sem), **h, 'ects': int(v.get('ECTS', 0))})
    return out

def key(e):
    return (e['name'], e['sem'], *[e[f] for f in FORMS])

def merge(spec_tables, common=None):
    """spec_tables: [(short, rows)]; common: rows wspolne podane wprost."""
    entries = [dict(e, spec=None) for e in (common or [])]
    if len(spec_tables) == 1 and common is None:
        return [dict(e, spec=None) for e in spec_tables[0][1]]
    if common is None:
        sets = [set(map(key, rows)) for _, rows in spec_tables]
        shared = set.intersection(*sets)
        seen = set()
        for _, rows in spec_tables:
            for e in rows:
                if key(e) in shared and key(e) not in seen:
                    seen.add(key(e)); entries.append(dict(e, spec=None))
        for short, rows in spec_tables:
            entries += [dict(e, spec=short) for e in rows if key(e) not in shared]
    else:
        for short, rows in spec_tables:
            entries += [dict(e, spec=short) for e in rows]
    return entries

def derive(entries, factor=0.6):
    out = []
    for e in entries:
        n = dict(e)
        for f in FORMS:
            n[f] = 0 if e[f] == 0 else max(5, int(round(e[f] * factor / 5.0)) * 5)
        out.append(n)
    return out

wn = json.load(open(f'{S}/wn.json', encoding='utf-8'))
def wnrows(k): return rows_of(wn[k]['tables'][0])
def wnname(k): return wn[k]['title']
def pdf(f): return json.load(open(f'{S}/pdf/{f}.json', encoding='utf-8'))['tables']

P = {}
def prog(code, semesters, source, specs, entries):
    P[code] = {'semesters': semesters, 'source': source, 'specs': specs, 'entries': entries}

WN_URL = 'https://wn.umg.edu.pl/karty/siatki/'
def wn_prog(code, sem, pages, shorts):
    specs = [{'short': s, 'name': wnname(p)} for p, s in zip(pages, shorts)]
    ent = merge([(s, wnrows(p)) for p, s in zip(pages, shorts)])
    if len(pages) == 1: specs = []
    prog(code, sem, ', '.join(WN_URL + p.replace('ns', 'ns,').replace('s', 's,', 1) if not p.startswith('ns') else WN_URL + 'ns,' + p[2:] for p in pages), specs, ent)

wn_prog('NAW-S1', 8, ['s1'], ['TM'])
wn_prog('NAW-N1', 8, ['ns1'], ['TM'])
wn_prog('NAW-S2', 3, ['s8', 's12', 's13', 's14', 's15', 's16', 's17'], ['TO', 'EZ', 'MSI', 'ZBTM', 'APSE', 'PHiON', 'ŻA'])
wn_prog('NAW-N2', 3, ['ns8', 'ns14'], ['TO', 'ZBTM'])
wn_prog('TR-S1', 7, ['s2', 's4'], ['TiL', 'EST'])
wn_prog('TR-N1', 7, ['ns2', 'ns4'], ['TiL', 'EST'])
wn_prog('TR-S2', 3, ['s3', 's9', 's10', 's11'], ['MSTiL', 'LSO', 'ESTiL', 'ZIiŚTŚ'])
wn_prog('TR-N2', 3, ['ns3', 'ns9', 'ns10', 'ns11'], ['MSTiL', 'LSO', 'ESTiL', 'ZIiŚTŚ'])

WM_URL = 'https://wm.umg.edu.pl/sites/default/files/zalaczniki/'
MIBM_SPECS = [{'short': 'TRUOiP', 'name': 'Technologia Remontów Urządzeń Okrętowych i Portowych'},
              {'short': 'IEI', 'name': 'Inżynieria Eksploatacji Instalacji'},
              {'short': 'IP', 'name': 'Inżynieria Produkcji'}]
def wm_modules(f):
    t = pdf(f)
    common = rows_of(t[0])
    mods = [(m['spec'], rows_of(m)) for m in t[1:] if m.get('module')]
    return common, mods
c, m = wm_modules('wm_prs1_mibm_o_25_www_0')
prog('MIBM-S1', 7, WM_URL + 'prs1_mibm_o_25_www_0.pdf', MIBM_SPECS, merge(m, common=c))
c, m = wm_modules('wm_ns_prs1_truoip_iei_ip_25-26_www')
prog('MIBM-N1', 7, WM_URL + 'ns_prs1_truoip_iei_ip_25-26_www.pdf', MIBM_SPECS, merge(m, common=c))
eso = [dict(e, spec=None) for e in rows_of(pdf('wm_prs1_mibm_esoioo_25_www')[0])]
prog('ESO-S1', 8, WM_URL + 'prs1_mibm_esoioo_25_www.pdf', [], eso)
prog('ESO-N1', 8, 'pochodny z ESO-S1 (godziny x0,6)', [], derive(eso))
prog('MIBM-S2', 3, WM_URL + 'prs2_iei_truoip_2021_www_1.pdf', [], [dict(e, spec=None) for e in rows_of(pdf('wm_prs2_iei_truoip_2021_www_1')[0])])
prog('MIBM-N2', 3, WM_URL + 'ns_prs2_truoip_iei_21_www.pdf', [], [dict(e, spec=None) for e in rows_of(pdf('wm_ns_prs2_truoip_iei_21_www')[0])])
edst = json.load(open(f'{S}/pdf/edst_s1_old.json', encoding='utf-8'))['tables']
edst_ent = merge([(t['spec'], rows_of(t)) for t in edst])
EDST_SPECS = [{'short': 'DUT', 'name': 'Diagnostyka Urządzeń Technicznych'}, {'short': 'ZEEW', 'name': 'Zarządzanie Eksploatacją Elektrowni Wiatrowych'}]
prog('EDST-S1', 7, WM_URL + 'prs1_edst_25_www.pdf', EDST_SPECS, edst_ent)
prog('EDST-N1', 7, 'pochodny z EDST-S1 (godziny x0,6)', EDST_SPECS, derive(edst_ent))

for code, p in P.items():
    by = {}
    for e in p['entries']:
        by.setdefault(e['sem'], 0); by[e['sem']] += sum(e[f] for f in FORMS)
    nspec = sum(1 for e in p['entries'] if e['spec'])
    bad = sorted(s for s in by if s > p['semesters'])
    print(f"{code:8} sem={p['semesters']} wpisow={len(p['entries']):4} specj.={nspec:4} godz/sem={[by.get(s,0) for s in range(1,p['semesters']+1)]} {'!poza:'+str(bad) if bad else ''}")
json.dump(P, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
