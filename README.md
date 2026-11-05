# Chlupáči – web

Statický web aplikace Chlupáči (doména mojichlupaci.cz): úvod, zásady ochrany osobních údajů, podmínky používání a podpora. Čisté HTML a jeden CSS soubor, bez frameworku, formulářů, statistik, cookie lišty a externích požadavků. Písmo Geist je u nás ve `fonts/` (licence OFL). Funguje bez JavaScriptu; `toc.js` jen zvýrazňuje aktuální kapitolu v obsahu právních stránek a `uvod.js` na úvodu jemně objevuje sekce při rolování (při omezeném pohybu nic).

## Struktura

- `index.html`, `podpora.html` – psané ručně
- `pozvanka.html` – veřejná nápověda k pozvánce do domácnosti (#103) pro toho, komu se odkaz neotevřel v aplikaci; `404.html` + `404.js` – GitHub Pages ji ukáže na každé neexistující adrese, `404.js` na adrese `/pozvanka/<kód>` přepne obecnou hlášku na stejný návod (kód z adresy se nikam nevypisuje; odkazy v `404.html` jsou absolutní, protože se stránka servíruje na libovolné hloubce)
- `.well-known/apple-app-site-association` – soubor bez přípony pro univerzální odkazy aplikace, jen cesta `/pozvanka/*` (appID `RGZ4KGT88F.cz.mrazek.chlupaci`); `.nojekyll` je nutný, jinak GitHub Pages složku začínající tečkou vynechá. Po nasazení: `curl -sI https://mojichlupaci.cz/.well-known/apple-app-site-association` (200, bez přesměrování, `content-type`)
- `karta.html`, `karta.js`, `karta.css` – karta mazlíčka podle odkazu (sdílení z aplikace): odkaz má tvar `karta.html#<token>`, token je za `#`, takže ho prohlížeč nikam neposílá (ani GitHub Pages ho neuvidí); `karta.js` ho pošle v těle POST serveru a vykreslí odpověď přes `textContent`. `noindex`, `no-referrer`, přísná CSP (`connect-src` jen náš Supabase), žádné cookies ani úložiště, nic od třetích stran, bez odkazu z ostatních stránek. Neplatný, prošlý i odvolaný odkaz ukážou totéž: „Odkaz už neplatí“. `?demo=1` (nebo `neplati`, `omezeno`, `chyba`) vykreslí ukázku bez serveru.
- `zasady.html`, `podminky.html` – **generované**, needitujte je ručně
- `style.css` – barvy podle aplikace, světlý a tmavý režim přes `prefers-color-scheme`
- `scripts/build_legal.py` + `scripts/legal_template.html` – generátor právních stránek
- `fonts/`, `img/` (ilustrace psa a kočky, OG obrázek), `favicon.png`, `apple-touch-icon.png`

Každá stránka má v hlavičce přísnou Content-Security-Policy (jen vlastní soubory, žádné inline styly; jediný inline skript na úvodu je povolený otiskem). Při úpravě úvodního skriptu je potřeba přepočítat otisk `sha256` v CSP.

## Právní stránky

Zdrojem pravdy jsou Markdown soubory zásad a podmínek, které vedeme mimo toto repo. Po každé změně textu spusťte (Python 3, jen standardní knihovna):

```
python3 scripts/build_legal.py /cesta/ke/slozce/s/texty
```

Skript vynechá redakční poznámku `> **Návrh…**`, slovo „(návrh)“ v nadpisu a přílohu od „Příloha pro App Store Connect“, přepíše odkazy na `.md` na `zasady.html` / `podminky.html` a z nadpisů `##` udělá obsah s kotvami. Zástupné texty v hranatých závorkách nechává.

## Náhled

```
python3 -m http.server
```

a otevřete http://localhost:8000. Tmavý režim přepnete v systému nebo v DevTools (Rendering → prefers-color-scheme).

## Zveřejnění

GitHub Pages s vlastní doménou mojichlupaci.cz: soubor `CNAME`, ověřená doména v nastavení GitHubu a vynucené HTTPS.
