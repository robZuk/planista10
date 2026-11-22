"""Arkusze stacjonarne Elektrotechniki WE (Excel: st-i-e-*.pdf, st-m-e-*.pdf) -> surowe komorki JSON.

Uklad: naglowek z grupami (wiersz "ĆW1 .. ĆW5" i pod nim "L1/P1/B1 .."), potem dni (wiersz z nazwa
dnia) i godziny 7:15-8:00 ... (etykiety po obu stronach). Komorki zajec: obszary bez ramek.
Uzycie: python we_st_el.py plik.pdf [...] > wyjscie.json
"""
import json
import re
import sys

import pdfplumber

sys.path.insert(0, __import__('os').path.dirname(__file__))
import we_cells  # noqa: E402

DAYS = {'PONIEDZIAŁEK': 'MONDAY', 'WTOREK': 'TUESDAY', 'ŚRODA': 'WEDNESDAY', 'CZWARTEK': 'THURSDAY', 'PIĄTEK': 'FRIDAY'}


def hour_of(text):
    m = re.match(r'(\d{1,2})\s*(\d\d)?\s*-\s*(\d{1,2})\s*(\d\d)?', text.replace(' ', ' '))
    if not m:
        return None
    h1, m1, h2, m2 = m.groups()
    return f'{int(h1):02d}:{m1 or "00"}', f'{int(h2):02d}:{m2 or "00"}'


def parse(path):
    pdf = pdfplumber.open(path)
    out = {'file': path.split('/')[-1], 'pages': []}
    for page in pdf.pages:
        words = page.extract_words()
        if not any(w['text'] in DAYS for w in words):
            continue
        segs = we_cells.segments(page)
        title = [' '.join(w['text'] for w in words if abs(w['top'] - t) < 2) for t in sorted({round(w['top']) for w in words if w['top'] < 60})]
        day_words = [w for w in words if w['text'] in DAYS]
        first_day = min(w['top'] for w in day_words)
        # kolumna godzin po lewej: x etykiet "7"
        # granice kolumn: pionowe ramki przecinajace wiersz naglowka tuz nad pierwszym dniem
        head = [w for w in words if first_day - 25 < w['top'] < first_day - 2]
        head_y = max(w['top'] for w in head) + 2
        xs = sorted({round(s[1], 1) for s in segs if s[0] == 'v' and s[2] < head_y < s[3]})
        xs = [x for i, x in enumerate(xs) if i == 0 or x - xs[i - 1] > 3]
        # granice wierszy: poziome ramki w kolumnie godzin, od naglowka w dol
        ys = sorted({round(s[1], 1) for s in segs if s[0] == 'h' and s[1] > first_day - 6 and s[3] - s[2] > 5})
        ys = [y for i, y in enumerate(ys) if i == 0 or y - ys[i - 1] > 3]
        # etykiety kolumn (dolny i gorny wiersz naglowka)
        def labels_at(y0, y1):
            ws = [w for w in words if y0 <= w['top'] <= y1 and xs[0] - 1 <= w['x0'] <= xs[-1] + 1]
            return [{'x0': round(w['x0'], 1), 'x1': round(w['x1'], 1), 'text': w['text']} for w in ws]
        head_lines = sorted({round(w['top']) for w in head})
        col_labels = []
        for c in range(len(xs) - 1):
            labs = []
            for hl in head_lines:
                t = ' '.join(w['text'] for w in head if abs(w['top'] - hl) < 2 and xs[c] - 2 <= (w['x0'] + w['x1']) / 2 <= xs[c + 1] + 2)
                labs.append(t)
            col_labels.append(labs)
        # wspolny podpis gornego wiersza (ĆW1 nad dwiema kolumnami) — wg srodka napisu
        upper = []
        if len(head_lines) > 1:
            for w in head:
                if abs(w['top'] - head_lines[0]) < 2:
                    upper.append({'text': w['text'], 'xc': (w['x0'] + w['x1']) / 2})
        # wiersze: dzien albo godzina
        rows = []
        day = None
        for r in range(len(ys) - 1):
            y0, y1 = ys[r], ys[r + 1]
            band = [w for w in words if y0 <= (w['top'] + w['bottom']) / 2 <= y1]
            dname = next((DAYS[w['text']] for w in band if w['text'] in DAYS), None)
            if dname:
                day = dname
                rows.append({'kind': 'day', 'day': day})
                continue
            # godzina z kolejnosci wiersza w dniu (siatka WE: 7:15-8:00, 8:15-9:00, ...)
            k = sum(1 for x in rows if x['kind'] == 'hour' and x['day'] == day)
            hr = (f'{7 + k:02d}:15', f'{8 + k:02d}:00')
            rows.append({'kind': 'hour', 'day': day, 'time': hr})
        regs = we_cells.boxes(page, xs, ys, segs)
        cells = []
        for g in regs:
            rr = rows[g['r0']:g['r1'] + 1]
            if any(r['kind'] == 'day' for r in rr):
                continue
            if any(r['time'] is None for r in rr):
                continue
            cells.append({'day': rr[0]['day'], 'start': rr[0]['time'][0], 'end': rr[-1]['time'][1], 'nrows': len(rr),
                          'c0': g['c0'], 'c1': g['c1'], 'lines': g['lines']})
        legend = [' '.join(w['text'] for w in words if abs(w['top'] - t) < 2) for t in sorted({round(w['top']) for w in words if w['top'] > ys[-1] + 2})]
        out['pages'].append({'title': title, 'columns': col_labels, 'upper': upper, 'xs': xs, 'cells': cells, 'legend': legend})
    return out


if __name__ == '__main__':
    json.dump([parse(p) for p in sys.argv[1:]], sys.stdout, ensure_ascii=False, indent=1)
