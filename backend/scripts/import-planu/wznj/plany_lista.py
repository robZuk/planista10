"""Plany niestacjonarne WZNJ (arkusze-listy: DATA | DZIEN | od | - | do | PRZEDMIOT | GRUPA | PROWADZACY | SALA | GODZ.)
-> JSON wpisow. Kazdy arkusz (poza UWAGI / Godziny_zajec) to jeden plan (rok / specjalnosc).

Uzycie: python plany_lista.py plik.xlsx [...] > lista.json
"""
import datetime as dt
import json
import re
import sys

import openpyxl


def norm(v):
    if v is None:
        return ''
    if isinstance(v, (dt.datetime, dt.date, dt.time)):
        return v
    return re.sub(r'\s+', ' ', str(v)).strip()


def hhmm(v):
    if isinstance(v, dt.time):
        return f'{v.hour:02d}:{v.minute:02d}'
    if isinstance(v, dt.datetime):
        return f'{v.hour:02d}:{v.minute:02d}'
    m = re.match(r'(\d{1,2})[:.](\d\d)', str(v or ''))
    return f'{int(m.group(1)):02d}:{m.group(2)}' if m else None


def parse(path):
    wb = openpyxl.load_workbook(path, data_only=False)
    out = []
    for ws in wb.worksheets:
        if ws.title.strip() in ('UWAGI', 'Godziny_zajęć') or ws.max_row < 8:
            continue
        rows = [[norm(c) for c in r] for r in ws.iter_rows(values_only=True)]
        head_i = next((i for i, r in enumerate(rows[:15]) if any(isinstance(x, str) and x.startswith('PRZEDMIOT') for x in r)), None)
        if head_i is None:
            continue
        head = rows[head_i]
        col = {}
        for j, x in enumerate(head):
            if not isinstance(x, str):
                continue
            for key in ('DATA', 'GODZINY', 'PRZEDMIOT', 'GRUPA', 'PROWADZ', 'SALA', 'LICZBA'):
                if x.upper().startswith(key) and key not in col:
                    col[key] = j
        meta = {}
        for r in rows[:head_i]:
            txt = ' | '.join(str(x) for x in r if x not in ('', None))
            meta.setdefault('lines', []).append(txt)
        items = []
        for i, r in enumerate(rows[head_i + 1:], start=head_i + 2):
            d = r[col['DATA']] if col.get('DATA') is not None and col['DATA'] < len(r) else None
            if not isinstance(d, (dt.datetime, dt.date)):
                continue
            g = col.get('GODZINY', 2)
            start = hhmm(r[g]) if g < len(r) else None
            end = hhmm(r[g + 2]) if g + 2 < len(r) else None
            subj = r[col['PRZEDMIOT']] if col['PRZEDMIOT'] < len(r) else ''
            if not subj or not start:
                if subj:
                    items.append({'row': i, 'date': d.strftime('%Y-%m-%d'), 'note': str(subj), 'start': start})
                continue
            get = lambda k: str(r[col[k]]) if k in col and col[k] < len(r) and r[col[k]] not in (None, '') else ''
            items.append({'row': i, 'date': d.strftime('%Y-%m-%d'), 'start': start, 'end': end, 'subject': str(subj),
                          'group': get('GRUPA'), 'teacher': get('PROWADZ'), 'room': get('SALA'), 'hours': get('LICZBA'),
                          'extra': [str(x) for x in r[col.get('LICZBA', 9) + 1:] if x not in ('', None)]})
        out.append({'file': path.split('/')[-1], 'sheet': ws.title, 'meta': meta.get('lines', []), 'items': items})
    return out


if __name__ == '__main__':
    res = []
    for p in sys.argv[1:]:
        res.extend(parse(p))
    json.dump(res, sys.stdout, ensure_ascii=False, indent=1, default=str)
