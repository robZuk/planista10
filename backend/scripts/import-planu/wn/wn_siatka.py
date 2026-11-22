"""Siatki (plany studiow) WN ze strony https://wn.umg.edu.pl/karty/siatki/<tryb>,<rok>,<kierunek> -> JSON.

Strona to tabela HTML: wiersz przedmiotu = Lp | nazwa | razem | A C L S (sumy) | dla kazdego semestru
A C L S ECTS (A = wyklad, C = cwiczenia, L = laboratorium, S = seminarium/projekt). Wiersze bez Lp to
naglowki grup przedmiotow (PRZEDMIOTY OGOLNE, specjalnosc ...). Uzycie: python wn_siatka.py plik.html
"""
import html
import json
import re
import sys
from html.parser import HTMLParser


class Rows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell, self.in_cell, self.in_table = [], None, None, False, 0
        self.title = ''

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'table':
            self.in_table += 1
        elif tag == 'tr' and self.in_table:
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = {'text': '', 'colspan': int(a.get('colspan', 1) or 1), 'rowspan': int(a.get('rowspan', 1) or 1), 'cls': a.get('class', '')}
            self.in_cell = True

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.cell['text'] = re.sub(r'\s+', ' ', html.unescape(self.cell['text'])).strip()
            self.row.append(self.cell)
            self.cell, self.in_cell = None, False
        elif tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None
        elif tag == 'table':
            self.in_table -= 1

    def handle_data(self, data):
        if self.in_cell:
            self.cell['text'] += data


def num(t):
    t = t.replace(',', '.').strip()
    try:
        return float(t)
    except ValueError:
        return None


def parse(path):
    p = Rows()
    p.feed(open(path, encoding='utf-8', errors='replace').read())
    rows = p.rows
    # liczba semestrow: naglowki SEMESTR I..
    sem_heads = [c['text'] for r in rows for c in r if c['text'].startswith('SEMESTR')]
    nsem = len(sem_heads)
    title = rows[0][0]['text'] if rows and rows[0] else ''
    entries, section = [], None
    for r in rows:
        texts = [c['text'] for c in r]
        if len(r) <= 3 and texts and texts[0] and not texts[0].isdigit():
            section = texts[0]
            continue
        if len(r) >= 7 + 5 * nsem - 1 and texts[0].isdigit():
            name = texts[1]
            vals = texts[7:7 + 5 * nsem]
            sems = {}
            for s in range(nsem):
                a, c, l, ss, e = (num(v) for v in vals[5 * s:5 * s + 5])
                cell = {k: int(v) for k, v in (('W', a), ('C', c), ('L', l), ('S', ss)) if v}
                if e:
                    cell['e'] = e
                if cell:
                    sems[s + 1] = cell
            entries.append({'nr': texts[0], 'subject': name, 'section': section, 'sems': sems})
        elif texts and texts[0] and not texts[0].isdigit() and len([t for t in texts if t]) <= 6 and not texts[0].startswith(('SEMESTR', 'LICZBA', 'SUMA')):
            section = texts[0]
    return {'file': path.split('/')[-1], 'title': title, 'nsem': nsem, 'entries': entries}


if __name__ == '__main__':
    json.dump([parse(f) for f in sys.argv[1:]], sys.stdout, ensure_ascii=False, indent=1)
