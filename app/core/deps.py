# AI生成
"""跨资源的公共依赖（给 Depends 用的东西）都放这里。

和同目录其他文件的区别：
- `config.py` / `database.py` 是"基础设施"，其中 `get_db` 本身就是一个依赖；
- 本文件专门放"给接口用的、会被多个路由复用"的依赖：分页参数、当前登录用户。

约定：依赖的返回值通常是"打包好的一组参数"或"查好的一个对象"。
"""

from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import ratelimit
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models import User


class PaginationParams:
    """分页参数依赖：把 skip / limit 打包成一个对象。

    接口里一行接上：

        def list_posts(pagination: PaginationParams = Depends(PaginationParams)):
            ...
            pagination.skip / pagination.limit

    为什么用"类"而不是"函数"？
        函数只能 return 一个值，想回两个就得塞进 dict（`commons["skip"]` 读起来别扭）；
        用类可以直接 `commons.skip`，编辑器还能补全。
    """

    def __init__(
        self,
        # Query(...) 的写法和直接写在接口里一模一样 —— 依赖的参数同样走参数解析规则，
        # 所以默认值、校验规则、description 全都会自动出现在 /docs 上。
        skip: int = Query(0, ge=0, description="跳过前几条，不能为负"),
        limit: int = Query(2, ge=1, le=50, description="每页条数，1~50"),
    ) -> None:
        # self.xxx = 把参数存到对象上，接口里用 pagination.skip 取出来
        self.skip = skip
        self.limit = limit


# ============================================================
# 阶段8：当前登录用户（认证依赖）
# ============================================================
# 注意这是本项目【第一次出现依赖链】：
#     get_current_active_user → get_current_user → oauth2_scheme
#                                              └→ get_db
# FastAPI 会自动按顺序执行，把结果一层层往上传。
# 接口里只要写 current_user: User = Depends(get_current_active_user)，
# 就等于一次性获得了"取 token → 验签名 → 查用户 → 判断是否停用"整套检查。

# OAuth2PasswordBearer 做两件事：
#   1. 告诉 FastAPI："需要登录的接口，请从请求头 `Authorization: Bearer xxx` 里取 token"；
#   2. tokenUrl 是【给 /docs 用的】：文档页右上角的 Authorize 按钮，
#      输入用户名密码后会去 POST 这个地址换 token。我们登录接口的真实路径是 /auth/token。
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")


def _credentials_exception() -> HTTPException:
    """统一的"凭证无效"异常。

    为什么抽成函数？因为它要在三处 raise（没 token / token 无效 / 用户已不存在），
    而且每次都要一个【新的】异常对象，不能共用一个实例。
    """
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    # 1) token 从哪来？→ 由 oauth2_scheme 解析请求头得到（请求头里没带会直接 401）
    token: str = Depends(oauth2_scheme),
    # 2) 数据库会话：待会儿要按用户名把用户查出来
    db: Session = Depends(get_db),
) -> User:
    """把请求头里的 token 换成"一个真实的 User 对象"。

    这是它最核心的价值：接口只需要关心"当前是谁"，
    不用管 token 怎么解、用户怎么查、查不到怎么办——那些全都关在这一个函数里。
    """
    # 解码失败（伪造 / 过期 / 格式不对）→ 一律 401
    username = decode_access_token(token)
    if username is None:
        raise _credentials_exception()

    user = db.scalars(select(User).where(User.username == username)).first()
    # 用户被删了、但 token 还没过期？→ 也 401。
    # 这就是"token 里只放用户名、并且回查数据库"的好处：能立刻反映账号的最新状态。
    if user is None:
        raise _credentials_exception()

    return user


def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    """在"已登录"的基础上再加一条：账号必须是启用状态。

    为什么拆成两层？
        有的接口只要求"登录"（比如看自己的资料），有的要求"账号可用"（比如发文章）。
        拆开后两种场景各取所需，不用写重复逻辑。
    """
    if not current_user.is_active:
        # 401 = "你没证明身份"；403 = "证明了，但没权限"。这里是后者。
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
    return current_user


# ============================================================
# 阶段17：来源 IP + 限流依赖
# ============================================================
def client_ip(request: Request) -> str:
    """取请求来源 IP —— 用来回答"这是谁在看 / 谁在调"。

    `request.client.host` 是 ASGI 服务器告诉我们的【对端地址】（TCP 连接层面的信息，
    不是 HTTP 头），所以客户端伪造不了它。

    别急着改成读 X-Forwarded-For：那才是客户端能随手编的。
    只有前面确实站着【可信的】反向代理（Nginx）时才该读它，而且必须由 Nginx
    负责【覆盖】这个头。否则任何人加一行 `X-Forwarded-For: 1.2.3.4` 就能刷爆计数 / 绕过限流。

    `if request.client else` 是防一手：某些测试客户端 / 特殊 ASGI 场景下 client 是 None。
    这种"网络身份拿不到"的边界，给个占位值也别让接口崩。
    """
    return request.client.host if request.client else "unknown"


def rate_limit(scope: str, limit: int, window: int):
    """生成一个"限流依赖"的工厂。

    用法（在路由签名里加一行）：
        login_guard = Depends(rate_limit("auth:token", settings.AUTH_RATE_LIMIT, settings.AUTH_RATE_WINDOW))

    为什么做成"工厂"而不是固定一个依赖？
        不同接口需要不同的额度与作用域：登录和注册要分开算（scope 不同），
        将来也许给上传接口另设一个额度。工厂让"额度/作用域"成为参数，
        一个函数覆盖所有场景。FastAPI 的依赖可以接受"返回依赖的函数"——`Depends(rate_limit(...))`。

    被限时抛 429（Too Many Requests），并带上 `Retry-After` 头告诉客户端多久后再试。
    额度与作用域都来自配置，所以关掉限流只需把 AUTH_RATE_LIMIT / AUTH_RATE_WINDOW 设成 0。
    """

    def dependency(request: Request) -> None:
        allowed, _remaining = ratelimit.hit(
            f"rl:{scope}:{client_ip(request)}", limit=limit, window=window
        )
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="请求过于频繁，请稍后再试",
                headers={"Retry-After": str(window)},
            )

    return dependency