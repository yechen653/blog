# blog-api — 个人主页 + 博客

一个用 FastAPI 写的个人站点：根路径是**个人简介页**，`/static/` 是**博客页**
（文章 / 评论 / 图片上传），所有接口自带 `/docs` 交互式文档。
目标是部署到自己的服务器上，长期用来写日志。

> 这个项目同时是一份**学习记录**：从零搭到一个可用的小后端，
> 每一步的设计取舍都写在代码注释里。配套的深度学习笔记在 [`others/notes/`](others/notes/)。

## 功能

- **文章**：增删改查、草稿 / 发布、按标题搜索、分页、浏览量（Redis 防刷，同一 IP 窗口内只计一次）
- **评论**：两层回复、父评论删除时级联删除
- **用户**：注册 / 登录（JWT）、密码 bcrypt 哈希、越权防护
- **上传**：图片；类型**双校验**（`content_type` 粗筛 + 文件头魔数）、大小限制、路径穿越防护
- **安全（阶段17）**：登录 / 注册**限流**、CORS 按需开启
- **前端**：无框架、无构建、无 npm。两张 HTML 骨架 + `site-config.js`（展示内容唯一数据源）+ `site.js`（数据绑定）+ `swiss.css` / `starry.css`（两套视觉 + 字段级语义色板）+ `theme.js`（切换与持久化）+ `starry-canvas.js`（常驻油画层）+ `starry-3d.js`（三维月亮与视差）+ `intro.js`（揭幕演出）。默认 Swiss Editorial（白 / 黑 / 信号红，非对称网格、硬边框），右上角设置键可切到**星月夜**主题，选择记在 `localStorage`。星月夜按《星月夜》原画构图用代码生成：**4 个主旋转点 + 11 颗星**、沿流场切线铺排的短促厚涂笔触、每段独立的墨色 / 粗细档 / 占比 / 同色成簇 / 留白 / 叠笔、断续同心月晕与星晕；本期不画丝柏树。**首屏就有一张静态油画**，演出只是「把这张画画出来的过程」：`starry-canvas`
构建期把每一笔记录成逐笔清单，揭幕时每笔作为独立颜料单元从自己的来源（构造线 /
月沿 / 种子）沿轨迹飞到落点，长成整幅画后与真画交接。主动切换 / 点「重新开场」时播六幕「**纯白画板** → **彩色构造线**（先横后竖、两个种子圆、橙色实心月圆收笔，一条画到 80% 才起下一条，线出生即带归宿的墨色）→ **月心点火**（种子开始旋转）→ **引擎流水线**（月盘/涡环旋转中完善自身，构造线段公转升档甩落，其余颜料从月沿按生长波甩出，11 颗星切线抛出逐圈点火）→ **收束**（画板退场）→ 元素带 Z 轴纵深错峰归位、粒子层与真画同位交接」，演出期间**点击屏幕任意位置**即跳过（`.intro-catch` 全屏接收层），
也可按 Esc 或右下角按钮；尊重 `prefers-reduced-motion`。**演出期间 `setAttribute('d')` 为 0**，每帧 0 次 DOM 写入、0 次像素写入，全部交给 CSS 合成器。静止层与旋转层拆成两个独立 SVG，密集底纹只栅格化一次。文章详情 / 编辑器为 `data-view="reading"` 静态态（同时摘掉 `is-3d`，避免阅读时被视差推着走），其余页面保留极慢的涡旋漂移与指针视差用于展示。**三维化用 CSS 3D 而不是 Three.js**：不引入构建链、不依赖 CDN，也不必为了 `perspective` 给 `body` 加 `transform`（那会让 `position:fixed` 的油画层失去定位基准）。**展示内容与视图分离**：姓名、简介、技术栈、站外链接、导航、标题、主题面板文案全在 `site-config.js`，由 `site.js` 填进 HTML 骨架
- **健康检查**：`/health`、`/health/db`、`/health/redis`

## 快速开始（本机）

```bash
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt

cp .env.example .env                 # 按需改 DATABASE_URL / SECRET_KEY / REDIS_URL

alembic upgrade head                 # 建表
uvicorn app.main:app --reload
```

