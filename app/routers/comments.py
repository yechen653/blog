"""评论接口：列表（分页）/ 新建 / 改 / 删（阶段15）。

【路径怎么设计】
    /posts/{post_id}/comments   ← 评论【从属于】一篇文章，嵌套路径直接把这层关系写进 URL
    /comments/{comment_id}      ← 但"改 / 删某一条评论"时，id 已经能唯一定位它了，
                                   不必再带上文章 id（带上反而多一道"两者是否匹配"的校验）

所以本文件里有两组【不同的路径前缀】—— 这就是 router 不设 prefix 的原因：
一个 APIRouter 只能有一个 prefix，不够用时不设，路径手写全即可。
（posts.py 能用 prefix="/posts"，是因为它所有接口都在同一个前缀下。）

═══════════════════════════════════════════════════════════════
本阶段把"数据动作"抽去了 crud 层、resolve_parent_id 抽去了 services 层，
本文件的定位变纯粹了：

    本文件（接线层）：路径、参数声明、校验、404/403 翻译、状态码
    app/crud/comment.py（数据层）：select / db.add / setattr / commit
    app/services/comment.py（业务规则层）：resolve_parent_id（父评论校验 + 规范化）

判据一句话：**凡是出现 Depends / Query / Path / Body / Request /
HTTPException / APIRouter 的行，都留在本文件。**
反过来，crud / services 那层里出现这些词，就说明它被污染了。
═══════════════════════════════════════════════════════════════
"""

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import PaginationParams, get_current_active_user
from app.crud import comment as comment_crud
from app.models import Comment, Post, User
from app.routers.posts import get_post_or_404
from app.schemas import CommentCreate, CommentPage, CommentRead, CommentUpdate
from app.services.comment import resolve_parent_id

# 【关于上面这行 import】
#   "评论必须挂在一篇真实存在的文章下"这个校验，和文章详情接口要的完全一样，
#   所以直接把 posts.py 的依赖借过来用，不重写一份。
#
#   注意方向是【单向】的：comments → posts。posts.py 不会反过来 import 本模块，
#   所以不存在循环导入。
#   判据：只要是"被依赖方不知道依赖方的存在"，这种跨模块 import 就是安全的。
#   ——真正要躲开的是 A import B、B 又 import A 这种环。

router = APIRouter(tags=["comments"])

COMMENT_NOT_FOUND = {404: {"description": "评论不存在"}}


def get_comment_or_404(
    comment_id: int = Path(..., ge=1, description="评论 id，必须 ≥ 1"),
    db: Session = Depends(get_db),
) -> Comment:
    """依赖版"按 id 取评论"：取不到就地 404。

    形状和 posts.py 的 get_post_or_404 一模一样 —— 这就是阶段6 那节课的回报：
    新增一种资源，把上一份依赖改个模型名就完事，接口函数里永远不写判空。

    分层后它的身体只剩两件事：
        · 让 crud 去查（它只回答"库里有没有"）；
        · 自己把 None 翻译成 404（"没有的话怎么告诉客户端"是 HTTP 层的事）。
    名字里的 "404" 就已经宣告了它的层籍——所以它【不能】搬去 crud。
    """
    comment = comment_crud.get(db, comment_id)
    if comment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"comment {comment_id} not found",
        )
    return comment


def get_own_comment_or_404(
    comment: Comment = Depends(get_comment_or_404),
    current_user: User = Depends(get_current_active_user),
) -> Comment:
    """改 / 删自己的评论：不存在 → 404，不是你的 → 403。

    和 get_own_post_or_404 同一套路。author_id 可能是 None（作者已注销），
    而 current_user.id 永远不是 None，所以用 != 比较是安全的：
    **无主评论对任何人都算"不是你的"**，谁也改不了。
    """
    if comment.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"comment {comment.id} belongs to another user",
        )
    return comment


