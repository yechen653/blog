"""Comment 表的数据访问层（CRUD）。

分层铁律 —— 这一层【完全不认识 HTTP】：
1. 不 import fastapi：这里没有 Depends / Query / Path / HTTPException；
2. 取不到不抛错：返回 None，由 router 决定该翻译成 404 还是别的；
3. 不认识"当前用户"：只认 author_id 这个整数主键。

对照关系：
    routers/comments.py = 接线层：路径、参数声明、校验、404/403 翻译、状态码
    services/comment.py = 业务规则层：resolve_parent_id（跨表 / 业务解释）
    crud/comment.py     = 数据层：只跟 SQLAlchemy 和 Session 打交道（本文件）
"""

from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import Comment


# 阶段10：一个"加载选项"。它不是数据，而是查询时的一条指示：
#     selectinload(Comment.author) = "查评论的时候，把 author 也一起查出来"
# 凡是"最终要把评论发给客户端"的查询，都该带上它——否则就会掉进 N+1。
LOAD_AUTHOR = selectinload(Comment.author)

# 阶段16：列表要返回"顶层评论 + 它的回复"，所以再套一层 selectinload。
#
# selectinload 可以【链式】写：selectinload(Comment.replies).selectinload(Comment.author)
# 意思是"把这些评论的回复查出来，顺便把【每条回复】的作者也查出来"。
#
# 查询次数仍然是【固定的 4 次】（顶层评论 / 作者 / 回复 / 回复的作者），
# 不会随着评论变多而增加 —— 这就是它和 N+1 的本质区别：
#     N+1 的查询次数【跟着数据量长】，预加载的查询次数【跟关系层数长】。
LOAD_TREE = (
    LOAD_AUTHOR,
    selectinload(Comment.replies).selectinload(Comment.author),
)


# ============================================================
# 一、单条读取
# ============================================================
def get(db: Session, comment_id: int) -> Optional[Comment]:
    """按主键取一条评论（连作者一起加载）。

    契约：取不到返回 None，【不抛异常】——"没有"是一个正常结果。
    要不要把它翻译成 404，是 HTTP 层的事（见 routers/comments.py 的 get_comment_or_404）。
    """
    return db.get(Comment, comment_id, options=[LOAD_AUTHOR])


def reload_comment(db: Session, comment_id: int) -> Comment:
    """写完库之后，带着作者重新查一遍再返回。

    理由和 posts.reload_post 完全一样：commit 之后 ORM 对象上的属性都"过期"了，
    直接返回它，序列化时访问 comment.author 会触发一次【隐藏的额外查询】。
    与其让它偷偷发生，不如主动查一次，顺便保证数据是最新的。
    """
    return db.scalars(
        select(Comment).where(Comment.id == comment_id).options(LOAD_AUTHOR)
    ).one()


# ============================================================
# 二、列表（分页 + 过滤）
# ============================================================
def list_by_post(
    db: Session, *, post_id: int, skip: int, limit: int
) -> tuple[int, list[Comment]]:
    """只取某篇文章的【顶层评论】（parent_id IS NULL），连同它们的回复与作者一起加载。

    返回 (顶层评论总数, 当页评论列表)。

    和 post.list_page 的两点区别：
    1. 条件从 `title ilike ...` 换成了 `post_id == ... & parent_id IS NULL` ——
       同一套分页骨架，换一个 where 条件就是一个新接口；
    2. 排序用 **正序**（`Comment.id.asc()`）：
       评论是"先来的在上面"（像对话记录），而文章列表是"新的在上面"。
       同样是分页，排序方向由业务语义决定，没有默认答案。

    分页只管顶层评论 —— 回复不单独占页，跟着顶层评论一起返回。
    所以 total 是"顶层评论条数"，不是"含回复的总条数"。
    """
    # 【本阶段的关键一行】只取顶层：parent_id IS NULL
    # `.is_(None)` 是 SQLAlchemy 里写 "IS NULL" 的标准写法。
    # 别写成 `== None` —— 它会被翻译成 SQL 的 "= NULL"，而 SQL 里 NULL 不等于任何东西
    # （连 NULL = NULL 都是假），条件永远不成立，结果就是"一条评论都查不出来"。
    condition = (Comment.post_id == post_id) & Comment.parent_id.is_(None)

    total = db.scalar(select(func.count()).select_from(Comment).where(condition)) or 0

    comments = db.scalars(
        select(Comment)
        .options(*LOAD_TREE)
        .where(condition)
        .order_by(Comment.id.asc())
        .offset(skip)
        .limit(limit)
    ).all()

    return total, list(comments)


# ============================================================
# 三、写操作
# ============================================================
def create(
    db: Session, *, content: str, post_id: int, author_id: int, parent_id: int | None
) -> Comment:
    """新建一条评论，返回带作者的完整对象。

    三个字段由【服务端自己填】，绝不让客户端传：
        post_id   来自 URL 路径 —— 挂在哪篇文章下
        author_id 来自 token    —— 以谁的名义
        parent_id 来自 services.resolve_parent_id —— 已校验 + 规范化后的值

    这正是 CommentCreate 里没有 post_id / author_id 字段的原因：
    它们从源头就不存在于请求体里，轮不到这里去过滤。
    parent_id 恰恰相反，**必须**让客户端传 —— "我回复的是哪一条"只有客户端知道；
    但我们拿到之后还要再走一遍 services 才能定下来。
    """
    comment = Comment(
        content=content,
        post_id=post_id,
        author_id=author_id,
        parent_id=parent_id,
    )

    db.add(comment)
    db.commit()
    # 同 reload_post 的道理：带着作者重新查一遍再返回
    return reload_comment(db, comment.id)


def update(db: Session, comment: Comment, *, data: dict) -> Comment:
    """局部更新：把 data 里的字段盖到 comment 上，然后提交，返回最新对象。

    收的是"已经查好、且归属已经校验过"的 comment 对象。
    它怎么来的（404？403？）这一层完全不关心 —— 那是 router 依赖的职责。

    data 由 router 用 `payload.model_dump(exclude_unset=True)` 生成，
    所以只包含"客户端真的传了"的字段 —— 不传的字段保持原值，这正是 PATCH 的语义。
    """
    for field, value in data.items():
        setattr(comment, field, value)

    db.commit()
    # 同上：带着作者重新查一遍再返回
    return reload_comment(db, comment.id)


def delete(db: Session, comment: Comment) -> None:
    """删除一条评论（收的是已经校验过归属的对象）。

    这里**不用**手动去删"它的回复"——数据库的 ON DELETE CASCADE 会【递归】处理：
        删 A → 连带删 A 的回复 B → 又连带删 B 的回复 C ……
    一条 DELETE 语句带走整棵子树。

    这也是当初在 parent_id 上选 CASCADE 而不是 SET NULL 的原因：
    一条"回复"脱离了被回复的那条评论，就失去了上下文，留着只是一条没头没尾的话。
    （对比 author_id 选了 SET NULL —— 因为"谁写的"丢了，内容本身还是完整的。）
    **同一个删除动作，字段的业务含义不同，该选的行为就不同。**
    """
    db.delete(comment)
    db.commit()