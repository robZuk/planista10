"""Plany stacjonarne WN z arktur.umg.edu.pl/planyzaj/strpza6.php (HTML) -> JSON wpisow.

Tabela: kolumny = grupy (naglowki GR.01 .. albo A1), komorki zajec maja id td_<dzien>_<slot>_<kolumna>
(dzien 1 = poniedzialek, slot = 5 minut od 7:00), rowspan = liczba slotow, colspan = liczba grup.
Tekst komorki: "Przedmiot <sala> <godz> (uwaga) [od:data] [il.tyg:N] {prow: Nazwisko Imie}", kilka wpisow
rozdzielonych <br/>. Forma zajec z wersji PDF tego samego planu ((Wykł)/(Ćw)/(Lab)/...).
Uzycie: python wn_arktur.py plan.html [...] > wyjscie.json
"""
import html
import json
import re
import sys

DAYS = {1: 'MONDAY', 2: 'TUESDAY', 3: 'WEDNESDAY', 4: 'THURSDAY', 5: 'FRIDAY', 6: 'SATURDAY'}


def clean(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()


def parse_entry(raw):
    """Jeden wpis komorki (fragment HTML miedzy <br/>)."""
    e = {'raw': clean(raw)}
    m = re.search(r'\{prow:\s*([^}]*)\}', e['raw'])
    e['person'] = m.group(1).strip() if m else None
    rooms = re.findall(r'<font color="darkblue">([^<{]*)</font>', raw)
    e['room'] = rooms[0].strip() if rooms and not rooms[0].strip().startswith('{') else None
    t = re.search(r'<font color="green">([^<]*)</font>', raw)
    e['time'] = t.group(1).strip() if t else None
    od = re.search(r'\[od:(\d{4}-\d\d-\d\d)\]', e['raw'])
    e['from'] = od.group(1) if od else None
    tyg = re.search(r'\[il\.tyg:(\d+)\]', e['raw'])
    e['weeks'] = int(tyg.group(1)) if tyg else None
    notes = re.findall(r'\(([^()]*)\)', re.sub(r'<font.*?</font>', '', raw))
    e['notes'] = [clean(n) for n in notes]
    # przedmiot: tekst przed pierwszym <font
    e['subject'] = clean(raw.split('<font')[0])
    return e


def parse(path):
    s = open(path, encoding='utf-8', errors='replace').read()
    title = clean(re.search(r'<font color="blue"><B>(.*?)</B>', s, re.S).group(1))
    heads = [clean(h) for h in re.findall(r'<TD class="komopcji" ALIGN="center" width="120px"> <DIV class="tekst1">(.*?)</DIV>', s)]
    cells = []
    for m in re.finditer(r'<TD class="(komopcji[^"]*)" id="td_(\d+)_(\d+)_(\d+)"([^>]*)>(.*?)</TD>', s, re.S):
        cls, day, slot, col, attrs, body = m.groups()
        rs = re.search(r'rowspan=(\d+)', attrs)
        cs = re.search(r'colspan=(\d+)', attrs)
        rowspan = int(rs.group(1)) if rs else 1
        colspan = int(cs.group(1)) if cs else 1
        inner = re.search(r'<DIV class="tekst_xs">(.*)</DIV>', body, re.S)
        inner = inner.group(1) if inner else body
        parts = re.split(r'<br\s*/?>', inner)
        start = 7 * 60 + int(slot) * 5
        # wpis bywa rozbity <br/> (np. [od:...] w nowej linii) — czesc bez przedmiotu dokleja sie do poprzedniej
        merged = []
        for p in parts:
            if not clean(p):
                continue
            if merged and not clean(p.split('<font')[0]):
                merged[-1] += ' ' + p
            else:
                merged.append(p)
        cells.append({'day': DAYS[int(day)], 'start': start, 'end': start + rowspan * 5, 'c0': int(col), 'c1': int(col) + colspan - 1,
                      'cls': cls, 'entries': [parse_entry(p) for p in merged]})
    return {'file': path.split('/')[-1], 'title': title, 'columns': heads, 'cells': cells}


if __name__ == '__main__':
    json.dump([parse(p) for p in sys.argv[1:]], sys.stdout, ensure_ascii=False, indent=1)
