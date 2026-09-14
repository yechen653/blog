"""pytest 的公共地基（conftest.py）。

【conftest.py 是什么？】
    pytest 的一条约定：放在这个文件里的 fixture，同目录及子目录下的测试文件
    **不用 import 就能直接用** —— 只要在函数参数里写上它的名字。
    名字和位置都是约定好的（pytest 自己会来找这个文件），所以它最常用来放
    "所有测试都要用的东西"。

【本文件干四件事】
    1. 把测试连到**另一个数据库**（blog_test），绝不碰开发库 blog；
    2. 用真实的迁移链把测试库的表建出来（顺便验证迁移本身没坏）；
    3. 每个测试开始前清空数据，保证测试之间互不影响；
    4. 提供几个"数据工厂"fixture，让测试只写它关心的那几个字段。

【一句话记住 pytest 的 fixture】
    它就是**测试版的依赖注入** —— 和 FastAPI 的 Depends 是同一个思路：
        def test_xxx(client, alice, auth):   ← 函数签名里点名要什么
    框架负责把这些东西准备好、按正确顺序塞进来。
    参数名 = fixture 名，不用写 Depends(...)，因为这层"框架魔法"由 pytest 承担。
"""

import os
from pathlib import Path

import pytest
import redis
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import app.core.cache as cache
from app.core.config import settings
from app.core.database import Base, get_db
from app.core.security import hash_password
from app.main import app
from app.models import Comment, Post, User
from app.routers import health as health_module

ROOT = Path(__file__).resolve().parent.parent      # blog-api/
PASSWORD = "secret123"                             # 测试账号统一用这个密码


# ══════════════════════════════════════════════════════════════
# 一、测试库
# ══════════════════════════════════════════════════════════════
# 【为什么非要另开一个库？】
#     测试会反复"造数据、删数据"，一跑就清一遍。要是连的是开发库 blog，
#     你手写的那些文章和评论会在某次 pytest 之后集体消失。
#     测试的第一条纪律：**不许碰真实数据。**
#
# 【测试库的地址从哪来？】
#     不另写一份配置，而是从项目已有的 DATABASE_URL **只换库名**得到：
#         .../blog  →  .../blog_test
#     于是主机、端口、账号、密码全都不用重复写一遍 ——
#     换环境时 .env 改一处，测试库跟着走，不会漏改。
DEV_URL = make_url(settings.DATABASE_URL)
TEST_DB_NAME = os.environ.get("TEST_DB_NAME", f"{DEV_URL.database}_test")
TEST_DB_URL = DEV_URL.set(database=TEST_DB_NAME)

# 【安全带】下面要执行 DROP DATABASE，所以必须确认库名"长得像测试库"。
#     万一哪天有人把库名配成 "blog"，这一行就是唯一能拦住"删掉开发库"的东西。
#     ——测试代码同样需要安全阀，而且往往更需要：它跑得比谁都勤。
if not TEST_DB_NAME.endswith("_test"):
    raise RuntimeError(
        f"测试库名必须以 _test 结尾（当前是 {TEST_DB_NAME!r}），拒绝执行以防误删真实数据"
    )

# ⚠️ 一个容易踩的坑：str(SQLAlchemy 的 URL 对象) 会把密码渲染成 `***`。
#    拼连接串、写进配置时一定要显式 render_as_string(hide_password=False)，
#    否则会拿到一个"密码是三个星号"的地址，然后连不上库却看不出原因。
TEST_DB_URL_STR = TEST_DB_URL.render_as_string(hide_password=False)


def _truncate_all(engine) -> None:
    """清空模型里声明的每一张表，并让自增 id 归零。

    SET FOREIGN_KEY_CHECKS = 0 是必须的：
        TRUNCATE 一张"正被别人外键引用"的表时，MySQL 会直接拒绝执行
        （它怕你把父子关系搞断）。这里先临时把检查关掉，清完再打开 ——
        典型的"我知道我在干什么，请别拦我"。
    """
    with engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS = 0"))
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(text(f"TRUNCATE TABLE `{table.name}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS = 1"))


