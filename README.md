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
- **前端**：无框架、无构建、无 npm。两张 HTML 骨架 + `site-config.js`（展示内容唯一数据源）+ `site.js`（数据绑定）+ `theme.js` / `intro.js`（主题与演出）+ `swiss.css` / `starry.css`（两套视觉）。默认 Swiss Editorial（白 / 黑 / 信号红，非对称网格、硬边框），右上角设置键可切到**星月夜**主题（深蓝夜空 / 暖白字 / 星月黄），选择记在 `localStorage`。主动切到星月夜会播一次「空白画布 → 毛笔勾版式草图 → 厚涂笔触 → 涡心旋转 → 圆形换幕 → 界面凝出」的揭幕动画，可跳过，并尊重 `prefers-reduced-motion`。**展示内容与视图分离**：姓名、简介、技术栈、站外链接、导航、标题、主题面板文案全在 `site-config.js`，由 `site.js` 填进 HTML 骨架
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
    swiss.css          【改风格改这里】共享网格 + 语义色板（颜色全是变量）
    starry.css         星月夜变量覆盖 + 旋涡底纹 + 设置键 / 演出层样式
    theme.js           设置键、主题切换、localStorage 持久化
    intro.js           揭幕演出：SVG 草图 / 短笔触 / 涡心公转 / 圆形换幕
migrations/        Alembic 迁移
tests/             测试（需 MySQL）
others/notes/      学习笔记
```

调整展示内容（改名字、改简介、增删站外链接、改栏目名、加主题）只动 `site-config.js`；
调整版式结构动 HTML 骨架与 `swiss.css`，换配色动 `swiss.css` 的 `:root` 语义变量
或 `starry.css` 的 `[data-theme="starry"]` 覆盖，两边不用互相搬运。
加第三套主题：在 `site-config.js` 的 `themes.items` 加一项，再写一份覆盖语义变量的 CSS 即可。

内容由 `site.js` 在浏览器端渲染，因此页面需要启用 JavaScript；
主题选择由 `<head>` 内联脚本在首帧前应用，避免刷新时先闪一下默认主题。
主题是持久状态，揭幕演出是一次性事件，演出失败或被跳过不影响主题正确性。

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