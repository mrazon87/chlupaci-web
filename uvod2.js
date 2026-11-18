// Úvod: pohyb a plovoucí lišta. Bez JavaScriptu nebo s omezeným pohybem je vše vidět hned a čísla mají konečné hodnoty přímo v HTML.
(function () {
  var root = document.documentElement;
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ok = 'IntersectionObserver' in window;
  root.classList.add('js');
  if (!still && ok) root.classList.add('motion');

  document.addEventListener('DOMContentLoaded', function () {
    if (!root.classList.contains('motion')) {
      barInit();
      return;
    }
    // vynoření sekcí při rolování
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.rv').forEach(function (el) { io.observe(el); });

    // osa dne se plní podle rolování (transform)
    var tl = document.querySelector('.tlw');
    if (tl) {
      var tick = false;
      var upd = function () {
        tick = false;
        var r = tl.getBoundingClientRect();
        var p = Math.min(1, Math.max(0, (innerHeight * 0.6 - r.top) / r.height));
        tl.style.setProperty('--p', p);
      };
      addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(upd); } }, { passive: true });
      upd();
    }

    // napočítání čísel (konečná hodnota je v HTML, animace ji jen přehraje)
    document.querySelectorAll('.fa b[data-n]').forEach(function (b) {
      var n = +b.getAttribute('data-n'), t = b.firstChild;
      if (!t || t.nodeType !== 3) return;
      var o = new IntersectionObserver(function (es) {
        if (!es[0].isIntersecting) return;
        o.disconnect();
        var s = null;
        var f = function (ts) {
          s = s || ts;
          var k = Math.min(1, (ts - s) / 900);
          t.textContent = String(Math.round(n * k));
          if (k < 1) requestAnimationFrame(f);
        };
        t.textContent = '0';
        requestAnimationFrame(f);
      });
      o.observe(b);
    });
    barInit();
  });

  // plovoucí lišta: objeví se po odrolování úvodu, jde zavřít (do dalšího načtení stránky; nic se neukládá)
  function barInit() {
    var bar = document.getElementById('sticky'), hero = document.getElementById('hero');
    if (!bar || !hero) return;
    var closed = false;
    var show = function (on) {
      if (closed && on) return;
      bar.hidden = !on;
      root.classList.toggle('has-bar', on);
    };
    bar.querySelector('.st-x').addEventListener('click', function () { closed = true; show(false); });
    var check = function () { show(hero.getBoundingClientRect().bottom < 0); };
    var tick = false;
    addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(function () { tick = false; check(); }); } }, { passive: true });
    check();
  }
})();
