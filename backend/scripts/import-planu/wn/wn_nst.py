"""Plany niestacjonarne WN (arktur pliki_nst/*.pdf, Excel) -> JSON komorek.

Strona: bloki dni ("1.10.2026" + nazwa dnia), wiersz grup GR.01..GR.NN, wiersze 45-min ("16:00 16:45").
Komorka: przedmiot / forma (W, C, L, ...) / prowadzacy "Nazwisko Imie, tytul"; sala w zoltym polu
w prawym dolnym rogu. Po prawej stronie dnia pionowy napis miejsca (Morska, JP II, ON-LINE).
Uzycie: python wn_nst.py plik.pdf [...] > wyjscie.json
"""
import json
import os
import re
import sys

import pdfplumber

sys.path.insert(0, os.path.dirname(__file__))
import wn_cells  # noqa: E402

DATE_RE = re.compile(r'(\d{1,2})\.(\d{1,2})\.(\d{4})$')
TIME_RE = re.compile(r'(\d\d):(\d\d)')


def dedupe(vals, tol=1.2):
    out = []
    for v in sorted(vals):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out


def parse(path):
    pdf = pdfplumber.open(path)
    res = {'file': os.path.basename(path), 'title': [], 'days': []}
    for pi, page in enumerate(pdf.pages):
        words = page.extract_words()
        if pi == 0:
            res['title'] = [' '.join(w['text'] for w in words if abs(w['top'] - t) < 2) for t in sorted({round(w['top']) for w in words if w['top'] < 88})]
        segs = wn_cells.segments(page)
        dates = [w for w in words if DATE_RE.match(w['text']) and 200 < w['x0'] < 300]
        for di, dw in enumerate(dates):
            d, m, y = map(int, DATE_RE.match(dw['text']).groups())
            top = dw['top']
            bottom = dates[di + 1]['top'] - 2 if di + 1 < len(dates) else page.height
            grs = [w for w in words if re.fullmatch(r'GR\.\w+', w['text']) and top < w['top'] < top + 25]
            if not grs:
                continue
            gy = grs[0]['bottom']
            # wiersze: etykiety godzin skladane ze znakow w kolumnie x 50..78
            # kolumna etykiet godzin: od lewej krawedzi tabeli do pierwszej grupy
            lab_x1 = min(g['x0'] for g in grs) - 2
            first_digit = min((c['x0'] for c in page.chars if gy < c['top'] < bottom and c['text'].isdigit() and c['x0'] < lab_x1), default=50)
            lines = {}
            for c in page.chars:
                if first_digit - 1 <= c['x0'] <= first_digit + 26 and gy < c['top'] < bottom:
                    lines.setdefault(round(c['top']), []).append(c)
            rows = []
            for t, cs in sorted(lines.items()):
                txt = ''.join(c['text'] for c in sorted(cs, key=lambda c: c['x0']))
                tm = TIME_RE.findall(txt)
                if len(tm) >= 2:
                    a, b = tm[0], tm[1]
                    rows.append({'y': t + 2.5, 'start': int(a[0]) * 60 + int(a[1]), 'end': int(b[0]) * 60 + int(b[1])})
            if not rows:
                continue
            ys_lab = [r['y'] for r in rows]
            step = 6.0
            ys = [ys_lab[0] - step / 2] + [(a + b) / 2 for a, b in zip(ys_lab, ys_lab[1:])] + [ys_lab[-1] + step / 2]
            ys = wn_cells.snap(ys, segs, tol=2.5)
            # kolumny grup: granice pionowe w wierszu naglowka
            left = min((s[1] for s in segs if s[0] == 'v' and s[3] > ys[0] and s[2] < ys[-1] and first_digit + 20 < s[1] <= min(g['x0'] for g in grs)), default=min(g['x0'] for g in grs) - 10)
            right = max(s[3] for s in segs if s[0] == 'h' and ys[0] - 1 < s[1] < ys[-1] + 1)
            xs = dedupe([s[1] for s in segs if s[0] == 'v' and left - 1 <= s[1] <= right + 1 and s[3] > ys[0] and s[2] < ys[-1]])
            if xs[-1] < right - 2:
                xs.append(right)
            # kolumny grup: przedzial xs zawierajacy srodek podpisu GR (naglowki bywaja scalone)
            gcols = []
            for g in grs:
                xc = (g['x0'] + g['x1']) / 2
                l = max((x for x in xs if x <= xc), default=g['x0'] - 2)
                r = min((x for x in xs if x > xc), default=g['x1'] + 2)
                gcols.append({'name': g['text'], 'x0': l, 'x1': r})
            boxes = wn_cells.boxes(page, xs, ys, segs)
            # miejsce: pionowy napis po prawej (znaki obrocone) — wszystkie znaki na prawo od tabeli
            place = ''
            yellow = [r for r in page.rects if r.get('fill') and str(r.get('non_stroking_color')).startswith('(1.0, 1.0, 0') and top < r['top'] < bottom]

            def inside(c, r, pad=0.5):
                return r['x0'] - pad <= (c['x0'] + c['x1']) / 2 <= r['x1'] + pad and r['top'] - pad <= (c['top'] + c['bottom']) / 2 <= r['bottom'] + pad

            cells = []
            for b in boxes:
                x0, x1 = xs[b['c0']], xs[b['c1'] + 1]
                y0, y1 = ys[b['r0']], ys[b['r1'] + 1]
                groups = [g['name'] for g in gcols if x0 - 1 <= (g['x0'] + g['x1']) / 2 <= x1 + 1]
                box = {'x0': x0, 'x1': x1, 'top': y0, 'bottom': y1}
                chars = [c for c in page.chars if inside(c, box, 0.3)]
                if x0 >= gcols[-1]['x1'] - 1:
                    place = ''.join(c['text'] for c in sorted(chars, key=lambda c: -c['top']))
                    continue
                if not groups:
                    continue
                rooms = [r for r in yellow if x0 - 1 <= r['x0'] and r['x1'] <= x1 + 1 and y0 - 1 <= r['top'] and r['bottom'] <= y1 + 1]
                # sala: czerwone znaki w zoltym polu (nazwisko bywa dluzsze i wchodzi w pole sali)
                red = lambda c: str(c.get('non_stroking_color')).startswith('(1.0, 0.0, 0.0')
                room = ' '.join(' '.join(wn_cells.text_lines([c for c in chars if inside(c, r) and red(c)])) for r in rooms).strip()
                rest = [c for c in chars if not (red(c) and any(inside(c, r) for r in rooms))]
                rr = rows[b['r0']:b['r1'] + 1]
                cells.append({'start': rr[0]['start'], 'end': rr[-1]['end'], 'groups': groups, 'room': room, 'lines': wn_cells.text_lines(rest),
                              'x0': round(x0, 1), 'x1': round(x1, 1)})
            res['days'].append({'date': f'{y}-{m:02d}-{d:02d}', 'place': place, 'groups': [g['name'] for g in gcols], 'cells': cells})
    return res


if __name__ == '__main__':
    json.dump([parse(p) for p in sys.argv[1:]], sys.stdout, ensure_ascii=False, indent=1)
