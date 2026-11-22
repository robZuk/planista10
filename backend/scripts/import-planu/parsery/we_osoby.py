"""Prowadzacy z planow WE -> osoby z bazy kontaktow UMG. Wybor przy kilku osobach o tym samym nazwisku:
jednostka WE (potem WI, SJO, SWFiS, WM, WN, WZNJ), zgodny tytul (prof./dr/mgr), stanowisko dydaktyczne.
Uzycie: python we_osoby.py norm.json osoby-umg.json out.json
"""
import json
import re
import sys

norm, umg, out = sys.argv[1:4]
recs = json.load(open(norm))['records']
found = json.load(open(umg))
ACAD = ('adiunkt', 'asystent', 'profesor', 'wykładowca', 'lektor', 'instruktor', 'docent', 'specjalista')
PREF = ['Wydział Elektryczny', 'Wydział Informatyki', 'Studium Języków Obcych', 'Studium Wychowania Fizycznego', 'Wydział Mechaniczny', 'Wydział Nawigacyjny', 'Wydział Zarządzania']


def rank(p, title):
    unit = ' / '.join(p.get('unit', []))
    u = next((i for i, x in enumerate(PREF) if x in unit), len(PREF))
    t = (p.get('title') or '').lower()
    tm = 0
    if title.startswith('prof') and ('prof' in t or 'hab' in t):
        tm = -2
    elif title.startswith('dr') and 'dr' in t and 'hab' not in t:
        tm = -2
    elif title.startswith('dr') and 'dr' in t:
        tm = -1
    elif title.startswith('mgr') and 'mgr' in t:
        tm = -2
    acad = 0 if any(a in (p.get('stanowisko') or '').lower() for a in ACAD) else 1
    return (acad, u, tm)


persons = sorted({r['person'] for r in recs if r['person']})
known = {}
for ps in found.values():
    for p in ps:
        known.setdefault(p['name'].split()[-1], []).append(p)


def surname(person):
    m = re.match(r'(.*?)\s*([A-ZŁŚŻŹĆÓ][\w-]+)$', person)
    return m.group(1).strip(), m.group(2)


full_names = {surname(x)[1] for x in persons}
res = {}
for person in persons:
    m_ = re.match(r'(.*?)\s*([A-ZŁŚŻŹĆÓ][\w-]+)$', person)
    title, last = m_.group(1).strip(), m_.group(2)
    cands = [p for p in found.get(last, []) if p['name'].split()[-1].lower() == last.lower() or p['name'].split()[-1].lower().startswith(last.lower() + '-')]
    if not cands and len(last) >= 4:
        # nazwisko obciete na krawedzi komorki: jedyne dluzsze nazwisko o tym poczatku
        longer = {n for n in list(known) + list(full_names) if n.startswith(last) and n != last}
        longer = {n for n in longer if not any(m != n and n.startswith(m) and m.startswith(last) for m in longer)}
        if len(longer) == 1:
            last = longer.pop()
            cands = [p for p in known.get(last, [])]
    if not cands:
        res[person] = {'lastName': last, 'firstName': '', 'title': title, 'email': None, 'unit': None, 'match': 'brak'}
        continue
    best = sorted(cands, key=lambda p: rank(p, title))[0]
    toks = best['name'].split()
    res[person] = {'lastName': toks[-1], 'firstName': ' '.join(toks[:-1]), 'title': best.get('title') or title, 'email': best.get('email'),
                   'unit': ' / '.join(best.get('unit', [])), 'match': 'jedna' if len(cands) == 1 else f'wybrana z {len(cands)}'}
json.dump(res, open(out, 'w'), ensure_ascii=False, indent=1)
from collections import Counter
print(Counter(v['match'].split(' z')[0] for v in res.values()))
for k, v in res.items():
    if v['match'] != 'jedna':
        print(k, '->', v['firstName'], v['lastName'], v['unit'], v['match'])

# Recznie: skroty obciete do kilku liter (jednoznaczne w kontekscie przedmiotu w arkuszu)
ALIAS = {'drSe': 'dr Seghir', 'drSegh': 'dr Seghir', 'drSeghir': 'dr Seghir', 'drNo': 'dr Nowak', 'drNow': 'dr Nowak',
         'drNowak': 'dr Nowak', 'drStrzelec': 'dr Strzelecka', 'mgrAlf': 'mgr Alfuth', 'drKo': None}
for a, t in ALIAS.items():
    if a in res:
        res[a] = res.get(t) if t else None
json.dump(res, open(out, 'w'), ensure_ascii=False, indent=1)
print('po aliasach:', sum(1 for v in res.values() if v and v['email']), 'z e-mailem,', sum(1 for v in res.values() if v and not v['email']), 'bez')
