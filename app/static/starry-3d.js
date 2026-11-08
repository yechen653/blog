/* ============================================================
   starry-3d.js — 三维月面 / 笔触迸发 / 视差层
   ------------------------------------------------------------
   为什么不用 Three.js：本前端无构建链（无 npm / 无打包），服务器在
   国内且 CDN 不可靠；同时 body 上任何 transform / perspective 都会
   让 position:fixed 的 .starry-canvas 失效。因此这里用两件原生能力
   拿到同样的空间感：

     · 月亮：Canvas 2D 逐列球面采样。先把油画笔触烘焙成一张"展开图"
       （经线方向的厚涂短笔），再对每一列取竖向切片、按 sqrt(1-x²)
       压缩高度 —— 得到正确的球体轮廓、极区压缩与边缘透视；旋转只需
       横向偏移，不用任何 3D 引擎。
     · 其余深度：CSS 3D（perspective + translateZ + rotateX/Y），
       文字仍是真实 HTML，可选中、可搜索、可自适应。

   三个能力：makeMoon / burst / parallax。
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

  /* ── 1. 月面展开图：涡纹为主、经线为辅、短笔块点厚涂 ───────────
     采样是逐像素球面映射，所以纹理里可以放心混入不同方向的笔触；
     靠近边缘会被两个方向同时压缩，正好得到球面的透视。

     两条设计约束（都是上一版实测踩出来的）：
       · 月面只用暖色。原画的月亮是奶黄到橙的一整片暖光，掺青蓝进去
         会变成"脏斑"，远看像木球上的划痕；
       · 经线笔触是配角。110 条长经线在球面上会连成纵向木纹，
         所以压到 46 条、缩短到 .10~.34 屏高，主力换成环状涡纹。 */
  function buildTexture(D, seed) {
    var rr = rng(seed || 9137);
    var TW = Math.max(256, Math.round(D * 2.4));
    var TH = Math.max(180, Math.round(D * 1.7));
    var cv = document.createElement('canvas');
    cv.width = TW; cv.height = TH;
    var g = cv.getContext('2d');
    if (!g) return null;

    /* 纬度底色：赤道奶黄，两极收到琥珀（不是褐黑，褐黑会读成木头） */
    var lat = g.createLinearGradient(0, 0, 0, TH);
    lat.addColorStop(0, '#c08a24');
    lat.addColorStop(.16, '#e8b83a');
    lat.addColorStop(.42, '#fbe27a');
    lat.addColorStop(.58, '#f7d45c');
    lat.addColorStop(.8, '#e0a72c');
    lat.addColorStop(1, '#b47f20');
    g.fillStyle = lat;
    g.fillRect(0, 0, TW, TH);

    var warm = ['#fff6d8', '#fbe27a', '#ffcf72', '#ffeaa8', '#ffd977', '#f7c44a'];
    var i, x, y, w, h, col, a;

    /* 经线方向短笔：压短压少，只负责"自转时有位移"的视差线索 */
    for (i = 0; i < 46; i++) {
      x = rr() * TW; y = rr() * TH;
      h = TH * (.10 + rr() * .24);
      w = 2.5 + rr() * 7;
      col = warm[(rr() * 6) | 0];
      g.strokeStyle = col;
      g.globalAlpha = .22 + rr() * .34;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + w * 1.1, y + h * .3,
                      x - w * .9, y + h * .66,
                      x + w * .4, y + h);
      g.stroke();
      g.beginPath();
      g.moveTo(x - TW, y);
      g.bezierCurveTo(x - TW + w * 1.1, y + h * .3,
                      x - TW - w * .9, y + h * .66,
                      x - TW + w * .4, y + h);
      g.stroke();
    }

    /* 环状涡纹：梵高月轮的主特征，做成 3 圈不同半径的同心弧 */
    for (i = 0; i < 210; i++) {
      x = rr() * TW; y = rr() * TH;
      a = rr() * Math.PI * 2;
      var rad = TH * (.06 + rr() * .22);
      g.strokeStyle = warm[(rr() * 6) | 0];
      g.globalAlpha = .26 + rr() * .40;
      g.lineWidth = 1.8 + rr() * 4.6;
      g.beginPath();
      g.arc(x, y, rad, a, a + 1.0 + rr() * 1.9);
      g.stroke();
      /* 越过经度接缝的那一半要复制到另一侧，否则自转时会看到断口 */
      if (x + rad > TW || x - rad < 0) {
        g.beginPath();
        g.arc(x + (x < TW / 2 ? TW : -TW), y, rad, a, a + 1.0 + rr() * 1.2);
        g.stroke();
      }
    }

    /* 短笔块：让纹理有"颜料堆"的厚度感，避免整片平滑渐变 */
    for (i = 0; i < 190; i++) {
      x = rr() * TW; y = rr() * TH;
      w = 3 + rr() * 9; h = 2 + rr() * 5;
      a = rr() * Math.PI * 2;
      col = warm[(rr() * 6) | 0];
      g.save();
      g.translate(x, y); g.rotate(a);
      g.fillStyle = col;
      g.globalAlpha = .16 + rr() * .32;
      g.fillRect(-w / 2, -h / 2, w, h);
      g.restore();
    }
    g.globalAlpha = 1;
    return cv;
  }

  /* ── 2. 逐像素球面采样 ─────────────────────────────────────────
     每像素先算球面法线 → 经度/纬度 → 采样展开图，再乘方向光。
     180×180 约 3.2 万像素，单帧 <1ms，比逐列切片更真实
     （两个方向都有透视压缩，不会把笔触拉成木纹）。 */
  var GEO_CACHE = {};

  function sphereGeometry(S) {
    if (GEO_CACHE[S]) return GEO_CACHE[S];
    var n = S * S;
    var u0 = new Float32Array(n), vv = new Float32Array(n);
    var sh = new Float32Array(n), mk = new Uint8Array(n);
    for (var y = 0; y < S; y++) {
      var ny = (y + .5) / S * 2 - 1;
      for (var x = 0; x < S; x++) {
        var i = y * S + x;
        var nx = (x + .5) / S * 2 - 1;
        var r2 = nx * nx + ny * ny;
        if (r2 > 1) { mk[i] = 0; continue; }
        var nz = Math.sqrt(1 - r2);
        mk[i] = 1;
        u0[i] = Math.atan2(nx, nz) / (Math.PI * 2) + .5;
        vv[i] = Math.asin(ny) / Math.PI + .5;
        /* 左上前方来光 + 环境光 + 边缘压暗，做出球体体积 */
        var diff = Math.max(0, -.46 * nx - .58 * ny + .68 * nz);
        var limb = .58 + .42 * Math.pow(1 - r2, .22);
        var k = (.52 + .62 * diff) * limb;
        sh[i] = k > 1.25 ? 1.25 : k;
      }
    }
    GEO_CACHE[S] = { u0: u0, v: vv, sh: sh, m: mk };
    return GEO_CACHE[S];
  }

  function renderSphere(ctx, img, tex, S, rot, geo) {
    var td = tex.data, tw = tex.width, th = tex.height;
    var out = img.data, u0 = geo.u0, vv = geo.v, sh = geo.sh, mk = geo.m;
    var i, u, sx, sy, si, k;
    for (i = 0; i < S * S; i++) {
      if (!mk[i]) { out[i * 4 + 3] = 0; continue; }
      u = u0[i] + rot;
      u -= Math.floor(u);
      sx = (u * tw) | 0;
      sy = (vv[i] * th) | 0;
      si = (sy * tw + sx) * 4;
      k = sh[i];
      out[i * 4] = td[si] * k;
      out[i * 4 + 1] = td[si + 1] * k;
      out[i * 4 + 2] = td[si + 2] * k;
      out[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  /* ── 3. 月面元素 ─────────────────────────────────────────────── */
  function makeMoon(o) {
    var D = Math.max(72, Math.round(o.r * 2));
    var wrap = document.createElement('div');
    wrap.className = 'intro-moon3d moon3d';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.width = D + 'px';
    wrap.style.height = D + 'px';
    wrap.style.left = Math.round(o.x - D / 2) + 'px';
    wrap.style.top = Math.round(o.y - D / 2) + 'px';

    /* "脱画"位移必须跟着月盘尺寸走。之前写死 -64/48，是照 176px 的桌面月
       调的；在 390px 屏上月盘只有 77px，同样的位移直接把月亮推出屏幕右缘。 */
    wrap.style.setProperty('--mw-x', (-D * .36).toFixed(1) + 'px');
    wrap.style.setProperty('--mw-y', (D * .27).toFixed(1) + 'px');
    wrap.style.setProperty('--mw-s', narrow() ? '1.18' : '1.34');

    var body = document.createElement('div');
    body.className = 'moon3d-body';

    var edge = document.createElement('div');
    edge.className = 'moon3d-edge';

    var face = document.createElement('canvas');
    face.className = 'moon3d-face';
    var dpr = Math.min(1.5, window.devicePixelRatio || 1);
    var S = Math.max(88, Math.min(186, Math.round(D * dpr)));
    face.width = S; face.height = S;

    var shade = document.createElement('div');
    shade.className = 'moon3d-shade';
    var glow = document.createElement('div');
    glow.className = 'moon3d-glow';

    body.appendChild(edge);
    body.appendChild(face);
    body.appendChild(shade);
    body.appendChild(glow);
    wrap.appendChild(body);
    document.body.appendChild(wrap);

    var ctx = face.getContext('2d');
    var tex = buildTexture(Math.max(140, Math.round(D * .9)), o.seed);
    var geo = sphereGeometry(S);
    var img = ctx ? ctx.createImageData(S, S) : null;
    var texData = tex ? tex.getContext('2d').getImageData(0, 0, tex.width, tex.height) : null;
    var spin = .12, speed = 0, raf = 0, last = 0, alive = true;

    function paint() {
      if (texData && img) renderSphere(ctx, img, texData, S, spin, geo);
    }
    paint();

    function tick(t) {
      if (!alive) return;
      if (!last) last = t;
      var dt = Math.min(64, t - last);
      last = t;
      if (speed > 0) {
        spin = (spin + speed * dt / 1000) % 1;
        paint();
      }
      raf = requestAnimationFrame(tick);
    }
    if (!reduce()) raf = requestAnimationFrame(tick);

    return {
      el: wrap,
      /* 圈/秒；0 表示停转，停转后不再每帧重绘 */
      spin: function (v) { speed = Math.max(0, v || 0); },
      wake: function () { wrap.classList.add('is-wake'); },
      retract: function () { speed = 0; wrap.classList.add('is-retract'); },
      destroy: function () {
        alive = false;
        cancelAnimationFrame(raf);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      }
    };
  }

  /* ── 4. 笔触迸发：从月心向外，蓝 / 黄 / 白 ─────────────────── */
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

  /* ── 5. 视差：只写两个 CSS 变量，元素用 var() 自行换算 ───────── */
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

  /* ── 6. 状态同步：星月夜 + 展示态 + 未减弱动效 才开 3D ───────── */
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
    makeMoon: makeMoon,
    burst: burst,
    parallax: { enable: enable, disable: disable },
    sync: sync,
    narrow: narrow,
    reduce: reduce
  };
})();
