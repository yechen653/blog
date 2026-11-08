# AI生成
"""接口限流：本项目 Redis 的第二个用途（阶段17）。

和 core/cache.py 的分工（同样是 Redis，但目的不同）：
    cache.py     管"浏览量防刷"——业务语义：同一 IP 看同一篇只算一次（统计）
    ratelimit.py 管"接口限流"  ——安全语义：同一 IP 在窗口内最多调 N 次（闸门）

为什么限流要用 Redis？
    它需要一处"带过期时间的计数器"，天生适合 Redis：内存里自增、自带 TTL，
    不用自己写清理任务。数据库也能数，但每次请求都写一张表，代价太大。

算法：固定窗口（fixed window）计数器。
    窗口 = 一段固定时间（比如 60 秒）；窗口内计数，超过上限就拒绝。
    取舍：实现简单、内存开销小；代价是窗口【边界】可能出现瞬时两倍流量
    （窗口切换那一秒，前一窗口额度刚用完、后一窗口额度又刷新）。
    个人主页这种量级完全够用；要更平滑可以换"滑动窗口 / 令牌桶"。
"""

import logging

import redis

from app.core.cache import redis_client

logger = logging.getLogger(__name__)

# 固定窗口计数器：一条 Lua 脚本里完成 INCR + 首次设过期。
#
# 为什么用 Lua，而不是分两句 redis_client.incr() / .expire()？
#   —— 和 cache.py 的 `SET NX EX` 是同一个道理：
#      【别把"读 → 判断 → 写"拆成两步】，中间的缝隙会被并发钻进去。
#      Lua 脚本在 Redis 里【原子执行】（Redis 单线程跑脚本），两条命令之间不会被打断。
#
# 语义：
#   INCR  → 计数 +1（key 不存在时从 1 开始）
#   ==1   → 说明这是本窗口的第一次，顺手设 TTL（窗口长度）；之后每次自增都不再设。
#   返回 c：本窗口内的累计次数，由调用方决定"超没超"。
_LUA = """
local c = redis.call('INCR', KEYS[1])
if c == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return c
"""

# 模块级单例：和 engine / cache.redis_client 一样，整个应用复用一条脚本对象。
# register_script 只是把脚本存起来，【不会】真的连 Redis（首次调用才发 EVALSHA）。
_script = redis_client.register_script(_LUA)


def hit(key: str, *, limit: int, window: int) -> tuple[bool, int]:
    """记一次访问，返回 (是否放行, 剩余次数)。

    放行规则：本窗口内累计次数 <= limit。
    limit <= 0 或 window <= 0 时视为"关闭限流"，直接放行（方便本地开发 / 对照测试）。

    key 由调用方拼好（含 scope 和来源标识），例如 "rl:auth:token:1.2.3.4"。

    Redis 不可用时 **fail-open（放行）** —— 和浏览量防刷同一取舍：
        限流是"锦上添花"的防护，绝不能因为它挂了就让登录直接 500。
        （真要 fail-closed 的是"支付去重"这类，不是"登录限流"。
         判据永远是"哪种错更严重"，而不是哪种写法顺手。）

    except 只抓 redis.RedisError（redis-py 的异常基类），不抓能吞下一切的 Exception ——
    只兜住"我知道怎么处理"的异常。
    """
    if limit <= 0 or window <= 0:
        return True, limit

    try:
        # keys / args 是 redis-py 对 EVAL 的约定：KEYS 走 keys=，其它参数走 args=
        count = int(_script(keys=[key], args=[window]))
    except redis.RedisError as exc:
        logger.warning("Redis 不可用，限流降级为放行：%s", exc)
        return True, limit

    return count <= limit, max(0, limit - count)