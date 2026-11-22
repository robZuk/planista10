"""Arkusze stacjonarne EiT / Informatyki / ST (Calc: st-i-eit-*, st-i-inf-*, st-m-eit-*, st-m-st-*) -> JSON.

Uklad: bloki dni (PONIEDZIAŁEK | WTOREK, ŚRODA | CZWARTEK, PIĄTEK | OBJAŚNIENIA), w bloku opcjonalne
naglowki kolumn "gr. lab. N" / "gr. ćw. N" (albo "grupa ćwiczeniowa N"), wiersze "7 - 8" ... "20 - 21"
(etykiety po bokach). Komorki: prostokaty od tekstu do ramek (we_cells.boxes).
Uzycie: python we_st_calc.py plik.pdf [...] > wyjscie.json
"""
import json
import re
import sys

import pdfplumber

sys.path.insert(0, __import__('os').path.dirname(__file__))
import we_cells  # noqa: E402

DAYS = {'PONIEDZIAŁEK': 'MONDAY', 'WTOREK': 'TUESDAY', 'ŚRODA': 'WEDNESDAY', 'CZWARTEK': 'THURSDAY', 'PIĄTEK': 'FRIDAY', 'OBJAŚNIENIA': None}


def dedupe(vals, tol=1.5):
    out = []
    for v in sorted(vals):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out


def hour_labels(page, x_from, x_to, y_from, y_to):
    """Etykiety wierszy "7 - 8": (srodek y, godzina startu) w pasie x."""
    lines = {}
    for w in page.extract_words():
        if x_from <= w['x0'] and w['x1'] <= x_to and y_from < w['top'] < y_to:
            lines.setdefault(round((w['top'] + w['bottom']) / 2), []).append(w)
    out = []
    for y, ws in sorted(lines.items()):
        t = ' '.join(w['text'] for w in sorted(ws, key=lambda w: w['x0']))
        m = re.fullmatch(r'(\d{1,2})\s*-\s*(\d{1,2})', t)
        if m:
            out.append((y, int(m.group(1))))
    return out


def parse(path):
    pdf = pdfplumber.open(path)
    res = {'file': path.split('/')[-1], 'pages': []}
    for page in pdf.pages:
        words = page.extract_words()
        day_words = [w for w in words if w['text'] in DAYS]
        if not day_words:
            res['pages'].append({'extra_text': [' '.join(w['text'] for w in words if abs(w['top'] - t) < 2) for t in sorted({round(w['top']) for w in words})]})
            continue
        segs = we_cells.segments(page)
        title = [' '.join(w['text'] for w in words if abs(w['top'] - t) < 2) for t in sorted({round(w['top']) for w in words if w['top'] < min(d['top'] for d in day_words) - 3})]
        blocks = []
        for dw in day_words:
            yc = dw['bottom'] + 25
            xc = (dw['x0'] + dw['x1']) / 2
            vx = sorted(s[1] for s in segs if s[0] == 'v' and s[2] < yc < s[3] and s[3] - s[2] > 60)
            left = max((x for x in vx if x < xc - 30), default=None)
            right = min((x for x in vx if x > xc + 30), default=None)
            if left is None or right is None:
                continue
            # koniec bloku: nastepny naglowek dnia ponizej w tej samej kolumnie albo dol strony
            below = [d['top'] for d in day_words if d['top'] > dw['top'] + 20 and abs((d['x0'] + d['x1']) / 2 - xc) < 60]
            bottom = min(below) - 4 if below else page.height
            labs = hour_labels(page, left - 45, left + 1, dw['bottom'], bottom)
            if not labs:
                labs = hour_labels(page, right - 1, right + 45, dw['bottom'], bottom)
            blocks.append({'word': dw, 'day': DAYS[dw['text']], 'left': left, 'right': right, 'bottom': bottom, 'labs': labs})
        out_blocks = []
        for b in blocks:
            labs = b['labs']
            if not labs:
                continue
            step = (labs[-1][0] - labs[0][0]) / max(1, len(labs) - 1)
            ys = [labs[0][0] - step / 2] + [(a[0] + c[0]) / 2 for a, c in zip(labs, labs[1:])] + [labs[-1][0] + step / 2]
            ys = we_cells.snap(ys, segs)
            # naglowki kolumn miedzy nazwa dnia a pierwszym wierszem
            hw = [w for w in words if b['left'] < w['x0'] < b['right'] and b['word']['bottom'] + 1 < w['top'] < ys[0] - 0.5]
            head_lines = sorted({round(w['top']) for w in hw})
            xs = [b['left'], b['right']]
            col_labels = [[]]
            if head_lines:
                # wiersz naglowka z najwieksza liczba podzialow (gr. lab.)
                best = []
                for hl in head_lines:
                    vx_l = dedupe([s[1] for s in segs if s[0] == 'v' and s[2] < hl + 3 < s[3] and b['left'] + 3 < s[1] < b['right'] - 3])
                    if len(vx_l) > len(best):
                        best = vx_l
                vx = best
                xs = [b['left']] + vx + [b['right']]
                col_labels = []
                for c in range(len(xs) - 1):
                    labs_c = []
                    for hl in head_lines:
                        t = ' '.join(w['text'] for w in sorted(hw, key=lambda w: w['x0']) if abs(w['top'] - hl) < 2 and xs[c] - 1 <= (w['x0'] + w['x1']) / 2 <= xs[c + 1] + 1)
                        labs_c.append(t)
                    col_labels.append(labs_c)
                upper = []
                for hl in head_lines[:-1]:
                    for t in re.finditer(r'\S.*?(?=\s{2,}|$)', ''):
                        pass
                    ws = sorted([w for w in hw if abs(w['top'] - hl) < 2], key=lambda w: w['x0'])
                    # sklejanie slow w napisy (przerwa > 6pt = nowy napis)
                    cur = []
                    for w in ws:
                        if cur and w['x0'] - cur[-1]['x1'] > 6:
                            upper.append({'text': ' '.join(x['text'] for x in cur), 'x0': cur[0]['x0'], 'x1': cur[-1]['x1']})
                            cur = []
                        cur.append(w)
                    if cur:
                        upper.append({'text': ' '.join(x['text'] for x in cur), 'x0': cur[0]['x0'], 'x1': cur[-1]['x1']})
            else:
                upper = []
            boxes = we_cells.boxes(page, xs, ys, segs)
            cells = []
            for bx in boxes:
                cells.append({'start': labs[bx['r0']][1], 'end': labs[bx['r1']][1] + 1, 'c0': bx['c0'], 'c1': bx['c1'], 'lines': bx['lines']})
            out_blocks.append({'day': b['day'], 'columns': col_labels, 'upper': [{'text': u['text'], 'x0': round(u['x0'], 1), 'x1': round(u['x1'], 1)} for u in upper],
                               'xs': [round(x, 1) for x in xs], 'cells': cells})
        footer = [' '.join(w['text'] for w in words if abs(w['top'] - t) < 2) for t in sorted({round(w['top']) for w in words if w['top'] > max(b['bottom'] for b in blocks if b['bottom'] < page.height) if any(b['bottom'] < page.height for b in blocks)})] if blocks else []
        res['pages'].append({'title': title, 'blocks': out_blocks})
    return res


if __name__ == '__main__':
    json.dump([parse(p) for p in sys.argv[1:]], sys.stdout, ensure_ascii=False, indent=1)
