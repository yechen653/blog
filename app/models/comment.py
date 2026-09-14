"""评论表：一个用户在一篇文章下写的一段话。

它又练了一遍"一对多"，但和阶段9/10 那组关系有几处不同，都很典型：

    1. 【两个外键】—— 一条评论同时属于"一篇文章"和"一个人"。
       一张表上挂多个外键是很常见的，`posts`/`users` 各指一次。
    2. 【post_id 是 NOT NULL】—— 评论不可能脱离文章存在，它不是可有可无的字段。
    3. 【两个外键的删除行为不一样】—— post_id 用 CASCADE，author_id 用 SET NULL。
       这是阶段15 最值钱的一个知识点，下面逐个解释。
    4. 【它还要指向自己】（阶段16）—— parent_id → comments.id，
       用来表达"这条评论回复的是哪条评论"。自关联比普通外键多一个绕不开的东西：
       `remote_side` —— 因为两端在同一张表，SQLAlchemy 分不清谁是父谁是子。
       见下面 parent / replies 两个关系里的注释。
"""

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    # 同样是"只给类型检查看"的导入，运行时靠字符串 "Post" / "User" 找类。
    # 现在三个模型文件互相引用，谁都【不能】真 import 别人，否则循环导入。
    from app.models.post import Post
    from app.models.user import User


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Text：正文不设长度上限。评论的长度限制交给接口层的 Field(max_length=1000) 管，
    # 数据库这边留宽松些 —— 将来想放宽到 2000 字，不用改表。
    content: Mapped[str] = mapped_column(Text)

    # ── 外键一：评论挂在哪篇文章下 ──────────────────────────────────
    # 【本阶段新东西】ondelete="CASCADE"：写在【数据库表结构】里的删除规则。
    #     "删掉一篇文章时，属于它的评论一并删掉。"
    #
    # 不写会怎样？默认是 RESTRICT（拒绝）。DELETE /posts/{id} 会直接报错：
    #     (1451, "Cannot delete or update a parent row: a foreign key constraint fails")
    # 因为数据库发现"还有评论指着这篇文章"，它【不敢替你决定】这些评论该怎么办。
    #
    # 这正是阶段9 那条外键的【另一面】：
    #     它不只防止"引用不存在的行"，也阻止"删除正被别人引用的行"。
    #
    # 三种常见选择（按业务含义挑，不是按技术偏好挑）：
    #     CASCADE  —— 连带删除（文章没了，评论留着也没意义 → 本表选它）
    #     SET NULL —— 把外键置空（"记录还留着，只是不再挂在任何文章上"）
    #     RESTRICT —— 直接拒绝删除（默认；"想删先清干净"的场景才用）
    post_id: Mapped[int] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), index=True
    )

    # ── 外键二：评论是谁写的 ────────────────────────────────────────
    # 允许 NULL，和 Post.author_id 一个思路："用户注销了，评论不必跟着消失"。
    # 但这里【显式】写了 SET NULL，而 Post.author_id 什么都没写（= RESTRICT）——
    # 于是删用户时：评论的 author_id 被清空（评论保留，前端显示"已注销"），
    # 但那个人名下的文章会挡住删除。
    #
    # 同一种"指向用户的字段"，两张表选了两种行为，是因为业务上对它们的期待不同：
    # 文章是"内容资产"，要留住；评论更像"互动痕迹"，作者走了留着也无妨。
    #
    # ⚠️ 注意 ondelete 是【数据库层面】的规则：
    #     它只在"真的执行 DELETE 语句"时生效，
    #     直接改 ORM 对象的 post_id / author_id 不受它管。
    author_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )

    # ── 外键三：这条评论回复的是哪条评论（阶段16：自关联）───────────────
    # 本项目第一次让一张表【指向自己】：comments.parent_id → comments.id
    #
    # nullable=True 是必须的：顶层评论没有父，这一列不能是 NOT NULL。
    # ondelete="CASCADE"：删掉一条评论时，它下面的回复一并删除。
    #     ⚠️ 数据库会【递归】处理连锁反应：删 A → 删 A 的回复 B → 又删 B 的回复 C……
    #     一条 DELETE 语句就能带走一整棵子树（实测验证过，见手册 B.19）。
    #
    # 为什么不另开一张 replies 表？
    #     回复的字段和评论一模一样，单开表等于把结构整个复制一遍。
    #     "让表指向自己"是树形数据的标准建模方式。
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("comments.id", ondelete="CASCADE"), index=True, nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    # 评论可以修改，所以 updated_at 有 onupdate：每次 UPDATE 自动刷新
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    # 两个"反向"导航属性：comment.post / comment.author
    # 都用默认的 lazy="select"（访问到才查），所以查询时要手动 selectinload ——
    # 理由和阶段10 完全一样：不加就会掉进 N+1。
    post: Mapped["Post"] = relationship(back_populates="comments")
    author: Mapped[Optional["User"]] = relationship(back_populates="comments")

    # ── 自关联的两个方向（阶段16）────────────────────────────────────
    # parent  ：往上找"我回复的那条"（多对一）
    # replies ：往下找"回复我的那些"（一对多）
    #
    # 【remote_side 是自关联的钥匙，必须写】
    # 平时 SQLAlchemy 靠"外键落在哪张表"就能判断谁是一、谁是多（外键那端永远是"多"）。
    # 自关联时两端都在同一张表里，它就分不清了 —— 必须显式告诉它：
    #     关系的"一"那一端在 Comment.id 上（父），"多"那一端是 parent_id（子）。
    # 少了它：要么启动直接报 ArgumentError，要么方向正好搞反。
    parent: Mapped[Optional["Comment"]] = relationship(
        back_populates="replies", remote_side="Comment.id"
    )

    # cascade / passive_deletes 的道理和 Post.comments 完全一样：
    #     cascade         —— ORM 层：回复的生命周期跟着父评论走
    #     passive_deletes —— 别自己一条条删，交给数据库的 ON DELETE CASCADE（它会递归到底）
    replies: Mapped[list["Comment"]] = relationship(
        back_populates="parent", cascade="all, delete-orphan", passive_deletes=True
    )

    def __repr__(self) -> str:
        return f"<Comment id={self.id} post_id={self.post_id} author_id={self.author_id}>"
