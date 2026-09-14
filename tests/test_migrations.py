"""迁移自检：模型定义和迁移链必须一致。

这是本阶段最值钱的一条测试。它专门盯住一类**很容易犯、又很难发现**的错：

    改了 app/models/*.py（加了列、改了删除规则），
    却忘了跑 `alembic revision --autogenerate`。

这种错在本地往往看不出来：你的开发库早就手工调过、或者是很久以前建的，
代码和库"碰巧"还能对上。可一旦部署到新环境，表结构就是按**迁移**建的 ——
于是代码以为有 A 列、库里实际没有，报出一堆莫名其妙的错。

修它的成本很低，发现它的成本很高（一般要等到线上）。所以用一条测试钉住它。
"""

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

import app.models  # noqa: F401  ← 这行不能删：import 才会执行 `class Xxx(Base)`，
#                                models 才会注册进 Base.metadata。少了它，下面那个
#                                metadata 是空的，测试会"永远通过"（假绿）。
from app.core.database import Base


def test_models_match_migrations(test_engine):
    """拿"迁移建出来的库现状"和"模型定义"对一遍，应该零差异。

    test_engine 是 session 级 fixture，它已经把测试库用迁移建好了 ——
    所以这里比的是真正的迁移产物，而不是 create_all() 的结果。
    """
    with test_engine.connect() as conn:
        # MigrationContext 是 alembic 用来"读数据库现状"的对象
        context = MigrationContext.configure(conn)
        # compare_metadata 返回一个"差异清单"：空列表 = 完全一致
        diff = compare_metadata(context, Base.metadata)

    assert diff == [], (
        "模型和迁移不一致 —— 大概率是改了模型却忘了生成迁移。\n"
        "修复：alembic revision --autogenerate -m '描述'\n"
        f"差异清单：{diff}"
    )
