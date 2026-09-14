"""评论契约：和文章那套完全同构（Create / Update / Read / Page）。

"同构"是好事 —— 一套资源的四个模型，是这个项目从阶段5 起就固定的套路：

    XxxCreate   客户端传来什么
    XxxUpdate   局部更新（字段全可选）
    XxxRead     单条回什么
    XxxPage     列表信封（total + 分页参数 + items）

照着套就行，真正要想清楚的只有一件事：**哪些字段允许进、哪些允许出**。

阶段16 加了"回复"以后多了一个 CommentTree —— 它不是新套路，
而是"列表里装的不是单条、而是一棵小树"（顶层评论 + 它的回复）时的自然产物。
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserSummary


class CommentCreate(BaseModel):
    """POST /posts/{post_id}/comments 的请求体。

    【注意这里既没有 post_id，也没有 author_id，但有 parent_id】
        判据不是"字段名里带 id 就不能传"，而是 **服务端能不能自己确定这个值**：

            post_id   —— URL 路径里已经有了（/posts/7/comments），服务端自己知道
                         → 不让传（传了就是冗余，还可能和路径打架）
            author_id —— 从 token 里认出来，服务端自己知道
                         → 不让传（否则发个 {"author_id": 1} 就能冒名留言）
            parent_id —— "我回复的是哪一条"，这是【只有客户端知道】的意图
                         → 必须让传，不然没法表达"回复"

        和 PostCreate 不带 author_id 是同一条规矩：**越权赋值的口子都是这么开的**。
    """

    content: str = Field(..., min_length=1, max_length=1000, description="评论内容，1~1000 字")
    # ge=1：id 从 1 开始，传 0 或负数说明客户端算错了，直接 422 拦下，不用去查库
    parent_id: Optional[int] = Field(
        None, ge=1, description="回复的父评论 id；顶层评论不传或传 null"
    )


class CommentUpdate(BaseModel):
    """PATCH /comments/{id} 的请求体：只有内容能改。

    为什么不能改 post_id？
        把一条评论"搬家"到别的文章下面，是产品上几乎不会有的操作；
        真需要时就该删了重发。**契约里的字段越少，能出错的地方越少。**

    那为什么也不能改 parent_id（"把这条回复挪到别的评论下"）？
        同一个理由，而且更危险：一棵子树整体搬家，涉及的不只是这一条。
        所以 parent_id 在创建时定死，之后只读。
    """

    content: Optional[str] = Field(None, min_length=1, max_length=1000, description="新内容")


class CommentRead(BaseModel):
    """一条评论（单条返回 / 回复列表里的那一条）。

    它对 CommentTree 的角色，相当于 UserSummary 对 UserRead：
    一个是"完整版"，一个是"嵌进别人身体里的精简版"。
    """

    id: int
    content: str
    # 把 post_id 露出去：前端拿着它就能知道这条评论属于哪篇（调试时也好用）
    post_id: int
    # 阶段16 新增：告诉前端"这条回复挂在谁下面"（顶层评论这里是 null）
    parent_id: int | None = None
    author_id: int | None = None
    # 和 PostRead.author 一样，嵌套的是【精简版】用户（只有 id + username）。
    # 评论列表是完全公开的，绝不能把 email 撒出去 —— 那正是 UserSummary 存在的意义。
    author: UserSummary | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CommentTree(CommentRead):
    """顶层评论 + 它的回复（本项目只做【两层】）。

    `replies` 里装的是 CommentRead 而不是 CommentTree ——
    这一行的类型本身就说明了"只有两层"：**回复不能再有回复**。

    怎么保证？不是靠前端自觉，而是在发表接口里做**规范化**：
      回复一条"回复"时，服务端会把它挂到那棵树的【顶层评论】下
      （parent.parent_id or parent.id），见 routers/comments.py。
    这样数据库里永远只有两层，查询和渲染都不用递归。

    为什么不做 N 层？
        - 渲染：无限缩进在手机上根本没法看，主流产品（微博 / 小红书）都只做两层；
        - 查询：MySQL 要递归 CTE，或者把整棵树拉进内存再组装，代价陡增。
      两层是"体验 + 成本"平衡下来的结果，不是偷懒。
    """

    replies: list[CommentRead] = []


class CommentPage(BaseModel):
    """评论列表的信封：形状和 PostPage 一模一样。"""

    # ⚠️ total 数的是【顶层评论】的条数 —— 因为分页是对顶层分的，
    # 一条顶层评论不管带多少回复，都只在第 1 页出现一次。
    # 想显示"总共有多少条留言（含回复）"，得另算一个数（本阶段没做）。
    total: int
    skip: int
    limit: int
    items: list[CommentTree]
