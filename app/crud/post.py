"""Post 表的数据访问层（CRUD）。

分层铁律 —— 这一层【完全不认识 HTTP】：
1. 不 import fastapi：这里没有 Depends / Query / Path / HTTPException；
2. 取不到不抛错：返回 None，由 router 决定该翻译成 404 还是别的；
3. 不认识"当前用户"：只认 author_id 这个整数主键。

对照关系：
    routers/posts.py = 接线层：声明路径与参数、做校验、定状态码、把结果包回去
    crud/post.py     = 数据层：只跟 SQLAlchemy 和 Session 打交道（本文件）
"""

from typing import Any, Optional

from sqlalchemy import func, select
# ⚠️ 这里必须起别名。本模块下面有一个【同名的 CRUD 函数】`def update(...)`：
#     直接写 `from sqlalchemy import update` 的话，`update` 会先指向 SQLAlchemy 的构造器，
#     然后在下面被 `def update(...)` 覆盖掉 —— 于是 bump_views 里的 `update(Post)`
#     调用的是我们自己的 CRUD 函数，报 `TypeError: update() missing 1 required positional argument`。
#     这就是"名字遮蔽"：上次是局部变量挡住模块名，这次是同模块的函数挡住导入名。
#     同样的隐患还有 `delete`（本模块已有 `def delete`），将来要用 SQLAlchemy 的 delete 时也要先别名。
from sqlalchemy import update as sql_update
from sqlalchemy.orm import Session, selectinload

from app.models import Post


# 阶段10：一个"加载选项"。它不是数据，而是查询时的一条指示：
#     selectinload(Post.author) = "查文章的时候，把 author 也一起查出来"
# 凡是"最终要把文章发给客户端"的查询，都该带上它——否则就会掉进 N+1。
LOAD_AUTHOR = selectinload(Post.author)


# ============================================================
# 一、单条读取
# ============================================================
def get(db: Session, post_id: int) -> Optional[Post]:
    """按主键取一篇（连作者一起加载）。

    契约：取不到返回 None，【不抛异常】——"没有"是一个正常结果。
    要不要把它翻译成 404，是 HTTP 层的事（见 routers/posts.py 的 get_post_or_404）。
    """
    # db.get(模型, 主键)：2.0 风格的"按主键查一条"，比 select+filter 短
    # 阶段10：多传一个 options，让它顺便把 author 也查出来
    return db.get(Post, post_id, options=[LOAD_AUTHOR])


def get_latest(db: Session) -> Optional[Post]:
    """取最新一篇（按 id 倒序取第一条）。取不到返回 None。"""
    return db.scalars(
        select(Post).options(LOAD_AUTHOR).order_by(Post.id.desc()).limit(1)
    ).first()


def reload_post(db: Session, post_id: int) -> Post:
    """写完库之后，重新查一遍再返回（顺带把作者一起带出来）。

    阶段10：为什么不直接 `return post`？
        commit 之后，ORM 对象的属性全都"过期"了，下次访问会重新去库里读。
        所以序列化时访问 post.author 会触发一次【隐藏的额外查询】——
        与其让它偷偷发生，不如主动、明确地查一次：
        既拿到数据库里的最新状态，又保证 author 已经加载好。

    `.one()`：要求"恰好有一条"，不满足就抛异常。
    调用它的地方都是"刚写完，肯定存在"，用它比 .first() 更能暴露异常情况。

    注意它和上面 `get` 的区别不是"重复"，而是【失败语义相反】：
        get        → 取不到返回 None（把"没有"交给调用方处置）
        reload_post → 取不到当场抛异常（因为调用场景是"刚写完，必然存在"，炸出来就是 bug）
    """
    return db.scalars(
        select(Post).where(Post.id == post_id).options(LOAD_AUTHOR)
    ).one()


# ============================================================
# 二、列表（分页 + 过滤）
# ============================================================
def list_page(
    db: Session,
    *,
    skip: int,
    limit: int,
    q: Optional[str] = None,
    published: Optional[bool] = None,
) -> tuple[int, list[Post]]:
    """分页查文章，返回 (总数, 当页列表)。

    注意参数形态：收的是 skip / limit / q / published 这些【普通值】，
    既不是 PaginationParams 依赖、也不是 Query(...) ——
    因为校验（ge=0、min_length=1）已经在 router 的签名上做完了，
    这一层假设传进来的值全都合法。

    `*` 强制 skip / limit / q / published 用关键字传，
    防的正是调用方把 skip 和 limit 位置写反（这个错误真会发生，且症状是"分页悄悄错位"）。
    """
    # 1) 把"要满足的条件"攒起来，后面总数和取数据用同一套条件
    conditions = []
    if q:
        # ilike = 不区分大小写的 LIKE。q 是"参数"不是拼进 SQL 的字符串 → 天然防 SQL 注入
        conditions.append(Post.title.ilike(f"%{q}%"))
    if published is not None:
        conditions.append(Post.published == published)

    # 2) 总数：让数据库去数（count(*)），别把所有行捞回 Python 再 len()
    count_stmt = select(func.count()).select_from(Post)
    if conditions:
        count_stmt = count_stmt.where(*conditions)   # *conditions = 多个条件用 AND 连起来
    total = db.scalar(count_stmt) or 0

    # 3) 取当页数据：排序 + 偏移 + 限制，全都交给数据库做（真分页）
    #    阶段10：加上 options(LOAD_AUTHOR)，"取 10 篇文章"一共只查 2 次库
    #    （一次取文章，一次把这 10 篇涉及到的作者一起取回来），而不是 1+10 次。
    stmt = (
        select(Post)
        .options(LOAD_AUTHOR)
        .order_by(Post.id)
        .offset(skip)
        .limit(limit)
    )
    if conditions:
        stmt = stmt.where(*conditions)
    # scalars() 表示"结果每行只取第一个字段"，拿回来直接是 Post 对象列表
    posts = db.scalars(stmt).all()

    # 返回的是完整 Post 对象，至于"列表页只需要其中几个字段"，
    # 那是 response_model=PostPage 该管的事（见 router），不在这层裁剪。
    return total, list(posts)


