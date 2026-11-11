/* Moji chlupáči: efekty správcovského přehledu. Záře za kurzorem v kartách, zvýraznění právě viditelné sekce v postranním panelu a odpočítávání velkých čísel. Jen vzhled, žádná data, žádná síť; při omezeném pohybu se čísla neanimují. */
(function () {
  var panels = document.getElementById('panels');
  if (!panels) return;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var nf = new Intl.NumberFormat('cs-CZ');

  // záře za kurzorem: jedno delegované pohyb přes celý panel
  panels.addEventListener('pointermove', function (e) {
    var c = e.target.closest && e.target.closest('.card');
    if (!c) return;
    var r = c.getBoundingClientRect();
    c.style.setProperty('--x', (e.clientX - r.left) + 'px');
    c.style.setProperty('--y', (e.clientY - r.top) + 'px');
  });

  // odpočítávání: čísla typu "174", "1 330 Kč", "25,9 %"; formát se zachová, počet desetin také
  function countUp(el) {
    if (reduce || el.dataset.counted) return;
    el.dataset.counted = '1';
    var txt = el.textContent, m = txt.match(/^([^\d-]*)(-?[\d\s .,]+)(.*)$/);
    if (!m) return;
    var raw = m[2].replace(/[\s ]/g, '').replace(',', '.'), target = parseFloat(raw);
    if (!isFinite(target)) return;
    var dec = (raw.split('.')[1] || '').length, t0 = performance.now(), dur = 900;
    var fmt = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    (function step(t) {
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = m[1] + fmt.format(target * e) + m[3];
      if (p < 1) requestAnimationFrame(step); else el.textContent = txt;
    })(t0);
  }
  function counts() { [].forEach.call(panels.querySelectorAll('.hero-num'), countUp); }
  new MutationObserver(counts).observe(panels, { childList: true });
  counts();

  // postranní navigace: právě viditelná sekce
  var links = [].slice.call(document.querySelectorAll('.side-nav a[href^="#sec-"]')), byId = {};
  links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
  function mark(id) { links.forEach(function (a) { a.classList.toggle('on', a === byId[id]); }); }
  // zvýrazní sekci, která právě prochází horní třetinou okna (bez IntersectionObserver, ať to funguje i v pozadí)
  var ticking = false;
  function spy() {
    ticking = false;
    var line = innerHeight * 0.33, cur = null;
    Object.keys(byId).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (r.top <= line && r.bottom > line) cur = id;
    });
    if (cur) mark(cur);
  }
  function onScroll() { if (!ticking) { ticking = true; setTimeout(spy, 50); } }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  new MutationObserver(onScroll).observe(panels, { childList: true });
  onScroll();
  links.forEach(function (a) { a.addEventListener('click', function () { mark(a.getAttribute('href').slice(1)); }); });
})();
