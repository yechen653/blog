/* ============================================================
   starry-canvas.js — 星月夜【常驻油画层】
   ------------------------------------------------------------
   这一层是「主题的一部分」，不是「演出的一部分」：
     · 只要 data-theme=starry，首屏就有一张由代码绘制的画（A 方案）
     · 揭幕演出只是把这张画「画出来的过程」，结束后把笔触节点
       交接（adopt）回本层定格，而不是删除
     · 切回 swiss 时整层移除，Swiss 保持干净

   两个坐标系，刻意分开：
     · 天空（月亮 / 涡旋 / 柏树 / 村庄 / 星点）固定视口，像背景画
     · 笔触（沿真实 DOM 版式采集）用【文档坐标】生成，放在
       .paint-shift 组里，滚动时只改一个 transform，笔触跟内容一起走

   厚涂质感不靠滤镜：每段生成主笔触 + 少量高光 / 飞白，
   用 Q 曲线做笔锋弧度、高光收两端做纺锤形、6 组不同色宽叠加。
   所有段拼进 6 个 <path> 的 d，每帧只改 6 个属性。
   ============================================================ */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var root = document.documentElement;
  var MOBILE = !!(window.matchMedia && window.matchMedia('(max-width:700px)').matches);
  var STEP = MOBILE ? 14 : 9;
  var SPIN_MAX = 1.5;
  var MAX_FRAMES = 22;

  /* 6 组：前 4 组是蓝黄主颜料，第 5 组高光、第 6 组飞白/暗边。
     不同宽度叠在同一路径上，视觉上就是厚薄不均的一笔。 */
  var PALETTE = [
    { c: '#1b4f8f', w: 7.5, o: .84 },
    { c: '#2e6bb8', w: 5.6, o: .82 },
    { c: '#7aa6d8', w: 3.6, o: .80 },
    { c: '#f2c94c', w: 4.2, o: .90 },
    { c: '#ffe6a3', w: 2.0, o: .78 },
    { c: '#0e2a52', w: 2.2, o: .60 }
  ];

  /* 宽笔触带：在细笔触之下再铺一层低透明度的宽带，
     让线框不只是「线」，而是有颜料厚度的色块（静态界面尤其需要）。 */
  var WASH = [
    { src: 1, c: '#1b4f8f', w: 22, o: .075 },
    { src: 0, c: '#2e6bb8', w: 15, o: .10 },
    { src: 3, c: '#f2c94c', w: 9,  o: .12 }
  ];

  /* 版式线框：从真实 DOM 读矩形，草图画的就是界面本身。 */
  var SELECTORS = [
    '.masthead-inner', '.brand', '.nav', '.theme-btn',
    '.hero', '.hero-title', '.hero-meta', '.kicker',
    '.section-label', '.prose p', '.widget-list li', '.widget--box',
    '.section-note', '.link-grid', '.link-card', '.widget--back',
    '.toolbar', '#list .card', '.pager', '.detail', '.content',
    '.site-footer', '.footer-row', '.footer-word'
  ];

  var host = null, shift = null, washLayer = null, staticPaths = [], disposers = [], scrollRaf = 0;

  function svg(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function scrollPos() {
    return { x: window.pageXOffset || document.documentElement.scrollLeft || 0,
             y: window.pageYOffset || document.documentElement.scrollTop || 0 };
  }
  function on(t, type, fn, opt) {
    t.addEventListener(type, fn, opt || false);
    disposers.push(function () { t.removeEventListener(type, fn, opt || false); });
  }

  /* ── 几何：一律转成【文档坐标】 ─────────────────────────────── */
  function collectFrames() {
    var s = scrollPos(), W = window.innerWidth, H = window.innerHeight;
    var frames = [];
    SELECTORS.forEach(function (sel) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
        if (frames.length >= MAX_FRAMES) return;
        var r = el.getBoundingClientRect();
        if (r.width < 48 || r.height < 12) return;
        /* 采集整个文档的版式，不只首屏：滚动到下方时笔触仍在。
           SVG viewBox 只映射当前视口，视口外内容由 .paint-shift
           随滚动带进来，所以这里不需要按视口裁剪。 */
        frames.push({
          x: r.left + s.x, y: r.top + s.y,
          w: Math.min(r.width, W + 40), h: Math.min(r.height, H * 1.4)
        });
      });
    });
    return frames;
  }

  /* 开放折线 + 端点过冲，复现手绘交叉线的速度感；
     不是工程制图的闭合矩形。 */
  function frameVerts(f, i) {
    var o = 6 + (i % 4) * 5;
    var x1 = f.x - o, y1 = f.y, x2 = f.x + f.w + o, y2 = f.y + f.h;
    return [{ x: x1, y: y1 }, { x: x2, y: y1 },
            { x: x2, y: y2 }, { x: x1, y: y2 }, { x: x1, y: y1 - o }];
  }
  function crossVerts(f, i) {
    var o = 9 + (i % 3) * 7;
    return [{ x: f.x - o, y: f.y + f.h + o }, { x: f.x + f.w + o, y: f.y - o }];
  }
  function vertsToD(v) {
    return v.map(function (p, i) {
      return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
    }).join(' ');
  }
  /* 手绘抖动：把每条直边细分成 ~26px 的小段并加确定性法向扰动。
     草图线因此不是工程制图的笔直实线，而是带笔锋起伏的颜料线；
     扰动是确定性的，所以演出与静态定格用的是同一条线。 */
  function jitterVerts(verts) {
    var out = [{ x: verts[0].x, y: verts[0].y }];
    for (var i = 1; i < verts.length; i++) {
      var a = verts[i - 1], b = verts[i];
      var len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      var n = Math.max(2, Math.round(len / 26));
      var ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, nx = -uy, ny = ux;
      for (var k = 1; k <= n; k++) {
        var u = k / n;
        var j = (k === n) ? 0 : (((i * 31 + k * 17) % 11) - 5) * .42;
        out.push({ x: a.x + (b.x - a.x) * u + nx * j,
                   y: a.y + (b.y - a.y) * u + ny * j });
      }
    }
    return out;
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
    var total = polylineLength(pts), target = total * clamp(p, 0, 1), acc = 0;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc + seg >= target || i === pts.length - 1) {
        var u = seg ? (target - acc) / seg : 0;
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u,
                 a: Math.atan2(b.y - a.y, b.x - a.x) };
      }
      acc += seg;
    }
    return { x: pts[0].x, y: pts[0].y, a: 0 };
  }

  /* ── 差动涡旋：ω(r)=spin/(1+r/λ)，内圈快外圈慢才有螺旋臂 ── */
  function warp(p, spin, cx, cy, lambda) {
    var dx = p.x - cx, dy = p.y - cy;
    var r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    var w = spin / (1 + r / lambda);
    var rr = r * (1 - .10 * spin / SPIN_MAX);
    return { x: cx + rr * Math.cos(a + w), y: cy + rr * Math.sin(a + w) };
  }

  /* ── 厚涂笔触：一段主笔 + 概率性高光 / 飞白 ───────────────── */
  function makeDabs(lines) {
    var dabs = [];
    lines.forEach(function (l, li) {
      for (var i = 1; i < l.pts.length; i++) {
        var a = l.pts[i - 1], b = l.pts[i];
        var h = (li * 131 + i * 37) % 97;
        var main = (h % 11 === 0) ? 3 : (h % 3);
        dabs.push({ a: a, b: b, g: main,
                    bow: ((h * 7) % 9 - 4) * .7, trim: 0, scale: .62 + (h % 6) * .055 });
        if (h % 5 === 0) dabs.push({ a: a, b: b, g: 4, bow: -((h % 5) - 2) * .8,
                                     trim: .24, scale: .72 });
        if (h % 8 === 0) dabs.push({ a: a, b: b, g: 5, bow: ((h % 7) - 3) * .9,
                                     trim: -.10, scale: 1.05 });
      }
    });
    return dabs;
  }

  /* Q 曲线 + 法向偏移 = 笔锋弧度；高光收两端 = 纺锤形颜料堆。 */
  function drawDabs(paths, dabs, spin, cx, cy, lambda) {
    var ds = PALETTE.map(function () { return ''; });
    for (var i = 0; i < dabs.length; i++) {
      var g = dabs[i];
      var p = warp(g.a, spin, cx, cy, lambda);
      var q = warp(g.b, spin, cx, cy, lambda);
      var vx = q.x - p.x, vy = q.y - p.y;
      var len = Math.hypot(vx, vy);
      if (len < .5) continue;
      var ux = vx / len, uy = vy / len, nx = -uy, ny = ux;
      var trim = len * g.trim;
      var x1 = p.x + ux * trim, y1 = p.y + uy * trim;
      var x2 = q.x - ux * trim, y2 = q.y - uy * trim;
      var L = len * g.scale;
      x2 = x1 + ux * L; y2 = y1 + uy * L;
      var bow = g.bow * (1 + spin * .35);
      var mx = (x1 + x2) / 2 + nx * bow, my = (y1 + y2) / 2 + ny * bow;
      ds[g.g] += 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
                 'Q' + mx.toFixed(1) + ' ' + my.toFixed(1) +
                 ' ' + x2.toFixed(1) + ' ' + y2.toFixed(1);
    }
    for (var k = 0; k < paths.length; k++) paths[k].setAttribute('d', ds[k]);
    return ds;
  }

  function makePaths(parent, cls) {
    return PALETTE.map(function (p) {
      var el = svg('path', { 'class': cls, stroke: p.c, 'stroke-width': p.w,
                             opacity: p.o, fill: 'none' });
      parent.appendChild(el);
      return el;
    });
  }

  /* 宽笔触带：复用主笔触的 d，用更粗更淡的线铺在下面。
     首屏静态画和演出交接后的定格画面都走这里，视觉一致。 */
  function fillWash(ds) {
    if (!washLayer) return;
    washLayer.textContent = '';
    WASH.forEach(function (spec) {
      washLayer.appendChild(svg('path', {
        'class': 'starry-wash', d: ds[spec.src] || '', stroke: spec.c,
        'stroke-width': spec.w, opacity: spec.o, fill: 'none',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      }));
    });
  }

  /* ── 星月夜构图：全部用 SVG 代码生成，不贴原画 ─────────────── */
  function buildScenery(W, H) {
    var g = svg('g', { 'class': 'scenery' });
    var mx = W * .84, my = H * .15;

    /* 主涡旋：逐层错开起始角的 258° 弧 = 螺旋臂，不是靶心 */
    var swirl = svg('g', { 'class': 'scenery-swirl' });
    swirl.setAttribute('style', 'transform-box:view-box;transform-origin:' +
      mx.toFixed(1) + 'px ' + my.toFixed(1) + 'px');
    for (var r = 46, j = 0; r < Math.max(W, H) * .78; r += 46, j++) {
      var a0 = -.7 + j * .24, a1 = a0 + 4.5;
      swirl.appendChild(svg('path', {
        d: 'M' + (mx + r * Math.cos(a0)).toFixed(1) + ' ' + (my + r * Math.sin(a0)).toFixed(1) +
           ' A' + r + ' ' + r + ' 0 1 1 ' +
           (mx + r * Math.cos(a1)).toFixed(1) + ' ' + (my + r * Math.sin(a1)).toFixed(1),
        fill: 'none', stroke: j % 4 === 0 ? '#f2c94c' : (j % 2 ? '#3a7bc8' : '#1b4f8f'),
        'stroke-width': j % 4 === 0 ? 2.4 : 3.2,
        'stroke-dasharray': (14 + j % 4 * 5) + ' ' + (13 + j % 3 * 6),
        'stroke-linecap': 'round', opacity: .34
      }));
    }
    g.appendChild(swirl);

    /* 次涡旋（左下），让画面不是只有一个圆心 */
    var swirl2 = svg('g', { 'class': 'scenery-swirl2' });
    var bx = W * .16, by = H * .74;
    swirl2.setAttribute('style', 'transform-box:view-box;transform-origin:' +
      bx.toFixed(1) + 'px ' + by.toFixed(1) + 'px');
    for (var r2 = 32, j2 = 0; r2 < W * .4; r2 += 40, j2++) {
      var b0 = 1.2 + j2 * .3;
      swirl2.appendChild(svg('path', {
        d: 'M' + (bx + r2 * Math.cos(b0)).toFixed(1) + ' ' + (by + r2 * Math.sin(b0)).toFixed(1) +
           ' A' + r2 + ' ' + r2 + ' 0 1 1 ' +
           (bx + r2 * Math.cos(b0 + 4.2)).toFixed(1) + ' ' + (by + r2 * Math.sin(b0 + 4.2)).toFixed(1),
        fill: 'none', stroke: j2 % 2 ? '#2e6bb8' : '#1b4f8f',
        'stroke-width': 2.6, 'stroke-dasharray': '12 16',
        'stroke-linecap': 'round', opacity: .22
      }));
    }
    g.appendChild(swirl2);

    /* 月亮 + 三层光晕 */
    var moon = svg('g', { 'class': 'scenery-moon' });
    [64, 44, 28].forEach(function (rr, k) {
      moon.appendChild(svg('circle', { cx: mx, cy: my, r: rr,
        fill: k === 2 ? '#f2c94c' : '#f2c94c', opacity: k === 2 ? .85 : .05 + k * .035 }));
    });
    g.appendChild(moon);

    /* 星点：部分带十字光芒 */
    for (var i = 0; i < 15; i++) {
      var sx = ((i * 73 + 11) % 97) / 97 * W;
      var sy = ((i * 41 + 5) % 89) / 89 * H * .82;
      var rad = 1.6 + (i % 3) * .9;
      var star = svg('g', { 'class': 'scenery-star',
                            style: 'animation-delay:' + (i * .43).toFixed(2) + 's' });
      star.appendChild(svg('circle', { cx: sx, cy: sy, r: rad + 4,
        fill: '#f2c94c', opacity: .10 }));
      star.appendChild(svg('circle', { cx: sx, cy: sy, r: rad, fill: '#ffe6a3', opacity: .8 }));
      if (i % 3 === 0) {
        star.appendChild(svg('path', {
          d: 'M' + (sx - rad * 3) + ' ' + sy + 'H' + (sx + rad * 3) +
             'M' + sx + ' ' + (sy - rad * 3) + 'V' + (sy + rad * 3),
          stroke: '#ffe6a3', 'stroke-width': .8, opacity: .42
        }));
      }
      g.appendChild(star);
    }

    /* 柏树：左下角火焰状剪影（用相对点按视口缩放） */
    var cw = Math.max(60, W * .07), ch = H * .55, cx0 = W * .055, cy0 = H;
    var cypress = 'M' + cx0 + ' ' + cy0 +
      ' C' + (cx0 - cw * .5) + ' ' + (cy0 - ch * .30) + ' ' +
             (cx0 + cw * .15) + ' ' + (cy0 - ch * .52) + ' ' +
             (cx0 + cw * .10) + ' ' + (cy0 - ch) +
      ' C' + (cx0 + cw * .9) + ' ' + (cy0 - ch * .60) + ' ' +
             (cx0 + cw * 1.5) + ' ' + (cy0 - ch * .32) + ' ' +
             (cx0 + cw) + ' ' + cy0 + ' Z';
    g.appendChild(svg('path', { 'class': 'scenery-cypress', d: cypress,
      fill: '#0a2620', opacity: .38 }));

    /* 村庄：底部屋顶剪影 + 教堂尖塔，低透明不抢正文 */
    var village = svg('g', { 'class': 'scenery-village' });
    var base = H;
    for (var v = 0; v < 7; v++) {
      var vx = W * (.30 + v * .105), vw = W * .075, vh = H * (.045 + (v % 3) * .02);
      village.appendChild(svg('path', {
        d: 'M' + vx.toFixed(1) + ' ' + base + 'V' + (base - vh).toFixed(1) +
           'L' + (vx + vw / 2).toFixed(1) + ' ' + (base - vh - vh * .55).toFixed(1) +
           'L' + (vx + vw).toFixed(1) + ' ' + (base - vh).toFixed(1) + 'V' + base + 'Z',
        fill: '#0a1a30', opacity: .32
      }));
    }
    var tx = W * .58, th = H * .16;
    village.appendChild(svg('path', {
      d: 'M' + tx + ' ' + base + 'V' + (base - th * .6) + 'L' + (tx + W * .012) +
         ' ' + (base - th) + 'L' + (tx + W * .024) + ' ' + (base - th * .6) + 'V' + base + 'Z',
      fill: '#0a1a30', opacity: .38
    }));
    g.appendChild(village);

    return g;
  }

  /* ── 常驻层的生命周期 ─────────────────────────────────────── */
  function setShift() {
    if (!shift) return;
    var s = scrollPos();
    shift.setAttribute('transform', 'translate(' + (-s.x).toFixed(1) + ',' + (-s.y).toFixed(1) + ')');
  }
  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () { scrollRaf = 0; setShift(); });
  }

  function buildLines(frames) {
    var lines = [];
    frames.forEach(function (f, i) { lines.push({ verts: frameVerts(f, i) }); });
    frames.slice(0, 8).forEach(function (f, i) { lines.push({ verts: crossVerts(f, i) }); });
    lines.forEach(function (l) {
      l.verts = jitterVerts(l.verts);
      l.d = vertsToD(l.verts);
      l.pts = sample(l.verts, STEP);
      l.len = polylineLength(l.pts);
      l.delay = 0;
    });
    lines.forEach(function (l, i) { l.delay = (i / Math.max(1, lines.length)) * .5; });
    return lines;
  }

  function ensure() {
    if (host) return;
    var W = window.innerWidth, H = window.innerHeight;
    host = document.createElement('div');
    host.className = 'starry-canvas';
    host.setAttribute('aria-hidden', 'true');

    var sky = svg('svg', { 'class': 'starry-sky', viewBox: '0 0 ' + W + ' ' + H,
                           preserveAspectRatio: 'none' });
    sky.appendChild(buildScenery(W, H));
    host.appendChild(sky);

    var paint = svg('svg', { 'class': 'starry-paint', viewBox: '0 0 ' + W + ' ' + H,
                             preserveAspectRatio: 'none' });
    shift = svg('g', { 'class': 'paint-shift' });
    paint.appendChild(shift);
    host.appendChild(paint);
    document.body.appendChild(host);

    /* A 方案：首屏立即定格一张静态油画笔触，不依赖演出 */
    var frames = collectFrames();
    var dabs = makeDabs(buildLines(frames));
    washLayer = svg('g', { 'class': 'starry-wash-layer' });
    shift.appendChild(washLayer);
    staticPaths = makePaths(shift, 'starry-dab');
    fillWash(drawDabs(staticPaths, dabs, 0, 0, 0, 1));
    setShift();

    on(window, 'scroll', onScroll, { passive: true });
    on(window, 'resize', function () {
      /* 视口变了就整层重画，几何与 viewBox 一起刷新 */
      remove();
      if (root.dataset.theme === 'starry') ensure();
    });
  }

  function remove() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null; shift = null; washLayer = null; staticPaths = [];
    disposers.forEach(function (fn) { fn(); });
    disposers = [];
    if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
  }

  /* 演出结束：把 overlay 里【画出来的】笔触与勾线接回本层，
     替换掉首屏那份静态副本。线条不消失，只是定格。 */
  function adopt(groups) {
    if (!host || !shift) ensure();
    staticPaths.forEach(function (p) { if (p.parentNode) p.parentNode.removeChild(p); });
    staticPaths = [];
    /* 重播时先清掉上一次交接进来的组，避免笔触层层累积 */
    Array.prototype.slice.call(shift.querySelectorAll('.paint-adopted'))
      .forEach(function (g) { if (g.parentNode) g.parentNode.removeChild(g); });
    ['lines', 'strokes'].forEach(function (key) {
      var g = groups && groups[key];
      if (g) { g.setAttribute('class', 'paint-adopted'); shift.appendChild(g); }
    });
    /* 定格画面同样补上宽笔触带，保持与首屏静态画同一质感 */
    var strokes = groups && groups.strokes;
    if (strokes) {
      var ds = Array.prototype.map.call(
        strokes.querySelectorAll('path.intro-stroke'),
        function (p) { return p.getAttribute('d') || ''; });
      fillWash(ds);
      /* wash 层要在 adopted 组之下：移到 shift 最前面 */
      if (washLayer && washLayer.parentNode === shift && shift.firstChild !== washLayer) {
        shift.insertBefore(washLayer, shift.firstChild);
      }
    }
    setShift();
  }

  /* 供 intro.js 复用同一份几何与渲染函数，保证演出与定格完全一致 */
  function prepare() {
    var s = scrollPos(), W = window.innerWidth, H = window.innerHeight;
    var frames = collectFrames();
    var lines = buildLines(frames);
    return {
      W: W, H: H, sx: s.x, sy: s.y,
      frames: frames, lines: lines, dabs: makeDabs(lines),
      cx: W * (MOBILE ? .62 : .72) + s.x,
      cy: H * (MOBILE ? .32 : .30) + s.y,
      lambda: Math.min(W, H) * .34,
      step: STEP
    };
  }

  document.addEventListener('site:themechange', function (ev) {
    var to = ev && ev.detail && ev.detail.to;
    if (to === 'starry') ensure();
    else if (to === 'swiss') remove();
  });

  if (root.dataset.theme === 'starry') ensure();

  window.StarryCanvas = {
    ensure: ensure, remove: remove, adopt: adopt, prepare: prepare,
    svg: svg, makePaths: makePaths, drawDabs: drawDabs,
    palette: PALETTE, spinMax: SPIN_MAX, step: STEP, mobile: MOBILE,
    isMounted: function () { return !!host; }
  };
})();
