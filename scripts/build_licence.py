#!/usr/bin/env python3
"""Vygeneruje licence.html: seznam přímých závislostí aplikace a jejich licencí.

  python3 scripts/build_licence.py ../chlupaci/app

Čte `dependencies` z package.json aplikace a pole `license` z node_modules/<balíček>/package.json (jen název a licence, žádné plné texty).
Kostru (hlavička, patička, styl) bere z podpora.html, obsah hlavní části je tady. Vývojové nástroje (devDependencies) se do aplikace nezabalí, proto tu nejsou.
"""
import html, json, pathlib, re, sys

app = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "../chlupaci/app").resolve()
web = pathlib.Path(__file__).resolve().parent.parent
deps = json.loads((app / "package.json").read_text())["dependencies"]
rows = []
for name in sorted(deps):
    lic = json.loads((app / "node_modules" / name / "package.json").read_text()).get("license")
    if not lic:
        sys.exit(f"{name}: v node_modules chybí pole license")
    rows.append((name, lic if isinstance(lic, str) else lic.get("type", "")))

page = (web / "podpora.html").read_text()
head, rest = page.split('<main', 1)
tail = rest.split('</main>', 1)[1]
head = (head.replace("Podpora – Moji chlupáči", "Licence open source – Moji chlupáči").replace("podpora.html", "licence.html")
        .replace(' aria-current="page"', ""))
head = re.sub(r'(<meta (?:name|property)="(?:og:)?description" content=")[^"]*', r"\1Aplikace Moji chlupáči používá knihovny s otevřeným kódem. Seznam přímých závislostí a jejich licencí.", head)
head = head.replace('<a href="licence.html">Podpora</a>', '<a href="podpora.html">Podpora</a>')
items = "\n".join(f'        <div class="faq-item"><h3>{html.escape(n)}</h3><p>{html.escape(l)}</p></div>' for n, l in rows)
main = f'''<main id="hlavni" class="wrap support" tabindex="-1">
  <div class="support-col">
    <div class="support-intro">
      <h1>Licence open source</h1>
      <p>Aplikace Moji chlupáči používá knihovny s otevřeným kódem. Děkujeme jejich autorům. Níže je seznam přímých závislostí aplikace a licence, pod kterou je každá šířena. Plné znění licencí je u jednotlivých knihoven.</p>
    </div>
  </div>

  <div class="support-col">
    <section aria-labelledby="knihovny">
      <h2 id="knihovny">Knihovny ({len(rows)})</h2>
      <div class="group">
{items}
      </div>
    </section>
  </div>
'''
out = head + main + "</main>" + tail
(web / "licence.html").write_text(out)
print(f"licence.html: {len(rows)} knihoven, {len(out)} bytes")
