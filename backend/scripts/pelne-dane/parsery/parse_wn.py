#!/usr/bin/env python3
"""Parser stron WN karty/siatki (HTML): kolumny Lp, nazwa, SUMA, A C L S, potem per semestr A C L S ECTS.
A = wyklad (W). Wyjscie jak parse_plan.py: {tables:[{spec, semesters, rows:[{lp,name,total,sems,ok}]}]}"""
import re, html, json, sys

def cells(row):
    return [html.unescape(re.sub(r'<[^>]+>', '', c)).strip() for _, _, c in re.findall(r'<t([dh])([^>]*)>(.*?)</t[dh]>', row, flags=re.S)]

def n(v):
    return int(v) if re.fullmatch(r'\d+', v or '') else 0

def parse(path):
    s = open(path, encoding='utf-8', errors='replace').read()
    if '<table' not in s:
        return None
    head = html.unescape(re.sub(r'<[^>]+>', '\n', re.sub(r'<script.*?</script>|<style.*?</style>', '', s[:s.find('<table')], flags=re.S)))
    lines = [l.strip() for l in head.split('\n') if l.strip()]
    title = lines[-1] if lines else ''
    t = s[s.find('<table'):s.rfind('</table>')]
    rows = re.findall(r'<tr.*?</tr>', t, flags=re.S)
    nsem = len(re.findall(r'SEMESTR [IVX]+', rows[0]))
    out, group = [], None
    for r in rows:
        if 'class="grupa"' in r:
            group = cells(r)[0]
            continue
        c = cells(r)
        if len(c) != 7 + 5 * nsem or not re.fullmatch(r'\d+', c[0]):
            continue
        total = {'W': n(c[3]), 'C': n(c[4]), 'L': n(c[5]), 'P': 0, 'S': n(c[6])}
        sems = {}
        for k in range(nsem):
            b = 7 + 5 * k
            v = {'W': n(c[b]), 'C': n(c[b + 1]), 'L': n(c[b + 2]), 'P': 0, 'S': n(c[b + 3]), 'ECTS': n(c[b + 4])}
            if any(v.values()):
                sems[k + 1] = v
        total['ECTS'] = sum(v['ECTS'] for v in sems.values())
        ok = all(sum(v[kk] for v in sems.values()) == total[kk] for kk in 'WCLS') and n(c[2]) == sum(total[kk] for kk in 'WCLS')
        out.append({'lp': c[0], 'name': c[1], 'group': group, 'razem': n(c[2]), 'total': total, 'sems': sems, 'ok': ok})
    return {'title': title, 'semesters': nsem, 'tables': [{'spec': None, 'semesters': nsem, 'rows': out}]}

if __name__ == '__main__':
    res = {}
    for p in sys.argv[2:]:
        r = parse(p)
        if r:
            key = p.rsplit('/', 1)[-1].replace('.html', '')
            res[key] = r
            rows = r['tables'][0]['rows']
            bad = [x for x in rows if not x['ok']]
            hours = sum(x['razem'] for x in rows)
            print(f"{key:5} sem={r['semesters']} przedm={len(rows):3} godz={hours:5} zle={len(bad)} | {r['title'][:60]}")
            for x in bad[:3]:
                print('   !', x['name'][:50], x['razem'], x['total'])
    json.dump(res, open(sys.argv[1], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
