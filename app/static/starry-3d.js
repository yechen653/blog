/* ============================================================
   starry-3d.js — 笔触迸发 / 视差层
   ------------------------------------------------------------
   3D 球面月亮已整体删除：Canvas 逐像素采样做得再细，贴图也追不上手绘
   笔触，放大后就是一颗塑料黄球，跟整幅油画不是同一种东西。

   这里只剩两件事：
     · 迸发：第 ④ 幕从月盘盘沿甩出一圈短粗的暖色油笔。纯 SVG path +
       CSS dashoffset 动画，演出期间不占主线程写任何属性。
     · 视差：CSS 3D（perspective + translateZ + rotateX/Y）。文字仍是
       真实 HTML，可选中、可搜索、可自适应。

   body 上不放任何 transform / perspective —— position:fixed 的
   .starry-canvas 会因此失去定位基准，整张画跟着页面滚。
   ============================================================ */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var root = document.documentElement;

  function reduce() {
    return !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function narrow() {
    return !!(window.matchMedia &&
      window.matchMedia('(max-width:700px)').matches);
  }
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ── 1. 笔触迸发：从月盘盘沿向外甩暖笔 ─────────────────────── */
  function burst(o) {
    var svgEl = document.createElementNS(NS, 'svg');
    svgEl.setAttribute('class', 'intro-burst');
    svgEl.setAttribute('viewBox', '0 0 ' + o.W + ' ' + o.H);
    svgEl.setAttribute('preserveAspectRatio', 'none');
    svgEl.setAttribute('aria-hidden', 'true');

    var rr = rng(o.seed || 4409);
    /* 迸发只出"暖笔"，蓝笔交给背景，"月亮自己喷蓝火"说不通 */
    var colors = ['#f7d45c', '#fff3cf', '#ffb347', '#ffe6a3', '#ffd06a', '#ffc25a'];
    var count = o.count || 34, i, a, len, curl, x0, y0, x1, y1, x2, y2, p;

    function ray(ang, dist, ln, width, col, op, dl) {
      var cu = (rr() - .5) * ln * .55;
      var sx = o.x + Math.cos(ang) * dist;
      var sy = o.y + Math.sin(ang) * dist;
      var mx = o.x + Math.cos(ang) * (dist + ln * .55) - Math.sin(ang) * cu;
      var my = o.y + Math.sin(ang) * (dist + ln * .55) + Math.cos(ang) * cu;
      var ex = o.x + Math.cos(ang) * (dist + ln) - Math.sin(ang) * cu * .35;
      var ey = o.y + Math.sin(ang) * (dist + ln) + Math.cos(ang) * cu * .35;
      var el = document.createElementNS(NS, 'path');
      el.setAttribute('d', 'M' + sx.toFixed(1) + ' ' + sy.toFixed(1) +
        'Q' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' +
        ex.toFixed(1) + ' ' + ey.toFixed(1));
      el.setAttribute('stroke', col);
      el.setAttribute('stroke-width', width.toFixed(1));
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('opacity', op.toFixed(2));
      el.style.setProperty('--len', Math.ceil(Math.hypot(ex - sx, ey - sy) * 1.15).toString());
      el.style.setProperty('--delay', dl.toFixed(2) + 's');
      svgEl.appendChild(el);
    }

    /* 从盘沿往外甩：短、粗、带弧度。之前长度给到 1.5~3.9 倍月半径、
       宽度只有 2.6~8.8，画出来是一圈细长直线 —— 像激光不像油画。 */
    for (i = 0; i < count; i++) {
      a = (i / count) * Math.PI * 2 + (rr() - .5) * .46;
      len = o.r * (.42 + rr() * .72);
      var dist = o.r * (.78 + rr() * .18);
      var col = colors[i % colors.length];
      var op = .56 + rr() * .36;
      var dl = rr() * .34;
      ray(a, dist, len, 5.2 + rr() * 8.4, col, op, dl);
      /* 一支笔刷过去会留下并行颜料道，补一笔才像厚涂 */
      if (rr() < .62) {
        var off = (rr() < .5 ? -1 : 1) * (5 + rr() * 7);
        ray(a + off / (dist + len) * .9, dist + rr() * 6,
            len * (.5 + rr() * .35), 2.4 + rr() * 3.4,
            colors[(i + 3) % colors.length], op * .8, dl + .06);
      }
    }
    document.body.appendChild(svgEl);

    return {
      el: svgEl,
      play: function () { svgEl.classList.add('is-on'); },
      fade: function () { svgEl.classList.add('is-fade'); },
      destroy: function () {
        if (svgEl.parentNode) svgEl.parentNode.removeChild(svgEl);
      }
    };
  }

  /* ── 2. 视差：只写两个 CSS 变量，元素用 var() 自行换算 ───────── */
  var bound = false, pending = false, rafp = 0;

  function apply() {
    pending = false;
    root.style.setProperty('--px', px.toFixed(3));
    root.style.setProperty('--py', py.toFixed(3));
  }
  var px = 0, py = 0;

  function onMove(ev) {
    px = (ev.clientX / Math.max(1, window.innerWidth) - .5) * 2;
    py = (ev.clientY / Math.max(1, window.innerHeight) - .5) * 2;
    if (pending) return;
    pending = true;
    rafp = requestAnimationFrame(apply);
  }

  function enable() {
    if (bound || narrow() || reduce()) return;
    if (window.SiteIntro && window.SiteIntro.isPlaying && window.SiteIntro.isPlaying()) return;
    bound = true;
    window.addEventListener('mousemove', onMove, { passive: true });
  }
  function disable() {
    if (!bound) return;
    bound = false;
    window.removeEventListener('mousemove', onMove);
    cancelAnimationFrame(rafp);
    pending = false;
    root.style.setProperty('--px', '0');
    root.style.setProperty('--py', '0');
  }

  /* ── 3. 状态同步：星月夜 + 展示态 + 未减弱动效 才开 3D ───────── */
  function sync() {
    var on = root.dataset.theme === 'starry' &&
             root.dataset.view !== 'reading' &&
             !reduce() && !narrow();
    root.classList.toggle('is-3d', on);
    if (on) enable(); else disable();
  }

  document.addEventListener('site:themechange', sync);
  document.addEventListener('site:intro', function () {
    if (!root.classList.contains('is-3d')) return;
    if (window.SiteIntro && window.SiteIntro.isPlaying && window.SiteIntro.isPlaying()) disable();
    else enable();
  });
  if (window.MutationObserver) {
    new MutationObserver(sync).observe(root, {
      attributes: true, attributeFilter: ['data-view', 'data-theme']
    });
  }
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.addEventListener) mq.addEventListener('change', sync);
    else if (mq.addListener) mq.addListener(sync);
    var mq2 = window.matchMedia('(max-width:700px)');
    if (mq2.addEventListener) mq2.addEventListener('change', sync);
  }
  window.addEventListener('resize', sync, { passive: true });

  sync();

  window.Starry3D = {
    burst: burst,
    parallax: { enable: enable, disable: disable },
    sync: sync,
    narrow: narrow,
    reduce: reduce
  };
})();
