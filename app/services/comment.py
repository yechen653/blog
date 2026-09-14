"""评论相关的业务规则。

凡是"涉及多张表、或者写起来跨好几步的事"都放在这里；
纯粹的"读 / 写一条记录"那种简单活留在 crud。
"""
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import Comment, Post


def resolve_parent_id(db: Session, parent_id: int | None, post: Post) -> int | None:
    """把客户端传来的 parent_id 【校验 + 规范化】之后，才允许写进库。

    它干三件事：

    1. **父评论必须存在** —— 不存在的 id 不能写进外键（写了数据库会甩一个
       IntegrityError 出来，那是 500 级别的错误）。
    2. **父评论必须属于同一篇文章** —— 否则会出现"B 文章的评论回复了 A 文章的评论"。
       这种数据一写进去就出事：评论列表是按 post_id 查的，
       那条回复从此在任何一篇文章下都【看不见】，成了孤儿。
       这种"看起来没问题、数据一旦坏掉就悄悄丢内容"的坑，要在入口拦住。
    3. **规范化：把"回复的回复"提到顶层**。
       客户端回复一条回复时，parent 自己也带 parent_id；我们直接改用
       `parent.parent_id or parent.id`，也就是挂到那棵树的【顶层评论】下。
       这样库里永远只有两层，列表查询和前端渲染都不用递归。
       （`or` 的用法：parent.parent_id 是 None 时取 parent.id —— id 从 1 开始，
        绝不会是 0，所以这里用 `or` 是安全的。）

    为什么非法时回 **400 而不是 404**？
        parent_id 是**请求体里的字段**，它是"你给的参数不合法"（400 Bad Request），
        不是"你请求的路径资源不存在"（404）。路径里的 /posts/{id} 才是 404 那一类。
        分清楚这一点，接口的报错才对调用方有用。

    顺带一个小好处：非法时给 404 也能用，但 400 的语义更准；
    而且两种失败（不存在 / 不在同一文章）合并成一条消息，
    不会泄露"别篇文章下有没有 id=5 这条评论"。

    为什么这个函数放在 services 而不是 crud？
        它同时干了两件事：
            · 查 parent 是否存在 —— 这是 crud 风格的"取一条"
            · 决定"父评论必须同属一篇文章 + 把回复的回复提到顶层" —— 这是业务规则
        后半条不属于 crud（crud 不解释业务），所以这个组合放在 services。
        上一轮 crud/post.py 那句"出现 Depends / HTTPException 的行都搬走"在这里换成：
        **"凡是含 'if / 校验' 多个分支、且涉及业务解释的函数，就放在 services。"**
    """
    if parent_id is None:
        return None

    parent = db.get(Comment, parent_id)
    if parent is None or parent.post_id != post.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"parent comment {parent_id} not found under post {post.id}",
        )

    return parent.parent_id or parent.id