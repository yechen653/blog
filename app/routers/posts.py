"""文章接口：参数校验（阶段2）+ 请求体 / CRUD（阶段4）+ 响应与状态码（阶段5）+ 依赖重构（阶段6）+ 写操作鉴权（阶段8）。

阶段6相比阶段5的两处重构（都是 Depends，公共依赖见 app/core/deps.py）：
1. 分页参数抽成 `PaginationParams` 依赖：列表接口签名变短，别的资源做列表接口时一行就能复用；
2. `_get_post_or_404` 升级成依赖 `get_post_or_404`：post_id 的声明和 404 校验都搬进依赖，
   详情接口只剩一行 `return post`。

阶段8的一处关键变化：
    **读接口保持公开，写接口（POST / PATCH / DELETE）要求登录。**
    做法不是"在函数体里判断"，而是往签名里加一行依赖——
    检查发生在进入函数体【之前】，所以函数体里的代码天然"只有登录用户能执行到"。

阶段9再进一步：从"登录就能写"升级成"只能动自己的"。
    手段是给 Post 加 author_id 外键，并把 get_post_or_404 升级成 get_own_post_or_404。

阶段10让响应里带上作者对象（PostRead.author），顺带处理它的代价：
    光加 relationship 会引出 N+1 查询（1 篇文章 1 次 + 每篇作者再 1 次），
    所以所有"要把文章发给客户端"的查询都挂上 options(LOAD_AUTHOR) 预加载。

阶段12记浏览量，中途返工过一次，值得记下来：
    第一版把 `views + 1` 内联写在 GET /posts/{post_id} 里——能跑，但违反 HTTP 语义。
    GET 属于【安全方法】：规范保证它"只读、无副作用"。现实里却有一堆东西会随手发 GET
    （浏览器预加载、爬虫、超时重试、缓存 GET 的 CDN），挂在上面的计数必然被灌水。
    于是拆成两件事：GET 详情恢复只读，另开 `POST /posts/{post_id}/views` 专门负责计数。

阶段14 加防刷，接口的【形状】依然没变（还是 POST + 204）：
    变的只是计数之前先问 Redis 一句"这个 IP 最近 60 秒内看过这篇吗"。
    判断和记录由一条 `SET key 1 NX EX 60` 原子完成——和阶段12 是同一个道理：
    【别把"读 → 判断 → 写"拆成两步】，中间的缝隙会被并发钻进去。
    实现细节集中在 app/core/cache.py。

═══════════════════════════════════════════════════════════════
本阶段（17→18）把"数据动作"抽去了 crud 层，本文件的定位变纯粹了：

    本文件（接线层）：路径、参数声明、校验、404/403 翻译、状态码
    app/crud/post.py（数据层）：select / db.add / setattr / commit

判据一句话：**凡是出现 Depends / Query / Path / Body / Request /
HTTPException / APIRouter 的行，都留在本文件。**
反过来，crud 那层里出现这些词，就说明它被污染了。
═══════════════════════════════════════════════════════════════
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from sqlalchemy.orm import Session

from app.core.cache import is_first_seen
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import PaginationParams, get_current_active_user
from app.crud import post as post_crud
from app.models import Post, User
from app.schemas import PostCreate, PostPage, PostRead, PostUpdate

# prefix="/posts"：本文件里所有接口路径都自动带上 /posts 前缀
# tags=["posts"]：/docs 里这些接口归到 posts 分组下
router = APIRouter(prefix="/posts", tags=["posts"])

# 详情类接口共用的"可能的错误响应"，写进 /docs 让调用方一眼看到
NOT_FOUND = {404: {"description": "文章不存在"}}


def get_post_or_404(
    # 依赖函数的参数，解析规则和接口参数【完全一样】：
    # 所以这个路径参数依然被声明，/{post_id} 在 /docs 上照样显示、照样做 ge=1 校验。
    post_id: int = Path(..., ge=1, description="文章 id，必须 ≥ 1"),
    db: Session = Depends(get_db),
) -> Post:
    """依赖版"按 id 取文章"，取不到就在依赖里直接 404。

    比普通函数多出来的三种能力：
    1. 能中断请求——raise 之后接口函数根本不会执行，所以接口里不用再判空；
    2. 返回值会被当作参数塞进接口：`post: Post = Depends(get_post_or_404)`；
    3. 它自己也能用 Depends，于是天然形成"依赖链"（这里就链到了 get_db）。

    分层后它的身体只剩两件事：
        · 让 crud 去查（它只回答"库里有没有"）；
        · 自己把 None 翻译成 404（"没有的话怎么告诉客户端"是 HTTP 层的事）。
    名字里的 "404" 就已经宣告了它的层籍——所以它【不能】搬去 crud。
    """
    post = post_crud.get(db, post_id)
    if post is None:
        # return = 正常交回结果；raise = 主动制造异常、立刻中断函数。
        # FastAPI 捕获 HTTPException 后，返回 {"detail": "你写的说明"} + 对应状态码。
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"post {post_id} not found",
        )
    return post


def get_own_post_or_404(
    # 依赖可以依赖依赖：一行管"文章存在吗"(404)，一行管"你登录了吗"(401)
    post: Post = Depends(get_post_or_404),
    current_user: User = Depends(get_current_active_user),
) -> Post:
    """依赖版"取自己的文章"：不存在 → 404，不属于你 → 403。

    为什么把权限判断塞进依赖，而不是写在两个接口里？
        PATCH 和 DELETE 需要【一模一样】的判断。写在依赖里，两处各一行就够；
        将来加"仅管理员可删"，也只改这一个地方。

    它产出的仍然是一个普通的 Post 对象——下游（接口函数、crud）拿到它时，
    只知道"这是一篇合法的文章"，不知道刚才发生过校验。
    """
    # 老数据的 author_id 可能是 None（无主文章），而 current_user.id 永远不是 None，
    # 所以这里用 != 是安全的：无主文章对任何人都 403（这正是我们想要的）。
    if post.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"post {post.id} belongs to another user",
        )
    return post


@router.get("", response_model=PostPage, summary="文章列表（分页 + 搜索 + 过滤）")
def list_posts(
    # 分页这两个参数被抽走了：现在打包在 PaginationParams 里，一行接上。
    # /docs 上的效果完全一样——依赖内部的 Query(...) 照样会出现在接口文档里。
    pagination: PaginationParams = Depends(PaginationParams),
    q: Optional[str] = Query(
        None, min_length=1, max_length=20, description="标题关键字，1~20 字"
    ),
    published: Optional[bool] = Query(None, description="按发布状态过滤；不传表示不按它过滤"),
    db: Session = Depends(get_db),
):
    """列表接口现在只做三件事：收参数 → 交给 crud → 按 PostPage 的形状包回去。

    注意传下去的是 skip / limit 这些【普通整数】，而不是 pagination 对象本身——
    crud 那层不认识 PaginationParams（那是 FastAPI 的东西）。
    """
    total, items = post_crud.list_page(
        db,
        skip=pagination.skip,
        limit=pagination.limit,
        q=q,
        published=published,
    )

    # 返回的是完整 Post 对象，但 response_model=PostPage 只放行 PostSummary 里声明的字段，
    # content 这类"列表页用不到"的字段会被自动丢掉。
    return {"total": total, "skip": pagination.skip, "limit": pagination.limit, "items": items}


# 注意顺序：这条【固定路径】必须写在下面的 /{post_id} 之前，
# 否则 "latest" 会先被 /{post_id} 匹配走，然后因为转不成 int 而报 422。
@router.get("/latest", response_model=PostRead, summary="最新一篇", responses=NOT_FOUND)
def latest_post(db: Session = Depends(get_db)):
    post = post_crud.get_latest(db)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="还没有任何文章")
    return post


# 阶段9：同样必须写在 /{post_id} 上面（否则 "mine" 会被当成 id 去转 int，报 422）
@router.get("/mine", response_model=PostPage, summary="我的文章")
def list_my_posts(
    pagination: PaginationParams = Depends(PaginationParams),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """只看自己写的文章。

    和列表接口唯一的区别，就是多了一个 where author_id == current_user.id 的条件——
    "当前是谁"由依赖给出，所以这个接口里【一行 token 相关代码都不需要】。

    分层后的分工：这里把"当前用户"降解成 current_user.id 这个整数传下去，
    crud 那层完全不知道有"登录用户"这回事。
    """
    total, items = post_crud.list_by_author(
        db, author_id=current_user.id, skip=pagination.skip, limit=pagination.limit
    )
    return {"total": total, "skip": pagination.skip, "limit": pagination.limit, "items": items}


@router.get(
    "/{post_id}",
    response_model=PostRead,
    summary="文章详情",
    responses=NOT_FOUND,
)
def get_post(post: Post = Depends(get_post_or_404)):
    """文章详情。**纯读**——从头到尾没有一次写库。

    这里原本内联着一段 `update ... views + 1`（阶段12 的第一版），后来搬走了，原因：

    HTTP 规定 GET 属于【安全方法（safe method）】：语义上保证"只读、无副作用"。
    规范这么定是有现实原因的——下面这些都会【随手】发 GET：
      · 浏览器预加载链接（你鼠标还没点，请求已经出去了）
      · 搜索引擎爬虫
      · 超时后自动重试的客户端 / 代理（正因为"安全"，它们才敢重试）
      · 缓存 GET 响应的 CDN / 反向代理
    副作用挂在 GET 上，计数就会被这些"根本不算阅读"的请求灌水。

    所以写动作搬去了 `POST /{post_id}/views`。这里只剩一句 `return post`——
    "取文章 + 404"这两件事，依赖 `get_post_or_404` 已经做完了。
    顺带注意：这个函数现在连 `db` 都不需要了，因为没有任何东西要写。
    """
    return post


def client_ip(request: Request) -> str:
    """取请求来源 IP —— 用来回答"这是谁在看"。

    `request.client.host` 是 ASGI 服务器告诉我们的【对端地址】（TCP 连接层面的信息，
    不是 HTTP 头），所以客户端伪造不了它。

    别急着改成读 X-Forwarded-For：那才是客户端能随手编的。
    只有前面确实站着【可信的】反向代理（Nginx）时才该读它，而且必须由 Nginx
    负责【覆盖】这个头。否则任何人加一行 `X-Forwarded-For: 1.2.3.4` 就能刷爆计数。

    `if request.client else` 是防一手：某些测试客户端 / 特殊 ASGI 场景下 client 是 None。
    这种"网络身份拿不到"的边界，给个占位值也别让接口崩。
    """
    return request.client.host if request.client else "unknown"


@router.post(
    "/{post_id}/views",
    status_code=status.HTTP_204_NO_CONTENT,   # 204 = 成功，但不需要返回任何内容
    summary="记录一次浏览（写操作）",
    responses=NOT_FOUND,
)
def record_view(
    # 阶段14：要拿客户端 IP，所以需要 Request 对象。
    # 它是个"万能入口"——请求头、IP、Cookie、原始 body 全都挂在这上面。
    # 位置注意：它没有默认值，得排在那些有默认值的参数（Depends）前面。
    request: Request,
    post: Post = Depends(get_post_or_404),
    db: Session = Depends(get_db),
):
    """把一篇文章的浏览量 +1（同一个 IP 在窗口期内只算一次）。

    这就是从 GET 里搬出来的那个"写动作"，现在它有一个明确的地址：
    客户端（前端在文章真正渲染出来之后）单独发一次 POST。

    为什么是 POST 而不是 GET？
        因为它是【有副作用】的——会改变服务器状态。POST 在 HTTP 里就是"提交一份数据、
        让服务端做点什么"的语义，允许有副作用，也不会被预加载、缓存、自动重试。

    为什么返回 204（而不是 200 + 最新的浏览量）？
        204 的意思是"收到了，办妥了，没什么要说的"。计数是个"通知型"动作，
        客户端不需要结果——页面上的文章内容它早就有了。
        如果非要返回最新数字，前端就得【等这个请求回来】才能渲染，白白多个往返。
        真要显示"含自己这次"的值，更好的做法是前端本地 +1（下次刷新自然对齐）。

    为什么不用登录？（没有 get_current_active_user）
        浏览是公开行为。

    ── 阶段14：加了一道防刷闸门，但接口的【形状】一点没变（还是 POST + 204）。
       变的只是函数体开头多了一句"这人在窗口期内看过吗"。

       key 的设计 `views:{post.id}:{ip}`：
           把文章 id 和访客身份一起放进 key，于是只有"同一篇文章 + 同一个人"
           才会互相去重；换一篇文章是另一个 key，各算各的。

       重复访问为什么也返回 204，而不是 429（Too Many Requests）？
           防刷是【服务端自己的统计策略】，客户端并没有做错什么——它只是"打开了篇文章"。
           回 429 会让前端把它当错误处理（我们的 api() 封装会走 catch 分支弹红字），
           为了一个用户根本感知不到的统计动作去干扰用户，得不偿失。
           204 在这里仍然是"收到了，办妥了"——只是这次的结论是"不计数"。
    """
    # 提前 return（early return）：窗口期内重复浏览 → 直接结束，连数据库都不碰
    key = f"views:{post.id}:{client_ip(request)}"
    if not is_first_seen(key, settings.VIEW_DEDUP_SECONDS):
        return

    post_crud.bump_views(db, post)


@router.post(
    "",
    response_model=PostRead,
    status_code=status.HTTP_201_CREATED,   # 201 = 创建成功（比 200 更准确）
    summary="新建文章",
)
def create_post(
    payload: PostCreate,
    # 阶段8：这一行就是"上锁"；阶段9 它终于被真正用上了（下面 author_id）。
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    payload 的类型是 Pydantic 模型 → FastAPI 自动从请求体 JSON 里读并校验。
    model_dump()：模型 → dict，正好能用 ** 解包给 ORM 类当关键字参数。

    阶段9：除了客户端传的字段，再补上"作者是谁"。
    author_id 必须由【服务端自己填】——绝不能让请求体里传进来，
    否则用户只要发 {"title":"x","author_id":1} 就能把文章栽赃给别人（越权赋值）。
    这也正是 PostCreate 里【没有】author_id 字段的原因。

    分层后看得出来：传下去的是 current_user.id 这个【整数】，
    crud 只知道"有个作者 id 是 3"，不知道"当前登录用户"这个概念存在。
    """
    return post_crud.create(db, data=payload.model_dump(), author_id=current_user.id)


