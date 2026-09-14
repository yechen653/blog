"""Alembic 运行环境：把「你的项目」和「迁移引擎」接在一起。

这个文件由 `alembic init` 生成，默认【完全不认识你的项目】——
它的初始值是 `target_metadata = None`，等于闭着眼睛，不知道你的表长什么样。

下面用三处改造把它接上（文件里都标了【改造】）：
    【改造1】导入你的 app：拿到数据库 URL 和 Base.metadata
    【改造2】把 .env 里的真实 URL 覆盖掉 alembic.ini 里的占位符
    【改造3】开启"列类型变更"检测，让 autogenerate 更靠谱

注意：所有 alembic 命令都必须在项目根目录（blog-api/）下执行。
    原因在 alembic.ini 的 `prepend_sys_path = .`：
    它把"当前目录"加进 Python 的模块搜索路径，`import app.xxx` 才找得到。
"""

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# ============================================================
# 【改造1】把项目自己的东西接进来
# ============================================================
# settings：读出 .env 里的 DATABASE_URL
# Base：SQLAlchemy 的"总目录"，里面装着所有表的定义
from app.core.config import settings
from app.core.database import Base

# 这一行【看着像没用，但绝对不能删】：
#     Python 只有在 import 模块时，才会执行里面的 `class Post(Base)` 那句；
#     而只有执行了它，posts 表的定义才会注册进 Base.metadata。
#     少了这句，Alembic 拿到的是一本空白目录，会告诉你"没有检测到任何变化"——
#     这不是它出了 bug，是它真的没"看见"你的表。
import app.models  # noqa: F401

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ============================================================
# 【改造2】把真实数据库 URL 交给 Alembic
# ============================================================
# alembic.ini 里的 sqlalchemy.url 是个占位符（密码不能进代码仓库），
# 这里用 .env 里的值覆盖它 —— 于是数据库地址由 settings 一处统一管理，
# 应用和迁移永远连同一个库，不会出现"应用连 A、迁移连 B"的错位。
#
# replace("%", "%%") 是纯防御：ini 文件格式里 % 是插值符号，
# 而数据库密码完全可能含 %（比如 URL 编码过的特殊字符），
# 不转义的话 Alembic 会拿它去做插值，然后报一个看不懂的错。
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("%", "%%"))

# ============================================================
# 【改造3】告诉 Alembic "模型长什么样"
# ============================================================
# autogenerate 的原理就是拿它和数据库现状做对比，差在哪就生成什么脚本。
# 交给它的【是对象本身，不是拷贝】，所以【改造1】里那句 import 必须生效。
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    离线模式：不连数据库，只把要执行的 SQL 打印出来（--sql 参数触发）。
    适合"生成 SQL 交给 DBA 审核后手工执行"的场景。
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # 比对时也检查"列的类型"，默认是关的。
        # 不开的话，你把 String(50) 改成 String(100)，autogenerate 会说"没变化"。
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    在线模式：正常连上数据库执行迁移（我们平时用的就是这个）。
    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        # NullPool：迁移是"跑一次就退出"的一次性任务，不需要连接池。
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # 同上：开启类型变更检测（upgrade / autogenerate 都走这里）
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
