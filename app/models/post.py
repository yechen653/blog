"""ORM 模型：一个类 = 一张表，一个属性 = 一列。

这个类只负责"数据库长什么样"，不负责"接口收发什么"——那是 schemas 的活。
"""

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    # 只给"编辑器/类型检查"看，运行时【不导入】。
    # 因为 user.py 那边也要反向引用 Post，两边都真 import 就成循环了。
    # SQLAlchemy 靠字符串 "User" 自己去注册表里找类，运行时不需要这个名字存在。
    from app.models.comment import Comment
    from app.models.user import User


class Post(Base):
    # 不写 __tablename__ 会默认用类名小写（post）；显式写更清楚，也避免踩关键字
    __tablename__ = "posts"

    # Mapped[类型] = SQLAlchemy 2.0 新写法：
    #   左边是 Python 类型（编辑器能补全、能查错），右边 mapped_column 告诉数据库列的细节
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # 阶段9：外键 —— 这篇文章是谁写的。
    # ForeignKey("users.id") 把"必须指向一个真实存在的用户"这件事交给【数据库】保证：
    # 往 author_id 写一个不存在的用户 id，插入会直接被拒绝。
    # 这比"在 Python 代码里小心一点"可靠得多——代码可能被绕过，约束不会。
    #
    # 为什么允许为 NULL（Mapped[int | None]）？
    #   1. 这张表在阶段9之前就有数据了，那些老数据没有作者；
    #   2. 真实项目里"用户注销"通常不连带删文章，而是把作者置空。
    # 注意 current_user.id 永远不是 None，所以"无主文章"对任何人都算"不是你的"。
    author_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), index=True, nullable=True
    )

    # 阶段10：relationship —— ORM 层面的"导航属性"，【数据库里没有这一列】。
    #     post.author_id → 3                                  （真实存在的列，存的是一个数字）
    #     post.author    → <User id=3 username='alice'>        （ORM 按上面的列帮你查出来的对象）
    # 这两者不是一回事：前者是数据，后者是"顺手帮你查了一下"的结果。
    # 正因为"顺手查一下"要花一次查询，阶段10 才要讲 N+1 和 selectinload。
    #
    # 类型写 Optional：无主文章（author_id 为 NULL）的 author 就是 None。
    # back_populates="posts" 指向 User 里那个同名声明，两边配对，缺一个 SQLAlchemy 会报错。
    author: Mapped[Optional["User"]] = relationship(back_populates="posts")

    # ── 阶段15：一对多的"一"这一端 —— 一篇文章有多条评论 ────────────────
    # 三个参数各干各的活，别混：
    #   back_populates="post"         —— 和 Comment.post 配对（和上面 author 那组一个道理）
    #   cascade="all, delete-orphan"  —— 【ORM 层】：删文章时，把它的评论也当成"该删的"
    #   passive_deletes=True          —— 【别自己一条条删】：不把评论全查进内存再逐条 DELETE，
    #                                    交给数据库的 ON DELETE CASCADE 去处理
    #
    # 【最容易混的一对概念】
    #   cascade   是 ORM 层的约定：告诉 SQLAlchemy "这些对象该怎么一起处理"
    #   ondelete  是数据库层的外键规则：写在 DDL 里，绕过 ORM 直接 DELETE 也照样生效
    # 两张网都要有：
    #   少了 cascade，SQLAlchemy 会以为"评论该保留"，于是试图把 post_id 置成 NULL，
    #       可 post_id 是 NOT NULL → IntegrityError；
    #   少了 ondelete，绕过 ORM 直接删数据就会留下"孤儿评论"。
    comments: Mapped[list["Comment"]] = relationship(
        back_populates="post", cascade="all, delete-orphan", passive_deletes=True
    )

    # String(100) = VARCHAR(100)；加索引，将来按标题搜索/排序更快
    title: Mapped[str] = mapped_column(String(100), index=True)

    # Text = 长文本（不设长度上限），文章正文用这个；VARCHAR 有长度限制
    content: Mapped[str] = mapped_column(Text)

    # Mapped[bool] 没有 Optional = NOT NULL；default=False 是"插入时不给值就用 False"
    published: Mapped[bool] = mapped_column(Boolean, default=False)

    # ── 阶段11 演练：给「已经有数据」的表加一列 ────────────────────────
    # 浏览量。故意挑一个最平淡的字段，好让注意力全落在"改表"这件事本身。
    #
    # 【关键】server_default="0" 不能省，也不能换成 default=0：
    #   default=0          只活在 Python 层：SQLAlchemy 生成 INSERT 时帮你填 0，
    #                      数据库自己完全不知道这回事（表结构里没有 DEFAULT）。
    #   server_default="0" 写进【表结构】：DEFAULT 0。
    #                      改表时数据库执行的是 ALTER TABLE ... DEFAULT 0，
    #                      它才知道"那些已经存在的老行，这一列统统填 0"。
    # 表里已经有数据了，两个都不写的话 MySQL 会陷入两难：
    #   "新列是 NOT NULL，可老行这一列该填什么？" → 直接报错，ALTER TABLE 失败。
    # 所以：给已有数据的表加 NOT NULL 列，server_default 是必需品。
    views: Mapped[int] = mapped_column(Integer, server_default="0")

    # server_default=func.now()：交给【数据库】生成时间（插入时不用管）
    # onupdate=func.now()：每次 UPDATE 自动刷新这个字段
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        # 调试时 print(post) 就看到这行，不用盯着 <Post object at 0x...>
        return f"<Post id={self.id} title={self.title!r} published={self.published}>"
