# Moji chlupáči – web

Statický web aplikace Moji chlupáči (doména mojichlupaci.cz): úvod, funkce aplikace, čtyři tematické stránky pro majitele, zásady ochrany osobních údajů, podmínky používání, podpora a smazání účtu. Čisté HTML a jeden CSS soubor, bez frameworku, formulářů, statistik, cookie lišty a externích požadavků. Písma Geist a Bricolage Grotesque (nadpisy úvodu) jsou u nás ve `fonts/` (licence OFL, texty licencí tamtéž). Funguje bez JavaScriptu; `toc.js` jen zvýrazňuje aktuální kapitolu v obsahu právních stránek a `landing.js` na úvodu řídí pohyb (sklon telefonu za kurzorem, záře, rozsvěcení textu při rolování; při omezeném pohybu a na dotykových zařízeních se pohyb za kurzorem nezapne). Úvod má vlastní `landing.css`, ostatní stránky `style.css`.

## Struktura

- `index.html`, `podpora.html`, `smazani-uctu.html` – psané ručně; `smazani-uctu.html` (Smazání účtu a údajů) je veřejná adresa pro Meta (User data deletion URL) a Google, postup odpovídá Profil → Můj účet → Smazat účet a zásadám ochrany. Úvod má v hlavičce JSON-LD (`Organization`, `WebSite`, `SoftwareApplication`); je to datový blok, CSP `script-src` ho neřeší
- `funkce.html` – přínosy a tabulka funkcí zdarma / Premium / Family Premium (sémantická `<table>` s `caption` a `scope`, na mobilu bez vodorovného posunu; ceny stejné jako v `index.html#cena`, při změně cen upravte obě místa); odkazuje na ni „Co umí“ v hlavičce a „Všechny funkce“ na úvodu. Skutečné obrazovky ze simulátoru zatím nejsou (#209)
- `ockovani.html`, `odcerveni.html`, `zdravotni-karta.html`, `pece-ve-vice-lidech.html` – věcné texty pro majitele (#456), každá s FAQ, zdroji, poznámkou, že nenahrazuje veterináře, a JSON-LD (`Article`, `FAQPage`; text odpovědí v JSON-LD musí zůstat shodný s viditelným FAQ). Žádná zdravotní doporučení, čísla ani intervaly bez zdroje; úvod i patička odkazují na všechny čtyři
- `pozvanka.html` – veřejná nápověda k pozvánce do domácnosti (#103) pro toho, komu se odkaz neotevřel v aplikaci; `404.html` + `404.js` – GitHub Pages ji ukáže na každé neexistující adrese, `404.js` na adrese `/pozvanka/<kód>` přepne obecnou hlášku na stejný návod (kód z adresy se nikam nevypisuje; odkazy v `404.html` jsou absolutní, protože se stránka servíruje na libovolné hloubce)
- `.well-known/apple-app-site-association` – soubor bez přípony pro univerzální odkazy aplikace, jen cesta `/pozvanka/*` (appID `RGZ4KGT88F.cz.mrazek.chlupaci`); `.nojekyll` je nutný, jinak GitHub Pages složku začínající tečkou vynechá. Po nasazení: `curl -sI https://mojichlupaci.cz/.well-known/apple-app-site-association` (200, bez přesměrování, `content-type`)
- `karta.html`, `karta.js`, `karta.css` – karta mazlíčka podle odkazu (sdílení z aplikace): odkaz má tvar `karta.html#<token>`, token je za `#`, takže ho prohlížeč nikam neposílá (ani GitHub Pages ho neuvidí); `karta.js` ho pošle v těle POST serveru a vykreslí odpověď přes `textContent`. `noindex`, `no-referrer`, přísná CSP (`connect-src` jen náš Supabase), žádné cookies ani úložiště, nic od třetích stran, bez odkazu z ostatních stránek. Neplatný, prošlý i odvolaný odkaz ukážou totéž: „Odkaz už neplatí“. `?demo=1` (nebo `neplati`, `omezeno`, `chyba`) vykreslí ukázku bez serveru.
- `mojeadminstranka/` (`index.html`, `admin.js`, `admin.css`) – přehled pro správce (od 11. 11. 2026, nahrazuje místní stránku ze soukromého repa chlupaci-admin). Stránka je veřejná a prázdná; data vrací jen Edge Function `admin-stats`, a to jen přihlášení Supabase Auth s ověřeným TOTP (aal2) a s id na seznamu `ADMIN_USER_IDS`. Skrytá adresa není ochrana, ale ani se nevystavuje: `noindex`, není v `sitemap.xml` ani v `robots.txt` (ten by cestu prozradil) a nevede na ni odkaz. Mluví přímo s `/auth/v1` přes `fetch` s veřejným anon klíčem (žádné knihovny, žádné tajemství), tokeny jen v paměti skriptu (obnovení stránky, Odhlásit a 15 minut nečinnosti je zahodí), data jen přes `textContent`. CSP navíc povoluje `img-src data:` kvůli QR kódu při prvním zápisu TOTP. GitHub Pages neumí hlavičky a `frame-ancestors` v meta CSP nefunguje, proto stránka ve cizím rámu zůstane skrytá (`admin.css`) a skript se z rámu zkusí vymanit. `?demo=1` vykreslí ukázková data bez serveru. Postup nastavení je v repu aplikace (`docs/postupy.md`, Admin dashboard).
- `zasady.html`, `podminky.html` – **generované**, needitujte je ručně
- `llms.txt` – stručný popis webu a odkazy na stránky pro jazykové modely; `sitemap.xml`, `robots.txt` – pro vyhledávače (nová stránka přidat i do `sitemap.xml`)
- `nav.js` – navigace ve stylu Apple (rozbalovací nabídka Rady pro majitele, mobilní menu); markup lišty je v každé stránce, proto při změně položek upravte všechny `*.html` a `scripts/legal_template.html`
- `pages.css` – styly vnitřních stránek (Co umí, Podpora, články, zásady a podmínky, smazání účtu, pozvánka, 404) v novém designu; všechny stránky kromě `karta.html` a `mojeadminstranka/` už používají `landing.css` + `pages.css`. Právní stránky generuje `scripts/legal_template.html`, který má stejný nový obal
- `landing.css`, `landing.js` – nový úvod (tmavý design s 3D telefonem se zástupnou přihlašovací obrazovkou, deník, přehled funkcí MVP); skutečné obrazovky aplikace tam zatím nejsou. `uvod.js` už úvod nepoužívá
- `style.css` – starý společný styl, už ho používá jen `karta.html`; barvy podle aplikace, světlý a tmavý režim přes `prefers-color-scheme`
- `scripts/build_legal.py` + `scripts/legal_template.html` – generátor právních stránek
- `fonts/`, `img/` (ilustrace psa a kočky, OG obrázek), `favicon.png`, `apple-touch-icon.png`

Každá stránka má v hlavičce přísnou Content-Security-Policy (jen vlastní soubory, žádné inline styly; na úvodu už žádný inline skript není, `script-src 'self'`).

## Právní stránky

Zdrojem pravdy jsou Markdown soubory zásad a podmínek, které vedeme mimo toto repo. Po každé změně textu spusťte (Python 3, jen standardní knihovna):

```
python3 scripts/build_legal.py /cesta/k/chlupaci/docs/texty
```

Skript vynechá redakční poznámku `> **Návrh…**`, slovo „(návrh)“ v nadpisu a přílohu od „Příloha pro App Store Connect“, přepíše odkazy na `.md` na `zasady.html` / `podminky.html` a z nadpisů `##` udělá obsah s kotvami. Zástupné texty v hranatých závorkách nechává.

## Náhled

```
python3 -m http.server
```

a otevřete http://localhost:8000. Tmavý režim přepnete v systému nebo v DevTools (Rendering → prefers-color-scheme).

## Zveřejnění

GitHub Pages s vlastní doménou mojichlupaci.cz: soubor `CNAME`, ověřená doména v nastavení GitHubu a vynucené HTTPS.
