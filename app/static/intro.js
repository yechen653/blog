/* ============================================================
   intro.js — 星月夜揭幕演出
   ------------------------------------------------------------
   叙事：空白画板 → 一条一条画出页面的构造线 → 油画显影 → 月心迸发
         → 构造线断成段、绕着两个涡心转半圈，落回各自的版式边线
         → 夜空从月心漫开 → 个人主页显现

   各幕对应的实现：
     ① 空白画板   .intro-paper 淡入；页面元素先隐去
     ② 构造线     按页面真实边线（masthead 分隔线 / hero 分隔线 /
                  侧栏竖线 / 卡片框 …）现算坐标，先横后竖，最后两个
                  圆；一条画到 80% 才开始下一条
     ③ 油画显影   底纹与各旋转点分层淡入，构造线留在最上层
     ④ 月心迸发   画里的月盘不动，只从盘沿甩出一圈暖色厚笔
     ⑤ 断线归位   每段线绕最近的涡心转 ≥180°，再飞回自己那条边线；
                  落点与最终页面逐像素重合，所以页面显现时看不出接缝
     ⑥ 世界爆发   夜盘从月心向外铺开，各旋转点切快速公转
     ⑦ 主页显现   画板与夜盘淡出，构造线褪掉，页面元素带 Z 轴纵深错峰落位

   性能约束沿用上一版：所有 <path d> 只生成一次，演出期间
   setAttribute('d') = 0；每帧不写任何像素，全部交给 CSS 合成器。
   ============================================================ */
