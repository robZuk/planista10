"""Programy WN z siatek wn.umg.edu.pl/karty/siatki -> dane/wn/programy.json.

Kazda wersja programu = jedna albo kilka siatek (specjalnosci). Pozycje identyczne we wszystkich
siatkach wersji (przedmiot, semestr, godziny) sa wspolne, reszta — specjalnosciowa.
Godziny: A -> W (wyklad), C -> C, L -> L, S (symulator) -> L; seminaria dyplomowe -> S.
Uzycie: python wn_programy.py <katalog z g_*.html> <wyjscie.json>
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from wn_siatka import parse  # noqa: E402

# program, wersja, liczba semestrow, start, siatki {kod specjalnosci (None = bez): plik}, roczniki (rok, typ)
VERSIONS = [
    ('NAW-S1', 'od naboru 2023/24', 8, 'WINTER', {None: 's,2023,1'}, [(2023, 'W'), (2024, 'W')]),
    ('NAW-S1', 'od naboru 2025/26', 8, 'WINTER', {None: 's,2025,1'}, [(2025, 'W'), (2026, 'W')]),
    ('NAW-N1', 'od naboru 2023/24', 8, 'WINTER', {None: 'ns,2023,1'}, [(2023, 'W'), (2024, 'W')]),
    ('NAW-N1', 'od naboru 2025/26', 8, 'WINTER', {None: 'ns,2025,1'}, [(2025, 'W'), (2026, 'W')]),
    ('TR-S1', 'od naboru 2023/24', 7, 'WINTER', {'TiL': 's,2023,2', 'EST': 's,2023,4'}, [(2023, 'W')]),
    ('TR-S1', 'od naboru 2024/25', 7, 'WINTER', {'TiL': 's,2024,2', 'EST': 's,2024,4'}, [(2024, 'W'), (2025, 'W'), (2026, 'W')]),
    ('TR-N1', 'od naboru 2023/24', 7, 'WINTER', {'TiL': 'ns,2023,2', 'EST': 'ns,2023,4'}, [(2023, 'W')]),
    ('TR-N1', 'od naboru 2024/25', 7, 'WINTER', {'TiL': 'ns,2024,2', 'EST': 'ns,2024,4'}, [(2024, 'W'), (2025, 'W'), (2026, 'W')]),
    ('NAW-S2', 'od naboru 2024/25', 3, 'WINTER',
     {'TO': 's,8', 'EZ': 's,12', 'MSI': 's,13', 'ZBTM': 's,14', 'APSE': 's,15', 'PHiON': 's,16', 'ŻA': 's,17'},
     [(2025, 'S'), (2025, 'W'), (2026, 'W')]),
    ('NAW-N2', 'od naboru 2024/25', 3, 'WINTER', {'TO': 'ns,8', 'ZBTM': 'ns,14'}, [(2025, 'S'), (2025, 'W'), (2026, 'W')]),
    ('TR-S2', 'od naboru 2024/25', 3, 'WINTER', {'MSTiL': 's,3', 'LSO': 's,9', 'ESTiL': 's,10', 'ZIiŚTŚ': 's,11'},
     [(2025, 'S'), (2025, 'W'), (2026, 'W')]),
    ('TR-N2', 'od naboru 2024/25', 3, 'WINTER', {'MSTiL': 'ns,3', 'LSO': 'ns,9', 'ESTiL': 'ns,10', 'ZIiŚTŚ': 'ns,11'},
     [(2025, 'S'), (2025, 'W'), (2026, 'W')]),
]


def norm_name(n):
    n = ' '.join(n.split())
    return n[0].upper() + n[1:] if n else n


def cells(subject, sems):
    out = {}
    for k, c in sems.items():
        sem = int(k)
        w, cc, l, s = c.get('W', 0), c.get('C', 0), c.get('L', 0), c.get('S', 0)
        if subject.lower().startswith('seminarium'):
            h = {'S': w + cc + l + s}
        else:
            h = {'W': w, 'C': cc, 'L': l + s}
        h = {k2: v for k2, v in h.items() if v}
        if c.get('e'):
            h['e'] = c['e']
        if h:
            out[sem] = h
    return out


def main():
    src, out = sys.argv[1], sys.argv[2]
    result = []
    for prog, label, nsem, start, grids, cohorts in VERSIONS:
        parsed = {}
        for spec, f in grids.items():
            d = parse(os.path.join(src, f'g_{f}.html'))
            parsed[spec] = [{'subject': norm_name(e['subject']), 'sems': cells(e['subject'], e['sems'])} for e in d['entries'] if e['sems']]
        specs = list(parsed)
        entries = []
        if specs == [None]:
            for e in parsed[None]:
                for sem, c in e['sems'].items():
                    entries.append({'subject': e['subject'], 'spec': None, 'sem': sem, 'cell': c})
        else:
            # wspolne: (przedmiot, semestr, godziny) we wszystkich siatkach
            def keyset(es):
                return {(e['subject'], sem, json.dumps(c, sort_keys=True)) for e in es for sem, c in e['sems'].items()}
            common = set.intersection(*(keyset(parsed[s]) for s in specs))
            for subj, sem, c in sorted(common):
                entries.append({'subject': subj, 'spec': None, 'sem': sem, 'cell': json.loads(c)})
            for s in specs:
                for e in parsed[s]:
                    for sem, c in e['sems'].items():
                        if (e['subject'], sem, json.dumps(c, sort_keys=True)) not in common:
                            entries.append({'subject': e['subject'], 'spec': s, 'sem': sem, 'cell': c})
        bad = [e for e in entries if e['sem'] > nsem]
        if bad:
            raise SystemExit(f'{prog} {label}: semestr poza programem {bad[:3]}')
        result.append({'program': prog, 'label': label, 'semesters': nsem, 'start': start, 'specs': [s for s in specs if s],
                       'cohorts': cohorts, 'entries': entries})
        print(prog, label, 'pozycji', len(entries), 'wspolnych', sum(1 for e in entries if not e['spec']), 'spec', specs)
    json.dump(result, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


main()
