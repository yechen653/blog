"""
配置中心：把项目所有可配置项集中到一处，统一从 .env / 环境变量读取。

为什么要这么做？
- 密钥、数据库地址不能写死在代码里（会被提交到代码仓库）。
- 换环境（本机 / 服务器）只改 .env，不改代码。
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # 字段名（大写）= .env 里的变量名，大小写不敏感；等号右边是"没配置时的默认值"
    model_config = SettingsConfigDict(
        env_file=".env",          # 从当前目录的 .env 读取
        env_file_encoding="utf-8",
        extra="ignore",           # .env 里多出来的变量忽略掉，不报错
    )

    PROJECT_NAME: str = "Blog API"
    API_V1_PREFIX: str = "/api/v1"

    # 兜底默认值：万一没有 .env 也能跑起来（项目实际使用 MySQL，见 .env.example）
    DATABASE_URL: str = "sqlite:///./blog.db"

    SECRET_KEY: str = "dev-only-change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # ── 阶段14：Redis（只用来做浏览量防刷）──────────────────────────
    # 本地用 Docker 起一个，不设密码；生产环境要加密码和 ACL
    REDIS_URL: str = "redis://127.0.0.1:6379/0"

    # 防刷窗口（秒）：同一个 IP 在这么多秒内重复浏览同一篇文章，只计一次。
    # 设成 0 = 关闭防刷（方便做对照测试）
    VIEW_DEDUP_SECONDS: int = 60

    # ── 上传目录 ──────────────────────────────────────────────
    # 相对"启动目录"（也就是 blog-api/）。想让文件落到别处就改这一行或 .env。
    UPLOAD_DIR: str = "uploads"


# 模块级单例：别处一律 `from app.core.config import settings` 用它
settings = Settings()
