/* Moji chlupáči: navigace. Rozbalovací nabídka Rady (klepnutím i najetím) a mobilní menu. Bez JavaScriptu zůstanou odkazy v patičce. */
(function () {
  var nav = document.getElementById('gnav');
  if (!nav) return;
  var burger = nav.querySelector('.gnav-burger'), dd = nav.querySelector('.gnav-dd'), btn = dd && dd.querySelector('button');
  var hoverOk = matchMedia('(hover: hover) and (min-width: 861px)'), timer = 0;
  function setDd(open) { if (!dd) return; dd.classList.toggle('open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
  function setMenu(open) { nav.classList.toggle('open', open); burger.setAttribute('aria-expanded', open ? 'true' : 'false'); document.documentElement.classList.toggle('nolock', open); }
  burger.addEventListener('click', function () { setMenu(!nav.classList.contains('open')); });
  if (btn) {
    btn.addEventListener('click', function () { setDd(!dd.classList.contains('open')); });
    dd.addEventListener('mouseenter', function () { if (hoverOk.matches) { clearTimeout(timer); setDd(true); } });
    dd.addEventListener('mouseleave', function () { if (hoverOk.matches) { timer = setTimeout(function () { setDd(false); }, 160); } });
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setDd(false); setMenu(false); } });
  document.addEventListener('click', function (e) { if (dd && !dd.contains(e.target)) setDd(false); });
  nav.addEventListener('click', function (e) { if (e.target.closest('a') && nav.classList.contains('open')) setMenu(false); });
  matchMedia('(min-width: 861px)').addEventListener('change', function () { setMenu(false); });
})();
