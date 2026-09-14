"""安全工具：密码哈希（阶段7）+ JWT 签发/校验（阶段8）。

为什么放 core/ 而不是 routers/？
    它和"文章""用户"这些业务没关系，是任何项目都能直接搬走的基础设施。
    只不过 `hash_password` 这种函数永远不该被接口直接调用——它是给业务代码用的零件。
"""

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

# CryptContext = 哈希方案的"总配置"：
#   schemes=["bcrypt"] → 用 bcrypt 算法
#   deprecated="auto"  → 以后升级算法时，旧哈希自动被标记为"待升级"，不用改调用方代码
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    """把明文密码变成哈希串（入库用）。

    注意它是【单向】的：拿到哈希串，没法反推出明文。
    bcrypt 每次调用都会自动生成一个随机"盐"并写进结果串里，
    所以同一个密码哈希两次，得到的字符串完全不同——这不是 bug，是设计。
    """
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """校验密码：把明文按同样规则算一遍，再和库里的哈希串比对。

    不是"解密后比较"（哈希不可逆），而是"重新哈希再比对"。
    盐也存在那个 hashed 串里，所以能自动用回同一个盐。
    """
    return pwd_context.verify(plain, hashed)


# ============================================================
# 阶段8：JWT —— "登录凭证"的签发与校验
# ============================================================
# 为什么需要它？
#     密码哈希解决的是"密码怎么存"。但 HTTP 是【无状态】的：
#     第 1 个请求登录成功了，第 2 个请求服务器压根不认识你。
#     所以登录成功后发一张"签名凭证"（token），之后每个请求都带着它。
#
# 为什么不干脆用"随机字符串 + 数据库建张表存着"？
#     也能用，但每次请求都要查一次库。JWT 把"你是谁"直接写进凭证、
#     再用 SECRET_KEY 签名——服务器算一遍就能判断真伪，不用查库。
#
# 名字里的三段（用 . 分隔）：
#     头部.载荷.签名
#     header.payload.signature
#     前两段只是 base64（【没加密】，谁都能解开看），真正防伪的是第三段签名。


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    """签发 token：把"你是谁"(sub) + "什么时候过期"(exp) 签名成一个字符串。

    subject 一般放用户名（或用户 id）。注意它【不是加密】——
    任何人都能把 token 解开看到内容，但改不了（一改签名就对不上）。
    所以 token 里【绝对不能放密码之类的东西】。
    """
    # exp 用"UTC 时间"：JWT 标准要求，且服务器之间不爱被时区坑
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> str | None:
    """校验 token 并取出 sub（用户名）；任何问题都返回 None。

    jwt.decode 会一次性检查三件事：
        1. 签名 —— 是不是用我们的 SECRET_KEY 签的（防伪造、防篡改）
        2. exp  —— 有没有过期
        3. 格式 —— 是不是一个正常的 JWT
    任何一项不过关都会抛 JWTError。这里统一"吞掉异常返回 None"，
    是为了不把"到底哪里错了"透露给攻击者（过期和伪造对外表现一致）。
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None
    # sub 是 JWT 的保留字段名（subject，主体），按约定放"标识是谁"的值
    return payload.get("sub")
