// Stránka 404: adresa /pozvanka/<kód> na GitHub Pages neexistuje, ale patří pozvánce do domácnosti. Místo hlášky o nenalezené stránce ukážeme návod.
// Kód z adresy se nikam nevypisuje, neukládá ani neposílá: skript jen porovná tvar cesty a přepne dva hotové bloky. Bez JavaScriptu zůstane obecná hláška s odkazem na návod.
(function () {
  if (!/^\/pozvanka\/[A-Za-z0-9%+\-]{4,40}\/?$/.test(location.pathname)) return;
  var generic = document.getElementById('nenalezeno');
  var invite = document.getElementById('pozvanka');
  if (!generic || !invite) return;
  generic.hidden = true;
  invite.hidden = false;
  document.title = 'Pozvánka do domácnosti – Moji chlupáči';
})();
