"""用户表。

和 Post 一样，这里只描述"数据库长什么样"，不掺接口的事。
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    # 只在类型检查时可见，运行时靠字符串 "Post" 去 SQLAlchemy 的注册表里找
    from app.models.comment import Comment
    from app.models.post import Post


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # unique=True → 数据库层面加唯一约束（不允许两个人重名）
    # index=True  → 登录时要按用户名查，加索引更快
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(120), unique=True, index=True)

    # 关键：列名就叫 hashed_password，而不是 password。
    # 名字本身就在提醒你——这一列存的永远是哈希串，绝不放明文。
    # String(255)：bcrypt 结果是 60 个字符；留宽一点，将来换算法不用改表。
    hashed_password: Mapped[str] = mapped_column(String(255))

    # 停用开关：不删用户，只标记停用（阶段9 的"是否允许登录"会用到）
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # 阶段10：一对多的那一端 —— 一个用户有多篇文章。
    # 同样【不是数据库里的列】，而是 ORM 的导航属性：
    #     user.posts → [<Post id=1 ...>, <Post id=2 ...>, ...]
    # 它和 Post.author 是一对镜像，靠 back_populates 配对。
    # 方向由外键决定：posts.author_id 指向 users.id，所以"多"的那边是 Post。
    posts: Mapped[list["Post"]] = relationship(back_populates="author")

    # 阶段15：一个用户也有多条评论 —— 和 posts 是同一种关系，只是指向 Comment。
    # passive_deletes=True：删用户时不劳 ORM 操心（它默认会去把子对象的 author_id 置 NULL），
    # 评论这边直接交给数据库的 ON DELETE SET NULL 收尾。
    # 对比 posts：那边没加，因为 Post.author_id 本来就允许为空，ORM 顺手置空也不算错。
    comments: Mapped[list["Comment"]] = relationship(
        back_populates="author", passive_deletes=True
    )

    def __repr__(self) -> str:
        # 注意：repr 里也不要打印 hashed_password（日志同样可能泄露）
        return f"<User id={self.id} username={self.username!r}>"
