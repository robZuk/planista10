"""Prowadzacy z planow WZNJ -> dane z bazy kontaktow UMG (kontakt_wyniki).

Uzycie: python3 -I osoby.py plan.json umg-wyniki.json > osoby.json
Klucz: nazwisko z planu (z literowkami); wartosc: osoba albo null (nie znaleziono — prowadzacy z adresem zastepczym).
Przy kilku osobach o tym nazwisku wybieramy pracownika WZNJ (jednostka "Wydział Zarządzania i Nauk o Jakości").
"""
import json
import re
import sys

plan = json.load(open(sys.argv[1], encoding='utf-8'))
umg = json.load(open(sys.argv[2], encoding='utf-8'))

TYPO = {'Dereszwska': 'Dereszewska', 'Skakovwski': 'Skakovski', 'Waśnierwska': 'Waśniewska', 'Stankiewcz': 'Stankiewicz',
        'Klopot': 'Klopott', 'Sniegocka': 'Śniegocka-Dworak', 'Śniegocka': 'Śniegocka-Dworak', 'Malewska': 'Malewska-Szymichowska',
        'Sulej': 'Sulej-Suchomska'}
SKIP = {'Fizykochem', 'Prof'}

names = sorted({re.sub(r'^(prof|dr|mgr|inż|hab)\.?\s*', '', t.strip()) for c in plan['cohorts'] for it in c['items'] for t in it['teachers']})
out = {}
for raw in names:
    if not raw or raw in SKIP:
        continue
    sn = TYPO.get(raw, raw)
    cands = [p for p in (umg.get(sn) or umg.get(raw) or []) if isinstance(p, dict) and p['name'].split()[-1].lower() == sn.lower()]
    wznj = [p for p in cands if 'Zarządzania i Nauk o Jakości' in ' / '.join(p.get('unit', []))]
    pick = (wznj or cands or [None])[0]
    if not pick:
        out[raw] = {'lastName': sn, 'firstName': '', 'title': '', 'email': None, 'unit': None}
        continue
    toks = pick['name'].split()
    title = re.sub(r'\s+', ' ', pick.get('title', '').replace('hab.inż', 'hab. inż').replace('prof.dr', 'prof. dr')).strip()
    out[raw] = {'lastName': toks[-1], 'firstName': ' '.join(toks[:-1]), 'title': title, 'email': pick.get('email') or None,
                'unit': ' / '.join(pick.get('unit', [])) or None}
json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