(function () {
  'use strict';

  var SC = window.StarryCanvas;
  var S3 = window.Starry3D;
  if (!SC) { console.error('[intro] 缺少 starry-canvas.js'); return; }

  var T = (window.SITE_CONFIG || {}).themes || {};
  var root = document.documentElement;

  /* 本次会话是否已经看过演出的标记。
     键里带上部署前缀（/、/v2/、/v3/ 各自独立），否则同一个域名下
     看过主页的演出，预览环境里的新版就再也不播了。 */
  var SEEN = 'blog.intro.seen:';
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

  var TIMING = {
    quiet: 380,      /* ① 空白画板 */
    sketch: 1800,    /* ② 构造线（play() 里按线段数改写成真实排期） */
    fill: 620,       /* ③ 油画显影 */
    wake: 780,       /* ④ 月心迸发 */
    air: 1150,       /* ⑤ 断线、绕涡心、落位 */
    flood: 780,      /* ⑥ 世界爆发 */
    settle: 280,     /* 收束 */
    reveal: 780      /* ⑦ 主页显现 */
  };
  /* 整体放慢系数：1 = 原速。要调快慢只改这一个数 ——
     幕的时长、层间过渡（内联 + CSS 的 --intro-pace）、涡臂公转、
     迸发笔触全部乘它。只改 TIMING 不改 CSS 会出现
     "时间线拉开了、过渡还是原速"的前松后紧。 */
  var PACE = 1.6;
  function speed() { return SC.mobile ? .78 : 1; }
  /* 实际倍率：移动端屏幕小、看完更快，乘 .78 反而更紧凑 */
  var pace = PACE;
  function dur(sec) { return (sec * pace).toFixed(2) + 's'; }

  /* ── 构造线的排期参数（未乘 pace）────────────────────────────
     INK 是"一条线画完"的时长；CHAIN 是下一条的起笔点 —— .8 就是
     「上一条画到 80% 才轮到下一条」。 */
  var INK = 300, CHAIN = .8, TAIL = 160;
  /* 断线那一段：每段绕行的基础时长 + 彼此的错峰间隔（未乘 pace） */
  var AIR_BASE = 1000, AIR_STAGGER = 26;

  var REVEAL_SELECTORS = [
    '.masthead-inner', '.brand', '.nav', '.kicker', '.hero-title', '.hero-meta',
    '.section-label', '.prose p', '.widget-list li', '.widget--box',
    '.section-note', '.link-card', '.widget--back', '.toolbar',
    '#list .card', '.pager', '.detail', '.footer-row', '.footer-word'
  ];

  var playing = false, raf = 0, guard = 0, stage = null, geo = null, guide = null;
  var pageEls = [], revealNodes = [], disposers = [];
  var burstFx = null;
  var maxR = 0;
  var start = 0, phase = 0, finished = false, htmlOverflow = '';
  var burstPlayed = false, restartQueued = false;

  function reduce() {
    return !!(window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function on(target, type, fn) {
    target.addEventListener(type, fn);
    disposers.push(function () { target.removeEventListener(type, fn); });
  }
  function ease(u) { return 1 - Math.pow(1 - u, 2.2); }

  /* ── 舞台：画板 / 夜盘 / UI（迸发层按需插入） ─────────────────
     画板就是开场那张奶油纸：① 它淡入，② 在上面画两条涡臂，
     ③ 油画显影盖上来，⑤ 夜空从月心漫开把它换掉，⑥ 一起退场。 */
  function buildStage() {
    var W = geo.W, H = geo.H, C = geo.comp, M = C.M;

    maxR = Math.hypot(Math.max(M.x, W - M.x), Math.max(M.y, H - M.y)) * 1.12;

    var paper = document.createElement('div');
    paper.className = 'intro-paper';
    paper.setAttribute('aria-hidden', 'true');

    /* 夜盘：铺满整个屏幕的夜空白，初始缩到月心一点，第 ⑤ 幕放大。
       它压在画层【下面】，所以笔触全程不会被遮住 —— 变的是"画板"
       被夜空替换，正是"星月夜底色从月亮里漫出来"。 */
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

  /* 落点元素必须排除在"错峰落位"之外：它们带的是构造线要对齐的那条边，
     一旦被 translate 推开十几像素，线就会落在半空中。 */
  function collectReveal(exclude) {
    var skip = exclude || [];
    var found = [];
    REVEAL_SELECTORS.forEach(function (sel) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
        if (found.length >= 48) return;
        for (var q = 0; q < skip.length; q++) { if (skip[q] === el) return; }
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
        /* 存毫秒数，真正用到时再乘放慢系数 —— 这里要是先拼成字符串，
           以后调 PACE 就得重新解析时间。 */
        delayMs: Math.round(i / Math.max(1, found.length) * 340)
      };
    });
  }

  /* ── 构造线 ────────────────────────────────────────────────────
     整场演出里唯一"画"出来的东西。坐标不是拍百分比，而是去量页面
     自己那些 1px 分隔线的位置 —— 这样第 ⑤ 幕落位之后，每一条线都能
     在最终页面上找到对应，页面显出来时看不出接缝。

     起笔时给一个固定的手绘偏移（下面 JIT 表），落位时再修正回真实
     位置：先"随手起的稿"，后"对齐到版式"，落位才有意义。 */

  /* 每条线量什么：h 横线 / v 竖线，side 是量哪条边 */
  var LINE_PLAN = [
    { sel: '.masthead',          side: 'bottom', kind: 'h' },
    { sel: '.hero',              side: 'bottom', kind: 'h' },
    { sel: '.section-label',     side: 'bottom', kind: 'h' },
    /* 列表页的文章行就是它的行分隔线，取两行；个人页没有 #list，自动跳过 */
    { sel: '#list .card',        side: 'bottom', kind: 'h', all: 2 },
    { sel: '.widget--box',       side: 'top',    kind: 'h' },
    { sel: '.widget--box',       side: 'bottom', kind: 'h' },
    { sel: '.site-footer',       side: 'top',    kind: 'h' },
    { sel: '.layout > .sidebar', side: 'left',   kind: 'v' },
    { sel: '.widget--box',       side: 'left',   kind: 'v' },
    { sel: '.hero-meta',         side: 'left',   kind: 'v' }
  ];
  var MAX_H = 5, MAX_V = 3;
  /* 起笔偏移：横向多给一点，竖向少量；固定表 → 每次重播画的是同一张稿 */
  var JIT = [[-13, 8], [12, -7], [-9, -10], [15, 7], [-11, 11],
             [9, 9], [14, -8], [-7, -7], [10, 10]];

  function segOf(el, side, W, H) {
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    var s;
    /* 边框占 [bottom-1, bottom]，所以线的中心线在 bottom-.5 —— 取整
       会在 1.5 倍缩放的手机上偏出小半像素，落位就"差一点点"。 */
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
    var hs = [], vs = [], owners = [];
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
        /* 同一条边可能被两个选择器量到（sidebar 左边 / 卡片左边），去重 */
        if (pool.some(function (o) {
          return Math.abs(o.y1 - s.y1) < 4 && Math.abs(o.x1 - s.x1) < 4 &&
                 Math.abs(o.x2 - s.x2) < 40;
        })) continue;
        s.el = el;
        pool.push(s);
        owners.push(el);
      }
    });
    hs.sort(function (a, b) { return a.y1 - b.y1; });
    vs.sort(function (a, b) { return a.x1 - b.x1; });
    return { segs: hs.concat(vs), owners: owners };
  }

  function chunkCount(len) {
    return len > 900 ? 4 : len > 520 ? 3 : 2;
  }

  /* 一个圆拆成 4 段弧 —— 画的时候像笔顺着涡心绕一圈，
     断线之后这 4 段各自绕涡心转，最后并回原来的环。
     sweep 恒为 1：屏幕坐标是 y 向下，角度递增在视觉上就是顺时针；
     之前按涡旋方向写 0，结果四段弧全部向内凹，圆圈被画成了四角星。
     涡旋方向只用来决定这四段的先后顺序（反着排 = 逆时针落笔）。 */
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
        len: r * Math.PI / 2,
        p0: { x: x0, y: y0 },
        t0: { x: x0, y: y0 },
        t1: { x: x1, y: y1 }
      });
    }
    return dir < 0 ? out.reverse() : out;
  }

  /* 组装：建 SVG、按排期写延迟、按最近涡心算绕行角度与落位位移。
     全部一次性算完写进 CSS 变量，之后每帧不碰任何属性。 */
  function buildGuide() {
    var C = geo.comp;
    /* viewBox 必须取自这层 SVG 自己的盒子，而不是 geo.W/H：手机上
       window.innerHeight 和 position:fixed 元素的盒子高度会差几像素，
       默认的 xMidYMid meet 会把整层等比缩放再居中 —— 线看着好好的，
       落位却整体偏 1~3px。盒子量出来再定 viewBox，1 单位就是 1px。 */
    var svgEarly = SC.svg('svg', { 'class': 'intro-guide', 'aria-hidden': 'true' });
    document.body.appendChild(svgEarly);
    var box = svgEarly.getBoundingClientRect();
    var W = Math.round(box.width) || geo.W, H = Math.round(box.height) || geo.H;
    /* 把这一层的盒子按量到的像素钉死：手机上地址栏收放会让视口高度变，
       盒子一变、viewBox 不变，整层就被 meet 等比缩放（实测偏 0.6%，
       落到 400px 处就是 2.4px）。钉死之后 1 单位恒等于 1px。 */
    svgEarly.style.width = W + 'px';
    svgEarly.style.height = H + 'px';
    svgEarly.style.right = 'auto';
    svgEarly.style.bottom = 'auto';
    svgEarly.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var got = collectLines(W, H);
    var items = [], j = 0;

    got.segs.forEach(function (s) {
      var len = Math.sqrt(Math.pow(s.x2 - s.x1, 2) + Math.pow(s.y2 - s.y1, 2));
      var n = chunkCount(len), k;
      var jit = JIT[j % JIT.length];
      var ox = s.kind === 'v' ? Math.round(jit[0] * .5) : jit[0];
      var oy = s.kind === 'v' ? jit[1] : Math.round(jit[1] * .6);
      var chunks = [];
      for (k = 0; k < n; k++) {
        var t0 = k / n, t1 = (k + 1) / n;
        chunks.push({
          p0: { x: s.x1 + (s.x2 - s.x1) * t0 + ox, y: s.y1 + (s.y2 - s.y1) * t0 + oy },
          p1: { x: s.x1 + (s.x2 - s.x1) * t1 + ox, y: s.y1 + (s.y2 - s.y1) * t1 + oy },
          t0: { x: s.x1 + (s.x2 - s.x1) * t0, y: s.y1 + (s.y2 - s.y1) * t0 },
          t1: { x: s.x1 + (s.x2 - s.x1) * t1, y: s.y1 + (s.y2 - s.y1) * t1 }
        });
      }
      items.push({
        chunks: chunks, w: s.kind === 'h' ? 1.5 : 1.4,
        kind: s.kind, j: j++
      });
    });

    /* 最后两个圆：绕主涡 / 副涡各画一圈 */
    [C.A, C.B].forEach(function (v, idx) {
      var r = v.r * .34;
      var ox = idx ? -7 : 6, oy = idx ? 6 : -5;
      items.push({
        chunks: arcsOf(v.x + ox, v.y + oy, r + 3, v.dir),
        cx: v.x, cy: v.y, w: 1.3, kind: 'o', j: j++, round: true
      });
    });

    var svg = svgEarly;
    var groups = [], airList = [], order = 0;
    var airBase = AIR_BASE * pace;

    items.forEach(function (it, li) {
      var lineStart = li * INK * CHAIN * pace;
      var per = INK * pace / it.chunks.length;
      /* 绕哪个中心：线段中点离 A / B 谁近就绕谁 */
      var mid = it.chunks[Math.floor(it.chunks.length / 2)].p0;
      var va = Math.sqrt(Math.pow(mid.x - C.A.x, 2) + Math.pow(mid.y - C.A.y, 2));
      var vb = Math.sqrt(Math.pow(mid.x - C.B.x, 2) + Math.pow(mid.y - C.B.y, 2));
      var pivot = it.round ? it : (va <= vb ? C.A : C.B);
      var ax = it.round ? it.cx : pivot.x;
      var ay = it.round ? it.cy : pivot.y;
      var dirSign = (pivot.dir || 1) < 0 ? -1 : 1;

      it.chunks.forEach(function (ch, k) {
        var g = SC.svg('g', { 'class': 'gk' });
        var p = SC.svg('path', {
          d: it.round ? ch.d : ('M' + ch.p0.x.toFixed(1) + ' ' + ch.p0.y.toFixed(1) +
                                'L' + ch.p1.x.toFixed(1) + ' ' + ch.p1.y.toFixed(1)),
          'stroke-width': it.w, 'class': 'gk-p'
        });
        g.appendChild(p);

        /* 起笔：dasharray = 整段长度，dashoffset 从 len 收到 0 */
        var len = it.round ? ch.len :
          Math.sqrt(Math.pow(ch.p1.x - ch.p0.x, 2) + Math.pow(ch.p1.y - ch.p0.y, 2));
        p.style.setProperty('--len', len.toFixed(1));
        p.style.setProperty('--ink-dur', per.toFixed(0) + 'ms');
        p.style.setProperty('--ink-delay', (lineStart + k * per).toFixed(0) + 'ms');

        /* 绕行 + 落位：角度至少半圈（185°），每段再错开一点 → 断线 */
        var spin = dirSign * (185 + k * 9 + (li % 3) * 7);
        var dx = ch.t0.x - ch.p0.x;
        var dy = ch.t0.y - ch.p0.y;
        g.style.setProperty('--ax', ax.toFixed(1) + 'px');
        g.style.setProperty('--ay', ay.toFixed(1) + 'px');
        g.style.setProperty('--spin', spin.toFixed(0) + 'deg');
        g.style.setProperty('--dx', dx.toFixed(1) + 'px');
        g.style.setProperty('--dy', dy.toFixed(1) + 'px');
        g.style.setProperty('--air-dur', airBase.toFixed(0) + 'ms');
        g.style.setProperty('--air-delay', (order * AIR_STAGGER * pace).toFixed(0) + 'ms');
        order++;

        svg.appendChild(g);
        groups.push(g);
        airList.push({ g: g, target: ch.t0 });
      });
    });

    return {
      el: svg, groups: groups,
      /* 草图幕的时长：最后一条起笔 + 它自己画完 + 一点余量 */
      ms: Math.round((items.length - 1) * INK * CHAIN + INK + TAIL),
      /* 断线幕的时长必须盖住最后一段落位，否则页面会在半路亮起来 */
      /* +140 的余量：末段刚刚落位就把页面推上来，会有 1~3px 的"还没站稳" */
      airMs: Math.round(AIR_BASE + AIR_STAGGER * Math.max(0, order - 1) + 140),
      owners: got.owners, segs: got.segs, targets: airList
    };
  }

  /* ── 幕切换：每幕只做一次写入 ───────────────────────────────── */
  function enter(n) {
    phase = n;
    var C = geo.comp;

    if (n === 1) {
      /* ① 画板已经在 play() 里淡入，这里只是让夜色静一拍 */
    } else if (n === 2) {
      /* ② 构造线：每条线的起笔延迟在 buildGuide() 里就写死了，
         这一幕只负责把画层停住，别再往纸上叠东西 */
      geo.base.style.transition = '';
      geo.rings.forEach(function (g) { g.style.transition = ''; });
    } else if (n === 3) {
      /* ③ 油画显影：底纹铺上，各旋转点错峰跟上，月亮排在最后 ——
         "把太阳画完"正好成为下一幕的引信。构造线留在最上层 */
      geo.base.style.transition = 'opacity ' + dur(.85) + ' ease';
      geo.base.style.opacity = '1';
      geo.rings.forEach(function (g, i) {
        var isMoon = g.getAttribute('data-v') === 'M';
        var d = isMoon ? 560 : (i * 55);
        g.style.transition = 'opacity ' + dur(.52) + ' ease ' + Math.round(d * pace) + 'ms';
        g.style.opacity = '1';
      });
    } else if (n === 4) {
      /* ④ 月心迸发：画里的月盘不动，只从盘沿甩出暖色厚笔 */
      if (S3) {
        burstFx = S3.burst({
          x: C.M.x, y: C.M.y, r: C.M.r * .62,
          W: geo.W, H: geo.H, count: SC.mobile ? 18 : 28
        });
      }
    } else if (n === 5) {
      /* ⑤ 断线归位：整层加 is-air，每段开始"绕涡心 → 飞回落点"。
         这一刻开始页面不再被遮，构造线自己会走到版式上去。 */
      if (guide) guide.el.classList.add('is-air');
    } else if (n === 6) {
      /* ⑥ 世界爆发：旋转点提速，夜空从月心向外铺满 */
      root.classList.add('is-vortex');
      if (stage.flood) stage.flood.classList.add('is-open');
    } else if (n === 7) {
      /* 收束：画板与夜盘一起退场，画层直接落在页面自己的夜色上 */
      if (stage.paper) stage.paper.classList.add('is-fade');
      if (stage.flood) stage.flood.classList.add('is-fade');
      if (burstFx) burstFx.fade();
    } else if (n === 8) {
      /* ⑦ 主页显现：构造线正好压在各自那条边线上，一起淡掉换真边线 */
      if (guide) guide.el.classList.add('is-fade');
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
      geo.base.style.transition = '';
      geo.base.style.opacity = '';
      geo.rings.forEach(function (g) {
        g.style.transition = '';
        g.style.opacity = '';
      });
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
    if (burstFx) { burstFx.destroy(); burstFx = null; }
    requestAnimationFrame(function () {
      if (guide && guide.el && guide.el.parentNode) guide.el.parentNode.removeChild(guide.el);
      guide = null;
      ['paper', 'flood', 'ui'].forEach(function (k) {
        if (stage && stage[k] && stage[k].parentNode) {
          stage[k].parentNode.removeChild(stage[k]);
        }
      });
      disposers.forEach(function (fn) { fn(); });
      disposers = [];
      stage = null; geo = null; pageEls = []; revealNodes = [];
      playing = false;
      burstPlayed = false;
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
    burstPlayed = false;
    pace = PACE * speed();
    /* CSS 侧的过渡 / 动画时长都乘这个变量，保证层间节奏与时间线同步 */
    root.style.setProperty('--intro-pace', pace.toFixed(3));
    markSeen();
    document.dispatchEvent(new CustomEvent('site:intro', { detail: { playing: true } }));

    geo = SC.prepare();
    SC.setIntro(true);
    root.classList.add('is-intro', 'is-lifted');
    htmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    stage = buildStage();
    /* 构造线要在页面还被盖着、但布局已经成立的时候量坐标；
       它算出来的总时长直接改写第 ② 幕的幕长，时间线才跟得上画笔。 */
    guide = buildGuide();
    TIMING.sketch = guide.ms;
    TIMING.air = guide.airMs;
    collectReveal(guide.targets);
    hidePage();

    /* 画板淡入：插进去之后先强制一次重排，否则 opacity 从 0 到 1
       会和"插入"合并成同一帧，过渡根本不跑。 */
    if (stage.paper) {
      void stage.paper.offsetWidth;
      stage.paper.classList.add('is-in');
    }

    geo.base.style.transition = 'none';
    geo.base.style.opacity = '0';
    geo.rings.forEach(function (g) { g.style.transition = 'none'; g.style.opacity = '0'; });
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
    var T3 = T2 + TIMING.fill;
    var T4 = T3 + TIMING.wake;
    var T5 = T4 + TIMING.air;
    var T6 = T5 + TIMING.flood;
    var T7 = T6 + TIMING.settle;
    var T8 = T7 + TIMING.reveal;
    start = 0; phase = 0;

    function frame(now) {
      if (!start) start = now;
      var t = (now - start) / pace;

      if (t < T1) {
        /* ① 空白画板 */
        if (phase !== 1) enter(1);
      } else if (t < T2) {
        /* ② 构造线：起笔排期全在 CSS 动画里，这里不再写任何属性 */
        if (phase !== 2) enter(2);
      } else if (t < T3) {
        /* ③ 油画显影 */
        if (phase !== 3) enter(3);
      } else if (t < T4) {
        /* ④ 月心迸发：过半时甩笔 */
        if (phase !== 4) enter(4);
        var u = clamp((t - T3) / TIMING.wake, 0, 1);
        if (!burstPlayed && u > .46 && burstFx) { burstFx.play(); burstPlayed = true; }
      } else if (t < T5) {
        /* ⑤ 断线、绕涡心、落回版式 */
        if (phase !== 5) enter(5);
      } else if (t < T6) {
        /* ⑥ 世界爆发：夜空从月心漫开 */
        if (phase !== 6) enter(6);
      } else if (t < T7) {
        if (phase !== 7) enter(7);
      } else if (t < T8) {
        if (phase !== 8) enter(8);
      } else {
        finish();
        return;
      }
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    /* 兜底计时器：时间线按 T8/pace 走（对应真实毫秒 T8*pace），
       这里必须乘，不能除 —— 除的话放慢系数一上来就变成"提前收场"。 */
    guard = setTimeout(finish, T8 * pace + 1800);
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

  /* 但「已经停在星月夜」的进站必须补一次演出。
     主题存在 localStorage 里、且同一个 origin 全站共用，所以用户在主站
     切过一次星月夜之后，再打开任何子路径（含 /v2/、/v3/ 这种预览环境）
     首屏直接就是渲染完的油画，设置面板里的「星月夜」又正是当前项、
     点它是个死键 —— 结果就是"动画加载不了"。这里按会话补播一次，
     每个标签页、每个部署前缀只播一次，刷新不会重播。 */
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
    /* 只给验收脚本用：当前幕号 + 构造线的落点表（真实边线坐标） */
    phase: function () { return phase; },
    guideTargets: function () {
      return guide ? guide.segs.map(function (s) {
        return { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, kind: s.kind };
      }) : [];
    }
  };
})();
