// Úvod: jemné objevení sekcí při rolování. Bez JavaScriptu nebo s omezeným pohybem je vše vidět hned.
(function () {
  var root = document.documentElement;
  var items = document.querySelectorAll('.rv');
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still || !('IntersectionObserver' in window)) {
    root.classList.remove('js');
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  items.forEach(function (el) {
    // sourozenci v mřížce se objevují postupně (40 ms)
    var i = 0, s = el;
    while ((s = s.previousElementSibling)) if (s.classList.contains('rv')) i++;
    el.style.setProperty('--d', Math.min(i, 6) * 40 + 'ms');
    io.observe(el);
  });
})();
