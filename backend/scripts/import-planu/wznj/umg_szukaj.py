"""Wyszukiwarka kontaktow UMG (https://www.umg.edu.pl/kontakt_wyniki?kontakt_tekst=...) -> JSON osob.

Uzycie: python3 -I umg_szukaj.py plan.json KATALOG_CACHE > umg-wyniki.json
Bierze nazwiska prowadzacych z plan.json (normalize.py), poprawia znane literowki (osoby.py: TYPO).
"""
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

plan = json.load(open(sys.argv[1], encoding='utf-8'))
cache = Path(sys.argv[2])
cache.mkdir(parents=True, exist_ok=True)
TYPO = {'Dereszwska': 'Dereszewska', 'Skakovwski': 'Skakovski', 'Waśnierwska': 'Waśniewska', 'Stankiewcz': 'Stankiewicz',
        'Klopot': 'Klopott', 'Sniegocka': 'Śniegocka-Dworak', 'Śniegocka': 'Śniegocka-Dworak', 'Malewska': 'Malewska-Szymichowska',
        'Sulej': 'Sulej-Suchomska'}
names = sorted({TYPO.get(n, n) for n in (re.sub(r'^(prof|dr|mgr|inż|hab)\.?\s*', '', t.strip()) for c in plan['cohorts'] for it in c['items'] for t in it['teachers']) if n and n not in ('Fizykochem', 'Prof')})


def clean(s):
    return html.unescape(re.sub(r'<[^>]+>', ' ', s)).replace('\xa0', ' ').strip()


def parse(text):
    i = text.find('Wyszukiwanie frazy')
    if i < 0:
        return []
    body = text[i:text.find('</div>', i)]
    people = []
    for block in re.split(r'<hr\s*/?>', body)[1:]:
        m = re.search(r'<h3>(.*?)</h3>', block, re.S)
        if not m:
            continue
        p = {'name': re.sub(r'\s+', ' ', clean(m.group(1)))}
        t = re.search(r'</h3>\s*<p>(.*?)</p>', block, re.S)
        p['title'] = clean(t.group(1)) if t else ''
        h4 = re.search(r'<h4>(.*?)</h4>', block, re.S)
        if h4:
            p['unit'] = [x for x in (clean(x) for x in re.split(r'<br\s*/?>', h4.group(1))) if x]
        for dt, dd in re.findall(r'<dt>(.*?)</dt>\s*<dd>(.*?)</dd>', block, re.S):
            p[clean(dt).lower()] = clean(dd)
        people.append(p)
    return people


out = {}
for n in names:
    f = cache / (re.sub(r'[^\w-]', '_', n) + '.html')
    if not f.exists():
        url = 'https://www.umg.edu.pl/kontakt_wyniki?' + urllib.parse.urlencode({'kontakt_tekst': n})
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (planista)'}), timeout=30) as r:
            f.write_text(r.read().decode('utf-8'), encoding='utf-8')
        time.sleep(0.5)
    out[n] = parse(f.read_text(encoding='utf-8'))
json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
