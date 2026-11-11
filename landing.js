/* Moji chlupáči: úvodní stránka. Sklon telefonu, paralaxa lístků, záře za kurzorem, magnetická tlačítka, rozsvěcení manifestu a vstupy sekcí.
   Při omezeném pohybu a bez kurzoru (dotyk) se pohyb za kurzorem nezapne. Vše vlastním souborem kvůli CSP (script-src 'self'). */
(function(){
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches,fine=matchMedia('(hover:hover)').matches;
  var stage=document.getElementById('stage'),tilt=document.getElementById('tilt'),cur=document.getElementById('cur');
  var PAW='<svg class="pop" viewBox="0 0 24 24"><circle cx="6" cy="10" r="2"/><circle cx="9.5" cy="5.5" r="2"/><circle cx="14.5" cy="5.5" r="2"/><circle cx="18" cy="10" r="2"/><path d="M7.5 17c0-3 2.2-5.5 4.5-5.5s4.5 2.5 4.5 5.5c0 1.8-1.6 2.5-4.5 2.5S7.5 18.8 7.5 17z"/></svg>';
  function burst(x,y,parent){var w=document.createElement('div');w.innerHTML=PAW;var p=w.firstChild;p.style.left=x+'px';p.style.top=y+'px';
    p.style.setProperty('--x',(Math.random()*180-90)+'px');p.style.setProperty('--y',(-50-Math.random()*110)+'px');p.style.setProperty('--r',(Math.random()*120-60)+'deg');
    parent.appendChild(p);setTimeout(function(){p.remove()},1000)}
  /* tlačítka v telefonu: packy */
  [].forEach.call(document.querySelectorAll('#auth button'),function(b){b.addEventListener('click',function(){var r=b.getBoundingClientRect(),s=stage.getBoundingClientRect();
    for(var i=0;i<6;i++)setTimeout(function(){burst(r.left-s.left+r.width/2,r.top-s.top+10,stage)},i*70)})});
  if(!reduce&&fine){
    /* sklon telefonu a paralaxa lístků podle kurzoru */
    var raf=0,px=0,py=0;
    window.addEventListener('pointermove',function(e){px=e.clientX;py=e.clientY;
      if(!raf)raf=requestAnimationFrame(function(){raf=0;
        cur.style.transform='translate3d('+px+'px,'+py+'px,0)';cur.classList.add('on');
        var r=stage.getBoundingClientRect(),dx=(px-(r.left+r.width/2))/(innerWidth/2),dy=(py-(r.top+r.height/2))/(innerHeight/2);
        dx=Math.max(-1,Math.min(1,dx));dy=Math.max(-1,Math.min(1,dy));
        stage.style.setProperty('--ry',(dx*14).toFixed(2));stage.style.setProperty('--rx',(-dy*10).toFixed(2));stage.style.setProperty('--mx',dx.toFixed(3));stage.style.setProperty('--my',dy.toFixed(3));
      })});
    /* kurzorová záře v kartách */
    [].forEach.call(document.querySelectorAll('.cell,.f'),function(c){c.addEventListener('pointermove',function(e){var r=c.getBoundingClientRect();c.style.setProperty('--x',(e.clientX-r.left)+'px');c.style.setProperty('--y',(e.clientY-r.top)+'px')})});
    /* magnetická tlačítka */
    [].forEach.call(document.querySelectorAll('[data-mag]'),function(b){
      b.addEventListener('pointermove',function(e){var r=b.getBoundingClientRect();b.style.transform='translate('+((e.clientX-r.left-r.width/2)*.18).toFixed(1)+'px,'+((e.clientY-r.top-r.height/2)*.3).toFixed(1)+'px)'});
      b.addEventListener('pointerleave',function(){b.style.transform=''})});
  }
  /* manifest: slova se rozsvítí, jakmile přejdou nad spodní třetinu okna */
  var m=document.getElementById('manifest');m.innerHTML=m.textContent.split(' ').map(function(w){return '<span>'+w+'</span>'}).join(' ');
  var words=[].slice.call(m.children);
  function lit(){var line=innerHeight*.78;words.forEach(function(w){w.classList.toggle('lit',w.getBoundingClientRect().top<line)})}
  var ticking=false;addEventListener('scroll',function(){if(!ticking){ticking=true;requestAnimationFrame(function(){ticking=false;lit()})}},{passive:true});lit();
  /* vstupy sekcí */
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});
    [].forEach.call(document.querySelectorAll('.rv'),function(el){io.observe(el)})}else{[].forEach.call(document.querySelectorAll('.rv'),function(el){el.classList.add('in')})}
})();
