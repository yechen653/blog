# AI生成
"""应用入口：创建 FastAPI 实例 + 组装路由 + 中间件。

启动命令（在 blog-api/ 目录下执行）：
    uvicorn app.main:app --reload

它做的事很少，但顺序有讲究：
    1. 创建 app；
    2. 按需装中间件（CORS）——【中间件要在路由之前装】，才能包住后续所有请求；
    3. 把各 router 挂上去（health / posts / comments / uploads / auth）；
    4. 根路径 / 交给【个人主页】（HTML）；
    5. 最后挂静态目录（前缀 /static），它是"兜底"式的，前缀不冲突就互不影响。
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.routers import auth, comments, health, posts, uploads

# 静态资源目录：个人主页 profile.html + 博客页 index.html 都在这里
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title=settings.PROJECT_NAME)

# ── 中间件：CORS（阶段17）──────────────────────────────────────
# 前端和接口【同源】时（页面由本服务在 /static/ 下提供）根本用不到 CORS；
# 只有当页面被部署在【另一个域名/端口】（例如独立的 Vite 前端）时才需要放行。
# 所以这里默认关闭，由 .env 的 CORS_ORIGINS 按需开启（逗号分隔）。
#
# 为什么不写成 allow_origins=["*"]？—— 那等于对任何网站开放；而且一旦同时
# allow_credentials=True，浏览器会【直接拒绝】带凭证的通配来源，落得两头不讨好。
# 来源必须显式列出来，才既安全又可用。
_cors_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# 组装路由：每个 router 自带 prefix / tags，这里只管挂上去
app.include_router(health.router)
app.include_router(posts.router)
# 阶段15：评论。这个 router 没设 prefix（它有两组路径：/posts/{id}/comments 和 /comments/{id}），
# 所以直接挂到根上。挂载顺序无所谓——路径不冲突。
app.include_router(comments.router)
app.include_router(uploads.router)
app.include_router(auth.router)


# ── 根路径：个人主页（阶段17）─────────────────────────────────
# 把 / 让给一张静态 HTML，是"个人站点"最自然的入口：
# 访客先看到"你是谁/在做什么"，想读文章再点进博客页。
# 接口都挂在各自路径下（/posts、/auth、/uploads…），/docs 是自动生成的 API 文档。
# include_in_schema=False：它返回的是 HTML、不是接口，不必出现在 OpenAPI 里。
@app.get("/", include_in_schema=False)
async def home():
    return FileResponse(STATIC_DIR / "profile.html")


# ── 阶段13：给项目配一个"能点的界面" ───────────────────────────────────
# 把纯静态文件挂到 URL 前缀 /static 上，由 FastAPI 自己当文件服务器。
# 不需要 node、不需要打包、不需要另起一个前端进程 —— 而且【同源】：
#     页面 http://127.0.0.1:8000/static/   ·   接口 http://127.0.0.1:8000/posts
#   协议/域名/端口三者全一样，浏览器认为同源，于是【完全不需要 CORS】。
#
# html=True：访问目录时自动返回 index.html，所以浏览 /static/ 等于浏览 /static/index.html。
#
# 注意 mount 要放在【路由注册之后】——它是"兜底"式的，前缀不冲突就互不影响。
app.mount("/static", StaticFiles(directory=STATIC_DIR, html=True), name="static")