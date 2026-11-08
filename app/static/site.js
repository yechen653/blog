/* ============================================================
   site.js —— 把 site-config.js 的数据填进 HTML 骨架
   ------------------------------------------------------------
   一张页面只负责"长什么样"，这里只负责"把内容放进去"。
   全程用 textContent / createElement / setAttribute，不用 innerHTML：
   配置是可信的，但保持不拼 HTML 字符串，以后接后台接口也不会带进 XSS。

   约定的 4 类标记（都写在 HTML 上，改风格时照抄即可）：
     data-bind="a.b"                  → 元素文本
     data-bind-attr="attr:a.b"        → 元素属性（如 data-word）
     data-rich="a.b"                  → 若干段落，段内可含内联链接
     data-repeat="a.b" data-template="tpl-x"
                                      → 克隆 <template> 生成列表，
                                        模板内用 data-field / data-field-href 取字段，
                                        额外自动提供 no = 两位序号
   ============================================================ */
(function () {
  'use strict';

  var C = window.SITE_CONFIG;
  if (!C) {
    console.error('[site] 未找到 SITE_CONFIG：请确认 /static/site-config.js 已加载');
    return;
  }

  var page = document.body.dataset.page || '';

  // 按点号路径取值；任一级缺失就返回 undefined，页面留空而不是抛错
  function get(path) {
    return String(path).split('.').reduce(function (o, k) {
      return o == null ? o : o[k];
    }, C);
  }

  // 1) 纯文本绑定
  Array.prototype.forEach.call(document.querySelectorAll('[data-bind]'), function (el) {
    var v = get(el.dataset.bind);
    if (v != null) el.textContent = v;
  });

  // 2) 属性绑定，形如 "data-word:footerWord.profile"
  Array.prototype.forEach.call(document.querySelectorAll('[data-bind-attr]'), function (el) {
    var parts = el.dataset.bindAttr.split(':');
    if (parts.length !== 2) return;
    var v = get(parts[1]);
    if (v != null) el.setAttribute(parts[0], v);
  });

  // 3) 富文本段落：数组元素 = 一段；段内字符串 = 文本，{text,href} = 内联链接
  Array.prototype.forEach.call(document.querySelectorAll('[data-rich]'), function (host) {
    var paras = get(host.dataset.rich) || [];
    var frag = document.createDocumentFragment();
    paras.forEach(function (parts) {
      var p = document.createElement('p');
      (Array.isArray(parts) ? parts : [parts]).forEach(function (part) {
        if (typeof part === 'string') {
          p.appendChild(document.createTextNode(part));
          return;
        }
        var a = document.createElement('a');
        a.href = part.href;
        a.textContent = part.text;
        if (part.external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        p.appendChild(a);
      });
      frag.appendChild(p);
    });
    host.replaceChildren(frag);
  });

  // 4) 列表：克隆 <template>，结构仍归 HTML 管（改风格不用动这里）
  Array.prototype.forEach.call(document.querySelectorAll('[data-repeat]'), function (host) {
    var tpl = document.getElementById(host.dataset.template);
    if (!tpl || !tpl.content.firstElementChild) return;
    var rows = get(host.dataset.repeat) || [];
    var frag = document.createDocumentFragment();

    rows.forEach(function (row, i) {
      var node = tpl.content.firstElementChild.cloneNode(true);
      var data = Object.assign({ no: String(i + 1).padStart(2, '0') }, row);

      // 根节点本身也可能带标记，所以连同后代一起遍历
      var targets = [node].concat(
        Array.prototype.slice.call(node.querySelectorAll('[data-field],[data-field-href]'))
      );
      targets.forEach(function (el) {
        if (el.dataset.field) {
          var text = data[el.dataset.field];
          if (text != null) el.textContent = text;
        }
        if (el.dataset.fieldHref) {
          var href = data[el.dataset.fieldHref];
          if (href != null) el.setAttribute('href', href);
        }
      });
      frag.appendChild(node);
    });
    host.replaceChildren(frag);
  });

  // 5) 页面标题 / 页脚巨型底字 / 版权年份
  var titleTpl = C.titles && C.titles[page];
  if (titleTpl) document.title = titleTpl.replace('{name}', C.displayName);

  var word = document.querySelector('.footer-word');
  if (word && C.footerWord && C.footerWord[page]) word.dataset.word = C.footerWord[page];

  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