@router.patch("/{post_id}", response_model=PostRead, summary="局部更新文章", responses=NOT_FOUND)
def update_post(
    payload: PostUpdate,   # 无默认值，必须写在前面
    # 这里和下面都写了 Depends(get_db)，但同一个请求里 get_db 只会被执行一次，
    # 两处拿到的是【同一个 Session】——所以依赖里查出来的 post 能被下面 commit 提交。
    # 阶段9：从 get_post_or_404 升级成 get_own_post_or_404——
    # 一个依赖同时完成了"存在吗"(404) 和"是你的吗"(403)。
    post: Post = Depends(get_own_post_or_404),
    db: Session = Depends(get_db),
):
    """这行的"隐藏功劳"：post 是依赖【已经查好、并校验过归属】的对象。

    进到这个函数体时，404 和 403 都已经发生过了（或都没发生）。
    所以这里只管把字段交给 crud 去写，一行鉴权代码都不用写——
    这就是"校验在门口做完，里屋只管干活"。

    exclude_unset=True：只取"客户端真的传了"的字段。
    这是 PATCH 的关键——不传的字段保持原值，而不是被改成 None。
    """
    return post_crud.update(db, post, data=payload.model_dump(exclude_unset=True))


@router.delete(
    "/{post_id}",
    status_code=status.HTTP_204_NO_CONTENT,   # 204 = 成功但无响应体
    summary="删除文章",
    responses=NOT_FOUND,
)
def delete_post(
    # 阶段9：同样换成 get_own_post_or_404，"只能删自己的"。
    post: Post = Depends(get_own_post_or_404),
    db: Session = Depends(get_db),
):
    # post 由依赖交过来（查不到的情况已经在依赖里 404 掉了），这里不用再判空。
    post_crud.delete(db, post)
    # 204 不能有响应体，所以这里不 return 任何东西
