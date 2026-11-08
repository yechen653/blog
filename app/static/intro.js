/* ============================================================
   intro.js — 星月夜主题揭幕演出
   ------------------------------------------------------------
   借用的是《使命召唤手游》星月夜皮肤「专属检视画面」的【演出语法】，
   不是它的主体内容。本站从头到尾画的都是个人主页的版式线稿，
   不绘制任何武器轮廓。

   五阶段（时间见 TIMING）：
     ① 空白画布          亚麻纹理，页面隐藏
     ② 蓝色粗线草图       SVG path + stroke-dashoffset，笔尖沿切线走
     ③ 厚涂成团           粗线退场，沿路径铺蓝 / 黄短笔触（impasto）
     ④ 圆形涡心旋转       可见同心圆涡心；采样点绕心公转，
                          角速度 ω(r) = spin/(1+r/λ) 随半径衰减，
                          所以是"一圈一圈"的螺旋，不是整块画面刚性转
     ⑤ 换幕 + 界面凝出    以涡心为圆心 clip-path 圆形扩散成星月夜夜空；
                          笔触收拢回版式真实坐标并淡出，页面同位置淡入

   关键取舍：
     · 不用 Canvas：SVG viewBox 天然适配桌面 / 手机，省掉 DPR 与 resize。
     · 不用 feTurbulence：全屏湍流滤镜每帧重算，移动端必掉帧；
       厚涂感靠多层半透明短笔触 + round linecap 模拟。
     · 短笔触每帧只改 3 个 <path> 的 d，不创建上千个 DOM 节点。
     · 主题变量在演出【开始前】就已写入；overlay 用独立固定配色，
       所以揭幕后不会先白后蓝，也不会被主题切换连带变色。
   ============================================================ */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var C = window.SITE_CONFIG || {};
  var T = C.themes || {};

  /* 桌面约 4.3s，移动端整体提速并降低采样密度 */
  var TIMING = { blank: 260, sketch: 1400, impasto: 700, vortex: 850, night: 560, reveal: 520 };
  var MOBILE = window.matchMedia && window.matchMedia('(max-width:700px)').matches;
  var SPEED = MOBILE ? .72 : 1;
  var STEP = MOBILE ? 18 : 10;
  var SPIN_MAX = 1.5;

  var COLORS = ['#1b4f8f', '#3a7bc8', '#7aa6d8', '#f2c94c'];
  var playing = false;
  var raf = 0;
  var overlay = null;
  var pageEls = [];
  var disposers = [];

  function reduce() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function svg(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  function on(target, type, fn) {
    target.addEventListener(type, fn);
    disposers.push(function () { target.removeEventListener(type, fn); });
  }

  /* ── 版式草图：从真实 DOM 读几何，收拢时能严丝合缝对齐 ────── */
  var SELECTORS = [
    '.masthead-inner', '.hero-title', '.hero-meta',
    '.section-label', '.widget--box', '.link-card',
    '.toolbar', '#list .card', '.site-footer', '.footer-word'
  ];

  function collectFrames(W, H) {
    var frames = [];
    SELECTORS.forEach(function (sel) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
        if (frames.length >= 16) return;
        var r = el.getBoundingClientRect();
        if (r.width < 60 || r.height < 14) return;
        if (r.bottom < -20 || r.top > H + 20) return;
        frames.push({
          x: Math.max(-20, r.left), y: Math.max(-20, r.top),
          w: Math.min(r.width, W + 40), h: Math.min(r.height, H + 40)
        });
      });
    });
    return frames;
  }

  /* 每个框画成带"出头"的开放折线；前几个框再补一条交叉斜线，
     复现参考帧里那种有速度感的手绘交叉线，而不是工程制图的闭合矩形。 */
  function frameVerts(f, i) {
    var o = 7 + (i % 3) * 6;
    var x1 = f.x - o, y1 = f.y, x2 = f.x + f.w + o, y2 = f.y + f.h;
    return [
      { x: x1, y: y1 }, { x: x2, y: y1 },
      { x: x2, y: y2 }, { x: x1, y: y2 },
      { x: x1, y: y1 - o }
    ];
  }
  function crossVerts(f, i) {
    var o = 10 + (i % 2) * 8;
    return [{ x: f.x - o, y: f.y + f.h + o }, { x: f.x + f.w + o, y: f.y - o }];
  }
  function vertsToD(verts) {
    return verts.map(function (p, i) {
      return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
    }).join(' ');
  }
  function sample(verts, step) {
    var out = [{ x: verts[0].x, y: verts[0].y }];
    for (var i = 1; i < verts.length; i++) {
      var a = verts[i - 1], b = verts[i];
      var len = Math.hypot(b.x - a.x, b.y - a.y);
      var n = Math.max(1, Math.round(len / step));
      for (var k = 1; k <= n; k++) {
        var u = k / n;
        out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
      }
    }
    return out;
  }
  function polylineLength(pts) {
    var s = 0;
    for (var i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return s;
  }
  function pointAt(pts, p) {
    var total = polylineLength(pts);
    var target = total * clamp(p, 0, 1), acc = 0;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc + seg >= target || i === pts.length - 1) {
        var u = seg ? (target - acc) / seg : 0;
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u,
                 a: Math.atan2(b.y - a.y, b.x - a.x) };
      }
      acc += seg;
    }
    return { x: pts[0].x, y: pts[0].y, a: 0 };
  }

  /* 差动旋转：内圈角速度大、外圈小，直线才会被排成螺旋臂。
     等角速度只会让整块画面刚性转，没有"一圈一圈"的层次。 */
  function warp(p, spin, cx, cy, lambda) {
    var dx = p.x - cx, dy = p.y - cy;
    var r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    var w = spin / (1 + r / lambda);
    var rr = r * (1 - .10 * spin / SPIN_MAX);
    return { x: cx + rr * Math.cos(a + w), y: cy + rr * Math.sin(a + w) };
  }

  /* ── 构建舞台 ─────────────────────────────────────────────── */
  function build(W, H, cx, cy) {
    var ov = document.createElement('div');
    ov.className = 'intro-overlay';
    ov.setAttribute('aria-hidden', 'true');

    var canvas = document.createElement('div');
    canvas.className = 'intro-canvas';
    ov.appendChild(canvas);

    var night = document.createElement('div');
    night.className = 'intro-night';
    /* 星点随圆形裁切一起扩散，正好呼应"漩涡铺成夜空" */
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
    /* 每层画一段 ~258° 的弧、起始角逐层错开：得到的是螺旋臂，
       不是整圆叠出来的靶心。短 dasharray 再把它切成一笔一笔的颜料。 */
    for (var r = 52, j = 0; r < Math.max(W, H) * .9; r += 58, j++) {
      var a0 = -.6 + j * .26, a1 = a0 + 4.5;
      var x1 = cx + r * Math.cos(a0), y1 = cy + r * Math.sin(a0);
      var x2 = cx + r * Math.cos(a1), y2 = cy + r * Math.sin(a1);
      var d = 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
              ' A' + r + ' ' + r + ' 0 1 1 ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
      swirl.appendChild(svg('path', {
        d: d, fill: 'none',
        stroke: j % 3 === 0 ? '#f2c94c' : (j % 2 ? '#3a7bc8' : '#1b4f8f'),
        'stroke-width': j % 3 === 0 ? 2.6 : 3.6,
        'stroke-dasharray': (16 + j % 4 * 4) + ' ' + (12 + j % 3 * 5),
        'stroke-linecap': 'round', opacity: .55
      }));
    }
    night.appendChild(swirl);
    ov.appendChild(night);

    var field = svg('svg', { 'class': 'intro-svg', viewBox: '0 0 ' + W + ' ' + H,
                             preserveAspectRatio: 'none' });
    var gLines = svg('g', {});
    var gVortex = svg('g', { opacity: '0' });
    var gStrokes = svg('g', {});
    field.appendChild(gLines);
    field.appendChild(gVortex);
    field.appendChild(gStrokes);

    /* 可见涡心：同心圆短笔触 + 黄色亮心 */
    [24, 42, 62, 84].forEach(function (rr, k) {
      gVortex.appendChild(svg('circle', {
        cx: cx, cy: cy, r: rr * (MOBILE ? .7 : 1), fill: 'none',
        stroke: k % 2 ? '#3a7bc8' : '#0e2a52',
        'stroke-width': 4 - k * .4,
        'stroke-dasharray': (13 + k * 2) + ' ' + (9 + k),
        'stroke-linecap': 'round'
      }));
    });
    gVortex.appendChild(svg('circle', { cx: cx, cy: cy, r: 7, fill: '#f2c94c' }));
    ov.appendChild(field);

    /* 毛笔：一根斜笔杆 + 深蓝笔头，笔尖落在 (12,66) */
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
    return { ov: ov, night: night, field: field, gLines: gLines,
             gStrokes: gStrokes, gVortex: gVortex, brush: brush, skip: skip };
  }

  /* ── 页面隐藏 / 恢复 ──────────────────────────────────────── */
  function hidePage() {
    pageEls = Array.prototype.filter.call(document.body.children, function (el) {
      var t = el.tagName;
      return t !== 'SCRIPT' && t !== 'TEMPLATE' && t !== 'NOSCRIPT' &&
             !el.classList.contains('intro-overlay');
    });
    pageEls.forEach(function (el) {
      el.style.opacity = '0';
      if ('inert' in el) el.inert = true;
    });
  }
  function restorePage() {
    pageEls.forEach(function (el) {
      el.style.opacity = '';
      el.style.transition = '';
      if ('inert' in el) el.inert = false;
    });
    pageEls = [];
  }
  function revealPage() {
    pageEls.forEach(function (el) {
      el.style.transition = 'opacity .5s ease';
      el.style.opacity = '1';
      if ('inert' in el) el.inert = false;
    });
  }

  /* ── 主流程 ───────────────────────────────────────────────── */
  function play() {
    if (playing) return;
    playing = true;
    document.dispatchEvent(new CustomEvent('site:intro', { detail: { playing: true } }));

    var W = window.innerWidth, H = window.innerHeight;
    var cx = W * (MOBILE ? .62 : .72), cy = H * (MOBILE ? .32 : .30);
    var lambda = Math.min(W, H) * .34;
    var maxR = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) * 1.06;
    var htmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    /* 先收集几何再隐藏页面（opacity 不影响 getBoundingClientRect） */
    var frames = collectFrames(W, H);
    var stage = build(W, H, cx, cy);
    overlay = stage.ov;
    hidePage();

    var lines = [];
    function addLine(verts, idx) {
      var pts = sample(verts, STEP);
      var d = vertsToD(verts);
      var path = svg('path', { 'class': 'intro-line', d: d });
      stage.gLines.appendChild(path);
      var len = 0;
      try { len = path.getTotalLength(); } catch (e) { len = polylineLength(pts); }
      path.setAttribute('stroke-dasharray', len.toFixed(1));
      path.setAttribute('stroke-dashoffset', len.toFixed(1));
      lines.push({ el: path, pts: pts, len: len, delay: (idx / Math.max(1, lines.length + 8)) * .5, p: 0 });
    }
    frames.forEach(function (f, i) { addLine(frameVerts(f, i), i); });
    frames.slice(0, 6).forEach(function (f, i) { addLine(crossVerts(f, i), lines.length); });
    /* delay 按最终条数归一化，避免先后加入的线错峰比例失真 */
    lines.forEach(function (l, i) { l.delay = (i / Math.max(1, lines.length)) * .5; });

    /* 三层短笔触：每帧只改这 3 个 path 的 d，不建上千节点 */
    var strokePaths = COLORS.map(function (color) {
      var p = svg('path', { 'class': 'intro-stroke', stroke: color,
                            'stroke-width': (color === '#f2c94c' ? 2.8 : 4.4),
                            opacity: '0' });
      stage.gStrokes.appendChild(p);
      return p;
    });

    var segs = [];
    lines.forEach(function (l) {
      for (var i = 1; i < l.pts.length; i++) {
        segs.push({ a: l.pts[i - 1], b: l.pts[i],
                    layer: (i % 9 === 0) ? 3 : (i % 3 === 0 ? 1 : (i % 2 ? 0 : 2)),
                    jitter: ((i * 37) % 13 - 6) * .012,
                    scale: .56 + ((i * 17) % 7) * .075 });
      }
    });

    function drawStrokes(spin) {
      var ds = ['', '', '', ''];
      for (var i = 0; i < segs.length; i++) {
        var g = segs[i];
        var p = warp(g.a, spin, cx, cy, lambda);
        var q = warp(g.b, spin, cx, cy, lambda);
        var ang = Math.atan2(q.y - p.y, q.x - p.x) + g.jitter;
        var len = Math.hypot(q.x - p.x, q.y - p.y) * g.scale;
        var x2 = p.x + Math.cos(ang) * len, y2 = p.y + Math.sin(ang) * len;
        ds[g.layer] += 'M' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) +
                       'L' + x2.toFixed(1) + ' ' + y2.toFixed(1);
      }
      for (var k = 0; k < strokePaths.length; k++) strokePaths[k].setAttribute('d', ds[k]);
    }
    drawStrokes(0);

    var T1 = TIMING.blank;
    var T2 = T1 + TIMING.sketch;
    var T3 = T2 + TIMING.impasto;
    var T4 = T3 + TIMING.vortex;
    var T5 = T4 + TIMING.night;
    var T6 = T5 + TIMING.reveal;
    var start = 0;
    var finished = false;
    var guard = 0;

    function finish() {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      clearTimeout(guard);
      restorePage();
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

      /* ② 粗线草图：dashoffset 生长；笔尖沿当前正在画的线移动 */
      if (t < T2) {
        var p = clamp((t - T1) / TIMING.sketch, 0, 1);
        var active = null;
        lines.forEach(function (l) {
          l.p = clamp((p - l.delay) / (1 - l.delay), 0, 1);
          l.el.setAttribute('stroke-dashoffset', (l.len * (1 - l.p)).toFixed(1));
          if (l.p > .02 && l.p < .98) active = l;
        });
        if (active) {
          var pt = pointAt(active.pts, active.p);
          stage.brush.style.opacity = '1';
          stage.brush.style.left = (pt.x - 12) + 'px';
          stage.brush.style.top = (pt.y - 66) + 'px';
          stage.brush.style.transform = 'rotate(' + (pt.a * 180 / Math.PI - 40).toFixed(1) + 'deg)';
        } else {
          stage.brush.style.opacity = '0';
        }
      } else if (t < T3) {
        /* ③ 厚涂：粗线退场，短笔触浮现 */
        var q = (t - T2) / TIMING.impasto;
        stage.brush.style.opacity = '0';
        lines.forEach(function (l) {
          l.el.setAttribute('stroke-dashoffset', '0');
          l.el.style.opacity = String(1 - .85 * q);
        });
        strokePaths.forEach(function (s) { s.setAttribute('opacity', q.toFixed(2)); });
        drawStrokes(0);
      } else if (t < T4) {
        /* ④ 涡心旋转：可见同心圆 + 采样点绕心公转 */
        var v = (t - T3) / TIMING.vortex;
        stage.gVortex.setAttribute('opacity', Math.min(1, v * 1.6).toFixed(2));
        stage.gVortex.setAttribute('transform',
          'rotate(' + (v * 32).toFixed(1) + ' ' + cx + ' ' + cy + ')');
        spin = SPIN_MAX * v;
        drawStrokes(spin);
      } else if (t < T5) {
        /* ⑤ 换幕：圆形裁切从涡心扩散，画布一次性变成夜空 */
        var n = (t - T4) / TIMING.night;
        stage.night.style.clipPath =
          'circle(' + (maxR * n).toFixed(1) + 'px at ' + cx.toFixed(1) + 'px ' + cy.toFixed(1) + 'px)';
        spin = SPIN_MAX * (1 + .18 * n);
        drawStrokes(spin);
      } else if (t < T6) {
        /* 界面凝出：笔触收拢回版式真实坐标，页面在同一位置淡入 */
        var r = (t - T5) / TIMING.reveal;
        spin = SPIN_MAX * 1.18 * (1 - r);
        drawStrokes(spin);
        strokePaths.forEach(function (s) { s.setAttribute('opacity', (1 - r).toFixed(2)); });
        stage.gVortex.setAttribute('opacity', (1 - r).toFixed(2));
        stage.ov.style.opacity = String(1 - r * .85);
        if (r < .05) revealPage();
      } else {
        finish();
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    /* 兜底：浏览器在后台标签会暂停 rAF，用户切走再回来时演出可能停在半途，
       页面就一直被 hidden 遮住。到点强制收尾，保证页面一定恢复可见。 */
    guard = setTimeout(finish, T6 / SPEED + 1800);
  }

  /* 只在【主动切到星月夜】或【重播】时演出。
     首次进站（head 内联脚本已设好主题）不触发，切回 Swiss 也不触发。 */
  document.addEventListener('site:themechange', function (ev) {
    var d = ev.detail || {};
    if (d.to !== 'starry' || d.play === false || reduce() || playing) return;
    play();
  });

  window.SiteIntro = { isPlaying: function () { return playing; } };
})();
