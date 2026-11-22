/* Moji chlupáči – správcovský přehled (https://mojichlupaci.cz/mojeadminstranka/). Bez knihoven; všechno se vykresluje přes textContent / SVG, takže text ze serveru nikdy neskončí jako HTML.
   Stránka je veřejná a sama nic neobsahuje. Data chrání server: Edge Function admin-stats pustí jen přihlášení Supabase Auth s ověřeným druhým faktorem (aal2)
   a s id uživatele na seznamu ADMIN_USER_IDS. Tady se jen mluví s /auth/v1 přes fetch (heslo → TOTP → access_token). Anon klíč je veřejný (je i v aplikaci).
   Tokeny jen v paměti tohoto skriptu (žádné localStorage ani sessionStorage): obnovení stránky, Odhlásit a 15 minut nečinnosti je zahodí.
   ?demo=1 vykreslí ukázková data bez volání serveru. CSP nepovoluje inline style, proto se rozměry nastavují přes CSSOM (el.style.x), ne přes atribut style. */
(function () {
  'use strict';

  /* GitHub Pages neumí hlavičky a frame-ancestors v meta CSP prohlížeč ignoruje: ve cizím rámu stránka zůstane skrytá (admin.css) a zkusí se z něj vymanit. */
  if (window.top !== window.self) {
    try { window.top.location.replace(window.self.location.href); } catch (e) { /* jiná doména nebo sandbox: zůstane skrytá */ }
    return;
  }
  document.documentElement.classList.add('unframed');

  var SUPABASE = 'https://wyqyqblpddsvfqhokhjb.supabase.co';
  var API = SUPABASE + '/functions/v1/admin-stats';
  var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5cXlxYmxwZGRzdmZxaG9raGpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzNTk0ODEsImV4cCI6MjEwODkzNTQ4MX0.cNsbvhmmKUa4Yj0SzwxO8UGwXX3knlGVf8wEp3oAag8';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var DAY = 86400000;
  var demo = new URLSearchParams(location.search).get('demo') === '1';

  var $ = function (id) { return document.getElementById(id); };
  var nf = new Intl.NumberFormat('cs-CZ');
  var nf1 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 });
  var gid = 0;

  /* ---------- Pomocné funkce ---------- */

  function h(tag, cls, content) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    add(el, content);
    return el;
  }
  function add(el, content) {
    if (content == null) return el;
    if (Array.isArray(content)) content.forEach(function (c) { add(el, c); });
    else if (content instanceof Node) el.appendChild(content);
    else el.appendChild(document.createTextNode(String(content)));
    return el;
  }
  function sv(tag, attrs, kids) {
    var el = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, String(attrs[k])); });
    (kids || []).forEach(function (k) { el.appendChild(k); });
    return el;
  }
  function icon(name, cls) {
    return sv('svg', { 'class': 'ic' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true', focusable: 'false' }, [sv('use', { href: '#i-' + name })]);
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function int(v) { return num(v) === null ? '–' : nf.format(v); }
  function pct(part, whole) { return whole > 0 ? Math.round(100 * part / whole) : null; }
  function pctText(part, whole) { var p = pct(part, whole); return p === null ? '–' : p + ' %'; }
  function bytes(v) {
    if (num(v) === null) return '–';
    if (v >= 1073741824) return nf2.format(v / 1073741824) + ' GB';
    if (v >= 1048576) return nf1.format(v / 1048576) + ' MB';
    if (v >= 1024) return nf.format(Math.round(v / 1024)) + ' kB';
    return nf.format(v) + ' B';
  }
  function kc(v) { return num(v) === null ? '–' : nf.format(Math.round(v)) + ' Kč'; }
  function dayText(iso) { var d = new Date(iso + 'T00:00:00'); return isNaN(d) ? iso : d.getDate() + '. ' + (d.getMonth() + 1) + '.'; }
  function tText(t) { var d = new Date(t); return d.getDate() + '. ' + (d.getMonth() + 1) + '.'; }
  function dateTime(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '–' : d.toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  /* Řada ze snapshotů: jen body s číslem, seřazené podle dne. */
  function pts(series, field) {
    return series.map(function (p) { return { t: new Date(p.day + 'T00:00:00').getTime(), day: p.day, v: num(p[field]) }; })
      .filter(function (p) { return p.v !== null && !isNaN(p.t); });
  }
  /* Změna za N dní: poslední bod proti poslednímu bodu starému aspoň N dní; bez takové historie null. */
  function change(list, days) {
    if (list.length < 2) return null;
    var last = list[list.length - 1], target = last.t - days * DAY, prev = null;
    list.forEach(function (p) { if (p.t <= target) prev = p; });
    return prev ? last.v - prev.v : null;
  }

  /* ---------- Stavební kameny ---------- */

  function card(o, body) {
    var tid = o.id ? o.id + '-t' : null;
    var head = h('header', 'card-head', [
      h('span', 'cic', icon(o.icon)),
      h('h2', null, o.title),
      o.note ? h('span', 'note', o.note) : null,
      o.extra || null
    ]);
    if (tid) head.querySelector('h2').id = tid;
    var sec = h('section', 'card ' + (o.cls || ''), [head].concat(body));
    if (o.id) { sec.id = o.id; sec.setAttribute('aria-labelledby', tid); }
    return sec;
  }
  function empty(text, ic) {
    return h('div', 'empty', [h('span', 'cic', icon(ic || 'chart')), h('p', null, text)]);
  }
  function note(text) { return h('p', 'sub', text); }
  function mini(list, two) {
    return h('dl', 'mini' + (two ? ' two' : ''), list.map(function (r) {
      return h('div', null, [h('dt', null, r[0]), h('dd', null, [r[1], r[2] ? h('small', null, ' ' + r[2]) : null])]);
    }));
  }
  function trend(d, days, fmt, label) {
    if (d === null) return null;
    var cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    var text = (d > 0 ? '+' : d < 0 ? '−' : '±') + fmt(Math.abs(d));
    var el = h('span', 'trend ' + cls, [icon(d > 0 ? 'up' : d < 0 ? 'down' : 'minus'), h('b', null, text), h('small', null, ' za ' + days + ' dní')]);
    el.setAttribute('aria-label', label + ': ' + text + ' za ' + days + ' dní');
    return el;
  }

  /* Malý čárový graf bez os (hero, kapacita). */
  function sparkline(list, cls, label) {
    if (list.length < 2) return null;
    var W = 200, H = 48, id = 'g' + (++gid);
    var t0 = list[0].t, t1 = list[list.length - 1].t, max = 0, min = Infinity;
    list.forEach(function (p) { max = Math.max(max, p.v); min = Math.min(min, p.v); });
    var span = max - min || 1;
    var d = list.map(function (p, i) {
      var x = t1 === t0 ? 0 : (p.t - t0) / (t1 - t0) * W, y = H - 4 - (p.v - min) / span * (H - 10);
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
    var svg = sv('svg', { 'class': 'spark ' + (cls || ''), viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', role: 'img', 'aria-label': label + ' od ' + list[0].v + ' do ' + list[list.length - 1].v }, [
      sv('defs', {}, [sv('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 }, [sv('stop', { offset: '0', 'class': 'g0' }), sv('stop', { offset: '1', 'class': 'g1' })])]),
      sv('path', { d: d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z', fill: 'url(#' + id + ')', stroke: 'none' }),
      sv('path', { d: d, fill: 'none', 'class': 'ln', 'vector-effect': 'non-scaling-stroke' })
    ]);
    return svg;
  }

  /* Plošný / čárový graf s popisky na osách (jen pár) a hover tooltipem.
     lines: [{ name, cls: 'a'|'b', pts, fill }], fmt formátuje hodnotu. */
  function areaChart(lines, fmt, label) {
    var all = [];
    lines.forEach(function (l) { all = all.concat(l.pts); });
    var tmin = Infinity, tmax = -Infinity, vmax = 0;
    all.forEach(function (p) { tmin = Math.min(tmin, p.t); tmax = Math.max(tmax, p.t); vmax = Math.max(vmax, p.v); });
    if (all.length < 2 || tmax === tmin) {
      return empty('Historie se plní od prvního denního snímku (cron každý den ve 3:43 UTC). Graf se objeví, až budou aspoň dva dny.');
    }
    var top = niceMax(vmax), W = 1000, H = 200;
    var X = function (t) { return (t - tmin) / (tmax - tmin); };
    var Y = function (v) { return 1 - v / top; };
    var defs = sv('defs', {}), svg = sv('svg', { 'class': 'plot-svg', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, [defs]);
    lines.forEach(function (l) {
      if (l.pts.length < 2) return;
      var d = l.pts.map(function (p, i) { return (i ? 'L' : 'M') + (X(p.t) * W).toFixed(1) + ' ' + (3 + Y(p.v) * (H - 6)).toFixed(1); }).join(' ');
      if (l.fill) {
        var id = 'g' + (++gid);
        defs.appendChild(sv('linearGradient', { id: id, x1: 0, y1: 0, x2: 0, y2: 1 }, [sv('stop', { offset: '0', 'class': 'g0 ' + l.cls }), sv('stop', { offset: '1', 'class': 'g1 ' + l.cls })]));
        svg.appendChild(sv('path', { d: d + ' L' + (X(l.pts[l.pts.length - 1].t) * W).toFixed(1) + ' ' + H + ' L' + (X(l.pts[0].t) * W).toFixed(1) + ' ' + H + ' Z', fill: 'url(#' + id + ')', stroke: 'none' }));
      }
      svg.appendChild(sv('path', { d: d, fill: 'none', 'class': 'ln ' + l.cls, 'vector-effect': 'non-scaling-stroke' }));
    });

    var plot = h('div', 'plot');
    plot.setAttribute('role', 'img');
    plot.setAttribute('aria-label', label + ' od ' + tText(tmin) + ' do ' + tText(tmax) + ': ' + lines.map(function (l) {
      return l.name + ' z ' + fmt(l.pts[0].v) + ' na ' + fmt(l.pts[l.pts.length - 1].v);
    }).join(', ') + '.');
    plot.appendChild(svg);
    [0, 0.5, 1].forEach(function (f) { var g = h('i', 'grid'); g.style.top = (f * 100) + '%'; plot.appendChild(g); });
    var vline = h('i', 'vline'), tip = h('div', 'tip');
    var dots = lines.map(function (l) { var d = h('i', 'dot ' + l.cls); plot.appendChild(d); return d; });
    plot.appendChild(vline);
    plot.appendChild(tip);

    function nearest(list, t) {
      var best = null, bd = Infinity;
      list.forEach(function (p) { var dd = Math.abs(p.t - t); if (dd < bd) { bd = dd; best = p; } });
      return best;
    }
    function hover(e) {
      var r = plot.getBoundingClientRect();
      var f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), t = tmin + f * (tmax - tmin);
      var ref = nearest(lines[0].pts, t);
      if (!ref) return;
      var fx = X(ref.t);
      vline.style.left = (fx * 100) + '%';
      tip.textContent = '';
      tip.appendChild(h('b', null, tText(ref.t)));
      lines.forEach(function (l, i) {
        var p = nearest(l.pts, ref.t);
        if (!p) return;
        dots[i].style.left = (fx * 100) + '%';
        dots[i].style.top = (Y(p.v) * 100) + '%';
        dots[i].hidden = false;
        tip.appendChild(h('span', null, [h('i', 'sw ' + l.cls), l.name + ' ', h('b', null, fmt(p.v))]));
      });
      tip.style.left = fx > 0.6 ? 'auto' : (fx * 100) + '%';
      tip.style.right = fx > 0.6 ? ((1 - fx) * 100) + '%' : 'auto';
      plot.classList.add('on');
    }
    plot.addEventListener('pointermove', hover);
    plot.addEventListener('pointerdown', hover);
    plot.addEventListener('pointerleave', function () { plot.classList.remove('on'); });

    var yax = h('div', 'yax', [top, top / 2, 0].map(function (v) { return h('span', null, fmt(v)); }));
    var xax = h('div', 'xax', [0, 1 / 3, 2 / 3, 1].map(function (f) { return h('span', null, tText(tmin + f * (tmax - tmin))); }));
    return h('div', 'chart', [h('div', 'plot-row', [yax, plot]), xax]);
  }

  /* Prstenec s jedním podílem a volitelnou značkou 80 % limitu. */
  function ring(percent, o) {
    var p = Math.min(100, Math.max(0, percent || 0)), r = 42;
    var kids = [sv('circle', { cx: 50, cy: 50, r: r, 'class': 'rtrack', fill: 'none', 'stroke-width': 10 })];
    if (p > 0) kids.push(sv('circle', { cx: 50, cy: 50, r: r, 'class': 'rfill ' + (o.cls || ''), fill: 'none', 'stroke-width': 10, 'stroke-linecap': 'round', pathLength: 100, 'stroke-dasharray': p + ' 100', transform: 'rotate(-90 50 50)' }));
    if (o.tick) {
      var a = (-90 + 0.8 * 360) * Math.PI / 180;
      kids.push(sv('line', { 'class': 'rtick', x1: 50 + 35 * Math.cos(a), y1: 50 + 35 * Math.sin(a), x2: 50 + 49 * Math.cos(a), y2: 50 + 49 * Math.sin(a), 'stroke-width': 2.4, 'stroke-linecap': 'round' }));
    }
    var box = h('div', 'ring' + (o.small ? ' small' : ''), [sv('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' }, kids), h('div', 'ring-c', [h('b', null, o.center), o.sub ? h('small', null, o.sub) : null])]);
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', o.label);
    return box;
  }

  function donut(parts, total, centerSub, label) {
    var r = 40, cum = 0, gap = parts.filter(function (x) { return x.value > 0; }).length > 1 ? 1.4 : 0;
    var kids = [sv('circle', { cx: 50, cy: 50, r: r, 'class': 'rtrack', fill: 'none', 'stroke-width': 14 })];
    parts.forEach(function (x) {
      if (!(x.value > 0)) return;
      var len = 100 * x.value / total;
      kids.push(sv('circle', { cx: 50, cy: 50, r: r, 'class': 'seg ' + x.cls, fill: 'none', 'stroke-width': 14, pathLength: 100, 'stroke-dasharray': Math.max(0.1, len - gap) + ' 100', 'stroke-dashoffset': -(cum + gap / 2), transform: 'rotate(-90 50 50)' }));
      cum += len;
    });
    var box = h('div', 'ring big', [sv('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' }, kids), h('div', 'ring-c', [h('b', null, int(total)), h('small', null, centerSub)])]);
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', label);
    return box;
  }

  /* Vodorovné pruhy: rows = [[název, hodnota, text vpravo, popisek pod názvem?]]. */
  function hbars(list, max, cls) {
    return h('ul', 'hbars', list.map(function (r) {
      var fill = h('i', 'fill ' + (cls || ''));
      fill.style.width = Math.max(r[1] > 0 ? 2 : 0, Math.round(100 * r[1] / (max || 1))) + '%';
      return h('li', null, [h('span', 'name', r[0]), h('b', null, r[2] != null ? r[2] : int(r[1])), h('span', 'track', fill)]);
    }));
  }

  /* Odhad zaplnění z růstu za posledních ≤ 30 dní historie. */
  function fullIn(series, field, used, limit) {
    var list = series.filter(function (p) { return num(p[field]) !== null; }).slice(-31);
    if (list.length < 4) return 'Na odhad zaplnění je zatím málo historie (potřeba aspoň 4 dny).';
    var first = list[0], last = list[list.length - 1];
    var days = (new Date(last.day) - new Date(first.day)) / DAY;
    var perDay = days > 0 ? (last[field] - first[field]) / days : 0;
    if (perDay <= 0) return 'Neroste, zaplnění nehrozí.';
    var left = Math.max(0, (limit - used) / perDay);
    var text = left > 730 ? 'za víc než 2 roky' : left > 60 ? 'asi za ' + Math.round(left / 30) + ' měsíců' : 'asi za ' + Math.round(left) + ' dní';
    return 'Při růstu ' + bytes(perDay) + ' denně se zaplní ' + text + '.';
  }

  /* ---------- Karty ---------- */

  /* Pruh po konci zkoušky: platí teď / zbytek (jen ke čtení). */
  function convBar(t) {
    if (!t.ended) return null;
    var pay = h('i', 'pay'), box = h('div', 'convbar', [h('div', 'cbar', pay), h('p', 'hero-sub dim', ['Platí teď ', h('b', null, int(t.paying_now)), ' · jen ke čtení ', h('b', null, int(t.read_only))])]);
    pay.style.width = (100 * (t.paying_now || 0) / t.ended) + '%';
    return box;
  }

  function heroCard(s, series) {
    var u = s.users || {}, t = s.trial || {}, r = s.revenue || {};
    var users = pts(series, 'users'), mrr = pts(series, 'mrr_czk');

    var mrr30 = change(mrr, 30);
    if (mrr30 === null && num(r.mrr_prev_czk) !== null && num(r.mrr_czk) !== null) mrr30 = r.mrr_czk - r.mrr_prev_czk;
    var mrr30days = mrr30 !== null && change(mrr, 30) === null ? Math.max(1, Math.round((new Date(s.generated_at) - new Date(r.mrr_prev_day + 'T00:00:00')) / DAY)) : 30;

    var convText = num(t.conversion_pct) === null ? '–' : nf1.format(t.conversion_pct) + ' %';

    function block(cls, ic, eyebrow, big, small, extra) {
      return h('div', 'hero-block ' + cls, [
        h('p', 'eyebrow', [icon(ic), eyebrow]),
        h('p', 'hero-num', big),
        h('p', 'hero-sub', small)
      ].concat(extra));
    }
    var trendsU = h('div', 'trends', [trend(change(users, 7), 7, int, 'Noví uživatelé'), trend(change(users, 30), 30, int, 'Noví uživatelé')]);
    var trendsM = h('div', 'trends', [trend(change(mrr, 7), 7, kc, 'Výnos'), trend(mrr30, mrr30days, kc, 'Výnos')]);

    var conv = h('div', 'hero-block conv', [
      h('p', 'eyebrow', [icon('funnel'), 'Konverze ze zkoušky']),
      h('div', 'conv-row', [
        h('p', 'hero-num', convText),
        num(t.conversion_pct) === null ? null : ring(t.conversion_pct, { center: Math.round(t.conversion_pct) + ' %', small: true, cls: 'mint', label: 'Konverze ze zkušební doby ' + convText })
      ]),
      h('p', 'hero-sub', num(t.conversion_pct) === null ? 'Zatím nikomu neskončila zkušební doba.' : ['přešlo na Premium z ', h('b', null, int(t.ended)), ' uživatelů po konci zkoušky']),
      convBar(t)
    ]);

    return h('section', 'card dark-hero d12 m12', [
      block('users', 'users', 'Uživatelé celkem', int(u.total),
        ['aktivních za 7 dní: ', h('b', null, int(u.active_7d)), ' (' + pctText(u.active_7d, u.total) + ')'],
        [trendsU, sparkline(users.slice(-90), 'mint', 'Registrovaní uživatelé')]),
      block('mrr', 'money', 'MRR (odhad)', kc(r.mrr_czk),
        ['platících ', h('b', null, int(r.paying)), ' · ve zkušební době ' + int(r.trial)],
        [trendsM, sparkline(mrr.slice(-90), 'mint', 'Měsíční výnos')]),
      conv
    ]);
  }

  function growthCard(s, series) {
    var u = s.users || {};
    var host = h('div', 'chart-host');
    var buttons = [];
    var all = [pts(series, 'users'), pts(series, 'active_7d')];
    function draw(days) {
      var from = all[0].length ? all[0][all[0].length - 1].t - days * DAY : 0;
      host.textContent = '';
      host.appendChild(areaChart([
        { name: 'Registrovaní', cls: 'a', pts: all[0].filter(function (p) { return p.t >= from; }), fill: true },
        { name: 'Aktivní 7 dní', cls: 'b', pts: all[1].filter(function (p) { return p.t >= from; }), fill: false }
      ], int, 'Registrovaní a aktivní uživatelé'));
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days)); });
    }
    var seg = h('div', 'seg-ctl');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Období grafu');
    [30, 90].forEach(function (d) {
      var b = h('button', null, d + ' dní');
      b.type = 'button';
      b.dataset.days = String(d);
      b.addEventListener('click', function () { draw(d); });
      buttons.push(b);
      seg.appendChild(b);
    });
    var c = card({ id: 'sec-uzivatele', cls: 'd8 m12', icon: 'users', title: 'Růst uživatelů', extra: seg }, [
      h('div', 'legend', [h('span', null, [h('i', 'sw a'), 'Registrovaní']), h('span', null, [h('i', 'sw b'), 'Aktivní za 7 dní'])]),
      host,
      mini([
        ['Noví 7 dní', int(u.new_7d)],
        ['Noví 30 dní', int(u.new_30d)],
        ['Aktivní 30 dní', int(u.active_30d), pctText(u.active_30d, u.total)],
        ['S Premium', int(u.with_premium), pctText(u.with_premium, u.total)]
      ]),
      note('Aktivní = přihlášení nebo změna dat v domácnosti. Z TelemetryDeck se nebere.')
    ]);
    draw(90);
    return c;
  }

  function petsCard(s) {
    var p = s.pets || {}, dogs = p.dogs || 0, cats = p.cats || 0, total = dogs + cats;
    var body;
    if (!total) body = [empty('Zatím žádný aktivní mazlíček.', 'paw')];
    else body = [
      h('div', 'donut-wrap', [
        donut([{ value: dogs, cls: 'dogs' }, { value: cats, cls: 'cats' }], total, 'mazlíčků', 'Psi ' + dogs + ', kočky ' + cats),
        h('ul', 'legend col', [
          h('li', null, [h('i', 'sw dogs'), 'Psi ', h('b', null, int(dogs)), h('small', null, ' ' + pctText(dogs, total))]),
          h('li', null, [h('i', 'sw cats'), 'Kočky ', h('b', null, int(cats)), h('small', null, ' ' + pctText(cats, total))])
        ])
      ])
    ];
    body.push(note('Archivovaní mazlíčci: ' + int(p.archived) + '. Do grafu se nepočítají.'));
    return card({ cls: 'd4 m6', icon: 'paw', title: 'Psi a kočky' }, body);
  }

  function revenueCard(s, series) {
    var r = s.revenue || {};
    var names = { individual: 'Premium', family: 'Rodinné' }, periods = { monthly: 'měsíčně', yearly: 'ročně' };
    var mrr = pts(series, 'mrr_czk');
    /* Týdenní vzorky od konce (nejvýš 13 týdnů); při krátké historii denní sloupce. */
    var bars = [];
    if (mrr.length) {
      var lastT = mrr[mrr.length - 1].t;
      for (var k = 0; k < 13; k++) {
        var target = lastT - k * 7 * DAY, found = null;
        mrr.forEach(function (p) { if (p.t <= target) found = p; });
        if (!found) break;
        bars.unshift(found);
      }
      if (bars.length < 3) bars = mrr.slice(-14);
    }
    var chart;
    if (bars.length < 2) chart = empty('Sloupce výnosu se objeví, až bude aspoň několik denních snímků.', 'money');
    else {
      var max = Math.max.apply(null, bars.map(function (b) { return b.v; })) || 1;
      var cols = h('div', 'cols', bars.map(function (b, i) {
        var col = h('div', 'col' + (i === bars.length - 1 ? ' last' : ''));
        var fill = h('i', 'bar');
        fill.style.height = Math.max(b.v > 0 ? 3 : 0, Math.round(100 * b.v / max)) + '%';
        col.appendChild(fill);
        col.title = tText(b.t) + ': ' + kc(b.v);
        return col;
      }));
      chart = h('div', 'chart cols-chart', [cols, h('div', 'xax', [h('span', null, tText(bars[0].t)), h('span', null, tText(bars[bars.length - 1].t))])]);
      chart.setAttribute('role', 'img');
      chart.setAttribute('aria-label', 'Měsíční výnos (odhad) po týdnech od ' + tText(bars[0].t) + ' do ' + tText(bars[bars.length - 1].t) + ': z ' + kc(bars[0].v) + ' na ' + kc(bars[bars.length - 1].v));
    }
    var prods = (r.by_product || []).filter(function (p) { return !(p.plan === 'family' && !p.active && !p.trial); });
    var maxP = Math.max.apply(null, prods.map(function (p) { return p.monthly_czk || 0; }).concat([1]));
    return card({ id: 'sec-vynos', cls: 'd5 m6', icon: 'money', title: 'Výnos', note: 'odhad' }, [
      h('div', 'kpi', [h('b', null, kc(r.arr_czk)), h('span', null, 'ročně · ' + kc(r.mrr_czk) + ' měsíčně')]),
      chart,
      mini([['Platící', int(r.paying)], ['Zkušební doba', int(r.trial)], ['Neobnoví se', int(r.not_renewing)]]),
      prods.length ? hbars(prods.map(function (p) {
        return [(names[p.plan] || p.plan) + ' ' + (periods[p.period] || p.period) + ' · ' + p.price_czk + ' Kč', p.monthly_czk || 0, int(p.active) + (p.trial ? ' + ' + p.trial + ' zk.' : '')];
      }), maxP) : null,
      note('Odhad z předplatných od RevenueCat, před provizí obchodu a DPH, roční ceny přepočtené na měsíc. Bez dat z App Store Connect.')
    ]);
  }

  function trialCard(s) {
    var u = s.users || {}, t = s.trial;
    if (!t) return card({ id: 'sec-zkouska', cls: 'd7 m12', icon: 'funnel', title: 'Zkušební doba' }, [empty('Statistika zkušební doby zatím v datech není.', 'funnel')]);
    var total = u.total || 0;
    var stages = [['Registrovaní', total], ['Ve zkoušce', t.in_trial], ['Zkouška skončila', t.ended], ['Zaplatili', t.converted], ['Platí teď', t.paying_now]];
    var funnel = h('ol', 'funnel', stages.map(function (st, i) {
      var v = num(st[1]) || 0, fill = h('i', 'fill f' + i);
      fill.style.width = total ? Math.max(v > 0 ? 1.5 : 0, 100 * v / total) + '%' : '0%';
      return h('li', null, [h('span', 'name', st[0]), h('b', null, int(st[1])), h('small', null, i ? pctText(v, total) : ''), h('span', 'track', fill)]);
    }));
    funnel.setAttribute('aria-label', 'Trychtýř: ' + stages.map(function (st) { return st[0] + ' ' + int(st[1]); }).join(', '));
    var cohorts = t.cohorts || [];
    var coh = cohorts.length ? h('ul', 'cohorts', cohorts.map(function (c) {
      var sg = c.signups || 0, conv = h('i', 'conv'), tri = h('i', 'tri');
      conv.style.width = (sg ? 100 * (c.converted || 0) / sg : 0) + '%';
      tri.style.width = (sg ? 100 * (c.in_trial || 0) / sg : 0) + '%';
      return h('li', null, [
        h('span', 'name', 'od ' + dayText(c.week)),
        h('span', 'bar', [conv, tri]),
        h('b', null, int(c.converted) + ' z ' + int(sg)),
        h('small', null, c.in_trial ? int(c.in_trial) + ' ve zkoušce' : pctText(c.converted, sg))
      ]);
    })) : empty('Kohorty se objeví po prvních registracích.', 'calendar');
    return card({ id: 'sec-zkouska', cls: 'd7 m12', icon: 'funnel', title: 'Zkušební doba a konverze', note: int(t.trial_days || 30) + ' dní zdarma' }, [
      funnel,
      mini([['Zaplatili během zkoušky', int(t.in_trial_paying)], ['Po zkoušce jen ke čtení', int(t.read_only), pctText(t.read_only, t.ended)], ['Končí do 3 dní', int(t.ending_3d)]]),
      h('h3', null, 'Týdenní kohorty registrací'),
      coh,
      cohorts.length ? h('div', 'legend small', [h('span', null, [h('i', 'sw a'), 'Zaplatili']), h('span', null, [h('i', 'sw mint'), 'Ve zkoušce']), h('span', null, [h('i', 'sw rest'), 'Ostatní'])]) : null,
      note('Zkušební doba = ' + int(t.trial_days || 30) + ' dní od založení účtu (hodnotu bere ze serveru, výchozí 30), jako v aplikaci. Premium = vlastní předplatné nebo člen rodinného Premium.')
    ]);
  }

  /* Zařízení: iOS / Android, verze systému, velikost telefonu, verze aplikace. Data z admin_devices(): anonymní instalace, skupiny pod 3 už server slučuje do „other“. */
  var DEVICE_CLASSES = [['maly', 'Malý', 'šířka do 380 b, např. SE a mini'], ['bezny', 'Běžný', '380 až 427 b'], ['velky', 'Velký', 'od 428 b, Plus a Pro Max'], ['tablet', 'Tablet', 'iPad a tablety']];
  var PLATFORMS = [['ios', 'iOS', 'ios'], ['android', 'Android', 'android']];

  function appVersionOrder(key) {
    var m = /^([\d.]+) \((\d+)\)$/.exec(key);
    if (!m) return [0];
    return m[1].split('.').map(Number).concat([Number(m[2])]);
  }
  function compareDesc(a, b) {
    for (var i = 0; i < Math.max(a.length, b.length); i++) { var d = (b[i] || 0) - (a[i] || 0); if (d) return d; }
    return 0;
  }

  function devicesCard(s) {
    var d = s.devices, id = 'sec-zarizeni';
    if (!d || !d.total) {
      return card({ id: id, cls: 'd12 m12', icon: 'phone', title: 'Zařízení' }, [
        empty('Zatím žádná data. Aplikace hlásí anonymní záznam instalace jednou denně, přehled se naplní s prvním buildem, který to umí.', 'phone'),
        note('Android aplikace zatím není.')
      ]);
    }
    var mode = 'active', host = h('div', 'devs'), buttons = [];
    var rows = function (k) { return Array.isArray(d[k]) ? d[k] : []; };
    var count = function (r) { return num(mode === 'active' ? r.active : r.total) || 0; };
    var other = 'Ostatní (méně než 3 zařízení)';

    function column(title, body) { return h('div', 'dev', [h('h3', null, title)].concat(body)); }

    function platformCol() {
      var parts = PLATFORMS.map(function (p) {
        var r = rows('platform').filter(function (x) { return x.key === p[0]; })[0];
        return { key: p[0], name: p[1], cls: p[2], value: r ? count(r) : 0 };
      });
      var rest = rows('platform').filter(function (x) { return x.key === 'other'; })[0];
      var restN = rest ? count(rest) : 0;
      var total = parts.reduce(function (a, b) { return a + b.value; }, restN);
      var body = [];
      if (!total) body.push(empty('Za posledních 30 dní se nikdo nehlásil.', 'phone'));
      else {
        var segs = parts.map(function (p) { return { value: p.value, cls: p.cls }; });
        if (restN) segs.push({ value: restN, cls: 'mint' });
        var items = parts.map(function (p) {
          return h('li', null, [h('i', 'sw ' + p.cls), p.name + ' ', h('b', null, int(p.value)), h('small', null, ' ' + pctText(p.value, total))]);
        });
        if (restN) items.push(h('li', null, [h('i', 'sw mint'), 'Ostatní ', h('b', null, int(restN))]));
        body.push(h('div', 'donut-wrap', [
          donut(segs, total, mode === 'active' ? 'aktivních' : 'instalací', 'iOS ' + parts[0].value + ', Android ' + parts[1].value + (restN ? ', ostatní ' + restN : '')),
          h('ul', 'legend col', items)
        ]));
      }
      if (!parts[1].value) body.push(note('Android aplikace zatím není.'));
      return column('Platforma', body);
    }

    function osCol() {
      var list = rows('os').map(function (r) {
        var m = /^(ios|android):(\d+)$/.exec(r.key);
        return { r: r, platform: m ? m[1] : null, v: m ? Number(m[2]) : 0, n: count(r) };
      }).filter(function (x) { return x.n > 0; });
      var named = list.filter(function (x) { return x.platform; }).sort(function (a, b) {
        return a.platform === b.platform ? b.v - a.v : a.platform === 'ios' ? -1 : 1;
      });
      var rest = list.filter(function (x) { return !x.platform; });
      var out = named.map(function (x) { return [(x.platform === 'ios' ? 'iOS ' : 'Android ') + x.v, x.n]; })
        .concat(rest.map(function (x) { return [other, x.n]; }));
      var max = Math.max.apply(null, out.map(function (r) { return r[1]; }).concat([1]));
      return column('Verze systému', [out.length ? hbars(out, max) : empty('Zatím žádná data.', 'phone')]);
    }

    function classCol() {
      var byKey = {};
      rows('device_class').forEach(function (r) { byKey[r.key] = count(r); });
      var out = DEVICE_CLASSES.map(function (c) { return [c[1] + ' · ' + c[2], byKey[c[0]] || 0]; });
      if (byKey.other) out.push([other, byKey.other]);
      var max = Math.max.apply(null, out.map(function (r) { return r[1]; }).concat([1]));
      return column('Velikost telefonu', [hbars(out, max), note('Podle šířky displeje v bodech. Malé telefony (SE) mají vlastní odložený lístek #18.')]);
    }

    function versionCol() {
      var list = rows('app_version').map(function (r) { return { key: r.key, n: count(r) }; }).filter(function (x) { return x.n > 0; });
      var named = list.filter(function (x) { return x.key !== 'other'; }).sort(function (a, b) { return compareDesc(appVersionOrder(a.key), appVersionOrder(b.key)); });
      var rest = list.filter(function (x) { return x.key === 'other'; });
      var all = named.concat(rest), total = all.reduce(function (a, b) { return a + b.n; }, 0);
      if (!total) return column('Verze aplikace', [empty('Zatím žádná data.', 'phone')]);
      var max = Math.max.apply(null, all.map(function (x) { return x.n; }).concat([1]));
      var bars = hbars(all.map(function (x) { return [x.key === 'other' ? other : x.key, x.n]; }), max);
      for (var i = 1; i < bars.children.length; i++) bars.children[i].querySelector('.fill').classList.add('old');
      var latest = named[0] ? named[0].n : 0;
      return column('Verze aplikace', [
        mini([['Na nejnovější', int(latest), pctText(latest, total)], ['Na starším buildu', int(total - latest), pctText(total - latest, total)]], true),
        bars,
        note(named[0] ? 'Nejnovější build v datech: ' + named[0].key + '. Starší buildy jsou žlutě.' : 'Starší buildy jsou žlutě.')
      ]);
    }

    function draw(m) {
      mode = m;
      host.textContent = '';
      [platformCol(), osCol(), classCol(), versionCol()].forEach(function (c) { host.appendChild(c); });
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === m)); });
    }
    var seg = h('div', 'seg-ctl');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Které instalace počítat');
    [['active', 'Aktivní 30 dní'], ['total', 'Všechny']].forEach(function (o) {
      var b = h('button', null, o[1]);
      b.type = 'button';
      b.dataset.mode = o[0];
      b.addEventListener('click', function () { draw(o[0]); });
      buttons.push(b);
      seg.appendChild(b);
    });
    var c = card({ id: id, cls: 'd12 m12', icon: 'phone', title: 'Zařízení', extra: seg }, [
      note('Instalací celkem ' + int(d.total) + ', za posledních 30 dní se hlásilo ' + int(d.active_30d) + '.'),
      host,
      note('Anonymní instalace, bez vazby na uživatele; aplikace se hlásí jednou denně a jen s zapnutými anonymními statistikami. Skupiny pod 3 instalace jsou sloučené do „Ostatní“.')
    ]);
    draw('active');
    return c;
  }

  function capacityCard(s, series) {
    var c = s.capacity || {}, db = c.database || {}, st = c.storage || {};
    function part(name, o, field) {
      var warn = !!o.warn, p = num(o.percent);
      return h('div', 'cap', [
        ring(p, { center: p === null ? '–' : nf1.format(p) + ' %', tick: true, cls: warn ? 'warn' : '', label: name + ': ' + (p === null ? 'neznámo' : nf1.format(p) + ' % limitu, ' + bytes(o.bytes) + ' z ' + bytes(o.limit_bytes)) + ', značka 80 %' }),
        h('div', 'cap-t', [
          h('h3', null, name),
          h('p', 'cap-v', [h('b', null, bytes(o.bytes)), ' z ' + bytes(o.limit_bytes)]),
          warn ? h('span', 'flag', 'Nad 80 % limitu tarifu') : null,
          note(fullIn(series, field, o.bytes, o.limit_bytes)),
          sparkline(pts(series, field).slice(-90), warn ? 'warn' : 'accent', 'Vývoj: ' + name)
        ])
      ]);
    }
    var buckets = st.buckets || [], maxB = Math.max.apply(null, buckets.map(function (b) { return b.bytes || 0; }).concat([1]));
    return card({ id: 'sec-kapacita', cls: 'd12 m12', icon: 'db', title: 'Kapacita', note: 'značka = 80 % limitu' }, [
      h('div', 'caps', [part('Databáze', db, 'db_bytes'), part('Úložiště souborů', st, 'storage_bytes'),
        h('div', 'cap-files', [h('h3', null, 'Soubory podle složek'), buckets.length ? hbars(buckets.map(function (b) { return [b.bucket + ' · ' + int(b.files) + ' souborů', b.bytes || 0, bytes(b.bytes)]; }), maxB) : note('Úložiště je zatím prázdné.')])]),
      note('Limity tarifu Free: databáze 500 MB, úložiště 1 GB. Přenos dat (egress) tu zatím není, je jen v administraci Supabase.')
    ]);
  }

  function externalCard(ext) {
    ext = ext || {};
    var CHIP = { unconfigured: 'Nenastaveno', unavailable: 'Nedostupné' };
    function fmt(v, suffix) { return v === null || v === undefined || !isFinite(v) ? '–' : nf1.format(v) + (suffix || ''); }
    function svc(name, d, rows, hint) {
      var ok = d && d.status === 'ok', st = (d && d.status) || 'unconfigured';
      return h('div', 'svc', [
        h('h3', null, name),
        ok ? mini(rows(d), true) : h('span', 'flag', CHIP[st] || CHIP.unconfigured),
        hint ? note(hint) : null
      ]);
    }
    function usageRows(u) { u = u || {}; return [['Volání', fmt(u.call_count, ' %')], ['Procesor', fmt(u.total_cputime, ' %')], ['Čas', fmt(u.total_time, ' %')]]; }
    var apple = ext.apple, rc = ext.revenuecat, sb = ext.supabase, fb = ext.facebook;
    return card({ id: 'sec-externi', cls: 'd12 m12', icon: 'chart', title: 'Externí služby', note: 'limity a stav z jiných služeb' }, [
      h('div', 'ext', [
        svc('Facebook (Meta)' + (fb && fb.name ? ' · ' + fb.name : ''), fb, function (d) { return usageRows(d.usage); }, 'Využití limitu aplikace; jen přihlášení, proto blízko nuly. Required actions a App Review jsou jen v konzoli Meta.'),
        svc('App Store Connect', apple, function (d) { return [['Stažení, 7 dní', int(d.downloads)], ['Jednotky, 7 dní', int(d.units)]]; }, 'Data o 1–2 dny zpožděná, malé počty Apple skrývá.' + (apple && apple.missing ? ' Dny bez dat: ' + apple.missing + '.' : '')),
        svc('RevenueCat', rc, function (d) {
          return (d.metrics || []).map(function (m) { return [m.name, fmt(m.value), m.unit]; });
        }),
        svc('Supabase', sb, function (d) { return [['REST', int(d.rest)], ['Auth', int(d.auth)], ['Úložiště', int(d.storage)], ['Realtime', int(d.realtime)]]; }, 'Počty požadavků za 7 dní. Přenos (egress) je jen v administraci Supabase.'),
        svc('Google Cloud', ext.google, function () { return []; }, 'Zatím nepřipojeno (kvóta Places, přihlášení Google).'),
        svc('TelemetryDeck', ext.telemetrydeck, function () { return []; }, 'Zatím nepřipojeno (počty událostí v aplikaci).')
      ])
    ]);
  }

  function breedsCard(s) {
    var p = s.pets || {}, top = p.breeds_top || [];
    var list = top.map(function (b) { return [b.breed, b.count]; });
    if (p.breeds_other) list.push(['Ostatní (méně než 3 stejného plemene)', p.breeds_other]);
    var max = Math.max.apply(null, list.map(function (b) { return b[1]; }).concat([1]));
    return card({ cls: 'd5 m6', icon: 'paw', title: 'Nejčastější plemena', note: 'jen agregáty' }, [
      list.length ? hbars(list, max) : empty('Zatím žádné plemeno se třemi a víc mazlíčky.', 'paw'),
      note('Neuvedené plemeno: ' + int(p.breed_unknown) + '. Plemena s méně než 3 mazlíčky se slučují, aby nešlo nikoho poznat.')
    ]);
  }

  function householdsCard(s) {
    var p = s.pets || {}, hh = s.households || {}, total = p.total || 0;
    function share(label, v) {
      var pc = pct(v || 0, total);
      return h('div', 'share', [
        ring(pc || 0, { center: pc === null ? '–' : pc + ' %', small: true, label: label + ': ' + pctText(v || 0, total) + ' (' + int(v || 0) + ' z ' + int(total) + ')' }),
        h('span', null, label),
        h('small', null, int(v || 0) + ' z ' + int(total))
      ]);
    }
    return card({ id: 'sec-data', cls: 'd5 m6', icon: 'heart', title: 'Domácnosti a mazlíčci' }, [
      mini([
        ['Domácnosti', int(hh.total)],
        ['Členů na domácnost', num(hh.avg_members) === null ? '–' : nf2.format(hh.avg_members)],
        ['Mazlíčci', int(p.total)],
        ['Mazlíčků na domácnost', num(p.avg_per_household) === null ? '–' : nf2.format(p.avg_per_household)]
      ], true),
      total ? h('div', 'shares', [share('S čipem', p.with_chip), share('S veterinářem', p.with_vet), share('Platné očkování proti vzteklině', p.rabies_valid)]) : empty('Podíly se spočítají po prvním mazlíčkovi.', 'paw')
    ]);
  }

  function recordsCard(s) {
    var rec = s.records || {};
    var labels = { medications: 'Léky', preventions: 'Prevence', weights: 'Váhy', expenses: 'Výdaje', health_issues: 'Potíže', documents: 'Dokumenty', diary_notes: 'Deník', vaccinations: 'Očkování' };
    var list = Object.keys(labels).map(function (k) { return [labels[k], num(rec[k]) || 0]; }).sort(function (a, b) { return b[1] - a[1]; });
    var sum = list.reduce(function (a, b) { return a + b[1]; }, 0);
    return card({ cls: 'd7 m6', icon: 'list', title: 'Záznamy v aplikaci', note: int(sum) + ' celkem' }, [
      sum ? hbars(list, list[0][1]) : empty('Zatím nikdo nezapsal žádný záznam.', 'list')
    ]);
  }

  /* Stavová tečka: level ok | warn | bad | off (text pro čtečky je součástí). */
  function srow(level, label, detail) {
    var words = { ok: 'v pořádku', warn: 'pozor', bad: 'chyba', off: 'bez údaje' };
    return h('li', 'srow', [h('i', 'sdot ' + level), h('span', 'sr-only', words[level] + ': '), h('span', 'name', label), h('span', 'detail', detail)]);
  }
  function stateCard(s, ms) {
    var st = s.state || {}, rank = { ok: 0, off: 0, warn: 1, bad: 2 };
    var server = new Date(st.server_time), rows = [];
    rows.push(ms === null ? srow('off', 'Server a databáze', 'ukázková data') : srow('ok', 'Server a databáze', 'odpovídá · ' + ms + ' ms'));
    var cron = st.cron || [];
    if (!cron.length) rows.push(srow('warn', 'Plánované úlohy', 'žádný záznam o běhu'));
    cron.forEach(function (j) {
      var last = new Date(j.last_run), stale = !isNaN(last) && !isNaN(server) && server - last > 36 * 3600000;
      if (j.status !== 'succeeded') rows.push(srow(j.status ? 'bad' : 'warn', j.job, j.status || 'neběželo'));
      else rows.push(srow(stale ? 'warn' : 'ok', j.job, (stale ? 'naposledy ' : 'OK ') + dateTime(j.last_run)));
    });
    var q = num(st.storage_purge_queue), tr = num(st.trash_rows);
    rows.push(srow(q === null ? 'off' : q > 100 ? 'warn' : 'ok', 'Fronta mazání souborů', q === null ? '–' : q ? int(q) + ' souborů čeká' : 'prázdná'));
    rows.push(srow(tr === null ? 'off' : tr > 5000 ? 'warn' : 'ok', 'Koš', tr === null ? '–' : int(tr) + ' řádků'));
    var worst = 0;
    rows.forEach(function (r) { worst = Math.max(worst, rank[r.querySelector('.sdot').className.split(' ')[1]]); });
    var verdict = worst === 2 ? ['bad', 'Chyba'] : worst === 1 ? ['warn', 'Pozor'] : ['ok', 'Vše v pořádku'];
    return card({ id: 'sec-stav', cls: 'd7 m6', icon: 'pulse', title: 'Stav systému', extra: h('span', 'verdict ' + verdict[0], verdict[1]) }, [
      h('ul', 'states', rows),
      note('Čas serveru: ' + dateTime(st.server_time) + '. Build v TestFlight a App Store se sem nenačítá.')
    ]);
  }

  function supportCard() {
    var a = h('a', 'btn-soft', [h('span', null, 'podpora@mojichlupaci.cz'), icon('mail')]);
    a.href = 'mailto:podpora@mojichlupaci.cz';
    return card({ id: 'sec-podpora', cls: 'd12 m12 slim', icon: 'mail', title: 'Podpora' }, [
      note('Zprávy chodí na podpůrný e-mail do iCloudu. Čtení přímo tady přibude později.'),
      a
    ]);
  }

  /* ---------- Správnost dat (#1076) ----------
     Server vrací jen počty a stavy (`integrity`: { checks, history } nebo null, dokud migrace není nasazená). Názvy a rady „Jak opravit“ jsou tady podle id kontroly;
     neznámé id (server je novější než stránka) se ukáže pod svým id bez rady. Žádná data ze serveru se nevkládají jinak než přes textContent. */
  var IG_GROUPS = [
    ['domacnosti', 'Domácnosti a členství', 'users'],
    ['soubory', 'Soubory a úložiště', 'db'],
    ['vazby', 'Vazby mezi záznamy', 'list'],
    ['pristup', 'Předplatné a přístup', 'shield']
  ];
  var IG = {
    hh_bez_clenu: ['Domácnost bez členů',
      'Vznikne, když se účet smaže mimo aplikaci (například v dashboardu Supabase) a domácnost po něm zůstane.',
      'Nikoho neohrožuje: nikdo se k ní nedostane, jen zabírá místo.',
      'Smazat prázdnou domácnost. Od migrace no_empty_household to server dělá sám při každém dalším smazání člena; kontrola tu zůstává jako pojistka.'],
    hh_bez_vlastnika: ['Domácnost bez právě jednoho vlastníka',
      'Vlastník zmizel (smazaný účet mimo aplikaci) nebo vznikli dva vlastníci.',
      'Členové domácnosti ji nemohou spravovat (zvát, odebírat členy), data jim ale zůstávají.',
      'Určit nového vlastníka u nejstaršího člena. Od migrace no_empty_household to server dělá sám; zbylé případy opravit ručně v databázi.'],
    uziv_vice_hh: ['Uživatel ve více domácnostech',
      'Aplikace i server počítají s jednou domácností na člověka; dvě vzniknou jen obejitím pravidel nebo chybou při přijetí pozvánky.',
      'Může vidět data obou domácností. Pro ostatní členy to riziko není větší než běžné členství.',
      'Rozhodnout, ve které domácnosti uživatel zůstane, z ostatních ho odebrat a doplnit jedinečnost (postup v docs/postupy.md, Zpevnění serveru, bod 9).'],
    hh_nad_5: ['Domácnost nad 5 členů',
      'Limit 5 členů hlídají pozvánky; víc členů vznikne jen ruční úpravou databáze.',
      'Nikoho neohrožuje, jen se rozcházejí pravidla s tím, co slibuje aplikace.',
      'Odebrat nadbytečné členy nebo limit vědomě změnit.'],
    ucty_bez_clenstvi: ['Účet bez domácnosti',
      'Nový účet nemá domácnost, dokud se aplikace poprvé neotevře; stejně tak účet správce nebo účet po smazané domácnosti.',
      'Nikoho neohrožuje. Je to jen informace, nepočítá se mezi chyby.',
      'Nic, pokud číslo zůstává malé. Trvale rostoucí číslo znamená, že se lidé registrují, ale aplikaci neotevřou.'],
    bkp_soubory: ['Staré zálohy z testovací doby',
      'Do složky záloh se od 2. 11. 2026 nic nezapisuje; zůstaly soubory z doby, kdy se zálohovalo na server.',
      'Soubory může číst jejich autor i po odchodu z domácnosti, proto je dobré je uklidit.',
      'Smazat soubory ručně podle docs/postupy.md (Zpevnění serveru, bod 10) a ověřit, že číslo spadne na 0.'],
    hh_sirotci: ['Soubory domácností, které už neexistují',
      'Domácnost se smazala, ale její soubory nejsou ve frontě mazání (úklid selhal nebo se přeskočil).',
      'Nikoho neohrožuje, soubory ale zbytečně zabírají místo a patřily lidem, kteří o ně přišli.',
      'Zařadit soubory do fronty mazání nebo je smazat ručně; příčinu hledat v noční úloze storage-purge.'],
    radek_bez_souboru: ['Záznam ukazuje na soubor, který chybí',
      'Fotka nebo příloha se nenahrála (telefon byl bez sítě déle než den) nebo se soubor smazal bez záznamu.',
      'Nikoho neohrožuje. Uživatel v aplikaci uvidí prázdné místo místo fotky.',
      'Počkat na další synchronizaci telefonu. Když číslo neklesá, dohledat řádek dotazem v databázi a fotku vyřadit.'],
    soubor_bez_radku: ['Soubor bez záznamu (starší než 7 dní)',
      'Fotka se nahradila novou, ale stará zůstala, nebo se řádek smazal a soubor zůstal.',
      'Nikoho neohrožuje, jen zabírá místo a počítá se do limitu domácnosti.',
      'Smazat zbylé soubory ručně (nejdřív ověřit dotazem, že k nim opravdu není záznam). Opakuje-li se to, hledat příčinu v aplikaci.'],
    fronta_stara: ['Fronta úklidu čeká déle než 24 hodin',
      'Noční úloha storage-purge nedoběhla nebo soubor nejde smazat.',
      'Nikoho neohrožuje; smazané soubory ale zůstávají déle, než mají.',
      'Zkontrolovat poslední běh úlohy storage-purge a funkci storage-purge v dashboardu; po opravě se fronta vyprázdní sama.'],
    nad_kvotou: ['Domácnost výrazně nad limitem 300 MB',
      'Soubory domácnosti přesáhly 360 MB. Limit 300 MB se kontroluje před nahráním, takže domácnost smí přerůst o jeden soubor (největší je video 60 MB); hlásí se až skutečné překročení.',
      'Nikoho neohrožuje. Domácnost nové soubory nenahraje, dokud nějaké nesmaže.',
      'Nic, nebo domácnosti pomoci s úklidem. Opakuje-li se to u víc domácností, rozhodnout o změně limitu.'],
    nazvy_mimo_vzor: ['Název souboru v neočekávaném tvaru',
      'Starší záznam má cestu souboru, která nesedí na dnešní pravidlo (omezení platí jen pro nové záznamy).',
      'Cizí nebo upravená cesta by mohla ukazovat mimo domácnost, proto je to chyba, ne varování.',
      'Opravit nebo smazat záznam, pak potvrdit omezení (docs/postupy.md, Zpevnění serveru, body 7 a 8).'],
    cizi_rodic: ['Záznam navázaný na data jiné domácnosti',
      'Záznam (například očkování) ukazuje na mazlíčka z jiné domácnosti. Server to běžně odmítne, vznikne jen obejitím pravidel.',
      'Ano: mohl by odhalit nebo propojit data dvou domácností.',
      'Záznam smazat nebo přesunout, dohledat, jak vznikl (docs/analyzy), a před dalším nasazením ověřit hlídací pravidla.'],
    zivy_pod_smazanym: ['Živý záznam pod smazaným mazlíčkem',
      'Smazání mazlíčka smaže i jeho záznamy; živý záznam vznikne pozdním zápisem ze starého zařízení nebo vrácením jednoho záznamu z Koše.',
      'Nikoho neohrožuje. Záznam není nikde vidět, protože mazlíček je v Koši.',
      'Smazat záznam, nebo mazlíčka vrátit z Koše, pokud o něj uživatel stojí.'],
    kos_stary: ['Koš starší než 32 dní',
      'Koš se vysype po 30 dnech nočním úklidem; starší řádek znamená, že úklid některou tabulku přeskočil.',
      'Uživatelům jejich smazaná data zůstávají déle, než slibují zásady ochrany údajů.',
      'Zkontrolovat poslední běh úlohy purge-trash a varování v logu databáze, opravit příčinu a úklid spustit znovu.'],
    pozvanky_prosle: ['Prošlé pozvánky neuklizené',
      'Pozvánky maže až další vytvoření pozvánky, takže prošlá pozvánka běžně chvíli leží.',
      'Nikoho neohrožuje, kód je po vypršení nepoužitelný. Je to jen informace.',
      'Nic. Uklidí se při dalším zvaní.'],
    karty_prosle: ['Prošlé odkazy na kartu neuklizené',
      'Hodinová úloha card-share-cleanup maže prošlé odkazy; leží-li déle než pár hodin, úloha nedoběhla.',
      'Prošlý odkaz už nic neotevře, ale jeho snímek dat zbytečně leží v databázi.',
      'Zkontrolovat poslední běh úlohy card-share-cleanup.'],
    pes_nad_50_dok: ['Mazlíček nad 50 dokumentů',
      'Limit 50 dokumentů platí jen pro nově přidané; starší mazlíčci ho mohli mít překročený.',
      'Nikoho neohrožuje, jen zabírá místo.',
      'Nic: nic se nemaže. Další dokument ale uživatel nepřidá, dokud některý nesmaže.'],
    predplatne_bez_uctu: ['Chybí pojistka mazání předplatného s účtem',
      'Číslo je počet chybějících cizích klíčů s mazáním spolu s účtem (předplatné a členství v domácnosti). Bez nich by po smazání účtu zůstalo předplatné nebo členství bez účtu.',
      'Nikoho přímo neohrožuje, ale po smazání účtu by zůstala data bez majitele a platící člověk by mohl o Premium přijít.',
      'Obnovit cizí klíč (references auth.users on delete cascade) v migraci a ověřit kontrolou; příčinu hledat v nedávné změně schématu.'],
    predplatne_prosle: ['Aktivní předplatné s prošlým datem',
      'Konec ostrého předplatného uplynul před víc než třemi dny a stav se nezměnil na „vypršelo“ (chybějící zpráva z RevenueCat).',
      'Uživatel může mít Premium zdarma, nebo naopak o něj přijít, když se stav opraví zpětně.',
      'Zkontrolovat zprávy RevenueCat v logu funkce revenuecat-webhook a stav předplatného v RevenueCat.'],
    tabulky_bez_rls: ['Tabulka bez pravidel přístupu',
      'Nová tabulka vznikla bez zapnutých pravidel přístupu k řádkům.',
      'Ano, vážné: kdo má přístup k rozhraní databáze, může číst a měnit celou tabulku.',
      'Okamžitě zapnout pravidla (alter table … enable row level security) a doplnit politiky.'],
    anon_funkce: ['Funkce volatelná bez přihlášení navíc',
      'Nová funkce dostala výchozí právo pro nepřihlášené.',
      'Ano: kdokoli bez účtu ji může zavolat. Závažnost závisí na tom, co funkce dělá.',
      'Odebrat právo (revoke execute … from public, anon) a v migraci udělat totéž natrvalo.'],
    verejny_bucket: ['Veřejné úložiště',
      'Složka úložiště je nastavená jako veřejná (soubory jde otevřít bez přihlášení).',
      'Ano: fotky a dokumenty by byly dostupné komukoli, kdo zná adresu.',
      'Přepnout složku na soukromou v dashboardu Supabase (Storage).'],
    siroka_politika: ['Příliš široké pravidlo přístupu',
      'Pravidlo přístupu povoluje vše („true“) nebo je určené pro nepřihlášené.',
      'Ano: data by mohl číst nebo měnit kdokoli.',
      'Pravidlo opravit nebo smazat a ověřit zkouškou izolace (rls_isolation_test.sql).'],
    cron_ulohy: ['Noční úlohy: poslední běh v pořádku',
      'Některá plánovaná úloha (úklid Koše, souborů, pozvánek, snímek přehledu) naposledy selhala.',
      'Nikoho přímo neohrožuje, ale úklid neběží, takže se hromadí data.',
      'V dashboardu Supabase (Integrations, Cron) otevřít úlohu, přečíst chybu posledního běhu a opravit příčinu.']
  };

  function plural(n, one, few, many) { return n === 1 ? one : n >= 2 && n <= 4 ? few : many; }
  function dayShort(iso) { var d = new Date(iso + 'T00:00:00'); return isNaN(d) ? '' : d.getDate() + '. ' + (d.getMonth() + 1) + '.'; }
  function isoDay(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function showVal(v) { return typeof v === 'string' ? v : num(v) === null ? '–' : int(v); }

  /* Souhrn: počítá se jen chyba a varování; informace a „bez údaje“ (ok null) se do celku nepočítají. */
  function igSummary(checks) {
    var s = { total: 0, ok: 0, bad: 0, warn: 0 };
    checks.forEach(function (c) {
      if (c.level === 'informace' || c.ok === null) return;
      s.total++;
      if (c.ok) s.ok++;
      else if (c.level === 'chyba') s.bad++;
      else s.warn++;
    });
    s.level = s.bad ? 'bad' : s.warn ? 'warn' : 'ok';
    return s;
  }

  function igRow(c, since) {
    var info = c.level === 'informace', failed = c.ok === false;
    var state = c.ok === null ? 'off' : info ? 'off' : failed ? (c.level === 'chyba' ? 'bad' : 'warn') : 'ok';
    var def = IG[c.id], name = def ? def[0] : c.id;
    var words = { ok: 'v pořádku', warn: 'varování', bad: 'chyba', off: info ? 'informace' : 'bez údaje' };
    var detail = null;
    if (c.ok === null) detail = 'nelze zjistit';
    else if (failed && !info) detail = 'selhává od ' + (since ? dayShort(since) : 'dnes') + ' · má být ' + showVal(c.expected);
    else if (info) detail = 'informace, nehlásí se';
    var li = h('li', 'srow irow ' + state, [
      h('i', 'sdot ' + (state === 'off' ? '' : state) + (info ? ' info' : '')),
      h('span', 'sr-only', words[state] + ': '),
      h('span', 'name', [name, detail ? h('small', 'idetail', detail) : null]),
      h('span', 'detail ival', showVal(c.value))
    ]);
    if (def && ((failed && c.ok === false) || (info && num(c.value) > 0))) {
      li.appendChild(h('details', 'how', [
        h('summary', null, 'Jak opravit'),
        h('dl', null, [
          h('dt', null, 'Proč vzniká'), h('dd', null, def[1]),
          h('dt', null, 'Ohrožuje někoho?'), h('dd', null, def[2]),
          h('dt', null, 'Co s tím'), h('dd', null, def[3])
        ])
      ]));
    }
    return li;
  }

  function igStrip(history, summary) {
    var byDay = {}, now = new Date(), i, cells = [];
    (history.days || []).forEach(function (d) { byDay[d.day] = d; });
    var bad = 0, warn = 0, none = 0;
    for (i = 29; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i), key = isoDay(d), r = byDay[key];
      var cls = !r ? 'n' : r.failed > 0 ? 'b' : r.warned > 0 ? 'w' : 'g';
      if (cls === 'b') bad++; else if (cls === 'w') warn++; else if (cls === 'n') none++;
      cells.push(h('i', cls));
    }
    var el = h('div', 'istrip', cells);
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Posledních 30 dní: ' + bad + ' ' + plural(bad, 'den s chybou', 'dny s chybou', 'dní s chybou') + ', ' + warn + ' ' +
      plural(warn, 'den s varováním', 'dny s varováním', 'dní s varováním') + ', ' + none + ' ' + plural(none, 'den bez záznamu', 'dny bez záznamu', 'dní bez záznamu') + '.');
    return el;
  }

  /* Kdy byl stav pořízen: noční snímek („stav z noci 4:23“) nebo živý výpočet („právě teď“). */
  function takenText(ig) {
    if (ig.source === 'live') return 'Spočítáno právě teď.';
    if (!ig.taken_at) return 'Server kontroluje každou noc.';
    var d = new Date(ig.taken_at), n = new Date();
    if (isNaN(d)) return 'Server kontroluje každou noc.';
    return d.toDateString() === n.toDateString() ? 'Stav z noci ' + timeText(ig.taken_at) + '.' : 'Stav z ' + d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + timeText(ig.taken_at) + '.';
  }

  function integrityCards(ig) {
    if (!ig || !Array.isArray(ig.checks) || !ig.checks.length) {
      return [card({ id: 'sec-spravnost', cls: 'd12 m12 slim', icon: 'shield', title: 'Správnost dat' }, [
        note('Kontrola správnosti dat ještě není na serveru zapnutá.')
      ])];
    }
    var checks = ig.checks, hist = ig.history || { days: [], failing: [] }, s = igSummary(checks), since = {};
    (hist.failing || []).forEach(function (f) { since[f.id] = f.since; });
    var verdict = s.bad || s.warn
      ? [s.bad ? s.bad + ' ' + plural(s.bad, 'chyba', 'chyby', 'chyb') : null, s.warn ? s.warn + ' ' + plural(s.warn, 'varování', 'varování', 'varování') : null].filter(Boolean).join(' · ')
      : 'Vše v pořádku';
    var sentence = s.bad ? 'Aspoň jedna chyba čeká na opravu.' : s.warn ? 'Jen varování, nic nepospíchá.' : 'Všechno sedí, není co opravovat.';
    var btn = h('button', 'btn-dark', [h('span', null, 'Zkontrolovat teď'), h('span', 'nest', icon('refresh'))]);
    btn.type = 'button';
    btn.addEventListener('click', function () { checkNow(btn); });
    var main = card({ id: 'sec-spravnost', cls: 'd4 m12', icon: 'shield', title: 'Správnost dat' }, [
      h('p', 'igbig', [h('b', null, String(s.ok)), h('small', null, ' z ' + s.total + ' ' + plural(s.total, 'kontroly', 'kontrol', 'kontrol') + ' v pořádku')]),
      h('span', 'verdict ' + s.level, verdict),
      note(sentence),
      h('p', 'sub', ['Naposledy vše v pořádku: ', h('strong', null, hist.last_all_ok ? dayShort(hist.last_all_ok) : 'zatím není záznam')]),
      igStrip(hist, s),
      h('div', 'istrip-l', [h('span', null, 'před 30 dny'), h('span', null, 'dnes')]),
      btn,
      note(takenText(ig) + ' Do přehledu jdou jen počty, žádná data uživatelů.')
    ]);
    var cards = [main];
    IG_GROUPS.forEach(function (g) {
      var rows = checks.filter(function (c) { return c.group === g[0]; }).map(function (c) { return igRow(c, since[c.id]); });
      cards.push(card({ cls: (g[0] === 'vazby' || g[0] === 'pristup' ? 'd6' : 'd4') + ' m6', icon: g[2], title: g[1] }, [h('ul', 'states', rows)]));
    });
    return cards;
  }

  function igNav(ig) {
    var s = ig && Array.isArray(ig.checks) && ig.checks.length ? igSummary(ig.checks) : null;
    setDot('spravnost', s && s.level !== 'ok' ? s.level : null, !s ? 'kontrola není zapnutá' : s.level === 'bad' ? 'chyba' : s.level === 'warn' ? 'varování' : 'vše v pořádku');
  }

  /* ---------- Rozšíření přehledu (#1076): Od včera, Hlášení, Zdraví aplikace, Cesta uživatele, Platby, Bezpečnost, Připravenost ----------
     Server vrací jen počty a anonymní údaje (Edge Function každou část ořízne na povolené klíče); část, která na serveru ještě není, je null a panel to řekne větou.
     Jediná výjimka jsou texty hlášení od lidí (bez vazby na účet): vždy přes textContent. Dva zápisy: Vyřízeno u hlášení a bod seznamu před vydáním (POST s malým tělem). */
  var NO_DATA = 'Zatím bez dat: část přibude po nasazení migrace 20270108 a funkce admin-stats.';
  var HOURS = 3600000;

  /* Skutečnost proti forecastu: střední scénář, iOS Česko, aktivní předplatné na konci měsíce 1 až 12 po vydání. Zdroj: docs/analyzy/ziskovost-forecast-2026-11-20.html
     (zmrazeno 20. 11. 2026; hodnoty spočítané z modelu tamtéž: dosah 1,5 %, konverze 3,5 %, 70 % ročních plánů, měsíční předplatitel vydrží 7 měsíců). Datum vydání zatím není:
     do vyplnění `launch` (RRRR-MM-DD) se ukazuje „před vydáním“. */
  var FORECAST = { date: '2026-11-20', launch: null, active: [0, 43, 71, 97, 122, 147, 170, 194, 217, 239, 262, 284] };

  var CHECKLIST = [
    ['paid_apps', 'Smlouva Paid Apps, banka a daně'], ['dsa', 'Stav obchodníka a adresa (DSA)'], ['prices', 'Ceny 69 a 499 Kč a rodinné produkty z prodeje'],
    ['rc_annual', 'RevenueCat: Annual na premium.yearly2'], ['review_demo', 'Demo účet pro recenzenta'], ['lawyer', 'Právník přečetl podmínky a zásady'],
    ['shots_69', 'Snímky 6,9″ z iPhonu'], ['backup_test', 'Zkouška zálohy a obnovy na iPhonu'], ['sandbox_buy', 'Zkouška nákupu v sandboxu'],
    ['web_prs', 'Webové změny sloučeny (pull requesty)'], ['supabase_plan', 'Supabase placený tarif a zálohy'], ['small_business', 'Apple Small Business Program']
  ];
  var HEALTH_COLS = [['sync_auth', 'Sync: přihlášení'], ['sync_server', 'Sync: server'], ['sync_rows', 'Sync: řádky'], ['signin', 'Přihlášení'], ['purchase', 'Nákup'],
    ['upload', 'Soubor'], ['backup', 'Záloha'], ['restore', 'Obnova'], ['crash', 'Pád']];
  var DEMO_SHOT = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABsSFBcUERsXFhceHBsgKEIrKCUlKFE6PTBCYFVlZF9VXVtqeJmBanGQc1tdhbWGkJ6jq62rZ4C8ybqmx5moq6T/2wBDARweHigjKE4rK06kbl1upKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKT/wAARCAC0AFoDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCnRS0VqcYlFLRQAlFLRQAlFLRQAlFLRQAlFLRQAVpWek/abZJvP27s8bM98etZ1dJpH/INi/H+ZpN2NIJN6lL+wf8Ap5/8c/8Ar0f2D/08/wDjn/162aKjmZryRMb+wf8Ap5/8c/8Ar0f2D/08/wDjn/162aKOZhyRMb+wf+nn/wAc/wDr0f2D/wBPP/jn/wBetmijmYckTG/sH/p5/wDHP/r0f2D/ANPP/jn/ANetmijmYckTkZo/KmkjznYxXPrg0yp7z/j8n/66N/Ooa0OdhV621Se2gWJEjKrnGQc9c+tUqKQ02tjR/tu5/uRfkf8AGj+27n+5F+R/xrOoosh8z7mj/bdz/ci/I/40f23c/wByL8j/AI1nUUWQcz7mj/bdz/ci/I/40f23c/3IvyP+NZ1FFkHM+5o/23c/3IvyP+NH9t3P9yL8j/jWdRRZBzPuOlcyyvI2MsxY496ZS0UyQra06wtprKOSSLcxzk7iO596xq6LSf8AkHRfj/M1MjSmrsP7Lsv+eP8A48f8aP7Lsv8Anj/48f8AGrlFTdm3KuxT/suy/wCeP/jx/wAaP7Lsv+eP/jx/xq5RRdhyrsU/7Lsv+eP/AI8f8aP7Lsv+eP8A48f8auUUXYcq7FP+y7L/AJ4/+PH/ABo/suy/54/+PH/GrlFF2HKuxytyipcyoowquQB7ZqKp7z/j8n/66N/Ooas5nuLXQ6T/AMg6L8f5muerodK/5B8X4/zNKWxpT3LlFFFQbBRRRQAUUUUAFFFFAHL3n/H5P/10b+dRVNef8fk//XRv51DWhyvcWuh0r/kHxfj/ADNc9XQ6V/yD4vx/maUjSnuW6KKKg2CiiigAooooAKKKKAOYu/8Aj7m/66N/Ooqmu/8Aj7m/66N/Ooa0OZ7i10Glf8g+L8f5mufrc02eFLGNXljVhnILAHqaUi6e5foqH7Vb/wDPeL/vsUfarf8A57xf99ioNbomoqH7Vb/894v++xR9qt/+e8X/AH2KAuiaioftVv8A894v++xR9qt/+e8X/fYoC6JqKh+1W/8Az3i/77FH2q3/AOe8X/fYoC6Ofu/+Pub/AK6N/OoqluiGupSCCC5II781FWhzvcWilqaO2eRAwK4PrScktxqLloiCirP2KT+8n5mj7FJ/eT8zU+0j3K9lPsVqKs/YpP7yfmaPsUn95PzNHtI9w9lPsVqKkliaJgrEE4zxTKpO+qIas7MSilopgJRS0UAFaFr/AMe6/j/Os+tC1/491/H+dYV/hN6HxE1FFFch2BRRRQBRvv8AXD/dqvVi9/1o/wB2q9d1P4UcFT42FFFFaGYUUUUALUizSIoVWwB7CmUUmk9xptbEn2mb+/8AoKPtM39/9BUdFTyR7Fc8u5J9pm/v/oKPtM39/wDQVHRRyR7Bzy7iu7SHLHJ6U2loqloS3cSilopiEopaKACilopDEopaKAEopaKAEopaKAEopaKAEopaKACiiigAooooAKKKKACiiigAooooAKKKKAP/2Q==';

  function ageText(iso, now) {
    var d = new Date(iso), ms = (now || Date.now()) - d.getTime();
    if (isNaN(d) || ms < 0) return '–';
    var m = Math.floor(ms / 60000), hr = Math.floor(ms / HOURS), dd = Math.floor(ms / DAY);
    if (m < 1) return 'právě teď';
    if (hr < 1) return 'před ' + m + ' ' + (m === 1 ? 'minutou' : 'minutami');
    if (dd < 1) return 'před ' + hr + ' ' + (hr === 1 ? 'hodinou' : 'hodinami');
    return 'před ' + dd + ' ' + (dd === 1 ? 'dnem' : 'dny');
  }
  function signed(n, fmt) { return (n > 0 ? '+' : n < 0 ? '−' : '±') + (fmt || int)(Math.abs(n)); }
  function timeText(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }

  /* Řádek se stavem: level ok | warn | bad | off, popisek, volitelný druhý řádek a hodnota vpravo (stejné třídy jako řádky Správnosti dat). */
  function trow(level, label, sub, value) {
    var words = { ok: 'v pořádku', warn: 'pozor', bad: 'chyba', off: 'bez údaje' };
    return h('li', 'srow irow ' + level, [
      h('i', 'sdot ' + (level === 'off' ? '' : level)), h('span', 'sr-only', words[level] + ': '),
      h('span', 'name', [label, sub ? h('small', 'idetail', sub) : null]), h('span', 'detail ival', value)
    ]);
  }
  function table(head, rows, cls) {
    return h('div', 'tbl-wrap', h('table', 'tbl ' + (cls || ''), [
      h('thead', null, h('tr', null, head.map(function (c) { return h('th', null, c); }))),
      h('tbody', null, rows.map(function (r) { return h('tr', null, r.map(function (c, i) { return h(i ? 'td' : 'th', c && c.cls ? c.cls : null, c && c.cls !== undefined ? c.text : c); })); }))
    ]));
  }
  var DOTS = ['hlaseni', 'zdravi', 'spravnost', 'platby'];
  var dotLevels = {};
  /* Tečka u odkazu v postranní nabídce: červená = chyba, jantarová = pozor; bez tečky = v pořádku nebo bez údaje; text pro čtečky je vždy. */
  function setDot(key, level, words) {
    dotLevels[key] = level;
    var dot = $('nd-' + key), txt = $('nd-' + key + '-t');
    if (!dot || !txt) return;
    dot.className = 'navdot' + (level ? ' ' + level : '');
    dot.hidden = !level;
    txt.textContent = ' (' + words + ')';
  }

  /* ---- Zdraví aplikace ---- */
  function healthCell(installs, active) {
    if (!(active > 0)) return { text: '–', cls: '', level: 'ok' };
    if (active < 20) return { text: installs + ' z ' + active, cls: 'few', level: 'ok' };
    var p = Math.min(100, 100 * installs / active), level = p > 10 ? 'bad' : p > 3 ? 'warn' : 'ok';
    return { text: nf1.format(p) + ' %', cls: level, level: level };
  }
  function kindInstalls(kinds, kind) {
    var n = 0;
    (kinds || []).forEach(function (k) { if (k.kind === kind) n = k.installs; });
    return n;
  }
  /* Nejhorší buňka (jen vzorek od 20 aktivních instalací): { level, text } pro semafor a tečku; sync_* se NESČÍTAJÍ (různá zařízení se mezi druhy překrývají), bere se nejhorší z nich. */
  function healthWorst(hl) {
    var worst = { level: 'ok', text: '', p: 0 };
    ((hl && hl.builds) || []).forEach(function (b) {
      HEALTH_COLS.forEach(function (c) {
        var inst = kindInstalls(b.kinds, c[0]), cell = healthCell(inst, b.active);
        var p = b.active >= 20 ? Math.min(100, 100 * inst / b.active) : 0, rank = { ok: 0, warn: 1, bad: 2 };
        if (rank[cell.level] > rank[worst.level] || (cell.level === worst.level && cell.level !== 'ok' && p > worst.p)) {
          worst = { level: cell.level, p: p, text: 'Build ' + b.build + ': selhání ' + (c[0].indexOf('sync_') === 0 ? 'synchronizace' : c[1].toLowerCase()) + ' ' + nf1.format(p) + ' %' };
        }
      });
    });
    return worst;
  }
  function healthCard(hl) {
    var head = { id: 'sec-zdravi', cls: 'd6 m12', icon: 'pulse', title: 'Zdraví aplikace' };
    if (!hl || !hl.builds.length) {
      return card(head, [empty(hl ? 'Za posledních 7 dní se nehlásila žádná aktivní instalace.' : 'Zatím bez dat: přibude s buildem 41.', 'pulse'),
        note('Aplikace pošle jen druh selhání a svou verzi, žádný text, žádný účet; řídí se přepínačem anonymních statistik.')]);
    }
    var cols = hl.builds.map(function (b) { return { label: 'build ' + b.build, active: b.active, kinds: b.kinds }; });
    if (hl.older && hl.older.active > 0) cols.push({ label: 'starší', active: hl.older.active, kinds: hl.older.kinds });
    var rows = [['Aktivní instalace'].concat(cols.map(function (c) { return { text: int(c.active), cls: 'few' }; }))];
    HEALTH_COLS.forEach(function (k) {
      rows.push([k[1]].concat(cols.map(function (c) { var x = healthCell(kindInstalls(c.kinds, k[0]), c.active); return { text: x.text, cls: x.cls }; })));
    });
    head.note = 'posledních ' + hl.days + ' dní';
    return card(head, [
      table(['Druh selhání'].concat(cols.map(function (c) { return c.label; })), rows, 'htab'),
      note('Podíl aktivních instalací buildu, na kterých selhání za ' + hl.days + ' dní nastalo (nad 3 % jantarově, nad 10 % červeně; do 20 aktivních instalací jen počet „zařízení z aktivních“).')
    ]);
  }

  /* ---- Hlášení od lidí ---- */
  function reportsCard(rp, ctx) {
    var head = { id: 'sec-hlaseni', cls: 'd6 m12', icon: 'list', title: 'Hlášení od lidí' };
    if (!rp) return card(head, [note(NO_DATA)]);
    var st = { items: rp.items.slice(), has_more: rp.has_more, open: rp.open, total: rp.total };
    var noteEl = h('span', 'note'), list = h('ul', 'reps'), foot = h('div', 'rep-foot');
    head.extra = noteEl;
    function dots() { setDot('hlaseni', st.open > 0 ? 'warn' : null, st.open > 0 ? st.open + ' nevyřízených' : 'vše vyřízeno'); }
    function fail(e) { if (e !== null) { $('dash-error').textContent = (e && e.message) || 'Požadavek se nepodařil.'; $('dash-error').hidden = false; } }
    function item(it) {
      var li = h('li', 'rep' + (it.resolved_at ? ' done' : ''));
      var os = (it.device === 'iPad' ? 'iPadOS ' : it.device === 'Android' ? 'Android ' : 'iOS ') + it.os_major;
      var done = h('button', 'btn-soft sm', it.resolved_at ? 'Vrátit' : 'Vyřízeno');
      done.type = 'button';
      done.setAttribute('aria-label', (it.resolved_at ? 'Vrátit mezi nevyřízená: ' : 'Označit jako vyřízené: ') + it.body.slice(0, 40));
      done.addEventListener('click', function () {
        var want = !it.resolved_at;
        done.disabled = true;
        var p = ctx.demo ? Promise.resolve() : ctx.api('POST', '', { op: 'resolve', id: it.id, done: want });
        p.then(function () { it.resolved_at = want ? new Date().toISOString() : null; st.open += want ? -1 : 1; draw(); })
          .catch(function (e) { done.disabled = false; fail(e); });
      });
      var acts = [];
      if (it.has_screenshot) {
        var shot = h('button', 'btn-soft sm', 'Snímek'), box = h('div', 'rep-shot'), loaded = false;
        shot.type = 'button';
        shot.setAttribute('aria-expanded', 'false');
        shot.addEventListener('click', function () {
          if (loaded) { box.hidden = !box.hidden; shot.setAttribute('aria-expanded', String(!box.hidden)); return; }
          shot.disabled = true;
          var p = ctx.demo ? Promise.resolve({ screenshot: DEMO_SHOT }) : ctx.api('GET', 'shot=' + encodeURIComponent(it.id));
          p.then(function (r) {
            shot.disabled = false;
            loaded = true;
            var uri = r && r.screenshot;
            if (typeof uri === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+\/]+={0,2}$/.test(uri)) {
              var img = h('img'); img.alt = 'Snímek obrazovky z hlášení'; img.src = uri; box.appendChild(img);
            } else box.appendChild(h('p', 'sub', 'Snímek už není k dispozici (maže se po 30 dnech).'));
            shot.setAttribute('aria-expanded', 'true');
          }).catch(function (e) { shot.disabled = false; fail(e); });
        });
        acts.push(shot);
        li.appendChild(h('div', 'rep-h', [h('span', 'rtag ' + it.kind, it.kind === 'bug' ? 'chyba' : 'nápad'), h('span', 'rep-t', it.body)]));
        li.appendChild(h('p', 'rep-m', [dateTime(it.created_at), ' · ', it.device, ' · ', os, ' · build ', it.build, ' · se snímkem', it.resolved_at ? ' · vyřízeno' : '']));
        acts.push(done);
        li.appendChild(h('div', 'rep-a', acts));
        li.appendChild(box);
        return li;
      }
      li.appendChild(h('div', 'rep-h', [h('span', 'rtag ' + it.kind, it.kind === 'bug' ? 'chyba' : 'nápad'), h('span', 'rep-t', it.body)]));
      li.appendChild(h('p', 'rep-m', [dateTime(it.created_at), ' · ', it.device, ' · ', os, ' · build ', it.build, it.resolved_at ? ' · vyřízeno' : '']));
      li.appendChild(h('div', 'rep-a', [done]));
      return li;
    }
    function draw() {
      rp.items = st.items; rp.has_more = st.has_more; rp.open = st.open;
      noteEl.textContent = st.open + ' nevyřízených · ' + st.total + ' celkem';
      list.textContent = '';
      st.items.forEach(function (it) { list.appendChild(item(it)); });
      foot.textContent = '';
      if (!st.items.length) foot.appendChild(empty('Zatím nikdo nic nenahlásil.', 'list'));
      if (st.has_more) {
        var more = h('button', 'btn-soft', 'Starší hlášení');
        more.type = 'button';
        more.addEventListener('click', function () {
          more.disabled = true;
          var last = st.items.length ? st.items[st.items.length - 1].created_at : '';
          var p = ctx.demo ? Promise.resolve({ reports: demoMoreReports() }) : ctx.api('GET', 'reports_before=' + encodeURIComponent(last));
          p.then(function (r) {
            if (!r || !r.reports || !Array.isArray(r.reports.items)) throw new Error('Starší hlášení se nepodařilo načíst.');
            var seen = {};
            st.items.forEach(function (x) { seen[x.id] = true; });
            r.reports.items.forEach(function (x) { if (!seen[x.id]) st.items.push(x); });
            st.has_more = !!r.reports.has_more;
            draw();
          }).catch(function (e) { more.disabled = false; fail(e); });
        });
        foot.appendChild(more);
      }
      dots();
    }
    draw();
    return card(head, [list, foot, note('Hlášení od lidí z aplikace, bez vazby na účet: text se maže po 12 měsících, snímek po 30 dnech.')]);
  }

  /* ---- Cesta nového uživatele ---- */
  function funnelCard(f) {
    var head = { id: 'sec-cesta', cls: 'd8 m12', icon: 'funnel', title: 'Cesta nového uživatele' };
    if (!f) return card(head, [note(NO_DATA)]);
    var t = f.total;
    head.note = 'registrace za 30 dní';
    if (!t.signups) return card(head, [empty('Za posledních 30 dní se nikdo nezaregistroval.', 'users')]);
    var wid = function (v, ref) { return ref > 0 ? Math.min(100, 100 * v / ref) : 0; };
    var steps = [
      { name: 'Instalace (jen informativně)', v: t.installs, shown: int(t.installs), pct: '', w: wid(t.installs, Math.max(t.installs, t.signups)), info: true },
      { name: 'Registrace', v: t.signups, shown: int(t.signups), pct: '', w: wid(t.signups, Math.max(t.installs, t.signups)) },
      { name: 'Ověřený e-mail nebo Apple', v: t.verified, shown: int(t.verified), ratio: t.signups > 0 ? t.verified / t.signups : null, w: wid(t.verified, t.signups) },
      { name: 'První mazlíček', v: t.pet, shown: int(t.pet), ratio: t.verified - t.invited > 0 ? t.pet / (t.verified - t.invited) : null, w: wid(t.pet, t.signups) },
      { name: 'První odškrtnutý úkol', v: t.done, shown: int(t.done), ratio: t.pet > 0 ? t.done / t.pet : null, w: wid(t.done, t.signups) },
      { name: 'Návrat po 7 dnech', v: t.returned, shown: t.ret_base > 0 ? int(t.returned) + ' z ' + int(t.ret_base) : '–', ratio: t.ret_base > 0 ? t.returned / t.ret_base : null,
        w: t.ret_base > 0 ? wid(t.done, t.signups) * t.returned / t.ret_base : 0 }
    ];
    var worstI = -1, worstR = 1;
    steps.forEach(function (s, i) { if (s.ratio !== null && s.ratio !== undefined && s.ratio < worstR) { worstR = s.ratio; worstI = i; } });
    var ol = h('ol', 'funnel', steps.map(function (s, i) {
      var fill = h('i', 'fill f' + Math.min(4, Math.max(0, i - 1)));
      fill.style.width = Math.max(s.w > 0 ? 1.5 : 0, s.w) + '%';
      var pct = s.info ? s.pct : s.ratio === null || s.ratio === undefined ? (s.pct || '') : Math.round(100 * s.ratio) + ' %';
      return h('li', (s.info ? 'info ' : '') + (i === worstI ? 'worst' : ''), [h('span', 'name', s.name), h('b', null, s.shown), h('small', null, pct), h('span', 'track', fill)]);
    }));
    ol.setAttribute('aria-label', 'Cesta uživatele: ' + steps.map(function (s) { return s.name + ' ' + s.shown; }).join(', '));
    var weeks = f.weeks.length ? [h('h3', null, 'Týdenní kohorty registrací'), table(['Týden', 'Registrace', 'Ověřeno', 'Mazlíček', 'Úkol', 'Návrat 7 dní'], f.weeks.map(function (w) {
      return ['od ' + dayText(w.week), int(w.signups), int(w.verified), int(w.pet), int(w.done), w.ret_base > 0 ? int(w.returned) + ' z ' + int(w.ret_base) : '–'];
    }), 'wk')] : [];
    var defs = h('details', 'defs', [h('summary', null, 'Co přesně se počítá'), h('dl', null, [
      h('dt', null, 'Instalace'), h('dd', null, 'První hlášení anonymní instalace v období. Instalaci nejde spojit s účtem, proto je to jen informace a nepočítá se do procent ani do největšího úbytku.'),
      h('dt', null, 'Registrace'), h('dd', null, 'Účty založené za posledních 30 dní. Každý další krok jsou jen ti, kdo prošli všemi předchozími.'),
      h('dt', null, 'Ověřený e-mail nebo Apple'), h('dd', null, 'Potvrzený e-mail, nebo přihlášení přes Apple, Google či Facebook.'),
      h('dt', null, 'První mazlíček'), h('dd', null, 'Uživatel je vlastníkem domácnosti, která má aspoň jednoho mazlíčka (i smazaného). Pozvaní členové cizí domácnosti se od tohoto kroku nepočítají a jsou zvlášť jako „pozvaní členové“.'),
      h('dt', null, 'První odškrtnutý úkol'), h('dd', null, 'V domácnosti, jejímž je vlastníkem, je po jeho registraci aspoň jedno odškrtnuté krmení nebo podaná dávka léku (vynechaná dávka se nepočítá, smazaný záznam také ne).'),
      h('dt', null, 'Návrat po 7 dnech'), h('dd', null, 'V jeho domácnosti vznikl nový záznam 7. až 14. den po registraci. Počítají se jen účty starší 14 dní, u mladších krok ještě není uzavřený, proto nejsou ani v čitateli, ani ve jmenovateli.')
    ])]);
    return card(head, [ol, note('Procento je proti předchozímu kroku, největší úbytek je zvýrazněný jantarově. Pozvaní členové: ' + int(t.invited) + ' (vstoupili do cizí domácnosti, od mazlíčka dál se nepočítají).')].concat(weeks, [defs]));
  }

  /* ---- Platby ---- */
  function paymentsCard(py) {
    var head = { id: 'sec-platby', cls: 'd4 m12', icon: 'money', title: 'Platby', note: 'stav předplatných' };
    if (!py) { setDot('platby', null, 'bez údaje'); return card(head, [note(NO_DATA)]); }
    var rows = [], last = py.last_event_at || py.last_update_at;
    var ageMs = last ? Date.now() - new Date(last).getTime() : null;
    /* upozornění na mlčící webhook jen podle produkčních zpráv; sandbox se ukazuje zvlášť a nikdy nevaruje */
    var stale = ageMs !== null && ageMs > 7 * DAY && py.paying > 0;
    rows.push(last
      ? trow(stale ? 'warn' : 'ok', 'Poslední zpráva z RevenueCat (produkce)', 'událost ' + (py.last_event_at ? ageText(py.last_event_at) : '–') + ' · zápis ' + (py.last_update_at ? ageText(py.last_update_at) : '–'), stale ? 'starší než 7 dní' : 'v pořádku')
      : trow('off', 'Poslední zpráva z RevenueCat (produkce)', 'zatím žádná produkční zpráva', '–'));
    var sb = py.sandbox_last_event_at || py.sandbox_last_update_at;
    rows.push(trow('off', 'Poslední zpráva z RevenueCat (sandbox)', sb ? 'událost ' + (py.sandbox_last_event_at ? ageText(py.sandbox_last_event_at) : '–') + ' · zápis ' + (py.sandbox_last_update_at ? ageText(py.sandbox_last_update_at) : '–') : 'zatím žádná', sb ? '' : '–'));
    rows.push(trow(py.billing_retry ? 'warn' : 'ok', 'Platba se nedaří', 'obchod to zkouší znovu', int(py.billing_retry)));
    rows.push(trow(py.grace ? 'warn' : 'ok', 'Odklad platby', 'předplatné běží, platba neprošla', int(py.grace)));
    rows.push(trow(py.refunded_30d + py.revoked_30d ? 'warn' : 'ok', 'Vrácené a odvolané za 30 dní', 'vráceno ' + int(py.refunded_30d) + ' · odvoláno ' + int(py.revoked_30d), int(py.refunded_30d + py.revoked_30d)));
    rows.push(trow('ok', 'Končí do 7 dní a neobnoví se', null, int(py.ending_7d)));
    rows.push(trow('off', 'Zkušební nákupy (sandbox)', 'jen počet, do výnosu nejdou', int(py.sandbox)));
    var fm = null;
    if (FORECAST.launch) {
      var l = new Date(FORECAST.launch + 'T00:00:00'), n = new Date();
      fm = Math.min(12, Math.max(1, (n.getFullYear() - l.getFullYear()) * 12 + n.getMonth() - l.getMonth() + 1));
    }
    if (fm === null) rows.push(trow('off', 'Skutečnost proti forecastu', 'platících ' + int(py.paying) + ' · forecast střed od vydání', 'před vydáním'));
    else {
      var fc = FORECAST.active[fm - 1];
      rows.push(trow('off', 'Skutečnost proti forecastu', 'platících ' + int(py.paying) + ' · forecast střed ' + fc + ' (měsíc ' + fm + ')', fc > 0 ? signed(Math.round(100 * (py.paying / fc - 1)), int) + ' %' : '–'));
    }
    setDot('platby', py.billing_retry || stale ? 'warn' : null, py.billing_retry ? 'platba se nedaří' : stale ? 'zpráva z RevenueCat je stará' : 'v pořádku');
    return card(head, [h('ul', 'states', rows),
      note('Počty z RevenueCat (jen produkční, sandbox zvlášť); forecast: střed z ziskovost-forecast-2026-11-20.html.')]);
  }

  /* ---- Bezpečnost ---- */
  function securityCard(sc) {
    var head = { id: 'sec-bezpecnost', cls: 'd4 m12', icon: 'shield', title: 'Bezpečnost', note: 'aktuální stav' };
    if (!sc) return card(head, [note(NO_DATA)]);
    var rows = [];
    rows.push(trow(sc.invite_exhausted ? 'warn' : 'ok', 'Vyčerpané pokusy o kód pozvánky', 'poslední hodina, 10 pokusů na uživatele', int(sc.invite_exhausted)));
    rows.push(trow(sc.card_miss >= 10 ? 'warn' : 'ok', 'Neplatné otevření sdílené karty', 'aktuální okno 10 minut', int(sc.card_miss)));
    rows.push(trow('ok', 'Aktivní sdílené karty', null, int(sc.cards_active)));
    rows.push(sc.admin_logins_unmeasured ? trow('off', 'Přihlášení správce za 7 dní', 'Server záznamy o přihlášení neukládá.', 'neměří se') : sc.admin_logins_7d === null ? trow('off', 'Přihlášení správce za 7 dní', 'nelze zjistit', '–') : trow('ok', 'Přihlášení správce za 7 dní', null, int(sc.admin_logins_7d)));
    rows.push(trow('ok', 'Opakované zkušební doby za 30 dní', 'e-mail znám dřív než účet', int(sc.repeat_trials_30d)));
    return card(head, [h('ul', 'states', rows),
      note('Počítadla pokusů jsou krátkodobá (hodina, 10 minut), historie se nevede; smazané účty se nesledují, protože server o nich nic nezapisuje.')]);
  }

  /* ---- Připravenost k vydání ---- */
  function readinessCard(rd, data, ctx) {
    var head = { id: 'sec-pripravenost', cls: 'd8 m12', icon: 'calendar', title: 'Připravenost k vydání' };
    if (!rd) return card(head, [note(NO_DATA)]);
    var ig = data.integrity && Array.isArray(data.integrity.checks) && data.integrity.checks.length ? igSummary(data.integrity.checks) : null;
    var m = rd.migration, measured = [];
    measured.push(m.ok === null ? trow('off', 'Migrace na serveru jsou aktuální', 'verzi nelze přečíst', '–')
      : trow(m.ok ? 'ok' : 'bad', 'Migrace na serveru jsou aktuální', m.ok ? 'měří se samo' : 'server má ' + m.server + ', očekává se ' + m.expected, m.ok ? 'ano' : 'ne'));
    measured.push(rd.cron ? trow(rd.cron.failed ? 'bad' : 'ok', 'Noční úlohy běží', rd.cron.never ? rd.cron.never + ' ještě neběželo (první den po nasazení)' : null, rd.cron.ok + ' z ' + rd.cron.total + (rd.cron.never ? ', ' + rd.cron.never + ' ještě neběželo' : '')) : trow('off', 'Noční úlohy běží', 'nelze zjistit', '–'));
    measured.push(ig ? trow(ig.bad ? 'bad' : ig.warn ? 'warn' : 'ok', 'Kontroly správnosti dat', null, ig.ok + ' z ' + ig.total) : trow('off', 'Kontroly správnosti dat', 'kontrola není zapnutá', '–'));
    measured.push(trow(rd.apple_revoke ? 'ok' : 'bad', 'Odvolání přihlášení přes Apple', rd.apple_revoke ? null : 'chybí klíč na serveru', rd.apple_revoke ? 'ano' : 'ne'));
    measured.push(rd.sandbox_mode === null ? trow('off', 'Nákupy v sandboxu', 'režim nelze přečíst', '–')
      : trow(rd.sandbox_mode === 'all' ? 'warn' : 'ok', 'Nákupy v sandboxu jen testerům', rd.sandbox_mode === 'all' ? 'přepnout po schválení' : null, rd.sandbox_mode === 'all' ? 'všem' : 'testerům'));
    measured.push(trow(rd.secrets.set === rd.secrets.total ? 'ok' : 'warn', 'Tajemství funkcí nastavená', 'jen ano / ne, hodnoty se nečtou', rd.secrets.set + ' z ' + rd.secrets.total));
    measured.push(trow('off', 'Nejvyšší build za 7 dní', 'orientačně, podle hlášení instalací', rd.max_build === null ? '–' : String(rd.max_build)));
    var doneN = rd.checklist.filter(function (c) { return c.done_at; }).length;
    var countEl = h('span', 'note', doneN + ' z ' + rd.checklist.length + ' hotovo');
    head.extra = countEl;
    var manual = h('ul', 'states');
    rd.checklist.forEach(function (c) {
      var label = (CHECKLIST.filter(function (x) { return x[0] === c.key; })[0] || [c.key, c.key])[1];
      var btn = h('button', 'chk', [h('span', 'box', ''), h('span', 'name', label), h('span', 'detail ival', '')]);
      btn.type = 'button';
      function paint() {
        btn.setAttribute('aria-pressed', String(!!c.done_at));
        btn.querySelector('.box').textContent = c.done_at ? '✓' : '';
        btn.querySelector('.ival').textContent = c.done_at ? 'hotovo' : 'ručně';
        countEl.textContent = rd.checklist.filter(function (x) { return x.done_at; }).length + ' z ' + rd.checklist.length + ' hotovo';
      }
      btn.addEventListener('click', function () {
        var want = !c.done_at;
        btn.disabled = true;
        var p = ctx.demo ? Promise.resolve() : ctx.api('POST', '', { op: 'checklist', key: c.key, done: want });
        p.then(function () { c.done_at = want ? new Date().toISOString() : null; btn.disabled = false; paint(); })
          .catch(function (e) { btn.disabled = false; if (e !== null) { $('dash-error').textContent = (e && e.message) || 'Požadavek se nepodařil.'; $('dash-error').hidden = false; } });
      });
      paint();
      manual.appendChild(h('li', 'srow', btn));
    });
    return card(head, [
      h('div', 'ready', [
        h('div', null, [h('h3', null, 'Měří se samo'), h('ul', 'states', measured)]),
        h('div', null, [h('h3', null, 'Ručně: klepnutím označíte hotovo'), manual])
      ]),
      note('Měřené body se čtou ze serveru při každém načtení; ruční body si server pamatuje (jen bod seznamu a čas, nic dalšího).')
    ]);
  }

  /* ---- Od včera: stav jednou větou a pět čísel ---- */
  function semaphore(data) {
    var items = [], s = data.stats || {}, ig = data.integrity && Array.isArray(data.integrity.checks) && data.integrity.checks.length ? igSummary(data.integrity.checks) : null;
    if (ig && ig.bad) items.push({ level: 'bad', text: 'Správnost dat: ' + ig.bad + ' ' + plural(ig.bad, 'chyba', 'chyby', 'chyb') });
    var cronBad = (data.readiness && data.readiness.cron && data.readiness.cron.failed > 0) || ((s.state && s.state.cron) || []).some(function (j) { return j.status === 'failed'; });
    if (cronBad) items.push({ level: 'bad', text: 'Selhala noční úloha' });
    var hw = healthWorst(data.health);
    if (hw.level !== 'ok') items.push({ level: hw.level, text: hw.text });
    var open = data.reports ? data.reports.open : data.since ? data.since.reports_open : 0;
    if (open > 0) items.push({ level: 'warn', text: open + ' ' + plural(open, 'nevyřízené hlášení', 'nevyřízená hlášení', 'nevyřízených hlášení') });
    if (data.payments && data.payments.billing_retry > 0) items.push({ level: 'warn', text: 'Platba se nedaří (' + data.payments.billing_retry + ')' });
    return items;
  }

  function sinceCard(data) {
    var sn = data.since, items = semaphore(data), top = items[0];
    var verdictText = !items.length ? 'Vše v pořádku' : items.length + ' ' + plural(items.length, 'věc', 'věci', 'věcí') + ' k pozornosti';
    var verdictLevel = !items.length ? 'ok' : top.level;
    var ig = data.integrity && Array.isArray(data.integrity.checks) && data.integrity.checks.length ? igSummary(data.integrity.checks) : null;
    var nums = [], u = (data.stats || {}).users || {};
    if (sn) {
      var diff = sn.new_users_24h - sn.new_users_avg7;
      nums.push(['Noví uživatelé, 24 h', int(sn.new_users_24h), signed(Math.round(diff * 10) / 10, nf1.format.bind(nf1)) + ' proti průměru 7 dní']);
      nums.push(['Aktivní dnes', int(sn.active_today), pctText(sn.active_today, sn.users_total) + ' ze všech']);
      nums.push([sn.subs ? 'Předplatná, změna od ' + dayShort(sn.subs.base_day) : 'Předplatná, změna za den', sn.subs ? signed(sn.subs.paying_delta) : '–', sn.subs ? 'MRR ' + signed(sn.subs.mrr_delta_czk, kc) : 'bez denního snímku']);
      nums.push(['Hlášení od lidí', int(sn.reports_open), 'nevyřízených z ' + int(sn.reports_total)]);
    } else {
      nums.push(['Noví uživatelé, 24 h', '–', 'část přibude po nasazení']);
      nums.push(['Aktivní dnes', '–', '']);
      nums.push(['Předplatná, změna za den', '–', '']);
      nums.push(['Hlášení od lidí', data.reports ? int(data.reports.open) : '–', data.reports ? 'nevyřízených z ' + int(data.reports.total) : '']);
    }
    nums.push(['Kontroly dat', ig ? String(ig.ok) : '–', ig ? 'z ' + ig.total + (ig.bad || ig.warn ? ' · ' + (ig.bad + ig.warn) + ' selhává' : ' · vše v pořádku') : 'kontrola není zapnutá']);
    var dl = h('dl', 'mini since', nums.map(function (n) { return h('div', null, [h('dt', null, n[0]), h('dd', null, [n[1]]), h('small', 'sdet', n[2])]); }));
    var s = data.stats || {};
    return card({ id: 'sec-vcera', cls: 'd12 m12', icon: 'calendar', title: 'Od včera', note: s.generated_at ? dateTime(s.generated_at) : '' }, [
      h('div', 'since-top', [h('span', 'verdict ' + verdictLevel, verdictText), h('p', 'sub', top ? top.text + (items.length > 1 ? ' a další' : '') : 'Žádná chyba, nic nečeká na pozornost.')]),
      dl,
      note('Přírůstek předplatných je čistá změna proti poslednímu dennímu snímku (premium_subscriptions nemá čas vzniku); aktivní dnes = přihlášení nebo záznam v domácnosti od půlnoci.')
    ]);
  }

  /* ---------- Vykreslení ---------- */

  var lastData = null, lastMs = null;

  /* Volání serveru po načtení stránky: GET se zúženým dotazem nebo POST s malým tělem (dva zápisy přehledu). 401 a 403 odhlásí, jiná chyba se ukáže nad panely. */
  function api(method, query, body) {
    return fresh().then(function () {
      var opt = { method: method, headers: { Authorization: 'Bearer ' + session.access }, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' };
      if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
      return fetch(API + (query ? '?' + query : ''), opt);
    }).then(function (res) {
      if (res.status === 401) { logout('Přihlášení vypršelo. Přihlaste se znovu.'); throw null; }
      if (res.status === 403) { logout('Přístup zamítnut.'); throw null; }
      if (res.status === 429) throw new Error('Příliš mnoho pokusů. Zkuste to za minutu.');
      if (!res.ok) throw new Error('Server odpověděl chybou ' + res.status + '.');
      return res.json();
    });
  }
  var ctx = { demo: demo, api: api };

  /* Zkontrolovat teď: živý výpočet správnosti dat, jen tato část se nahradí. */
  function checkNow(btn) {
    if (!lastData) return;
    btn.disabled = true;
    var p = demo ? Promise.resolve({ integrity: Object.assign({}, lastData.integrity, { source: 'live', taken_at: new Date().toISOString() }) }) : api('GET', 'integrity=live');
    p.then(function (r) {
      if (!r || !r.integrity) throw new Error('Živá kontrola se nepodařila (server ji nestihl). Zkuste to za chvíli.');
      lastData.integrity = r.integrity;
      render(lastData, lastMs);
    }).catch(function (e) {
      btn.disabled = false;
      if (e !== null) { $('dash-error').textContent = (e && e.message) || 'Živá kontrola se nepodařila.'; $('dash-error').hidden = false; }
    });
  }

  function render(data, ms) {
    lastData = data; lastMs = ms;
    var s = data.stats || {}, series = data.series || [];
    var box = $('panels');
    box.textContent = '';
    DOTS.forEach(function (k) { setDot(k, null, 'bez údaje'); });
    [sinceCard(data), reportsCard(data.reports, ctx), healthCard(data.health), funnelCard(data.funnel), paymentsCard(data.payments), readinessCard(data.readiness, data, ctx), securityCard(data.security),
      heroCard(s, series), growthCard(s, series), petsCard(s), revenueCard(s, series), trialCard(s), devicesCard(s), capacityCard(s, series), externalCard(data.external), breedsCard(s), recordsCard(s), householdsCard(s), stateCard(s, ms)]
      .concat(integrityCards(data.integrity), [supportCard()])
      .forEach(function (p) { box.appendChild(p); });
    var hw = healthWorst(data.health);
    setDot('zdravi', hw.level === 'ok' ? null : hw.level, hw.level === 'ok' ? (data.health ? 'v pořádku' : 'bez údaje') : hw.text);
    igNav(data.integrity);
    $('updated').textContent = 'Stav dat k ' + dateTime(s.generated_at);
    $('loaded').textContent = 'Načteno v ' + new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- Ukázková data (?demo=1) ---------- */

  /* Ukázka správnosti dat: jedna chyba (domácnost bez členů od včerejška) a jedno varování (staré zálohy), jako v maketě. */
  function demoIntegrity() {
    var C = function (id, group, level, value, expected) { return { id: id, group: group, level: level, value: value, expected: expected, ok: level === 'informace' ? value === 0 : value === expected }; };
    var checks = [
      C('hh_bez_clenu', 'domacnosti', 'chyba', 1, 0), C('hh_bez_vlastnika', 'domacnosti', 'chyba', 0, 0), C('uziv_vice_hh', 'domacnosti', 'chyba', 0, 0),
      C('hh_nad_5', 'domacnosti', 'chyba', 0, 0), C('ucty_bez_clenstvi', 'domacnosti', 'informace', 2, 0),
      C('bkp_soubory', 'soubory', 'varovani', 4, 0), C('hh_sirotci', 'soubory', 'chyba', 0, 0), C('radek_bez_souboru', 'soubory', 'varovani', 0, 0),
      C('soubor_bez_radku', 'soubory', 'varovani', 0, 0), C('fronta_stara', 'soubory', 'varovani', 0, 0), C('nad_kvotou', 'soubory', 'varovani', 0, 0), C('nazvy_mimo_vzor', 'soubory', 'chyba', 0, 0),
      C('cizi_rodic', 'vazby', 'chyba', 0, 0), C('zivy_pod_smazanym', 'vazby', 'varovani', 0, 0), C('kos_stary', 'vazby', 'chyba', 0, 0),
      C('pozvanky_prosle', 'vazby', 'informace', 0, 0), C('karty_prosle', 'vazby', 'varovani', 0, 0), C('pes_nad_50_dok', 'vazby', 'varovani', 0, 0),
      C('predplatne_bez_uctu', 'pristup', 'chyba', 0, 0), C('predplatne_prosle', 'pristup', 'varovani', 0, 0), C('tabulky_bez_rls', 'pristup', 'chyba', 0, 0),
      C('anon_funkce', 'pristup', 'chyba', 0, 0), C('verejny_bucket', 'pristup', 'chyba', 0, 0), C('siroka_politika', 'pristup', 'chyba', 0, 0),
      C('cron_ulohy', 'pristup', 'chyba', '7 z 7', '7 z 7')
    ];
    var days = [], now = new Date(), i;
    for (i = 29; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push({ day: isoDay(d), failed: i <= 1 ? 1 : 0, warned: i === 18 || i <= 1 ? 1 : 0 });
    }
    var y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
    var from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return { checks: checks, history: { days: days, last_all_ok: isoDay(y), failing: [
      { id: 'hh_bez_clenu', since: isoDay(from), last_ok: isoDay(y) }, { id: 'bkp_soubory', since: isoDay(from), last_ok: isoDay(y) }] } };
  }

  /* Ukázka rozšíření: čísla jako v maketě (docs/navrhy/admin-rozsireni-navrh.png), jen vymyšlená. */
  var demoOverview = (function () {
    var now = Date.now(), ago = function (ms) { return new Date(now - ms).toISOString(); };
    var R = function (id, kind, body, device, os, build, shot, age, resolved) {
      return { id: id, kind: kind, body: body, device: device, os_major: os, app_version: '1.0.0', build: String(build), has_screenshot: shot, created_at: ago(age), resolved_at: resolved ? ago(age / 2) : null };
    };
    var kinds = function (m) { return Object.keys(m).map(function (k) { return { kind: k, installs: m[k][0], events: m[k][1] }; }); };
    return {
      since: { users_total: 174, new_users_24h: 8, new_users_avg7: 2.3, active_today: 106, reports_open: 2, reports_total: 14, subs: { paying_delta: 3, mrr_delta_czk: 207, base_day: '2026-11-26' } },
      reports: { open: 2, total: 14, has_more: true, items: [
        R('11111111-aaaa-4aaa-8aaa-000000000001', 'bug', 'Po uložení léku se neukázal na Dnes, musel jsem aplikaci zavřít a otevřít znovu. A tady je dlouhý text bez mezer: ' + 'dlouhedlouhedlouhe'.repeat(8), 'iPhone', 26, 41, true, 15 * HOURS, false),
        R('11111111-aaaa-4aaa-8aaa-000000000002', 'idea', 'Chtěla bych připomínku na stříhání drápků.', 'iPhone', 18, 41, false, 19 * HOURS, false),
        R('11111111-aaaa-4aaa-8aaa-000000000003', 'bug', 'Váha se ukázala v librách.', 'iPad', 26, 40, false, 3 * DAY, true)
      ] },
      health: { days: 7, builds: [
        { build: '41', version: '1.0.0', active: 74, kinds: kinds({ sync_auth: [3, 6], sync_server: [1, 1], signin: [1, 1], upload: [1, 2], crash: [0, 0] }) },
        { build: '40', version: '1.0.0', active: 38, kinds: kinds({ sync_server: [1, 2], signin: [0, 0], upload: [2, 3], crash: [1, 1] }) },
        { build: '39', version: '1.0.0', active: 12, kinds: kinds({ sync_auth: [1, 1], crash: [1, 1] }) }
      ], older: { active: 9, kinds: kinds({ sync_server: [1, 1] }) } },
      funnel: { total: { installs: 412, signups: 318, verified: 301, invited: 27, pet: 274, done: 198, ret_base: 150, returned: 91 }, weeks: [
        { week: '2026-10-26', installs: 70, signups: 52, verified: 50, invited: 4, pet: 46, done: 35, ret_base: 35, returned: 22 },
        { week: '2026-11-02', installs: 91, signups: 74, verified: 70, invited: 6, pet: 64, done: 49, ret_base: 49, returned: 30 },
        { week: '2026-11-09', installs: 100, signups: 78, verified: 74, invited: 7, pet: 66, done: 46, ret_base: 46, returned: 28 },
        { week: '2026-11-16', installs: 96, signups: 71, verified: 66, invited: 6, pet: 60, done: 40, ret_base: 20, returned: 11 },
        { week: '2026-11-23', installs: 55, signups: 43, verified: 41, invited: 4, pet: 38, done: 28, ret_base: 0, returned: 0 }
      ] },
      payments: { last_event_at: ago(3 * HOURS), last_update_at: ago(3 * HOURS), sandbox_last_event_at: ago(2 * DAY), sandbox_last_update_at: ago(2 * DAY), paying: 31, production_rows: 44, billing_retry: 2, grace: 1, refunded_30d: 0, revoked_30d: 0, ending_7d: 4, sandbox: 6 },
      security: { invite_exhausted: 0, card_miss: 3, cards_active: 9, admin_logins_7d: 5, repeat_trials_30d: 1 },
      readiness: { migration: { server: '20270108090000', expected: '20270108090000', ok: true }, cron: { total: 8, ok: 7, failed: 0, never: 1 }, apple_revoke: false, sandbox_mode: 'all', secrets: { set: 8, total: 9 }, max_build: 40,
        checklist: CHECKLIST.map(function (c, i) { return { key: c[0], done_at: i === 7 || i === 4 ? ago(2 * DAY) : null }; }) }
    };
  })();
  function demoMoreReports() {
    var mk = function (n, kind, body, age) { return { id: '22222222-bbbb-4bbb-8bbb-00000000000' + n, kind: kind, body: body, device: 'iPhone', os_major: 18, app_version: '1.0.0', build: '39', has_screenshot: false, created_at: new Date(Date.now() - age).toISOString(), resolved_at: new Date(Date.now() - age / 2).toISOString() }; };
    return { items: [mk(1, 'idea', 'Dalo by se přidat druhé krmení v poledne?', 5 * DAY), mk(2, 'bug', 'Upozornění přišlo o hodinu později.', 6 * DAY)], has_more: false, open: 2, total: 14 };
  }

  function demoData() {
    var series = [], now = new Date(2026, 10, 27);
    for (var i = 89; i >= 0; i--) {
      var d = new Date(now); d.setDate(d.getDate() - i);
      var k = 89 - i;
      var users = Math.round(8 + k * 1.9 + Math.sin(k / 5) * 4);
      series.push({
        day: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
        users: users, active_7d: Math.round(users * 0.55), active_30d: Math.round(users * 0.75),
        households: Math.round(users * 0.8), pets: Math.round(users * 1.35),
        mrr_czk: Math.round(k * 5.6 + Math.sin(k / 7) * 20),
        db_bytes: Math.round((38 + k * 0.62) * 1048576), storage_bytes: Math.round((90 + k * 3.1) * 1048576)
      });
    }
    var last = series[series.length - 1];
    return {
      integrity: demoIntegrity(),
      since: demoOverview.since, reports: demoOverview.reports, health: demoOverview.health, funnel: demoOverview.funnel, payments: demoOverview.payments, security: demoOverview.security, readiness: demoOverview.readiness,
      external: { facebook: { status: 'ok', name: 'Moji chlupáči', usage: { call_count: 3, total_cputime: 1.5, total_time: 2 } }, apple: { status: 'ok', downloads: 41, units: 52, missing: 1, days: [] }, revenuecat: { status: 'ok', currency: 'CZK', metrics: [{ id: 'active_trials', name: 'Zkušební doby', value: 9, unit: '' }, { id: 'active_subscriptions', name: 'Předplatná', value: 31, unit: '' }, { id: 'mrr', name: 'MRR', value: 1480, unit: 'Kč' }] }, supabase: { status: 'ok', interval: '7day', rest: 18420, auth: 1310, storage: 940, realtime: 0 }, google: { status: 'unconfigured' }, telemetrydeck: { status: 'unconfigured' } },
      series: series,
      stats: {
        generated_at: '2026-11-27T09:02:00Z',
        users: { total: last.users, new_7d: 14, new_30d: 52, active_7d: last.active_7d, active_30d: last.active_30d, with_premium: 31, in_trial: 9 },
        trial: { trial_days: 30, in_trial: 9, in_trial_paying: 2, ending_3d: 3, ended: 147, converted: 38, paying_now: 31, read_only: 116, conversion_pct: 25.9,
          cohorts: [{ week: '2026-10-05', signups: 12, converted: 3, in_trial: 0 }, { week: '2026-10-12', signups: 15, converted: 4, in_trial: 0 }, { week: '2026-10-19', signups: 11, converted: 2, in_trial: 0 }, { week: '2026-11-16', signups: 9, converted: 1, in_trial: 7 }] },
        devices: {
          total: 168, active_30d: 121,
          platform: [{ key: 'ios', active: 121, total: 168 }],
          os: [{ key: 'ios:26', active: 58, total: 71 }, { key: 'ios:18', active: 41, total: 62 }, { key: 'ios:17', active: 14, total: 22 }, { key: 'ios:16', active: 5, total: 9 }, { key: 'other', active: 3, total: 4 }],
          device_class: [{ key: 'bezny', active: 72, total: 98 }, { key: 'velky', active: 33, total: 44 }, { key: 'maly', active: 13, total: 21 }, { key: 'tablet', active: 3, total: 5 }],
          app_version: [{ key: '1.0.0 (16)', active: 70, total: 74 }, { key: '1.0.0 (15)', active: 31, total: 52 }, { key: '1.0.0 (14)', active: 14, total: 29 }, { key: '1.0.0 (12)', active: 3, total: 9 }, { key: 'other', active: 3, total: 4 }]
        },
        households: { total: last.households, avg_members: 1.4, active_7d: 70, active_30d: 98 },
        pets: {
          total: last.pets, dogs: 118, cats: 84, archived: 7, households_with_pets: 131, avg_per_household: 1.54,
          breeds_top: [{ breed: 'Evropská kočka', count: 41 }, { breed: 'Labradorský retrívr', count: 17 }, { breed: 'Border kolie', count: 12 }, { breed: 'Britská krátkosrstá', count: 9 }, { breed: 'Německý ovčák', count: 6 }, { breed: 'Jack Russell teriér', count: 4 }],
          breeds_other: 52, breed_unknown: 37, with_chip: 118, with_vet: 126, rabies_valid: 104
        },
        records: { medications: 214, preventions: 388, weights: 1260, expenses: 742, health_issues: 96, documents: 58, diary_notes: 530, vaccinations: 301 },
        revenue: {
          estimate: true, paying: 31, trial: 9, not_renewing: 4, mrr_czk: 1783, arr_czk: 21391, mrr_prev_czk: 1085, mrr_prev_day: '2026-10-28',
          by_product: [
            { plan: 'individual', period: 'monthly', price_czk: 69, active: 18, trial: 5, monthly_czk: 1242 },
            { plan: 'individual', period: 'yearly', price_czk: 499, active: 13, trial: 4, monthly_czk: 540.58 },
            { plan: 'family', period: 'monthly', price_czk: 79, active: 0, trial: 0, monthly_czk: 0 },
            { plan: 'family', period: 'yearly', price_czk: 799, active: 0, trial: 0, monthly_czk: 0 }
          ]
        },
        capacity: {
          database: { bytes: Math.round(98 * 1048576), limit_bytes: 524288000, percent: 19.6, warn: false },
          storage: {
            bytes: Math.round(861 * 1048576), files: 1423, limit_bytes: 1073741824, percent: 84.1, warn: true,
            buckets: [{ bucket: 'pet-photos', bytes: Math.round(512 * 1048576), files: 904 }, { bucket: 'documents', bytes: Math.round(301 * 1048576), files: 211 }, { bucket: 'backups', bytes: Math.round(48 * 1048576), files: 308 }]
          }
        },
        state: {
          server_time: '2026-11-27T09:02:00Z', trash_rows: 63, storage_purge_queue: 2,
          cron: [{ job: 'admin-snapshot', last_run: '2026-11-27T03:43:00Z', status: 'succeeded' }, { job: 'purge-trash', last_run: '2026-11-27T03:17:00Z', status: 'succeeded' }]
        }
      }
    };
  }

  /* ---------- Přihlášení (Supabase Auth, heslo + TOTP) a načtení ---------- */

  var IDLE_MS = 15 * 60 * 1000;
  var LOGIN_FAIL = 'Přihlášení se nepovedlo. Zkontrolujte e-mail a heslo, nebo to zkuste za chvíli.';
  var session = null;   // { access, refresh, expiresAt } – jen v paměti
  var factorId = null;  // ověřený TOTP faktor, nebo právě zapisovaný
  var lastActive = Date.now();

  // dřívější verze držely token v úložišti prohlížeče: smazat, nepřebírat
  try { localStorage.removeItem('chlupaci-admin-token'); sessionStorage.removeItem('chlupaci-admin-token'); } catch (e) { /* soukromé okno */ }

  /* Volání /auth/v1: odpověď JSON, při chybě jen stav (text chyby ze serveru se nikde neukazuje). */
  function auth(method, path, body, token) {
    return fetch(SUPABASE + '/auth/v1' + path, {
      method: method,
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + (token || ANON_KEY), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true
    }).then(function (res) {
      return res.text().then(function (t) {
        if (!res.ok) { var err = new Error('auth'); err.status = res.status; throw err; }
        try { return t ? JSON.parse(t) : null; } catch (e) { return null; }
      });
    });
  }
  function setSession(r) {
    if (!r || typeof r.access_token !== 'string' || typeof r.refresh_token !== 'string') throw new Error('auth');
    session = { access: r.access_token, refresh: r.refresh_token, expiresAt: Date.now() + 1000 * (Number(r.expires_in) || 3600) };
  }
  /* aal jen pro volbu dalšího kroku v UI; o přístupu k datům rozhoduje server. */
  function aal(token) {
    try {
      var p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(p + '==='.slice((p.length + 3) % 4))).aal;
    } catch (e) { return null; }
  }
  function fresh() {
    if (session && session.expiresAt - Date.now() > 60000) return Promise.resolve();
    return auth('POST', '/token?grant_type=refresh_token', { refresh_token: session.refresh }).then(setSession);
  }

  function show(view) {
    $('login').hidden = view !== 'login' && view !== 'mfa';
    $('login-form').hidden = view !== 'login';
    $('login-lead').hidden = view !== 'login';
    $('mfa-form').hidden = view !== 'mfa';
    $('dash').hidden = view !== 'dash';
    $('logout').hidden = view !== 'dash' || demo;
    if (view !== 'mfa') clearEnroll();
  }
  function fail(el, msg) { el.textContent = msg; el.hidden = !msg; }
  function busy(form, on) { Array.prototype.forEach.call(form.querySelectorAll('button, input'), function (b) { b.disabled = on; }); }
  function clearEnroll() {
    $('enroll').hidden = true;
    $('enroll-qr').removeAttribute('src');
    $('enroll-secret').textContent = '';
  }

  /* Odhlášení: zrušit relaci na serveru (nejlépe jak to jde), zahodit tokeny a vykreslená data. */
  function logout(msg) {
    var s = session;
    session = null;
    lastData = null;
    factorId = null;
    if (s) auth('POST', '/logout?scope=local', null, s.access).catch(function () { /* stejně je zahozená */ });
    $('panels').textContent = '';
    $('updated').textContent = '';
    $('loaded').textContent = '';
    fail($('dash-error'), '');
    $('password').value = '';
    $('otp').value = '';
    show('login');
    fail($('login-error'), msg || '');
    $('email').focus();
  }

  /* Po hesle: je-li relace aal2, rovnou data; jinak TOTP (ověřený faktor), nebo jednorázový zápis faktoru. */
  function nextStep() {
    if (aal(session.access) === 'aal2') { show('dash'); return load(); }
    return auth('GET', '/user', null, session.access).then(function (user) {
      var totp = (user && Array.isArray(user.factors) ? user.factors : []).filter(function (f) { return f && f.factor_type === 'totp'; });
      var verified = totp.filter(function (f) { return f.status === 'verified'; })[0];
      show('mfa');
      if (verified) { factorId = verified.id; $('otp').focus(); return; }
      // nedokončené zápisy zahodit, jinak Supabase nový nepovolí
      return Promise.all(totp.map(function (f) { return auth('DELETE', '/factors/' + encodeURIComponent(f.id), null, session.access).catch(function () { return null; }); }))
        .then(function () { return auth('POST', '/factors', { factor_type: 'totp', issuer: 'Moji chlupáči', friendly_name: 'Správce' }, session.access); })
        .then(function (r) {
          var t = r && r.totp;
          if (!r || typeof r.id !== 'string' || !t || typeof t.secret !== 'string') throw new Error('auth');
          factorId = r.id;
          // QR kód se kreslí tady z adresy otpauth (qr.js, bez sítě); QR od Supabase se neukázal, proto jen záloha
          var qr = qrDataUri(typeof t.uri === 'string' ? t.uri : '');
          if (qr) $('enroll-qr').src = qr;
          else if (typeof t.qr_code === 'string' && /^data:image\/svg\+xml[;,]/.test(t.qr_code)) {
            var svg = t.qr_code.slice(t.qr_code.indexOf(',') + 1);
            $('enroll-qr').src = 'data:image/svg+xml;charset=utf-8,' + (/^</.test(svg) ? encodeURIComponent(svg) : svg);
          }
          $('enroll-secret').textContent = t.secret;
          $('enroll').hidden = false;
          $('otp').focus();
        });
    });
  }

  /* QR kód z textu (otpauth://totp/...) jako data URI s SVG: bílé pozadí, tichá zóna 4 moduly, jedna cesta pro všechny tmavé moduly */
  function qrDataUri(text) {
    if (!/^otpauth:\/\/totp\//.test(text) || !window.QR) return '';
    try {
      var m = window.QR.create(text, { errorCorrectionLevel: 'M' }).modules, n = m.size, q = 4, d = '';
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (m.get(y, x)) d += 'M' + (x + q) + ' ' + (y + q) + 'h1v1h-1z';
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (n + 2 * q) + ' ' + (n + 2 * q) + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } catch (e) { return ''; }
  }

  function load() {
    if (!session) return logout();
    fail($('dash-error'), '');
    $('refresh').disabled = true;
    var t0 = performance.now();
    return fresh()
      .then(function () { return fetch(API, { headers: { Authorization: 'Bearer ' + session.access }, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }); })
      .then(function (res) {
        if (res.status === 401) { logout('Přihlášení vypršelo. Přihlaste se znovu.'); throw null; }
        if (res.status === 403) { logout('Přístup zamítnut.'); throw null; }
        if (res.status === 429) throw new Error('Příliš mnoho pokusů. Zkuste to za minutu.');
        if (!res.ok) throw new Error('Server odpověděl chybou ' + res.status + '.');
        return res.json();
      })
      .then(function (data) { if (session) render(data, Math.round(performance.now() - t0)); })
      .catch(function (e) {
        if (e === null) return;
        if (e && e.status) return logout('Přihlášení vypršelo. Přihlaste se znovu.');
        fail($('dash-error'), e instanceof TypeError ? 'Server se nepodařilo zavolat (síť nebo CORS).' : e.message);
      })
      .then(function () { $('refresh').disabled = false; });
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = this, email = $('email').value.trim(), password = $('password').value;
    $('password').value = '';
    if (!email || !password) return;
    fail($('login-error'), '');
    busy(form, true);
    auth('POST', '/token?grant_type=password', { email: email, password: password })
      .then(function (r) { setSession(r); return nextStep(); })
      .catch(function () { session = null; logout(LOGIN_FAIL); })
      .then(function () { busy(form, false); });
  });

  $('mfa-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = this, code = $('otp').value.trim();
    $('otp').value = '';
    if (!/^\d{6}$/.test(code) || !session || !factorId) return fail($('login-error'), 'Zadejte šestimístný kód.');
    fail($('login-error'), '');
    busy(form, true);
    var id = encodeURIComponent(factorId);
    auth('POST', '/factors/' + id + '/challenge', {}, session.access)
      .then(function (ch) {
        if (!ch || typeof ch.id !== 'string') throw new Error('auth');
        return auth('POST', '/factors/' + id + '/verify', { challenge_id: ch.id, code: code }, session.access);
      })
      .then(function (r) {
        setSession(r);
        if (aal(session.access) !== 'aal2') throw new Error('auth');
        factorId = null;
        show('dash');
        return load();
      })
      .catch(function (err) {
        if (err && err.status === 401) return logout('Přihlášení vypršelo. Přihlaste se znovu.');
        fail($('login-error'), 'Kód nesedí nebo vypršel. Zkuste nový.');
        $('otp').focus();
      })
      .then(function () { busy(form, false); });
  });

  $('mfa-cancel').addEventListener('click', function () { logout(); });
  $('logout').addEventListener('click', function () { logout(); });
  $('refresh').addEventListener('click', load);

  /* Odhlášení po 15 minutách bez kliknutí, klávesy nebo posunu (i když je karta na pozadí). */
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true, capture: true });
  });
  function idleCheck() {
    if (session && Date.now() - lastActive > IDLE_MS) logout('Odhlášeno po 15 minutách nečinnosti.');
  }
  setInterval(idleCheck, 15000);
  document.addEventListener('visibilitychange', idleCheck);
  window.addEventListener('pagehide', function () { if (session) logout(); });

  if (demo) {
    $('demo-note').hidden = false;
    $('refresh').hidden = true;
    show('dash');
    render(demoData(), null);
  } else {
    show('login');
  }
})();
