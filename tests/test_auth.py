"""认证测试：注册（阶段7）+ 登录发 token（阶段8）+ token 校验链路。

这一组测的是**所有写操作的入口**：token 从哪儿来、怎么解、什么时候算无效。
它坏掉的后果是"要么谁都能写、要么谁都写不了"，所以值得测得细一点。

里面的"越权 / 信息泄露"那几条，是这套测试里最值钱的部分 ——
它们盯住的错误**不会让功能出问题**（页面照常能用），
但会让攻击者拿到不该拿的东西。这种错，只有测试能替你记住。
"""

from datetime import timedelta

import pytest
from jose import jwt
from sqlalchemy import select

from app.core.security import create_access_token
from app.models import User

REGISTER = "/auth/register"
TOKEN = "/auth/token"
MINE = "/posts/mine"          # 一个"需要登录"的接口，用来试 token


def register_body(**overrides) -> dict:
    """注册用的请求体，字段名和 UserCreate 对齐。"""
    body = {"username": "newbie", "email": "newbie@example.com", "password": "secret123"}
    body.update(overrides)
    return body


# ══════════════════════════════════════════════════════════════
# 一、注册
# ══════════════════════════════════════════════════════════════
def test_register_creates_user(client, db):
    resp = client.post(REGISTER, json=register_body())

    assert resp.status_code == 201
    data = resp.json()
    assert data["username"] == "newbie"
    assert data["is_active"] is True
    assert "id" in data

    # 数据库里真的存了一条，而且存的是【哈希】不是明文
    user = db.scalars(select(User).where(User.username == "newbie")).one()
    assert user.hashed_password != "secret123"
    assert user.hashed_password.startswith("$2")   # bcrypt 结果的特征前缀


def test_register_never_returns_password(client):
    """响应里绝不能出现密码（明文或哈希）。

    这就是"白名单"这个设计的价值：UserRead 里**没声明**这两个字段，
    所以哪怕 ORM 对象上带着它们，也永远出不去。
    注意断言的是整段响应文本 —— 藏在别的字段里也不行。
    """
    resp = client.post(REGISTER, json=register_body())

    assert "secret123" not in resp.text
    assert "hashed_password" not in resp.text


def test_register_duplicate_username_returns_409(client, alice):
    resp = client.post(REGISTER, json=register_body(username="alice", email="other@example.com"))

    assert resp.status_code == 409
    assert "already taken" in resp.json()["detail"]


def test_register_duplicate_email_returns_409(client, alice):
    resp = client.post(REGISTER, json=register_body(username="other", email="alice@example.com"))

    assert resp.status_code == 409
    assert "already registered" in resp.json()["detail"]


@pytest.mark.parametrize(
    "body",
    [
        pytest.param(register_body(username="ab"), id="用户名只有2个字"),
        pytest.param(register_body(password="12345"), id="密码只有5位"),
        pytest.param(register_body(email="not-an-email"), id="邮箱格式不对"),
        pytest.param({"username": "newbie", "email": "n@example.com"}, id="缺少password字段"),
    ],
)
def test_register_rejects_bad_input(client, body):
    """校验规则在【进入业务代码之前】就被 Pydantic 拦掉了。

    参数化（parametrize）的好处在这里很明显：
    四个用例共用一段逻辑，出问题时报告里直接写着是哪一个（看 id=）。
    拆成四个函数的话，就得把同一句断言抄四遍。
    """
    assert client.post(REGISTER, json=body).status_code == 422


# ══════════════════════════════════════════════════════════════
# 二、登录
# ══════════════════════════════════════════════════════════════
def test_login_returns_token(client, alice):
    resp = client.post(TOKEN, data={"username": "alice", "password": "secret123"})

    assert resp.status_code == 200
    assert resp.json()["access_token"]


