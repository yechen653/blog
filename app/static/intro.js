/* ============================================================
   intro.js — 星月夜揭幕演出（绘制界面本身的过程）
   ------------------------------------------------------------
   借用的是「检视画面」的演出语法，不绘制任何武器轮廓：
   全程画的都是个人主页 / 博客页的版式线稿。

   与上一版的本质区别：
     · 演出【不是】一次性覆盖层。线条不消失，结束后由
       StarryCanvas.adopt() 接回常驻层，定格为最终界面的一部分。
     · ⑤ 不再是「整页一起淡入」：真实 DOM 节点按版式顺序
       inherit 涡旋末态，逐个旋正 / 落位 / 定形，动势连续衰减。
     · 几何、采样、厚涂笔触全部复用 starry-canvas.js，
       保证「演出画出来的」与「首屏静态那张」是同一张画。

   时间线（桌面约 5.0s，移动端整体 ×0.72）：
     ① 空白画布 ② 油画粗线稿 ③ 厚涂成团 ④ 涡心公转
     ⑤ 收笔定格 ⑥ 圆形换幕 ⑦ 元素归位 + 交接定格
   ============================================================ */
(function () {
  'use strict';

  var SC = window.StarryCanvas;
  if (!SC) { console.error('[intro] 缺少 starry-canvas.js'); return; }

  var C = window.SITE_CONFIG || {};
  var T = C.themes || {};
  var svg = SC.svg;

  var TIMING = { blank: 260, sketch: 1500, impasto: 700, vortex: 850,
                 settle: 150, night: 560, reveal: 950 };
  var SPEED = SC.mobile ? .72 : 1;
  var SPIN_MAX = SC.spinMax;

  /* 归位节点：细粒度到卡片 / 段落 / 链接，而不是 body 的几个大块 */
  var REVEAL_SELECTORS = [
    '.masthead-inner', '.brand', '.nav', '.kicker', '.hero-title', '.hero-meta',
    '.section-label', '.prose p', '.widget-list li', '.widget--box',
    '.section-note', '.link-card', '.widget--back', '.toolbar',
    '#list .card', '.pager', '.detail', '.footer-row', '.footer-word'
  ];

  var playing = false, raf = 0, overlay = null, pageEls = [], disposers = [];

  function reduce() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function on(target, type, fn) {
    target.addEventListener(type, fn);
    disposers.push(function () { target.removeEventListener(type, fn); });
  }
  /* 温和的 back-out：落位时带一点回弹，不做夸张弹性 */
  function backOut(u) {
    var t = u - 1;
    return 1 + 2.2 * t * t * t + 1.2 * t * t;
  }

  /* ── 舞台 ─────────────────────────────────────────────────── */
  function build(geo) {
    var W = geo.W, H = geo.H, cx = geo.cx, cy = geo.cy;
    var vcx = cx - geo.sx, vcy = cy - geo.sy;   /* CSS clip-path 用视口坐标 */

    var ov = document.createElement('div');
    ov.className = 'intro-overlay';
    ov.setAttribute('aria-hidden', 'true');

    var canvas = document.createElement('div');
    canvas.className = 'intro-canvas';
    ov.appendChild(canvas);

    var night = document.createElement('div');
    night.className = 'intro-night';
    for (var i = 0; i < 26; i++) {
      var star = document.createElement('span');
      star.className = 'intro-star';
      var sx = ((i * 73 + 19) % 97) / 97, sy = ((i * 41 + 7) % 89) / 89;
      var size = 2 + (i % 4);
      star.style.left = (sx * 100).toFixed(1) + '%';
      star.style.top = (sy * 100).toFixed(1) + '%';
      star.style.width = star.style.height = size + 'px';
      star.style.opacity = (.35 + (i % 5) * .12).toFixed(2);
      night.appendChild(star);
    }
    var swirl = svg('svg', { 'class': 'intro-swirl', viewBox: '0 0 ' + W + ' ' + H,
                             preserveAspectRatio: 'none' });
    for (var r = 52, j = 0; r < Math.max(W, H) * .9; r += 52, j++) {
      var a0 = -.6 + j * .26, a1 = a0 + 4.5;
      swirl.appendChild(svg('path', {
        d: 'M' + (vcx + r * Math.cos(a0)).toFixed(1) + ' ' + (vcy + r * Math.sin(a0)).toFixed(1) +
           ' A' + r + ' ' + r + ' 0 1 1 ' +
           (vcx + r * Math.cos(a1)).toFixed(1) + ' ' + (vcy + r * Math.sin(a1)).toFixed(1),
        fill: 'none', stroke: j % 3 === 0 ? '#f2c94c' : (j % 2 ? '#3a7bc8' : '#1b4f8f'),
        'stroke-width': j % 3 === 0 ? 2.6 : 3.6,
        'stroke-dasharray': (16 + j % 4 * 4) + ' ' + (12 + j % 3 * 5),
        'stroke-linecap': 'round', opacity: .55
      }));
    }
    night.appendChild(swirl);
    ov.appendChild(night);

    /* 所有笔画都在【文档坐标】里；shift 组把它对齐到当前视口。
       adopt 时整组移进常驻层，坐标体系不变。 */
    var field = svg('svg', { 'class': 'intro-svg', viewBox: '0 0 ' + W + ' ' + H,
                             preserveAspectRatio: 'none' });
    var gShift = svg('g', { 'class': 'paint-shift',
      transform: 'translate(' + (-geo.sx).toFixed(1) + ',' + (-geo.sy).toFixed(1) + ')' });
    var gLines = svg('g', {});
    var gVortex = svg('g', { opacity: '0' });
    var gStrokes = svg('g', { opacity: '0' });
    gShift.appendChild(gLines);
    gShift.appendChild(gVortex);
    gShift.appendChild(gStrokes);
    field.appendChild(gShift);

    /* 飞白：一个平铺的「颗粒」图案做 mask，在粗线上打出细密断口，
       像干笔扫过画布。只用一个 pattern + 一个 rect，不建上百节点。
       adopt 时会被移除（defs 留在 overlay 里，不能跟着进常驻层）。 */
    var defs = svg('defs', {});
    var pat = svg('pattern', { id: 'intro-grain', width: 38, height: 38,
                               patternUnits: 'userSpaceOnUse' });
    pat.appendChild(svg('rect', { x: 0, y: 0, width: 38, height: 38, fill: '#fff' }));
    for (var gk = 0; gk < 7; gk++) {
      pat.appendChild(svg('ellipse', {
        cx: (gk * 23 + 7) % 38, cy: (gk * 17 + 5) % 38,
        rx: 1.1 + (gk % 3) * .9, ry: .8 + (gk % 2) * .7,
        fill: '#000', opacity: .55
      }));
    }
    defs.appendChild(pat);
    var mask = svg('mask', { id: 'intro-grain-mask', maskUnits: 'userSpaceOnUse',
                             x: -3000, y: -3000, width: 9000, height: 14000 });
    mask.appendChild(svg('rect', { x: -3000, y: -3000, width: 9000, height: 14000,
                                   fill: 'url(#intro-grain)' }));
    defs.appendChild(mask);
    field.appendChild(defs);
    gLines.setAttribute('mask', 'url(#intro-grain-mask)');

    [24, 42, 62, 84].forEach(function (rr, k) {
      gVortex.appendChild(svg('circle', {
        cx: cx, cy: cy, r: rr * (SC.mobile ? .7 : 1), fill: 'none',
        stroke: k % 2 ? '#3a7bc8' : '#0e2a52',
        'stroke-width': 4 - k * .4,
        'stroke-dasharray': (13 + k * 2) + ' ' + (9 + k),
        'stroke-linecap': 'round'
      }));
    });
    gVortex.appendChild(svg('circle', { cx: cx, cy: cy, r: 7, fill: '#f2c94c' }));
    ov.appendChild(field);

    var brush = document.createElement('div');
    brush.className = 'intro-brush';
    brush.innerHTML =
      '<svg viewBox="0 0 76 76" aria-hidden="true">' +
        '<path d="M64 4 L36 42" stroke="#6b4a2a" stroke-width="8" stroke-linecap="round"/>' +
        '<path d="M36 42 L12 64 L20 70 L42 48 Z" fill="#2b1c10"/>' +
        '<path d="M12 64 L8 71" stroke="#1b4f8f" stroke-width="5" stroke-linecap="round"/>' +
      '</svg>';
    ov.appendChild(brush);

    var skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'intro-skip';
    skip.textContent = T.skip || '跳过';
    ov.appendChild(skip);

    document.body.appendChild(ov);
    return { ov: ov, night: night, gLines: gLines, gStrokes: gStrokes,
             gVortex: gVortex, brush: brush, skip: skip,
             vcx: vcx, vcy: vcy };
  }

  /* ── 草图粗线：一条线叠 3 层不同宽度 / 透明度 / 偏移，
         模拟颜料堆边；三层共享同一个 dashoffset 生长。 ──────── */
  var LINE_LAYERS = [
    { w: 7.2, o: .30, dx: 0,    dy: 0,    c: '#0e2a52' },
    { w: 4.4, o: .88, dx: 0,    dy: 0,    c: '#1b4f8f' },
    { w: 1.5, o: .55, dx: -1.2, dy: -1.4, c: '#7aa6d8' }
  ];

  /* ── 页面隐藏 / 交接 ──────────────────────────────────────── */
  function hidePage() {
    pageEls = Array.prototype.filter.call(document.body.children, function (el) {
      var t = el.tagName;
      return t !== 'SCRIPT' && t !== 'TEMPLATE' && t !== 'NOSCRIPT' &&
             !el.classList.contains('intro-overlay') &&
             !el.classList.contains('starry-canvas');
    });
    pageEls.forEach(function (el) {
      el.style.opacity = '0';
      if ('inert' in el) el.inert = true;
    });
  }
  function cleanPage() {
    pageEls.forEach(function (el) {
      el.style.opacity = ''; el.style.transition = '';
      if ('inert' in el) el.inert = false;
    });
    pageEls = [];
  }

  /* ── 主流程 ───────────────────────────────────────────────── */
  function play() {
    if (playing) return;
    playing = true;
    document.dispatchEvent(new CustomEvent('site:intro', { detail: { playing: true } }));

    var geo = SC.prepare();
    var cx = geo.cx, cy = geo.cy, lambda = geo.lambda;
    var maxR = Math.hypot(Math.max(geo.W - (cx - geo.sx), cx - geo.sx),
                          Math.max(geo.H - (cy - geo.sy), cy - geo.sy)) * 1.08;
    var htmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    var stage = build(geo);
    overlay = stage.ov;
    hidePage();

    /* ② 草图：每条线的三层 path 同步生长 */
    var lines = geo.lines.map(function (l) {
      var paths = LINE_LAYERS.map(function (ly) {
        var p = svg('path', { 'class': 'intro-line', d: l.d, stroke: ly.c,
                              'stroke-width': ly.w, opacity: ly.o,
                              transform: ly.dx || ly.dy
                                ? 'translate(' + ly.dx + ',' + ly.dy + ')' : '' });
        stage.gLines.appendChild(p);
        return p;
      });
      /* 抖动后的实际路径比直线采样略长，dasharray 用真实长度才画得满 */
      var len = l.len;
      try { len = paths[0].getTotalLength(); } catch (e) { /* 离线兜底 */ }
      paths.forEach(function (p) {
        p.setAttribute('stroke-dasharray', len.toFixed(1));
        p.setAttribute('stroke-dashoffset', len.toFixed(1));
      });
      return { spec: l, paths: paths, len: len, pts: l.pts, delay: l.delay, p: 0 };
    });

    /* ③④ 厚涂：6 组 path，每帧只改 6 个 d */
    var strokePaths = SC.makePaths(stage.gStrokes, 'intro-stroke');
    SC.drawDabs(strokePaths, geo.dabs, 0, cx, cy, lambda);

    /* ⑦ 元素归位：每节点继承涡旋末态的角度与半径 */
    var revealNodes = [];
    REVEAL_SELECTORS.forEach(function (sel) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
        if (revealNodes.length >= 60) return;
        var r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 8) return;
        if (r.bottom < 0 || r.top > geo.H * 1.2) return;
        var mx = r.left + r.width / 2 + geo.sx, my = r.top + r.height / 2 + geo.sy;
        var dx = mx - cx, dy = my - cy, dist = Math.hypot(dx, dy);
        var ang = Math.atan2(dy, dx), amp = Math.min(46, dist * .11);
        revealNodes.push({
          el: el, tx: Math.cos(ang) * amp, ty: Math.sin(ang) * amp,
          rot: clamp(dist / lambda * 7, -11, 11) * (dy >= 0 ? 1 : -1),
          scale: .93, delay: 0
        });
      });
    });
    revealNodes.forEach(function (n, i) { n.delay = (i / Math.max(1, revealNodes.length)) * .34; });

    var T1 = TIMING.blank;
    var T2 = T1 + TIMING.sketch;
    var T3 = T2 + TIMING.impasto;
    var T4 = T3 + TIMING.vortex;
    var T5 = T4 + TIMING.settle;
    var T6 = T5 + TIMING.night;
    var T7 = T6 + TIMING.reveal;
    var start = 0, finished = false, guard = 0, revealStarted = false;

    function placeReveal(r) {
      if (!revealStarted) {
        revealStarted = true;
        /* 父容器立刻可见，但各细粒度节点从 0 开始 */
        pageEls.forEach(function (el) {
          el.style.transition = ''; el.style.opacity = '1';
          if ('inert' in el) el.inert = false;
        });
        revealNodes.forEach(function (n) {
          n.el.style.opacity = '0';
          n.el.style.transform =
            'translate(' + n.tx.toFixed(1) + 'px,' + n.ty.toFixed(1) + 'px) ' +
            'rotate(' + n.rot.toFixed(1) + 'deg) scale(' + n.scale + ')';
        });
      }
      revealNodes.forEach(function (n) {
        var u = clamp((r - n.delay) / (1 - n.delay), 0, 1);
        var e = backOut(u), k = 1 - e;
        n.el.style.opacity = Math.min(1, u * 1.9).toFixed(2);
        n.el.style.transform =
          'translate(' + (n.tx * k).toFixed(1) + 'px,' + (n.ty * k).toFixed(1) + 'px) ' +
          'rotate(' + (n.rot * k).toFixed(2) + 'deg) scale(' + (1 - .07 * k).toFixed(3) + ')';
      });
    }

    function finish() {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      clearTimeout(guard);

      /* 无论正常结束、跳过还是后台兜底，都定格成完整的一张画 */
      lines.forEach(function (l) {
        l.paths.forEach(function (p, k) {
          p.setAttribute('stroke-dashoffset', '0');
          p.style.opacity = String(LINE_LAYERS[k].o * .34);
        });
      });
      stage.gLines.removeAttribute('mask');   /* defs 留在 overlay，不能跟着定格 */
      SC.drawDabs(strokePaths, geo.dabs, 0, cx, cy, lambda);
      stage.gStrokes.setAttribute('opacity', '1');
      SC.adopt({ lines: stage.gLines, strokes: stage.gStrokes });

      /* 涡旋的动能平滑衰减 2.4s，而不是在交接那一帧被切断 */
      var cv = document.querySelector('.starry-canvas');
      if (cv && !reduce()) {
        cv.classList.remove('just-revealed');
        void cv.offsetWidth;
        cv.classList.add('just-revealed');
        var clearSettle = function (e) {
          if (e.animationName !== 'settle-spin') return;
          cv.classList.remove('just-revealed');
          cv.removeEventListener('animationend', clearSettle);
        };
        cv.addEventListener('animationend', clearSettle);
      }

      /* 清掉所有归位 inline 样式，避免残留影响后续交互 */
      revealNodes.forEach(function (n) {
        n.el.style.opacity = ''; n.el.style.transform = ''; n.el.style.transition = '';
      });
      cleanPage();
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
      document.documentElement.style.overflow = htmlOverflow;
      disposers.forEach(function (fn) { fn(); });
      disposers = [];
      playing = false;
      document.dispatchEvent(new CustomEvent('site:intro', { detail: { playing: false } }));
    }

    on(stage.skip, 'click', finish);
    on(stage.ov, 'click', function (ev) { if (ev.target !== stage.skip) finish(); });
    on(document, 'keydown', function (ev) { if (ev.key === 'Escape') finish(); });

    function frame(now) {
      if (!start) start = now;
      var t = (now - start) / SPEED;
      var spin = 0;

      if (t < T2) {
        /* ② 蓝线稿：三层同步 dashoffset 生长，笔尖沿切线走 */
        var p = clamp((t - T1) / TIMING.sketch, 0, 1), active = null;
        lines.forEach(function (l) {
          l.p = clamp((p - l.delay) / (1 - l.delay), 0, 1);
          l.paths.forEach(function (path) {
            path.setAttribute('stroke-dashoffset', (l.len * (1 - l.p)).toFixed(1));
          });
          if (l.p > .02 && l.p < .98) active = l;
        });
        if (active) {
          var pt = (function (pts, q) {
            var total = 0, i;
            for (i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
            var target = total * q, acc = 0;
            for (i = 1; i < pts.length; i++) {
              var a = pts[i - 1], b = pts[i], seg = Math.hypot(b.x - a.x, b.y - a.y);
              if (acc + seg >= target || i === pts.length - 1) {
                var u = seg ? (target - acc) / seg : 0;
                return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u,
                         a: Math.atan2(b.y - a.y, b.x - a.x) };
              }
              acc += seg;
            }
            return { x: pts[0].x, y: pts[0].y, a: 0 };
          })(active.pts, active.p);
          stage.brush.style.opacity = '1';
          stage.brush.style.left = (pt.x - geo.sx - 12) + 'px';
          stage.brush.style.top = (pt.y - geo.sy - 66) + 'px';
          stage.brush.style.transform = 'rotate(' + (pt.a * 180 / Math.PI - 40).toFixed(1) + 'deg)';
        } else {
          stage.brush.style.opacity = '0';
        }
      } else if (t < T3) {
        /* ③ 厚涂浮现：粗线只退到 .28，【不消失】 */
        var q = (t - T2) / TIMING.impasto;
        stage.brush.style.opacity = '0';
        lines.forEach(function (l) {
          l.paths.forEach(function (path, k) {
            path.setAttribute('stroke-dashoffset', '0');
            path.style.opacity = String(LINE_LAYERS[k].o * (1 - .72 * q));
          });
        });
        stage.gStrokes.setAttribute('opacity', q.toFixed(2));
        SC.drawDabs(strokePaths, geo.dabs, 0, cx, cy, lambda);
      } else if (t < T4) {
        /* ④ 涡心公转：可见同心圆 + 差动角速度 */
        var v = (t - T3) / TIMING.vortex;
        stage.gVortex.setAttribute('opacity', Math.min(1, v * 1.6).toFixed(2));
        stage.gVortex.setAttribute('transform',
          'rotate(' + (v * 32).toFixed(1) + ' ' + cx + ' ' + cy + ')');
        spin = SPIN_MAX * v;
        SC.drawDabs(strokePaths, geo.dabs, spin, cx, cy, lambda);
      } else if (t < T5) {
        /* ⑤ 收笔定格：spin 增速趋零，给眼睛一个事件边界 */
        var s = (t - T4) / TIMING.settle;
        spin = SPIN_MAX * (1 + .03 * (1 - Math.pow(1 - s, 3)));
        SC.drawDabs(strokePaths, geo.dabs, spin, cx, cy, lambda);
      } else if (t < T6) {
        /* ⑥ 换幕：以涡心为圆心圆形扩散，画布一次换成夜空 */
        var n = (t - T5) / TIMING.night;
        stage.night.style.clipPath =
          'circle(' + (maxR * n).toFixed(1) + 'px at ' +
          stage.vcx.toFixed(1) + 'px ' + stage.vcy.toFixed(1) + 'px)';
        spin = SPIN_MAX * (1.03 + .15 * n);
        SC.drawDabs(strokePaths, geo.dabs, spin, cx, cy, lambda);
      } else if (t < T7) {
        /* ⑦ 归位 + 交接：笔触收拢回版式坐标，元素逐个旋正落定 */
        var r = (t - T6) / TIMING.reveal;
        spin = SPIN_MAX * 1.18 * Math.pow(1 - r, 1.6);
        SC.drawDabs(strokePaths, geo.dabs, spin, cx, cy, lambda);
        stage.gVortex.setAttribute('opacity', (1 - r).toFixed(2));
        stage.gStrokes.setAttribute('opacity', '1');
        stage.ov.style.opacity = String(1 - r);          /* 淡到 0，不再硬切 */
        placeReveal(r);
      } else {
        finish();
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    /* 后台标签会暂停 rAF：到点强制收尾，且照样定格出完整画面 */
    guard = setTimeout(finish, T7 / SPEED + 1800);
  }

  /* 首次进站不播（A 方案下首屏已有静态画）；切回 Swiss 不播。 */
  document.addEventListener('site:themechange', function (ev) {
    var d = ev.detail || {};
    if (d.to !== 'starry' || d.play === false || reduce() || playing) return;
    play();
  });

  window.SiteIntro = { isPlaying: function () { return playing; } };
})();
