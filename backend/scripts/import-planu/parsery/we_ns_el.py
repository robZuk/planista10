"""Arkusze niestacjonarne Elektrotechniki WE (Excel: ns-i-e-*.pdf, ns-m-e-*.pdf) -> surowe komorki JSON.

Uklad: bloki zjazdow (naglowek "Piątek 02.10.2026 | Sobota ... | Niedziela ..."), wiersze godzin
"8-9" ... "20-21" (60 min), w kazdym dniu waskie podkolumny grup bez podpisow — grupa jest w tekscie
komorki ([L1], [ĆW2], [W]). Komorki: prostokaty od tekstu do ramek (we_cells.boxes).
Uzycie: python we_ns_el.py plik.pdf [...] > wyjscie.json
"""
import json
import re
import sys

import pdfplumber

sys.path.insert(0, __import__('os').path.dirname(__file__))
import we_cells  # noqa: E402

DAY_RE = re.compile(r'(Piątek|Sobota|Niedziela)$')
DATE_RE = re.compile(r'(\d\d)\.(\d\d)\.(\d{4})')
HOUR_RE = re.compile(r'(\d{1,2})-(\d{1,2})$')


def dedupe(vals, tol=1.2):
    out = []
    for v in sorted(vals):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out


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
                    m = DATE_RE.match(d['text'])
                    heads.append({'x0': w['x0'], 'top': w['top'], 'bottom': w['bottom'], 'date': f'{m.group(3)}-{m.group(2)}-{m.group(1)}'})
        if not heads:
            continue
        segs = we_cells.segments(page)
        top = min(h['top'] for h in heads) - 3
        # etykiety godzin skladane ze znakow w kolumnach etykiet (slowa bywaja sklejone z tekstem komorki)
        anchor = [w for w in words if HOUR_RE.match(w['text']) and w['top'] > top]
        label_x = []
        for w in sorted(anchor, key=lambda w: w['x0']):
            if not label_x or w['x0'] - label_x[-1] > 30:
                label_x.append(w['x0'])
        hours = []
        for lx in label_x:
            lines = {}
            for c in page.chars:
                if lx - 4 <= c['x0'] <= lx + 14 and c['top'] > top:
                    lines.setdefault(round(c['top'], 0), []).append(c)
            for t, cs in lines.items():
                cs.sort(key=lambda c: c['x0'])
                txt = ''.join(c['text'] for c in cs).strip()
                if HOUR_RE.match(txt):
                    hours.append({'text': txt, 'x0': cs[0]['x0'], 'x1': cs[-1]['x1'], 'top': cs[0]['top'], 'bottom': cs[0]['bottom']})
        table_left = min(w['x0'] for w in hours) - 2
        table_right = max(s[3] for s in segs if s[0] == 'h')
        xs = dedupe([s[1] for s in segs if s[0] == 'v' and table_left - 1 <= s[1] <= table_right + 1 and s[3] > top])
        # wiersze z etykiet godzin (lewa kolumna), w kazdym pasie zjazdow osobno; granice dociagniete do ramek
        left_x = min(w['x0'] for w in hours)
        col = sorted([w for w in hours if abs(w['x0'] - left_x) < 8], key=lambda w: w['top'])
        ys, row_hours = [], []
        for i, w in enumerate(col):
            yc = (w['top'] + w['bottom']) / 2
            nxt = col[i + 1] if i + 1 < len(col) else None
            prv = col[i - 1] if i > 0 else None
            step = ((nxt['top'] - w['top']) if nxt and nxt['top'] - w['top'] < 14 else (w['top'] - prv['top']) if prv else 9.6)
            ys.append(yc - step / 2)
            row_hours.append(HOUR_RE.match(w['text']).groups())
            if not nxt or nxt['top'] - w['top'] > 14:
                ys.append(yc + step / 2)
                row_hours.append(None)  # przerwa miedzy pasami (naglowek dni)
        ys = we_cells.snap(ys, segs)
        hours_by_row = row_hours
        # granice komorek naglowkow dni: pionowe ramki przecinajace wiersz naglowka
        for h in heads:
            y = (h['top'] + h['bottom']) / 2
            vx = sorted(s[1] for s in segs if s[0] == 'v' and s[2] < y < s[3])
            left = max((x for x in vx if x <= h['x0'] + 1), default=h['x0'] - 2)
            right = min((x for x in vx if x > h['x0'] + 5), default=left + 80)
            h['x_left'], h['x_right'] = left, right
        boxes = we_cells.boxes(page, xs, ys, segs)
        cells = []
        for b in boxes:
            y0, y1 = ys[b['r0']], ys[b['r1'] + 1]
            x0, x1 = xs[b['c0']], xs[b['c1'] + 1]
            xc = (x0 + x1) / 2
            # dzien: naglowek nad komorka, ktorego kolumna zawiera srodek
            cands = [h for h in heads if h['x_left'] - 1 <= xc <= h['x_right'] + 1 and h['top'] < y0 + 2]
            if not cands:
                continue
            h = max(cands, key=lambda h: h['top'])
            # godziny: wiersze komorki (bez pasow naglowkow)
            labs = [hours_by_row[r] for r in range(b['r0'], b['r1'] + 1) if hours_by_row[r]]
            if not labs or any(hours_by_row[r] is None for r in range(b['r0'], b['r1'] + 1)):
                continue
            cells.append({'date': h['date'], 'start': f'{int(labs[0][0]):02d}:00', 'end': f'{int(labs[-1][1]):02d}:00',
                          'nrows': len(labs), 'x0': round(x0, 1), 'x1': round(x1, 1), 'dayx': [round(h['x_left'], 1), round(h['x_right'], 1)],
                          'lines': b['lines']})
        legend = [' '.join(w['text'] for w in words if abs(w['top'] - t) < 2) for t in sorted({round(w['top']) for w in words if w['top'] > ys[-1] - 1})]
        title = [' '.join(w['text'] for w in words if abs(w['top'] - t) < 2) for t in sorted({round(w['top']) for w in words if w['top'] < top - 2})]
        res['pages'].append({'title': title, 'cells': cells, 'legend': legend})
    return res


if __name__ == '__main__':
    json.dump([parse(p) for p in sys.argv[1:]], sys.stdout, ensure_ascii=False, indent=1)