def list_by_author(
    db: Session, *, author_id: int, skip: int, limit: int
) -> tuple[int, list[Post]]:
    """只查某个作者的文章，返回 (总数, 当页列表)。

    参数是 `author_id: int`，而不是 `current_user: User` ——
    "当前用户是谁"是 HTTP 概念（来自请求头的 token），到这一层已经降解成一个整数主键。
    这就是分层最有价值的一处体现：数据层【不需要知道有"登录"这回事】。
    """
    condition = Post.author_id == author_id

    total = db.scalar(select(func.count()).select_from(Post).where(condition)) or 0
    posts = db.scalars(
        select(Post)
        .options(LOAD_AUTHOR)          # 阶段10：连作者一起查
        .where(condition)
        .order_by(Post.id.desc())      # 新的在前（注意：列表接口是升序，这里是降序）
        .offset(skip)
        .limit(limit)
    ).all()

    return total, list(posts)


# ============================================================
# 三、写操作
# ============================================================
def create(db: Session, *, data: dict[str, Any], author_id: int) -> Post:
    """新建一篇文章，返回带作者的完整对象。

    阶段9：author_id 必须由【服务端】传进来（router 传 current_user.id），
    绝不从请求体取——否则用户只要发 {"title":"x","author_id":1}
    就能把文章栽赃给别人（越权赋值 / mass assignment）。
    这也正是 schemas 里 PostCreate 【没有】author_id 字段的原因：
    它从源头就不存在于请求体里，轮不到这里去过滤。
    """
    # data 由 router 用 payload.model_dump() 生成，正好能用 ** 解包给 ORM 类当关键字参数
    post = Post(**data, author_id=author_id)

    db.add(post)      # 放进会话（此时还没写库）
    db.commit()       # 提交事务 → 这才真正执行 INSERT
    # 阶段10：原来这里是 db.refresh(post)，现在换成"带着作者重新查一遍"。
    # 效果一样（都是拿数据库里的最新状态，id / created_at / updated_at 都在），
    # 额外好处是 author 也顺手加载好了。
    return reload_post(db, post.id)


def update(db: Session, post: Post, *, data: dict[str, Any]) -> Post:
    """局部更新：把 data 里的字段盖到 post 上，然后提交，返回最新对象。

    收的是"已经查好、且归属已经校验过"的 post 对象。
    它怎么来的（404？403？）这一层完全不关心 —— 那是 router 依赖的职责。

    data 由 router 用 `payload.model_dump(exclude_unset=True)` 生成，
    所以只包含"客户端真的传了"的字段 —— 不传的字段保持原值，这正是 PATCH 的语义。
    """
    for field, value in data.items():
        setattr(post, field, value)

    db.commit()
    # 同上：带着作者重新查一遍再返回
    return reload_post(db, post.id)


def delete(db: Session, post: Post) -> None:
    """删除一篇文章（收的是已经校验过归属的对象）。"""
    db.delete(post)   # 标记删除
    db.commit()       # 提交后才真正 DELETE


def bump_views(db: Session, post: Post) -> None:
    """把一篇文章的浏览量 +1。这是一个【写动作】，只有写接口才该调用它。

    为什么用 `update(...).values(views=Post.views + 1)`，而不是直觉的 `post.views += 1`？

    【❌ 直觉写法】post.views += 1; db.commit()
      它在 Python 里做"读 → 加 → 写"三步，生成的是 `UPDATE posts SET views = 6`（写死具体数字）。
      两个请求同时读到 5 → 各自写 6 → 实际被看了 7 次，库里却是 6。数据就这么丢了。
      这类 bug 叫【丢失更新】，本地单机测永远正常，一上量才暴露。

    【✅ 正确写法】让【数据库自己】做这次加法：
          UPDATE posts SET views = views + 1 WHERE id = ?
      加法的读和写在数据库内部一次完成，InnoDB 对这行本来就有行锁，天然算不错。

    注意 `Post.views + 1` 里的 `+` 【不是 Python 加法】：
      Post.views 是"列对象"，它实现了 __add__ 魔术方法，`+ 1` 造出来的是一个
      SQL 表达式对象（内容就是 `posts.views + 1` 这段 SQL），绝不是先在 Python 里算好一个数。
      同一个加号，加在"数字"上是 Python 算，加在"列"上是交给数据库算 —— 这是新东西。

    事务边界：commit 放在函数【里面】，调用方不用记着提交。
      代价是"这个动作没法再和别的写操作并进同一个事务"——本项目不需要，够用。
    """
    db.execute(sql_update(Post).where(Post.id == post.id).values(views=Post.views + 1))
    db.commit()
