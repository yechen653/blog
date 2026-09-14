"""健康探测的数据访问层。

为什么健康检查也要走 crud？
    健康检查的本质是【对存储做一次"读"，并判断返回值是不是预期】。
    对数据库是 SELECT 1、对 Redis 是 PING —— 都是"摸一下连接是不是还活着"。
    集中到这里的好处：
        · router 只负责把"成功 / 失败"翻译成 200 / 503；
        · 如果将来要探测别的依赖（Elasticsearch、Kafka），再多一个函数就是，
          router 完全不用改。

判据："crud = 跟某种持久化存储打交道的层"——SELECT 1 也是"和数据库打交道"。
"""

from sqlalchemy import text
from sqlalchemy.orm import Session


def check_database(db: Session) -> bool:
    """对数据库执行 SELECT 1，返回 True 表示能正常读到 1。

    异常路径：如果连接不通 / 数据库挂了，SQLAlchemy 会自己抛 OperationalError，
    这一层【不兜】—— 让异常冒到 router，由 router 翻译成 503。
    （数据库挂了的语义是"健康检查发现不健康"，HTTP 层该回 503，让监控看见。）
    """
    result = db.execute(text("SELECT 1")).scalar()
    return result == 1