# ══════════════════════════════════════════════════════════════
# 二、会话级：建库 + 跑迁移（整个测试过程只做一次）
# ══════════════════════════════════════════════════════════════
@pytest.fixture(scope="session")
def test_engine():
    """重建测试库、跑完迁移，返回一个连到它的 Engine。

    **scope="session" 是本文件的第一个关键点。**
        pytest 的 fixture 默认是 function 级 —— 每个测试函数都重新准备一次。
        可"删库 + 建库 + 跑四个迁移"要一秒多，几百个测试就是几百秒。
        标上 session 之后，整个过程只在开头做一次，后面的测试直接复用。
        （对应地：下面那些造数据的 fixture 必须是 function 级，
          否则上一个测试造的数据会漏给下一个测试。）

    **为什么用 alembic 建表，而不是 Base.metadata.create_all()？**
        create_all() 做的事情是"把模型翻译成建表语句"，它只能反映**模型当前的样子**，
        完全看不到迁移写错了什么 —— 比如忘了写 ondelete="CASCADE"。
        而线上库是**迁移建出来的**，两者一旦不一致，测试全绿、线上一片红。
        所以这里走真实的迁移链：测的就是线上那条路，顺便还验证了迁移本身没坏。
        （配套的 tests/test_migrations.py 会再确认"模型和迁移完全一致"。）
    """
    # 1) 连到"不指定库"的地址，把测试库删掉重建 —— 每次都是全新起点，
    #    不会残留上一次跑失败的脏数据。
    admin_engine = create_engine(DEV_URL.set(database=None), poolclass=NullPool)
    with admin_engine.begin() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS `{TEST_DB_NAME}`"))
        conn.execute(
            text(
                f"CREATE DATABASE `{TEST_DB_NAME}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        )
    admin_engine.dispose()

    # 2) 【关键一跳】让 alembic 也连测试库。
    #    migrations/env.py 里读的是 settings.DATABASE_URL，我们在这一步把它指过去；
    #    不指的话，命令跑下去会把迁移执行到**开发库**上。
    #    这是我们唯一"改动运行时配置"的地方，所以写得显眼一点。
    settings.DATABASE_URL = TEST_DB_URL_STR

    # 3) 跑迁移建表。
    #    env.py 顶层那句 fileConfig() 会重设 logging，可能盖掉 pytest 的日志配置——
    #    不影响结果，只是测试期间的日志可能安静一些。
    alembic_cfg = Config(str(ROOT / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(ROOT / "migrations"))
    command.upgrade(alembic_cfg, "head")

    # 4) 迁移建完，application 侧用这个 Engine 开会话
    engine = create_engine(TEST_DB_URL, pool_pre_ping=True)
    yield engine
    engine.dispose()


@pytest.fixture
def db(test_engine):
    """每个测试一个干净的数据库 + 一个会话。

    【清空数据的三种思路，这里选了第三种】
        1. 每个测试重建一次库/表 —— 最彻底，但最慢（只在 session 级做了一次）
        2. 用事务包住每个测试再回滚 —— 最快，但要求"应用和测试共用同一个连接"，
           本项目没这么设计，硬上会踩"commit 到底提交到哪儿去了"的坑
        3. TRUNCATE 清数据 —— 这次选的：空表 TRUNCATE 是毫秒级，
           而且语义直白（"把表清空"），不需要先理解事务嵌套

    清空之后再给会话，测试结束时关掉；下一个测试开头又会清一遍，
    所以任何测试都不用操心"上一个测试留下了什么"。
    """
    _truncate_all(test_engine)
    testing_session = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)
    session = testing_session()
    try:
        yield session
    finally:
        session.close()


# ══════════════════════════════════════════════════════════════
# 三、HTTP 客户端（本阶段最值钱的一段）
# ══════════════════════════════════════════════════════════════
@pytest.fixture
def client(db):
    """测试用的 HTTP 客户端：和真实请求走同一条路，但不用起服务器。

    ── 【这里干了本阶段最有价值的一件事：把整个应用的数据源换掉了】
        app.dependency_overrides[get_db] = ...
        一句话，所有接口里的 Depends(get_db) 就再也拿不到"连开发库的会话"，
        只会拿到我们递给它的这一个。

        接口代码一行都没改，应用就从开发库搬到了测试库 ——
        这正是阶段6 学依赖注入时说的"解耦"，好处在这一天兑现了。
        （反过来想：如果当初每个接口里写的是 SessionLocal()，
          今天就得去改二十个地方，还一定会漏。）

    ── 【为什么把 db 传进来，而不是在这儿再建一个 session？】
        测试里经常要"用接口写数据、再直接查库验证"。
        如果 client 和测试各用一个 session，MySQL 默认的隔离级别（REPEATABLE READ）
        会让测试那个 session 停在旧快照上，读不到接口刚提交的数据 ——
        于是你写的断言会莫名其妙地失败，而且只在某些执行顺序下失败。
        共用同一个 session，这个坑就根本不会出现。

    ── try/finally 是为了把覆盖**还回去**：
        dependency_overrides 是全局状态，不清理会渗到别的测试里。
    """
    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:   # with 会顺便跑 lifespan（启动/关闭事件）
            yield test_client
    finally:
        app.dependency_overrides.clear()


# ══════════════════════════════════════════════════════════════
# 四、Redis：这里**要**换成假的
# ══════════════════════════════════════════════════════════════
class FakeRedis:
    """内存版 Redis：只实现测试真正用到的那几个命令。

    【为什么数据库用真的，这里却要造假？】
        判据不是"内部还是外部"，而是——**这条依赖的行为是不是被测对象本身。**

        · 数据库里存的是业务数据，外键、级联删除这些**真实行为**正是要测的东西。
          换成假的就是什么都没测（B.19 那个递归 CASCADE 只有真库能测出来）。

        · Redis 在这里的角色是**旁路**：防刷无非"这次算不算数"，
          而且它自带 TTL —— 意味着**同一个测试隔 60 秒跑两次，结果会不一样**。
          测试必须可重复，所以这一层恰恰应该隔离掉。

        顺带一个好处：假 Redis 能让我们直接断言"key 写进去了吗、写的是什么"，
        比连真 Redis 再查一遍方便得多。
    """

    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    def set(self, key, value, nx=False, ex=None):
        # 只需要模仿 SET ... NX 的返回值约定：
        #     写成功 → True；被 NX 挡下 → None（注意**不是 False**）
        if nx and key in self.data:
            return None
        self.data[key] = value
        return True

    def get(self, key):
        return self.data.get(key)

    def ping(self):
        return True


class BrokenRedis:
    """一个"永远连不上"的 Redis，专门用来测降级分支。

    有了它，"Redis 挂了会怎样"就不再是嘴上说说 ——
    可以写成两个断言钉在测试里（见 test_smoke.py）。
    """

    def set(self, *args, **kwargs):
        raise redis.RedisError("redis is down")

    def ping(self):
        raise redis.RedisError("redis is down")


def _patch_redis(monkeypatch, replacement) -> None:
    """把项目里所有"持有 redis_client 这个名字"的地方统统换掉。

    ⚠️ 为什么不能只 patch 一处？—— 因为两句 import 的结果其实不一样：

        app/core/cache.py     : redis_client = redis.Redis.from_url(...)   # 定义在这里
        app/routers/health.py : from app.core.cache import redis_client    # 又把名字绑了一次

    Python 的 import 不是"起个别名"，而是**在当前模块里新建一个名字，
    指向同一个对象**。所以改掉 cache.redis_client 之后，health.py 里那个
    redis_client 依然指着老连接 —— 它早就绑好了，不会跟着变。

    这正是很多人写 mock 时"明明 patch 了却不生效"的根源：
    要改的不是"那个对象"，而是"**那个模块里的那个名字**"。
    所以 monkeypatch.setattr 的目标必须精确到"哪个模块"。

    本项目受影响的两处：
        · app.core.cache      —— is_first_seen() 定义在这儿，它内部找的就是本模块的全局变量
        · app.routers.health  —— 它把名字 import 走了，必须单独换

    （posts.py 里 `from app.core.cache import is_first_seen` 拿的是**函数**，
      而函数运行时仍然回 cache 模块里找 redis_client，所以不用额外处理 ✓）
    """
    monkeypatch.setattr(cache, "redis_client", replacement)
    monkeypatch.setattr(health_module, "redis_client", replacement)


@pytest.fixture(autouse=True)
def fake_redis(monkeypatch):
    """把 Redis 换成内存版（每个测试自动生效）。

    autouse=True 表示"每个测试都自动用它"，不必在参数里点名。
    这里敢用 autouse，是因为它只做一件事：替换一个外部依赖，
    不会偷偷塞数据给你、也不会改变测试的语义。
    """
    fake = FakeRedis()
    _patch_redis(monkeypatch, fake)
    return fake


@pytest.fixture
def broken_redis(monkeypatch):
    """把 Redis 换成"连不上"的版本，用来测降级分支。

    做成 fixture 而不让测试自己造，是为了把"怎么假装一个坏 Redis"也收在地基里 ——
    测试里只写 broken_redis，一眼就懂它在干什么。
    """
    _patch_redis(monkeypatch, BrokenRedis())


# ══════════════════════════════════════════════════════════════
# 五、数据工厂：让测试只写它真正关心的字段
# ══════════════════════════════════════════════════════════════
# 为什么不直接在各测试里 `db.add(User(...))`？
#     注册要填 3 个字段、文章 3 个、评论 3 个 id…… 大多数测试压根不关心这些。
#     工厂把它们填成"合理的默认值"，测试里只写**这次和默认不同的那部分**：
#
#         alice = make_user("alice")                        # 一句一个用户
#         post  = make_post(alice, published=False)         # 只强调"这是草稿"
#
#     好处不只是少打字：**看测试时，注意力会自然落在那个不同的字段上。**
#
# 这些工厂都是 function 级（默认），每个测试用完即弃，互不干扰。
@pytest.fixture
def make_user(db):
    """造一个用户。密码统一是 secret123，邮箱由用户名派生。"""

    def _make(username: str = "alice", *, password: str = PASSWORD, **overrides) -> User:
        user = User(
            username=username,
            email=f"{username}@example.com",   # 邮箱也有唯一约束，用用户名派生最省事
            hashed_password=hash_password(password),
            **overrides,
        )
        db.add(user)
        db.commit()
        db.refresh(user)          # 取回数据库生成的 id / created_at
        return user

    return _make


@pytest.fixture
def make_post(db):
    """造一篇文章。默认 published=True（多数测试关心的是"看得见的文章"）。"""

    def _make(
        author: User | None = None,
        *,
        title: str = "测试标题",
        content: str = "测试正文",
        published: bool = True,
        **overrides,
    ) -> Post:
        post = Post(
            title=title,
            content=content,
            published=published,
            author_id=author.id if author else None,
            **overrides,
        )
        db.add(post)
        db.commit()
        db.refresh(post)
        return post

    return _make


@pytest.fixture
def make_comment(db):
    """造一条评论；传了 parent 就是一条回复。"""

    def _make(
        post: Post,
        author: User | None = None,
        *,
        content: str = "测试评论",
        parent: Comment | None = None,
        **overrides,
    ) -> Comment:
        comment = Comment(
            content=content,
            post_id=post.id,
            author_id=author.id if author else None,
            parent_id=parent.id if parent else None,
            **overrides,
        )
        db.add(comment)
        db.commit()
        db.refresh(comment)
        return comment

    return _make


@pytest.fixture
def auth(client):
    """auth(user) → 该用户的认证请求头。

    传 User 对象或用户名都行，同一个用户只会真的登录一次（结果缓存住）。
    用法：client.patch(url, json=..., headers=auth(alice))
    """
    tokens: dict[str, dict[str, str]] = {}

    def _auth(user, password: str = PASSWORD) -> dict[str, str]:
        username = getattr(user, "username", user)
        if username not in tokens:
            resp = client.post("/auth/token", data={"username": username, "password": password})
            # 这里断言的是"测试自己搭的台子有没有塌"，不是被测代码的行为。
            # 它一旦失败，说明工厂或登录流程坏了，后面所有测试都会误报 —— 早报早好。
            assert resp.status_code == 200, f"登录 {username} 失败：{resp.status_code} {resp.text}"
            tokens[username] = {"Authorization": f"Bearer {resp.json()['access_token']}"}
        return tokens[username]

    return _auth


@pytest.fixture
def alice(make_user):
    """默认的女主角。"""
    return make_user("alice")


@pytest.fixture
def bob(make_user):
    """默认的男配角 —— 专门用来做"别人的东西"这类越权测试。"""
    return make_user("bob")
