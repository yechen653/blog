"""应用入口：创建 app + 组装路由。启动命令（在 blog-api 目录下）：uvicorn app.main:app --reload"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.routers import auth, comments, health, posts, uploads

app = FastAPI(title=settings.PROJECT_NAME)

# 组装路由
app.include_router(health.router)
app.include_router(posts.router)
# 阶段15：评论。这个 router 没设 prefix（它有两组路径：/posts/{id}/comments 和 /comments/{id}），
# 所以直接挂到根上。挂载顺序无所谓——路径不冲突。
app.include_router(comments.router)
app.include_router(uploads.router)
app.include_router(auth.router)   # 阶段7：注册（阶段8 会往这里加登录）


@app.get("/", summary="根路径")
async def root():
    return {"message": f"Welcome to {settings.PROJECT_NAME}"}


# ── 阶段13：给项目配一个"能点的界面" ───────────────────────────────────
# 做法：把纯静态文件（app/static/index.html）挂到 URL 前缀 /static 上，
# 由 FastAPI 自己当文件服务器。不需要 node、不需要打包、不需要另起一个前端进程。
#
# 为什么这样最省事 —— 【同源】：
#     页面地址是 http://127.0.0.1:8000/static/
#     接口地址是 http://127.0.0.1:8000/posts
#   协议、域名、端口三者全一样，浏览器就认为它们同源，于是【完全不需要 CORS】。
#   反过来，如果前端跑在 http://localhost:5173（Vite 默认），那就是跨域，
#   得额外配 CORSMiddleware 才发得出去请求 —— 那是另一节课的内容。
#
# html=True：访问目录时自动返回 index.html。
#   所以浏览 /static/ 就等于浏览 /static/index.html（不用手打文件名）。
#
# 注意 mount 要放在【路由注册之后】——它是"兜底"式的，前缀不冲突就互不影响。
STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR, html=True), name="static")
