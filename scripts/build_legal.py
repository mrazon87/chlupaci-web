#!/usr/bin/env python3
"""Vygeneruje zasady.html a podminky.html ze zdrojových .md souborů aplikace.

Použití:
    python3 scripts/build_legal.py /cesta/k/chlupaci/docs

Jen standardní knihovna. Šablona: scripts/legal_template.html. Výstup se zapisuje
do kořene webu (o úroveň výš než scripts/).
"""
import html
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "scripts" / "legal_template.html"

PAGES = [
    {
        "md": "zasady-ochrany-udaju.md",
        "out": "zasady.html",
        "description": "Jaké údaje Chlupáči zpracovávají, proč, komu je předávají, jak dlouho je uchovávají a jak je můžete spravovat nebo smazat.",
    },
    {
        "md": "podminky-pouziti.md",
        "out": "podminky.html",
        "description": "Podmínky použití aplikace Chlupáči: zkušební doba, verze zdarma a Premium, účet a domácnost, vaše data a odpovědnost.",
    },
]

LINK_MAP = {p["md"]: p["out"] for p in PAGES}
STOP_HEADING = "Příloha pro App Store Connect"  # od tohoto nadpisu dál se nic nepřevádí


def slugify(text):
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def inline(text):
    """Escapuje HTML a převede **tučné**, *kurzívu* a [odkazy](url)."""
    text = html.escape(text, quote=False)

    def link(m):
        label, url = m.group(1), m.group(2)
        name = url.split("#")[0]
        if name in LINK_MAP:
            url = LINK_MAP[name] + url[len(name):]
        elif name.endswith(".md"):
            print(f"VAROVÁNÍ: odkaz na neznámý soubor {url}", file=sys.stderr)
        # the text was escaped above, so the URL is unescaped once before it is escaped as an attribute (no double &amp;amp;)
        url = html.unescape(url)
        # only safe link schemes: https, mailto, in-page and relative links (never javascript: or data:)
        if not re.match(r"^(https://|mailto:|#|[A-Za-z0-9_./-]+(#.*)?$)", url):
            print(f"VAROVÁNÍ: nepovolený odkaz {url!r}, vynechán", file=sys.stderr)
            return label
        return f'<a href="{html.escape(url, quote=True)}">{label}</a>'

    text = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", text)
    return text


def split_row(line):
    cells = line.strip().strip("|").split("|")
    return [c.strip() for c in cells]


def render_table(rows):
    head, body = rows[0], rows[2:]  # rows[1] je oddělovač |---|---|
    labels = [inline(h) for h in head]
    out = ['<div class="table-wrap">', "<table>", "<thead><tr>"]
    out += [f'<th scope="col">{h}</th>' for h in labels]
    out += ["</tr></thead>", "<tbody>"]
    for r in body:
        out.append("<tr>")
        for i, cell in enumerate(r):
            label = html.escape(re.sub(r"<[^>]+>", "", labels[i]) if i < len(labels) else "")
            out.append(f'<td data-label="{label}">{inline(cell)}</td>')
        out.append("</tr>")
    out += ["</tbody>", "</table>", "</div>"]
    return "\n".join(out)


def convert(md_text):
    """Vrací (titulek, chip, [(číslo, text, id)], html těla)."""
    lines = md_text.splitlines()
    title = None
    chip = ""
    toc = []
    sections = []  # každá sekce = seznam html bloků
    cur = None  # aktuální sekce
    para, items, table = [], [], []

    def flush():
        nonlocal para, items, table, chip
        target = cur if cur is not None else None
        blocks = []
        if para:
            text = " ".join(para)
            m = re.match(r"\*\*Účinné od:\*\*\s*(.*)", text)
            if m and cur is None:
                chip = f'<p class="chip">Účinné od: {inline(m.group(1))}</p>'
            else:
                blocks.append(f"<p>{inline(text)}</p>")
        if items:
            blocks.append("<ul>\n" + "\n".join(f"<li>{inline(i)}</li>" for i in items) + "\n</ul>")
        if table:
            blocks.append(render_table(table))
        para, items, table = [], [], []
        if blocks and target is not None:
            target.extend(blocks)

    for raw in lines:
        line = raw.rstrip()
        if line.startswith("# ") and title is None:
            flush()
            title = re.sub(r"\s*\(návrh\)\s*", " ", line[2:]).strip()
        elif line.startswith("## "):
            flush()
            heading = line[3:].strip()
            if heading.startswith(STOP_HEADING):
                break
            m = re.match(r"(\d+)\.\s+(.*)", heading)
            num, text = (m.group(1), m.group(2)) if m else ("", heading)
            sid = slugify(text)
            toc.append((num, text, sid))
            cur = [f'<h2 id="{sid}">{inline(heading)}</h2>']
            sections.append(cur)
        elif line.startswith("> "):
            flush()  # redakční poznámka (> **Návrh…**) se vynechává
        elif line.strip() == "---":
            flush()  # oddělovač před přílohou; případná příloha se ořízne výše
        elif line.startswith("|"):
            if para or items:
                flush()
            table.append(split_row(line))
        elif re.match(r"[-*] ", line):
            if para or table:
                flush()
            items.append(line[2:].strip())
        elif not line.strip():
            flush()
        else:
            if items:  # pokračování odrážky na dalším řádku
                items[-1] += " " + line.strip()
            else:
                para.append(line.strip())
    flush()

    body = "\n".join(
        '    <section>\n' + "\n".join("      " + b.replace("\n", "\n      ") for b in s) + "\n    </section>"
        for s in sections
    )
    return title, chip, toc, body


def split_title(title):
    """„Zásady ochrany osobních údajů – Chlupáči“ -> zobrazený nadpis ve dvou řádcích."""
    shown = title.split(" – ")[0].strip()
    words = shown.split()
    k = max(1, len(words) // 2)
    first, second = " ".join(words[:k]), " ".join(words[k:])
    return f"{html.escape(first)} <span>{html.escape(second)}</span>" if second else html.escape(first)


def main():
    if len(sys.argv) != 2:
        sys.exit("Použití: python3 scripts/build_legal.py /cesta/k/chlupaci/docs")
    docs = Path(sys.argv[1])
    template = TEMPLATE.read_text(encoding="utf-8")
    for page in PAGES:
        src = docs / page["md"]
        if not src.is_file():
            sys.exit(f"Chybí zdroj: {src}")
        title, chip, toc, body = convert(src.read_text(encoding="utf-8"))
        toc_html = "\n".join(
            '      <li><a href="#{}">{}{}</a></li>'.format(
                sid, f'<span class="n">{num}</span>' if num else "", html.escape(text)
            )
            for num, text, sid in toc
        )
        out = (
            template.replace("{{title}}", html.escape(title))
            .replace("{{description}}", html.escape(page["description"], quote=True))
            .replace("{{path}}", page["out"])
            .replace("{{h1}}", split_title(title))
            .replace("{{chip}}", chip)
            .replace("{{toc}}", toc_html)
            .replace("{{body}}", body)
        )
        (ROOT / page["out"]).write_text(out, encoding="utf-8")
        print(f"{page['out']}: {len(toc)} kapitol")


if __name__ == "__main__":
    main()
