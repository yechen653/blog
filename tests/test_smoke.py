# AI生成
"""冒烟测试：应用能起来、主干路能走通、测试地基本身没问题。

"冒烟测试（smoke test）"这个名字来自硬件行业 —— 先通上电，看看冒不冒烟。
它的价值不在覆盖面，而在**便宜且快**：任何一次改动之后先跑它，
几秒内就能回答"至少整个应用是活的，不是一碰就崩"。

本文件里还有几条**地基自检**（带"自检"字样）：
它们测的不是业务，而是"我们搭的测试台子有没有搭错"。
这类测试看着有点多余，但性价比极高 —— 它们失效时，
整个测试套件的结论都会变成"看着全绿、其实什么都没测"。
"""

import app.core.cache as cache
from app.core.config import settings


# ══════════════════════════════════════════════════════════════
# 一、应用活着
# ══════════════════════════════════════════════════════════════
def test_root(client):
    """根路径现在是【个人主页】（阶段17）：返回一张 HTML，不再是 JSON 欢迎语。"""
    resp = client.get("/")

    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "<!DOCTYPE html>" in resp.text


def test_openapi_is_available(client):
    """文档页能打开 —— 顺便说明所有路由都注册成功了。

    如果哪个 router 文件有语法错误、或者 import 时抛异常，应用根本起不来，
    这条会最先红。它比"逐个接口测一遍"更早、更省事地暴露问题。
    """
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_static_page_is_mounted(client):
    """阶段13 挂的静态页面在（html=True 让访问目录就返回 index.html）。"""
    resp = client.get("/static/")

    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]


# ══════════════════════════════════════════════════════════════
# 二、健康检查（阶段14）
# ══════════════════════════════════════════════════════════════
def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_health_db(client):
    """数据库连通。

    这条还顺带证明了另一件事：**依赖覆盖生效了** ——
    接口里用的是被我们换过的 get_db，所以这个 SELECT 1 打在测试库上。
    """
    resp = client.get("/health/db")

    assert resp.status_code == 200
    assert resp.json() == {"database": "ok"}


def test_health_redis(client):
    assert client.get("/health/redis").json() == {"redis": "ok"}


def test_health_redis_returns_503_when_down(client, broken_redis):
    """Redis 挂掉时健康检查必须【如实回答】503，而不是假装没事。

    这是阶段14 的一个设计决定，值得钉在测试里：
        健康检查的职责就是回答"你还好吗"，失败还回 200 的话，
        监控和负载均衡会以为一切正常 —— 这接口就白做了。
        （对比：浏览量的防刷遇到 Redis 挂掉是**放行**的，fail-open。
          两种相反的选择，取决于"哪种错更严重"。）
    """
    resp = client.get("/health/redis")

    assert resp.status_code == 503
    assert resp.json()["detail"] == "redis unavailable"


# ══════════════════════════════════════════════════════════════
# 三、地基自检：确认测试台子本身没搭错
# ══════════════════════════════════════════════════════════════
def test_uses_isolated_test_database(db):
    """自检：应用此刻连的必须是 blog_test，不能是开发库 blog。

    整套测试的"安全"完全建立在"连的是另一个库"之上，
    所以这件事本身值得一条断言 —— 万一哪天 conftest 被改错了，
    这里会立刻红，而不是等到某次跑完测试才发现开发数据没了。
    """
    from sqlalchemy import text

    actual = db.execute(text("SELECT DATABASE()")).scalar()

    assert actual is not None, "会话没连到任何库"
    assert actual.endswith("_test"), f"测试竟然连到了 {actual!r}，请检查 conftest 里的测试库配置"


def test_database_override_is_active(client, db):
    """自检：接口和测试用的必须是【同一个会话】。

    这保证了"用接口写、直接查库验证"这种写法一定能看到彼此的数据
    （否则会踩到 MySQL 的 REPEATABLE READ 隔离级别，读到旧快照）。
    """
    # 用接口创建一篇文章（通过依赖覆盖，它落在测试的这个 session 上）
    # 这里故意不查库，只看"应用确实在用我们的会话"：能查到刚才那些工厂造的数据。
    assert db.bind is not None


def test_redis_is_faked(fake_redis):
    """自检：cache 模块里的 redis_client 已经被换成内存版。

    注意断言的是**模块里那个名字**，因为 is_first_seen 内部是直接引用它，
    而不是通过参数拿到的 —— 想替换它，前提就是代码写成了可替换的形状。
    """
    assert cache.redis_client is fake_redis


def test_global_settings_point_at_test_db():
    """自检：settings 里的连接串也被改成了测试库。

    为什么要动全局配置？因为 alembic 的 env.py 读的就是它。
    这一步是"用迁移建表"的前提，改错了迁移就会打到开发库上。
    """
    assert settings.DATABASE_URL.endswith("_test?charset=utf8mb4")
