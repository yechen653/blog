"""
数据库连接：引擎（engine）+ 会话工厂（SessionLocal）+ ORM 基类（Base）+ 依赖（get_db）。
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

# 1) 引擎：整个应用只建一个，负责管理到数据库的连接
engine = create_engine(
    settings.DATABASE_URL,
    # SQLite 专用：允许连接被不同线程使用
    # （FastAPI 会把同步的 def 接口放到线程池里执行，不加这个会报错）
    # MySQL/PostgreSQL 不需要，所以按方言判断，别的库传空字典
    connect_args={"check_same_thread": False}
    if settings.DATABASE_URL.startswith("sqlite")
    else {},
    # 下面两个参数是给"真数据库"（MySQL/PostgreSQL）准备的，SQLite 上也无害：
    pool_pre_ping=True,   # 取连接前先探活，避免拿到被服务端断掉的"死连接"
    pool_recycle=3600,    # 连接最多复用 1 小时就回收，防 "MySQL server has gone away"
)

# 2) 会话工厂：每个请求用它"造"一个独立的数据库会话
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


# 3) ORM 基类（SQLAlchemy 2.0 风格）：以后所有数据模型都继承它
class Base(DeclarativeBase):
    pass


# 4) FastAPI 依赖：每个请求一个会话，请求结束自动关闭
def get_db():
    db = SessionLocal()
    try:
        yield db            # yield 之前 = 请求前准备好会话
    finally:
        db.close()          # yield 之后 = 请求结束后一定执行（哪怕接口报错）
