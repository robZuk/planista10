"""Lista siatek godzin WZNJ z formularza programow: rok x stopien x tryb x kierunek x specjalnosc.
Uzycie: python3 siatki_lista.py BUNDLE.pem > lista.tsv  (rok, stopien, tryb, kierunek, spec, url, opis)"""
import html, re, sys
sys.path.insert(0, __import__('os').path.dirname(__file__))
import karta

bundle = sys.argv[1]
YEARS = {'211': '2025/26', '152': '2024/25', '151': '2023/24', '150': '2022/23'}
for ry, ylab in YEARS.items():
    for sv, slab in karta.options(karta.cascade(bundle, [ry]), 'f[cascade][stopien]'):
        for tv, tlab in karta.options(karta.cascade(bundle, [ry, sv]), 'f[cascade][tryb]'):
            for kv, klab in karta.options(karta.cascade(bundle, [ry, sv, tv]), 'f[cascade][kierunek]'):
                specs = karta.options(karta.cascade(bundle, [ry, sv, tv, kv]), 'f[cascade][spec]') or [('', '')]
                for pv, plab in specs:
                    frag = karta.cascade(bundle, [ry, sv, tv, kv] + ([pv] if pv else []))
                    i = frag.find('karta-results-group--siatka')
                    part = frag[i:frag.find('</ul>', i)] if i >= 0 else ''
                    for url, txt in re.findall(r'<a href="([^"]+)"[^>]*>(.*?)</a>', part, re.S):
                        print('\t'.join([ylab, slab, tlab, klab, plab, url, html.unescape(txt).strip()]), flush=True)
                    i = frag.find('karta-results-group--program')
                    part = frag[i:frag.find('</ul>', i)] if i >= 0 else ''
                    for url, txt in re.findall(r'<a href="([^"]+)"[^>]*>(.*?)</a>', part, re.S):
                        print('\t'.join([ylab, slab, tlab, klab, plab, 'PROGRAM ' + url, html.unescape(txt).strip()]), flush=True)
