"""Przegladanie formularza programow studiow WZNJ (Drupal karta_browse_form, kaskada AJAX).

Uzycie: python3 -I karta.py BUNDLE.pem ROK_ID [stopien] [tryb] [kierunek] [spec]
Wypisuje opcje nastepnego poziomu albo (gdy wybrano wszystko) linki wynikow.
Formularz wymaga form_build_id z biezacej strony — pobieramy ja przed kazda kaskada.
"""
import html
import json
import re
import ssl
import sys
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar

BASE = 'https://wznj.umg.edu.pl'
PAGE = '/studia-i-i-ii-stopnia'
UA = 'Mozilla/5.0 (planista)'


def opener(bundle):
    ctx = ssl.create_default_context(cafile=bundle)
    return urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx), urllib.request.HTTPCookieProcessor(CookieJar()))


def get(op, url, data=None):
    req = urllib.request.Request(url, data=data, headers={'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest'} if data else {'User-Agent': UA})
    with op.open(req, timeout=60) as r:
        return r.read().decode('utf-8')


def options(fragment, name):
    m = re.search(r'<select[^>]*name="' + re.escape(name) + r'"[^>]*>(.*?)</select>', fragment, re.S)
    if not m:
        return []
    return [(v, html.unescape(t).strip()) for v, t in re.findall(r'<option value="([^"]+)"[^>]*>(.*?)</option>', m.group(1)) if v]


def cascade(bundle, values):
    """values: lista wartosci [rok, stopien, tryb, kierunek, spec] (prefiks). Zwraca html wrappera."""
    op = opener(bundle)
    page = get(op, BASE + PAGE)
    build = re.search(r'name="form_build_id" value="([^"]+)"', page).group(1)
    names = ['f[rok]', 'f[cascade][stopien]', 'f[cascade][tryb]', 'f[cascade][kierunek]', 'f[cascade][spec]']
    frag = page
    for i in range(len(values)):
        data = {'form_build_id': build, 'form_id': 'karta_browse_form', '_triggering_element_name': names[i], '_drupal_ajax': '1'}
        for j in range(i + 1):
            data[names[j]] = values[j]
        body = urllib.parse.urlencode(data).encode()
        resp = json.loads(get(op, BASE + PAGE + '?ajax_form=1&_wrapper_format=drupal_ajax', body))
        frag = '\n'.join(c.get('data', '') for c in resp if isinstance(c.get('data'), str))
        for c in resp:
            if c.get('command') == 'update_build_id':
                build = c['new']
    return frag


if __name__ == '__main__':
    bundle, vals = sys.argv[1], sys.argv[2:]
    frag = cascade(bundle, vals)
    names = ['f[cascade][stopien]', 'f[cascade][tryb]', 'f[cascade][kierunek]', 'f[cascade][spec]']
    nxt = names[len(vals) - 1] if len(vals) - 1 < len(names) else None
    if nxt:
        print(json.dumps(options(frag, nxt), ensure_ascii=False))
    links = sorted(set(re.findall(r'href="([^"]+\.(?:pdf|xlsx?|docx?))"', frag)))
    for a in re.findall(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', frag, re.S):
        if 'karta' in a[0] or a[0].endswith(('.pdf', '.xlsx', '.xls', '.docx')):
            print('LINK', a[0], '|', html.unescape(re.sub(r'<[^>]+>', ' ', a[1])).strip()[:120])
    if not links and not nxt:
        print(re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', frag)))[:3000])
