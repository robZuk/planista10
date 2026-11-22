"""Transkrypcje siatek WE -> JSON + kontrola sum semestrow.

Uzycie: python3 -I we_trans.py plik.txt [...]  (wypisuje kontrole; z --json OUT zapisuje dane)
Format pliku: @program KOD, @sumy SPEC sem: W.. C.. L.. P.. e.. | ..., @spec KOD|-, wiersze
"nr | przedmiot | SEM: W45! C45 e6 | SEM: ...". S liczy sie w sumach jak C (seminarium w kolumnie C).
"""
import json
import re
import sys

ROMAN = {'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8}


def parse(path):
    prog = {'file': path, 'program': None, 'version': None, 'sums': {}, 'entries': []}
    spec = None
    for raw in open(path, encoding='utf-8'):
        line = raw.split('#', 1)[0].strip() if not raw.lstrip().startswith('#') else ''
        if not line:
            continue
        if line.startswith('@program'):
            prog['program'] = line.split()[1]
        elif line.startswith('@wersja'):
            prog['version'] = line.split(None, 1)[1]
        elif line.startswith('@spec'):
            spec = line.split()[1]
            spec = None if spec == '-' else spec
        elif line.startswith('@sumy'):
            _, s, rest = line.split(None, 2)
            prog['sums'][s] = {ROMAN[k.strip()]: cells(v) for k, v in (p.split(':') for p in rest.split('|'))}
        else:
            parts = [p.strip() for p in line.split('|')]
            nr, name = parts[0], parts[1]
            sems = {}
            for p in parts[2:]:
                k, v = p.split(':')
                sems[ROMAN[k.strip()]] = cells(v)
            prog['entries'].append({'nr': nr, 'subject': name, 'spec': spec, 'sems': sems})
    return prog


def cells(text):
    out = {}
    for tok in text.split():
        m = re.fullmatch(r'([WCLPS])(\d+)(!?)', tok)
        if m:
            out[m.group(1)] = int(m.group(2))
            if m.group(3):
                out['exam'] = True
            continue
        m = re.fullmatch(r'e(\d+(?:[.,]\d+)?)', tok)
        if m:
            out['e'] = float(m.group(1).replace(',', '.'))
            continue
        raise ValueError(f'Nieznany token: {tok!r} w {text!r}')
    return out


def check(prog):
    ok = True
    for spec, sums in prog['sums'].items():
        rows = [e for e in prog['entries'] if e['spec'] is None or e['spec'] == spec]
        for sem, want in sums.items():
            got = {'W': 0, 'C': 0, 'L': 0, 'P': 0, 'e': 0.0}
            for e in rows:
                c = e['sems'].get(sem, {})
                got['W'] += c.get('W', 0)
                got['C'] += c.get('C', 0) + c.get('S', 0)
                got['L'] += c.get('L', 0)
                got['P'] += c.get('P', 0)
                got['e'] += c.get('e', 0)
            diff = {k: (got[k], want.get(k, 0)) for k in got if abs(got[k] - want.get(k, 0)) > 0.01}
            if diff:
                ok = False
                print(f"  {prog['program']} {spec} sem {sem}: rozne (mam, siatka) {diff}")
    return ok


if __name__ == '__main__':
    args = sys.argv[1:]
    out = None
    if '--json' in args:
        i = args.index('--json')
        out = args[i + 1]
        args = args[:i] + args[i + 2:]
    progs = []
    for path in args:
        p = parse(path)
        good = check(p)
        print(f"{path.split('/')[-1]}: {len(p['entries'])} pozycji, sumy {'OK' if good else 'ROZNE'}")
        progs.append(p)
    if out:
        json.dump(progs, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
