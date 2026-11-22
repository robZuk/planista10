"""Programy WI z siatek (wi_siatka.py JSON) -> dane/wi/programy.json + kontrola sum semestrow.

Uzycie: python wi_programy.py <katalog z json siatek> <wyjscie.json>
Czesc wspolna bierzemy z pierwszej strony (sprawdzamy, ze na kolejnych jest taka sama), przedmioty
sciezek ze swoich stron. Praktyki bez godzin (tylko ECTS). II stopien: bloki przedmiotow wybieralnych
(pary a/b) pomijamy — wybor studenta nie miesci sie w modelu specjalnosci (zgloszone w raporcie).
"""
import json
import re
import sys

SPEC = {'Inteligentne Aplikacje': 'IA', 'Programowanie Systemów Autonomicznych': 'PSA'}
FILES = [
    ('INF-WI-S1', 'siatka_informatyka_wi_umg_i_stop_st_2025-26_0.json', 7),
    ('INF-WI-N1', 'siatka_informatyka_wi_umg_i_stop_nst_2025-26_0.json', 7),
    ('INF-WI-S2', 'plan_studiow_wi_informatyka_ii_st_2025-2026.json', 3),
    ('INF-WI-N2', 'plan_studiow_wi_informatyka_ii_nst_2025-2026.json', 3),
]
FIX = {
    'Projektowanie UX': 'Projektowanie UX',
}


def clean(name):
    name = re.sub(r'^Przedmioty ogólne i kierunkowe\s*', '', name)
    # rozstrzelone litery ("T e ch niki") -> sklejone
    name = re.sub(r'\b(\w) (?=\w\b)', r'\1', name)
    name = re.sub(r'(?<=\b\w) (?=\w{1,2}\b)', '', name)
    return ' '.join(name.split())


def main():
    src, out = sys.argv[1], sys.argv[2]
    progs = []
    for code, fname, nsem in FILES:
        pages = json.load(open(f'{src}/{fname}', encoding='utf-8'))
        entries = []
        common = [e for e in pages[0]['entries'] if e['spec'] is None]
        for e in common:
            entries.append(dict(e, spec=None))
        for pg in pages:
            sp = SPEC.get(pg['spec'] or '')
            if not sp:
                continue
            for e in pg['entries']:
                if e['spec'] is not None:
                    entries.append(dict(e, spec=sp))
        res = []
        for e in entries:
            name = clean(e['subject'])
            if not name:
                continue
            sems = {}
            for k, c in e['sems'].items():
                c = dict(c)
                if name.lower().startswith('praktyka'):
                    c = {'e': c.get('e', 0)}
                sems[int(k)] = c
            res.append({'nr': e['nr'], 'subject': name, 'spec': e['spec'], 'katedra': e.get('katedra', ''), 'sems': sems})
        progs.append({'program': code, 'semesters': nsem, 'entries': res})
    # poprawki nazw z wieloliniowych komorek siatki I st.
    for p in progs:
        for e in p['entries']:
            n = e['subject']
            if n.startswith('Projektowanie UXZwinne'):
                e['subject'] = 'Projektowanie UX'
            elif n in ('nymi', 'n y m i'):
                e['subject'] = 'Zwinne metodyki zarządzania projektami informatycznymi'
            elif n.replace(' ', '').startswith('Techniki'):
                e['subject'] = 'Techniki multimedialne'
    json.dump(progs, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for p in progs:
        for sp in sorted({e['spec'] for e in p['entries'] if e['spec']} or {None}):
            sums = {}
            for e in p['entries']:
                if e['spec'] not in (None, sp):
                    continue
                for k, c in e['sems'].items():
                    s = sums.setdefault(k, {'W': 0, 'C': 0, 'L': 0, 'P': 0, 'e': 0})
                    for f in 'WCLPe':
                        s[f] += c.get(f, 0)
            print(p['program'], sp, {k: {f: int(v) for f, v in s.items()} for k, s in sorted(sums.items())})


main()
