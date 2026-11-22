"""Prowadzacy z planow WI -> dane/wi/osoby.json: napis z planu -> dane z bazy kontaktow UMG.

Uzycie: python wi_osoby.py <plan.json> <wyniki wyszukiwarki json...> > osoby.json
Dopasowanie: nazwisko + pierwsza litera imienia (gdy jest w planie); niejednoznaczne — wybor jednostki WI.
Osoby spoza bazy kontaktow: e-mail zastepczy @plan-wi.invalid.
"""
import json
import re
import sys
import unicodedata

plan = json.load(open(sys.argv[1], encoding='utf-8'))
contacts = {}
for f in sys.argv[2:]:
    for k, v in json.load(open(f, encoding='utf-8')).items():
        contacts.setdefault(k, []).extend(v)


def ascii(s):
    s = unicodedata.normalize('NFKD', s.replace('ł', 'l').replace('Ł', 'L'))
    return ''.join(c for c in s if not unicodedata.combining(c)).lower()


def clean(p):
    p = re.sub(r'\(.*?\)', '', p).replace(', prof. UMG', '').replace(', prof.', '').replace('mgr.', 'mgr')
    return ' '.join(p.split())


out = {}
for raw in sorted({x['person'] for x in plan if x.get('person')}):
    p = clean(raw)
    words = p.split()
    last = words[-1]
    first = next((w for w in reversed(words[:-1]) if w[0].isupper() and w not in ('UMG',)), None)
    title = ' '.join(w for w in words[:-1] if not (w[0].isupper()))
    cands = [c for k, v in contacts.items() if ascii(k) == ascii(last) or ascii(k) == ascii(last).replace('sulkowski', 'sulkowski') for c in v]
    cands = [c for c in cands if ascii(c['name'].split()[-1]) == ascii(last)]
    if first:
        cands = [c for c in cands if ascii(c['name'].split()[0])[0] == ascii(first)[0]] or cands
    wi = [c for c in cands if 'Informatyki' in ' / '.join(c.get('unit', []))]
    pick = (wi or cands)[0] if (wi or cands) else None
    if pick:
        names = pick['name'].split()
        out[raw] = {'firstName': ' '.join(names[:-1]), 'lastName': names[-1], 'title': pick.get('title') or title or None,
                    'email': pick['email'], 'unit': ' / '.join(pick.get('unit', []))}
    else:
        fn = first if first and not first.endswith('.') else ''
        out[raw] = {'firstName': fn, 'lastName': last, 'title': title or None,
                    'email': f"{ascii((fn[:1] + '.') if fn else '')}{ascii(last)}@plan-wi.invalid", 'unit': None}
json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
