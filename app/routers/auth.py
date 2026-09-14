"""认证接口：注册（阶段7）+ 登录发 token（阶段8）。

router 文件的组织习惯：把"跟登录态相关"的接口归到一组，统一挂 /auth 前缀。

═══════════════════════════════════════════════════════════════
本阶段把"数据动作"抽去了 crud 层、"查重 + 哈希"抽去了 services 层，
本文件的定位变纯粹了：

    本文件（接线层）：路径、参数声明、校验、409 / 401 / 403 翻译、状态码
    app/crud/user.py（数据层）：select / db.add / commit
    app/services/user.py（业务规则层）：register_user_unique（查重 + 哈希）

判据一句话：**凡是出现 Depends / Query / Path / Body / Request /
HTTPException / APIRouter 的行，都留在本文件。**
═══════════════════════════════════════════════════════════════
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import create_access_token, verify_password
from app.crud import user as user_crud
from app.schemas import Token, UserCreate, UserRead
from app.services.user import register_user_unique

router = APIRouter(prefix="/auth", tags=["auth"])

# 注册接口可能返回的错误，写进 /docs 让调用方一眼看到
CONFLICT = {409: {"description": "用户名或邮箱已被占用"}}


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="用户注册",
    responses=CONFLICT,
)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    """注册：业务规则（查重 + 哈希）由 services 接管，本函数体只剩一行调用。

    密码在这里【只是参数传过去】，从来不会以任何形式出现在这里保存、打印、返回。
    services 收到明文 → 立即哈希 → 把哈希串传给 crud → 写入数据库。
    """
    return register_user_unique(
        db,
        username=payload.username,
        email=payload.email,
        password=payload.password,
    )


@router.post("/token", response_model=Token, summary="登录获取 access token")
def login(
    # OAuth2PasswordRequestForm 是 FastAPI 自带的"登录表单"依赖：
    #   它要求请求体是表单（application/x-www-form-urlencoded），字段固定叫 username / password。
    #   注意它【不是】JSON——这是 OAuth2 标准的约定，/docs 上的 Authorize 按钮也按这个规矩发请求。
    #   （表单依赖需要 python-multipart，阶段5 上传文件时已经装过了。）
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """登录：取用户 → 验密码 → 验启用 → 发 token。

    这是一个【只读】接口，没有任何写数据库的动作，所以它不调 services —— 直接 crud 取用户。
    （同样是 user 的入口，但 login 走"读"分支，所以进了 crud 那一支。）

    成功 / 失败的 HTTP 翻译全在这里完成：
        · 取不到 / 密码错 → 401
        · 账号被停用       → 403
        · 成功             → 200 + Token

    把"用户不存在"和"密码不对"合并成同一个错误、同一句话：
        如果分开报，攻击者就能靠错误信息【试探出哪些用户名存在】。
    """
    user = user_crud.get_by_username(db, form.username)

    if user is None or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            # 401 的标准响应头：告诉客户端的"你需要带上 Bearer token"
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")

    # 签发 token。subject 放用户名，解出来后再回查数据库，
    # 这样即使中间改了密码/停用了账号，也还能及时拦住。
    return Token(access_token=create_access_token(user.username))