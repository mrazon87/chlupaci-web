// Nepovinné vylepšení: zvýrazní v obsahu kapitolu, kterou právě čtete. Bez JavaScriptu web funguje stejně.
(function () {
  var links = document.querySelectorAll('.toc a[href^="#"]');
  if (!links.length || !('IntersectionObserver' in window)) return;
  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
  function mark(id) {
    links.forEach(function (a) { a.removeAttribute('aria-current'); });
    if (byId[id]) byId[id].setAttribute('aria-current', 'true');
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) mark(e.target.id); });
  }, { rootMargin: '0px 0px -75% 0px' });
  Object.keys(byId).forEach(function (id) {
    var h = document.getElementById(id);
    if (h) io.observe(h);
  });
  mark(links[0].getAttribute('href').slice(1));
})();