打开：

- 个人主页 <http://127.0.0.1:8000/>
- 博客页   <http://127.0.0.1:8000/static/>
- API 文档 <http://127.0.0.1:8000/docs>

需要 **MySQL** 与 **Redis**（起库命令见 `.env.example` 里的注释）。

## 用 Docker 一把起

```bash
docker compose up --build -d
docker compose exec app alembic upgrade head     # 首次建表
```

## 跑测试

```bash
pytest
```

测试会**另建** `blog_test` 库（绝不碰开发库），并需要一个能连的 MySQL；
Redis 用内存假替身，不需要真服务。

## 目录结构

```
app/
  main.py          应用入口：装中间件、挂路由、根路径 → 个人主页
  core/            基础设施：config / database / security / cache / ratelimit / deps
  routers/         接线层：路径与参数、HTTP 状态码翻译
  services/        业务规则层
  crud/            数据访问层（数据库 / Redis / 磁盘）
  models/ schemas/ ORM 模型 / Pydantic 契约
  static/
    profile.html       个人主页：结构骨架（不含展示文案）
    index.html         博客页：结构骨架 + 交互逻辑
    site-config.js     【改内容改这里】全站展示数据唯一来源
    site.js            把配置按 data-bind / data-rich / data-repeat 填进骨架
    swiss.css          【改风格改这里】共享网格 + 两层语义色板
                       （基础色板 --bg/--fg/--accent + 字段级 --field-*）
    starry.css         星月夜覆盖【角色分配】+ 常驻油画层 / 设置键 / 演出层样式
    theme.js           设置键、主题切换、localStorage 持久化
    starry-canvas.js   【主题的一部分】COMPOSITION 单一构图源（多旋转点）
                       + 流场采样 + 段级墨色/粗细/占比配方 + 短笔触分桶
                       + 一次性生成静态油画层（静止 / 旋转两个独立 SVG）
    starry-3d.js       笔触迸发（SVG + CSS dashoffset）、指针视差
                       （只写 --px / --py 两个变量）
    intro.js           揭幕演出（颜料引擎）：用 starry-canvas 的逐笔清单把
                       每笔颜料当独立单元排轨迹；d 只在构建期写，运动全靠
                       CSS transform / opacity 合成器
migrations/        Alembic 迁移
tests/             测试（需 MySQL）
others/notes/      学习笔记
```

调整展示内容（改名字、改简介、增删站外链接、改栏目名、加主题）只动 `site-config.js`；
调整版式结构动 HTML 骨架与 `swiss.css`；换基础配色动 `swiss.css` 的 `:root`
或 `starry.css` 的 `[data-theme="starry"]` 覆盖；**只改某类字段的颜色**
（编号 / 日期 / 职能说明 / 标签 / 草稿）改 `--field-*` 这一层，不必动到规则本身。
字段级 token 的默认值逐一等于改绑前的取值，所以改星月夜不会让 Swiss 走样。
加第三套主题：在 `site-config.js` 的 `themes.items` 加一项，再写一份覆盖
基础色板 + 字段级 token 的 CSS 即可。

内容由 `site.js` 在浏览器端渲染，因此页面需要启用 JavaScript；
主题选择由 `<head>` 内联脚本在首帧前应用，避免刷新时先闪一下默认主题。
主题是持久状态，揭幕演出是一次性事件，演出失败或被跳过不影响主题正确性。
`starry-canvas.js` 在 `intro.js` 之前加载。所有 `<path d>` 只在首屏生成一次，
演出期间 `setAttribute('d')` 为 0；**首屏静态与演出结束是同一批 DOM 节点**，
不需要搬树或交接重建。静止层（密集底纹、山丘、村庄、星群）与旋转层（主涡 /
副涡 / 月亮 / 亮星）拆成两个独立 SVG：前者只栅格化一次，后者各 `<g>` 按
`--orbit` 差速自转。
构图坐标统一从 `COMPOSITION` 派生，并写入 `--moon-x / --vortex-x` 等 CSS 变量，
CSS 光晕与 SVG 月亮不会各写各的百分比。`intro.js` 只负责编排时间线。

