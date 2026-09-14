"""评论与回复测试：树形结构、规范化、跨文章校验、级联删除。

这组测试盯住的东西有个共同特点：**出错了也不会报错**。

    · 跨文章回复写进库     → 数据看着好好的，只是那条评论在任何地方都看不见
    · 规范化漏了           → 树变成三层，页面照常显示，只是越缩越窄
    · 级联删除没生效       → 删了父评论，回复变成查不到的孤儿

这类"静默腐败"靠手工点页面几乎发现不了，正是自动化测试的主场。
"""

from sqlalchemy import select

from app.models import Comment


def comments_url(post) -> str:
    return f"/posts/{post.id}/comments"


# ══════════════════════════════════════════════════════════════
# 一、发表（顶层评论）
# ══════════════════════════════════════════════════════════════
def test_list_comments_is_public(client, make_post, make_comment, alice):
    post = make_post(alice)
    make_comment(post, alice)

    assert client.get(comments_url(post)).status_code == 200


def test_create_comment_requires_login(client, make_post, alice):
    post = make_post(alice)

    resp = client.post(comments_url(post), json={"content": "你好"})

    assert resp.status_code == 401


def test_create_top_level_comment(client, make_post, alice, auth):
    post = make_post(alice)

    resp = client.post(
        comments_url(post), json={"content": "第一条"}, headers=auth(alice)
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["content"] == "第一条"
    assert data["post_id"] == post.id       # 来自 URL 路径
    assert data["author_id"] == alice.id    # 来自 token
    assert data["parent_id"] is None        # 不传 parent_id = 顶层评论


def test_client_cannot_forge_author_id(client, make_post, alice, bob, auth):
    """和文章那条同理：author_id 不在 CommentCreate 里，传了也会被丢掉。"""
    post = make_post(alice)

    resp = client.post(
        comments_url(post),
        json={"content": "冒名", "author_id": bob.id},
        headers=auth(alice),
    )

    assert resp.status_code == 201
    assert resp.json()["author_id"] == alice.id


def test_comment_author_is_summary_without_email(client, make_post, alice, auth):
    """⭐ 评论列表是**完全公开**的，绝不能把 email 撒出去。

    `CommentRead.author` 的类型是 UserSummary（只有 id + username）——
    这张"精简版名片"存在的唯一意义就是这里。
    断言用 set 比较，可以顺带发现"有人往 UserSummary 里加了个字段"。
    """
    post = make_post(alice)
    client.post(comments_url(post), json={"content": "你好"}, headers=auth(alice))

    author = client.get(comments_url(post)).json()["items"][0]["author"]

    assert set(author) == {"id", "username"}


def test_create_comment_on_missing_post_returns_404(client, alice, auth):
    resp = client.post("/posts/999999/comments", json={"content": "x"}, headers=auth(alice))

    assert resp.status_code == 404


def test_list_comments_of_missing_post_returns_404(client):
    assert client.get("/posts/999999/comments").status_code == 404


# ══════════════════════════════════════════════════════════════
# 二、内容校验
# ══════════════════════════════════════════════════════════════
def test_empty_comment_rejected(client, make_post, alice, auth):
    post = make_post(alice)

    resp = client.post(comments_url(post), json={"content": ""}, headers=auth(alice))

    assert resp.status_code == 422


def test_comment_too_long_rejected(client, make_post, alice, auth):
    """max_length=1000 在进库之前拦下 —— 数据库那一列是 TEXT（不设上限）。

    这个分工值得记住：**数据库留宽松，限制由接口层管**。
    将来想放宽到 2000 字，改一行 Pydantic 就行，不用动表结构。
    """
    post = make_post(alice)

    resp = client.post(comments_url(post), json={"content": "x" * 1001}, headers=auth(alice))

    assert resp.status_code == 422


# ══════════════════════════════════════════════════════════════
# 三、回复
# ══════════════════════════════════════════════════════════════
def test_reply_to_top_level_comment(client, make_post, make_comment, alice, bob, auth):
    post = make_post(alice)
    top = make_comment(post, alice)

    resp = client.post(
        comments_url(post),
        json={"content": "回复你", "parent_id": top.id},
        headers=auth(bob),
    )

    assert resp.status_code == 201
    assert resp.json()["parent_id"] == top.id


def test_reply_to_a_reply_is_normalized_to_top(client, make_post, make_comment, alice, bob, auth):
    """⭐ 规范化：回复"一条回复"时，会被挂到那棵树的**顶层评论**下。

    客户端传的是 reply.id，存进去的必须是 top.id。
    这样库里**永远只有两层**，列表查询和前端渲染都不用递归。

    注意这个限制不是靠前端自觉，是在服务端入口强制的 ——
    前端可以被绕过（curl 一下就绕过去了）。
    """
    post = make_post(alice)
    top = make_comment(post, alice)
    reply = make_comment(post, bob, parent=top)

    resp = client.post(
        comments_url(post),
        json={"content": "回复那条回复", "parent_id": reply.id},
        headers=auth(alice),
    )

    assert resp.status_code == 201
    assert resp.json()["parent_id"] == top.id        # 不是 reply.id


def test_parent_id_zero_rejected(client, make_post, alice, auth):
    """`ge=1` 在查库之前就拦下。

    注意这里是 422（参数校验失败）而不是 400 ——
    因为它连"参数合不合法"这一关都没过，压根没进入业务逻辑。
    """
    post = make_post(alice)

    resp = client.post(
        comments_url(post), json={"content": "x", "parent_id": 0}, headers=auth(alice)
    )

    assert resp.status_code == 422


def test_reply_to_missing_parent_returns_400(client, make_post, alice, auth):
    post = make_post(alice)

    resp = client.post(
        comments_url(post), json={"content": "x", "parent_id": 999999}, headers=auth(alice)
    )

    assert resp.status_code == 400


def test_reply_across_posts_returns_400(client, make_post, make_comment, alice, bob, auth):
    """⭐⭐ 跨文章回复必须在入口拦住（本组最值钱的一条）。

    假设不拦，会写进一条什么样子的数据？
        post_id   = B  （URL 路径给的）
        parent_id = A 文章下那条评论的 id

    这条数据**不违反任何约束**，数据库欣然接受。然后呢？
        · 查 B 文章的评论列表 → 按 post_id 过滤，能找到它（但它的父不在 B 下）
          预加载 replies 时按 parent_id 找 → 找不到它 → 它不出现
        · 查 A 文章的列表 → 它的 post_id 是 B，压根不在结果里

    **它在任何一篇文章下都看不见。** 数据没报错，只是悄悄消失了 ——
    这类 bug 一旦发生，你只会收到"用户说评论发了但看不到"这种无从下手的反馈。
    """
    post_a = make_post(alice, title="A 文章")
    post_b = make_post(alice, title="B 文章")
    comment_in_a = make_comment(post_a, alice, content="A 下的评论")

    resp = client.post(
        comments_url(post_b),                       # 发到 B 文章下
        json={"content": "跨文章回复", "parent_id": comment_in_a.id},   # 却想回复 A 下的评论
        headers=auth(bob),
    )

    assert resp.status_code == 400


def test_reply_to_comment_of_another_post_is_never_stored(
    client, make_post, make_comment, db, alice, bob, auth
):
    """上面的反面确认：拦下来之后，库里**不能**留下任何痕迹。"""
    post_a = make_post(alice, title="A 文章")
    post_b = make_post(alice, title="B 文章")
    comment_in_a = make_comment(post_a, alice)

    client.post(
        comments_url(post_b),
        json={"content": "跨文章回复", "parent_id": comment_in_a.id},
        headers=auth(bob),
    )

    stored = db.scalars(select(Comment).where(Comment.post_id == post_b.id)).all()
    assert stored == []


# ══════════════════════════════════════════════════════════════
# 四、列表的树形结构（含 total 的语义）
# ══════════════════════════════════════════════════════════════
def test_list_returns_two_level_tree(client, make_post, make_comment, alice, bob):
    post = make_post(alice)
    top = make_comment(post, alice, content="顶层")
    make_comment(post, bob, content="回复一", parent=top)

    data = client.get(comments_url(post)).json()

    assert data["total"] == 1
    assert len(data["items"]) == 1
    assert data["items"][0]["content"] == "顶层"
    assert [r["content"] for r in data["items"][0]["replies"]] == ["回复一"]


def test_replies_are_not_counted_in_total(client, make_post, make_comment, alice, bob):
    """⭐ `total` 的语义：**顶层评论条数**，不含回复。

    为什么不含？因为分页是对顶层分的，一条顶层评论不管带多少回复，
    都只在第 1 页出现一次。

    这个语义是**必须在文档里写清楚**的那种细节 ——
    不写清楚，前端一定会把它当"总留言数"显示，于是出现
    "共 1 条评论"下面挂着 2 条回复的诡异现象。
    """
    post = make_post(alice)
    top = make_comment(post, alice)
    make_comment(post, bob, parent=top)
    make_comment(post, bob, parent=top)

    data = client.get(comments_url(post)).json()

    assert data["total"] == 1                        # 不是 3
    assert len(data["items"][0]["replies"]) == 2


def test_replies_do_not_take_a_page_slot(client, make_post, make_comment, alice, bob):
    """回复不占分页名额：limit=1 时一页 1 条顶层，但它的回复全都跟着来。

    如果实现里忘了 `parent_id IS NULL` 那个条件，回复会自己占一格 ——
    于是"一页 10 条"里全是零碎的回复，顶层评论反而翻不到。
    """
    post = make_post(alice)
    top1 = make_comment(post, alice, content="顶层1")
    make_comment(post, bob, parent=top1)
    make_comment(post, alice, content="顶层2")

    data = client.get(f"{comments_url(post)}?limit=1").json()

    assert data["total"] == 2          # 两条顶层
    assert len(data["items"]) == 1     # 当页只有一条
    assert len(data["items"][0]["replies"]) == 1   # 但它的回复跟来了


def test_comments_are_ordered_by_id_ascending(client, make_post, make_comment, alice):
    """评论正序（先来的在上），和文章列表（新的在上）相反。

    排序方向由业务语义决定，没有默认答案 —— 测试把它固定下来。
    """
    post = make_post(alice)
    make_comment(post, alice, content="第一条")
    make_comment(post, alice, content="第二条")

    contents = [c["content"] for c in client.get(comments_url(post)).json()["items"]]

    assert contents == ["第一条", "第二条"]


# ══════════════════════════════════════════════════════════════
# 五、修改与删除（越权）
# ══════════════════════════════════════════════════════════════
def test_patch_own_comment(client, make_post, make_comment, alice, auth):
    post = make_post(alice)
    comment = make_comment(post, alice, content="旧内容")

    resp = client.patch(
        f"/comments/{comment.id}", json={"content": "新内容"}, headers=auth(alice)
    )

    assert resp.status_code == 200
    assert resp.json()["content"] == "新内容"


def test_patch_others_comment_returns_403(client, make_post, make_comment, alice, bob, auth):
    post = make_post(alice)
    comment = make_comment(post, alice)

    resp = client.patch(f"/comments/{comment.id}", json={"content": "改"}, headers=auth(bob))

    assert resp.status_code == 403


def test_comment_cannot_be_moved_to_another_post(
    client, make_post, make_comment, alice, auth
):
    """CommentUpdate 里**没有 post_id** —— 传了也会被忽略。

    把一条评论"搬家"到别的文章下，产品上几乎不会有这个操作；
    真需要时就该删了重发。**契约里的字段越少，能出错的地方越少。**
    （同理也没有 parent_id：一棵子树整体搬家更危险。）
    """
    post_a = make_post(alice, title="A 文章")
    post_b = make_post(alice, title="B 文章")
    comment = make_comment(post_a, alice)

    data = client.patch(
        f"/comments/{comment.id}",
        json={"content": "改个内容", "post_id": post_b.id, "parent_id": None},
        headers=auth(alice),
    ).json()

    assert data["post_id"] == post_a.id      # 没被搬走


def test_delete_others_comment_returns_403(client, make_post, make_comment, db, alice, bob, auth):
    post = make_post(alice)
    comment = make_comment(post, alice)

    assert client.delete(f"/comments/{comment.id}", headers=auth(bob)).status_code == 403
    assert db.get(Comment, comment.id) is not None


# ══════════════════════════════════════════════════════════════
# 六、级联删除 ⭐（这组只有真数据库能测出来）
# ══════════════════════════════════════════════════════════════
def test_deleting_top_comment_takes_its_replies(client, make_post, make_comment, db, alice, bob, auth):
    """⭐ 删一条顶层评论，它下面的回复被**数据库递归**带走。

    注意：接口代码里没有一行"删回复"的逻辑（`db.delete(comment)` 只删了一条）。
    真正干活的是 parent_id 上的 `ON DELETE CASCADE` ——
    这是**数据库行为，不是 ORM 行为**。

    这也是为什么测试必须用真 MySQL 而不是 SQLite / mock：
    换成假的，这条测试就什么都证明不了。
    """
    post = make_post(alice)
    top = make_comment(post, alice, content="顶层")
    make_comment(post, bob, parent=top)
    make_comment(post, alice, parent=top)

    assert client.delete(f"/comments/{top.id}", headers=auth(alice)).status_code == 204

    assert client.get(comments_url(post)).json()["total"] == 0
    assert db.scalars(select(Comment).where(Comment.post_id == post.id)).all() == []


def test_deleting_top_comment_spares_siblings(client, make_post, make_comment, alice, bob, auth):
    """只带走自己那棵子树，兄弟节点不能被误伤。

    （如果没有这半条，上面那条测试用"把整篇文章的评论全删了"也能通过。）
    """
    post = make_post(alice)
    doomed = make_comment(post, alice, content="要被删的")
    survivor = make_comment(post, alice, content="要活下来的")
    make_comment(post, bob, parent=doomed)

    client.delete(f"/comments/{doomed.id}", headers=auth(alice))

    data = client.get(comments_url(post)).json()
    assert data["total"] == 1
    assert data["items"][0]["id"] == survivor.id


def test_deleting_post_cascades_to_comments_and_replies(
    client, make_post, make_comment, db, alice, bob, auth
):
    """⭐ 删文章 → 顶层评论 → 回复，**两级 CASCADE 接力**。

    这里有两张表各自的外键规则在配合：
        comments.post_id    → ON DELETE CASCADE   （文章没了，评论没意义）
        comments.parent_id  → ON DELETE CASCADE   （父评论没了，回复没意义）
    只发了一条 `DELETE /posts/{id}`，数据库自己把连锁反应走完了。
    """
    post = make_post(alice)
    top = make_comment(post, alice)
    make_comment(post, bob, parent=top)

    assert client.delete(f"/posts/{post.id}", headers=auth(alice)).status_code == 204

    assert db.scalars(select(Comment).where(Comment.post_id == post.id)).all() == []


def test_comment_survives_author_deletion(client, make_post, make_comment, db, alice, bob):
    """⭐ 作者注销后，评论**留着**，只是作者变 None —— 和上面两条正好对照。

    同一个"指向用户的字段"，两张表选了两种删除行为，因为业务期待不同：

        comments.post_id   → CASCADE   （评论离开文章就没意义了）
        comments.author_id → SET NULL  （"谁写的"丢了，内容本身还是完整的）

    接口代码里同样没有一行处理它 —— 全靠数据库的 ON DELETE SET NULL。
    前端把 author 为 None 的显示成"已注销用户"，评论照常可读。
    """
    post = make_post(alice)
    make_comment(post, bob, content="我写的评论")

    db.delete(bob)
    db.commit()

    data = client.get(comments_url(post)).json()

    assert data["total"] == 1                          # 评论还在
    item = data["items"][0]
    assert item["content"] == "我写的评论"              # 内容完整
    assert item["author_id"] is None                   # 但作者没了
    assert item["author"] is None


def test_ownerless_comment_cannot_be_modified(client, make_post, make_comment, db, alice, bob, auth):
    """作者注销后（author_id = None），这条评论对任何人都算"不是你的"。"""
    post = make_post(alice)
    comment = make_comment(post, bob)

    db.delete(bob)
    db.commit()

    assert client.patch(f"/comments/{comment.id}", json={"content": "x"}, headers=auth(alice)).status_code == 403
