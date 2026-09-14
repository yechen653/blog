"""文章测试：CRUD + 越权 + 分页 + 搜索 + 浏览量。

这是最大的一组，因为 posts 是贯穿全项目的"主干资源"——
从阶段4（请求体）到阶段14（Redis 防刷）的技术点全都落在它身上。
所以这组测试同时也是**前面所有阶段的回归网**。
"""

from app.models import Post

POSTS = "/posts"


# ══════════════════════════════════════════════════════════════
# 一、新建
# ══════════════════════════════════════════════════════════════
def test_create_post_requires_login(client):
    """写操作要登录 —— 这道门是**依赖**装的，检查发生在函数体之前。"""
    resp = client.post(POSTS, json={"title": "标题", "content": "正文"})

    assert resp.status_code == 401


def test_create_post_returns_201_with_author(client, alice, auth):
    resp = client.post(
        POSTS, json={"title": "标题", "content": "正文"}, headers=auth(alice)
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["author_id"] == alice.id
    assert data["author"]["username"] == "alice"
    assert data["published"] is False     # 契约里的默认值：不传就是草稿
    assert data["views"] == 0             # 数据库 server_default="0"
    assert data["id"] > 0


def test_create_post_ignores_client_supplied_author_id(client, alice, bob, auth):
    """⭐ 越权赋值（mass assignment）防线。

    请求体里塞一个 author_id，服务端必须**无视**它。
    不然只要发一句 {"title":"x","content":"y","author_id":<别人的 id>}
    就能把文章栽赃给别人。

    这道防线不是靠"记得别读这个字段"，而是靠 **PostCreate 里根本没有这个字段**
    —— 契约里不存在的字段，Pydantic 默认直接丢掉，压根到不了业务代码。
    """
    resp = client.post(
        POSTS,
        json={"title": "栽赃", "content": "正文", "author_id": bob.id},
        headers=auth(alice),
    )

    assert resp.status_code == 201
    assert resp.json()["author_id"] == alice.id      # 仍然是当前登录用户，不是 bob


def test_create_post_rejects_empty_title(client, alice, auth):
    resp = client.post(POSTS, json={"title": "", "content": "正文"}, headers=auth(alice))

    assert resp.status_code == 422


def test_create_post_rejects_missing_content(client, alice, auth):
    resp = client.post(POSTS, json={"title": "只有标题"}, headers=auth(alice))

    assert resp.status_code == 422


# ══════════════════════════════════════════════════════════════
# 二、详情
# ══════════════════════════════════════════════════════════════
def test_get_post_detail_is_public(client, make_post, alice):
    """读接口保持公开 —— 不带 token 也能看。"""
    post = make_post(alice, title="你好", content="世界")

    resp = client.get(f"{POSTS}/{post.id}")

    assert resp.status_code == 200
    assert resp.json()["content"] == "世界"


def test_get_missing_post_returns_404(client):
    resp = client.get(f"{POSTS}/999999")

    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"]


def test_post_id_zero_is_rejected_by_path_validation(client):
    """路径参数上的 ge=1：明显算错的 id 直接 422，连查库都不用。

    （注意区分：`/posts/0` 是"参数不合法"→422；
      `/posts/999999` 是"参数合法但资源不存在"→404。）
    """
    assert client.get(f"{POSTS}/0").status_code == 422


# ══════════════════════════════════════════════════════════════
# 三、列表：分页 / 搜索 / 过滤
# ══════════════════════════════════════════════════════════════
def test_list_posts_is_public(client, make_post, alice):
    make_post(alice)

    assert client.get(POSTS).status_code == 200


def test_list_posts_returns_envelope(client, make_post, alice):
    for _ in range(3):
        make_post(alice)

    data = client.get(f"{POSTS}?limit=2").json()

    assert data["total"] == 3          # total 是"符合条件的总数"，不是当页条数
    assert data["skip"] == 0
    assert data["limit"] == 2
    assert len(data["items"]) == 2     # 真分页：只回 2 条


def test_list_posts_pages_do_not_overlap(client, make_post, alice):
    """⭐ 第 1 页和第 2 页不能出现同一条。

    分页最容易错的地方就是 offset/limit 拼错（比如漏了 offset），
    表现是"翻到第 2 页还是那几条"—— 人眼很难发现，断言 `isdisjoint` 一眼看穿。
    """
    for i in range(3):
        make_post(alice, title=f"标题{i}")

    page1 = client.get(f"{POSTS}?skip=0&limit=2").json()["items"]
    page2 = client.get(f"{POSTS}?skip=2&limit=2").json()["items"]

    ids1 = {p["id"] for p in page1}
    ids2 = {p["id"] for p in page2}

    assert len(ids1) == 2
    assert len(ids2) == 1
    assert ids1.isdisjoint(ids2)


def test_list_posts_omits_content(client, make_post, alice):
    """列表用 PostSummary，**不返回正文**。

    同一张表可以有多个对外视图：列表页只需要扫标题，
    把每篇正文都传过去纯属浪费流量（正文可能很长）。
    """
    make_post(alice, content="这段正文不该出现在列表里")

    item = client.get(POSTS).json()["items"][0]

    assert "content" not in item


def test_search_by_title(client, make_post, alice):
    make_post(alice, title="FastAPI 入门")
    make_post(alice, title="Django 入门")

    data = client.get(f"{POSTS}?q=FastAPI").json()

    assert data["total"] == 1
    assert data["items"][0]["title"] == "FastAPI 入门"


def test_search_is_case_insensitive(client, make_post, alice):
    """ilike 的效果：大小写不敏感。"""
    make_post(alice, title="FastAPI 入门")

    assert client.get(f"{POSTS}?q=fastapi").json()["total"] == 1


def test_search_only_matches_title_not_content(client, make_post, alice):
    """搜索只针对标题 —— 防止将来有人"顺手"把条件改成 title or content。

    正文里有关键字的文章【不应该】被搜出来。
    """
    make_post(alice, title="无关标题", content="正文里藏着 FastAPI")

    assert client.get(f"{POSTS}?q=FastAPI").json()["total"] == 0


def test_filter_by_published(client, make_post, alice):
    make_post(alice, published=True)
    make_post(alice, published=False)

    assert client.get(f"{POSTS}?published=true").json()["total"] == 1
    assert client.get(f"{POSTS}?published=false").json()["total"] == 1
    # 不传 = 不按它过滤（而不是默认只看已发布）
    assert client.get(POSTS).json()["total"] == 2


def test_invalid_pagination_params_are_rejected(client):
    assert client.get(f"{POSTS}?skip=-1").status_code == 422
    assert client.get(f"{POSTS}?limit=0").status_code == 422
    assert client.get(f"{POSTS}?limit=999").status_code == 422   # 上限 50，防"一次拉全表"


# ══════════════════════════════════════════════════════════════
# 四、/latest 与 /mine（顺带盯着路由顺序这个坑）
# ══════════════════════════════════════════════════════════════
def test_latest_returns_newest(client, make_post, alice):
    make_post(alice, title="旧的")
    make_post(alice, title="新的")

    assert client.get(f"{POSTS}/latest").json()["title"] == "新的"


def test_latest_on_empty_db_returns_404(client):
    """⭐ 这条同时盯着一个**看代码很难发现**的坑：路由顺序。

    /posts/latest 这条固定路径必须写在 /posts/{post_id} 之前。
    写反了会怎样？"latest" 被当成路径参数去转 int，报 422 ——
    而且报错信息只会说"不是有效整数"，完全看不出是顺序问题。

    所以这里断言的是 404（"还没有任何文章"，业务语义）而不是 422（路由撞车）。
    没有文章时两者很好区分：404 说明路由走对了。
    """
    resp = client.get(f"{POSTS}/latest")

    assert resp.status_code == 404
    assert resp.json()["detail"] == "还没有任何文章"


def test_my_posts_requires_login(client):
    assert client.get(f"{POSTS}/mine").status_code == 401


def test_my_posts_only_contains_mine(client, make_post, alice, bob, auth):
    make_post(alice, title="我写的")
    make_post(bob, title="别人写的")

    data = client.get(f"{POSTS}/mine", headers=auth(alice)).json()

    assert data["total"] == 1
    assert data["items"][0]["title"] == "我写的"


# ══════════════════════════════════════════════════════════════
# 五、更新（PATCH 语义 + 越权）
# ══════════════════════════════════════════════════════════════
def test_patch_requires_login(client, make_post, alice):
    post = make_post(alice)

    assert client.patch(f"{POSTS}/{post.id}", json={"title": "改"}).status_code == 401


def test_patch_only_changes_provided_fields(client, make_post, alice, auth):
    """⭐ PATCH 的语义：**没传的字段保持原值**。

    实现里用的是 model_dump(exclude_unset=True)。如果哪天有人图省事改成
    model_dump()，没传的字段会被 None 覆盖 ——
    title 变 null、published 变 null，功能上一眼看不出来（页面还能打开），
    但数据已经被破坏了。这条测试就是钉住那个写法。
    """
    post = make_post(alice, title="原标题", content="原正文", published=False)

    data = client.patch(
        f"{POSTS}/{post.id}", json={"title": "新标题"}, headers=auth(alice)
    ).json()

    assert data["title"] == "新标题"
    assert data["content"] == "原正文"    # 没传 → 不变
    assert data["published"] is False     # 没传 → 不变


def test_patch_can_publish_a_draft(client, make_post, alice, auth):
    post = make_post(alice, published=False)

    data = client.patch(
        f"{POSTS}/{post.id}", json={"published": True}, headers=auth(alice)
    ).json()

    assert data["published"] is True


def test_patch_others_post_returns_403(client, make_post, alice, bob, auth):
    """403（不是 401）：身份已验证，只是这东西不归你。"""
    post = make_post(bob)

    resp = client.patch(f"{POSTS}/{post.id}", json={"title": "改"}, headers=auth(alice))

    assert resp.status_code == 403
    assert "another user" in resp.json()["detail"]


def test_patch_missing_post_returns_404(client, alice, auth):
    """404 优先于 403：别人连"这篇存不存在"都不该知道。"""
    assert client.patch(f"{POSTS}/999999", json={"title": "x"}, headers=auth(alice)).status_code == 404


def test_ownerless_post_cannot_be_modified_by_anyone(client, make_post, alice, auth):
    """⭐ author_id 为 None 的"无主文章"（作者注销后留下的）。

    老数据里可能有，判断用的是 `post.author_id != current_user.id`，
    而 current_user.id 永远不是 None —— 所以无主文章对**任何人**都算"不是你的"。

    这条看着像边角料，其实是个安全性质：无主资源必须没人能改，
    而不是"谁都能改"（后者才是真正危险的默认值）。
    """
    post = make_post(None)

    resp = client.patch(f"{POSTS}/{post.id}", json={"title": "x"}, headers=auth(alice))

    assert resp.status_code == 403


# ══════════════════════════════════════════════════════════════
# 六、删除
# ══════════════════════════════════════════════════════════════
def test_delete_own_post_then_404(client, make_post, alice, auth):
    post = make_post(alice)

    assert client.delete(f"{POSTS}/{post.id}", headers=auth(alice)).status_code == 204
    assert client.get(f"{POSTS}/{post.id}").status_code == 404


def test_delete_others_post_returns_403_and_keeps_it(client, make_post, db, alice, bob, auth):
    post = make_post(bob)

    assert client.delete(f"{POSTS}/{post.id}", headers=auth(alice)).status_code == 403
    # 光断言状态码还不够 —— 得确认数据真的还在
    assert db.get(Post, post.id) is not None


def test_delete_requires_login(client, make_post, alice):
    post = make_post(alice)

    assert client.delete(f"{POSTS}/{post.id}").status_code == 401


# ══════════════════════════════════════════════════════════════
# 七、浏览量（阶段12 返工 + 阶段14 防刷）
# ══════════════════════════════════════════════════════════════
def test_detail_never_changes_views(client, make_post, alice):
    """⭐ GET 详情必须**纯读** —— 这是阶段12 专门返工过的地方。

    HTTP 规定 GET 属于"安全方法"（只读、无副作用）。这不是清高，
    是因为现实里有一堆东西会**随手**发 GET：
        浏览器预加载链接、搜索引擎爬虫、超时重试的客户端、缓存 GET 的 CDN……
    计数一旦挂在 GET 上，必然被这些"根本不算阅读"的请求灌水。

    所以这条测试锁的其实是那句：**再也不要有人把计数写回 GET 里**。
    """
    post = make_post(alice)

    for _ in range(5):
        client.get(f"{POSTS}/{post.id}")

    assert client.get(f"{POSTS}/{post.id}").json()["views"] == 0


def test_record_view_increments(client, make_post, alice):
    post = make_post(alice)

    assert client.post(f"{POSTS}/{post.id}/views").status_code == 204
    assert client.get(f"{POSTS}/{post.id}").json()["views"] == 1


def test_record_view_is_idempotent_within_window(client, make_post, alice, fake_redis):
    """同一个 IP 在窗口期内重复浏览，只计一次（阶段14 防刷）。

    fake_redis 是 autouse 的，所以这里不用写也会自动生效；
    显式写出来是为了**让读测试的人知道这条依赖 Redis**。
    """
    post = make_post(alice)

    for _ in range(3):
        client.post(f"{POSTS}/{post.id}/views")

    assert client.get(f"{POSTS}/{post.id}").json()["views"] == 1


def test_view_dedup_is_per_post(client, make_post, alice, fake_redis):
    """去重的 key 是 `views:{post_id}:{ip}` —— 换一篇文章各算各的。

    如果 key 设计错了（比如只按 IP），第二篇文章就永远数不上；
    只按 post_id 的话，所有人加起来只算一次。
    """
    first = make_post(alice)
    second = make_post(alice)

    client.post(f"{POSTS}/{first.id}/views")
    client.post(f"{POSTS}/{second.id}/views")

    assert client.get(f"{POSTS}/{first.id}").json()["views"] == 1
    assert client.get(f"{POSTS}/{second.id}").json()["views"] == 1


def test_view_fails_open_when_redis_is_down(client, make_post, alice, broken_redis):
    """⭐ Redis 挂掉时，浏览量**照常 +1**（fail-open）。

    这条和 test_smoke.py 里的 `/health/redis → 503`（fail-closed）
    恰好相反 —— 判据是**哪种错更严重**：

        · 健康检查说谎   → 监控把自己骗了，必须如实报错（503）
        · 浏览量少算一次 → 用户根本感知不到，绝不能因为它让写接口报错

    同一个 Redis，两种相反的失败策略。这种选择必须写进测试，
    否则下一个人重构时一定会"顺手统一"成其中一种。
    """
    post = make_post(alice)

    assert client.post(f"{POSTS}/{post.id}/views").status_code == 204
    assert client.get(f"{POSTS}/{post.id}").json()["views"] == 1


def test_record_view_on_missing_post_returns_404(client):
    assert client.post(f"{POSTS}/999999/views").status_code == 404


def test_record_view_requires_no_login(client, make_post, alice):
    """浏览是公开行为：不带 token 也该 204。"""
    post = make_post(alice)

    assert client.post(f"{POSTS}/{post.id}/views").status_code == 204
