"""Arkusze niestacjonarne EiT (Calc: ns-i-eit-*, ns-m-eit-*) -> surowe komorki JSON.

Uklad: strona = 2 zjazdy (lewy i prawy), kazdy 3 dni z naglowkiem "Piątek 20.11" (bez roku), wiersze
"07 – 08" ... "20 – 21" (60 min, etykiety po bokach). Dzien dzieli sie na N rownych podkolumn = grupy
laboratoryjne 1..N; komorka obejmuje podkolumny -> grupy. Skroty i prowadzacy w przypisach pod tabela.
Uzycie: python we_ns_calc.py plik.pdf [...] > wyjscie.json
"""
import json
import re
import sys

import pdfplumber

sys.path.insert(0, __import__('os').path.dirname(__file__))
import we_cells  # noqa: E402

DAY_RE = re.compile(r'(Piątek|Sobota|Niedziela)$')
DATE_RE = re.compile(r'(\d{1,2})\.(\d{1,2})$')


def dedupe(vals, tol=1.2):
    out = []
    for v in sorted(vals):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out


def year_of(month):
    return 2026 if month >= 8 else 2027


def parse(path):
    pdf = pdfplumber.open(path)
    res = {'file': path.split('/')[-1], 'pages': []}
    for page in pdf.pages:
        words = page.extract_words()
        heads = []
        for w in words:
            if DAY_RE.match(w['text']):
                d = next((x for x in words if abs(x['top'] - w['top']) < 2 and 0 <= x['x0'] - w['x1'] < 12 and DATE_RE.match(x['text'])), None)
                if d:
                    dd, mm = map(int, DATE_RE.match(d['text']).groups())
                    heads.append({'x0': w['x0'], 'x1': d['x1'], 'top': w['top'], 'bottom': w['bottom'], 'date': f'{year_of(mm)}-{mm:02d}-{dd:02d}', 'label': w['text']})
        if not heads:
            continue
        segs = we_cells.segments(page)
        # etykiety godzin "07 – 08"
        lines = {}
        for w in words:
            lines.setdefault(round((w['top'] + w['bottom']) / 2), []).append(w)
        labs = []
        for y, ws in lines.items():
            ws = sorted(ws, key=lambda w: w['x0'])
            # sklejanie trzech slow "07", "–", "08" po lewej stronie strony
            for i in range(len(ws) - 2):
                if re.fullmatch(r'\d\d', ws[i]['text']) and ws[i + 1]['text'] in ('–', '-') and re.fullmatch(r'\d\d', ws[i + 2]['text']):
                    labs.append({'y': y, 'x0': ws[i]['x0'], 'x1': ws[i + 2]['x1'], 'h': int(ws[i]['text'])})
        if not labs:
            continue
        res_page = {'title': [], 'zjazdy': [], 'legend': []}
        # bloki (strona ma czasem dwa pietra zjazdow): grupy naglowkow wg wysokosci
        tops = sorted({round(h['top']) for h in heads})
        bands = []
        for t in tops:
            if not bands or t - bands[-1] > 30:
                bands.append(t)
        for bi, bt in enumerate(bands):
            bh = [h for h in heads if abs(h['top'] - bt) < 30]
            next_t = bands[bi + 1] if bi + 1 < len(bands) else page.height
            blabs = sorted([l for l in labs if bt < l['y'] < next_t], key=lambda l: l['y'])
            # jedna kolumna etykiet (lewa) wystarczy do wierszy
            left_x = min(l['x0'] for l in blabs)
            rows = [l for l in blabs if abs(l['x0'] - left_x) < 5]
            rows.sort(key=lambda l: l['y'])
            step = (rows[-1]['y'] - rows[0]['y']) / max(1, len(rows) - 1)
            ys = [rows[0]['y'] - step / 2] + [(a['y'] + b['y']) / 2 for a, b in zip(rows, rows[1:])] + [rows[-1]['y'] + step / 2]
            ys = we_cells.snap(ys, segs)
            for h in bh:
                y = (h['top'] + h['bottom']) / 2
                vx = sorted(s[1] for s in segs if s[0] == 'v' and s[2] < y < s[3])
                h['xl'] = max((x for x in vx if x <= h['x0'] + 1), default=h['x0'] - 5)
                h['xr'] = min((x for x in vx if x >= h['x1'] - 1), default=h['x1'] + 5)
            tl, tr = min(h['xl'] for h in bh), max(h['xr'] for h in bh)
            xs = dedupe([s[1] for s in segs if s[0] == 'v' and tl - 1 <= s[1] <= tr + 1 and s[3] > ys[0] and s[2] < ys[-1]])
            boxes = we_cells.boxes(page, xs, ys, segs)
            cells = []
            for b in boxes:
                x0, x1 = xs[b['c0']], xs[b['c1'] + 1]
                xc = (x0 + x1) / 2
                h = next((h for h in bh if h['xl'] - 0.5 <= xc <= h['xr'] + 0.5), None)
                if h is None:
                    continue
                w = h['xr'] - h['xl']
                cells.append({'date': h['date'], 'start': rows[b['r0']]['h'], 'end': rows[b['r1']]['h'] + 1,
                              'f0': round((x0 - h['xl']) / w, 3), 'f1': round((x1 - h['xl']) / w, 3), 'lines': b['lines']})
            res_page['zjazdy'].append({'days': [h['date'] for h in bh], 'cells': cells})
        first = min(h['top'] for h in heads)
        res_page['title'] = [' '.join(w['text'] for w in words if abs(w['top'] - t) < 2) for t in sorted({round(w['top']) for w in words if w['top'] < first - 3})]
        last_row = max(l['y'] for l in labs)
        res_page['legend'] = [' '.join(w['text'] for w in sorted(words, key=lambda w: w['x0']) if abs(w['top'] - t) < 2) for t in sorted({round(w['top']) for w in words if w['top'] > last_row + 6})]
        res['pages'].append(res_page)
    # liczba podkolumn (grup lab.) w calym arkuszu: najwezsza komorka
    cells = [c for pg in res['pages'] for z in pg['zjazdy'] for c in z['cells']]
    widths = [c['f1'] - c['f0'] for c in cells if c['f1'] - c['f0'] > 0.05]
    n = round(1 / min(widths)) if widths else 1
    res['ngroups'] = n
    for c in cells:
        c['g0'] = round(c['f0'] * n) + 1
        c['g1'] = round(c['f1'] * n)
    return res


if __name__ == '__main__':
    json.dump([parse(p) for p in sys.argv[1:]], sys.stdout, ensure_ascii=False, indent=1)
