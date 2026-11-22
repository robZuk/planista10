"""Plany stacjonarne WI (PDF: plan_informatyka_semN_*.pdf) -> JSON komorek: [{day, cols:[lab...], lines}].

Uklad: na kazdy dzien pasmo z naglowkiem "Lab 1..6" i "Ćw 1..3", wiersze co 15 min; komorka ma w tekscie
godziny "HH:MM–HH:MM", przedmiot, sale, grupe (L1, ĆW1, W, P1) i prowadzacego. Komorki = prostokaty
ramek (we_cells.boxes na siatce kolumn Lab x wierszy 15-min). Uzycie: python wi_st.py plik.pdf > out.json
"""
import json
import os
import re
import sys

import pdfplumber

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'parsery'))
import we_cells  # noqa: E402

DAYS = {'Poniedziałek': 'MONDAY', 'Wtorek': 'TUESDAY', 'Środa': 'WEDNESDAY', 'Czwartek': 'THURSDAY', 'Piątek': 'FRIDAY'}


def dedupe(vals, tol=1.5):
    out = []
    for v in sorted(vals):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out


def parse(path):
    pdf = pdfplumber.open(path)
    cells = []
    day = None
    for page in pdf.pages:
        words = page.extract_words()
        segs = we_cells.segments(page)
        heads = sorted([w for w in words if w['text'] in DAYS], key=lambda w: w['top'])
        times = sorted([w for w in words if re.fullmatch(r'\d\d:\d\d', w['text']) and w['x0'] < 45], key=lambda w: w['top'])
        labs = [w for w in words if w['text'] == 'Lab']
        # pasma: od naglowka dnia do nastepnego (albo do konca strony); strona 2 zaczyna sie kontynuacja dnia
        starts = [(h['top'], DAYS[h['text']]) for h in heads]
        if not starts or starts[0][0] > (times[0]['top'] if times else 1e9):
            starts.insert(0, (0, day))
        for i, (top, dname) in enumerate(starts):
            bottom = starts[i + 1][0] if i + 1 < len(starts) else page.height
            day = dname
            tt = [w for w in times if top < w['top'] < bottom]
            if not tt:
                continue
            lab_y = [l for l in labs if top < l['top'] < bottom]
            yl = (lab_y[0]['top'] + 3) if lab_y else tt[0]['top'] - 20
            left = min(w['x1'] for w in tt) + 1
            xs = dedupe([s[1] for s in segs if s[0] == 'v' and s[2] < yl < s[3] and s[1] > left - 3])
            if len(xs) < 7:
                xs = dedupe([s[1] for s in segs if s[0] == 'v' and s[2] < tt[0]['top'] + 2 < s[3] and s[1] > left - 3])
            step = tt[1]['top'] - tt[0]['top'] if len(tt) > 1 else 7.5
            ys = [w['top'] - 1 for w in tt] + [tt[-1]['top'] - 1 + step]
            ys = we_cells.snap(ys, segs, tol=2.5)
            bx = we_cells.boxes(page, xs, ys, segs)
            timed = [b for b in bx if re.search(r'\d\d:\d\d', ' '.join(b['lines']))]
            def span(bb):
                m = re.search(r'(\d\d):(\d\d)\s*[–-]\s*(\d\d):(\d\d)', ' '.join(bb['lines']))
                h1, m1, h2, m2 = map(int, m.groups())
                return max(1, round(((h2 * 60 + m2) - (h1 * 60 + m1)) / 15))
            for b in timed:
                # podkomorki bez godzin (co 2 tyg. A / B) pod paskiem godzin komorki
                last = b['r0'] + span(b) - 1
                subs = [o['lines'] for o in bx if o is not b and o not in timed and o['c0'] >= b['c0'] and o['c1'] <= b['c1'] and b['r0'] <= o['r0'] <= last]
                cells.append({'day': day, 'cols': list(range(b['c0'] + 1, b['c1'] + 2)), 'ncols': len(xs) - 1, 'lines': b['lines'], 'subs': subs})
    return cells


if __name__ == '__main__':
    json.dump(parse(sys.argv[1]), sys.stdout, ensure_ascii=False, indent=1)
