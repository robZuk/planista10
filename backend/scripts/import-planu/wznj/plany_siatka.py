"""Plany stacjonarne WZNJ (arkusze-siatki: dzien x godzina w wierszach, grupy w kolumnach) -> JSON komorek.

Komorka zajec = obszar pol ograniczony ramkami (union-find po sasiadach bez ramki miedzy nimi;
ramka moze byc zapisana po dowolnej stronie granicy). Pola scalone traktujemy jak jeden obszar.
Wiersze: etykiety "7:00 - 8:00" w kolumnie B (i dzien w kolumnie A). Obslugiwane .xlsx (openpyxl)
i .xls (xlrd z formatting_info).

Uzycie: python plany_siatka.py plik [...] > siatka.json
"""
import json
import re
import sys

DAYS = {'PONIEDZIAŁEK': 'MONDAY', 'WTOREK': 'TUESDAY', 'ŚRODA': 'WEDNESDAY', 'CZWARTEK': 'THURSDAY', 'PIĄTEK': 'FRIDAY',
        'MONDAY': 'MONDAY', 'TUESDAY': 'TUESDAY', 'WEDNESDAY': 'WEDNESDAY', 'THURSDAY': 'THURSDAY', 'FRIDAY': 'FRIDAY'}
HOUR = re.compile(r'^\s*(\d{1,2})[:.](\d\d)\s*-\s*(\d{1,2})[:.](\d\d)\s*$')


class Grid:
    def __init__(self, nrows, ncols):
        self.n, self.m = nrows, ncols
        self.val = [[None] * ncols for _ in range(nrows)]
        self.b = [[[False] * 4 for _ in range(ncols)] for _ in range(nrows)]  # top bottom left right
        self.merged = []  # (r0, r1, c0, c1) wlacznie


def load_xlsx(path):
    import openpyxl
    wb = openpyxl.load_workbook(path)
    for ws in wb.worksheets:
        if ws.max_row < 20:
            continue
        g = Grid(ws.max_row, ws.max_column)
        for row in ws.iter_rows():
            for c in row:
                r, k = c.row - 1, c.column - 1
                if r >= g.n or k >= g.m:
                    continue
                v = c.value
                g.val[r][k] = None if v is None else str(v)
                bd = c.border
                g.b[r][k] = [bool(bd.top.style), bool(bd.bottom.style), bool(bd.left.style), bool(bd.right.style)]
        for mr in ws.merged_cells.ranges:
            g.merged.append((mr.min_row - 1, mr.max_row - 1, mr.min_col - 1, mr.max_col - 1))
        yield ws.title, g


def load_xls(path):
    import xlrd
    wb = xlrd.open_workbook(path, formatting_info=True)
    for sh in wb.sheets():
        if sh.nrows < 20:
            continue
        g = Grid(sh.nrows, sh.ncols)
        for r in range(sh.nrows):
            for k in range(sh.ncols):
                c = sh.cell(r, k)
                v = c.value
                g.val[r][k] = None if v in ('', None) else (str(v) if not isinstance(v, float) else str(v))
                xf = wb.xf_list[c.xf_index]
                bd = xf.border
                g.b[r][k] = [bd.top_line_style > 0, bd.bottom_line_style > 0, bd.left_line_style > 0, bd.right_line_style > 0]
        for r0, r1, c0, c1 in sh.merged_cells:
            g.merged.append((r0, r1 - 1, c0, c1 - 1))
        yield sh.name, g


def regions(g, c_from, c_to, r_from, r_to):
    parent = {}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for r in range(r_from, r_to):
        for c in range(c_from, c_to):
            parent[(r, c)] = (r, c)
    for r0, r1, c0, c1 in g.merged:
        cells = [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1) if (r, c) in parent]
        for x in cells[1:]:
            union(cells[0], x)
    for r in range(r_from, r_to):
        for c in range(c_from, c_to):
            if c + 1 < c_to and not (g.b[r][c][3] or g.b[r][c + 1][2]):
                union((r, c), (r, c + 1))
            if r + 1 < r_to and not (g.b[r][c][1] or g.b[r + 1][c][0]):
                union((r, c), (r + 1, c))
    groups = {}
    for x in parent:
        groups.setdefault(find(x), []).append(x)
    return list(groups.values())


def parse(path):
    loader = load_xls if path.endswith('.xls') else load_xlsx
    out = []
    for name, g in loader(path):
        # wiersze godzin: kolumna z etykietami "7:00 - 8:00" (pierwsza z lewej)
        hour_col = None
        for c in range(min(4, g.m)):
            if sum(1 for r in range(g.n) if g.val[r][c] and HOUR.match(g.val[r][c])) > 10:
                hour_col = c
                break
        if hour_col is None:
            continue
        rows = {}
        day = None
        first_row = None
        for r in range(g.n):
            for c in range(hour_col + 1):
                v = (g.val[r][c] or '').strip().upper()
                if v in DAYS:
                    day = DAYS[v]
            v = g.val[r][hour_col]
            m = HOUR.match(v or '')
            if m and day:
                rows[r] = (day, int(m.group(1)), int(m.group(3)))
                first_row = r if first_row is None else first_row
        # prawa granica: druga kolumna godzin (powtorzone etykiety) albo koniec
        right = g.m
        for c in range(hour_col + 2, g.m):
            if sum(1 for r in rows if g.val[r][c] and HOUR.match(g.val[r][c])) > 10:
                right = c
                break
        header = [' | '.join(x for x in g.val[r] if x) for r in range(first_row or 0) if any(g.val[r])]
        header_cells = [[r, c, g.val[r][c]] for r in range(first_row or 0) for c in range(g.m) if g.val[r][c]]
        cells = []
        # obszary w obrebie dnia (dni oddzielamy, zeby ramka dnia nie byla jedyna granica)
        by_day = {}
        for r, (d, h0, h1) in rows.items():
            by_day.setdefault(d, []).append(r)
        for d, rs in by_day.items():
            for reg in regions(g, hour_col + 1, right, min(rs), max(rs) + 1):
                texts = []
                for (r, c) in sorted(reg):
                    v = g.val[r][c]
                    if v and v.strip():
                        texts.append((r, c, re.sub(r'[ \t]*\n[ \t]*', ' ', v).strip()))
                if not texts:
                    continue
                r0 = min(r for r, _ in reg)
                r1 = max(r for r, _ in reg)
                c0 = min(c for _, c in reg)
                c1 = max(c for _, c in reg)
                if r0 not in rows or r1 not in rows:
                    continue
                cells.append({'day': d, 'start': rows[r0][1], 'end': rows[r1][2], 'r0': r0, 'r1': r1, 'c0': c0, 'c1': c1,
                              'ncells': len(reg), 'rect': len(reg) == (r1 - r0 + 1) * (c1 - c0 + 1),
                              'lines': [t for _, _, t in texts]})
        cells.sort(key=lambda x: (list(DAYS.values()).index(x['day']), x['start'], x['c0']))
        notes = [' | '.join(x for x in g.val[r][right:] if x) for r in range(g.n) if any(g.val[r][right + 1:] if right < g.m else [])]
        out.append({'file': path.split('/')[-1], 'sheet': name, 'header': header, 'header_cells': header_cells, 'cols': [hour_col + 1, right], 'cells': cells,
                    'footer': [' | '.join(x for x in g.val[r] if x) for r in range(max(rows) + 1, g.n) if any(g.val[r])] if rows else []})
    return out


if __name__ == '__main__':
    res = []
    for p in sys.argv[1:]:
        res.extend(parse(p))
    json.dump(res, sys.stdout, ensure_ascii=False, indent=1)