@router.get(
    "/posts/{post_id}/comments",
    response_model=CommentPage,
    summary="某篇文章的评论列表（分页）",
    responses=COMMENT_NOT_FOUND,
)
def list_comments(
    # 复用文章的 404 依赖：文章不存在就直接 404，不用自己写一遍
    post: Post = Depends(get_post_or_404),
    pagination: PaginationParams = Depends(PaginationParams),
    db: Session = Depends(get_db),
):
    """公开接口，不需要登录。

    沿用文章列表那套"三段式"：攒条件 → 让【数据库】数总数 → 取当页。
    和新东西相比，这里值得注意的只有两点：

    1. 条件从 `title ilike ...` 换成了 `post_id == ... & parent_id IS NULL` ——
       **同一套分页骨架，换一个 where 条件就是一个新接口**，这是阶段6 抽依赖的意义；
    2. 排序用 **正序**（`Comment.id.asc()`）：
       评论是"先来的在上面"（像对话记录），而文章列表是"新的在上面"。
       同样是分页，排序方向由业务语义决定，没有默认答案。

    阶段16 加了回复之后，多一条规矩：**分页只管顶层评论**。
    回复不单独占页，它们跟着自己的顶层评论一起返回（由 crud 层挂 LOAD_TREE 负责）。
    所以这个接口的 total 是"顶层评论条数"，不是"含回复的总条数"。

    分层后这个函数体内【没有一行 select / db.scalars】——所有 SQL 都下沉到了 crud。
    router 只管"收参数 → 翻译 → 调 crud → 按 CommentPage 的形状包回去"。
    """
    total, items = comment_crud.list_by_post(
        db, post_id=post.id, skip=pagination.skip, limit=pagination.limit
    )

    return {
        "total": total,
        "skip": pagination.skip,
        "limit": pagination.limit,
        "items": items,
    }


@router.post(
    "/posts/{post_id}/comments",
    response_model=CommentRead,
    status_code=status.HTTP_201_CREATED,   # 201 = 创建成功
    summary="发表评论或回复",
    responses=COMMENT_NOT_FOUND,
)
def create_comment(
    payload: CommentCreate,                              # 无默认值 → 必须排在前面
    post: Post = Depends(get_post_or_404),               # 哪篇文章（顺带 404 校验）
    current_user: User = Depends(get_current_active_user),  # 谁在发（401 / 403 校验）
    db: Session = Depends(get_db),
):
    """发表评论 or 回复（需要登录）—— 同一个接口，区别只在有没有传 parent_id。

    两个字段由【服务端自己填】，绝不让客户端传：
        post_id   来自 URL 路径 —— 挂在哪篇文章下
        author_id 来自 token    —— 以谁的名义

    这正是 CommentCreate 里没有这两个字段的原因（和 PostCreate 不带 author_id 同理）。
    而 parent_id 恰恰相反，**必须**让客户端传 —— "我回复的是哪一条"只有客户端知道；
    但拿到之后还要再走一遍 services.resolve_parent_id 才能定下来。

    【为什么不像 Post 那样再开一个 POST /comments/{id}/replies 接口？】
        创建一条回复和创建一条评论，除了 parent_id 之外没有区别：
        同一个 URL 前缀（都属于这篇文章）、同一套校验、同一个响应模型。
        多开一个接口只会把同一段逻辑抄两遍 —— **用可选字段表达的"变体"，
        不该升级成"新接口"**。真正的分界线是：数据形状变了没有？这里没有。

    分层后的典型形态：
        1. router 调 services.resolve_parent_id —— 业务规则
        2. router 调 crud.comment.create   —— 数据写入
        3. crud 内部完成 reload_comment，带着作者返回
    """
    # 阶段16：parent_id 要先过一遍 services 的"校验 + 规范化"（可能被"提"到顶层评论）
    parent_id = resolve_parent_id(db, payload.parent_id, post)

    return comment_crud.create(
        db,
        content=payload.content,
        post_id=post.id,            # 路径给的
        author_id=current_user.id,  # token 给的
        parent_id=parent_id,        # services 规范化之后的结果
    )


@router.patch(
    "/comments/{comment_id}",
    response_model=CommentRead,
    summary="修改评论",
    responses=COMMENT_NOT_FOUND,
)
def update_comment(
    payload: CommentUpdate,
    comment: Comment = Depends(get_own_comment_or_404),
    db: Session = Depends(get_db),
):
    """改自己的评论。PATCH 语义：不传的字段保持原值。

    分层后这里只剩"把字段交给 crud"，任何 setattr / commit 都搬走了。
    """
    return comment_crud.update(db, comment, data=payload.model_dump(exclude_unset=True))


@router.delete(
    "/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,   # 204 = 成功但没有响应体
    summary="删除评论",
    responses=COMMENT_NOT_FOUND,
)
def delete_comment(
    comment: Comment = Depends(get_own_comment_or_404),
    db: Session = Depends(get_db),
):
    """删自己的评论。归属已经由依赖校验过，这里只管交给 crud。

    删除的具体行为（连带删回复）由数据库的 ON DELETE CASCADE 接手，
    详见 crud/comment.py 里 delete 的注释。
    """
    comment_crud.delete(db, comment)
    # 204 不能有响应体，所以这里不 return 任何东西