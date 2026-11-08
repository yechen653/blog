/* ============================================================
   starry-world.js — 《星月夜》三维空间演出与主页空间层
   艺术原则：月亮与旋涡来自梵高原作的形态语言；不使用科幻星云、
   写实月球或霓虹能量束。CSS 3D 负责空间层次，SVG 笔触负责油画感。
   ============================================================ */
(function () {
  'use strict';
  var root = document.documentElement;
  var active = false, timers = [], world = null, pointerFrame = 0;
  var depthNodes = [
    '.masthead-inner', '.hero', '.layout > main', '.sidebar', '.site-footer',
    '.section-label', '.widget--box', '.link-card', '.widget-list li',
    '.widget--back', '.toolbar', '#list .card', '.detail', '.pager',
    '.footer-row', '.nav-link', '.brand'
  ];
  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function applyDepth() {
    if (root.dataset.theme !== 'starry') return;
    depthNodes.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (el) {
        if (el.closest('.starry-awakening')) return;
        el.classList.add('starry-depth');
      });
    });
  }
  function makeWorld() {
    var host = document.createElement('div');
    host.className = 'starry-awakening';
    host.setAttribute('aria-hidden', 'true');
    host.innerHTML =
      '<div class="awakening-vignette"></div>' +
      '<div class="awakening-moon-space">' +
        '<div class="awakening-moon">' +
          '<i class="moon-edge"></i><i class="moon-face"></i>' +
          '<i class="moon-impasto"></i><i class="moon-glint"></i>' +
        '</div>' +
      '</div>' +
      '<svg class="awakening-strokes" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">' +
        '<g class="stroke-blue">' +
          '<path d="M610 380 C470 240 280 250 180 390 C90 520 190 660 360 620 C510 585 530 450 420 390 C330 340 260 410 300 480"/>' +
          '<path d="M610 380 C760 220 970 250 1060 390 C1140 520 1040 660 870 620 C720 585 700 450 810 390 C900 340 970 410 930 480"/>' +
          '<path d="M610 380 C520 110 330 70 220 180 C150 250 190 320 270 330"/>' +
          '<path d="M610 380 C700 110 890 70 1000 180 C1070 250 1030 320 950 330"/>' +
        '</g>' +
        '<g class="stroke-gold">' +
          '<path d="M610 380 C730 310 850 330 900 420 C950 510 880 570 800 540"/>' +
          '<path d="M610 380 C490 310 370 330 320 420 C270 510 340 570 420 540"/>' +
          '<path d="M610 380 C650 270 730 210 820 220"/>' +
        '</g>' +
        '<g class="stroke-cream">' +
          '<path d="M610 380 C450 180 250 180 130 300"/>' +
          '<path d="M610 380 C770 180 970 180 1090 300"/>' +
        '</g>' +
      '</svg>';
    document.body.appendChild(host);
    return host;
  }
  function clearTimers() {
    timers.forEach(function (id) { clearTimeout(id); });
    timers = [];
  }
  function startAwakening() {
    if (active || reduced()) return;
    active = true;
    clearTimers();
    world = makeWorld();
    /* 对应原时间线：草图完成后绘月，月亮苏醒，再由笔触扩展成整幅《星月夜》。 */
    timers.push(setTimeout(function () { world.classList.add('is-painted'); }, 2500));
    timers.push(setTimeout(function () { world.classList.add('is-awake'); }, 3200));
    timers.push(setTimeout(function () { world.classList.add('is-spreading'); }, 4050));
    timers.push(setTimeout(function () { world.classList.add('is-world'); }, 5150));
  }
  function stopAwakening() {
    clearTimers();
    active = false;
    if (world && world.parentNode) world.parentNode.removeChild(world);
    world = null;
  }
  function onPointer(ev) {
    if (pointerFrame || reduced() || root.dataset.theme !== 'starry') return;
    pointerFrame = requestAnimationFrame(function () {
      pointerFrame = 0;
      var x = (ev.clientX / Math.max(1, window.innerWidth) - .5);
      var y = (ev.clientY / Math.max(1, window.innerHeight) - .5);
      root.style.setProperty('--space-tilt-x', (x * 2.2).toFixed(2) + 'deg');
      root.style.setProperty('--space-tilt-y', (-y * 1.8).toFixed(2) + 'deg');
    });
  }
  document.addEventListener('site:intro', function (ev) {
    if (ev.detail && ev.detail.playing) startAwakening();
    else stopAwakening();
  });
  document.addEventListener('site:themechange', function (ev) {
    if (ev.detail && ev.detail.to === 'starry') {
      applyDepth();
      document.addEventListener('pointermove', onPointer, { passive: true });
    } else {
      stopAwakening();
      document.removeEventListener('pointermove', onPointer);
      document.querySelectorAll('.starry-depth').forEach(function (el) { el.classList.remove('starry-depth'); });
      root.style.removeProperty('--space-tilt-x');
      root.style.removeProperty('--space-tilt-y');
    }
  });
  if (root.dataset.theme === 'starry') {
    applyDepth();
    document.addEventListener('pointermove', onPointer, { passive: true });
  }
  window.StarryWorld = { start: startAwakening, stop: stopAwakening, refresh: applyDepth };
})();