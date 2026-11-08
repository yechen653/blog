/* ============================================================
   theme.js — 主题设置键、切换与持久化
   ------------------------------------------------------------
   主题是【持久状态】，揭幕演出是【一次性事件】，两者必须解耦：
     · 本文件只负责 data-theme、localStorage、设置面板
     · 演出由 intro.js 监听 site:themechange 自行决定播不播
   所以演出失败、被跳过、或用户关了动效，主题依然正确。

   首帧防白闪不在这里：head 里有一段内联同步脚本，在样式生效前
   就写好 data-theme。外部脚本加载完才设属性的话，会先闪一下白底。
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'blog.theme';
  var VALID = ['swiss', 'starry'];
  var C = window.SITE_CONFIG || {};
  var T = C.themes || {};
  var ITEMS = T.items || [];
  var root = document.documentElement;
  var host = document.querySelector('.masthead-inner');
  if (!host) return;

  var current = root.dataset.theme || 'swiss';
  if (VALID.indexOf(current) < 0) current = 'swiss';

  function reduceMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function text(tag, cls, value) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    el.textContent = value == null ? '' : String(value);
    return el;
  }

  /* ── 构建设置键与面板 ───────────────────────────────────────
     静态 SVG 图标用 innerHTML（不含任何配置数据）；所有展示文案
     一律 textContent，和 site.js 保持同一条规则：不拼 HTML 字符串。 */
  var wrap = document.createElement('div');
  wrap.className = 'theme-switcher';
  wrap.innerHTML =
    '<button class="theme-btn" type="button" aria-haspopup="dialog" ' +
    'aria-expanded="false" aria-controls="theme-panel">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="9"/>' +
        '<path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" opacity=".5"/>' +
        '<path d="M7.5 8.5h4M7.5 12h6M7.5 15.5h4"/>' +
      '</svg>' +
    '</button>' +
    '<div class="theme-panel" id="theme-panel" role="dialog" hidden></div>';
  host.appendChild(wrap);

  var btn = wrap.querySelector('.theme-btn');
  var panel = wrap.querySelector('.theme-panel');
  btn.setAttribute('aria-label', T.panelTitle || '界面风格');
  panel.setAttribute('aria-label', T.panelTitle || '界面风格');
  panel.appendChild(text('p', 'theme-panel-title', T.panelTitle || '界面风格'));

  var optionEls = [];
  ITEMS.forEach(function (item) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-option';
    b.dataset.theme = item.id;

    var sw = document.createElement('span');
    sw.className = 'theme-swatch theme-swatch--' + item.id;
    sw.setAttribute('aria-hidden', 'true');
    b.appendChild(sw);

    var label = document.createElement('span');
    label.appendChild(text('span', '', item.name));
    if (item.note) {
      var note = text('span', '', item.note);
      note.style.display = 'block';
      note.style.fontSize = '.66rem';
      note.style.fontWeight = '400';
      note.style.opacity = '.7';
      note.style.marginTop = '2px';
      label.appendChild(note);
    }
    b.appendChild(label);

    var mark = text('span', 'theme-current', '');
    b.appendChild(mark);
    panel.appendChild(b);

    b.addEventListener('click', function () { setTheme(item.id, true); });
    optionEls.push({ el: b, mark: mark, id: item.id });
  });

  var foot = document.createElement('div');
  foot.className = 'theme-panel-foot';
  foot.appendChild(text('p', 'theme-hint', T.hint || ''));
  var replay = text('button', 'theme-replay', T.replay || '重播');
  replay.type = 'button';
  foot.appendChild(replay);
  panel.appendChild(foot);

  /* 重播：已经停在星月夜时，再点一次「星月夜」就是这个动作。
     单独抽出来是因为设置面板里的选项与底部按钮都走同一条路，
     否则选项在"当前项"状态下就是个死键。
     演出进行中也允许点 —— intro.js 会等这一轮拆台完成后再从第一幕重来，
     这样按钮不会变成"灰了八秒钟"的死键。 */
  function replayIntro() {
    if (current !== 'starry' || reduceMotion()) return false;
    closePanel();
    document.dispatchEvent(new CustomEvent('site:themechange', {
      detail: { from: 'starry', to: 'starry', replay: true, play: true }
    }));
    return true;
  }

  replay.addEventListener('click', replayIntro);

  /* ── 面板开关 ─────────────────────────────────────────────── */
  function openPanel() {
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }
  function closePanel() {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }
  btn.addEventListener('click', function () {
    if (panel.hidden) openPanel(); else closePanel();
  });
  document.addEventListener('click', function (ev) {
    if (!panel.hidden && !wrap.contains(ev.target)) closePanel();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !panel.hidden) { closePanel(); btn.focus(); }
  });

  /* ── 状态渲染 ─────────────────────────────────────────────── */
  function introPlaying() {
    return !!(window.SiteIntro && window.SiteIntro.isPlaying());
  }
  function render() {
    optionEls.forEach(function (o) {
      var on = o.id === current;
      o.el.setAttribute('aria-pressed', on ? 'true' : 'false');
      o.mark.textContent = on ? (T.current || '使用中') : '';
    });
    /* 设置键与「重新开场」在演出期间都不锁：演出是在全屏台上跑的，
       锁住只会让用户以为功能坏了。重复点由 intro.js 排队重来。 */
    replay.disabled = current !== 'starry';
    if (introPlaying() && !panel.hidden) closePanel();
  }
  render();

  /* ── 切换 ─────────────────────────────────────────────────── */
  function setTheme(next, play) {
    if (VALID.indexOf(next) < 0) return;
    /* 点的是当前主题：不要变成死键。星月夜当作"再看一次演出"，
       Swiss 没有演出，只是收起面板。 */
    if (next === current) {
      if (next === 'starry' && play !== false) replayIntro();
      else closePanel();
      return;
    }
    /* 演出进行中切走：先让演出收尾还原页面，再换主题 ——
       否则画层被直接摘掉，演出还在往已经不在文档里的节点上写字。 */
    if (introPlaying() && window.SiteIntro && window.SiteIntro.stop) {
      window.SiteIntro.stop();
    }
    var prev = current;
    current = next;
    root.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch (e) { /* 隐私模式：本次会话仍生效 */ }
    closePanel();
    render();
    document.dispatchEvent(new CustomEvent('site:themechange', {
      detail: { from: prev, to: next, play: play !== false }
    }));
  }

  /* 切回 Swiss 不做揭幕：编辑主义的即时感靠一个短淡入就够 */
  document.addEventListener('site:themechange', function (ev) {
    if (ev.detail.to === 'swiss' && !reduceMotion() && document.body.animate) {
      document.body.animate([{ opacity: .55 }, { opacity: 1 }],
        { duration: 260, easing: 'ease-out' });
    }
  });

  /* intro.js 播放期间锁住设置键；结束后恢复 */
  document.addEventListener('site:intro', render);

  window.SiteTheme = {
    get: function () { return current; },
    set: setTheme,
    isPlaying: introPlaying
  };
})();
