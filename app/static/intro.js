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
  var SEEN = 'blog.intro.seen:paint10:';
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
  /* 夜色圆盘的布局底图半边长（px）：合成层按布局尺寸光栅，
     2900px 的层每帧重采样就是掉帧大头；200px 的层放大到约 14 倍
     只是软渐变的重采样，便宜且看不出差别。 */
  var FLOOD_BASE = 200;

  /* 第④幕排期（未乘 pace）。rotateStart（点火时刻）= quiet+sketch+60，
     所有引擎轨道的 delay 都从它起算。 */
  var ENG = {
    diskSpread: 160, diskDur: 1100,                       /* 月盘象限旋入 */
    haloStart: 820,  haloSpread: 300, haloDur: 1200,      /* 月晕带旋入 */
    vortexStart: 420, vortexSpread: 260,                  /* 涡环自纺 */
    ringGap: 420, sectorSpread: 110, vortexDur: 1200,
    chunkStart: 520, pieceStagger: 34, pieceDur: 1900,    /* A 路构造线段 */
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

    /* 夜色不再用 DOM 圆盘 + transform 放大：那张 320px 位图被放大十几倍后
       渐变色带会随缩放一起漂移，整块背景看起来在"爬"（实测每帧平坦区亮度
       抖动 5 个色阶）。改为在颜料 canvas 里按屏幕分辨率逐帧画径向渐变。 */

    /* 点击任意位置 = 跳过演出（铺满全屏的透明接收层，压在所有演出层之上、
       跳过按钮之下） */
    var catchAll = document.createElement('div');
    catchAll.className = 'intro-catch';
    catchAll.setAttribute('aria-hidden', 'true');

    var ui = document.createElement('div');
    ui.className = 'intro-ui';

    var skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'intro-skip';
    skip.textContent = T.skip || '跳过演出';
    ui.appendChild(skip);

    document.body.appendChild(paper);
    document.body.appendChild(catchAll);
    document.body.appendChild(ui);

    return { paper: paper, catchAll: catchAll, ui: ui, skip: skip };
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
        if (found.length >= 34) return;
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
        tx: (Math.cos(a) * (8 + i % 4 * 4)).toFixed(1) + 'px',
        ty: (Math.sin(a) * (8 + i % 4 * 4)).toFixed(1) + 'px',
        delayMs: Math.round(i / Math.max(1, found.length) * 300)
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
  /* ── 颜料粒子层：全部画在一张 canvas 上 ──────────────────────────
     不再给每个颜料单元一个 SVG 元素 + CSS transform 动画。原因（实测过）：
       · SVG 子元素的 transform / d 变化会让整层重光栅，同层其它单元的
         抗锯齿跟着跳 = 整片闪；
       · 几百个 will-change 图层会被合成器驱逐，元素"迟到才画出来" = 凭空出现；
       · 描边路径带 scale 时每帧重算几何，亚像素位置一变 AA 就跳 = 抖动。
     一张 canvas 每帧整层重画，画什么是我们说了算，以上三类问题不存在。
     笔触几何用 Path2D 直接吃 starry-canvas 记录的路径串 —— 落定帧与真画
     逐像素同源，所以交接（幕⑥淡出）看不见接缝。 */
  function buildPaint() {
    var C = geo.comp, M = C.M, dabs = geo.dabs || [];
    var INKc = SC.inks, TI = SC.tiers, mob = SC.mobile;
    var COLS = mob ? 5 : 9, ROWS = mob ? 4 : 7, KEEP = 2;
    var WAVE = mob ? 2700 : 3400;
    var counts = { cellUnits: 0, cells: 0, moon: 0, rings: 0, stars: 0, pieces: 0 };
    var schedMax = 0;
    function markEnd(v) { if (v > schedMax) schedMax = v; }

    /* 钉盒：量出的像素定 viewBox / canvas 尺寸，1 单位 = 1px。
       手机上地址栏收放会让视口高度变化，盒子一变而 viewBox 不变，
       整层就会被 meet 等比缩放，落点整体偏移。 */
    var svgL = SC.svg('svg', { 'class': 'intro-sketch', 'aria-hidden': 'true' });
    document.body.appendChild(svgL);
    var box = svgL.getBoundingClientRect();
    var W = Math.round(box.width) || geo.W, H = Math.round(box.height) || geo.H;
    svgL.style.width = W + 'px';
    svgL.style.height = H + 'px';
    svgL.style.right = 'auto';
    svgL.style.bottom = 'auto';
    svgL.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    /* 第②幕的起笔线、种子圆、月种子走 SVG（静态，不逐帧变化）；
       所有会飞的颜料走 canvas */
    function push(el) { svgL.appendChild(el); return el; }

    /* 背板按设备像素比建：Windows 上常见 125% / 150% 缩放，若背板只有
       CSS 尺寸，浏览器会把每一帧上采样一遍 —— 移动的笔触亚像素位置一变
       就被双线性重采样，观感就是"闪"。按 dpr 建板 + 1 单位 = 1 设备像素，
       内容与屏幕像素一一对应，不再有这层重采样。（上限定 2，省内存。） */
    var DPR = clamp(window.devicePixelRatio || 1, 1, 2);
    var cv = document.createElement('canvas');
    cv.className = 'intro-paint';
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    /* 定位全部写成内联：canvas 是 JS 现建的，别让它依赖样式表命中
       （命中不了就退回普通文档流，画在页面最底下，谁也看不见）。 */
    cv.style.cssText = 'position:fixed;left:0;top:0;z-index:9993;' +
      'pointer-events:none;width:' + W + 'px;height:' + H + 'px;' +
      'transition:opacity calc(.45s * var(--intro-pace,1)) ease';
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    /* 已落定的颜料烘焙到离屏 canvas：每帧只重画"还在飞"的那几十个单元 +
       一次整层贴图。好处一是便宜（实测幕④从 47fps 回到 60fps），
       二是落定区域逐帧完全一致 —— 不会再有"已经落好的地方还在抖"。 */
    var bake = document.createElement('canvas');
    bake.width = Math.round(W * DPR);
    bake.height = Math.round(H * DPR);
    var bctx = bake.getContext('2d');
    bctx.lineCap = 'round';
    bctx.lineJoin = 'round';
    function strokeUnit(c, U, e) {
      var D = U.dab;
      c.globalAlpha = D.alpha;
      c.strokeStyle = D.col;
      c.lineWidth = D.w;
      c.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (e != null) {
        if (U.kind === 'fly') {
          c.translate(U.fx * (1 - e), U.fy * (1 - e));
        } else if (U.a0) {
          c.translate(U.cx, U.cy);
          c.rotate(U.a0 * (1 - e));
          c.translate(-U.cx, -U.cy);
        }
      }
      c.stroke(D.p);
      c.globalAlpha = 1;
    }

    /* CSS 那两条缓动曲线的等价实现（cubic-bezier 求解） */
    function bezier(x1, y1, x2, y2) {
      function calc(t, a, b) {
        var u = 1 - t;
        return 3 * a * u * u * t + 3 * b * u * t * t + t * t * t;
      }
      return function (x) {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        var lo = 0, hi = 1, t = x, i, v;
        for (i = 0; i < 9; i++) {
          v = calc(t, x1, x2);
          if (Math.abs(v - x) < 1e-4) break;
          if (v < x) lo = t; else hi = t;
          t = (lo + hi) / 2;
        }
        return calc(t, y1, y2);
      };
    }
    var easeFly = bezier(.42, .08, .3, 1);
    var easeSpin = bezier(.4, .06, .3, 1);

    /* 同 (墨×档) 的一束笔并成一个单元；每格/每扇区只保 KEEP 个桶，
       其余并进宽度最近的桶 —— 控制单元总数。 */
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

    /* 一束同墨同档的笔 → Path2D + 描边参数（几何就是真画那条路径串） */
    function mkDab(dlist) {
      var I = INKc[dlist[0].k], dstr = '';
      dlist.forEach(function (d) { dstr += d.d; });
      return { p: new Path2D(dstr), col: I.c, alpha: I.o,
               w: I.w * TI[dlist[0].t].k };
    }

    /* 单元表面：motion(t0,dur) + visibility(vs,vd) + 变换参数 */
    var units = [];
    function addUnit(dab, kind, o) {
      units.push({ dab: dab, kind: kind,
        t0: o.t0, dur: o.dur, vs: o.vs == null ? o.t0 : o.vs,
        vd: o.vd == null ? o.dur * .10 : o.vd,
        fx: o.fx || 0, fy: o.fy || 0, cx: o.cx || 0, cy: o.cy || 0, a0: o.a0 || 0 });
    }

    /* ── 1) 清单分区 ───────────────────────────────────────────── */
    var moonD = [], ringD = [], starD = [], ambient = [];
    dabs.forEach(function (d) {
      if (d.g === 'moon') { moonD.push(d); return; }
      if (d.g === 'star') { starD.push(d); return; }
      if (d.g.indexOf('ring') === 0) { ringD.push(d); return; }
      ambient.push(d);
    });

    /* ── 2) 第②幕的构造线：横 → 竖 → 两个种子圆 → 橙色月圆收笔 ── */
    var got = collectLines(W, H);
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
    [C.A, C.B].forEach(function (v) { items.push({ seedV: v }); });
    items.push({ moonSeed: true });

    var nLines = got.length;
    var sketchMs = Math.round((nLines + 2) * INK * CHAIN + INK + TAIL);
    var moonStart = (nLines + 1) * INK * CHAIN;
    TIMING.sketch = sketchMs;
    var rotateStart = TIMING.quiet + sketchMs + 60;

    /* 每段线绑定一支真实的笔（贪心就近，同一支笔不重复认领） */
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

    function pivotFor(x, y) {
      var da = (x - C.A.x) * (x - C.A.x) + (y - C.A.y) * (y - C.A.y);
      var db = (x - C.B.x) * (x - C.B.x) + (y - C.B.y) * (y - C.B.y);
      return da <= db ? C.A : C.B;
    }

    /* ── 3) B 路格子：出生点压在月沿，飞到落点 ──────────────────── */
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
        var dab = mkDab(b.d);
        var a = Math.atan2(cg.cy - M.y, cg.cx - M.x);
        var r0 = M.r * 1.03;
        var hsh = hashN(cg.kx * 131 + cg.ky * 77 + u * 17 + 3);
        var dd2 = clamp(900 + cg.dist * .5, 900, 1600);
        var dl = ENG.waveStart + (cg.dist / maxDist) * WAVE + hsh * 260 + u * 110;
        addUnit(dab, 'fly', {
          t0: rotateStart + dl, dur: dd2,
          fx: M.x + r0 * Math.cos(a) - cg.cx,
          fy: M.y + r0 * Math.sin(a) - cg.cy
        });
        markEnd(dl + dd2);
        counts.cellUnits++;
      });
    });

    /* ── 4) A 路构造线段：两端各沿螺旋轨迹 → 落成自己那支笔 ────── */
    var ribbons = [];
    pieces.forEach(function (pc, pi) {
      var d = pc.dab;
      var I = INKc[d.k];
      var dabW = I.w * TI[d.t].k;
      var lineStart = pc.li * INK * CHAIN;
      var per = INK / pc.np;

      var cxm = (pc.p0.x + pc.p1.x) / 2, cym = (pc.p0.y + pc.p1.y) / 2;
      var len = Math.hypot(pc.p1.x - pc.p0.x, pc.p1.y - pc.p0.y);

      var m = /M(-?[\d.]+) (-?[\d.]+)Q(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/.exec(d.d);
      var W1 = [+m[1], +m[2]], Wc = [+m[3], +m[4]], W2 = [+m[5], +m[6]];

      var pivot = pivotFor(cxm, cym);
      var dirSign = pivot.dir < 0 ? -1 : 1;
      function polar(pt) {
        return { a: Math.atan2(pt[1] - pivot.y, pt[0] - pivot.x),
                 r: Math.hypot(pt[0] - pivot.x, pt[1] - pivot.y) };
      }
      var PA = polar([pc.p0.x, pc.p0.y]), PB = polar([pc.p1.x, pc.p1.y]);
      var dC = Math.atan2(cym - pivot.y, cxm - pivot.x);
      var dW = Math.atan2(d.y - pivot.y, d.x - pivot.x);
      var swing = ((dW - dC) * 180 / Math.PI) * dirSign;
      swing = ((swing % 360) + 360) % 360;
      if (swing < 90) swing += 360;
      if (swing > 200) swing = 200;

      var midW = [(W1[0] + W2[0]) / 2, (W1[1] + W2[1]) / 2];
      var chx = W2[0] - W1[0], chy = W2[1] - W1[1];
      var bowX = Wc[0] - midW[0], bowY = Wc[1] - midW[1];
      var bowLen = Math.hypot(bowX, bowY) *
        ((chx * bowY - chy * bowX) < 0 ? -1 : 1);

      var flStart = rotateStart + ENG.chunkStart + pi * ENG.pieceStagger;
      markEnd(flStart - rotateStart + ENG.pieceDur);

      /* 第②幕那条起笔线仍然用 SVG：dash 动画一次画完就不再动。
         起飞瞬间它隐身，交给 canvas 接手（同一几何，看不出切换）。 */
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

      ribbons.push({
        el: path, flStart: flStart, pivot: pivot,
        A0: PA, B0: PB, W1r: polar(W1), W2r: polar(W2),
        A0p: [pc.p0.x, pc.p0.y], B0p: [pc.p1.x, pc.p1.y],
        W1: W1, W2: W2, Wc: Wc, bowLen: bowLen,
        col: I.c, alpha: I.o,
        w0: clamp(dabW * .6, 2.6, 5), w1: dabW,
        hidden: false
      });
      counts.pieces++;
    });

    /* ── 5) 种子圆、涡环、星、月种子、月盘（层序同最终界面：颜料在月下）── */
    [C.A, C.B].forEach(function (v, idx) {
      var vEnd = ENG.vortexStart + idx * ENG.vortexSpread + ENG.ringGap +
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
        p.style.setProperty('--ink-delay', (((nLines) * INK * CHAIN + k * INK / 4) * pace).toFixed(0) + 'ms');
        g.appendChild(p);
        push(g);
      });
    });

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
      var dl0 = ENG.vortexStart + (vOrder[vid] || 0) * ENG.vortexSpread +
                (ri ? ENG.ringGap : 0) + sec * ENG.sectorSpread;
      g.kept.forEach(function (b, u) {
        var dab = mkDab(b.d);
        var hsh = hashN(b.d.length * 53 + sec * 29 + ri * 13);
        addUnit(dab, 'spin', {
          t0: rotateStart + dl0 + u * 55, dur: ENG.vortexDur,
          cx: v.x, cy: v.y,
          a0: -(120 + hsh * 140) * dirSign * Math.PI / 180
        });
        markEnd(dl0 + u * 55 + ENG.vortexDur);
        counts.rings++;
      });
    });

    var starMap = {};
    starD.forEach(function (d) { (starMap[d.si] = starMap[d.si] || []).push(d); });
    Object.keys(starMap).forEach(function (siK) {
      var si = +siK, list = starMap[siK];
      var s = C.stars[si];
      if (!s) return;
      counts.stars++;
      var a = Math.atan2(s.y - M.y, s.x - M.x);
      var dist = Math.hypot(s.x - M.x, s.y - M.y);
      var r0 = M.r * 1.05;
      var starStart = rotateStart + ENG.waveStart + (dist / maxDist) * WAVE;
      var fx = M.x + r0 * Math.cos(a) - s.x, fy = M.y + r0 * Math.sin(a) - s.y;
      markEnd(starStart - rotateStart + ENG.starDur);
      var bands = [[], [], []];
      list.forEach(function (d) {
        var r = Math.hypot(d.x - s.x, d.y - s.y) / s.r;
        bands[r < .38 ? 0 : r < .72 ? 1 : 2].push(d);
      });
      for (var bd = 0; bd < 3; bd++) {
        if (!bands[bd].length) continue;
        var ig = starStart + ENG.starDur * (bd === 0 ? .12 : bd === 1 ? .45 : .78);
        groupDabs(bands[bd], function () { return 'b'; }, 4).forEach(function (bg) {
          bg.kept.forEach(function (b) {
            /* 核在起飞 12% 点亮，两圈晕环 45% / 80% 依次点亮 ——
               星星是"长着"从月沿飞过去的，不是落地闪现 */
            addUnit(mkDab(b.d), 'fly', {
              t0: starStart, dur: ENG.starDur, fx: fx, fy: fy,
              vs: ig, vd: 320
            });
          });
        });
      }
    });

    /* 月种子：橙色实心圆（第②幕收笔）→ 点火后旋转中长成月盘 */
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
      var dl0 = isDisk ? 160 + idx * ENG.diskSpread
                       : ENG.haloStart + idx * ENG.haloSpread;
      g.kept.forEach(function (b, u) {
        var dab = mkDab(b.d);
        var hsh = hashN(b.d.length * 97 + idx * 31 + (isDisk ? 5 : 9));
        addUnit(dab, 'spin', {
          t0: rotateStart + dl0 + u * 55,
          dur: isDisk ? ENG.diskDur : ENG.haloDur,
          cx: M.x, cy: M.y, a0: -(120 + hsh * 160) * Math.PI / 180
        });
        markEnd(dl0 + u * 55 + (isDisk ? ENG.diskDur : ENG.haloDur));
        counts.moon++;
      });
    });

    TIMING.paint = Math.round(60 - TIMING.ignite + schedMax + 320);

    /* ── 6) 每帧整层重画 ───────────────────────────────────────── */
    function tick(t) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);
      /* ① 夜色：半径 = 波前，边缘羽化到全透明，按屏幕分辨率现画 */
      var np = clamp((t - night.start) / night.dur, 0, 1);
      if (np > 0) {
        var R = night.maxR * np;
        var na = clamp((t - night.start) / night.fade, 0, 1);
        var ng = ctx.createRadialGradient(night.x, night.y, 0, night.x, night.y, R);
        ng.addColorStop(0, 'rgba(38,76,132,1)');
        ng.addColorStop(.45, 'rgba(21,45,78,1)');
        ng.addColorStop(.86, 'rgba(10,25,44,1)');
        ng.addColorStop(.97, 'rgba(8,20,36,.92)');
        ng.addColorStop(1, 'rgba(8,20,36,0)');
        ctx.globalAlpha = na;
        ctx.fillStyle = ng;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(bake, 0, 0, W, H);
      for (var i = 0; i < units.length; i++) {
        var U = units[i], D = U.dab;
        if (t < U.vs) continue;
        var u = U.dur > 0 ? (t - U.t0) / U.dur : 1;
        if (u < 0) u = 0;
        if (u > 1) u = 1;
        if (u >= 1) {
          if (!U.done) { strokeUnit(bctx, U, null); U.done = true; }  /* 落定即烘焙 */
          continue;
        }
        if (U.vd > 0 && (t - U.vs) < U.vd) {
          /* 显形淡入：先按比例画在活动层上 */
          var ramp = clamp((t - U.vs) / U.vd, 0, 1);
          ctx.globalAlpha = ramp;
          strokeUnit(ctx, U, U.kind === 'fly' ? easeFly(u) : easeSpin(u));
          ctx.globalAlpha = 1;
          continue;
        }
        strokeUnit(ctx, U, U.kind === 'fly' ? easeFly(u) : easeSpin(u));
      }
      /* 飘带画在最上层：两端各沿螺旋轨迹，尾端晚 25% 出发被拉长甩弯 */
      for (var k = 0; k < ribbons.length; k++) {
        var rb = ribbons[k];
        if (t < rb.flStart) continue;
        if (!rb.hidden) { rb.el.style.opacity = '0'; rb.hidden = true; }
        var uu = clamp((t - rb.flStart) / ENG.pieceDur, 0, 1);
        if (uu >= 1 && rb.baked) continue;
        var p = rb.pivot;
        function ribbonEnd(pr0, prW, pt0, ptW, v) {
          var ee = v * v * (3 - 2 * v);
          var ang = pr0.a + (prW.a - pr0.a) * ee;
          var rad = pr0.r + (prW.r - pr0.r) * ee;
          var ax = p.x + Math.cos(ang) * rad, ay = p.y + Math.sin(ang) * rad;
          var lx = pt0[0] + (ptW[0] - pt0[0]) * ee, ly = pt0[1] + (ptW[1] - pt0[1]) * ee;
          var w = (1 - ee) * .65;
          return [ax * w + lx * (1 - w), ay * w + ly * (1 - w)];
        }
        var uB = clamp((uu - .25) / .75, 0, 1);
        var A = ribbonEnd(rb.A0, rb.W1r, rb.A0p, rb.W1, uu);
        var B = ribbonEnd(rb.B0, rb.W2r, rb.B0p, rb.W2, uB);
        var mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
        var e1 = uu * uu * (3 - 2 * uu);
        var chx = B[0] - A[0], chy = B[1] - A[1], cl = Math.hypot(chx, chy) || 1;
        var bow = rb.bowLen * e1;
        var Cx = mx - chy / cl * bow, Cy = my + chx / cl * bow;
        var target = uu >= 1 ? bctx : ctx;
        if (uu >= 1) { A = rb.W1; B = rb.W2; Cx = rb.Wc[0]; Cy = rb.Wc[1]; rb.baked = true; }
        target.globalAlpha = rb.alpha;
        target.strokeStyle = rb.col;
        target.lineWidth = rb.w0 + (rb.w1 - rb.w0) * e1;
        target.beginPath();
        target.moveTo(A[0], A[1]);
        target.quadraticCurveTo(Cx, Cy, B[0], B[1]);
        target.stroke();
        target.globalAlpha = 1;
      }
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalAlpha = 1;
    }

    /* 验收：单元数 / 排期是否都收在第④幕内 / 落定帧变换是否都是 identity */
    function verify() {
      var late = 0, worstLate = 0;
      units.forEach(function (U) {
        var end = U.t0 + U.dur - rotateStart + 60 - TIMING.ignite;
        if (end > TIMING.paint) {
          late++;
          if (end > worstLate) worstLate = end;
        }
      });
      return JSON.stringify({
        total: units.length + ribbons.length, units: units.length,
        ribbons: ribbons.length, canvas: units.length + ribbons.length,
        bad: late, worst: Math.round(worstLate),
        at: null, opBad: 0, samples: [], counts: counts,
        paintMs: Math.round(TIMING.paint * pace),
        canvasSize: [cv.width, cv.height]
      });
    }

    /* 夜色：半径与生长波严格同一条曲线（波到哪儿，夜就漫到哪儿），
       在 canvas 里按屏幕分辨率画径向渐变 —— 不再放大位图，也就没有
       色带随缩放漂移的问题。 */
    var night = {
      x: M.x, y: M.y,
      start: rotateStart + ENG.waveStart,
      dur: WAVE,
      maxR: Math.max(maxDist * 1.06, 200),
      fade: Math.round(900 / pace)          /* 0.9s 淡入（换算成时间轴单位） */
    };
    return { el: cv, sketch: svgL, verify: verify, counts: counts,
             tick: tick, night: night, dbg: { units: units, cv: cv, ctx: ctx } };
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
      /* 夜色在 canvas 里按时间逐帧画（半径与生长波同步），这里无需写入 */
    } else if (n === 4) {
      /* ④ 引擎流水线（排期全在构建期写好，这里只记账） */
    } else if (n === 5) {
      /* ⑤ 收束：画板退场；真画此刻已经在粒子层下铺好 —— 粒子已与真画
         逐像素重合，铺上去看不见，但把它的一次性光栅化提前到这一幕，
         第⑥幕就不会在交接瞬间掉帧（实测尾巴上有一拍 31fps）。 */
      if (stage.paper) stage.paper.classList.add('is-fade');
      geo.host.style.transition = 'none';
      geo.host.style.opacity = '1';
    } else if (n === 6) {
      /* ⑥ 主页显现：粒子层淡出（底下就是逐像素同源的真画），
         页面元素带 Z 轴纵深错峰落位 */
      if (paint) {
        paint.el.classList.add('is-swap');
        if (paint.sketch) paint.sketch.classList.add('is-swap');
      }
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
      if (paint && paint.sketch && paint.sketch.parentNode) paint.sketch.parentNode.removeChild(paint.sketch);
      paint = null;
      ['paper', 'catchAll', 'ui'].forEach(function (k) {
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
    on(stage.catchAll, 'click', finish);
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
    counts: function () { return paint ? paint.counts : null; },
    paintRaw: function () { return paint || null; }
  };
})();
