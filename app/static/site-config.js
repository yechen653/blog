/* ============================================================
   site-config.js —— 全站【展示内容】的唯一数据源
   ------------------------------------------------------------
   这里只放"展示什么"，不放"长什么样"：
     · 展示内容 / 文案 / 链接  → 改本文件
     · 结构骨架                → 改 profile.html / index.html
     · 视觉风格                → 改 swiss.css
   三者互不牵连，后续反复调整展示风格时不需要搬运内容。

   本文件是纯数据，没有任何逻辑；由 <head> 中的普通 <script> 同步加载，
   所以后面的页面脚本可以安全地直接读 window.SITE_CONFIG，没有加载竞态。
   渲染逻辑统一在 /static/site.js（通过 data-bind / data-rich / data-repeat
   把数据填进 HTML 骨架），不在这里写 DOM 操作。

   注：功能性 UI 文案（登录、搜索、按钮、报错提示等）属于交互逻辑，
   仍留在各自视图里，不纳入本配置。
   ============================================================ */
window.SITE_CONFIG = {

  /* 公开展示名：全站唯一一处。改名字只改这一行。
     {name} 占位符由 site.js 替换，避免同一名字在配置里重复多份。 */
  displayName: "叶晨",

  /* 页面标题模板 */
  titles: {
    profile: "{name} · 个人介绍",
    blog: "博客 · {name}"
  },

  /* 两页共用的导航与页脚巨型底字 */
  nav: {
    profileLabel: "个人介绍",
    blogLabel: "博客"
  },
  footerWord: {
    profile: "PROFILE",
    blog: "ARCHIVE"
  },

  /* 主题设置面板的展示文案。
     以后加第三套主题：这里加一项 + 写一份覆盖语义变量的 CSS 即可，
     HTML 骨架和 theme.js / intro.js 都不用动。 */
  themes: {
    panelTitle: "界面风格",
    hint: "选择会被记住，下次访问直接生效",
    current: "使用中",
    replay: "重播开场",
    skip: "跳过演出",
    items: [
      { id: "swiss",  name: "瑞士编辑主义", note: "白 / 黑 / 信号红" },
      { id: "starry", name: "星月夜",       note: "夜空 / 旋涡笔触" }
    ]
  },

  /* ── 个人介绍页 ───────────────────────────────────────────── */
  profile: {
    kicker: "№ 01 — 个人介绍",
    heroSub: "后端 · AI",
    heroMeta: "学生，后端方向，Base 北京。写 Java 与 Python，也在做 LLM 应用和 Agent 工程化；习惯把学到的东西落成笔记和能跑起来的项目。",

    labels: {
      about: "关于我",
      stack: "技术栈 / 在用的东西",
      links: "在别处 / 代码主页",
      colophon: "关于本站"
    },

    /* 每个元素是"一段"；段内字符串是文本节点，{text, href} 是内联链接。
       这样正文既能配置化，又不必在配置里塞 HTML 字符串。 */
    about: [
      ["日常主力是 Java 后端，同时在补数据库、Spring 这些基本功；Python 主要用在脚本和 LLM 应用上。比起读完一篇教程，更相信把东西亲手跑一遍、再写下来。"],
      ["这个站点是我自己从接口写到部署的一个小后端：FastAPI + MySQL + Redis。这里是个人介绍，另一边是",
       { text: "博客", href: "/static/" },
       "，放学习笔记、开发记录和踩过的坑。"]
    ],

    stack: [
      { name: "Java",        note: "后端主语言" },
      { name: "Python",      note: "脚本 · LLM" },
      { name: "Spring Boot", note: "后端框架" },
      { name: "MySQL",       note: "数据库" },
      { name: "FastAPI",     note: "本站后端" },
      { name: "Docker",      note: "部署" }
    ],

    linksNote: "站外主页，点击将在新标签页打开。",
    links: [
      { name: "GitHub",   role: "代码托管", handle: "github.com/yechen653",  url: "https://github.com/yechen653" },
      { name: "Gitee",    role: "代码托管", handle: "gitee.com/yechen653",   url: "https://gitee.com/yechen653" },
      { name: "LeetCode", role: "刷题主页", handle: "leetcode.cn/u/xie-tk9", url: "https://leetcode.cn/u/xie-tk9/" }
    ],

    siteNote: "两张手写页面、一个自己写的后端，跑在自己的服务器上。内容以学习笔记和开发记录为主，会慢慢更新。",
    cta: { text: "→ 去博客看看", href: "/static/" }
  },

  /* ── 博客页 ───────────────────────────────────────────────── */
  blog: {
    kicker: "№ 02 — 博客 / 文章索引",
    heroTitle: ["文章", "笔记"],
    heroMeta: "这里放学习笔记和开发记录：后端、数据库，以及做项目时踩过的坑。点开任意一条读全文。",
    sectionLabel: "文章索引"
  }
};
