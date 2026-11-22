"""Siatki godzin WI (PDF z tekstem) -> JSON programu: [{nr, subject, spec, rygor, katedra, sems:{n:{W,C,L,P,e,exam}}}].

Uzycie: python wi_siatka.py plik.pdf > wyjscie.json
Strona = jedna sciezka (IA, PSA ...): czesc wspolna + przedmioty wybieralne sciezki. Kolumny semestrow
(W C L P ECTS) z naglowka; liczby w wierszu przypisane do najblizszej kolumny.
"""
import json
import re
import sys

import pdfplumber

ROMAN = {'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8}


def num(t):
    t = t.replace(',', '.')
    try:
        return float(t)
    except ValueError:
        return None


def parse_page(page):
    words = page.extract_words(x_tolerance=1.5)
    # naglowek kolumn: wiersz z najwieksza liczba liter W/C/L/P
    rows = {}
    for w in words:
        if w['text'] in ('W', 'C', 'L', 'P'):
            rows.setdefault(round(w['top']), []).append(w)
    hy = max(rows, key=lambda k: len(rows[k]))
    hdr = sorted(rows[hy], key=lambda w: w['x0'])
    quads = [hdr[i:i + 4] for i in range(0, len(hdr) - 3, 4)]
    quads = [q for q in quads if [w['text'] for w in q] == ['W', 'C', 'L', 'P']]
    totals, sems = quads[0], quads[1:]
    cols = []  # (x, sem, kind)
    for k, q in enumerate(sems, start=1):
        for w in q:
            cols.append(((w['x0'] + w['x1']) / 2, k, w['text']))
        step = q[3]['x0'] - q[2]['x0']
        cols.append((q[3]['x1'] + step * 0.9, k, 'e'))
    first_sem_x = sems[0][0]['x0'] - 4
    rygor_w = next(w for w in words if w['text'] == 'Rygor')
    kat_w = {'x0': rygor_w['x0'] - 24}
    lp_w = next(w for w in words if w['text'] in ('Lp.', 'Kod'))
    name_x0 = lp_w['x1'] + 2
    # linie tekstu ponizej naglowka
    lines = {}
    for w in words:
        if w['top'] > hy + 4:
            lines.setdefault(round(w['top'] * 2) / 2, []).append(w)
    keys = sorted(lines)
    merged = []
    for k in keys:
        if merged and k - merged[-1][0] < 1.6:
            merged[-1][1].extend(lines[k])
        else:
            merged.append([k, list(lines[k])])
    entries, spec, section = [], None, 'common'
    pending_name = []
    for y, ws in merged:
        ws.sort(key=lambda w: w['x0'])
        txt = ' '.join(w['text'] for w in ws)
        if txt.startswith('RAZEM') or txt.startswith('Liczba godzin w semestrze'):
            break
        if 'Przedmioty wybieralne' in txt:
            section = 'path'
            continue
        lp = ws[0]['text'] if re.fullmatch(r'\d{1,2}', ws[0]['text']) and ws[0]['x0'] < name_x0 else None
        if lp is None:
            name_part = [w['text'] for w in ws if name_x0 <= w['x0'] < kat_w['x0'] - 5]
            if section == 'path' and spec is None or (section == 'path' and not entries_since_spec(entries, spec) and not any(num(w['text']) for w in ws)):
                if txt and not txt.startswith('Przedmioty') and num(ws[-1]['text']) is not None:
                    spec = ' '.join(w['text'] for w in ws if num(w['text']) is None)
                    continue
            if name_part and entries and abs(y - entries[-1]['_y']) < 8:
                entries[-1]['subject'] = (entries[-1]['subject'] + name_part_join(name_part)).strip()
            else:
                pending_name = name_part
            continue
        name = ' '.join(w['text'] for w in ws if name_x0 <= w['x0'] < kat_w['x0'] - 5 and w is not ws[0])
        if pending_name:
            name = ' '.join(pending_name) + ' ' + name
            pending_name = []
        kat = ' '.join(w['text'] for w in ws if kat_w['x0'] - 5 <= w['x0'] < rygor_w['x0'] - 3)
        ryg = ' '.join(w['text'] for w in ws if rygor_w['x0'] - 3 <= w['x0'] < totals[0]['x0'] - 3)
        sems_d = {}
        for w in ws:
            if w['x0'] < first_sem_x:
                continue
            v = num(w['text'])
            if v is None:
                continue
            xc = (w['x0'] + w['x1']) / 2
            x, k, kind = min(cols, key=lambda c: abs(c[0] - xc))
            sems_d.setdefault(k, {})[kind] = v
        m = re.match(r'E(\d)', ryg)
        if m and int(m.group(1)) in sems_d:
            sems_d[int(m.group(1))]['exam'] = True
        entries.append({'nr': lp, 'subject': name.strip(), 'spec': spec if section == 'path' else None, 'katedra': kat, 'rygor': ryg, 'sems': sems_d, '_y': y})
    for e in entries:
        e.pop('_y')
    return {'spec': spec, 'entries': entries, 'nsem': len(sems)}


def entries_since_spec(entries, spec):
    return [e for e in entries if e['spec'] == spec and spec is not None]


def name_part_join(parts):
    s = ' '.join(parts)
    return s if s.startswith(('-', 'nymi')) is False else s


if __name__ == '__main__':
    pdf = pdfplumber.open(sys.argv[1])
    out = [parse_page(p) for p in pdf.pages]
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