揭幕演出是"颜料引擎"叙事，六幕：**纯白画板 → 彩色构造线 → 月心点火 →
引擎流水线 → 收束 → 主页显现**。演出期的画不靠整层淡入 —— `.starry-canvas`
在构建期把每一笔记录进 `DABS` 逐笔清单（坐标 / 流向角 / 长度 / 墨 / 档 /
路径串 / 区域标签），`intro.js` 用这份清单把画**当成几百个独立颜料单元重新
演一遍**：每个单元带着真画的形状、墨色与档位，从自己的来源飞到落点，落定
后与真画逐像素同源，第⑥幕交叉淡替时看不出接缝。

**这些单元不是 DOM 元素，全部画在一张 `<canvas class="intro-paint">` 上**，
由 `tick(t)` 按时间逐帧重画。这是被实测逼出来的结论（不要改回每个单元一个
SVG 元素 + CSS transform，会复发下面三类问题）：

- SVG 子元素的 `transform` / `d` 一变，整层都要重光栅化，同层其它笔触的抗锯齿
  跟着跳 —— 观感是"整片在闪"；
- 几百个 `will-change` 图层会被合成器驱逐，元素"迟到才画出来" —— 观感是
  "凭空出现、完全没有移动动画"；
- 描边路径带 `scale` 时每帧重算几何，亚像素位置一变 AA 就跳 —— 观感是抖动。

实现要点：落定的单元**烘焙进离屏 canvas**（`bake`），每帧只重画"还在飞"的
那几十个 + 一次整层贴图（幕④ 因此从 47fps 回到 60fps，落定区域也完全静止）；
**夜色也在同一张 canvas 里逐帧画径向渐变**（半径 = 生长波波前）—— 曾经用一个
320px 位图靠 `transform` 放大十几倍，渐变色带会随缩放漂移，整块背景"在爬"；
**背板按 `devicePixelRatio` 建**（上限 2）—— Windows 常见 125%/150% 缩放，若背板
只有 CSS 尺寸，每一帧都会被上采样一次，移动的笔触就被双线性重采样成"闪"；
画板层的纸纹也从 1px/4px 的 `repeating-linear-gradient` 换成一次性光栅的噪点
（细网格在合成层重采样时会起摩尔纹）；
几何用 `new Path2D(真画路径串)`；缓动用 `cubic-bezier` 求解，和原来 CSS 曲线
等价。第②幕的起笔线、两个种子圆、橙色月种子仍然走 SVG（静态，画完不再动），
构造线起飞瞬间隐身、交给 canvas 同几何接手。

分幕细节（第②③幕画出三个"种子"，第④幕它们旋转中完善自身）：

- **② 彩色构造线**：先横 → 竖 → 两个种子圆（主涡 / 副涡）→ **橙色实心月圆
  收笔**；一条画到 80% 才开始下一条。每条线出生就带它归宿格子的主墨色 ——
  线就是颜料，只是还没去到位置。
- **③ 月心点火**：橙色种子开始旋转（盘面上两道纹理弧让转动可见）。
- **④ 引擎流水线**（世界从这一幕就开始爆发，没有独立爆发幕）：
  - **月心**：盘面按象限、光晕按半径带，绕月心旋入 —— 橙圆长成完整月盘；
  - **两个旋转点**：涡环按（圈层×扇区）绕自己的种子旋入 —— 圆越转越"纺"出涡环；
  - **A 路构造线段**：绕最近涡心公转 ≥195°、升档成颜料（线宽过渡到墨档），
    甩落到分配的流场格子；格子里的颜料在线落地时原地显影（同位同色交叉淡替）；
  - **B 路生长波**：其余格子颜料出生点压在月沿（距月心 = 月半径 ±4%），
    按离月距离由近及远螺旋甩向落点；夜色衬底（`.intro-flood`）同步从月心漫开；
  - **11 颗星**：逐颗从月沿切线抛出、涡心偏转、挂位，核先亮、晕环逐圈点火。
- **⑤ 收束**：画板退场，夜色 + 长成的画留在台上。
- **⑥ 主页显现**：粒子层与真画交叉淡替（第⑥幕唯一一次整层过渡，两侧内容
  逐像素同源），页面元素带 Z 轴纵深错峰落位。

