/* ============================================================
   intro.js — 星月夜揭幕演出（五幕）
   ------------------------------------------------------------
   叙事：主页结构 → 绘画草图 → 油画细节 → 月亮苏醒 → 星空能量爆发
         → 完整星月夜 → 个人主页显现

   五幕对应的实现：
     ① 空白画布   .intro-paper 铺纸，画笔入场
     ② 草图构建   原生骨架流线（sky-bone）逐条生长，画笔跟着笔尖
     ③ 细节填充   底纹与各旋转点分层淡入；月亮排在最后画完
     ④ 月亮苏醒   SVG 月环淡出 → Canvas 球面月接替，脱画、放大、
                  浮起、加速自转；蓝/黄/白笔触从月心迸发
     ⑤ 世界爆发   一块遮罩画布从月心开出圆洞并逐帧扩大，油画从月心
                  向外蔓延；各旋转点同时切快速公转
     ⑥ 主页显现   纸与遮罩淡出，页面元素带 Z 轴纵深错峰落位

   性能约束沿用上一版：所有 <path d> 只生成一次，演出期间
   setAttribute('d') = 0；每帧最多写 1 次 canvas 填充（第 ⑤ 幕）。
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
    paper: 240,      /* ① 空白画布 */
    sketch: 1700,    /* ② 草图构建 */
    fill: 900,       /* ③ 细节填充 */
    wake: 1350,      /* ④ 月亮苏醒 */
    flood: 1050,     /* ⑤ 世界爆发 */
    settle: 380,     /* 收束 */
    reveal: 1050     /* ⑥ 主页显现 */
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
  var moon = null, burstFx = null, moonRings = [];
  var maxR = 0, moonR = 0;
  var start = 0, phase = 0, finished = false, htmlOverflow = '';
  var burstPlayed = false, moonBackTimer = 0;

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

  /* ── 舞台：纸 / 遮罩画布 / UI（月亮与迸发层按需插入） ─────────── */
  function buildStage() {
    var W = geo.W, H = geo.H, C = geo.comp, M = C.M;

    var paper = document.createElement('div');
    paper.className = 'intro-paper';

    maxR = Math.hypot(Math.max(M.x, W - M.x), Math.max(M.y, H - M.y)) * 1.12;
    /* 3D 月球退场时会缩回原位、由静止层的月盘接替。两者的半径必须对得上，
       否则交接处会看到一次"月亮突然长大/缩小"。静止层月盘的外沿在 .60 左右。 */
    moonR = M.r * .60;

    /* 夜盘：铺满整个屏幕的夜空白，初始缩到月心一点，第 ⑤ 幕放大。
       它压在画层【下面】，所以笔触不会被遮住。 */
    var flood = document.createElement('div');
    flood.className = 'intro-flood';
    flood.style.width = flood.style.height = (maxR * 2).toFixed(0) + 'px';
    flood.style.left = (M.x - maxR).toFixed(0) + 'px';
    flood.style.top = (M.y - maxR).toFixed(0) + 'px';

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

    /* 调色盘：第一幕与画笔一起入场，第二幕收起 */
    var palette = document.createElement('div');
    palette.className = 'intro-palette';
    palette.innerHTML =
      '<svg viewBox="0 0 132 104" aria-hidden="true">' +
        '<path d="M34 8C12 12 2 36 8 58c6 26 38 40 66 36 24-3 38-17 33-30-4-11-21-10-27-17-6-7 0-19-13-27C58 12 46 6 34 8z" ' +
          'fill="#8a5a33" opacity=".9"/>' +
        '<ellipse cx="36" cy="30" rx="11" ry="8.5" fill="#f7d45c"/>' +
        '<ellipse cx="62" cy="22" rx="9" ry="7" fill="#3576c8"/>' +
        '<ellipse cx="86" cy="34" rx="8.5" ry="6.5" fill="#fff3cf"/>' +
        '<ellipse cx="38" cy="54" rx="9.5" ry="7" fill="#ffb347"/>' +
        '<ellipse cx="66" cy="63" rx="10" ry="7.5" fill="#9ed6c0"/>' +
        '<ellipse cx="90" cy="56" rx="7.5" ry="6" fill="#1d4a91"/>' +
        '<ellipse cx="52" cy="80" rx="6" ry="4.6" fill="#efe9dc" opacity=".85"/>' +
      '</svg>';
    ui.appendChild(palette);

    var skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'intro-skip';
    skip.textContent = T.skip || '跳过演出';
    ui.appendChild(skip);

    document.body.appendChild(paper);
    document.body.appendChild(flood);
    document.body.appendChild(ui);

    return { paper: paper, flood: flood, ui: ui, brush: brush,
             palette: palette, skip: skip };
  }

  function hidePage() {
    pageEls = Array.prototype.filter.call(document.body.children, function (el) {
      var t = el.tagName;
      return t !== 'SCRIPT' && t !== 'TEMPLATE' && t !== 'NOSCRIPT' &&
             el.className.indexOf && el.className.indexOf('intro-') !== 0 &&
             !el.classList.contains('starry-canvas') &&
             !el.classList.contains('moon3d');
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

  function pointAt(pts, p) {
    var total = 0, i;
    for (i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    var target = total * clamp(p, 0, 1), acc = 0;
    for (i = 1; i < pts.length; i++) {
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

  /* ── 幕切换：每幕只做一次写入 ───────────────────────────────── */
  function enter(n) {
    phase = n;
    var C = geo.comp;

    if (n === 2) {
      stage.brush.style.opacity = '1';
      stage.palette.classList.add('is-in');
      geo.base.style.transition = '';
      geo.rings.forEach(function (g) { g.style.transition = ''; });
      /* 画笔从右下入场，落到第一条骨架的起笔点 */
      stage.brush.style.transition = 'opacity .18s ease, transform .7s cubic-bezier(.2,.7,.2,1)';
      if (geo.bones[0]) {
        var p = geo.bones[0].pts[0];
        stage.brush.style.transform =
          'translate(' + (p.x - 12).toFixed(0) + 'px,' + (p.y - 66).toFixed(0) + 'px) ' +
          'rotate(-38deg)';
      }
    } else if (n === 3) {
      /* ③ 细节填充：底纹先起，各旋转点错峰跟上，月亮排在最后 —— 
         "把月亮画完"正好成为下一幕的引信 */
      stage.brush.style.opacity = '0';
      stage.palette.classList.remove('is-in');
      geo.base.style.transition = 'opacity .85s ease';
      geo.base.style.opacity = '1';
      geo.rings.forEach(function (g, i) {
        var isMoon = g.getAttribute('data-v') === 'M';
        var d = isMoon ? 560 : (i * 55);
        g.style.transition = 'opacity .52s ease ' + d + 'ms';
        g.style.opacity = '1';
      });
    } else if (n === 4) {
      /* ④ 月亮苏醒：SVG 月环淡出，球面月在同一坐标接替 */
      moonRings.forEach(function (g) {
        g.style.transition = 'opacity .3s ease';
        g.style.opacity = '0';
      });
      if (S3) {
        moon = S3.makeMoon({ x: C.M.x, y: C.M.y, r: moonR, seed: 9137 });
        moon.wake();
        moon.spin(.30);
        burstFx = S3.burst({
          x: C.M.x, y: C.M.y, r: moonR,
          W: geo.W, H: geo.H, count: SC.mobile ? 18 : 28
        });
      }
    } else if (n === 5) {
      /* ⑤ 世界爆发：旋转点提速，夜盘从月心向外铺满 */
      root.classList.add('is-vortex');
      stage.flood.classList.add('is-open');
      if (moon) moon.spin(.92);
    } else if (n === 6) {
      /* 收束：遮罩与纸一起退场，球面月回落成画里的月环 */
      stage.paper.classList.add('is-fade');
      stage.flood.classList.add('is-fade');
      if (burstFx) burstFx.fade();
      if (moon) {
        moon.retract();
        moonBackTimer = setTimeout(function () {
          if (finished) return;
          moonRings.forEach(function (g) {
            g.style.transition = 'opacity .5s ease';
            g.style.opacity = '';
          });
        }, 220);
      }
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

  /* ── 收尾：两帧完成，避免集中变更造成闪烁 ───────────────────── */
  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    clearTimeout(guard);
    clearTimeout(moonBackTimer);

    root.classList.remove('is-intro', 'is-vortex', 'is-lifted');

    geo.base.style.transition = '';
    geo.base.style.opacity = '';
    geo.rings.forEach(function (g) {
      g.style.transition = '';
      g.style.opacity = '';
    });
    moonRings.forEach(function (g) { g.style.opacity = ''; });
    geo.bones.forEach(function (b) {
      b.el.setAttribute('stroke-dashoffset', '0');
      b.el.style.transition = '';
      b.el.style.transform = b.terminal;
      b.el.style.opacity = '';
    });

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

    if (moon) { moon.destroy(); moon = null; }
    if (burstFx) { burstFx.destroy(); burstFx = null; }

    requestAnimationFrame(function () {
      ['paper', 'flood', 'ui'].forEach(function (k) {
        if (stage[k] && stage[k].parentNode) stage[k].parentNode.removeChild(stage[k]);
      });
      disposers.forEach(function (fn) { fn(); });
      disposers = [];
      stage = null; geo = null; pageEls = []; revealNodes = [];
      playing = false;
      SC.setIntro(false);
      if (S3 && S3.sync) S3.sync();
      document.dispatchEvent(new CustomEvent('site:intro', { detail: { playing: false } }));
    });
  }

  /* ── 主流程 ─────────────────────────────────────────────────── */
  function play() {
    if (playing) return;
    playing = true;
    markSeen();
    document.dispatchEvent(new CustomEvent('site:intro', { detail: { playing: true } }));

    geo = SC.prepare();
    moonRings = geo.rings.filter(function (g) { return g.getAttribute('data-v') === 'M'; });
    SC.setIntro(true);
    root.classList.add('is-intro', 'is-lifted');
    htmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    stage = buildStage();
    collectReveal();
    hidePage();

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
      r.el.style.translate = r.tx + ' ' + r.ty + ' -90px';
      r.el.style.scale = '.96';
    });

    on(stage.skip, 'click', finish);
    on(stage.flood, 'click', finish);
    on(document, 'keydown', function (ev) { if (ev.key === 'Escape') finish(); });

    var T1 = TIMING.paper;
    var T2 = T1 + TIMING.sketch;
    var T3 = T2 + TIMING.fill;
    var T4 = T3 + TIMING.wake;
    var T5 = T4 + TIMING.flood;
    var T6 = T5 + TIMING.settle;
    var T7 = T6 + TIMING.reveal;
    start = 0; phase = 0; finished = false; burstPlayed = false;

    function frame(now) {
      if (!start) start = now;
      var t = (now - start) / speed();

      if (t < T1) {
        /* ① 空白画布 */
      } else if (t < T2) {
        /* ② 草图构建 */
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
      } else if (t < T3) {
        /* ③ 细节填充 */
        if (phase !== 3) enter(3);
      } else if (t < T4) {
        /* ④ 月亮苏醒：自转加速，过半时笔触迸发 */
        if (phase !== 4) enter(4);
        var u = clamp((t - T3) / TIMING.wake, 0, 1);
        if (moon) moon.spin(.30 + .62 * u);
        if (!burstPlayed && u > .52 && burstFx) { burstFx.play(); burstPlayed = true; }
      } else if (t < T5) {
        /* ⑤ 世界爆发：圆洞从月心扩大 */
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

  /* 首次进站不播（首屏已有静态画）；切回 Swiss 不播。 */
  document.addEventListener('site:themechange', function (ev) {
    var d = ev.detail || {};
    if (d.to !== 'starry' || d.play === false || reduce() || playing) return;
    play();
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

  window.SiteIntro = { isPlaying: function () { return playing; }, play: play };
})();
