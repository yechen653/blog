"""User 表的数据访问层（CRUD）。

分层铁律 —— 这一层【完全不认识 HTTP】：
1. 不 import fastapi：这里没有 Depends / Query / Path / HTTPException；
2. 取不到不抛错：返回 None，由 router 决定该翻译成 404 还是别的；
3. 不认识"当前用户"：只认 user_id 这些整数主键。

对照关系：
    routers/auth.py   = 接线层：路径、参数声明、校验、409 / 401 / 403 翻译、状态码
    services/user.py  = 业务规则层：register_user_unique（查重 + 哈希）
    crud/user.py      = 数据层：只跟 SQLAlchemy 和 Session 打交道（本文件）
"""

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User


# ============================================================
# 一、单条读取
# ============================================================
def get_by_username(db: Session, username: str) -> Optional[User]:
    """按用户名取一个用户。"""
    return db.scalars(select(User).where(User.username == username)).first()


def get_by_email(db: Session, email: str) -> Optional[User]:
    """按邮箱取一个用户。"""
    return db.scalars(select(User).where(User.email == email)).first()


# ============================================================
# 二、写操作
# ============================================================
def create(
    db: Session, *, username: str, email: str, hashed_password: str
) -> User:
    """新建一个用户：把 username / email / hashed_password 拼成 ORM 对象写库。

    为什么【不】收明文 password？
        crud 这一层不该知道"密码需要哈希"这件事，那是 services 关心的事。
        层级关系：
            router   收明文 password  →
            services 把明文转成哈希   →
            crud     只认哈希串
        这样明文 password 一进入 service 就被哈希掉，
        不会以任何形式溜到 crud / 写入数据库。

    为什么 username / email 不像 PostCreate 那样用 `data: dict`？
        Post 那边的 `data` 是 Pydantic 的 `model_dump()` —— 一个通用 dict。
        User 这边只有三个字段，直接作为关键字参数传更清晰，
        签名本身就告诉你"这一层关心这三个值"。
    """
    user = User(
        username=username,
        email=email,
        hashed_password=hashed_password,
    )

    db.add(user)
    db.commit()
    db.refresh(user)
    return user