两个必须守住的细节：粒子层与旧构造线层一样，要**用实测像素钉死盒子再设
`viewBox`**（手机地址栏收放会让整层被 `xMidYMid meet` 等比缩放）；格子系统
按（墨×档）分桶时**每格只保 KEEP 个桶、其余并入宽度最近的桶** —— 否则单元
数爆炸（桌面 7×5 格 × 全桶会冲到 600+，实配约 300 个单元、移动约 145）。

三点容易踩的约束，改之前先看一眼：

- **月亮位置不按视口比例给**。月心纵坐标按「月盘半径 + 报头高度」反算，
  保证盘沿落在导航分隔线以下 —— 否则 1280×720 这类矮屏上白色导航字会压到黄笔上，
  对比度掉到 2:1 以下。
- **不要给 `body` 加 `transform` 或 `perspective`**。油画层是 `position:fixed`，
  祖先一旦有 `transform`，`fixed` 就退化成相对该祖先定位，整张画会跟着滚。
  三维感只加在内容容器（`.masthead / .hero / .layout / .site-footer`）上。
- **画板只在演出期存在**。`.intro-paper`（z 9990）与 `.intro-flood`（z 9991）
  都压在画层（9992）**下面**：画层自己没有底色，页面夜色透上来，所以第 ① 幕
  看到的是奶油画板，第 ⑤ 幕夜空从月心漫上来把画板换掉 —— 笔触全程在上面，
  不会被任何遮罩盖住。别把它们的 z 提到画层以上，否则整场演出都会糊掉。
- **不要试图用 Canvas 画"3D 月亮"**。逐像素球面采样 + 等距柱状贴图做过一版，
  放大看就是一颗塑料黄球，和手绘笔触不是同一种东西；月亮回到 SVG 厚涂
  （`.62` 半径铺满 + 三道断续光晕），演出里月亮由种子旋转中长成。
- **设置面板的点击会被 `.hero` 抢走**。`is-3d` 给 `.masthead` 加了 `perspective`，
  它因此成为层叠上下文：面板里 `z-index` 再高也出不了这一层，而 `.hero` 是它的
  兄弟、又自带 `perspective` 且排在后面，于是画在面板上面。面板背景色不透明时
  看着正常，实际点击全落在 `.hero` 上，还会触发"点外部关面板" —— 症状就是
  「重新开场点了没反应」。所以有 `:root.is-3d .masthead{z-index:60}`；
  手机上再靠 `right:0`（不能用 `left:auto`）让面板向左展开，否则整块跑到屏幕外。

## 分层约定

一句话判据：

- 出现 `Depends / Query / Path / Body / Request / HTTPException / APIRouter` 的行 → 留在 `routers/`
- 业务规则（查重、大小限制、防刷 / 限流判定）→ `services/` 或 `core/`
- 只跟**存储**打交道（SQL / Redis / 磁盘）→ `crud/`

## 部署要点

1. **改密钥**：`.env` 里的 `SECRET_KEY` 重新生成
   —— `python -c "import secrets;print(secrets.token_hex(32))"`。
2. **数据库**：生产换成独立 / 托管的 MySQL，把 `DATABASE_URL` 指过去。
3. **Redis**：浏览量防刷与登录限流都依赖它；它挂了会降级放行（fail-open），
   但生产仍建议配好，别让它长期缺席。
4. **HTTPS + 反向代理**：前面挂 Nginx（示例见下），并让 Nginx **覆盖** `X-Forwarded-For` 后再转发。
5. **CORS**：页面与接口同源时不需要；用独立前端时才在 `.env` 配 `CORS_ORIGINS`。
6. **上传目录**：`UPLOAD_DIR` 指向持久卷，别放在容器临时层。
7. **多进程**：`uvicorn --workers N`，或换 gunicorn + uvicorn worker。

### Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name your-site.com;

    client_max_body_size 5m;      # 至少要大于上传上限（本项目 2MB）

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # 关键：用 Nginx【覆盖】这个头，否则客户端能伪造它绕过限流 / 灌水计数
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## License

个人项目，随意参考。