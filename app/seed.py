"""开发用脚本：建表 + 塞种子数据（在 blog-api 目录、已 conda activate 的前提下跑）。

    python -m app.seed            # 建表；表里没数据才塞种子
    python -m app.seed --reset    # 先清空 posts 表，再重新塞
    python -m app.seed --rebuild  # 删掉 posts/users 两张表再重建（【表结构改了之后用这个】）

为什么需要 --rebuild？
    create_all() 只建"还不存在的表"，已经存在的表它【一个字都不改】。
    所以阶段9 给 posts 加了 author_id 这一列后，光跑 python -m app.seed 是没用的——
    旧表的列不会自动多出来，接口一查就会报 "Unknown column 'posts.author_id'"。
    drop_all() + create_all() 就是开发阶段最粗暴也最省事的解法。
    （正式项目里做同样的事要用 Alembic 迁移：它生成 ALTER TABLE，
      能在【不丢数据】的前提下加列，这才是生产环境的做法。）

它和 Web 服务是两件事：服务只管读写，建表和造数据用脚本单独做。
"""

import sys

from sqlalchemy import delete, select

from app.core.database import Base, SessionLocal, engine
from app.core.security import hash_password
# 导入模型包 → 触发 app/models/__init__.py → posts / users 两张表全部注册到 Base.metadata
from app.models import Post, User

# 开发用账号：跑完 seed 就能直接拿它登录，省得每次都去注册
DEMO_USER = {"username": "alice", "email": "alice@example.com", "password": "secret123"}

SEED_POSTS = [
    {"title": "FastAPI 入门", "content": "从 Hello World 开始", "published": True},
    {"title": "路径参数详解", "content": "URL 里的那个变量", "published": True},
    {"title": "查询参数详解", "content": "?key=value 那一部分", "published": True},
    {"title": "异步改造草稿", "content": "还没写完", "published": False},
    {"title": "部署笔记", "content": "以后再补", "published": False},
]


def get_or_create_demo_user(db) -> User:
    """拿到 demo 用户，没有就建一个。

    为什么不能直接 db.add(User(...))？
        username / email 上有唯一约束，第二次跑 seed 就会撞上。
        所以还是"先查后建"——和注册接口里的思路完全一样。
    """
    user = db.scalars(select(User).where(User.username == DEMO_USER["username"])).first()
    if user is None:
        user = User(
            username=DEMO_USER["username"],
            email=DEMO_USER["email"],
            hashed_password=hash_password(DEMO_USER["password"]),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"      已创建 demo 用户：{user.username} / {DEMO_USER['password']}")
    else:
        print(f"      demo 用户已存在：{user.username}（密码是你注册时那个）")
    return user


def main() -> None:
    rebuild = "--rebuild" in sys.argv

    if rebuild:
        # drop_all 会按外键依赖排序删表（先 posts 后 users），不会撞约束
        Base.metadata.drop_all(bind=engine)
        print("[0/2] 已删除 posts / users 表（表结构改动后必须重建）")

    # 建表：只建"还不存在的表"，已存在的表不动、不清数据
    Base.metadata.create_all(bind=engine)
    print("[1/2] 建表完成（已存在的表跳过）")

    # --rebuild 等于连数据一起重来，所以顺便当作 --reset 用
    reset = rebuild or "--reset" in sys.argv

    with SessionLocal() as db:
        # 阶段9：种子文章要挂在某个用户名下，/posts/mine 一跑才有数据
        demo_user = get_or_create_demo_user(db)

        if reset:
            db.execute(delete(Post))   # 2.0 风格：用 delete(模型) 生成 DELETE 语句
            db.commit()
            print("      已清空 posts 表")

        # 表里已经有数据就不再塞，避免你跑两遍变成 10 条
        already = db.execute(select(Post.id).limit(1)).first()
        if already:
            print("[2/2] posts 表已有数据，跳过（想重来加 --reset 或 --rebuild）")
            return

        db.add_all([Post(**item, author_id=demo_user.id) for item in SEED_POSTS])
        db.commit()
        print(f"[2/2] 已插入 {len(SEED_POSTS)} 条种子数据（作者：{demo_user.username}）")


if __name__ == "__main__":
    main()
