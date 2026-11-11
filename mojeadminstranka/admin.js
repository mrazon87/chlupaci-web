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
    var prods = r.by_product || [];
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
    return card({ id: 'sec-zkouska', cls: 'd7 m12', icon: 'funnel', title: 'Zkušební doba a konverze', note: int(t.trial_days || 14) + ' dní zdarma' }, [
      funnel,
      mini([['Zaplatili během zkoušky', int(t.in_trial_paying)], ['Po zkoušce jen ke čtení', int(t.read_only), pctText(t.read_only, t.ended)], ['Končí do 3 dní', int(t.ending_3d)]]),
      h('h3', null, 'Týdenní kohorty registrací'),
      coh,
      cohorts.length ? h('div', 'legend small', [h('span', null, [h('i', 'sw a'), 'Zaplatili']), h('span', null, [h('i', 'sw mint'), 'Ve zkoušce']), h('span', null, [h('i', 'sw rest'), 'Ostatní'])]) : null,
      note('Zkušební doba = 14 dní od založení účtu, jako v aplikaci. Premium = vlastní předplatné nebo člen rodinného Premium.')
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
    return card({ cls: 'd12 m12 slim', icon: 'mail', title: 'Podpora' }, [
      note('Zprávy chodí na podpůrný e-mail do iCloudu. Čtení přímo tady přibude později.'),
      a
    ]);
  }

  /* ---------- Vykreslení ---------- */

  function render(data, ms) {
    var s = data.stats || {}, series = data.series || [];
    var box = $('panels');
    box.textContent = '';
    [heroCard(s, series), growthCard(s, series), petsCard(s), revenueCard(s, series), trialCard(s), devicesCard(s), capacityCard(s, series), externalCard(data.external), breedsCard(s), recordsCard(s), householdsCard(s), stateCard(s, ms), supportCard()]
      .forEach(function (p) { box.appendChild(p); });
    $('updated').textContent = 'Stav dat k ' + dateTime(s.generated_at);
    $('loaded').textContent = 'Načteno v ' + new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- Ukázková data (?demo=1) ---------- */

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
      external: { facebook: { status: 'ok', name: 'Moji chlupáči', usage: { call_count: 3, total_cputime: 1.5, total_time: 2 } }, apple: { status: 'ok', downloads: 41, units: 52, missing: 1, days: [] }, revenuecat: { status: 'ok', currency: 'CZK', metrics: [{ id: 'active_trials', name: 'Zkušební doby', value: 9, unit: '' }, { id: 'active_subscriptions', name: 'Předplatná', value: 31, unit: '' }, { id: 'mrr', name: 'MRR', value: 1480, unit: 'Kč' }] }, supabase: { status: 'ok', interval: '7day', rest: 18420, auth: 1310, storage: 940, realtime: 0 }, google: { status: 'unconfigured' }, telemetrydeck: { status: 'unconfigured' } },
      series: series,
      stats: {
        generated_at: '2026-11-27T09:02:00Z',
        users: { total: last.users, new_7d: 14, new_30d: 52, active_7d: last.active_7d, active_30d: last.active_30d, with_premium: 31, in_trial: 9 },
        trial: { trial_days: 14, in_trial: 9, in_trial_paying: 2, ending_3d: 3, ended: 147, converted: 38, paying_now: 31, read_only: 116, conversion_pct: 25.9,
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
          estimate: true, paying: 31, trial: 9, not_renewing: 4, mrr_czk: 1330, arr_czk: 15960, mrr_prev_czk: 1085, mrr_prev_day: '2026-10-28',
          by_product: [
            { plan: 'individual', period: 'monthly', price_czk: 49, active: 14, trial: 4, monthly_czk: 686 },
            { plan: 'individual', period: 'yearly', price_czk: 499, active: 8, trial: 3, monthly_czk: 332.67 },
            { plan: 'family', period: 'monthly', price_czk: 79, active: 5, trial: 1, monthly_czk: 395 },
            { plan: 'family', period: 'yearly', price_czk: 799, active: 4, trial: 1, monthly_czk: 266.33 }
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
          if (typeof t.qr_code === 'string' && /^data:image\/svg\+xml[;,]/.test(t.qr_code)) {
            // Supabase vrací SVG neescapované (obsahuje #, takže by se useklo); do <img> jde jen zakódované
            var svg = t.qr_code.slice(t.qr_code.indexOf(',') + 1);
            $('enroll-qr').src = 'data:image/svg+xml;charset=utf-8,' + (/^</.test(svg) ? encodeURIComponent(svg) : svg);
          }
          $('enroll-secret').textContent = t.secret;
          $('enroll').hidden = false;
          $('otp').focus();
        });
    });
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
