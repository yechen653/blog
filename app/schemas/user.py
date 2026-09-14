"""用户契约：注册收什么、用户信息回什么。

这里正好演示"同一份数据、多个视图"最要紧的一条：
    **密码只进不出**——UserCreate 里有 password，UserRead 里永远没有它。
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserCreate(BaseModel):
    """注册请求体：客户端【传进来】的东西。"""

    username: str = Field(..., min_length=3, max_length=50, description="用户名，3~50 字")
    email: EmailStr = Field(..., description="邮箱，格式不对直接 422")
    # max_length=72：bcrypt 只处理前 72 字节，超出部分会被忽略。
    # 与其"悄悄截断"，不如在入口就拦住，行为更可预期。
    password: str = Field(..., min_length=6, max_length=72, description="密码，6~72 字")


class UserRead(BaseModel):
    """用户信息响应体：服务端【回出去】的东西。

    注意字段列表里【没有】password，也没有 hashed_password——
    这就是"白名单"：不声明，就永远不会被带出去。
    """

    model_config = ConfigDict(from_attributes=True)   # 允许直接从 ORM 对象读取

    id: int
    username: str
    email: EmailStr
    is_active: bool
    created_at: datetime


class UserSummary(BaseModel):
    """公开场合露出的用户信息：只有 id 和用户名。

    对比 UserRead：那边有 email，因为它返回的是"你自己申请的资料"，
    而且那个接口本身就要登录才看得到。但文章列表是【完全公开】的——
    把每个作者的邮箱一起撒出去，就是隐私泄露。

    同一张 users 表 → 多个对外视图，谁看、看到什么粒度，由契约说了算。
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
