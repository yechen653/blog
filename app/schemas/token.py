"""Token 契约：登录成功后，服务端回什么。

为什么单独一个文件、而不是塞进 user.py？
    它描述的是"登录这个动作的结果"，不是"用户长什么样"——
    两个概念，两份契约。将来做刷新令牌（refresh token），也往这里加。
"""

from pydantic import BaseModel


class Token(BaseModel):
    """登录成功的响应体，字段名遵循 OAuth2 标准。

    为什么字段名不能随便改？
        FastAPI 的 Authorize 按钮、以及很多客户端库，都按这套名字取值。
        access_token = 凭证本体；token_type = 客户端该用什么方式带上它。
    """

    access_token: str
    # "bearer" 是 OAuth2 的固定写法，含义是"把这个 token 放请求头的 Authorization 里"。
    # 给默认值，所以返回时只传 access_token 就够了。
    token_type: str = "bearer"
