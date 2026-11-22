"""Karty przedmiotow WE (zal. do p. 3, KRK sylabus) -> JSON: nr, przedmiot, specjalnosc, godziny w semestrach.

Uzycie: python3 -I we_karty.py <plik.pdf> <wyjscie.json>
Czyta pdftotext -bbox (wspolrzedne slow). Kolumny godzin w semestrze (W C L P S) bierze z naglowka
po prawej stronie tabeli ("Liczba godzin w semestrze"); ECTS — z kolumny pod "ECTS".
"""
import html
import json
import re
import subprocess
import sys

ROMAN = {'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8}
FORMS = ('W', 'C', 'L', 'P', 'S')


def pages(pdf):
    out = subprocess.run(['pdftotext', '-bbox', pdf, '-'], capture_output=True, text=True, check=False).stdout
    for page in re.findall(r'<page[^>]*>(.*?)</page>', out, re.S):
        words = []
        for m in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', page):
            x0, y0, x1, y1 = map(float, m.groups()[:4])
            words.append({'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1, 'xc': (x0 + x1) / 2, 'yc': (y0 + y1) / 2, 't': html.unescape(m.group(5))})
        yield words


def line_text(words, y, right_of, tol=3.5):
    ws = sorted((w for w in words if abs(w['yc'] - y) < tol and w['x0'] > right_of), key=lambda w: w['x0'])
    return ' '.join(w['t'] for w in ws)


def num(t):
    t = t.replace(',', '.')
    try:
        v = float(t)
    except ValueError:
        return None
    return v


def parse_card(words):
    przed = next((w for w in words if w['t'] == 'Przedmiot:'), None)
    if not przed:
        return None
    nr_w = next((w for w in words if w['t'] == 'Nr'), None)
    nr = None
    if nr_w:
        cand = [w for w in words if abs(w['yc'] - nr_w['yc']) < 4 and nr_w['x1'] < w['x0'] < przed['x0'] and re.fullmatch(r'\d+[a-z]?', w['t'])]
        nr = cand[0]['t'] if cand else None
    label = lambda t: next((w for w in words if w['t'] == t and w['x0'] < 100), None)
    kier = label('Kierunek:')
    # Nazwa: linia "Przedmiot:" i ewentualne kolejne linie az do "Kierunek:".
    name_x = przed['x1'] + 2
    stop_y = kier['yc'] if kier else przed['yc'] + 12
    name_words = sorted((w for w in words if w['x0'] > name_x and przed['yc'] - 4 < w['yc'] < stop_y - 4), key=lambda w: (round(w['yc']), w['x0']))
    name = ' '.join(w['t'] for w in name_words)
    value_x = (kier['x1'] + 2) if kier else name_x
    kierunek = line_text(words, kier['yc'], value_x) if kier else ''
    forma_w = label('Forma')
    forma = line_text(words, forma_w['yc'], 150) if forma_w else ''
    spec_w = next((w for w in words if w['t'].startswith('Specjalno') and w['x0'] < 100), None)
    spec = line_text(words, spec_w['yc'], spec_w['x1'] + 2) if spec_w else ''

    sem_label = next((w for w in words if w['t'] == 'Semestr' and w['x0'] < 140), None)
    razem = next((w for w in words if w['t'] == 'Razem'), None)
    if not sem_label:
        return {'nr': nr, 'subject': name, 'kierunek': kierunek, 'forma': forma, 'spec': spec, 'rows': [], 'problem': 'brak tabeli'}
    ects_w = next((w for w in words if w['t'] == 'ECTS' and abs(w['yc'] - sem_label['yc']) < 6), None)
    # Naglowki kolumn: litery W C L P S ponizej linii "Liczba godzin".
    heads = [w for w in words if w['t'] in FORMS and sem_label['yc'] - 2 < w['yc'] < sem_label['yc'] + 18]
    # Granica grup: druga "Liczba" (naglowek "Liczba godzin w semestrze") w linii naglowka.
    liczby = sorted((w for w in words if w['t'] == 'Liczba' and abs(w['yc'] - sem_label['yc']) < 12), key=lambda w: w['x0'])
    split_x = (liczby[1]['x0'] - 20) if len(liczby) > 1 else 380
    sem_heads = [w for w in heads if w['xc'] > split_x]
    week_heads = [w for w in heads if w['xc'] <= split_x]
    head_y = max((w['yc'] for w in heads), default=sem_label['yc'] + 6)
    bottom = razem['yc'] - 3 if razem else head_y + 120
    rows = []
    for rw in sorted((w for w in words if w['t'] in ROMAN and w['x0'] < 140 and head_y + 4 < w['yc'] < bottom), key=lambda w: w['yc']):
        cells = [w for w in words if abs(w['yc'] - rw['yc']) < 4 and w['x0'] > rw['x1'] + 5 and num(w['t']) is not None]
        row = {'sem': ROMAN[rw['t']], 'ects': None}
        for c in cells:
            if ects_w and abs(c['xc'] - ects_w['xc']) < 14 and c['xc'] < (min((h['xc'] for h in week_heads), default=split_x) - 8):
                row['ects'] = num(c['t'])
                continue
            if c['xc'] > split_x - 10 and sem_heads:
                h = min(sem_heads, key=lambda h: abs(h['xc'] - c['xc']))
                row[h['t']] = row.get(h['t'], 0) + num(c['t'])
            elif week_heads:
                h = min(week_heads, key=lambda h: abs(h['xc'] - c['xc']))
                row['w' + h['t']] = num(c['t'])
        rows.append(row)
    return {'nr': nr, 'subject': name, 'kierunek': kierunek, 'forma': forma, 'spec': spec, 'rows': rows}


def main():
    pdf, out = sys.argv[1], sys.argv[2]
    cards = []
    for i, words in enumerate(pages(pdf), start=1):
        card = parse_card(words)
        if card:
            card['page'] = i
            cards.append(card)
    json.dump(cards, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(pdf.split('/')[-1], 'kart', len(cards), 'bez wierszy', sum(1 for c in cards if not c['rows']))


main()
