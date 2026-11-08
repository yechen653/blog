/* ============================================================
   intro.js — 星月夜揭幕演出
   ------------------------------------------------------------
   叙事：空白画板 → 两条涡臂草图 → 油画显影 → 月心迸发
         → 夜空从月心漫开 → 个人主页显现

   各幕对应的实现：
     ① 空白画板   .intro-paper 淡入；页面元素先隐去
     ② 涡臂草图   sky-bone（两个主旋转点各一条 C 形弧）按 dashoffset
                  逐段画出，别的线一根都没有
     ③ 油画显影   底纹与各旋转点分层淡入，涡臂退回画里的暗底宽笔
     ④ 月心迸发   画里的月盘不动，只从盘沿甩出一圈暖色厚笔
     ⑤ 世界爆发   夜盘从月心向外铺开，各旋转点切快速公转
     ⑥ 主页显现   画板与夜盘淡出，页面元素带 Z 轴纵深错峰落位

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
    quiet: 260,      /* ① 空白画板 */
    sketch: 1500,    /* ② 涡臂草图 */
    fill: 900,       /* ③ 油画显影 */
    wake: 1100,      /* ④ 月心迸发 */
    flood: 1050,     /* ⑤ 世界爆发 */
    settle: 380,     /* 收束 */
    reveal: 1000     /* ⑥ 主页显现 */
  };
  function speed() { return SC.mobile ? .78 : 1; }

  var REVEAL_SELECTORS = [
    '.masthead-inner', '.brand', '.nav', '.kicker', '.hero-title', '.hero-meta',
    '.section-label', '.prose p', '.widget-list li', '.widget--box',
    '.section-note', '.link-card', '.widget--back', '.toolbar',
    '#list .card', '.pager', '.detail', '.footer-row', '.footer-word'
  ];

  var playing = false, raf = 0, guard = 0, stage = null, geo = null;
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
        delay: (i / Math.max(1, found.length) * .34).toFixed(3) + 's'
      };
    });
  }

  /* ── 幕切换：每幕只做一次写入 ───────────────────────────────── */
  function enter(n) {
    phase = n;
    var C = geo.comp;

    if (n === 1) {
      /* ① 画板已经在 play() 里淡入，这里只是让夜空静一拍 */
    } else if (n === 2) {
      /* ② 草图构建：只有两条涡臂在长 */
      geo.base.style.transition = '';
      geo.rings.forEach(function (g) { g.style.transition = ''; });
    } else if (n === 3) {
      /* ③ 油画显影：底纹铺上，涡臂从草图的实墨退回画里的暗底宽笔，
         各旋转点错峰跟上，月亮排在最后 —— "把月亮画完"正好成为下一幕的引信 */
      geo.base.style.transition = 'opacity .85s ease';
      geo.base.style.opacity = '1';
      geo.bones.forEach(function (b) {
        b.el.style.transition = 'opacity .9s ease';
        b.el.style.opacity = '';
      });
      geo.rings.forEach(function (g, i) {
        var isMoon = g.getAttribute('data-v') === 'M';
        var d = isMoon ? 560 : (i * 55);
        g.style.transition = 'opacity .52s ease ' + d + 'ms';
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
      /* ⑤ 世界爆发：旋转点提速，夜空从月心向外铺满 */
      root.classList.add('is-vortex');
      if (stage.flood) stage.flood.classList.add('is-open');
    } else if (n === 6) {
      /* 收束：画板与夜盘一起退场，画层直接落在页面自己的夜色上 */
      if (stage.paper) stage.paper.classList.add('is-fade');
      if (stage.flood) stage.flood.classList.add('is-fade');
      if (burstFx) burstFx.fade();
    } else if (n === 7) {
      /* ⑥ 主页显现 */
      pageEls.forEach(function (el) {
        el.style.transition = 'opacity .5s ease';
        el.style.opacity = '1';
        if ('inert' in el) el.inert = false;
      });
      revealNodes.forEach(function (r) {
        r.el.style.transition =
          'translate .85s cubic-bezier(.18,.7,.2,1) ' + r.delay + ', ' +
          'scale .85s cubic-bezier(.18,.7,.2,1) ' + r.delay + ', ' +
          'opacity .55s ease ' + r.delay;
        r.el.style.translate = '0px 0px 0px';
        r.el.style.scale = '1';
      });
    }
  }

  /* ── 还原：把演出期间写上去的内联样式全部收回 ───────────────── */
  function restorePage() {
    root.classList.remove('is-intro', 'is-vortex', 'is-lifted');

    if (geo) {
      geo.base.style.transition = '';
      geo.base.style.opacity = '';
      geo.rings.forEach(function (g) {
        g.style.transition = '';
        g.style.opacity = '';
      });
      geo.bones.forEach(function (b) {
        b.el.setAttribute('stroke-dashoffset', '0');
        b.el.style.transition = '';
        b.el.style.opacity = '';
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
    markSeen();
    document.dispatchEvent(new CustomEvent('site:intro', { detail: { playing: true } }));

    geo = SC.prepare();
    SC.setIntro(true);
    root.classList.add('is-intro', 'is-lifted');
    htmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    stage = buildStage();
    collectReveal();
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
    geo.bones.forEach(function (b) {
      b.el.style.transition = 'none';
      b.el.style.opacity = '.95';
      b.el.setAttribute('stroke-dashoffset', b.len.toFixed(0));
    });
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
    var T5 = T4 + TIMING.flood;
    var T6 = T5 + TIMING.settle;
    var T7 = T6 + TIMING.reveal;
    start = 0; phase = 0;

    function frame(now) {
      if (!start) start = now;
      var t = (now - start) / speed();

      if (t < T1) {
        /* ① 空白画板 */
        if (phase !== 1) enter(1);
      } else if (t < T2) {
        /* ② 草图构建：两条涡臂逐段画出来 */
        if (phase !== 2) enter(2);
        var p = clamp((t - T1) / TIMING.sketch, 0, 1);
        geo.bones.forEach(function (b) {
          var q = clamp((p - b.delay) / (1 - b.delay), 0, 1), e = ease(q);
          b.el.setAttribute('stroke-dashoffset', (b.len * (1 - e)).toFixed(0));
        });
      } else if (t < T3) {
        /* ③ 油画显影 */
        if (phase !== 3) enter(3);
      } else if (t < T4) {
        /* ④ 月心迸发：过半时甩笔 */
        if (phase !== 4) enter(4);
        var u = clamp((t - T3) / TIMING.wake, 0, 1);
        if (!burstPlayed && u > .46 && burstFx) { burstFx.play(); burstPlayed = true; }
      } else if (t < T5) {
        /* ⑤ 世界爆发：夜空从月心漫开 */
        if (phase !== 5) enter(5);
      } else if (t < T6) {
        if (phase !== 6) enter(6);
      } else if (t < T7) {
        if (phase !== 7) enter(7);
      } else {
        finish();
        return;
      }
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    guard = setTimeout(finish, T7 / speed() + 1800);
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
    stop: finish
  };
})();
