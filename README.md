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
- **前端**：无框架、无构建、无 npm，两张 HTML + 一份共享 CSS（`swiss.css`）+ 原生 JS（`app/static/`）；视觉为瑞士国际主义排版（白 / 黑 / 一点红，非对称网格、硬边框、无圆角无渐变）
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
  static/          前端：profile.html（个人主页）/ index.html（博客页）/ swiss.css（共享视觉系统）
migrations/        Alembic 迁移
tests/             测试（需 MySQL）
others/notes/      学习笔记
```

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