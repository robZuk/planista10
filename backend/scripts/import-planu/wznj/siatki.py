"""Siatki godzin WZNJ (PDF tekstowe ze strony programow) -> JSON programow.

Strona PDF = jedna specjalnosc: naglowek (Kierunek, Specjalnosc, Studia: stopien tryb, Rok naboru),
tabela: Lp | Przedmiot | Katedra | Rygor | Liczba godzin | dla kazdego semestru W C L P ECTS.
Liczby przypisujemy do kolumny wg najblizszego naglowka W/C/L/P/ECTS w pasie semestru.
Rygor "E3" = egzamin w semestrze 3 (moze byc kilka: "E1,E2").

Uzycie: python siatki.py plik.pdf [...] > programy.json
"""
import json
import re
import sys

import pdfplumber

ROMAN = {'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8}
NUM = re.compile(r'^\d+(?:[.,]\d+)?$')


def words_from_chars(page):
    """Slowa z jawnych spacji w PDF (litery bywaja rozstrzelone, ale spacje sa znakami)."""
    lines = {}
    for c in page.chars:
        key = next((k for k in lines if abs(k - c['top']) < 1.2), c['top'])
        lines.setdefault(key, []).append(c)
    out = []
    for top, cs in lines.items():
        cs.sort(key=lambda c: c['x0'])
        cur = []
        for c in cs + [None]:
            if c is None or c['text'] == ' ' or (cur and c['x0'] - cur[-1]['x1'] > 6):
                if cur:
                    out.append({'text': ''.join(x['text'] for x in cur), 'x0': cur[0]['x0'], 'x1': cur[-1]['x1'], 'top': top, 'bottom': cur[0]['bottom']})
                cur = [] if c is None or c['text'] == ' ' else [c]
            else:
                cur.append(c)
    return out


def lines_of(words, tol=2.5):
    rows = []
    for w in sorted(words, key=lambda w: (w['top'], w['x0'])):
        for r in rows:
            if abs(r['top'] - w['top']) <= tol:
                r['w'].append(w)
                break
        else:
            rows.append({'top': w['top'], 'w': [w]})
    for r in rows:
        r['w'].sort(key=lambda w: w['x0'])
    return rows


def header_value(words, label):
    lab = next((w for w in words if w['text'].startswith(label)), None)
    if not lab:
        return ''
    ws = sorted([w for w in words if abs(w['top'] - lab['top']) < 2.5 and w['x0'] > lab['x1'] + 2], key=lambda w: w['x0'])
    out = []
    for w in ws:
        if out and w['x0'] - out[-1]['x1'] > 25:
            break
        out.append(w)
    return ' '.join(w['text'] for w in out)


def parse_page(page, prev=None):
    words = page.extract_words(keep_blank_chars=False, x_tolerance=1.5)
    if not any(w['text'] == 'Lp.' for w in words):
        if prev is None or 'layout' not in prev:
            return None
        # strona-kontynuacja: uklad kolumn z poprzedniej strony, wiersze od gory
        return parse_rows(page, words, prev['layout'], top=0, cont=True)
    meta = {
        'kierunek': header_value(words, 'Kierunek'),
        'spec': header_value(words, 'Specjalno'),
        'studia': header_value(words, 'Studia:'),
        'nabor': (re.search(r'\d{4}/\d{4}', ' '.join(w['text'] for w in words if w['top'] < 80)) or [''])[0],
        'zatwierdzony': ' '.join(w['text'] for w in lines_of([w for w in words if w['top'] < 80])[0]['w']) if words else '',
    }
    tline = [l for l in lines_of(words) if any(w['text'] == 'Semestr' for w in l['w'])]
    sems = []
    if tline:
        ws = tline[0]['w']
        for i, w in enumerate(ws):
            if w['text'] == 'Semestr' and i + 1 < len(ws) and ws[i + 1]['text'] in ROMAN:
                sems.append({'n': ROMAN[ws[i + 1]['text']], 'xc': (w['x0'] + ws[i + 1]['x1']) / 2})
    # wiersz naglowkow kolumn: najwiecej "W"/"ECTS"
    heads = None
    for l in lines_of(words):
        cnt = sum(1 for w in l['w'] if w['text'] in ('W', 'C', 'L', 'P', 'ECTS'))
        if cnt >= 10:
            heads = l
            break
    if not heads or not sems:
        return {'meta': meta, 'rows': [], 'problem': 'brak naglowkow'}
    cols = []
    first_w = min(w['x0'] for w in heads['w'] if w['text'] == 'W')
    for w in heads['w']:
        if w['x0'] < first_w - 2:
            continue
        if w['text'] in ('W', 'C', 'L', 'P', 'ECTS'):
            xc = (w['x0'] + w['x1']) / 2
            sem = min(sems, key=lambda s: abs(s['xc'] - xc))
            cols.append({'kind': w['text'], 'xc': xc})
    # przypisanie semestru kolumnom: kolejne piatki W C L P ECTS
    cols.sort(key=lambda c: c['xc'])
    sem_order = sorted(sems, key=lambda s: s['xc'])
    group, gi = [], 0
    for c in cols:
        if c['kind'] == 'W' and group:
            gi += 1
            group = []
        c['sem'] = sem_order[min(gi, len(sem_order) - 1)]['n']
        group.append(c)
    first_col = min(c['xc'] for c in cols) - 12
    rygor_x = next((w['x0'] for w in words if w['text'] == 'Rygor'), None)
    katedra_x = next((w['x0'] for w in words if w['text'] == 'Katedra'), None)
    layout = {'cols': cols, 'first_col': first_col, 'rygor_x': rygor_x, 'katedra_x': katedra_x}
    res = parse_rows(page, words, layout, top=heads['top'])
    res.update({'meta': meta, 'semesters': [s['n'] for s in sems]})
    return res


def parse_rows(page, words, layout, top, cont=False):
    cols, first_col, rygor_x, katedra_x = layout['cols'], layout['first_col'], layout['rygor_x'], layout['katedra_x']
    heads = {'top': top}
    rows = []
    body = [l for l in lines_of([w for w in words if w['top'] > heads['top'] + 3])]
    # koniec tabeli
    end = next((l['top'] for l in body if ' '.join(w['text'] for w in l['w']).startswith(('Liczba godzin w semestrze', 'Liczba egzamin', 'Liczba punkt', 'Łączna', 'Objaśnienia', 'Razem', 'Suma', 'RAZEM'))), 1e9)
    totals = {}
    tl = next((l for l in body if ' '.join(w['text'] for w in l['w']).startswith('Liczba godzin w semestrze')), None)
    if tl:
        for w in tl['w']:
            if w['x0'] < first_col or not NUM.match(w['text']):
                continue
            xc = (w['x0'] + w['x1']) / 2
            c = min(cols, key=lambda c: abs(c['xc'] - xc))
            if abs(c['xc'] - xc) <= 14:
                totals.setdefault(str(c['sem']), {})[{'ECTS': 'e'}.get(c['kind'], c['kind'])] = float(w['text'].replace(',', '.'))
    body = [l for l in body if l['top'] < end - 1]
    name_words = words_from_chars(page)
    def is_row(l):
        if re.fullmatch(r'\d{1,2}', l['w'][0]['text']) and l['w'][0]['x0'] < 60:
            return True
        # wiersz bez numeru Lp (zdarza sie w PDF), ale z katedra i liczbami w kolumnach
        has_kat = katedra_x and any(katedra_x - 5 <= w['x0'] < katedra_x + 30 and re.fullmatch(r'[A-ZŁŚ][A-Za-złśćęąóżź]{1,8}', w['text']) for w in l['w'])
        has_num = any(w['x0'] >= first_col and NUM.match(w['text']) for w in l['w'])
        return bool(has_kat and has_num)
    lp_lines = [l for l in body if is_row(l)]
    sect_lines = [(l['top'], ' '.join(w['text'] for w in l['w'])) for l in body if ' '.join(w['text'] for w in l['w']).startswith('Przedmioty') and not re.search(r'wybieraln|do wyboru', ' '.join(w['text'] for w in l['w'])) and len(l['w']) < 12 and not re.fullmatch(r'\d{1,2}', l['w'][0]['text'])]
    name_x1 = (katedra_x or first_col) - 2
    # linie nazw (kolumna przedmiotu) przypisane do wierszy: wlasna linia wiersza, a gdy pusta —
    # linie nad i pod nim (nazwa zawinieta, wysrodkowana pionowo), kazda linia do jednego wiersza
    name_x0 = 40
    nlines = {}
    for w in name_words:
        if name_x0 < w['x0'] and w['x1'] < name_x1 and heads['top'] + 3 < w['top'] < end - 1 and not any(abs(w['top'] - t) < 2 for t, _ in sect_lines):
            if re.fullmatch(r'\d{1,2}', w['text']) and w['x0'] < 60:
                continue
            key = next((k for k in nlines if abs(k - w['top']) < 1.0), w['top'])
            nlines.setdefault(key, []).append(w)
    lp_tops = [l['top'] for l in lp_lines]
    ys_ = sorted(e['top'] for e in page.edges if e['orientation'] == 'h' and e['x0'] < name_x0 + 30 < e['x1'])
    hrules = []
    for y in ys_:
        if not hrules or y - hrules[-1] > 1.5:
            hrules.append(y)
    own = {}
    orphan = []
    for t, ws_ in nlines.items():
        hit = next((lt for lt in lp_tops if abs(lt - t) < 1.2), None)
        if hit is not None:
            own.setdefault(hit, []).append((t, ws_))
        else:
            orphan.append((t, ws_))
    extra = {lt: [] for lt in lp_tops}
    for t, ws_ in sorted(orphan):
        above = max([lt for lt in lp_tops if lt < t], default=None)
        below = min([lt for lt in lp_tops if lt > t], default=None)
        cands = [lt for lt in (above, below) if lt is not None]
        empty = [lt for lt in cands if lt not in own]
        pick = min(empty or cands, key=lambda lt: abs(lt - t)) if cands else None
        if pick is not None:
            extra[pick].append((t, ws_))

    def join_spaced(txt):
        toks_ = txt.split(' ')
        out_, run = [], []
        for tk in toks_ + ['\0']:
            if len(tk) <= 2 and tk != '\0' and not (tk.lower() in ('i', 'w', 'z', 'na', 'do', 'o', 'a', 'od', 'we', 'ze') and not run):
                run.append(tk)
                continue
            if len(run) >= 3:
                out_.append(''.join(run))
            else:
                out_.extend(run)
            run = []
            if tk != '\0':
                out_.append(tk)
        res_ = ' '.join(out_)
        # sklejenie "Z a r zą d z a n i e" -> po zlaczeniu bywa "Zarządzanie" + reszta slowa w nastepnym tokenie
        return re.sub(r'\b([A-ZŁŚŻŹĆa-ząćęłńóśźż]{1,3}) (?=[a-ząćęłńóśźż]{2,}\b)', lambda m: m.group(1) if len(m.group(1)) <= 2 and m.group(1) not in ('i', 'w', 'z', 'na', 'do', 'o', 'a', 'od', 'we', 'ze') else m.group(0), res_)

    for l in lp_lines:
        ws = l['w']
        if re.fullmatch(r'\d{1,2}', ws[0]['text']) and ws[0]['x0'] < 60:
            lp = ws[0]
        else:
            lp = {'text': str(int(rows[-1]['nr']) + 1 if rows else 1), 'x1': 40, 'x0': 30}
        # pas wiersza z poziomych linii tabeli (pewne); bez linii — dotychczasowe przypisanie
        mid = (lp['top'] + lp['bottom']) / 2 if 'top' in lp else l['top'] + 2.5
        above_h = max([y for y in hrules if y <= mid], default=None)
        below_h = min([y for y in hrules if y > mid], default=None)
        if above_h is not None and below_h is not None and below_h - above_h < 40:
            parts = sorted([(t_, ws_) for t_, ws_ in nlines.items() if above_h - 0.5 < t_ + 1.5 < below_h + 0.5], key=lambda x: x[0])
        else:
            parts = sorted(own.get(l['top'], []) + extra.get(l['top'], []), key=lambda x: x[0])
        chunks = []
        for t_, ws_ in parts:
            ws_ = sorted(ws_, key=lambda w: w['x0'])
            k = next((i for i, w in enumerate(ws_) if re.match(r'^' + re.escape(lp['text']) + r'(?=\D|$)', w['text'])), None)
            if k and abs(t_ - l['top']) < 1.2 and rows:
                # slowa przed numerem Lp to dokonczenie nazwy wiersza wyzej
                rows[-1]['subject'] = (rows[-1]['subject'] + ' ' + ' '.join(w['text'] for w in ws_[:k])).strip()
                ws_ = ws_[k:]
            chunks.append(' '.join(w['text'] for w in ws_))
        name = ' '.join(chunks)
        name = re.sub(r'\s+', ' ', name).strip()
        name = re.sub(r'^\d{1,2}(?=\S)', '', name).strip()
        name = re.sub(r'\s*\bRAZEM\b.*$', '', name)
        if cont and rows == [] and layout.get('last_nr') and int(lp['text']) != layout['last_nr'] + 1:
            continue
        if cont and rows and int(lp['text']) != int(rows[-1]['nr']) + 1:
            continue
        sec = layout.get('last_section', 'common')
        for t, txt in sect_lines:
            if t < l['top']:
                sec = 'spec' if 'specjalno' in txt else 'common'
        kat = ' '.join(w['text'] for w in ws if katedra_x and katedra_x - 5 <= w['x0'] < (rygor_x or katedra_x + 40) - 2)
        ryg = ' '.join(w['text'] for w in ws if rygor_x and rygor_x - 5 <= w['x0'] < rygor_x + 25)
        cells = {}
        for w in ws:
            if w['x0'] < first_col or not NUM.match(w['text']):
                continue
            xc = (w['x0'] + w['x1']) / 2
            c = min(cols, key=lambda c: abs(c['xc'] - xc))
            if abs(c['xc'] - xc) > 14:
                continue
            cells.setdefault(str(c['sem']), {})[{'ECTS': 'e'}.get(c['kind'], c['kind'])] = float(w['text'].replace(',', '.'))
        for sm in [int(x) for x in re.findall(r'E(\d)', ryg)]:
            cells.setdefault(str(sm), {})['exam'] = True
        layout['last_section'] = sec
        layout['last_nr'] = int(lp['text'])
        rows.append({'nr': lp['text'], 'subject': name, 'katedra': kat, 'rygor': ryg, 'section': sec, 'sems': cells})
    return {'rows': rows, 'layout': layout, 'cont': cont, 'totals': totals}


def main():
    out = []
    for path in sys.argv[1:]:
        pdf = pdfplumber.open(path)
        prev = None
        for i, page in enumerate(pdf.pages, start=1):
            p = parse_page(page, prev)
            if not p:
                continue
            if p.get('cont'):
                if p['rows']:
                    prev['rows'].extend(p['rows'])
                if p.get('totals') and not prev.get('totals'):
                    prev['totals'] = p['totals']
                    prev['pages'].append(i)
                continue
            p['file'] = path.split('/')[-1]
            p['page'] = i
            p['pages'] = [i]
            out.append(p)
            prev = p
    for p in out:
        rows = p['rows']
        for i, r in enumerate(rows):
            m = re.match(r'^(.*?)\s*' + re.escape(r['nr']) + r'(?=[A-ZŁŚŻĆ])(.*)$', r['subject'])
            if m and i > 0:
                rows[i - 1]['subject'] = (rows[i - 1]['subject'] + ' ' + m.group(1)).strip()
                r['subject'] = m.group(2).strip()
        p.pop('layout', None)
        p.pop('cont', None)
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)


main()
