"""Prowadzacy z planow WN -> dane z bazy kontaktow UMG (kontakt_wyniki?kontakt_tekst=<nazwisko>).

Uzycie: python wn_prowadzacy.py plan.json cache_dir wyjscie.json
Wynik: {"Nazwisko|Imie": {lastName, firstName, title, email, unit: [..]} albo null (brak w bazie)}.
"""
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

FIX = {('Jellonnek', 'Dariusz'): ('Jellonek', 'Dariusz'), ('Shoeneich', 'Marta'): ('Schoeneich', 'Marta'),
       ('Tessmer', 'Agni'): ('Tessmer', 'Agnieszka'), ('Mateusz', 'Torbicki'): ('Torbicki', 'Mateusz')}


def clean(s):
    return html.unescape(re.sub(r'<[^>]+>', ' ', s)).replace('\xa0', ' ').strip()


def fetch(name, cache):
    f = os.path.join(cache, re.sub(r'[^\w-]', '_', name) + '.html')
    if os.path.exists(f):
        return open(f, encoding='utf-8').read()
    url = 'https://www.umg.edu.pl/kontakt_wyniki?' + urllib.parse.urlencode({'kontakt_tekst': name})
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (planista)'}), timeout=30) as r:
        text = r.read().decode('utf-8')
    open(f, 'w', encoding='utf-8').write(text)
    time.sleep(0.6)
    return text


def parse(text):
    i = text.find('Wyszukiwanie frazy')
    if i < 0:
        return []
    body = text[i:text.find('</div>', i)]
    out = []
    for block in re.split(r'<hr\s*/?>', body)[1:]:
        m = re.search(r'<h3>(.*?)</h3>', block, re.S)
        if not m:
            continue
        p = {'name': clean(m.group(1))}
        t = re.search(r'</h3>\s*<p>(.*?)</p>', block, re.S)
        p['title'] = clean(t.group(1)) if t else ''
        h4 = re.search(r'<h4>(.*?)</h4>', block, re.S)
        p['unit'] = [x for x in (clean(x) for x in re.split(r'<br\s*/?>', h4.group(1))) if x] if h4 else []
        for dt, dd in re.findall(r'<dt>(.*?)</dt>\s*<dd>(.*?)</dd>', block, re.S):
            p[clean(dt).lower()] = clean(dd)
        out.append(p)
    return out


def main():
    plan, cache, out = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(cache, exist_ok=True)
    people = {(r['person']['last'], r['person']['first']): r['person'].get('title', '') for r in json.load(open(plan, encoding='utf-8')) if r['person']}
    result = {}
    for (last, first), ptitle in sorted(people.items()):
        l2, f2 = FIX.get((last, first), (last, first))
        found = parse(fetch(l2, cache))
        hit = None
        for p in found:
            toks = p['name'].split()
            if toks and toks[-1].lower() == l2.lower() and ' '.join(toks[:-1]).lower().startswith(f2.lower()[:3]) and p.get('email'):
                hit = p
                break
        key = f'{last}|{first}'
        if hit:
            toks = hit['name'].split()
            result[key] = {'lastName': toks[-1], 'firstName': ' '.join(toks[:-1]), 'title': hit['title'] or ptitle or None,
                           'email': hit['email'].lower(), 'unit': hit['unit']}
        else:
            result[key] = {'lastName': l2, 'firstName': f2, 'title': ptitle or None, 'email': None, 'unit': []}
        print(key, '->', result[key]['email'], ' / '.join(result[key]['unit']))
    json.dump(result, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


main()
