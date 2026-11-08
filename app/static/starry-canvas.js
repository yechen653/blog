/* ============================================================
   starry-canvas.js — 星月夜【常驻油画层】
   ------------------------------------------------------------
   设计依据：《星月夜》的构成单位不是"线"，而是短促、并排、沿流场
   切线方向的条状厚涂笔触。因此本层不再描摹 DOM 版式边框，改成：

     · 一份 COMPOSITION：4 个主旋转点 + 11 颗星，位置按原画归一化，
       月亮 / 主涡 / 副涡 / 亮星各有自己的半径、方向、角速度。
     · 一个流场：多涡旋切向场 + 全局 S 形云带漂移，笔触沿积分流线铺。
     · 段级配方：每个短笔段独立决定 墨色 / 粗细档 / 透明度 / 留白 /
       叠笔；颜色按"带"的占比表抽样，并用 runLength 让同色成簇，
       避免随机彩色噪点。
     · 按 (墨色 × 粗细档) 分桶，所有 <path d> 只在 mount() 生成一次，
       演出期间 setAttribute('d') 次数为 0。

   骨架流线（sky-bone）既是揭幕演出画的线，也是静态画里的暗底宽笔：
   静态时 dashoffset=0（完整），演出开始时退回未画状态再生长。
   因此演出与首屏静态是同一批 DOM 节点，不需要搬树、不需要交接重建。
   ============================================================ */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var root = document.documentElement;
  var MOBILE = !!(window.matchMedia && window.matchMedia('(max-width:700px)').matches);
  var DENSITY = MOBILE ? .68 : 1;

  /* ── 8 种颜料：c 色值，w 基准宽度，o 不透明度。
        取原画的钴蓝 / 群青 / 青绿 / 金黄，不用近黑的海军蓝压整幅画。 */
  var INKS = [
    { c: '#12275a', w: 13,  o: .46 },  /* 0 暗宽底：群青 */
    { c: '#1d4a91', w: 8.5, o: .72 },  /* 1 深钴蓝 */
    { c: '#3576c8', w: 6.0, o: .82 },  /* 2 钴蓝 */
    { c: '#6fb0e0', w: 3.8, o: .80 },  /* 3 亮蓝 */
    { c: '#9ed6c0', w: 3.0, o: .78 },  /* 4 青绿 */
    { c: '#f7d45c', w: 4.0, o: .92 },  /* 5 星月黄 */
    { c: '#ffb347', w: 5.0, o: .94 },  /* 6 橙 */
    { c: '#fff3cf', w: 2.2, o: .90 }   /* 7 暖白 */
  ];

  /* 四档粗细及整幅占比：宽 18% / 中 42% / 细 30% / 极细 10% */
  var TIERS = [{ k: 1.00 }, { k: .58 }, { k: .30 }, { k: .15 }];

  /* 每个"笔触带"的配方。w = 8 色权重（即每段颜色占比），
     t = 4 档权重，run = 同色成簇的长度区间，over = 叠笔率，gap = 留白率 */
  var RECIPES = {
    base:    { w: [.16,.24,.24,.21,.15, 0, 0, 0 ], t: [.20,.44,.28,.08], run: [3,6], over: .20, gap: .10 },
    cloud:   { w: [.02,.06,.18,.28,.30,.10,.04,.02], t: [.14,.42,.34,.10], run: [3,7], over: .34, gap: .08 },
    armA:    { w: [.16,.24,.26,.20,.12,.02, 0, 0 ], t: [.18,.42,.30,.10], run: [2,5], over: .26, gap: .18 },
    armB:    { w: [.20,.26,.24,.18,.10,.02, 0, 0 ], t: [.18,.42,.30,.10], run: [2,5], over: .22, gap: .20 },
    moon:    { w: [ 0, 0, 0,.02,.12,.42,.34,.10], t: [.30,.46,.20,.04], run: [4,8], over: .34, gap: .06 },
    halo:    { w: [ 0, 0,.06,.18,.34,.28,.10,.04], t: [.12,.38,.36,.14], run: [2,5], over: .28, gap: .18 },
    star:    { w: [ 0,.02,.06,.16,.28,.30,.12,.06], t: [.14,.40,.34,.12], run: [3,6], over: .34, gap: .08 },
    hill:    { w: [.16,.32,.28,.16,.08, 0, 0, 0 ], t: [.26,.44,.26,.04], run: [3,6], over: .18, gap: .14 },
    village: { w: [.28,.36,.18,.08, 0,.05,.05, 0 ], t: [.30,.46,.20,.04], run: [2,4], over: .14, gap: .22 }
  };

  var host = null, sky = null, staticSvg = null, spinSvg = null, bonesGroup = null;
  var rings = [], bones = [], baseLayer = null;
  var COMP = null, disposers = [], resizeRaf = 0, resizeBound = false;

  function svg(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  function rr(v) { return Math.round(v); }
  /* 确定性伪随机：首屏静态 / 重播 / 刷新得到同一张画 */
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function pick(weights, r) {
    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var v = r() * total;
    for (i = 0; i < weights.length; i++) { v -= weights[i]; if (v <= 0) return i; }
    return weights.length - 1;
  }
  function on(t, type, fn, opt) {
    t.addEventListener(type, fn, opt || false);
    disposers.push(function () { t.removeEventListener(type, fn, opt || false); });
  }

  /* ── 单一构图源：所有旋转点 / 光晕 / 演出涡心都从这里派生 ───── */
  function composition(W, H) {
    var shortSide = Math.min(W, H);
    var starPos = [
      [.10,.04],[.23,.03],[.34,.04],[.42,.04],[.61,.09],
      [.71,.22],[.23,.17],[.32,.33],[.02,.45],[.12,.48],[.34,.53]
    ];
    return {
      W: W, H: H, shortSide: shortSide, horizon: H * .64,
      A: { id:'A', x:W*.42, y:H*.30, r:shortSide*.30, dir:-1, power:2.30, speed:1.00 },
      B: { id:'B', x:W*.66, y:H*.47, r:shortSide*.18, dir: 1, power:1.70, speed: .70 },
      M: { id:'M', x:W*.90, y:H*.13, r:shortSide*.20, dir: 1, power:0.90, speed: .40 },
      S: { id:'S', x:W*.34, y:H*.53, r:shortSide*.10, dir:-1, power:0.90, speed: .30 },
      stars: starPos.map(function (p, i) {
        return { id:'s'+i, x:W*p[0], y:H*p[1], r:shortSide*(.035 + (i%3)*.008),
                 dir: i%2 ? 1 : -1, power:.30, speed:.15 };
      })
    };
  }

  /* ── 流场：多涡旋切向场 + 全局 S 形漂移 ─────────────────────── */
  function flowDir(x, y, C) {
    /* 全局漂移刻意压低：让涡心切向场占主导，笔触才会盘成螺旋臂，
       而不是被一条水平风压成整齐的斜线。 */
    var vx = .34, vy = .16 * Math.sin(x / (C.W * .26) + .4);
    var list = [C.A, C.B, C.S, C.M], i, v, dx, dy, r, infl;
    for (i = 0; i < list.length; i++) {
      v = list[i];
      dx = x - v.x; dy = y - v.y;
      r = Math.sqrt(dx*dx + dy*dy) + 1;
      infl = v.power * Math.exp(-r / (v.r * 1.35));
      vx += (-dy / r) * v.dir * infl;
      vy += ( dx / r) * v.dir * infl;
    }
    var L = Math.sqrt(vx*vx + vy*vy) || 1;
    return { x: vx / L, y: vy / L };
  }

  /* ── 笔触桶：按 (墨色 × 粗细档) 惰性分桶，最后一次性写 d ───── */
  function Buckets(parent, recipe, rnd) {
    this.parent = parent; this.R = recipe; this.rnd = rnd;
    this.map = {}; this.runInk = -1; this.runLeft = 0; this.lastTier = -1;
  }
  Buckets.prototype._bucket = function (ink, tier) {
    var key = ink * 4 + tier, b = this.map[key];
    if (!b) {
      var I = INKS[ink];
      var el = svg('path', {
        'class': 'ink-path', fill: 'none', stroke: I.c,
        'stroke-width': (I.w * TIERS[tier].k).toFixed(2),
        opacity: I.o.toFixed(2), 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      });
      this.parent.appendChild(el);
      b = this.map[key] = { el: el, d: [] };
    }
    return b;
  };
  /* 一个短笔段：Q 曲线做笔锋弧度，法向 bow，长度 = 宽度 × 3~5.6 */
  Buckets.prototype.dab = function (x, y, dx, dy, forceInk, forceTier) {
    var R = this.R, rnd = this.rnd;
    if (rnd() < R.gap) return;                       /* 留白：烘焙进路径，不用 mask */
    var ink, tier;
    if (forceInk != null) { ink = forceInk; }
    else if (this.runLeft > 0) { ink = this.runInk; this.runLeft--; }
    else {
      ink = pick(R.w, rnd); this.runInk = ink;
      this.runLeft = R.run[0] + Math.floor(rnd() * (R.run[1] - R.run[0] + 1)) - 1;
    }
    tier = forceTier != null ? forceTier : pick(R.t, rnd);
    if (tier === this.lastTier) tier = (tier + 1) % TIERS.length;
    this.lastTier = tier;

    var w = INKS[ink].w * TIERS[tier].k;
    var len = w * (3.2 + rnd() * 2.4);
    var nx = -dy, ny = dx, bow = (rnd() - .5) * len * .22;
    var x1 = x - dx * len / 2, y1 = y - dy * len / 2;
    var x2 = x + dx * len / 2, y2 = y + dy * len / 2;
    var mx = x + nx * bow, my = y + ny * bow;
    this._bucket(ink, tier).d.push(
      'M' + rr(x1) + ' ' + rr(y1) + 'Q' + rr(mx) + ' ' + rr(my) + ' ' + rr(x2) + ' ' + rr(y2));

    /* 叠笔：更窄更亮、法向偏移 1~2px 的厚涂堆边 */
    if (rnd() < R.over) {
      var hi = ink >= 5 ? 7 : Math.min(7, ink + 2);
      var off = 1 + rnd() * 1.4, sgn = rnd() < .5 ? -1 : 1;
      var hx = x + nx * off * sgn, hy = y + ny * off * sgn;
      var hl = len * .52, hb = bow * .5;
      this._bucket(hi, 3).d.push(
        'M' + rr(hx - dx * hl / 2) + ' ' + rr(hy - dy * hl / 2) +
        'Q' + rr(hx + nx * hb) + ' ' + rr(hy + ny * hb) + ' ' +
        rr(hx + dx * hl / 2) + ' ' + rr(hy + dy * hl / 2));
    }
  };
  Buckets.prototype.flush = function () {
    var self = this;
    Object.keys(this.map).forEach(function (k) {
      var b = self.map[k];
      b.el.setAttribute('d', b.d.join(''));
    });
  };

  /* ── 沿流场积分一条流线，边走边铺短笔段 ─────────────────────── */
  function trace(C, B, seed, steps, step) {
    var x = seed.x, y = seed.y, i, d;
    for (i = 0; i < steps; i++) {
      d = flowDir(x, y, C);
      B.dab(x, y, d.x, d.y);
      x += d.x * step; y += d.y * step;
      if (x < -40 || x > C.W + 40 || y < -40 || y > C.horizon + 60) break;
    }
  }

  /* ── 天空底纹 + S 形云带 + 远山 + 村庄（静止层） ────────────── */
  function buildBase(C, rnd) {
    var g = svg('g', { 'class': 'sky-base' });
    var B = new Buckets(g, RECIPES.base, rnd);
    /* 密网格 + 短步长：原画的天空几乎被并排短笔铺满，
       稀疏划线只会像噪点。这一层是静止的，密度可以放心加。 */
    var gx = Math.max(12, Math.round(C.W / (46 / DENSITY)));
    var gy = Math.max(10, Math.round(C.horizon / (34 / DENSITY)));
    for (var j = 0; j < gy; j++) {
      for (var i = 0; i < gx; i++) {
        var x = (i + .5 + (rnd() - .5) * .8) * C.W / gx;
        var y = (j + .5 + (rnd() - .5) * .8) * C.horizon / gy;
        trace(C, B, { x: x, y: y }, 9, 11);
      }
    }
    B.flush();

    /* S 形云带：原画最亮的一条带，从左上卷过主涡甩向副涡再向右 */
    var cloud = new Buckets(g, RECIPES.cloud, rnd);
    var pts = [], t, px, py;
    var P0 = { x: -20, y: C.H * .38 }, P1 = { x: C.W * .24, y: C.H * .12 };
    var P2 = { x: C.W * .56, y: C.H * .62 }, P3 = { x: C.W + 20, y: C.H * .34 };
    for (var s = 0; s <= 70; s++) {
      t = s / 70; var u = 1 - t;
      px = u*u*u*P0.x + 3*u*u*t*P1.x + 3*u*t*t*P2.x + t*t*t*P3.x;
      py = u*u*u*P0.y + 3*u*u*t*P1.y + 3*u*t*t*P2.y + t*t*t*P3.y;
      pts.push({ x: px, y: py });
    }
    for (var q = 1; q < pts.length; q++) {
      var ax = pts[q-1], bx = pts[q], vx = bx.x-ax.x, vy = bx.y-ax.y;
      var L = Math.sqrt(vx*vx+vy*vy) || 1;
      cloud.dab((ax.x+bx.x)/2, (ax.y+bx.y)/2, vx/L, vy/L);
    }
    cloud.flush();

    /* 远山：先铺满山体带的横向短笔，再叠几条起伏的山脊线，
       避免地平线到村庄之间留出一大片纯色空洞。 */
    var hill = new Buckets(g, RECIPES.hill, rnd);
    var hn = Math.max(30, Math.round(C.W / (24 / DENSITY)));
    var hm = Math.max(8, Math.round((C.H * .87 - C.horizon) / (22 / DENSITY)));
    for (var hj = 0; hj < hm; hj++) {
      for (var hi = 0; hi < hn; hi++) {
        var hx = (hi + .5 + (rnd() - .5) * .5) * C.W / hn;
        var hy = C.horizon + (hj + .5) * (C.H * .87 - C.horizon) / hm +
                 Math.sin(hx / (C.W * .11) + hj * .32) * C.H * .012;
        hill.dab(hx, hy, 1, .06 + .13 * Math.cos(hx / (C.W * .14)));
      }
    }
    [0,1,2,3].forEach(function (k) {
      var baseY = C.horizon + (C.H * .87 - C.horizon) * (.12 + k * .22);
      var n = Math.max(30, Math.round(C.W / (20 / DENSITY)));
      for (var i = 0; i < n; i++) {
        var x = (i + .5) * C.W / n;
        var y = baseY + Math.sin(x / (C.W * .14) + k * 1.7) * C.H * .022;
        hill.dab(x, y, 1, .12 + .10 * Math.cos(x / (C.W * .14)));
      }
    });
    hill.flush();

    /* 村庄：横向短笔 + 点状橙窗光 */
    var vil = new Buckets(g, RECIPES.village, rnd);
    var vn = Math.max(18, Math.round(C.W / 42));
    for (var v = 0; v < vn; v++) {
      var vx2 = (v + .5) * C.W / vn;
      var vy2 = C.H * (.86 + (v % 3) * .028);
      vil.dab(vx2, vy2, 1, .06);
      if (v % 4 === 1) vil.dab(vx2 + 3, vy2 + 5, 1, 0, 6, 3);
    }
    vil.flush();
    return g;
  }

  /* ── 涡旋层：内 / 外两圈差速，各自挂一个 <g> 供 CSS 旋转 ────── */
  function buildVortex(C, v, recipe, seed) {
    var rnd = rng(seed), out = [];
    [0, 1].forEach(function (ring) {
      var g = svg('g', { 'class': 'v-ring', 'data-v': v.id, 'data-ring': ring ? 'outer' : 'inner' });
      g.setAttribute('style', 'transform-box:view-box;transform-origin:' +
        rr(v.x) + 'px ' + rr(v.y) + 'px');
      var B = new Buckets(g, recipe, rnd);
      var seeds = Math.round((ring ? 22 : 14) * DENSITY);
      for (var i = 0; i < seeds; i++) {
        var a = (i / seeds) * Math.PI * 2 + ring * .31 + rnd() * .5;
        var rad = v.r * (ring ? (.55 + rnd() * .30) : (.14 + rnd() * .26));
        trace(C, B, { x: v.x + Math.cos(a) * rad, y: v.y + Math.sin(a) * rad },
              ring ? 9 : 8, 12);
      }
      B.flush();
      out.push(g);
    });
    return out;
  }

  /* ── 月亮：同心断续短弧环，内橙外青，边缘不规则 ─────────────── */
  function buildMoon(C, v, seed) {
    var rnd = rng(seed), out = [];
    [0, 1].forEach(function (ring) {
      var g = svg('g', { 'class': 'v-ring moon-ring', 'data-v': 'M', 'data-ring': ring ? 'outer' : 'inner' });
      g.setAttribute('style', 'transform-box:view-box;transform-origin:' +
        rr(v.x) + 'px ' + rr(v.y) + 'px');
      var B = new Buckets(g, RECIPES.moon, rnd);
      var ks = ring === 0 ? [0, 1, 2] : [3];
      ks.forEach(function (k) {
        var rad = v.r * (.16 + k * .19) * (1 + (rnd() - .5) * .06);
        var n = Math.max(20, Math.round(2 * Math.PI * rad / (6 / DENSITY)));
        for (var j = 0; j < n; j++) {
          /* 断口 + 角度/半径抖动：原画光晕是断续流动的短弧，
             不是规整闭合的几何圆环（否则会像靶心） */
          if (rnd() < .20) continue;
          var a = (j / n) * Math.PI * 2 + k * .23 + (rnd() - .5) * .055;
          var rad2 = rad + (rnd() - .5) * 6.5;
          var x = v.x + Math.cos(a) * rad2, y = v.y + Math.sin(a) * rad2;
          var dx = -Math.sin(a), dy = Math.cos(a);
          var ink = k === 0 ? (rnd() < .5 ? 6 : 7)
                  : k === 1 ? 6
                  : k === 2 ? (rnd() < .6 ? 5 : 6)
                  : k === 3 ? (rnd() < .6 ? 5 : 4) : (rnd() < .6 ? 4 : 3);
          /* 内两圈用宽档，短笔互相搭接成连续厚环，而不是虚线圆 */
          B.dab(x, y, dx, dy, ink, k < 2 ? 0 : null);
        }
      });
      if (ring === 0) {
        /* 核心：用短笔密集铺出实心月盘，保留笔触纹理，
           不再是 3 个纯色 circle 那种单调圆盘 */
        var core = v.r * .20;
        for (var m = 0; m < 130; m++) {
          var aa = rnd() * Math.PI * 2, cr = core * Math.sqrt(rnd());
          /* 笔锋沿切线而非全部水平，核心读起来是旋涡状的月盘 */
          B.dab(v.x + Math.cos(aa) * cr, v.y + Math.sin(aa) * cr,
                -Math.sin(aa), Math.cos(aa), rnd() < .6 ? 6 : 5, 0);
        }
      }
      B.flush();
      out.push(g);
    });
    return out;
  }

  /* ── 11 颗星：每颗 3 圈环状短弧光晕，无十字星芒 ─────────────── */
  function buildStars(C, seed) {
    var rnd = rng(seed);
    /* 星群归入静止层：11 颗星若做成 11 个旋转层，每帧重绘开销不划算，
       而原画里星本身是静态的发光球。 */
    var g = svg('g', { 'class': 'star-field' });
    var B = new Buckets(g, RECIPES.star, rnd);
    C.stars.forEach(function (s, si) {
      for (var k = 0; k < 3; k++) {
        var rad = s.r * (.24 + k * .32);
        var n = Math.max(9, Math.round(2 * Math.PI * rad / (9 / DENSITY)));
        for (var j = 0; j < n; j++) {
          if (rnd() < .17) continue;
          var a = (j / n) * Math.PI * 2 + si * .4 + k * .17 + (rnd() - .5) * .08;
          var rad2 = rad + (rnd() - .5) * 3.2;
          var x = s.x + Math.cos(a) * rad2, y = s.y + Math.sin(a) * rad2;
          var ink = k === 0 ? (rnd() < .6 ? 7 : 6)
                  : (k === 1 ? (rnd() < .6 ? 5 : 4) : 3);
          B.dab(x, y, -Math.sin(a), Math.cos(a), ink, k === 0 ? 0 : null);
        }
      }
      for (var m = 0; m < 16; m++) {
        var aa = rnd() * Math.PI * 2, cr = s.r * .22 * Math.sqrt(rnd());
        B.dab(s.x + Math.cos(aa) * cr, s.y + Math.sin(aa) * cr,
              -Math.sin(aa), Math.cos(aa), rnd() < .7 ? 7 : 5, 0);
      }
    });
    B.flush();
    return g;
  }

  /* ── 骨架流线：演出画的线，也是静态画里的暗底宽笔 ───────────── */
  function buildBones(C, seed) {
    var rnd = rng(seed), g = svg('g', { 'class': 'sky-bones' }), meta = [];
    var count = MOBILE ? 8 : 12;
    for (var i = 0; i < count; i++) {
      var x = C.W * (.06 + .88 * (i / Math.max(1, count - 1))) + (rnd() - .5) * 30;
      var y = C.H * (.10 + .42 * rnd());
      var pts = [{ x: x, y: y }], px = x, py = y, steps = 34 + Math.round(rnd() * 22);
      for (var s = 0; s < steps; s++) {
        var d = flowDir(px, py, C);
        px += d.x * 15; py += d.y * 15;
        if (px < -30 || px > C.W + 30 || py < -30 || py > C.horizon + 40) break;
        pts.push({ x: px, y: py });
      }
      if (pts.length < 5) continue;
      var dstr = pts.map(function (p, k) {
        return (k ? 'L' : 'M') + rr(p.x) + ' ' + rr(p.y);
      }).join('');
      var len = 0;
      for (var q = 1; q < pts.length; q++) {
        len += Math.sqrt(Math.pow(pts[q].x - pts[q-1].x, 2) + Math.pow(pts[q].y - pts[q-1].y, 2));
      }
      var el = svg('path', {
        'class': 'sky-bone', d: dstr, fill: 'none', stroke: '#173a72',
        'stroke-width': (7 + rnd() * 5).toFixed(1), opacity: '.42',
        'stroke-linecap': 'round', 'stroke-linejoin': 'round'
      });
      el.setAttribute('stroke-dasharray', len.toFixed(0));
      el.setAttribute('stroke-dashoffset', '0');
      g.appendChild(el);

      /* 终态位姿：每根骨架各自旋转 + 平移，脱离版式、落入天空构图。
         首屏静态就保持这个终态，演出只是「从原位卷进来」的过程，
         因此首屏与演出结束看到的是同一张画。 */
      var rot = (rnd() * 2 - 1) * 26;
      var tx = (rnd() * 2 - 1) * C.W * .045;
      var ty = (rnd() * 2 - 1) * C.H * .055;
      var scale = .94 + rnd() * .10;
      var terminal = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) ' +
        'rotate(' + rot.toFixed(1) + 'deg) scale(' + scale.toFixed(3) + ')';
      el.style.transform = terminal;

      meta.push({
        el: el, len: len, pts: pts, terminal: terminal,
        delay: (i / Math.max(1, count - 1)) * .48
      });
    }
    return { group: g, meta: meta };
  }

  /* ── 生命周期 ───────────────────────────────────────────────── */
  function mount() {
    var W = window.innerWidth, H = window.innerHeight;
    COMP = composition(W, H);

    /* 构图参数写进 CSS 变量：光晕渐变与 SVG 月亮共用同一坐标 */
    root.style.setProperty('--moon-x', (COMP.M.x / W * 100).toFixed(1) + '%');
    root.style.setProperty('--moon-y', (COMP.M.y / H * 100).toFixed(1) + '%');
    root.style.setProperty('--vortex-x', (COMP.A.x / W * 100).toFixed(1) + '%');
    root.style.setProperty('--vortex-y', (COMP.A.y / H * 100).toFixed(1) + '%');

    host = document.createElement('div');
    host.className = 'starry-canvas';
    host.setAttribute('aria-hidden', 'true');
    var vb = '0 0 ' + W + ' ' + H;
    /* 刻意拆成两个独立 SVG：密集的静止底纹一次栅格化后缓存，
       只有轻量的旋转层参与每帧重绘，避免整棵 SVG 被反复光栅化。 */
    staticSvg = svg('svg', { 'class': 'starry-static', viewBox: vb, preserveAspectRatio: 'none' });
    spinSvg = svg('svg', { 'class': 'starry-spin', viewBox: vb, preserveAspectRatio: 'none' });
    host.appendChild(staticSvg);
    host.appendChild(spinSvg);
    document.body.appendChild(host);

    baseLayer = buildBase(COMP, rng(20261108));
    baseLayer.appendChild(buildStars(COMP, 8821));
    staticSvg.appendChild(baseLayer);

    var made = [];
    made = made.concat(buildVortex(COMP, COMP.A, RECIPES.armA, 4211));
    made = made.concat(buildVortex(COMP, COMP.B, RECIPES.armB, 7331));
    made = made.concat(buildMoon(COMP, COMP.M, 9137));
    made = made.concat(buildVortex(COMP, COMP.S, RECIPES.halo, 6151));
    made.forEach(function (g) {
      /* 每个旋转点按 speed 定基准周期，内圈再快 1.6 倍 → 差速涡旋。
         方向写进 data-dir，由 CSS 的 animation-direction 处理。 */
      var vid = g.getAttribute('data-v');
      var v = vid === 'A' ? COMP.A : vid === 'B' ? COMP.B
            : vid === 'M' ? COMP.M : vid === 'S' ? COMP.S : null;
      var dur = v ? (150 / v.speed) : 420;
      if (g.getAttribute('data-ring') === 'inner') dur *= .62;
      g.style.setProperty('--orbit', dur.toFixed(0) + 's');
      g.setAttribute('data-dir', v && v.dir < 0 ? '-1' : '1');
      spinSvg.appendChild(g);
    });
    rings = made;

    var b = buildBones(COMP, 3347);
    bonesGroup = b.group; bones = b.meta;
    staticSvg.appendChild(bonesGroup);   /* 骨架在静止层最上，作暗底宽笔 */
    sky = spinSvg;                       /* 兼容 stats / prepare 的引用 */
  }

  function ensure() { if (!host) mount(); }

  function remove() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null; sky = null; staticSvg = null; spinSvg = null;
    bonesGroup = null; baseLayer = null;
    rings = []; bones = []; COMP = null;
    disposers.forEach(function (fn) { fn(); });
    disposers = [];
    resizeBound = false;
    if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
    root.classList.remove('is-intro', 'is-vortex', 'is-lifted');
  }

  function onResize() {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = 0;
      if (root.dataset.theme !== 'starry') return;
      /* remove() 会清掉 disposers，所以重画后必须重新绑定 resize */
      remove(); mount(); bindResize();
    });
  }

  /* 供 intro.js：拿到同一批节点，不搬树、不重建 path */
  function prepare() {
    ensure();
    return {
      W: COMP.W, H: COMP.H, comp: COMP,
      bones: bones, rings: rings, base: baseLayer, sky: sky, host: host
    };
  }
  /* 兼容旧调用：新架构无需交接，线条本来就是常驻节点 */
  function adopt() { return true; }
  function setIntro(on) { root.classList.toggle('is-intro', !!on); }

  function bindResize() { if (!resizeBound) { resizeBound = true; on(window, 'resize', onResize); } }

  document.addEventListener('site:themechange', function (ev) {
    var to = ev && ev.detail && ev.detail.to;
    if (to === 'starry') { ensure(); bindResize(); }
    else if (to === 'swiss') remove();
  });

  if (root.dataset.theme === 'starry') { ensure(); bindResize(); }

  window.StarryCanvas = {
    ensure: ensure, remove: remove, prepare: prepare, adopt: adopt,
    setIntro: setIntro, svg: svg,
    inks: INKS, tiers: TIERS, recipes: RECIPES,
    mobile: MOBILE, isMounted: function () { return !!host; },
    stats: function () {
      var chars = 0, paths = 0;
      if (host) Array.prototype.forEach.call(host.querySelectorAll('path'), function (p) {
        chars += (p.getAttribute('d') || '').length; paths++;
      });
      return { paths: paths, chars: chars, rings: rings.length, bones: bones.length };
    }
  };
})();
