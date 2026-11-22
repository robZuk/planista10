"""Wspolny ekstraktor komorek arkuszy planu WE (pdfplumber).

Arkusz to siatka pol: wiersze (godziny) x kolumny (grupy albo podkolumny dnia). Komorka zajec to
obszar sasiednich pol, miedzy ktorymi nie ma ramki. Ramki bywaja liniami (Calc) albo cienkimi
czarnymi prostokatami (Excel) — obie postaci sprowadzamy do odcinkow poziomych i pionowych.

regions(page, xs, ys) -> lista obszarow {r0, r1, c0, c1, text_lines, fill}
  xs — granice kolumn (rosnaco), ys — granice wierszy (rosnaco).
"""
import re


def segments(page):
    """Odcinki ramek: (orient, stala, od, do). orient 'h' (y stale) albo 'v' (x stale)."""
    segs = []
    for l in page.lines:
        if abs(l['top'] - l['bottom']) < 0.6:
            segs.append(('h', (l['top'] + l['bottom']) / 2, min(l['x0'], l['x1']), max(l['x0'], l['x1'])))
        elif abs(l['x0'] - l['x1']) < 0.6:
            segs.append(('v', (l['x0'] + l['x1']) / 2, min(l['top'], l['bottom']), max(l['top'], l['bottom'])))
    for r in page.rects:
        c = r.get('non_stroking_color')
        black = c in (0, 0.0, (0,), (0.0,), (0, 0, 0), (0.0, 0.0, 0.0), [0], [0.0], [0, 0, 0])
        if r.get('stroke') and not r.get('fill'):
            # obrys prostokata = 4 odcinki
            x0, x1, t, b = r['x0'], r['x1'], r['top'], r['bottom']
            segs += [('h', t, x0, x1), ('h', b, x0, x1), ('v', x0, t, b), ('v', x1, t, b)]
            continue
        if not black:
            continue
        if r['height'] < 2 and r['width'] >= 1:
            segs.append(('h', (r['top'] + r['bottom']) / 2, r['x0'], r['x1']))
        elif r['width'] < 2 and r['height'] >= 1:
            segs.append(('v', (r['x0'] + r['x1']) / 2, r['top'], r['bottom']))
    return segs


def covered(segs, orient, pos, a, b, tol=1.6, frac=0.6):
    """Czy odcinek [a,b] na linii orient=pos jest pokryty ramka w co najmniej `frac`."""
    if b - a <= 0:
        return False
    parts = sorted((max(a, s0), min(b, s1)) for o, p, s0, s1 in segs if o == orient and abs(p - pos) <= tol and s1 > a and s0 < b)
    tot, cur0, cur1 = 0.0, None, None
    for p0, p1 in parts:
        if cur1 is None or p0 > cur1:
            if cur1 is not None:
                tot += cur1 - cur0
            cur0, cur1 = p0, p1
        else:
            cur1 = max(cur1, p1)
    if cur1 is not None:
        tot += cur1 - cur0
    return tot >= frac * (b - a)


