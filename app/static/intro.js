/* ============================================================
   intro.js — 星月夜揭幕演出（颜料引擎版）
   ------------------------------------------------------------
   叙事：纯白画板 → 彩色构造线（先横 → 竖 → 两个种子圆 → 橙色实心
         月圆收笔）→ 月心点火（种子开始旋转，月晕逐层长出）
         → 引擎流水线（世界从第四幕就开始爆发，没有独立的"爆发幕"）：
             · 月心旋转是全场唯一的发动机，提供相位时钟
             · A 路 构造线段绕涡心公转 ≥半圈、升档成颜料、甩落到
               自己的流场格子落位
             · 两个旋转点绕自己的种子"纺"出涡环（环段从种子圆沿旋入）
             · B 路 其余颜料从月沿甩出，按离月距离排成生长波铺满全画
             · 11 颗星从月沿切线抛出、挂位、逐圈点火
         → 收束（画板退场，夜色 + 长成的画留在台上）
         → 主页显现（粒子层与真画同位交接，内容逐像素同源）

   数据来源：starry-canvas.js 构建期把每一笔记录进 DABS 清单
   （坐标 / 流向角 / 长度 / 墨 / 档 / 路径串 / 区域）。粒子层的单元
   用的就是真画的路径串与墨色档位，落定后与真画完全一致，第⑥幕
   交叉淡替时看不出接缝。

   性能约束：所有 <path d> 只在构建期生成一次，演出期间
   setAttribute('d') = 0；单元运动全部是 CSS transform/opacity
   关键帧（轨迹在构建期写进各自的 CSS 变量），主线程零逐帧写入。
   ============================================================ */
