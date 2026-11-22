"""Plan niestacjonarny WI (xlsx, arkusz na rok) -> JSON zajec: [{sheet, date, start, end, cols, text}].

Uklad arkusza: pasma zjazdow (wiersz z nazwami dni, wiersz z datami — formuly =B5+7), pod nimi wiersze
blokow "8:00 - 10:25" (kolumna A); kazdy dzien ma 2 podkolumny (grupa lab. 1 i 2), komorki scalone.
Daty liczone z formul (proste =KOMORKA+N / -N). Uzycie: python wi_xlsx.py plik.xlsx > wyjscie.json
"""
import datetime as dt
import json
import re
import sys

import openpyxl
from openpyxl.utils import column_index_from_string, get_column_letter

DAYS = ('Piątek', 'Piąt', 'Sobota', 'Niedziela')


def evaluate(ws, coord, seen=None):
    seen = seen or set()
    if coord in seen:
        raise ValueError(f'cykl {coord}')
    seen.add(coord)
    v = ws[coord].value
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    m = re.fullmatch(r'=\s*([A-Z]+\d+)\s*([+-])\s*(\d+)', str(v or ''))
    if not m:
        return None
    base = evaluate(ws, m.group(1), seen)
    d = int(m.group(3)) * (1 if m.group(2) == '+' else -1)
    return base + dt.timedelta(days=d) if base else None


def merged_range(ws, cell):
    for r in ws.merged_cells.ranges:
        if cell.coordinate in r:
            return r
    return None


def parse(path):
    wb = openpyxl.load_workbook(path)
    out = []
    for ws in wb.worksheets:
        # wiersze naglowkow dni
        head_rows = [r for r in range(1, ws.max_row + 1) if any(str(ws.cell(r, c).value or '').strip() in DAYS for c in range(1, ws.max_column + 1))]
        for hi, hr in enumerate(head_rows):
            date_row = hr + 1
            end_row = head_rows[hi + 1] - 1 if hi + 1 < len(head_rows) else ws.max_row
            # kolumny dni: od kolumny naglowka do nastepnej (2 podkolumny)
            day_cols = []
            for c in range(1, ws.max_column + 1):
                if str(ws.cell(hr, c).value or '').strip() in DAYS:
                    d = evaluate(ws, ws.cell(date_row, c).coordinate)
                    day_cols.append((c, d))
            # wiersze blokow czasu
            blocks = []
            for r in range(date_row + 1, end_row + 1):
                t = str(ws.cell(r, 1).value or '')
                m = re.match(r'\s*(\d{1,2}):(\d\d)\s*-\s*(\d{1,2}):(\d\d)', t)
                if m:
                    blocks.append((r, f'{int(m.group(1)):02d}:{m.group(2)}', f'{int(m.group(3)):02d}:{m.group(4)}'))
            for bi, (r, start, end) in enumerate(blocks):
                for c, d in day_cols:
                    for sub in (c, c + 1):
                        cell = ws.cell(r, sub)
                        if cell.value is None or d is None:
                            continue
                        rng = merged_range(ws, cell)
                        c0, c1 = (rng.min_col, rng.max_col) if rng else (sub, sub)
                        r1 = rng.max_row if rng else r
                        # koniec: ostatni blok, ktorego wiersz miesci sie w scaleniu
                        last = max((b for b in blocks if b[0] <= r1), key=lambda b: b[0])
                        fill = cell.fill.fgColor.rgb if cell.fill and cell.fill.fgColor and cell.fill.fgColor.type == 'rgb' else None
                        out.append({'sheet': ws.title.strip(), 'date': d.isoformat(), 'start': start, 'end': last[2],
                                    'sub': [s - c + 1 for s in range(max(c0, c), min(c1, c + 1) + 1)],
                                    'text': ' '.join(str(cell.value).split()), 'fill': fill})
    return out


if __name__ == '__main__':
    json.dump(parse(sys.argv[1]), sys.stdout, ensure_ascii=False, indent=1)
