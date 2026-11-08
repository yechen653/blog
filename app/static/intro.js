/* ============================================================
   intro.js — 星月夜揭幕演出
   ------------------------------------------------------------
   与上一版的本质区别：演出【不是】一次性覆盖层，也不重画任何路径。

     · 所有 <path d> 由 starry-canvas.js 在 mount() 生成一次，
       本文件全程 setAttribute('d') 次数为 0。
     · 骨架流线（.sky-bone）既是演出画的线，也是静态画里的暗底宽笔：
       静态 dashoffset=0，演出开始退回未画状态再生长，结束回到 0。
       因此首屏静态与演出结束是同一批 DOM 节点，无搬树、无交接重建。
     · 旋转交给 CSS：多个旋转点各自挂 intro-orbit（差速 + 方向），
       骨架终态位姿用一次 transition 完成，元素归位用一次 CSS 动画。
       每帧 JS 只写 ② 阶段 ≤13 个属性，其余阶段 0 次写入。

   时间线（桌面约 4.95s，移动端 ×0.72）：
     ① 空白画布 ② 骨架生长 ③ 笔触浮现 ④ 多涡旋公转
     ⑤ 收笔 ⑥ 圆形换幕 ⑦ 元素归位
   ============================================================ */
(function () {
  'use strict';

  var SC = window.StarryCanvas;
  if (!SC) { console.error('[intro] 缺少 starry-canvas.js'); return; }

  var T = (window.SITE_CONFIG || {}).themes || {};
  var root = document.documentElement;
  var TIMING = { blank: 240, sketch: 1500, impasto: 700, vortex: 850,
                 settle: 150, night: 560, reveal: 950 };
  var SPEED = SC.mobile ? .72 : 1;

  var REVEAL_SELECTORS = [
    '.masthead-inner', '.brand', '.nav', '.kicker', '.hero-title', '.hero-meta',
    '.section-label', '.prose p', '.widget-list li', '.widget--box',
    '.section-note', '.link-card', '.widget--back', '.toolbar',
    '#list .card', '.pager', '.detail', '.footer-row', '.footer-word'
  ];

  var playing = false, raf = 0, guard = 0, stage = null, geo = null;
  var pageEls = [], revealNodes = [], disposers = [];
  var start = 0, phase = 0, finished = false, htmlOverflow = '';

  function reduce() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function on(target, type, fn) {
    target.addEventListener(type, fn);
    disposers.push(function () { target.removeEventListener(type, fn); });
  }
  function ease(u) { return 1 - Math.pow(1 - u, 2.2); }

  /* ── 舞台：画布 / 圆形换幕 / UI，四层各自独立 z-index ─────────
     常驻 .starry-canvas 在演出期间被 .is-lifted 提到画布之上，
     所以「画」始终是真实的那一张，不需要复制或搬树。 */
  function buildStage() {
    var W = geo.W, H = geo.H, C = geo.comp;
    var vcx = C.A.x, vcy = C.A.y;
    var maxR = Math.hypot(Math.max(vcx, W - vcx), Math.max(vcy, H - vcy)) * 1.12;

    var canvas = document.createElement('div');
    canvas.className = 'intro-canvas';

    var night = document.createElement('div');
    night.className = 'intro-night';
    var disc = document.createElement('div');
    disc.className = 'intro-disc';
    disc.style.width = disc.style.height = (maxR * 2).toFixed(0) + 'px';
    disc.style.left = (vcx - maxR).toFixed(0) + 'px';
    disc.style.top = (vcy - maxR).toFixed(0) + 'px';
    for (var i = 0; i < 22; i++) {
      var star = document.createElement('span');
      star.className = 'intro-star';
      star.style.left = (((i * 73 + 19) % 97) / 97 * 100).toFixed(1) + '%';
      star.style.top = (((i * 41 + 7) % 89) / 89 * 100).toFixed(1) + '%';
      var size = 2 + (i % 4);
      star.style.width = star.style.height = size + 'px';
      disc.appendChild(star);
    }
    night.appendChild(disc);

    var ui = document.createElement('div');
    ui.className = 'intro-ui';
    var brush = document.createElement('div');
    brush.className = 'intro-brush';
    brush.innerHTML =
      '<svg viewBox="0 0 76 76" aria-hidden="true">' +
        '<path d="M64 4 L36 42" stroke="#6b4a2a" stroke-width="8" stroke-linecap="round"/>' +
        '<path d="M36 42 L12 64 L20 70 L42 48 Z" fill="#2b1c10"/>' +
        '<path d="M12 64 L8 71" stroke="#1b4f8f" stroke-width="5" stroke-linecap="round"/>' +
      '</svg>';
    ui.appendChild(brush);
    var skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'intro-skip';
    skip.textContent = T.skip || '跳过演出';
    ui.appendChild(skip);

    document.body.appendChild(canvas);
    document.body.appendChild(night);
    document.body.appendChild(ui);
    return { canvas: canvas, night: night, disc: disc, ui: ui, brush: brush, skip: skip };
  }

  /* ── 页面隐藏 / 归位节点（一次性采集，不在帧里读布局） ─────── */
  function hidePage() {
    pageEls = Array.prototype.filter.call(document.body.children, function (el) {
      var t = el.tagName;
      return t !== 'SCRIPT' && t !== 'TEMPLATE' && t !== 'NOSCRIPT' &&
             el.className.indexOf && el.className.indexOf('intro-') !== 0 &&
             !el.classList.contains('starry-canvas');
    });
    pageEls.forEach(function (el) {
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
    /* 归位用独立的 translate / rotate / scale 属性 + transition。
       swiss.css 里 .card / .detail / .cmt 自带 rise 动画，其 transform
       与 opacity 优先级高于 inline；若覆盖会在收尾移除时重播一次。 */
    revealNodes = found.map(function (el, i) {
      var a = (i * 2.399) % (Math.PI * 2), amp = 14 + (i % 5) * 6;
      return {
        el: el,
        tx: (Math.cos(a) * amp).toFixed(1) + 'px',
        ty: (Math.sin(a) * amp).toFixed(1) + 'px',
        rot: (((i % 7) - 3) * 1.6).toFixed(1) + 'deg',
        delay: (i / Math.max(1, found.length) * .30).toFixed(3) + 's'
      };
    });
  }

  /* 笔尖位置：沿折线按弧长取点 */
  function pointAt(pts, p) {
    var total = 0, i;
    for (i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
    }
    var target = total * clamp(p, 0, 1), acc = 0;
    for (i = 1; i < pts.length; i++) {
      var a = pts[i-1], b = pts[i];
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

  /* ── 阶段边界：每阶段只做一次写入，帧内零 DOM 操作 ─────────── */
  function enter(n) {
    phase = n;
    if (n === 2) {
      stage.brush.style.opacity = '1';
      /* 在 ② 阶段一开头恢复 transition（不改 opacity 值），
         让 ③ 阶段改值时能真正触发 0.7s 淡入 */
      geo.base.style.transition = '';
      geo.rings.forEach(function (g) { g.style.transition = ''; });
    } else if (n === 3) {
      /* 笔触一次性淡入：CSS transition 接管，后续帧 0 写入 */
      stage.brush.style.opacity = '0';
      geo.base.style.opacity = '1';
      geo.rings.forEach(function (g) { g.style.opacity = '1'; });
    } else if (n === 4) {
      /* 多旋转点差速公转：切到一次性 intro-orbit 动画 */
      root.classList.add('is-vortex');
      /* 骨架各自旋转 + 平移，脱离原位、卷入天空构图 */
      geo.bones.forEach(function (b) {
        b.el.style.transition = 'transform .85s cubic-bezier(.2,.7,.2,1), opacity .5s ease';
        b.el.style.transform = b.terminal;
        b.el.style.opacity = '';
      });
    } else if (n === 6) {
      /* 圆形换幕：scale 由合成器驱动，不写 clip-path。
         同时预置归位 transition（与 ⑦ 改值之间隔 560ms，保证过渡触发） */
      stage.disc.classList.add('is-open');
      revealNodes.forEach(function (r) {
        var e = ' .7s cubic-bezier(.18,.7,.2,1) ' + r.delay;
        r.el.style.transition = 'translate' + e + ',rotate' + e + ',scale' + e;
      });
    } else if (n === 7) {
      /* 常驻层回到内容之下，三层舞台淡出，元素错峰归位 */
      root.classList.remove('is-lifted');
      stage.canvas.classList.add('is-fade');
      stage.night.classList.add('is-fade');
      pageEls.forEach(function (el) {
        el.style.opacity = '1';
        if ('inert' in el) el.inert = false;
      });
      revealNodes.forEach(function (r) {
        r.el.style.translate = '0px 0px';
        r.el.style.rotate = '0deg';
        r.el.style.scale = '1';
      });
    }
  }

  /* ── 收尾：拆成两帧，避免一帧内集中变更造成闪烁 ───────────── */
  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    clearTimeout(guard);

    /* 帧 1：恢复所有常驻状态 */
    root.classList.remove('is-intro', 'is-vortex', 'is-lifted');
    geo.base.style.opacity = '';
    geo.rings.forEach(function (g) { g.style.opacity = ''; });
    geo.bones.forEach(function (b) {
      b.el.setAttribute('stroke-dashoffset', '0');
      b.el.style.transition = '';
      b.el.style.transform = b.terminal;
      b.el.style.opacity = '';
    });
    revealNodes.forEach(function (r) {
      r.el.style.transition = '';
      r.el.style.translate = '';
      r.el.style.rotate = '';
      r.el.style.scale = '';
    });
    pageEls.forEach(function (el) {
      el.style.opacity = ''; el.style.transition = '';
      if ('inert' in el) el.inert = false;
    });
    document.documentElement.style.overflow = htmlOverflow;

    requestAnimationFrame(function () {
      /* 帧 2：移除舞台、解绑、放行下一次重播 */
      ['canvas', 'night', 'ui'].forEach(function (k) {
        if (stage[k] && stage[k].parentNode) stage[k].parentNode.removeChild(stage[k]);
      });
      disposers.forEach(function (fn) { fn(); });
      disposers = [];
      stage = null; geo = null; pageEls = []; revealNodes = [];
      playing = false;
      SC.setIntro(false);
      document.dispatchEvent(new CustomEvent('site:intro', { detail: { playing: false } }));
    });
  }

  /* ── 主流程 ───────────────────────────────────────────────── */
  function play() {
    if (playing) return;
    playing = true;
    document.dispatchEvent(new CustomEvent('site:intro', { detail: { playing: true } }));

    geo = SC.prepare();
    SC.setIntro(true);
    root.classList.add('is-intro', 'is-lifted');
    htmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    stage = buildStage();
    collectReveal();
    hidePage();

    /* 把同一批常驻节点退回「未画」状态 —— 不新建任何 path。
       先禁掉 transition，否则 opacity 会用 0.7s 慢慢淡出而不是瞬隐。 */
    geo.base.style.transition = 'none';
    geo.base.style.opacity = '0';
    geo.rings.forEach(function (g) { g.style.transition = 'none'; g.style.opacity = '0'; });
    geo.bones.forEach(function (b) {
      b.el.style.transition = 'none';
      b.el.style.transform = 'none';
      b.el.style.opacity = '.95';
      b.el.setAttribute('stroke-dashoffset', b.len.toFixed(0));
    });
    revealNodes.forEach(function (r) {
      r.el.style.transition = 'none';
      r.el.style.translate = r.tx + ' ' + r.ty;
      r.el.style.rotate = r.rot;
      r.el.style.scale = '.93';
    });

    on(stage.skip, 'click', finish);
    on(stage.canvas, 'click', finish);
    on(document, 'keydown', function (ev) { if (ev.key === 'Escape') finish(); });

    var T1 = TIMING.blank;
    var T2 = T1 + TIMING.sketch;
    var T3 = T2 + TIMING.impasto;
    var T4 = T3 + TIMING.vortex;
    var T5 = T4 + TIMING.settle;
    var T6 = T5 + TIMING.night;
    var T7 = T6 + TIMING.reveal;
    start = 0; phase = 0; finished = false;

    function frame(now) {
      if (!start) start = now;
      var t = (now - start) / SPEED;
      if (t < T1) {
        /* ① 空白画布：什么都不写 */
      } else if (t < T2) {
        if (phase !== 2) enter(2);
        var p = clamp((t - T1) / TIMING.sketch, 0, 1), active = null;
        geo.bones.forEach(function (b) {
          var q = clamp((p - b.delay) / (1 - b.delay), 0, 1), e = ease(q);
          b.el.setAttribute('stroke-dashoffset', (b.len * (1 - e)).toFixed(0));
          if (e > .02 && e < .98) active = { pts: b.pts, p: e };
        });
        if (active) {
          var pt = pointAt(active.pts, active.p);
          stage.brush.style.transform =
            'translate(' + (pt.x - 12).toFixed(0) + 'px,' + (pt.y - 66).toFixed(0) + 'px) ' +
            'rotate(' + (pt.a * 180 / Math.PI - 40).toFixed(1) + 'deg)';
        }
      } else if (t < T3) { if (phase !== 3) enter(3); }
      else if (t < T4)   { if (phase !== 4) enter(4); }
      else if (t < T5)   { if (phase !== 5) enter(5); }
      else if (t < T6)   { if (phase !== 6) enter(6); }
      else if (t < T7)   { if (phase !== 7) enter(7); }
      else { finish(); return; }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    /* 后台标签会暂停 rAF：到点强制收尾，且照样定格出完整画面 */
    guard = setTimeout(finish, T7 / SPEED + 1600);
  }

  /* 首次进站不播（首屏已有静态画）；切回 Swiss 不播。 */
  document.addEventListener('site:themechange', function (ev) {
    var d = ev.detail || {};
    if (d.to !== 'starry' || d.play === false || reduce() || playing) return;
    play();
  });

  window.SiteIntro = { isPlaying: function () { return playing; } };
})();
