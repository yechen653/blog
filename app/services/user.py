"""用户相关的业务规则。

凡是"涉及多个 crud 调用 + 业务约束"的东西放在这里；
纯粹的"读 / 写一条记录"那种简单活留在 crud。
"""
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.crud import user as user_crud
from app.models import User


def register_user_unique(
    db: Session, *, username: str, email: str, password: str
) -> User:
    """注册：先查重 → 再哈希 → 再入库。

    三步走的理由：

    1. **先查重**，让"用户名 / 邮箱重复"返回说得清的 409，
       而不是撞到数据库唯一约束后抛出 500。
       数据库上的 unique 约束依然保留，作为并发场景下的最后一道防线
       （同一个瞬间两个注册都查到没冲突 → 都走下一步 → 唯一约束只让一个活下来，
        另一个会拿到 IntegrityError —— 但那是非常极端的并发场景，足够少见）。

    2. **再哈希**：crud 这层不该知道"密码需要哈希"这件事，
       所以哈希在 services 里完成 —— 这样明文 password 一进入 service 就被哈希掉，
       不会以任何形式溜到 crud / 写入数据库。
       这一层还顺便把"明文密码"和"哈希串"在代码里完全隔开，
       任何人 grep 一下 crud/user.py 都找不到任何接受明文 password 的入口。

    3. **最后入库**：crud.create 只看 username/email/hashed_password 三个字段，
       别的一概不认。

    为什么"用户名/邮箱重复"要 raise HTTPException(409) 而不是 400？
        409 Conflict = "请求和资源当前状态冲突"。当前状态是"用户名已被占用"，
        你想新建用户时就和当前状态冲突了。
        400 Bad Request = "请求本身的格式不对"。但 username/email 格式都对，
        只是恰好和别人重了 —— 这是冲突，不是格式错误。
        顺手把 username 重复、email 重复分别报，但每个都用同一个状态码 409，
        调用方只看 status 也能分清"再换一个再试"。
    """
    if user_crud.get_by_username(db, username):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"username {username!r} already taken",
        )
    if user_crud.get_by_email(db, email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"email {email!r} already registered",
        )

    return user_crud.create(
        db,
        username=username,
        email=email,
        hashed_password=hash_password(password),
    )