def regions(page, xs, ys, segs=None, min_chars=1):
    segs = segs if segs is not None else segments(page)
    nr, nc = len(ys) - 1, len(xs) - 1
    parent = list(range(nr * nc))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for r in range(nr):
        for c in range(nc):
            if c + 1 < nc and not covered(segs, 'v', xs[c + 1], ys[r] + 1, ys[r + 1] - 1):
                union(r * nc + c, r * nc + c + 1)
            if r + 1 < nr and not covered(segs, 'h', ys[r + 1], xs[c] + 1, xs[c + 1] - 1):
                union(r * nc + c, (r + 1) * nc + c)
    groups = {}
    for i in range(nr * nc):
        groups.setdefault(find(i), []).append(i)
    out = []
    for cells in groups.values():
        rs = [i // nc for i in cells]
        cs = [i % nc for i in cells]
        r0, r1, c0, c1 = min(rs), max(rs), min(cs), max(cs)
        box = (xs[c0], ys[r0], xs[c1 + 1], ys[r1 + 1])
        chars = [ch for ch in page.chars if box[0] - 0.5 <= (ch['x0'] + ch['x1']) / 2 <= box[2] + 0.5 and box[1] - 0.5 <= (ch['top'] + ch['bottom']) / 2 <= box[3] + 0.5]
        if len([ch for ch in chars if ch['text'].strip()]) < min_chars:
            continue
        out.append({'r0': r0, 'r1': r1, 'c0': c0, 'c1': c1, 'rect': len(cells) == (r1 - r0 + 1) * (c1 - c0 + 1),
                    'box': [round(v, 1) for v in box], 'lines': text_lines(chars)})
    out.sort(key=lambda x: (x['r0'], x['c0']))
    return out


def text_lines(chars):
    """Znaki -> linie tekstu (wg wysokosci), z odstepami miedzy slowami. Indeksy dolne/gorne
    (np. godziny 9^30) doklejane do linii o najblizszym srodku."""
    chars = sorted(chars, key=lambda c: (round(c['top']), c['x0']))
    lines = []
    for ch in chars:
        mid = (ch['top'] + ch['bottom']) / 2
        for ln in lines:
            if abs(ln['mid'] - mid) <= max(2.2, ch['size'] * 0.45):
                ln['chars'].append(ch)
                break
        else:
            lines.append({'mid': mid, 'chars': [ch]})
    out = []
    for ln in sorted(lines, key=lambda l: l['mid']):
        cs = sorted(ln['chars'], key=lambda c: c['x0'])
        txt, prev = '', None
        for c in cs:
            if prev is not None and c['x0'] - prev['x1'] > min(c['size'], prev['size']) * 0.22 and not txt.endswith(' '):
                txt += ' '
            txt += c['text']
            prev = c
        txt = re.sub(r'\s+', ' ', txt).strip()
        if txt:
            out.append(txt)
    return out


def boundaries(centers, lo=None, hi=None):
    """Granice pol z srodkow etykiet (polowy odstepow; skrajne — lo/hi albo pol odstepu)."""
    cs = sorted(centers)
    mids = [(a + b) / 2 for a, b in zip(cs, cs[1:])]
    first = lo if lo is not None else cs[0] - (cs[1] - cs[0]) / 2
    last = hi if hi is not None else cs[-1] + (cs[-1] - cs[-2]) / 2
    return [first] + mids + [last]


def boxes(page, xs, ys, segs=None):
    """Komorki jako prostokaty: od kazdego pola z tekstem rozszerzamy w lewo/prawo/gore/dol az do
    ramki (Excel: puste pola nie maja ramek, wiec scalanie sasiadow zlewaloby je z zajeciami).
    Zwraca liste {r0, r1, c0, c1, lines} bez powtorzen."""
    segs = segs if segs is not None else segments(page)
    nr, nc = len(ys) - 1, len(xs) - 1

    def vborder(c_edge, r):  # pionowa ramka na granicy xs[c_edge] w wierszu r
        return covered(segs, 'v', xs[c_edge], ys[r] + 1, ys[r + 1] - 1, frac=0.5)

    def hborder(r_edge, c):
        return covered(segs, 'h', ys[r_edge], xs[c] + 1, xs[c + 1] - 1, frac=0.5)

    def col_of(x):
        for c in range(nc):
            if xs[c] <= x < xs[c + 1]:
                return c
        return None

    def row_of(y):
        for r in range(nr):
            if ys[r] <= y < ys[r + 1]:
                return r
        return None

    seen = {}
    for ch in page.chars:
        if not ch['text'].strip():
            continue
        c = col_of((ch['x0'] + ch['x1']) / 2)
        r = row_of((ch['top'] + ch['bottom']) / 2)
        if c is None or r is None or (r, c) in seen:
            continue
        c0, c1, r0, r1 = c, c, r, r
        while c0 > 0 and not vborder(c0, r):
            c0 -= 1
        while c1 < nc - 1 and not vborder(c1 + 1, r):
            c1 += 1
        while r0 > 0 and not hborder(r0, c):
            r0 -= 1
        while r1 < nr - 1 and not hborder(r1 + 1, c):
            r1 += 1
        seen[(r, c)] = (r0, r1, c0, c1)
    out = {}
    for key in set(seen.values()):
        r0, r1, c0, c1 = key
        box = (xs[c0], ys[r0], xs[c1 + 1], ys[r1 + 1])
        chars = [ch for ch in page.chars if box[0] - 0.3 <= (ch['x0'] + ch['x1']) / 2 <= box[2] + 0.3 and box[1] - 0.3 <= (ch['top'] + ch['bottom']) / 2 <= box[3] + 0.3]
        out[key] = {'r0': r0, 'r1': r1, 'c0': c0, 'c1': c1, 'box': [round(v, 1) for v in box], 'lines': text_lines(chars)}
    return sorted(out.values(), key=lambda x: (x['r0'], x['c0'], x['r1'], x['c1']))


def snap(ys, segs, orient='h', tol=3.5):
    """Granice wierszy (albo kolumn) dociagniete do najblizszych rzeczywistych ramek."""
    pos = sorted({round(s[1], 2) for s in segs if s[0] == orient})
    out = []
    for y in ys:
        best = min(pos, key=lambda p: abs(p - y), default=None)
        out.append(best if best is not None and abs(best - y) <= tol else y)
    return out
