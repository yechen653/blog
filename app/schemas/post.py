"""数据契约：请求体（客户端传什么）+ 响应体（服务端返回什么）。

为什么不让 ORM 模型直接当请求体？
    1. ORM 模型带着 id / created_at 这些"数据库自己生成、客户端不该传"的字段；
    2. 创建、更新、读取三种场景需要的字段本来就不一样（比如 PATCH 全都能省）；
    3. 表结构一变，接口文档会跟着乱——把"对外契约"和"内部表结构"分开更稳。

命名习惯（很通用，记住）：
    XxxCreate  新建时的请求体
    XxxUpdate  更新时的请求体（字段通常全可选）
    XxxRead    返回给客户端的结构
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserSummary


class PostCreate(BaseModel):
    """POST /posts 的请求体。"""

    # Field(...) 写在类型后面，用来加"文档说明 + 校验规则"
    title: str = Field(min_length=1, max_length=100, description="文章标题，1~100 字")
    content: str = Field(min_length=1, description="正文，不能为空")
    # 有默认值 → 非必需；不传就是 False（草稿）
    published: bool = Field(False, description="是否发布，默认 False（草稿）")


class PostUpdate(BaseModel):
    """PATCH /posts/{id} 的请求体：三个字段全可选，只改你传了的那个。

    注意：Optional[str] = None 在这里的含义是"这个字段可以不传"，
    而不是"把标题改成 None"——PATCH 用 model_dump(exclude_unset=True) 才分得清。
    """

    title: Optional[str] = Field(None, min_length=1, max_length=100, description="新标题")
    content: Optional[str] = Field(None, min_length=1, description="新正文")
    published: Optional[bool] = Field(None, description="发布 / 撤回")


class PostRead(BaseModel):
    """响应里的单篇文章：比 Create 多了 id 和时间。"""

    id: int
    title: str
    content: str
    published: bool
    # 阶段12：浏览量。库里有 server_default=0，所以老数据也一定有值；
    # 这里再给个 Python 默认值 0，是为了"万一"（响应对象不总是从数据库来）。
    views: int = 0
    # 阶段9：作者 id。允许 None，因为老数据可能没有作者。
    author_id: int | None = None
    # 阶段10：嵌套一层作者对象。注意类型是 UserSummary 而不是 UserRead——
    # 文章是公开的，所以只能露出 id / username，不能露 email。
    author: UserSummary | None = None
    created_at: datetime
    updated_at: datetime

    # from_attributes=True：允许 Pydantic 直接"读对象属性"（ORM 对象 → 响应模型）。
    # 没有它，Pydantic 只认 dict，把 Post 对象丢进去会校验失败。
    model_config = ConfigDict(from_attributes=True)


class PostSummary(BaseModel):
    """列表用的精简版：**不返回正文**。

    同一张表可以有多个"对外视图"：列表页只需要扫标题，把每篇正文都传过去纯属浪费流量。
    """

    id: int
    title: str
    published: bool
    # 阶段12：列表页也露出浏览量，前端才好做"热门排序"这类展示
    views: int = 0
    author_id: int | None = None
    # 列表页也能看到作者（同样是精简版，只有 id + username）
    author: UserSummary | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PostPage(BaseModel):
    """列表接口的"信封"：分页信息 + 当页数据。"""

    total: int   # 符合条件的总条数（不是当页条数）
    skip: int
    limit: int
    items: list[PostSummary]   # 列表只给精简字段；正文去详情接口拿