def test_login_does_not_reveal_whether_user_exists(client, alice):
    """⭐ "密码错"和"用户不存在"必须返回**完全一样**的响应。

    分开报错确实更"友好"，但代价是：攻击者能靠错误信息的差异，
    一个一个试出哪些用户名是真实存在的（这叫"用户名枚举"），
    随后就能针对性地撞库。

    测试写法上有个小技巧：两个响应都拿到手，再整体比较 ——
    这样将来有人给其中一种情况加了个字段，测试也会红。
    """
    wrong_password = client.post(TOKEN, data={"username": "alice", "password": "x" * 12})
    unknown_user = client.post(TOKEN, data={"username": "nobody", "password": "x" * 12})

    assert wrong_password.status_code == unknown_user.status_code == 401
    assert wrong_password.json() == unknown_user.json()
    # 401 的标准响应头：告诉客户端"你得带上 Bearer token"
    assert wrong_password.headers["WWW-Authenticate"] == "Bearer"


def test_login_inactive_user_returns_403(client, make_user):
    """账号被停用（is_active=False）时不能登录。

    401 = "你没证明身份"；403 = "证明了，但没权限"。这里是后者。
    """
    make_user("frozen", is_active=False)

    resp = client.post(TOKEN, data={"username": "frozen", "password": "secret123"})

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Inactive user"


# ══════════════════════════════════════════════════════════════
# 三、token 校验链路（依赖链的三层，每层各测一种失败）
# ══════════════════════════════════════════════════════════════
def test_token_grants_access(client, alice, auth):
    assert client.get(MINE, headers=auth(alice)).status_code == 200


def test_missing_token_returns_401(client):
    """连 token 都没带 —— oauth2_scheme 这一层就直接拒绝了，接口函数根本没执行。"""
    resp = client.get(MINE)

    assert resp.status_code == 401
    assert resp.headers["WWW-Authenticate"] == "Bearer"


def test_malformed_token_returns_401(client):
    """签名解不开（不是合法 JWT / 签名不对）—— get_current_user 的 decode 这一层拦下。"""
    resp = client.get(MINE, headers={"Authorization": "Bearer not-a-jwt-at-all"})

    assert resp.status_code == 401


def test_token_signed_with_another_key_returns_401(client, alice):
    """结构完全正确、但用别人的密钥签的 token —— 必须认不出。

    这是整个 JWT 方案的安全根基：**载荷是明文的，防伪全靠签名**。
    """
    forged = jwt.encode({"sub": alice.username}, "attacker-secret", algorithm="HS256")

    resp = client.get(MINE, headers={"Authorization": f"Bearer {forged}"})

    assert resp.status_code == 401


def test_expired_token_returns_401(client, alice):
    """过期检查由 jwt.decode 自动完成（载荷里的 exp 字段）。"""
    expired = create_access_token(alice.username, expires_delta=timedelta(seconds=-1))

    resp = client.get(MINE, headers={"Authorization": f"Bearer {expired}"})

    assert resp.status_code == 401


def test_token_of_deleted_user_returns_401(client, db, alice):
    """⭐ token 还没过期，但用户已经被删了。

    这正是"token 里只放用户名 + 每次请求回查数据库"换来的好处：
        如果直接把用户信息塞进 token 就完事，那张 token 会一直有效到过期为止。
        回查一次数据库，就能立刻反映账号的最新状态。
    """
    token = create_access_token(alice.username)
    db.delete(alice)
    db.commit()

    resp = client.get(MINE, headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 401


def test_token_of_deactivated_user_returns_403(client, db, alice):
    """同上，但用户只是被停用 —— 401 换成 403（身份没问题，权限没有）。

    这一条同时说明了依赖链为什么要拆成两层：
        get_current_user     只管"你是谁"（401）
        get_current_active_user 再加一层"你能不能干活"（403）
    有的接口只要前者（看自己的资料），有的要后者（发文章）。
    """
    token = create_access_token(alice.username)
    alice.is_active = False
    db.commit()

    resp = client.get(MINE, headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Inactive user"