(function () {
  'use strict';

  var SC = window.StarryCanvas;
  var S3 = window.Starry3D;
  if (!SC) { console.error('[intro] 缺少 starry-canvas.js'); return; }

  var T = (window.SITE_CONFIG || {}).themes || {};
  var root = document.documentElement;

  /* 本次会话是否已经看过演出的标记。键里带上【演出版本】——演出重做后
     老访客也能再自动看一次新版本；再带上部署前缀（/、/v2/、/v3/ 各自
     独立），否则同一个域名下看过主页的演出，预览环境里就再也不播了。 */
  var SEEN = 'blog.intro.seen:paint3:';
  try {
    var here = document.currentScript && document.currentScript.src;
    if (here) SEEN += here.replace(/static\/intro\.js.*$/, '');
  } catch (e) { /* 老浏览器没有 currentScript：退化成原样的键 */ }
  function seen() {
    try { return sessionStorage.getItem(SEEN) === '1'; } catch (e) { return false; }
  }
  function markSeen() {
    try { sessionStorage.setItem(SEEN, '1'); } catch (e) { /* 隐私模式忽略 */ }
  }

  /* 幕长（时间单位，真实毫秒 = 单位 × pace）。sketch / paint 两幕
     在构建时按内容改写。 */
  var TIMING = {
    quiet: 380,      /* ① 空白画板 */
    sketch: 2800,    /* ② 彩色构造线 + 三个种子 */
    ignite: 650,     /* ③ 月心点火：种子开始旋转 */
    paint: 4600,     /* ④ 引擎流水线 */
    settle: 450,     /* ⑤ 收束 */
    reveal: 780      /* ⑥ 主页显现 + 真画交接 */
  };
  /* 整体放慢系数：1 = 原速。幕长、层间过渡、粒子轨迹全部乘它 ——
     CSS 侧走 --intro-pace 变量，时间线与过渡不会前松后紧。 */
  var PACE = 1.6;
  function speed() { return SC.mobile ? .78 : 1; }
  var pace = PACE;
  function dur(sec) { return (sec * pace).toFixed(2) + 's'; }

  /* 第②幕排期（未乘 pace）：INK = 一条线画完的时长，
     CHAIN = 下一条的起笔点（.8 = 上一条画到 80% 才起下一条） */
  var INK = 300, CHAIN = .8, TAIL = 160;

  /* 第④幕排期（未乘 pace）。rotateStart（点火时刻）= quiet+sketch+60，
     所有引擎轨道的 delay 都从它起算。 */
  var ENG = {
    diskSpread: 160, diskDur: 1100,                       /* 月盘象限旋入 */
    haloStart: 820,  haloSpread: 300, haloDur: 1200,      /* 月晕带旋入 */
    vortexStart: 420, vortexSpread: 260,                  /* 涡环自纺 */
    ringGap: 420, sectorSpread: 110, vortexDur: 1200,
    chunkStart: 420, pieceStagger: 34, pieceDur: 1150,    /* A 路构造线段 */
    waveStart: 520,  waveSpan: 3000, waveSpanM: 2400,     /* B 路生长波 */
    starStart: 1520, starStag: 130, starDur: 1600,        /* 星（出发按波前距离对齐）*/
    moonSeedFade: 2500
  };

  var REVEAL_SELECTORS = [
    '.masthead-inner', '.brand', '.nav', '.kicker', '.hero-title', '.hero-meta',
    '.section-label', '.prose p', '.widget-list li', '.widget--box',
    '.section-note', '.link-card', '.widget--back', '.toolbar',
    '#list .card', '.pager', '.detail', '.footer-row', '.footer-word'
  ];

  var playing = false, raf = 0, guard = 0, stage = null, geo = null, paint = null;
  var pageEls = [], revealNodes = [], disposers = [];
  var maxR = 0;
  var start = 0, phase = 0, finished = false, htmlOverflow = '';
  var restartQueued = false;

  function reduce() {
    return !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function on(target, type, fn) {
    target.addEventListener(type, fn);
    disposers.push(function () { target.removeEventListener(type, fn); });
  }
  /* 确定性伪随机：重播与首播得到同一场演出 */
  function hashN(seed) {
    var s = (seed >>> 0) || 1;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  }

  /* ── 舞台：画板 / 夜盘 / UI ───────────────────────────────────
     画板是开场那张纸：①②③幕所有东西都"画"在它上面；第④幕夜色
     从月心随生长波漫上来（压在颜料粒子下面），第⑤幕纸退场。 */
  function buildStage() {
    var W = geo.W, H = geo.H, C = geo.comp, M = C.M;

    maxR = Math.hypot(Math.max(M.x, W - M.x), Math.max(M.y, H - M.y)) * 1.12;

    var paper = document.createElement('div');
    paper.className = 'intro-paper';
    paper.setAttribute('aria-hidden', 'true');

    var flood = document.createElement('div');
    flood.className = 'intro-flood';
    flood.style.width = flood.style.height = (maxR * 2).toFixed(0) + 'px';
    flood.style.left = (M.x - maxR).toFixed(0) + 'px';
    flood.style.top = (M.y - maxR).toFixed(0) + 'px';

    var ui = document.createElement('div');
    ui.className = 'intro-ui';

    var skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'intro-skip';
    skip.textContent = T.skip || '跳过演出';
    ui.appendChild(skip);

    document.body.appendChild(paper);
    document.body.appendChild(flood);
    document.body.appendChild(ui);

    return { paper: paper, flood: flood, ui: ui, skip: skip };
  }

  function hidePage() {
    pageEls = Array.prototype.filter.call(document.body.children, function (el) {
      var t = el.tagName;
      return t !== 'SCRIPT' && t !== 'TEMPLATE' && t !== 'NOSCRIPT' &&
             el.className.indexOf && el.className.indexOf('intro-') !== 0 &&
             !el.classList.contains('starry-canvas');
    });
    pageEls.forEach(function (el) {
      el.style.transition = 'none';
      el.style.opacity = '0';
      if ('inert' in el) el.inert = true;
    });
  }

  function collectReveal() {
    var found = [];
    REVEAL_SELECTORS.forEach(function (sel) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
        if (found.length >= 48) return;
        var r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 8) return;
        if (r.bottom < 0 || r.top > geo.H * 1.2) return;
        found.push(el);
      });
    });
    /* 用独立的 translate / scale 属性做纵深，不覆盖 swiss.css 里
       .card / .detail 的 rise 动画（它们动的是 transform）。 */
    revealNodes = found.map(function (el, i) {
      var a = (i * 2.399) % (Math.PI * 2);
      return {
        el: el,
        tx: (Math.cos(a) * (10 + i % 5 * 5)).toFixed(1) + 'px',
        ty: (Math.sin(a) * (10 + i % 5 * 5)).toFixed(1) + 'px',
        delayMs: Math.round(i / Math.max(1, found.length) * 340)
      };
    });
  }

  /* ── 第②幕量什么线：h 横线 / v 竖线，side 是量哪条边 ──────────
     构造线仍然照着页面真实的 1px 分隔线画（观众看到的是"版式被
     画出来"），但它们不再是落点 —— 每段线的归宿是画里的流场格子。 */
  var LINE_PLAN = [
    { sel: '.masthead',          side: 'bottom', kind: 'h' },
    { sel: '.hero',              side: 'bottom', kind: 'h' },
    { sel: '.section-label',     side: 'bottom', kind: 'h' },
    { sel: '#list .card',        side: 'bottom', kind: 'h', all: 2 },
    { sel: '.widget--box',       side: 'top',    kind: 'h' },
    { sel: '.widget--box',       side: 'bottom', kind: 'h' },
    { sel: '.site-footer',       side: 'top',    kind: 'h' },
    { sel: '.layout > .sidebar', side: 'left',   kind: 'v' },
    { sel: '.widget--box',       side: 'left',   kind: 'v' },
    { sel: '.hero-meta',         side: 'left',   kind: 'v' }
  ];
  var MAX_H = 5, MAX_V = 3;
  /* 起笔偏移：固定表 → 每次重播画的是同一张稿 */
  var JIT = [[-13, 8], [12, -7], [-9, -10], [15, 7], [-11, 11],
             [9, 9], [14, -8], [-7, -7], [10, 10]];

  function segOf(el, side, W, H) {
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    var s;
    if (side === 'bottom' || side === 'top') {
      var y = side === 'bottom' ? r.bottom - .5 : r.top + .5;
      var x1 = Math.max(0, r.left), x2 = Math.min(W, r.right);
      if (x2 - x1 < 60 || y < 0 || y > H) return null;
      s = { x1: x1, y1: y, x2: x2, y2: y, kind: 'h' };
    } else {
      var x = side === 'left' ? r.left + .5 : r.right - .5;
      var y1 = Math.max(0, r.top), y2 = Math.min(H, r.bottom);
      if (y2 - y1 < 60 || x < 0 || x > W) return null;
      s = { x1: x, y1: y1, x2: x, y2: y2, kind: 'v' };
    }
    return s;
  }

  function collectLines(W, H) {
    var hs = [], vs = [];
    LINE_PLAN.forEach(function (spec) {
      if (spec.kind === 'h' && hs.length >= MAX_H) return;
      if (spec.kind === 'v' && vs.length >= MAX_V) return;
      var found = document.querySelectorAll(spec.sel);
      var take = Math.min(found.length, spec.all || 1), q;
      for (q = 0; q < take; q++) {
        var el = found[q];
        if (spec.kind === 'h' && hs.length >= MAX_H) break;
        if (spec.kind === 'v' && vs.length >= MAX_V) break;
        var s = segOf(el, spec.side, W, H);
        if (!s) continue;
        var pool = s.kind === 'h' ? hs : vs;
        if (pool.some(function (o) {
          return Math.abs(o.y1 - s.y1) < 4 && Math.abs(o.x1 - s.x1) < 4 &&
                 Math.abs(o.x2 - s.x2) < 40;
        })) continue;
        pool.push(s);
      }
    });
    hs.sort(function (a, b) { return a.y1 - b.y1; });
    vs.sort(function (a, b) { return a.x1 - b.x1; });
    return hs.concat(vs);
  }

  function chunkCount(len) {
    return len > 900 ? 4 : len > 520 ? 3 : 2;
  }

  /* 种子圆拆成 4 段弧 —— 画的时候像笔顺着涡心绕一圈。
     sweep 恒为 1：屏幕坐标 y 向下，角度递增视觉上就是顺时针；
     涡旋方向只决定四段的先后顺序。 */
  function arcsOf(cx, cy, r, dir) {
    var out = [], i;
    for (i = 0; i < 4; i++) {
      var a0 = (i * Math.PI / 2), a1 = ((i + 1) * Math.PI / 2);
      var x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
      var x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
      out.push({
        d: 'M' + x0.toFixed(1) + ' ' + y0.toFixed(1) +
           'A' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 0 1 ' +
           x1.toFixed(1) + ' ' + y1.toFixed(1),
        len: r * Math.PI / 2
      });
    }
    return dir < 0 ? out.reverse() : out;
  }

  /* ── 颜料粒子层 ────────────────────────────────────────────────
     geo.dabs 是 starry-canvas 构建期逐笔记录的清单：
       {x,y,a(流向角),l(长度),k(墨),t(档),d(路径串),g(区域),
        vx,vy(所属涡心),ri(圈层),si(星号)}
     分区规则：
       g=star        → 每颗星一个 <g>，从月沿切线抛出、挂位、逐圈点火
       g=moon        → 盘面按象限、光晕按半径带，绕月心旋入（月完善自身）
       g=ring:*      → 每个旋转点 (圈层×扇区) 绕种子旋入（涡环自纺）
       其余(天空/云带/远山/村庄) → 网格格子：多数从月沿甩出（B 路），
                       少数分配给构造线段（A 路的落点） */
  function buildPaint() {
    var C = geo.comp, M = C.M, dabs = geo.dabs || [];
    var INKc = SC.inks, TI = SC.tiers, mob = SC.mobile;
    var COLS = mob ? 5 : 9, ROWS = mob ? 4 : 7, KEEP = 3;
    var WAVE = mob ? 2400 : 3000;
    var registry = [];
    var counts = { cellUnits: 0, cells: 0, moon: 0, rings: 0, stars: 0, pieces: 0 };

    /* 与旧 guide 相同的"钉盒"套路：量出的像素定 viewBox，1 单位 = 1px。
       手机上地址栏收放会让视口高度变化，盒子一变而 viewBox 不变，
       整层就会被 meet 等比缩放，落点整体偏移。 */
    var svgL = SC.svg('svg', { 'class': 'intro-paint', 'aria-hidden': 'true' });
    document.body.appendChild(svgL);
    var box = svgL.getBoundingClientRect();
    var W = Math.round(box.width) || geo.W, H = Math.round(box.height) || geo.H;
    svgL.style.width = W + 'px';
    svgL.style.height = H + 'px';
    svgL.style.right = 'auto';
    svgL.style.bottom = 'auto';
    svgL.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    /* 同 (墨×档) 的一束笔并成一个单元；每格/每扇区只保 KEEP 个桶，
       其余并进宽度最近的桶 —— 控制单元总数（桌面 ~420 / 移动 ~210）。 */
    function groupDabs(list, keyFn, cap) {
      var map = {};
      list.forEach(function (d) {
        var key = keyFn(d);
        var slot = map[key] = map[key] || { key: key, buckets: {} };
        var bk = d.k * 4 + d.t;
        (slot.buckets[bk] = slot.buckets[bk] || []).push(d);
      });
      return Object.keys(map).map(function (key) {
        var slot = map[key];
        var arr = Object.keys(slot.buckets).map(function (bk) {
          return { k: Math.floor(bk / 4), t: bk % 4,
                   d: slot.buckets[bk], n: slot.buckets[bk].length };
        }).sort(function (a, b) { return b.n - a.n; });
        var kept = arr.slice(0, cap);
        arr.slice(cap).forEach(function (b) {
          var best = null, bd = 1e9;
          kept.forEach(function (h) {
            var dd = Math.abs(INKc[h.k].w * TI[h.t].k - INKc[b.k].w * TI[b.t].k);
            if (dd < bd) { bd = dd; best = h; }
          });
          if (best) best.d = best.d.concat(b.d);
        });
        return { key: key, kept: kept };
      });
    }

    function mkUnit(dlist, cls) {
      var I = INKc[dlist[0].k];
      var dstr = '';
      dlist.forEach(function (d) { dstr += d.d; });
      var p = SC.svg('path', {
        d: dstr, fill: 'none', stroke: I.c,
        'stroke-width': (I.w * TI[dlist[0].t].k).toFixed(2), 'class': cls
      });
      p.style.setProperty('--op', I.o.toFixed(2));
      return p;
    }

    /* 验收登记：期望中心 = 构建期 bbox 中心（单元末帧都是 identity） */
    function reg(el, kind, ex, ey) {
      var x = ex, y = ey, op = null;
      try {
        var bb = el.getBBox();
        if (x == null) { x = bb.x + bb.width / 2; y = bb.y + bb.height / 2; }
      } catch (e) { /* 无 bbox 的元素跳过位置对账 */ }
      var opv = el.style.getPropertyValue('--op');
      if (opv) op = parseFloat(opv);
      registry.push({ el: el, kind: kind, x: x, y: y, op: op });
    }

    /* ── 1) 清单分区 ───────────────────────────────────────────── */
    var moonD = [], ringD = [], starD = [], ambient = [];
    dabs.forEach(function (d) {
      if (d.g === 'moon') { moonD.push(d); return; }
      if (d.g === 'star') { starD.push(d); return; }
      if (d.g.indexOf('ring') === 0) { ringD.push(d); return; }
      ambient.push(d);
    });

    /* ── 2) 第②幕的画：横 → 竖 → 两个种子圆 → 橙色月圆收笔 ──────
       每条构造线出生就拆成小段（pieces），每段绑定一支真实的笔 ——
       第④幕逐段飞过去、d 形变成那一笔的曲线，落定即真笔。 */
    var got = collectLines(W, H);
    /* 与种子圆相交的构造线直接不画：一根线穿过旋转点观感很差 */
    function segHitsSeed(sg) {
      return [C.A, C.B].some(function (v) {
        var sr = v.r * .34 + 16;
        var vx = v.x, vy = v.y;
        var ax = sg.x1, ay = sg.y1, bx = sg.x2, by = sg.y2;
        var dx = bx - ax, dy = by - ay;
        var tt = clamp(((vx - ax) * dx + (vy - ay) * dy) /
                       (dx * dx + dy * dy || 1), 0, 1);
        return Math.hypot(vx - (ax + dx * tt), vy - (ay + dy * tt)) < sr;
      });
    }
    got = got.filter(function (sg) { return !segHitsSeed(sg); });
    var items = [], pieces = [], j = 0;
    got.forEach(function (s) {
      var len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      var np = clamp(Math.round(len / 60), 3, 8), k;
      var jit = JIT[j % JIT.length]; j++;
      var ox = s.kind === 'v' ? Math.round(jit[0] * .5) : jit[0];
      var oy = s.kind === 'v' ? jit[1] : Math.round(jit[1] * .6);
      for (k = 0; k < np; k++) {
        var t0 = k / np, t1 = (k + 1) / np;
        pieces.push({
          p0: { x: s.x1 + (s.x2 - s.x1) * t0 + ox, y: s.y1 + (s.y2 - s.y1) * t0 + oy },
          p1: { x: s.x1 + (s.x2 - s.x1) * t1 + ox, y: s.y1 + (s.y2 - s.y1) * t1 + oy },
          kind: s.kind, li: items.length, np: np, pi0: k
        });
      }
      items.push(1);
    });
    [C.A, C.B].forEach(function (v) {
      items.push({ seedV: v });
    });
    items.push({ moonSeed: true });

    var nLines = got.length;
    var sketchMs = Math.round((nLines + 2) * INK * CHAIN + INK + TAIL);
    var moonStart = (nLines + 1) * INK * CHAIN;
    TIMING.sketch = sketchMs;
    var rotateStart = TIMING.quiet + sketchMs + 60;   /* 点火时刻（单位 ms） */

    /* 每段绑定一支真实的笔（贪心就近，同一支笔不重复认领）；
       被认领的笔从格子清单里剔除 —— 它的归宿就是这段线自己。 */
    var dabUsed = [];
    pieces.forEach(function (pc) {
      var cxm = (pc.p0.x + pc.p1.x) / 2, cym = (pc.p0.y + pc.p1.y) / 2;
      var best = null, bd = 1e9;
      for (var i = 0; i < ambient.length; i++) {
        if (dabUsed[i]) continue;
        var d = ambient[i];
        var dd = (d.x - cxm) * (d.x - cxm) + (d.y - cym) * (d.y - cym);
        if (dd < bd) { bd = dd; best = i; }
      }
      dabUsed[best] = true;
      pc.dab = ambient[best];
      pc.dabIdx = best;
    });
    var assignedSet = {};
    pieces.forEach(function (pc) { assignedSet[pc.dabIdx] = true; });
    var ambientRest = ambient.filter(function (d, i) { return !assignedSet[i]; });

    /* ── 3) 第②幕排期 ─────────────────────────────────────────── */
    function pivotFor(x, y) {
      var da = (x - C.A.x) * (x - C.A.x) + (y - C.A.y) * (y - C.A.y);
      var db = (x - C.B.x) * (x - C.B.x) + (y - C.B.y) * (y - C.B.y);
      return da <= db ? C.A : C.B;
    }

    /* ── 4) DOM 组装。追加顺序 = 层级（最终界面：天空颜料在月下）─
       格子/线段 → 种子圆 → 涡环 → 星 → 月种子 → 月晕/月盘（最上） */
    function push(el) { svgL.appendChild(el); return el; }

    /* 4a) B 路：出生点压在月沿，先显形、再全程可见地螺旋飞向落点 */
    var cellGroups = groupDabs(ambientRest, function (d) {
      var kx = clamp(Math.floor(d.x / W * COLS), 0, COLS - 1);
      var ky = clamp(Math.floor(d.y / H * ROWS), 0, ROWS - 1);
      return kx + '_' + ky;
    }, KEEP);
    var maxDist = 1;
    cellGroups.forEach(function (cg) {
      counts.cells++;
      var sx = 0, sy = 0, n = 0;
      cg.kept.forEach(function (b) {
        b.d.forEach(function (d) { sx += d.x; sy += d.y; n++; });
      });
      cg.cx = sx / n; cg.cy = sy / n;
      cg.dist = Math.hypot(cg.cx - M.x, cg.cy - M.y);
      if (cg.dist > maxDist) maxDist = cg.dist;
    });
    cellGroups.forEach(function (cg) {
      cg.kept.forEach(function (b, u) {
        var el = mkUnit(b.d, 'pk pk-fly');
        el.setAttribute('style', 'transform-box:view-box;transform-origin:' +
          M.x.toFixed(1) + 'px ' + M.y.toFixed(1) + 'px');
        var a = Math.atan2(cg.cy - M.y, cg.cx - M.x);
        var dist = cg.dist;
        var r0 = M.r * 1.03, r1 = Math.max(dist * .97, 40);
        var hsh = hashN(cg.kx * 131 + cg.ky * 77 + u * 17 + 3);
        el.style.setProperty('--a0', (-(60 + hsh * 70)).toFixed(0) + 'deg');
        el.style.setProperty('--vx0', (M.x + r0 * Math.cos(a) - cg.cx).toFixed(1) + 'px');
        el.style.setProperty('--vy0', (M.y + r0 * Math.sin(a) - cg.cy).toFixed(1) + 'px');
        var dd2 = clamp(900 + dist * .5, 900, 1600);
        var dl = ENG.waveStart + (dist / maxDist) * WAVE + hsh * 140 + u * 60;
        el.style.setProperty('--fl-dur', (dd2 * pace).toFixed(0) + 'ms');
        el.style.setProperty('--fl-delay', ((rotateStart + dl) * pace).toFixed(0) + 'ms');
        push(el); reg(el, 'cell');
        counts.cellUnits++;
      });
    });

    /* 4b) A 路（飘带）：每段线的两端各沿一条绕涡心的螺旋轨迹运动，
       尾端比首端晚 25% 出发 —— 线段在飞行中被自然拉长、甩弯，
       像飘带一样拖向自己那支笔；落定帧精确等于那支笔的 M+Q 路径。
       这 44 条小段由 tick(t) 逐帧重算 d（每帧 ~44 次、每次 ~80 字符），
       演出期"setAttribute('d')=0"的不变量在这 44 条上让步；
       其余 ~350 个单元仍是零写入的合成器动画。 */
    var ribbonPieces = [];
    pieces.forEach(function (pc, pi) {
      var d = pc.dab;
      var I = INKc[d.k];
      var dabW = I.w * TI[d.t].k;
      var lineStart = pc.li * INK * CHAIN;
      var per = INK / pc.np;

      var cxm = (pc.p0.x + pc.p1.x) / 2, cym = (pc.p0.y + pc.p1.y) / 2;
      var len = Math.hypot(pc.p1.x - pc.p0.x, pc.p1.y - pc.p0.y);

      /* 笔的三点：端1 / 控制点 / 端2（从记录的路径串反解） */
      var m = /M(-?[\d.]+) (-?[\d.]+)Q(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/.exec(d.d);
      var W1 = [+m[1], +m[2]], Wc = [+m[3], +m[4]], W2 = [+m[5], +m[6]];

      var pivot = pivotFor(cxm, cym);
      var dirSign = pivot.dir < 0 ? -1 : 1;

      /* 两端各自的极坐标起点（相对涡心） */
      function polar(pt) {
        return { a: Math.atan2(pt[1] - pivot.y, pt[0] - pivot.x),
                 r: Math.hypot(pt[0] - pivot.x, pt[1] - pivot.y) };
      }
      var PA = polar([pc.p0.x, pc.p0.y]), PB = polar([pc.p1.x, pc.p1.y]);
      var PW1 = polar(W1), PW2 = polar(W2);

      /* 总转角按段中心方位差归一：跟随涡旋方向、补整圈保证 ≥185° 且 <545° */
      var dC = Math.atan2(cym - pivot.y, cxm - pivot.x);
      var dW = Math.atan2(d.y - pivot.y, d.x - pivot.x);
      var swing = ((dW - dC) * 180 / Math.PI) * dirSign;
      swing = ((swing % 360) + 360) % 360;
      while (swing < 185) swing += 360;
      var spin = swing * dirSign;

      /* 弯的带符号长度：叉积定符号，落定帧 C 精确等于笔的控制点 */
      var midW = [(W1[0] + W2[0]) / 2, (W1[1] + W2[1]) / 2];
      var chx = W2[0] - W1[0], chy = W2[1] - W1[1];
      var bowX = Wc[0] - midW[0], bowY = Wc[1] - midW[1];
      var bowLen = Math.hypot(bowX, bowY) *
        ((chx * bowY - chy * bowX) < 0 ? -1 : 1);

      var flStart = rotateStart + ENG.chunkStart + pi * ENG.pieceStagger;

      var path = SC.svg('path', {
        d: 'M' + pc.p0.x.toFixed(1) + ' ' + pc.p0.y.toFixed(1) +
           'Q' + cxm.toFixed(1) + ' ' + cym.toFixed(1) + ' ' +
           pc.p1.x.toFixed(1) + ' ' + pc.p1.y.toFixed(1),
        fill: 'none', stroke: I.c,
        'stroke-width': clamp(dabW * .6, 2.6, 5).toFixed(2),
        'class': 'ln-p ln-piece'
      });
      path.style.setProperty('--len', len.toFixed(1));
      path.style.setProperty('--ink-dur', (per * pace).toFixed(0) + 'ms');
      path.style.setProperty('--ink-delay', ((lineStart + pc.pi0 * per * .8) * pace).toFixed(0) + 'ms');
      path.style.setProperty('--tw', dabW.toFixed(2));
      path.style.setProperty('--thick-delay', ((flStart + ENG.pieceDur * .3) * pace).toFixed(0) + 'ms');
      push(path);

      ribbonPieces.push({
        el: path, flStart: flStart,
        pivot: pivot, spin: spin, dirSign: dirSign,
        A0: PA, B0: PB, W1r: PW1, W2r: PW2,
        A0p: [pc.p0.x, pc.p0.y], B0p: [pc.p1.x, pc.p1.y],
        W1: W1, W2: W2, Wc: Wc, bowLen: bowLen,
        done: false
      });
      reg(path, 'piece', (W1[0] + W2[0]) / 2, (W1[1] + W2[1]) / 2);
      counts.pieces++;
    });

    /* 飘带逐帧驱动：u = (t - flStart)/dur，smoothstep 缓动；
       首端满速、尾端晚 25% 出发 —— 路径被自然拉长甩弯。
       位置 = 螺旋项（绕涡心转过去）与直线项（直接滑过去）按 (1-e)·.65
       混合：起跑绕得大、接近终点贴上去，落点仍精确等于笔的三点。 */
    function tickRibbons(t) {
      for (var i = 0; i < ribbonPieces.length; i++) {
        var rb = ribbonPieces[i];
        if (rb.done) continue;
        var u = (t - rb.flStart) / ENG.pieceDur;
        if (u <= 0) continue;
        var p = rb.pivot;
        function ribbonEnd(pr0, prW, pt0, ptW, uu) {
          var e = uu * uu * (3 - 2 * uu);
          var ang = pr0.a + (prW.a - pr0.a) * e;
          var rad = pr0.r + (prW.r - pr0.r) * e;
          var ax = p.x + Math.cos(ang) * rad, ay = p.y + Math.sin(ang) * rad;
          var lx = pt0[0] + (ptW[0] - pt0[0]) * e, ly = pt0[1] + (ptW[1] - pt0[1]) * e;
          var w = (1 - e) * .65;
          return [ax * w + lx * (1 - w), ay * w + ly * (1 - w)];
        }
        var uB = clamp((u - .25) / .75, 0, 1);
        var A = ribbonEnd(rb.A0, rb.W1r, rb.A0p, rb.W1, u);
        var B = ribbonEnd(rb.B0, rb.W2r, rb.B0p, rb.W2, uB);
        var mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
        var e1 = u * u * (3 - 2 * u);
        var chx = B[0] - A[0], chy = B[1] - A[1], cl = Math.hypot(chx, chy) || 1;
        var bow = rb.bowLen * e1;
        var Cx = mx - chy / cl * bow, Cy = my + chx / cl * bow;
        rb.el.setAttribute('d', 'M' + A[0].toFixed(1) + ' ' + A[1].toFixed(1) +
          'Q' + Cx.toFixed(1) + ' ' + Cy.toFixed(1) + ' ' +
          B[0].toFixed(1) + ' ' + B[1].toFixed(1));
        if (u >= 1) {
          rb.el.setAttribute('d', 'M' + rb.W1[0].toFixed(1) + ' ' + rb.W1[1].toFixed(1) +
            'Q' + rb.Wc[0].toFixed(1) + ' ' + rb.Wc[1].toFixed(1) + ' ' +
            rb.W2[0].toFixed(1) + ' ' + rb.W2[1].toFixed(1));
          rb.done = true;
        }
      }
    }

    /* 4c) 种子圆：主涡 / 副涡各一圈，涡环纺完后淡出让位 */
    [C.A, C.B].forEach(function (v, idx) {
      var order = idx;
      var vEnd = ENG.vortexStart + order * ENG.vortexSpread + ENG.ringGap +
                 3 * ENG.sectorSpread + ENG.vortexDur + 180;
      arcsOf(v.x, v.y, v.r * .34, v.dir).forEach(function (ch, k) {
        var g = SC.svg('g', { 'class': 'gk seed-g' });
        g.setAttribute('style', 'transform-box:view-box;transform-origin:' +
          v.x.toFixed(1) + 'px ' + v.y.toFixed(1) + 'px');
        g.style.setProperty('--fd-delay', ((rotateStart + vEnd) * pace).toFixed(0) + 'ms');
        var p = SC.svg('path', {
          d: ch.d, fill: 'none', stroke: INKc[2].c, 'stroke-width': 2.4, 'class': 'ln-p'
        });
        p.style.setProperty('--len', ch.len.toFixed(1));
        p.style.setProperty('--ink-dur', (INK / 4 * pace).toFixed(0) + 'ms');
        p.style.setProperty('--ink-delay', (((nLines + idx * 0) * INK * CHAIN + k * INK / 4) * pace).toFixed(0) + 'ms');
        g.appendChild(p);
        push(g);
      });
    });

    /* 4d) 涡环：绕各自的种子/中心旋入（旋转点完善自身），扇区更细 */
    var vOrder = { A: 0, B: 1, S: 2 };
    groupDabs(ringD, function (d) {
      var ang = Math.atan2(d.y - d.vy, d.x - d.vx);
      var sec = Math.floor((ang + Math.PI) / (Math.PI / 2)) % 4;
      return d.g + '#' + d.ri + '#' + sec;
    }, KEEP).forEach(function (g) {
      var parts = g.key.split('#');
      var vid = parts[0].split(':')[1];
      var ri = +parts[1], sec = +parts[2];
      var v = vid === 'A' ? C.A : vid === 'B' ? C.B : C.S;
      var dirSign = v.dir < 0 ? -1 : 1;
      g.kept.forEach(function (b, u) {
        var el = mkUnit(b.d, 'pk pk-spin');
        el.setAttribute('style', 'transform-box:view-box;transform-origin:' +
          v.x.toFixed(1) + 'px ' + v.y.toFixed(1) + 'px');
        var hsh = hashN(b.d.length * 53 + sec * 29 + ri * 13);
        el.style.setProperty('--a0', (-(120 + hsh * 140) * dirSign).toFixed(0) + 'deg');
        el.style.setProperty('--sp-dur', (ENG.vortexDur * pace).toFixed(0) + 'ms');
        var dl = ENG.vortexStart + (vOrder[vid] || 0) * ENG.vortexSpread +
                 (ri ? ENG.ringGap : 0) + sec * ENG.sectorSpread;
        el.style.setProperty('--sp-delay', ((rotateStart + dl + u * 55) * pace).toFixed(0) + 'ms');
        push(el); reg(el, 'ring');
        counts.rings++;
      });
    });

    /* 4e) 星：从月沿切线抛出 → 挂位 → 逐圈点火 */
    var starMap = {};
    starD.forEach(function (d) {
      (starMap[d.si] = starMap[d.si] || []).push(d);
    });
    Object.keys(starMap).forEach(function (siK) {
      var si = +siK, list = starMap[siK];
      var s = C.stars[si];
      if (!s) return;
      counts.stars++;
      var g = SC.svg('g', { 'class': 'pk pk-fly' });
      g.setAttribute('style', 'transform-box:view-box;transform-origin:' +
        M.x.toFixed(1) + 'px ' + M.y.toFixed(1) + 'px');
      g.style.setProperty('--op', '1');
      var a = Math.atan2(s.y - M.y, s.x - M.x);
      var dist = Math.hypot(s.x - M.x, s.y - M.y);
      var r0 = M.r * 1.05, r1 = Math.max(dist * .95, 40);
      var hsh = hashN(si * 7919 + 13);
      g.style.setProperty('--a0', (-(70 + hsh * 90)).toFixed(0) + 'deg');
      g.style.setProperty('--vx0', (M.x + r0 * Math.cos(a) - s.x).toFixed(1) + 'px');
      g.style.setProperty('--vy0', (M.y + r0 * Math.sin(a) - s.y).toFixed(1) + 'px');
      /* 出发时刻对齐波前：波前到达这颗星的距离时，它才从月沿起飞 */
      var starDelay = rotateStart + ENG.waveStart + (dist / maxDist) * WAVE;
      g.style.setProperty('--fl-dur', (ENG.starDur * pace).toFixed(0) + 'ms');
      g.style.setProperty('--fl-delay', (starDelay * pace).toFixed(0) + 'ms');
      var land = starDelay + ENG.starDur;
      var bands = [[], [], []];
      list.forEach(function (d) {
        var r = Math.hypot(d.x - s.x, d.y - s.y) / s.r;
        bands[r < .38 ? 0 : r < .72 ? 1 : 2].push(d);
      });
      for (var bd = 0; bd < 3; bd++) {
        if (!bands[bd].length) continue;
        groupDabs(bands[bd], function () { return 'b'; }, 4)
          .forEach(function (bg) {
            bg.kept.forEach(function (b) {
              var el = mkUnit(b.d, 'star-part');
              /* 核在起飞 12% 点亮，两圈晕环 45% / 80% 依次点亮 ——
                 星星是"长着"从月沿飞过去的，不落地闪现 */
              var ig = starDelay + ENG.starDur *
                (bd === 0 ? .12 : bd === 1 ? .45 : .78);
              el.style.setProperty('--ig-delay', (ig * pace).toFixed(0) + 'ms');
              g.appendChild(el);
            });
          });
      }
      push(g); reg(g, 'star');
    });

    /* 4f) 月种子：橙色实心圆（第②幕收笔）→ 点火后旋转中长成月盘 */
    var mSeed = SC.svg('g', { 'class': 'seed-moon' });
    mSeed.setAttribute('style', 'transform-box:view-box;transform-origin:' +
      M.x.toFixed(1) + 'px ' + M.y.toFixed(1) + 'px');
    mSeed.style.setProperty('--fill-delay', ((moonStart + INK + 40) * pace).toFixed(0) + 'ms');
    mSeed.style.animation =
      'seed-spin 9.5s linear ' + (rotateStart * pace).toFixed(0) + 'ms infinite,' +
      'seed-fade .7s ease ' + ((rotateStart + ENG.moonSeedFade) * pace).toFixed(0) + 'ms both';
    var mr = M.r * .62;
    var outline = SC.svg('circle', { cx: M.x.toFixed(1), cy: M.y.toFixed(1),
      r: mr.toFixed(1), pathLength: 100, fill: 'none',
      stroke: INKc[6].c, 'stroke-width': 2.6, 'class': 'ln-p' });
    outline.style.setProperty('--len', '100');
    outline.style.setProperty('--ink-dur', (INK * pace).toFixed(0) + 'ms');
    outline.style.setProperty('--ink-delay', (moonStart * pace).toFixed(0) + 'ms');
    mSeed.appendChild(outline);
    mSeed.appendChild(SC.svg('circle', { cx: M.x.toFixed(1), cy: M.y.toFixed(1),
      r: mr.toFixed(1), fill: INKc[6].c, 'class': 'seed-moon-fill' }));
    [0.9, 3.6].forEach(function (a0) {
      var a1 = a0 + 1.5, rr2 = M.r * .4;
      mSeed.appendChild(SC.svg('path', {
        d: 'M' + (M.x + Math.cos(a0) * rr2).toFixed(1) + ' ' + (M.y + Math.sin(a0) * rr2).toFixed(1) +
           'A' + rr2.toFixed(1) + ' ' + rr2.toFixed(1) + ' 0 0 1 ' +
           (M.x + Math.cos(a1) * rr2).toFixed(1) + ' ' + (M.y + Math.sin(a1) * rr2).toFixed(1),
        fill: 'none', stroke: '#e0a53e', 'stroke-width': 3.4, 'class': 'seed-mark'
      }));
    });
    push(mSeed);

    /* 4g) 月晕带 + 月盘象限：绕月心旋入（月完善自身，最顶层） */
    groupDabs(moonD, function (d) {
      if (d.ri === 0) {
        var ang = Math.atan2(d.y - M.y, d.x - M.x);
        return 'd' + (Math.floor((ang + Math.PI) / (Math.PI / 2)) % 4);
      }
      var r = Math.hypot(d.x - M.x, d.y - M.y) / M.r;
      return 'h' + (r < .84 ? 0 : r < .97 ? 1 : 2);
    }, mob ? 4 : 5).forEach(function (g) {
      var isDisk = g.key.charAt(0) === 'd';
      var idx = +g.key.charAt(1);
      g.kept.forEach(function (b, u) {
        var el = mkUnit(b.d, 'pk pk-spin');
        el.setAttribute('style', 'transform-box:view-box;transform-origin:' +
          M.x.toFixed(1) + 'px ' + M.y.toFixed(1) + 'px');
        var hsh = hashN(b.d.length * 97 + idx * 31 + (isDisk ? 5 : 9));
        el.style.setProperty('--a0', (-(120 + hsh * 160)).toFixed(0) + 'deg');
        el.style.setProperty('--sp-dur', ((isDisk ? ENG.diskDur : ENG.haloDur) * pace).toFixed(0) + 'ms');
        var dl = isDisk ? 160 + idx * ENG.diskSpread
                        : ENG.haloStart + idx * ENG.haloSpread;
        el.style.setProperty('--sp-delay', ((rotateStart + dl + u * 55) * pace).toFixed(0) + 'ms');
        push(el); reg(el, isDisk ? 'moon-disk' : 'moon-halo');
        counts.moon++;
      });
    });

    /* ── 5) 第④幕幕长 = 最晚收尾的轨道 ─────────────────────────── */
    var pieceEnd = ENG.chunkStart + (pieces.length - 1) * ENG.pieceStagger +
                   ENG.pieceDur + 220;
    var starEnd = ENG.waveStart + WAVE + ENG.starDur + 250;
    var waveEnd = ENG.waveStart + WAVE + 1600 + 180;
    var vortexEnd = ENG.vortexStart + 2 * ENG.vortexSpread + ENG.ringGap +
                    3 * ENG.sectorSpread + ENG.vortexDur + 120;
    var moonEnd = ENG.haloStart + 2 * ENG.haloSpread + ENG.haloDur + 120;
    TIMING.paint = Math.round(Math.max(pieceEnd, starEnd, waveEnd, vortexEnd, moonEnd));

    function verify() {
      var bad = 0, worst = 0, at = null, opBad = 0;
      registry.forEach(function (u, i) {
        var r = u.el.getBoundingClientRect();
        var dd = Math.hypot(r.left + r.width / 2 - u.x, r.top + r.height / 2 - u.y);
        if (dd > 2.5) {
          bad++;
          if (dd > worst) { worst = dd; at = { i: i, k: u.kind, d: Math.round(dd * 10) / 10 }; }
        }
        if (u.op != null) {
          var op = parseFloat(getComputedStyle(u.el).opacity);
          if (!(op > u.op - .06)) opBad++;
        }
      });
      var samples = [];
      registry.forEach(function (u) {
        if (samples.length >= 6) return;
        var r = u.el.getBoundingClientRect();
        var dd = Math.hypot(r.left + r.width / 2 - u.x, r.top + r.height / 2 - u.y);
        if (dd > 2.5) samples.push({ k: u.kind,
          exp: [Math.round(u.x), Math.round(u.y)],
          act: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] });
      });
      return JSON.stringify({ total: registry.length, bad: bad,
        worst: Math.round(worst * 10) / 10, at: at, opBad: opBad,
        samples: samples, counts: counts });
    }

    /* 夜色扩张与生长波严格同半径：delay=波出发时刻，dur=波时长，
       终态半径 = 最远格子的距离（略加余量） */
    var floodCfg = {
      delayMs: Math.round((rotateStart - (TIMING.quiet + sketchMs) + ENG.waveStart) * pace),
      durMs: Math.round(WAVE * pace),
      scaleEnd: clamp(maxDist / maxR * 1.04, .2, 1.06).toFixed(3)
    };
    return { el: svgL, verify: verify, counts: counts, tick: tickRibbons,
             flood: floodCfg };
  }

  /* ── 幕切换：每幕只做一次写入 ───────────────────────────────── */
  function enter(n) {
    phase = n;

    if (n === 2) {
      /* ② 构造线与种子的起笔排期全在 CSS 动画里，这里无需写入 */
    } else if (n === 3) {
      /* ③ 月心点火：种子旋转写在构建期；夜色的扩张半径从这一刻起
         与颜料生长波严格同步 —— duration = 波时长、delay = 波出发、
         线性推进，边界 = 波前 = 纯圆弧 */
      if (stage.flood && paint) {
        stage.flood.style.transition =
          'transform ' + paint.flood.durMs + 'ms linear ' + paint.flood.delayMs + 'ms,' +
          'opacity .9s ease ' + paint.flood.delayMs + 'ms';
        stage.flood.style.transform = 'scale(' + paint.flood.scaleEnd + ')';
        stage.flood.classList.add('is-open');
      }
    } else if (n === 4) {
      /* ④ 引擎流水线（排期全在构建期写好，这里只记账） */
    } else if (n === 5) {
      /* ⑤ 收束：画板退场，夜色 + 长成的画留在台上 */
      if (stage.paper) stage.paper.classList.add('is-fade');
    } else if (n === 6) {
      /* ⑥ 主页显现：粒子层与真画同位交叉淡替（内容逐像素同源），
         页面元素带 Z 轴纵深错峰落位 */
      geo.host.style.transition = 'opacity .45s ease';
      geo.host.style.opacity = '1';
      if (paint) paint.el.classList.add('is-swap');
      pageEls.forEach(function (el) {
        el.style.transition = 'opacity ' + dur(.5) + ' ease';
        el.style.opacity = '1';
        if ('inert' in el) el.inert = false;
      });
      revealNodes.forEach(function (r) {
        var d = Math.round(r.delayMs * pace) + 'ms';
        r.el.style.transition =
          'translate ' + dur(.85) + ' cubic-bezier(.18,.7,.2,1) ' + d + ', ' +
          'scale ' + dur(.85) + ' cubic-bezier(.18,.7,.2,1) ' + d + ', ' +
          'opacity ' + dur(.55) + ' ease ' + d;
        r.el.style.translate = '0px 0px 0px';
        r.el.style.scale = '1';
      });
    }
  }

  /* ── 还原：把演出期间写上去的内联样式全部收回 ───────────────── */
  function restorePage() {
    root.classList.remove('is-intro', 'is-vortex', 'is-lifted');
    root.style.removeProperty('--intro-pace');

    if (geo) {
      geo.host.style.transition = '';
      geo.host.style.opacity = '';
    }
    revealNodes.forEach(function (r) {
      r.el.style.transition = '';
      r.el.style.translate = '';
      r.el.style.scale = '';
    });
    pageEls.forEach(function (el) {
      el.style.transition = '';
      el.style.opacity = '';
      if ('inert' in el) el.inert = false;
    });
    document.documentElement.style.overflow = htmlOverflow;
  }

  /* ── 拆台：下一帧再摘节点，避免集中变更造成闪烁 ─────────────── */
  function teardown() {
    requestAnimationFrame(function () {
      if (paint && paint.el && paint.el.parentNode) paint.el.parentNode.removeChild(paint.el);
      paint = null;
      ['paper', 'flood', 'ui'].forEach(function (k) {
        if (stage && stage[k] && stage[k].parentNode) {
          stage[k].parentNode.removeChild(stage[k]);
        }
      });
      disposers.forEach(function (fn) { fn(); });
      disposers = [];
      stage = null; geo = null; pageEls = []; revealNodes = [];
      playing = false;
      SC.setIntro(false);
      if (S3 && S3.sync) S3.sync();
      document.dispatchEvent(new CustomEvent('site:intro', { detail: { playing: false } }));
      if (restartQueued) { restartQueued = false; play(); }
    });
  }

  function finish() {
    if (!playing || finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    clearTimeout(guard);
    restorePage();
    teardown();
  }

  /* ── 主流程 ─────────────────────────────────────────────────── */
  function play() {
    if (playing) return;
    playing = true;
    finished = false;
    pace = PACE * speed();
    root.style.setProperty('--intro-pace', pace.toFixed(3));
    markSeen();
    document.dispatchEvent(new CustomEvent('site:intro', { detail: { playing: true } }));

    geo = SC.prepare();
    SC.setIntro(true);
    root.classList.add('is-intro', 'is-lifted');
    htmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    stage = buildStage();
    /* 粒子层要在页面还被盖着、但布局已经成立的时候建：
       它算出的幕长直接改写时间线，演出才跟得上画笔。 */
    paint = buildPaint();
    collectReveal();
    hidePage();

    /* 画板淡入：插进去之后先强制一次重排，否则 opacity 从 0 到 1
       会和"插入"合并成同一帧，过渡根本不跑。 */
    if (stage.paper) {
      void stage.paper.offsetWidth;
      stage.paper.classList.add('is-in');
    }

    /* 演出期间真画整体压暗：画由粒子层逐步长出来，第⑥幕再交接 */
    geo.host.style.transition = 'none';
    geo.host.style.opacity = '0';
    revealNodes.forEach(function (r) {
      r.el.style.transition = 'none';
      r.el.style.translate = r.tx + ' ' + r.ty + ' -90px';
      r.el.style.scale = '.96';
    });

    on(stage.skip, 'click', finish);
    on(stage.flood, 'click', finish);
    on(document, 'keydown', function (ev) { if (ev.key === 'Escape') finish(); });

    var T1 = TIMING.quiet;
    var T2 = T1 + TIMING.sketch;
    var T3 = T2 + TIMING.ignite;
    var T4 = T3 + TIMING.paint;
    var T5 = T4 + TIMING.settle;
    var T6 = T5 + TIMING.reveal;
    start = 0; phase = 0;

    function frame(now) {
      if (!start) start = now;
      var t = (now - start) / pace;

      if (paint && paint.tick) paint.tick(t);
      if (t < T1) {
        if (phase !== 1) enter(1);        /* ① 空白画板 */
      } else if (t < T2) {
        if (phase !== 2) enter(2);        /* ② 彩色构造线 + 种子 */
      } else if (t < T3) {
        if (phase !== 3) enter(3);        /* ③ 月心点火 */
      } else if (t < T4) {
        if (phase !== 4) enter(4);        /* ④ 引擎流水线（世界爆发） */
      } else if (t < T5) {
        if (phase !== 5) enter(5);        /* ⑤ 收束 */
      } else if (t < T6) {
        if (phase !== 6) enter(6);        /* ⑥ 主页显现 + 交接 */
      } else {
        finish();
        return;
      }
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    /* 兜底计时器：时间线按 T6/pace 走（真实毫秒 = T6*pace），必须乘 */
    guard = setTimeout(finish, T6 * pace + 2200);
  }

  /* 正在演的时候再点「重新开场」，不应该变成死键：
     记一笔，等这一轮拆台完成就从第一幕重来。 */
  function requestPlay() {
    if (playing) { restartQueued = true; finish(); return; }
    play();
  }

  /* 首次进站不播（首屏已有静态画）；切回 Swiss 不播。 */
  document.addEventListener('site:themechange', function (ev) {
    var d = ev.detail || {};
    if (d.to !== 'starry' || d.play === false || reduce()) return;
    requestPlay();
  });

  /* 「已经停在星月夜」的进站必须补一次演出（每标签页、每部署前缀
     一次），否则设置面板里的「星月夜」是死键、首屏直接是成品画。 */
  function autoplay() {
    if (playing || reduce()) return;
    if (root.dataset.view === 'reading') return;
    if (root.dataset.theme !== 'starry') return;
    if (seen()) return;
    play();
  }
  autoplay();

  window.SiteIntro = {
    isPlaying: function () { return playing; },
    play: requestPlay,
    stop: finish,
    phase: function () { return phase; },
    /* 验收对账：每个粒子单元的落位中心 / 透明度 vs 构建期期望值 */
    verify: function () { return paint ? paint.verify() : '{}'; },
    counts: function () { return paint ? paint.counts : null; }
  };
})();
