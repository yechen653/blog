"""模型包。

为什么要在这里统一 import 一次？
    建表时 SQLAlchemy 是遍历 `Base.metadata` 里"已注册"的表来建。
    而一个模型类只有被 import 过，才会注册进去。
    所以别人只要 `from app.models import Post` 这一句，就会触发本文件执行，
    posts / users 两张表就被一起注册了——不用挨个去 import 每个模型文件。

    Alembic 的 autogenerate 也【依赖这一点】：它看到的是 Base.metadata，
    本文件没 import 的模型，它就"看不见"，还会以为该把那张表删掉。
    —— 所以新建模型后第一件事，就是加到这里。阶段15 的 Comment 就差点漏掉。
"""

from app.models.comment import Comment
from app.models.post import Post
from app.models.user import User

__all__ = ["Comment", "Post", "User"]
