"""健康检查：验证服务活着、数据库连接、Redis 连接（阶段14）。

═══════════════════════════════════════════════════════════════
本阶段把"探测数据库 / Redis"下沉到了 crud（数据库）+ core（Redis），
本文件的定位变纯粹了：

    本文件（接线层）：路径、调用探测函数、根据返回值翻译成 200 / 503
    app/crud/health.py（数据层）：check_database（SELECT 1）
    app/core/cache.py（基础设施层）：ping_redis（redis.ping）

判据：凡是出现 Depends / HTTPException / APIRouter 的行，都留在本文件。
SELECT / PING 这种"读依赖"动作都不在本文件出现。
═══════════════════════════════════════════════════════════════
"""

import logging

import redis
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.cache import ping_redis
from app.core.database import get_db
from app.crud import health as health_crud

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])

# /docs 里给这个接口标出"可能返回 503"（写法同 posts.py 的 NOT_FOUND）
UNAVAILABLE = {503: {"description": "Redis 不可用"}}


@router.get("/health", summary="服务健康检查")
async def health():
    # 不碰数据库，所以可以用 async def
    return {"status": "ok"}


@router.get("/health/db", summary="数据库连通性检查")
def health_db(db: Session = Depends(get_db)):
    """对数据库做 SELECT 1 → 翻译成 200 + {"database": "ok"} / {"database": "unknown"}。

    注意这里是 def 而不是 async def：
    SQLAlchemy 同步会话是"阻塞"操作，写成 def，FastAPI 会丢到线程池执行，不阻塞事件循环。

    分层后这个函数体内【没有一行 text("SELECT 1")】——所有 SQL 都在 crud/health.py 里。
    """
    if health_crud.check_database(db):
        return {"database": "ok"}
    return {"database": "unknown"}


@router.get("/health/redis", summary="Redis 连通性检查", responses=UNAVAILABLE)
def health_redis():
    """对 Redis 发 PING → 翻译成 200 或 503。

    为什么失败要回 503（而不是像防刷那样 fail-open 放行）？
        · 防刷在【请求链路上】：Redis 挂了也不该让用户看不了文章 → fail-open；
        · 健康检查是【专门来问"你还好吗"的】：职责就是如实回答。
          如果失败也回 200 + {"redis": "degraded"}，监控 / 负载均衡会以为一切正常 ——
          等于把"我不健康"藏起来，这接口就白做了。
        所以健康检查失败必须用【状态码】说话（503 = 服务暂时不可用），
        因为监控和网关只看状态码，不看 body。

    用 def 而不是 async def：redis-py 的同步客户端是阻塞调用，
        写成 def 会被丢进线程池，不卡事件循环（同 health_db）。
    """
    try:
        ping_redis()
    except redis.RedisError as exc:
        # 详细原因写日志；对外只说"不可用"，别把内部错误细节暴露出去
        logger.warning("Redis 健康检查失败：%s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="redis unavailable",
        )
    return {"redis": "ok"}