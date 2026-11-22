"""Lista plikow folderu Google Drive (z HTML strony folderu): nazwa, typ, id. Uzycie: drive_list.py plik.html"""
import html, re, sys
s = open(sys.argv[1], encoding='utf-8', errors='replace').read()
t = re.search(r'<title>(.*?)</title>', s)
print('==', html.unescape(t.group(1)) if t else None)
seen = []
for m in re.finditer(r'data-tooltip="([^"]+?) (PDF|Folder|Shared folder|Microsoft Excel|Excel|Word|Google [A-Za-z]+|Microsoft Word|Plik[^"]*)"', s):
    name = html.unescape(m.group(1))
    ctx = s[max(0, m.start() - 600):m.start()]
    ids = [i for i in re.findall(r'(1[A-Za-z0-9_-]{25,40})', ctx) if not i.endswith('-0-16')]
    e = (name, m.group(2), ids[-1] if ids else None)
    if e not in seen:
        seen.append(e)
for e in seen:
    print('\t'.join(str(x) for x in e))
