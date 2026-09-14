"""Redis 客户端：本项目的第一个"外部服务依赖"（阶段14）。

为什么防刷要用它？
    防刷的本质是问一句："这人在最近 N 秒内看过这篇吗？"
    这需要一处【带过期时间的临时记录】。MySQL 也能存，但每次浏览都要写一张表，
    还得自己写任务去清理过期数据，代价大。
    Redis 天生干这个：数据在内存里、读写极快、**自带过期时间（TTL）**。

和 database.py 的分工：
    database.py 管【要长期保存的数据】（用户、文章）；
    cache.py    管【随时可以丢掉的临时数据】（防刷窗口）。
    两套独立连接，谁挂了都不影响对方。
"""

import logging

import redis

from app.core.config import settings

logger = logging.getLogger(__name__)

# 模块级单例：和 engine 一样，整个应用共用一个（内部自带连接池，多线程安全）。
#
# decode_responses=True：Redis 里存的是字节，不加这个参数取回来是 b"1"；
#   加上它，redis-py 自动按 UTF-8 解码成 "1"，省得每处都 .decode()。
#
# 注意：from_url() 是【懒连接】—— 这里并不会真的去连 Redis，
#   要等到第一次真正执行命令才建立连接。
#   所以【Redis 没启动，应用照样能起】——只是防刷会走进下面的降级分支。
redis_client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)


def is_first_seen(key: str, window: int) -> bool:
    """核心：判断 key 是不是【窗口期内第一次】出现，并顺手把它记下来。

    返回 True  → 第一次见到（该计数）
    返回 False → 窗口内已经见过（重复，不该计数）

    ⚠️ 它不只是"判断"，还会【写入】——这两件事被合并在一起，正是下面要讲的原子性。

    ────────────────────────────────────────────────────────────
    一行 `set(...)` 里塞了三个语义，必须拆开看：

        SET  key  "1"  NX  EX  60
                     │   │   └── EX 60：60 秒后自动删除。
                     │   │            不用自己写清理任务，Redis 负责过期。
                     │   └────── NX = "Not eXists"：只在 key 【不存在】时才写入。
                     └────────── 写成功 = 原本不存在 = 这是第一次；
                                 写失败 = 原本已存在 = 重复访问。

    ────────────────────────────────────────────────────────────
    【为什么不能写成"先 GET 判断，再 SET 记录"】

        if redis_client.get(key) is None:       # ① 读
            redis_client.set(key, "1", ex=60)   # ② 写

        ①② 之间有一个"窗口期"。两个请求同时进来时，可能【都】读到 None，
        于是都认为"我是第一次"，各自计数一次 —— 防刷失效。

        这和阶段12 那个 `post.views += 1` 是【同一类错误】：
        把"判断"和"写入"拆成两步，中间的缝隙就会被并发钻进去。
        解法也一样：**把两步合并成一条原子命令，交给 Redis 自己执行。**

    ────────────────────────────────────────────────────────────
    【返回值是个坑】

        SET ... NX 成功时返回 True，被 NX 挡下时返回 **None —— 不是 False**。
        所以用 bool(...) 包一层：None → False，True → True。
        顺带把类型统一成 bool，调用方一眼就能看出这是"是否"。

    ────────────────────────────────────────────────────────────
    【降级：Redis 挂了怎么办】

        这是本项目第一个"挂了也不能让接口崩"的外部依赖。
        这里选择 **fail-open（放行）**：Redis 出问题时当作"是第一次"，照常计数。

        理由：浏览量是个【非核心指标】，多统计几次没人受伤；
              但要是因为它让"打开文章"直接 500，那才是真事故。

        反过来，如果这个消息用来做"支付去重"，就必须写 fail-closed（拦截）。
        ——【选放行还是拦截，取决于"哪种错更严重"，而不是哪种写法顺手。】

        except 只抓 redis.RedisError（redis-py 所有异常的基类），
        不抓那个能吞下一切的 Exception —— 只兜住"我知道怎么处理"的异常。

        日志用 %s 占位而不是 f-string：日志级别没开时，字符串根本不会被拼出来。
    """
    if window <= 0:
        return True   # 配置成 0 就当作关闭防刷（方便对照测试）

    try:
        return bool(redis_client.set(key, "1", nx=True, ex=window))
    except redis.RedisError as exc:
        logger.warning("Redis 不可用，防刷降级为放行：%s", exc)
        return True


def ping_redis() -> bool:
    """对 Redis 发 PING，返回 True 表示连通。

    这一函数**不**做异常处理——让 RedisError 冒上去，由 caller 决定是 fail-open 还是
    fail-closed。和 is_first_seen 是对照：
        is_first_seen 自己 catch → fail-open（防刷不该让用户看不了文章）
        ping_redis 不 catch   → 让 router/health.py 把 Redis 挂了翻译成 503
    为什么探测要 fail-closed？因为健康检查的职责就是"如实回答"——
    如果挂了还回 200，监控就以为一切正常，等于把"我不健康"藏起来。
    """
    return redis_client.ping()
