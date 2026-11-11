/* Moji chlupáči – karta mazlíčka podle odkazu (karta.html). Bez knihoven a bez cookies; všechno se vykresluje přes textContent / atributy, takže text ze serveru nikdy neskončí jako HTML.
   Odkaz má tvar karta.html#<token>. Token je za #, prohlížeč ho žádnému serveru neposílá (ani GitHub Pages ho neuvidí); stránka ho pošle jen v těle POST naší Edge Function card-share
   a nic si nepamatuje (žádné úložiště, žádné cookies). Neplatný, prošlý i odvolaný odkaz ukáže totéž: „Odkaz už neplatí“.
   ?demo=1 vykreslí ukázkovou kartu, ?demo=neplati, ?demo=omezeno a ?demo=chyba ostatní stavy, vše bez volání serveru.
   CSP nepovoluje inline skripty ani styly: všechno stylování je v karta.css. */
(function () {
  'use strict';

  var API = 'https://wyqyqblpddsvfqhokhjb.supabase.co/functions/v1/card-share';
  var TOKEN = /^[A-Za-z0-9_-]{43}$/;
  var PHOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
  var STATES = ['nacitani', 'neplati', 'omezeno', 'chyba', 'karta'];

  var $ = function (id) { return document.getElementById(id); };

  function show(state) {
    STATES.forEach(function (s) { $(s).hidden = s !== state; });
    if (state === 'nacitani') return;
    // čtečka obrazovky přečte nadpis nového stavu
    var target = state === 'karta' ? $('jmeno') : $(state).querySelector('h1');
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }

  /* ---------- Pomocné funkce ---------- */

  function h(tag, cls, content) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (content != null) el.textContent = String(content);
    return el;
  }
  function str(v, max) { return typeof v === 'string' && v.trim() ? v.trim().slice(0, max || 400) : null; }
  function isoDay(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
  function czDate(iso) { var p = iso.split('-'); return Number(p[2]) + '. ' + Number(p[1]) + '. ' + p[0]; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function plural(n, one, few, many) { return n === 1 ? one : n >= 2 && n <= 4 ? few : many; }
  function age(birth, now) {
    var b = birth.split('-').map(Number), t = now.split('-').map(Number);
    var months = (t[0] - b[0]) * 12 + (t[1] - b[1]) - (t[2] < b[2] ? 1 : 0);
    if (months < 0) return null;
    if (months < 12) return months + ' ' + plural(months, 'měsíc', 'měsíce', 'měsíců');
    var y = Math.floor(months / 12);
    return y + ' ' + plural(y, 'rok', 'roky', 'let');
  }
  function dateTime(iso) {
    var d = new Date(iso);
    return isNaN(d) ? null : d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear() + ' v ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  /* Telefon z cizího textu: jen číslice a +, jinak se nevytvoří odkaz (text se ukáže tak, jak je). */
  function telHref(phone) {
    var n = String(phone).replace(/[\s().-]/g, '');
    return /^\+?[0-9]{6,15}$/.test(n) ? 'tel:' + n : null;
  }
  function row(label, value, extra) {
    var r = h('div', 'row' + (extra ? ' ' + extra : ''));
    r.appendChild(h('span', 'k', label));
    r.appendChild(h('span', 'v', value));
    return r;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  /* ---------- Vykreslení karty ---------- */

  function render(res) {
    var c = res && res.card;
    var name = c && str(c.name, 120);
    if (!c || typeof c !== 'object' || !name) { show('neplati'); return; }
    var now = today();

    $('jmeno').textContent = name;
    var line = str(c.line, 120);
    $('popis').textContent = line || '';
    $('popis').hidden = !line;
    var until = typeof res.expires_at === 'string' ? dateTime(res.expires_at) : null;
    $('platnost').textContent = 'Karta mazlíčka · jen ke čtení' + (until ? ' · odkaz platí do ' + until : '');

    var photo = typeof res.photo === 'string' && PHOTO.test(res.photo) ? res.photo : null;
    $('foto-box').hidden = !photo;
    if (photo) { $('foto').src = photo; $('foto').alt = 'Fotka mazlíčka ' + name; }

    var allergy = str(c.allergies, 1000);
    $('alergie').hidden = !allergy;
    if (allergy) $('alergie-text').textContent = allergy;

    // chronická onemocnění (#231): jen text přes textContent, délky a počet ořezané stejně jako na serveru
    var conds = Array.isArray(c.conditions) ? c.conditions.slice(0, 8) : [];
    var cl = $('onemocneni-list');
    clear(cl);
    conds.forEach(function (x) {
      var cn = x && str(x.name, 120);
      if (!cn) return;
      var row = h('div', 'cond');
      var title = h('span', 'what', cn);
      var since = str(x.since, 20);
      if (since) title.appendChild(h('span', 'since', ' · od ' + since));
      row.appendChild(title);
      var note = str(x.note, 400);
      if (note) row.appendChild(h('span', 'note', note));
      cl.appendChild(row);
    });
    $('onemocneni').hidden = !cl.firstChild;

    var facts = $('udaje');
    clear(facts);
    var birth = isoDay(c.birth);
    if (birth) { var a = age(birth, now); facts.appendChild(row('Narození', czDate(birth) + (a ? ' (' + a + ')' : ''))); }
    var chip = str(c.chip, 120);
    facts.appendChild(row('Číslo čipu', chip || 'nezapsáno', chip ? 'cipnum' : ''));

    // vzteklina zvlášť: stav podle konce platnosti a dnešního dne (odkaz může platit déle než očkování)
    var rb = $('vzteklina');
    clear(rb);
    var rabies = c.rabies && typeof c.rabies === 'object' ? c.rabies : null;
    var ru = rabies ? isoDay(rabies.until) : null;
    var state = !rabies ? 'none' : !ru ? 'ok' : ru >= now ? 'ok' : 'late';
    rb.className = 'rabies ' + state;
    rb.appendChild(h('span', 'k', 'Vzteklina'));
    rb.appendChild(h('span', 'v', !rabies ? 'není zapsané' : !ru ? 'bez data konce' : ru >= now ? 'platí do ' + czDate(ru) : 'prošlé od ' + czDate(ru)));

    var vaccines = Array.isArray(c.vaccines) ? c.vaccines.slice(0, 20) : [];
    var vg = $('ockovani');
    clear(vg);
    vaccines.forEach(function (v) {
      var vn = v && str(v.name, 120);
      if (!vn) return;
      var vu = isoDay(v.until);
      vg.appendChild(row(vn, !vu ? 'bez data konce' : vu >= now ? 'platí do ' + czDate(vu) : 'platnost skončila ' + czDate(vu), vu && vu < now ? 'late' : ''));
    });
    vg.hidden = !vg.firstChild;
    $('ockovani-pozn').textContent = 'Očkování platná v den, kdy majitel odkaz vytvořil.';

    var meds = Array.isArray(c.meds) ? c.meds.slice(0, 20) : [];
    var mg = $('leky');
    clear(mg);
    meds.forEach(function (m) {
      var mn = m && str(m.name, 120);
      if (!mn) return;
      var r = h('div', 'row med');
      var left = h('span', 'k strong', mn);
      var dose = str(m.dose, 120), when = str(m.when, 120), mu = isoDay(m.until);
      var sub = [dose, when, mu ? 'do ' + czDate(mu) : 'trvale'].filter(Boolean).join(' · ');
      r.appendChild(left);
      r.appendChild(h('span', 'v sub', sub));
      mg.appendChild(r);
    });
    $('leky-h').hidden = $('leky').hidden = !mg.firstChild;

    var contacts = $('kontakty');
    clear(contacts);
    var vet = c.vet && typeof c.vet === 'object' ? c.vet : null;
    var vetName = vet && str(vet.name, 120);
    if (vetName) contacts.appendChild(contact('Veterinář', vetName, vet.phone));
    var owner = str(c.owner_phone, 30);
    if (owner) contacts.appendChild(contact('Majitel', null, owner));
    $('kontakty-h').hidden = contacts.hidden = !contacts.firstChild;

    var made = isoDay(c.made);
    $('stav').textContent = (made ? 'Stav k ' + czDate(made) + '. ' : '') + 'Jde o záznamy majitele z aplikace Moji chlupáči, ne o veterinární dokument ani očkovací průkaz.';
    show('karta');
  }

  function contact(label, name, phone) {
    var r = h('div', 'row contact');
    var left = h('span', 'k');
    left.appendChild(h('span', 'small', label));
    if (name) left.appendChild(h('span', 'strong', name));
    r.appendChild(left);
    var p = str(phone, 30);
    if (p) {
      var href = telHref(p);
      if (href) {
        var a = h('a', 'dial', p);
        a.href = href;
        a.setAttribute('aria-label', 'Zavolat ' + (name || label) + ', ' + p);
        r.appendChild(a);
      } else r.appendChild(h('span', 'v', p));
    }
    return r;
  }

  /* ---------- Načtení ---------- */

  var DEMO = {
    ok: {
      card: {
        v: 1, name: 'Rex', line: 'Labrador · samec', birth: '2020-05-01', chip: '999 000 000 000 001', allergies: 'kuře, penicilin', conditions: [{ name: 'Artróza', since: '3/2022', note: 'Nepodávat NSAID bez porady s veterinářem.' }, { name: 'Epilepsie' }], rabies: { until: '2027-12-01' },
        vaccines: [{ name: 'Psinka, parvoviróza, hepatitida', until: '2027-01-10' }, { name: 'Borelióza', until: null }],
        meds: [{ name: 'Prednison', dose: '5 mg', when: '8:00, 20:00', until: '2027-11-20' }, { name: 'Ledviny', when: 'každý den v 8:00' }],
        vet: { name: 'MVDr. Nováková', phone: '123 456 789' }, owner_phone: '123 456 789', made: '2026-11-03'
      },
      photo: null, expires_at: '2027-11-10T15:05:00+00:00'
    }
  };

  // the token is read once and then removed from the address bar, so it does not stay in the browser history, address suggestions or synced tabs (a vet's shared computer)
  var savedToken = location.hash.slice(1);
  if (savedToken && window.history && history.replaceState) history.replaceState(null, '', location.pathname + location.search);

  function load() {
    var query = new URLSearchParams(location.search).get('demo');
    if (query) {
      if (query === 'neplati') show('neplati');
      else if (query === 'omezeno') show('omezeno');
      else if (query === 'chyba') show('chyba');
      else render(DEMO.ok);
      return;
    }
    // GitHub Pages cannot send frame headers: a card opened inside someone else's frame is not shown
    if (window.top !== window.self) { show('chyba'); return; }
    var token = savedToken;
    if (!TOKEN.test(token)) { show('neplati'); return; }
    show('nacitani');
    fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token }),
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'
    }).then(function (r) {
      if (r.status === 404) { show('neplati'); return null; }
      if (r.status === 429) { show('omezeno'); return null; }
      if (!r.ok) throw new Error('status');
      return r.json();
    }).then(function (res) {
      if (res) { if (res.ok) render(res); else show('neplati'); }
    }).catch(function () { show('chyba'); });
  }

  $('znovu').addEventListener('click', load);
  // a new link pasted into the same tab: read the new token and clear the address again, otherwise the old card would load
  window.addEventListener('hashchange', function () {
    var h = location.hash.slice(1);
    if (h) { savedToken = h; if (window.history && history.replaceState) history.replaceState(null, '', location.pathname + location.search); }
    load();
  });
  load();
})();
