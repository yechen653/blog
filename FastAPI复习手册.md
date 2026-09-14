# FastAPI 复习手册

> 配套原始笔记：`fastapi.md`（章节顺序一致，方便对照）
> 定位：**速查 + 易错点 + 课堂补充**。每节给「一句话概念 → 骨架卡 → 要点/坑」。
> 维护约定：做项目时遇到**未掌握的新技术**，会先带着过一遍，并追加到文末 **附录 B**。

---

## 目录

| 节 | 内容 | 对应文档章节 |
|---|---|---|
| 0 | 环境、安装、启动 | 一、二 |
| 1 | 路径参数 | 3.1 |
| 2 | 查询参数 + Query 校验 | 3.2 / todolist |
| 3 | 请求体（Pydantic 模型） | 四 |
| 4 | Path / Cookie / Header | todolist |
| 5 | 接口文档化 | todolist |
| 6 | 响应（response_model / 状态码 / 报错 / 表单 / 文件） | 五 |
| 7 | JSON 兼容 jsonable_encoder | 六 |
| 8 | 依赖注入 Depends | 七 |
| 9 | 安全：OAuth2 + JWT | 八 |
| 10 | 中间件 Middleware | 九 |
| 11 | 跨域 CORS | 十 |
| 12 | APIRouter 与多文件工程结构 | 十一 |
| 13 | 后台任务 Background Tasks | 十二 |
| 14 | 静态文件 / 子应用 / 代理 | 十三、十四、十五 |
| A | 常见报错与坑速查 | — |
| B | 项目补充技术（做项目时逐条追加） | — |
| C | **从零复现施工图**（按文件依赖顺序重建 `blog-api`） | — |

---

# 0. 环境、安装、启动

```bash
# 核心
pip install fastapi
pip install "uvicorn[standard]"

# 用到才装（遇到再装，别提前装一堆）
pip install python-multipart            # Form / File 必需
pip install "python-jose[cryptography]" # JWT 编解码
pip install "passlib[bcrypt]"           # 密码哈希
pip install aiofiles                    # StaticFiles 静态文件
pip install sqlalchemy                  # （项目阶段）数据库 ORM
```

> **项目阶段（`blog-api`）用 `conda` 环境做隔离 + `requirements.txt` 记录依赖**（不再全局乱装）；启动前先 `conda activate`，然后 `uvicorn app.main:app --reload`。详见 **附录 B.5**。

```bash
# 启动（在本目录下执行；main.py 里的变量名是 app）
uvicorn main:app --reload
```

| 地址 | 作用 |
|---|---|
| `http://127.0.0.1:8000/docs` | Swagger UI 交互式文档（最常用） |
| `http://127.0.0.1:8000/redoc` | ReDoc 风格文档 |
| `http://127.0.0.1:8000/openapi.json` | 自动生成的 OpenAPI 规范（JSON） |

**要点**
- `--reload`：改代码自动重启（开发期一直开着）。
- 改 `import`、加装饰器、加 `app.add_middleware` 后，稳妥起见手动重启一次。
- `/docs` 是 FastAPI 白送的，所有类型标注、Pydantic 模型都会自动变成文档。

---

# 1. 路径参数

**概念**：写在 URL 路径里的变量，用 `{}` 声明，函数参数名要和它**同名**。

```python
@app.get("/items/{item_id}")
async def read_item(item_id: int):     # 声明 int → 自动转换 + 校验
    return {"item_id": item_id}

@app.get("/users/{user_id}/items/{item_id}")   # 可以有多个路径参数
async def read_user_item(user_id: int, item_id: str):
    return {"owner_id": user_id, "item_id": item_id}
```

**要点/坑**
- 访问 `/items/3` → 得到 int `3`（不是 `"3"`），FastAPI 自动"解析"。
- 访问 `/items/foo` → **422**，错误信息里 `loc: ["path","item_id"]` 明确指出哪里错了。
- **固定路径必须写在动态路径前面**：`/items/me` 要写在 `/items/{item_id}` 之前，否则 `me` 会被当成 `item_id`。
- 函数参数名写错（和 `{}` 不一致）→ 会变成**查询参数**，不是报错，最容易被忽略。

---

# 2. 查询参数 + Query 校验

**概念**：**不属于路径参数**的其他函数参数，自动被当作查询参数（URL 里 `?a=1&b=2` 那部分）。

```python
from typing import Optional
from fastapi import Query

# 有默认值 → 可选；无默认值 → 必填
async def read_item(skip: int = 0, limit: int = 10): ...
async def read_item(q: Optional[str] = None): ...
async def read_user_item(item_id: str, needy: str): ...     # needy 必填，漏了报 422

# 需要更细的校验时，用 Query(...)
async def read_items(
    q: Optional[str] = Query(None, max_length=50),
    page: int = Query(1, ge=1),
    keyword: str = Query(..., min_length=2),    # ... 表示必填
): ...
```

| 校验参数 | 含义 |
|---|---|
| `min_length` / `max_length` | 字符串长度 |
| `regex` | 正则匹配 |
| `gt` / `ge` | 大于 / 大于等于 |
| `lt` / `le` | 小于 / 小于等于 |
| 第一个参数 | 默认值；写 `...` 表示必填 |

**要点/坑**
- 查询参数的"原始值"永远是字符串，声明类型后自动转换+校验（和路径参数同一套流程）。
- `bool` 也能自动转换：`?short=1` / `True` / `true` / `on` / `yes` 都 → `True`。
- `Query(None)` = 可选；`Query(...)` = 必填。**第一个参数写默认值，写 `...` 表示必填**（`...` 就是 Python 内置的 `Ellipsis`，这里当"没有默认值"的占位符）。
- 想收"多个同名参数"（`?q=a&q=b`）：声明成列表 → `q: list[str] = Query([])`。
- `Query` / `Path` / `Header` / `Cookie` 里还能写文档字段：`title` / `description` / `deprecated=True` / `alias="item-query"`，都会显示在 `/docs` 上。
- **比较运算符**：`gt` 大于、`ge` 大于等于、`lt` 小于、`le` 小于等于（**没有** `>` / `>=` 这种写法，只能写 `gt=0`）。
- **现代推荐写法是 `Annotated`**（校验规则与默认值分离，便于复用）：
  ```python
  from typing import Annotated
  async def read_items(q: Annotated[str | None, Query(max_length=50)] = None): ...
  ```
  注意：**校验写在 `Annotated[...]` 里，默认值写在 `=` 后面**，别把默认值也塞进 `Query`。两种写法都合法，本项目主用教材那种（默认值写法）。

---

# 3. 请求体（Pydantic 模型）

**概念**：客户端发给 API 的数据。用继承 `BaseModel` 的类声明，FastAPI 自动读 JSON、转换、校验、生成文档。

```python
from typing import Optional
from pydantic import BaseModel

class Item(BaseModel):
    name: str
    description: Optional[str] = None
    price: float
    tax: Optional[float] = None

@app.post("/items/")
async def create_item(item: Item):
    return item
```

**要点/坑**
- 模型属性有默认值 → 非必需；无默认值 → 必需；`= None` → 可选。
- **GET 不能带请求体**！要发送 body 只能用 POST / PUT / DELETE / PATCH。
- 函数里可直接用属性：`item.name`、`item.price`；转字典：`item.dict()`。
- 解包：`return {"item_id": item_id, **item.dict()}`。

**参数定位规则（三条，记死）**

1. 路径里声明过 → **路径参数**
2. 单一类型（int/float/str/bool…）→ **查询参数**
3. 类型是 Pydantic 模型 → **请求体**

```python
@app.put("/items/{item_id}")
async def create_item(item_id: int, item: Item, q: Optional[str] = None):
    result = {"item_id": item_id, **item.dict()}
    if q:
        result.update({"q": q})
    return result
```

> 不想用 Pydantic 时可以用 `Body(...)` 声明单个请求体字段（文档"请求体 - 多个参数"）。

**Pydantic v2 速记（现代写法，本项目都用这套）**

| 旧写法（v1 / 老教程） | 新写法（v2） | 说明 |
|---|---|---|
| `item.dict()` | `item.model_dump()` | 模型 → dict |
| `Item.parse_obj(d)` | `Item.model_validate(d)` | dict → 模型（会校验） |
| `class Config: orm_mode = True` | `model_config = ConfigDict(from_attributes=True)` | 允许从 ORM 对象读属性 |

- 校验规则写在 `Field()` 里，和 `Query` / `Path` 是同一套名字：`min_length` / `max_length` / `gt` / `ge` / `le`。
- 常用 `model_dump(exclude_unset=True)`：**只导出客户端真的传了的字段**，这是 PATCH 局部更新的关键。
- 三种字段状态要分清：`title: str`（必填）、`title: str = "x"`（有默认值）、`title: Optional[str] = None`（可选）。

---

# 4. Path / Cookie / Header

**概念**：和 `Query` 是同一家族的"参数声明工具"，区别只是**从哪取数据**。

```python
from typing import Optional
from fastapi import Cookie, Header, Path, Query

@app.get("/items/{item_id}")
async def read_items(
    item_id: int = Path(..., title="The ID of the item to get", ge=0, le=1000),
    q: str = Query(..., min_length=1),
    size: float = Query(..., gt=0, lt=10.5),
): ...

@app.get("/items-cookie/")
async def read_items_cookie(ads_id: Optional[str] = Cookie(None)): ...

@app.get("/items-header/")
async def read_items_header(user_agent: Optional[str] = Header(None)):
    return {"User-Agent": user_agent}
```

**要点/坑**
- `Path` 和 `Query` 的校验参数完全一样（`gt/ge/lt/le`、`min_length`…）。
- **路径参数天生必填**，所以 `Path(...)` 里的 `...` 只是占位符——它存在的意义是让你能在括号里写校验和文档参数。
- `Header` 的自动转换：参数名 `user_agent` ↔ 请求头 `User-Agent`（**下划线自动变连字符**）；如果请求头的名字**本身就含下划线**，要写 `Header(..., convert_underscores=False)`。
- `Cookie` / `Header` 和 `Query` 是同一套东西：校验参数、`...` 必填、`description` 全都通用，区别只是**数据从哪来**（URL 查询串 / URL 路径 / 请求头 / Cookie）。
- 自己写的依赖函数里也能用这些（如 `x_token: str = Header(...)`），但**这些参数不会出现在接口的 /docs 表单里**——这正是"门禁"的隐藏感。

---

# 5. 接口文档化

```python
@app.post(
    "/items/",
    response_model=Item,
    tags=["items"],                                  # 分组标签
    summary="Create an item",                        # 短标题
    description="详细说明……",                          # 长描述（没写则用 docstring）
    response_description="The created item",         # 响应区说明
    deprecated=True,                                 # 标记为废弃（仍可调用）
)
async def create_item(item: Item):
    """函数体第一行的三引号字符串 = docstring，自动进 /docs"""
    return item
```

**要点/坑**
- 装饰器多个参数时，**每个参数后都要有逗号**。
- `description` 优先；没写就用 docstring 顶上。
- `deprecated=True`：接口在 `/docs` 里显示灰色 `deprecated`，但依然能调用。
- 同一个 `tags` 的接口在 `/docs` 左侧自动归为一组。

---

# 6. 响应

## 6.1 response_model（响应模型）

```python
class ItemR(BaseModel):
    name: str
    description: Optional[str] = None
    price: float
    tax: Optional[float] = None
    tags: List[str] = []

@app.post("/items-r/", response_model=ItemR)
async def create_item_r(item: ItemR):
    return {"name": item.name, "price": item.price, "secret": "会被删掉", ...}

@app.post("/items-r2/", response_model=ItemR, response_model_exclude_unset=True)
async def create_item_r2(item: ItemR):
    return item

@app.get("/items-list/", response_model=List[ItemR])       # 列表响应
async def list_items_r(): ...
```

| 参数 | 作用 |
|---|---|
| `response_model` | 声明响应结构：**过滤**多余字段、**转换**类型、**生成文档** |
| `response_model_exclude_unset=True` | 只输出"用户真正设置过"的字段（不给 null / []） |
| `response_model_include={...}` | 只保留这些属性 |
| `response_model_exclude={...}` | 去掉这些属性 |

**要点/坑**
- **安全价值**：模板里没有的字段会被自动删除，防止不小心泄露数据（如 `secret`、密码哈希）。
- 不带 `exclude_unset` 时，模型所有字段都会输出，没传的用默认值（`Optional` → `null`，`= []` → `[]`）。
- `List[模型]` / `Set[str]` 从 `typing` 导入；`List` 有序可重复，`Set` 无序自动去重。

## 6.2 状态码

```python
@app.post("/create-ok/", status_code=201)
async def create_ok(name: str): ...
```

- **2xx 成功 / 4xx 客户端问题 / 5xx 服务端问题**。
- 常用：`200` 成功、`201` 创建成功、`400` 请求不对、`401` 未认证、`403` 无权限、`404` 找不到、`422` 校验失败。
- 推荐用常量表达（可读性更好）：`status_code=status.HTTP_201_CREATED`。

## 6.3 主动报错 HTTPException

```python
from fastapi import HTTPException, status

raise HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Item not found",
    headers={"WWW-Authenticate": "Bearer"},     # 可选
)
```

- `return` = 正常交回结果；`raise` = 主动制造异常、立刻中断函数。
- FastAPI 捕获后返回 `{"detail": "你写的说明"}`。
- 401 场景通常还要带 `headers={"WWW-Authenticate": "Bearer"}`。

## 6.4 表单 Form

```python
from fastapi import Form

@app.post("/login/")
async def login(username: str = Form(...), password: str = Form(...)):
    return {"username": username}
```

## 6.5 文件上传 File / UploadFile

```python
from fastapi import File, UploadFile

@app.post("/files/")                       # bytes 版：小文件，整体进内存
async def create_file(file: bytes = File(...)):
    return {"file_size": len(file)}

@app.post("/uploadfile/")                  # UploadFile 版：大文件，带元信息
async def create_upload_file(file: UploadFile = File(...)):
    return {"filename": file.filename}
```

**要点/坑**
- 必须 `pip install python-multipart`，否则**启动即报错**。
- `bytes`：适合小文件；`UploadFile`：有 `.filename`、`.read()`、`.write()`，适合大文件。
- `File(...)` / `Form(...)` 里的 `...` = 必填。

> 本项目落地（Form / 文件上传接口 + 三个真实必做的坑）见 **附录 B.8**。

---

# 7. JSON 兼容 jsonable_encoder

**概念**：把"高级对象"（Pydantic 模型、datetime…）转成**纯 JSON 兼容的普通数据**（datetime → 字符串）。

```python
from datetime import datetime
from fastapi.encoders import jsonable_encoder

class DbItem(BaseModel):
    title: str
    timestamp: datetime
    description: Optional[str] = None

fake_db = {}

@app.put("/db-items/{id}")
def save_item(id: str, item: DbItem):
    data = jsonable_encoder(item)     # datetime 已变成 "2026-09-09T12:00:00"
    fake_db[id] = data
    return {"saved": data}

@app.get("/db-items/{id}")
def load_item(id: str):
    return fake_db[id]
```

**要点/坑**
- JSON 格式不认识 `datetime`，只认识 字符串/数字/布尔/数组/对象。
- 平时 `return` 模型不用手动转，因为 FastAPI 发响应前内部替你调了 `jsonable_encoder`；但**存数据库那条路没有 FastAPI 帮忙**，要手动转。
- 它是"万能转换器"：模型→dict、datetime→str、`List[模型]`→列表的普通 dict。

---

# 8. 依赖注入 Depends

**概念**：把"多个接口都要用的公共逻辑/参数"抽成一个函数或类，让 FastAPI **自动调用并把结果塞给接口**。

## 8.1 函数依赖

```python
from fastapi import Depends

async def common_parameters(q: Optional[str] = None, skip: int = 0, limit: int = 100):
    return {"q": q, "skip": skip, "limit": limit}

@app.get("/items/")
async def read_items(commons: dict = Depends(common_parameters)):
    return commons
```

**执行过程**：FastAPI 发现 `Depends(common_parameters)` → 先调用依赖函数（它的参数也走"路径/查询参数"解析规则）→ 拿到返回值赋给 `commons` → 再执行接口函数。

## 8.2 类依赖

```python
class CommonQueryParams:
    def __init__(self, q: Optional[str] = None, skip: int = 0, limit: int = 100):
        self.q = q
        self.skip = skip
        self.limit = limit

@app.get("/items/")
async def read_items(commons: CommonQueryParams = Depends(CommonQueryParams)):
    ...
```

- `__init__` = 构造方法（创建对象时自动执行）；`self` = "这个对象自己"，把参数存到对象上，之后用 `commons.q` 取。

## 8.3 子依赖（嵌套）

```python
def query_extractor(q: Optional[str] = None):
    return q

def query_or_cookie_extractor(
    q: str = Depends(query_extractor),
    last_query: Optional[str] = Cookie(None),
):
    return q or last_query
```

- 依赖函数自己也能 `Depends` 别的依赖，形成一条链，FastAPI 自动按顺序解析。

## 8.4 给"一组/全部"接口批量加依赖

```python
async def verify_token(x_token: str = Header(...)):
    if x_token != "fake-super-secret-token":
        raise HTTPException(status_code=400, detail="X-Token header invalid")

@app.get("/items/", dependencies=[Depends(verify_token)])
async def read_items(): ...

app = FastAPI(dependencies=[Depends(verify_token)])     # 全局：所有接口
```

**要点/坑（重点）**
- `Depends(函数)` **函数不带括号**！带括号变成"立刻执行"。
- 上面 `dependencies=[...]` 里的依赖：**只要它不报错就放行**，它的返回值不会传给接口函数。
- 而 `commons: dict = Depends(func)` 这种写法：**返回值会传给接口**。
- 依赖能干任何事：查数据库、校验参数、验证登录——安全章节的 `get_current_user` 就是它。

## 8.5 依赖的四个易错点（项目实战补充）

> 复习第 1 轮（2026-09-13）暴露出来的漏洞，全部集中在依赖这一层。这四条是 FastAPI 最独特、Java 里没有对应物的部分。

### ① 执行顺序 = 签名顺序（后序：子依赖先跑），它决定返回 401 还是 404

```python
def get_own_post_or_404(
    post: Post = Depends(get_post_or_404),                  # ① 先跑
    current_user: User = Depends(get_current_active_user),  # ② 轮不到
) -> Post:
```

- 依赖树按**后序**执行：**先把自己的子依赖全跑完，再跑自己**。
- 同一层里，**按参数在签名里出现的顺序**，从左到右。

**后果**：`post` 排在前面 → 文章不存在时**直接 404**，`get_current_active_user` 根本没被执行 → **未登录的人请求不存在的文章，拿到的是 404 而不是 401**（等于告诉匿名用户"这篇文章不存在"）。

**想反过来（401 优先、不泄露"资源是否存在"）**：把 `current_user` 参数提到 `post` 前面。**只调一行，但接口行为变了。**

> 验证：`curl -i -X PATCH http://127.0.0.1:8000/posts/99999 -H "Content-Type: application/json" -d "{\"title\":\"x\"}"` → 现在回 404；调换顺序后回 401。

### ② 依赖缓存：同一请求内，同一个依赖只执行一次

`get_db` 在一个请求里被 `Depends` 多次（`get_post_or_404` 里一次、接口签名里一次），但**只执行一次**，两处拿到的是**同一个 Session 对象**。

这不是性能优化，是**正确性前提**：

```python
def update_post(payload, post = Depends(get_own_post_or_404), db = Depends(get_db)):
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(post, field, value)      # 脏标记打在 post 所属的那个 Session 上
    db.commit()                          # 必须提交【同一个】Session 才有效
```

假如每个 `Depends(get_db)` 都新建 Session：`post` 挂在 Session A，接口的 `db` 是 Session B → **B 手上没有任何待提交的改动 → 一条 UPDATE 都不会发出去** → 接口返回 **200**，**数据库一个字节没变**（而且 `reload` 出来的还是旧值）。

> 记住：**ORM 的脏跟踪是"按对象记账"的，账本在哪个 Session 上，就得由哪个 Session 提交。**

### ③ 中间件 ≠ 依赖：中间件里不能用 `Depends`，也拿不到 `current_user`

| | 中间件 | 依赖 |
|---|---|---|
| 作用范围 | **所有**请求（含静态文件、自动 404） | **单个**接口 |
| 位置 | 路由匹配**之前** | 路由匹配**之后**、函数体之前 |
| 能用 `Query` / `Path` / `Body` | ❌ | ✅ |
| 能用 `Depends` | ❌ 不在参数解析体系里 | ✅ 可嵌套 |
| 拿得到 `current_user` | ❌ 得自己解 token | ✅ 一行 |

> 一句话：**中间件是门卫（看得见人、不认识档案）；依赖是前台（会查档案）。** 需要"知道是谁"的时候就用依赖。

### ④ 权限判断要"失败即拒绝"（fail closed）

```python
if post.author_id != current_user.id:      # ✅ 无主文章：None != 5 → 403，谁都改不了
    raise HTTPException(403, ...)
```

不要写成：

```python
if post.author_id is not None and post.author_id != current_user.id:   # ❌ 无主文章被放行
    raise HTTPException(403, ...)
```

多出来的 `is not None` 就是漏洞：**`author_id` 为 `None` 的老数据会绕过整个判断，变成"任何登录用户都能改"。**

> 规律：**权限判断宁可多拦，不可漏放。** 用 `!=` 是"默认拒绝"，多写一个 `is not None` 就变成"默认放行"。

---

# 9. 安全：OAuth2 + JWT

**整体流程**

```
① 客户端 POST /token 提交 username + password（表单）
② 服务端校验密码 → 签发 JWT（内含 sub=username、exp=过期时间）
③ 客户端后续请求带请求头：Authorization: Bearer <token>
④ 服务端解码校验 token → 取出用户 → 放行接口
```

## 9.1 密码哈希（永不存明文）

```python
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)
```

## 9.2 JWT

```python
from datetime import datetime, timedelta
from jose import JWTError, jwt

SECRET_KEY = "openssl rand -hex 32 生成的一长串"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
username = payload.get("sub")
```

- JWT **没有加密**，任何人都能解出内容；但它有**签名**，能验证"是不是我发的、有没有被改过"。
- 过期后必须重新登录；改写 `exp` 会因签名不匹配被发现。

## 9.3 登录接口 + 当前用户依赖

```python
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    user = get_user(fake_users_db, username=token_data.username)
    if user is None:
        raise credentials_exception
    return user

async def get_current_active_user(current_user: User = Depends(get_current_user)):
    if current_user.disabled:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

@app.post("/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    user = authenticate_user(fake_users_db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(
        data={"sub": user.username},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/users/me/", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_active_user)):
    return current_user
```

**要点/坑**
- 用 `Depends(get_current_active_user)` 保护的接口，在 `/docs` 里会多个 🔒，点 **Authorize** 登录后所有请求自动带 token。
- **`OAuth2PasswordBearer`**：负责"访问 `tokenUrl` 拿 token"，并从 `Authorization: Bearer xxx` 里自动取出 token 交给你的依赖。
- **`OAuth2PasswordRequestForm`** 是一个**类依赖**，自动解析表单字段：`username`、`password`，以及可选的 `scope`、`grant_type`、`client_id`、`client_secret`。
- `Token` 模型 = `access_token` + `token_type`。
- 线上 `SECRET_KEY` 必须放环境变量，绝不进代码仓库。
- **常见坑**：`AttributeError: module 'bcrypt' has no attribute '__about__'` 是 passlib 与新版本 bcrypt 不兼容，`pip install "bcrypt==4.0.1"` 即可解决。

---

# 10. 中间件 Middleware

**概念**：插在"请求进来"和"响应出去"两头的关卡，**对所有接口生效**。

```
请求 → [中间件：前处理] → 路径操作 → [中间件：后处理] → 响应
```

```python
import time
from fastapi import FastAPI, Request

@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()                          # 前处理
    response = await call_next(request)               # 放行，等接口处理完
    response.headers["X-Process-Time"] = str(time.time() - start_time)   # 后处理
    return response
```

**要点/坑**
- `call_next` 是 FastAPI 自动传给你的函数，作用是"把请求继续往下传"，返回接口产生的 response。
- **`await`**：`async def` 里等耗时结果要写 `await`；等待期间服务器去处理别的请求（这就是 FastAPI 异步高性能的原因）。
- **响应头的值必须是字符串**，数字要 `str(...)`，否则 `TypeError`。
- 中间件跑在**所有**请求上，包括 `/docs`、`/openapi.json`。
- 多个中间件：**洋葱模型**，最后注册的包在最外层、最先执行。
- 再看两个可用属性：`request.method`、`request.url.path`、`response.status_code`。

---

# 11. 跨域 CORS

**概念**：浏览器有"同源策略"——**协议 + 域名 + 端口**三者全一样才算同源。前端页面（如 `localhost:3000`）用 JS 请求后端（`localhost:8000`）会被**浏览器**拦截。CORS 即后端发响应头告诉浏览器"我允许哪些源"。

```python
from fastapi.middleware.cors import CORSMiddleware

origins = [
    "http://localhost.tiangolo.com",
    "https://localhost.tiangolo.com",
    "http://localhost",
    "http://localhost:8080",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

| 参数 | 含义 |
|---|---|
| `allow_origins` | 允许的**源**列表；`["*"]` = 任何源 |
| `allow_origin_regex` | 正则匹配源，如 `'https://.*\.example\.org'` |
| `allow_methods` | 允许的 HTTP 方法，默认只有 `["GET"]`；`["*"]` = 全部 |
| `allow_headers` | 允许的请求头，默认 `[]`；`["*"]` = 全部（Accept / Accept-Language / Content-Language / Content-Type 总是允许） |
| `allow_credentials` | 是否支持 cookies，默认 `False`。**为 True 时 `allow_origins` 不能是 `["*"]`**，必须写具体源 |
| `expose_headers` | 浏览器 JS 可读取的响应头，默认 `[]` |
| `max_age` | 浏览器缓存 CORS 结果的时间（秒），默认 600 |

**验证（命令行模拟浏览器）**

```bash
curl.exe -i -H "Origin: http://localhost:8080" http://127.0.0.1:8000/xxx
# 看响应头里有没有 access-control-allow-origin
```

**要点/坑**
- 被拦的是"响应到浏览器之后"，**命令行不受同源策略限制**，所以 curl 不会有拦截现象。
- `app.add_middleware(...)` 是中间件的第二种用法：框架自带的、带配置的中间件。

---

# 12. APIRouter 与多文件工程结构

## 12.1 同文件内分组

```python
from fastapi import APIRouter, Depends, HTTPException

items_router = APIRouter(
    prefix="/items",                                  # 路径前缀
    tags=["items"],                                   # 整组标签
    dependencies=[Depends(verify_token)],             # 整组统一依赖
    responses={404: {"description": "Not found"}},    # 文档补充响说明
)

@items_router.get("/")
async def read_items(): ...

app.include_router(items_router)                      # 千万别忘
```

**要点/坑**
- `router` = "小号 app"，**不能启动服务器**，必须 `include_router` 挂到 app 上。
- 路径拼接 = **前缀 + 接口路径直接字符串相加**。`prefix` 结尾别写 `/`，接口路径要以 `/` 开头，否则出现 `//`。
- 单个接口的 `tags=` 会**覆盖**整组的（如 `@router.put("/{item_id}", tags=["custom"])` 会跑进 custom 分组）。
- `prefix` / `tags` / `responses` 都能被组内接口继承。
- `include_router(router, prefix="/api", tags=["api"])` 可以**再叠加**一层。

## 12.2 拆成多文件

```
项目目录/
├── main.py            # 创建 app + include_router 组装
├── dependencies.py    # 公共依赖函数
└── routers/
    ├── __init__.py    # 空文件：标记 routers 是"包"
    ├── users.py
    └── items.py
```

```python
# routers/items.py
from fastapi import APIRouter, Depends, HTTPException
from dependencies import get_token_header          # 绝对导入（推荐新手）

router = APIRouter(prefix="/items", tags=["items"],
                   dependencies=[Depends(get_token_header)],
                   responses={404: {"description": "Not found"}})

# main.py
from fastapi import FastAPI
from routers import items, users

app = FastAPI()
app.include_router(users.router)
app.include_router(items.router)
```

**要点/坑**
- **一个 `.py` 文件 = 一个模块**；`from 模块 import 名字` 就是"打开那个文件取出里面的变量"。
- 文件夹 + **空 `__init__.py`** = 一个"包"，才能 `from routers import items`。
- **导入起点 = 你运行 `uvicorn` 时所在的目录**（不是当前文件所在目录）——新手第一大坑。
- `.` = 当前文件夹，`..` = 上一级（文档里的 `from ..dependencies import ...` 就是这个意思，属相对导入）。
- 启动命令不变：根目录执行 `uvicorn main:app --reload`。
- **不要**在 `routers/*.py` 里 `import main`，会造成**循环导入**。

---

# 13. 后台任务 Background Tasks

**概念**：响应发出**之后**才执行的任务；用户不用等（发通知邮件、写日志、生成缩略图）。

```
请求 → 执行接口函数 → add_task 只是"排队" → 立刻 return 响应
                                   ↓（响应发出后）
                             后台函数才真正执行
```

```python
from fastapi import BackgroundTasks

def write_notification(email: str, message=""):
    with open("log.txt", mode="w") as email_file:          # "w" 覆盖写，"a" 追加，"r" 只读
        content = f"notification for {email}: {message}"   # f-string：{} 里嵌变量
        email_file.write(content)

@app.post("/send-notification/{email}")
async def send_notification(email: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(write_notification, email, message="some notification")
    return {"message": "Notification sent in the background"}
```

**要点/坑**
- `background_tasks.add_task(函数, 参数...)`：第一个参数是**函数本身，不带括号**（和 `Depends` 同理）。
- `with open(...) as f:` = 用完自动关文件；`.write()` 只能写字符串。
- 想"看见"后台效果：后台函数里 `time.sleep(3)`，会看到响应**立刻**返回、`log.txt` 3 秒后才更新。
- 后台任务是**普通 `def`**（不是 `async def`）时，FastAPI 会放到**线程池**执行，不会阻塞主服务。
- 反过来：**`async def` 里不要做阻塞操作**（如 `time.sleep`），会卡死整个服务。

---

# 14. 静态文件 / 子应用 / 代理

## 14.1 静态文件

```python
from fastapi.staticfiles import StaticFiles       # 注意在子模块里

app.mount("/static", StaticFiles(directory="static"), name="static")
```

- 需要 `pip install aiofiles`。
- 把磁盘上的 `static/` 文件夹对外公开：`GET /static/hello.txt`、`/static/logo.png`。
- **坑**：`directory` 是相对"启动目录"的路径；文件夹不存在会**直接启动报错**。
- `mount` 独占该前缀，别再写同前缀的接口。

## 14.2 子应用

```python
subapi = FastAPI()

@subapi.get("/sub")
def read_sub():
    return {"message": "Hello World from sub API"}

app.mount("/subapi", subapi)
```

| | `include_router(router)` | `app.mount("/x", subapp)` |
|---|---|---|
| 挂什么 | 一组**路由** | 一个**完整 FastAPI 应用** |
| 文档 | 合并进主应用 `/docs` | 子应用有自己独立的 `/subapi/docs` |
| 中间件/配置 | 共用主应用 | 子应用自己一套 |
| 场景 | 自己业务拆分 | 挂独立/第三方系统 |

- 子应用内部路径 `/sub`，对外访问是 `/subapi/sub`（挂载前缀由主应用管）。

## 14.3 代理 root_path

```python
app = FastAPI(root_path="/api/v1")
# 或启动时：uvicorn main:app --root-path /api/v1
```

- 场景：部署在 Nginx 后面，外部路径是 `https://example.com/api/v1/items`，Nginx 剥掉 `/api/v1` 再转发。
- 作用：告诉 FastAPI "你的真实前缀是什么"，让 `/docs` 里的请求地址正确。
- 本地开发用不到，记住名字即可。

---

# 附录 A：常见报错与坑速查

| 现象 | 原因 / 解决 |
|---|---|
| **422 Unprocessable Entity** | 类型不符或必填项缺失；看返回里 `loc` 定位（`path`/`query`/`body`） |
| **404** | 路径写错、忘 `include_router`、`mount` 抢了前缀 |
| **405 Method Not Allowed** | 用了没声明的 HTTP 方法（如用 GET 调 POST 接口） |
| **307 重定向 / 结尾斜杠** | 路径 `/items` vs `/items/`；注意 `prefix` 与路径的斜杠拼接 |
| 固定路径被动态路径吃掉 | `/items/me` 必须写在 `/items/{item_id}` **前面** |
| 参数名和 `{}` 不一致 | 会静默变成**查询参数**，不报错，最难发现 |
| GET 带请求体失败 | **GET 不能带请求体**，改用 POST/PUT/PATCH |
| 启动报 `python-multipart` 相关错误 | 用了 `Form`/`File` 但没装：`pip install python-multipart` |
| `TypeError: expected string ...` | 响应头的值不是字符串，`str(数值)` |
| `Depends(func())` 报错 / 行为异常 | `Depends` 里**函数不要带括号** |
| `ModuleNotFoundError: No module named 'routers'` | 导入起点不对：要在根目录启动；`routers/__init__.py` 是否存在 |
| `ImportError: cannot import name 'router'` | 文件里没写 `router = APIRouter()` |
| `RuntimeError: Directory 'static' does not exist` | `StaticFiles(directory=...)` 目录不存在 |
| `AttributeError: module 'bcrypt' has no attribute '__about__'` | passlib 与新版 bcrypt 不兼容：`pip install "bcrypt==4.0.1"` |
| 循环导入报错 | `routers/*.py` 里不要 `import main` |
| 数据"泄露" | 用 `response_model` 过滤输出字段 |
| 密码明文入库 | 只存 `get_password_hash()` 的结果 |
| 接口在 `/docs` 里不出现 | 装饰器写错、`include_router` 忘写、重复函数名被覆盖 |
| **PATCH 传 `null` 报 500** | `exclude_unset=True` 只排除"**没出现**在请求体里的字段"，**不排除"传了 null"**。`{"title": null}` 会被写进 NOT NULL 列 → `IntegrityError` → 500。要在 schema 里用 `field_validator` 把 null 拦成 422（详见 §8.5） |
| **未登录却返回 404 而不是 401** | 依赖按**签名顺序**执行；`Depends(get_post_or_404)` 排在 `Depends(get_current_active_user)` 前面，先 404 了。把 `current_user` 参数提到前面即可（详见 §8.5 ①） |
| **中间件里写 `Depends` 不生效** | 中间件不是路径操作函数，不走参数解析 / 依赖注入体系；中间件里要认人得自己解 token（详见 §8.5 ③） |
| **接口返回 200，但数据库没变** | 多半是"改的对象"和"`commit()` 的 Session"不是同一个（依赖缓存被破坏 / 手写了第二个 `Session`）（详见 §8.5 ②） |

---

# 附录 B：项目补充技术（做项目时逐条追加）

> 约定：下面每条都是**做项目时才引入**的新技术，会先带学一遍（概念 → 骨架卡 → 为什么要用），然后记录在此处。
> 项目：`blog-api`（博客 API）。技术选型一律走"现代 + 与 FastAPI 适配"的路线。

### 📍 项目阶段速查（`blog-api` 走到哪了）

| 阶段 | 主题 | 手册位置 |
|---|---|---|
| 1 | 项目骨架：配置管理 / ORM 接通 / conda 环境 | B.1 ~ B.5 |
| 2 | 数据库换成 MySQL（Docker + 驱动 + 连接串） | B.6 |
| 3 | 路由分层 / 接口拆分（APIRouter） | 基础 #12 |
| 4 | ORM 模型 + 建表 + CRUD 六件套 | B.7 |
| 5 | 响应模型 / 状态码 / 表单 / 文件上传 | B.8 |
| 6 | 依赖注入落地：分页参数 + 404 校验 | B.9 |
| 7 | 用户注册与密码哈希 | B.10 |
| 8 | 登录与 JWT（当前用户依赖） | B.11 |
| 9 | 文章归属与权限（401 / 403） | B.12 |
| 10 | 关联对象与 N+1（`selectinload`） | B.13 |
| 11 | 数据库迁移 Alembic（**已结课**） | B.14 |
| 12 | 浏览量计数：原子更新 + 读写分离（**已结课**） | B.15 |
| 13 | 前端页面：FastAPI 托管静态页 + 原生 JS 对接（**已结课**） | B.16 |
| 14 | 浏览量防刷：Redis 去重窗口 + 降级（**已结课**） | B.17 |
| 15 | 评论功能：第二张表 + 两外键 + 级联删除（**已结课**） | B.18 |
| 16 | 评论回复：自关联（一张表指向自己）+ 递归级联 + 规范化（**已结课**） | B.19 |
| 17 | pytest：测试库隔离 + fixture + 数据工厂 + mock 取舍（**已结课**，104 条用例） | B.20 |

> 阶段号 = 上课的时间线；附录 B 的编号 = 记入手册的顺序，基本一一对应。
>
> **⏸ 项目暂停于阶段17（2026-09-12）**，104 条 pytest 全绿。
> 接下来进入**手工复现期**（独立重建 `blog-api-copy`）——
> 复现请用 **附录 C**：它把这 17 个阶段的知识按**文件依赖顺序**重排了一遍。
> 附录 B 是"上课顺序"，拿它照着一行行敲会很难受（很多知识是后置补充的）。

---

## B.1 配置管理：pydantic-settings（阶段1）

**为什么**：密钥（`SECRET_KEY`）、数据库地址这类东西**不能写死在代码里**（会进代码仓库）；换环境（本机 / 服务器）应该只改配置、不改代码。

**概念**：`pydantic-settings` 是 Pydantic 官方出的配置库。定义一个 `BaseSettings` 子类，**类属性 = 配置项**，它会自动从**环境变量 / `.env` 文件**里读取并完成类型转换与校验。写法和 Pydantic 模型完全一致，所以你已经会了。

```python
# 安装：pip install pydantic-settings
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",            # 从 .env 读
        env_file_encoding="utf-8",
        extra="ignore",             # .env 里多余的变量忽略，不报错
    )

    PROJECT_NAME: str = "Blog API"        # 等号右边 = 没配置时的默认值
    DATABASE_URL: str = "sqlite:///./blog.db"
    SECRET_KEY: str = "dev-only-change-me"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

settings = Settings()          # 模块级单例
```

**要点/坑**

- 字段名（大写）对应 `.env` 里的变量名，**大小写不敏感**。
- 类型自动转换：`.env` 里全是文本，但 `ACCESS_TOKEN_EXPIRE_MINUTES` 声明为 `int` 就会转成整数。
- **`.env` 必须写进 `.gitignore`**，只把 `.env.example` 提交进仓库（模板，不含真实密钥）。
- 生成密钥：`python -c "import secrets; print(secrets.token_hex(32))"`（跨平台，比 `openssl` 方便）。
- 类型是 `list` 的配置项，在 `.env` 里要写成 JSON 数组格式（如 `["http://localhost:3000"]`），这是常见困惑点。
- 别处统一 `from app.core.config import settings`，**不要再到处 `os.getenv`**。

---

## B.2 数据库 ORM：SQLAlchemy 2.0 接通（阶段1）

**为什么**：之前数据都在内存的 `fake_db` 里，一重启就没了。要持久化必须用数据库。

**概念**：ORM（对象关系映射）= 把"数据库的表"映射成"Python 类"，把"一行数据"映射成"一个对象"。你不用手写 SQL，用 Python 对象操作，ORM 帮你翻译成 SQL。SQLAlchemy 是 Python 生态最主流的 ORM。

四个核心件（记住这张表就行）：

| 名字 | 是什么 | 类比 |
|---|---|---|
| `engine` | 引擎，管到数据库的连接，**全应用只建一个** | 数据库的"总接线口" |
| `SessionLocal` | 会话工厂，每次请求用它造一个会话 | "临时工作台" |
| `Base` | ORM 基类，所有数据模型继承它 | 表的"户口本" |
| `get_db` | FastAPI 依赖，每个请求一个会话 | 给接口发工作台 |

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.core.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False}
    if settings.DATABASE_URL.startswith("sqlite") else {},
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

class Base(DeclarativeBase):        # SQLAlchemy 2.0 风格
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

**要点/坑**

- SQLite 用 `sqlite:///./blog.db`（**相对启动目录**）；换 MySQL/PostgreSQL 只改 `.env` 里 `DATABASE_URL` 一行。
- SQLite 必须加 `connect_args={"check_same_thread": False}`：同步接口跑在线程池，不同线程共用连接会报错。
- **2.0 风格**：用 `DeclarativeBase`（不要用旧的 `declarative_base()`）；查询用 `select()`（不要用旧的 `db.query()`）——具体怎么写见 **B.7**。
- 执行原生 SQL：`db.execute(text("SELECT 1")).scalar()`（`text()` 包住 SQL，`.scalar()` 取第一行第一列）。

---

## B.3 生成器依赖：`yield` 版 Depends（阶段1）

**概念**：依赖函数里用 `yield`，就可以分成"**请求前准备**"和"**请求后清理**"两段。FastAPI 会自动在响应返回后、执行 `yield` 之后的代码。

```python
def get_db():
    db = SessionLocal()      # ← 请求进来之前：准备资源
    try:
        yield db             # ← 把会话交给接口使用
    finally:
        db.close()           # ← 请求结束（含接口报错）：一定执行清理
```

**要点/坑**

- `yield` 之前 = 准备，`yield` 之后 = 清理；`finally` 保证**即使接口抛异常也会关闭会话**（防连接泄漏）。
- 这是 FastAPI 里管理"需要回收的资源"（数据库会话、文件、锁）的标准写法。
- 对应的接口参数写 `db: Session = Depends(get_db)`，和普通依赖一模一样。

**谁在调用 `next()`？**（常见疑问：*"我从没写过 `get_db().next()`"*）

因为 **`get_db` 是生成器函数，光调用它一行代码都不会执行**：

```python
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

g = get_db()      # ⚠️ 一行没跑，只是拿到一个"生成器对象"
next(g)           # ← 只有这一下，才真正执行到 yield，拿到 db
```

生成器是**懒的**：光调用不执行，必须有人 `next()` 推它一下。**而那个"推的人"就是 FastAPI**：

- 解析依赖时先判断 `inspect.isgeneratorfunction(调用目标)`；
- **不是**生成器（如 `get_current_user`）→ 直接调用一次，返回值直接用；
- **是**生成器（`get_db`）→ 用 `contextlib.contextmanager` 把它包成上下文管理器，挂到内部的 `AsyncExitStack` 上：
  - 进入接口时：`next(gen)` → 拿到 `db` 交给接口用
  - 请求结束时：再推进一次 → 触发 `finally: db.close()`

所以 `next()` 其实被调用了**两次**，只是都发生在 FastAPI 内部。

**因此写法上有一条铁律**：

| 写法 | 传进去的是什么 | 结果 |
|---|---|---|
| ✅ `Depends(get_db)` | **函数本身** | FastAPI 负责调用 + 推进 —— 正确 |
| ❌ `Depends(get_db())` | 一个**生成器对象** | 不再是可解析的依赖源 → 出错 |

> **`Depends(...)` 里永远放"函数名"，不放"函数调用的结果"。**
> 这背后是 Python 里反复出现的模式 —— **"延迟调用"**：传函数（或生成器）而不是传值，把"什么时候调"交给框架决定。`Depends` 是这样，`BackgroundTasks` 也是这样。

---

## B.4 同步 ORM 与 `def` / `async def` 的搭配（阶段1）

**规则（很重要）**：

- 用**同步** SQLAlchemy 会话时，接口写成 **`def`**（不是 `async def`）。FastAPI 会把同步接口**丢到线程池**执行，所以阻塞的数据库操作**不会卡住事件循环**。
- 用 `async def` 接口 + 同步 ORM，等于"在异步函数里做阻塞操作"——正是之前反复强调的红线。
- 反过来，纯计算/不碰数据库的接口可以放心用 `async def`。

> 后面阶段7 会做**异步改造**（`AsyncSession` + `aiosqlite`），那时候接口才改成 `async def` + `await`。两种都要会，不是省略。

---

## B.5 依赖与环境管理：conda 环境 + requirements.txt（阶段1）

**为什么**：手动全局 `pip install` 有三个问题——① 装了哪些包、什么版本，没记录；② 装到全局环境，不同项目互相污染；③ 换台机器/换个人，环境装出来不一样，出现"我这能跑你那不能跑"。

**概念**：把上面三个问题分给两个工具，**各管一段，不重叠**：

| 工具 | 负责 |
|---|---|
| **conda** | **环境隔离**：给项目一个独立的 Python（独立解释器 + 独立 site-packages），项目之间互不污染 |
| **pip** | **装包**：往"当前已激活"的那个环境里装 |
| **requirements.txt** | **记录清单**：这个项目需要哪些包 |

一句话：**conda 给房间，pip 往里搬东西，requirements.txt 是搬运清单。**
关键点：`requirements.txt` **本身不提供隔离**，隔离是 conda 环境的职责——这正是它和 pipenv 的根本差别（pipenv 把两件事合成一个工具）。

**三个文件**（本项目实际用的）：

| 文件 | 谁写 | 内容 | 是否提交 |
|---|---|---|---|
| `requirements.txt` | **人写** | 运行依赖（包名 + 版本约束） | 提交 |
| `requirements-dev.txt` | **人写** | 开发/测试依赖，第一行 `-r requirements.txt` 把运行依赖也带上 | 提交 |
| `requirements.lock.txt` | `pip freeze` 生成（可选） | **全部**依赖的精确版本（含间接依赖） | 按需提交 |

### 骨架卡：requirements.txt

```text
fastapi>=0.115
uvicorn[standard]>=0.30      # extras 直接写方括号，和 pip 命令里完全一样
bcrypt==4.0.1                # == 锁死版本；>= 表示"不低于"
pydantic-settings>=2.4
sqlalchemy>=2.0
```

```text
# requirements-dev.txt
-r requirements.txt          # 先把运行依赖也装上
pytest>=8.0
httpx>=0.27
```

### 命令速查（本项目 · Windows / PowerShell）

```bash
conda create -n blog-api python=3.12 -y   # 给项目单独建环境（推荐；也可复用已有环境）
conda activate blog-api                   # 激活：之后所有命令都跑在这个环境里
cd blog-api

python -m pip install -r requirements-dev.txt   # 装依赖
python -m pip list                              # 看装了什么
python -m pip freeze > requirements.lock.txt    # 记录精确版本（可选）

uvicorn app.main:app --reload             # 启动（已激活环境，直接敲）
conda deactivate                          # 退出环境
conda env list                            # 看所有环境
```

### 要点/坑

- **一定用 `python -m pip`，不要直接敲 `pip`**：conda 环境里 `pip` 可能指向别的解释器的 pip，包装到哪去了很难查。`python -m pip` 保证装进"当前这个 python"。
- **必须先 `conda activate`**：忘了激活，包就装进 `base` 了。装完可用 `python -c "import fastapi; print(fastapi.__file__)"` 确认路径在环境目录里。
- **同一个包不要 conda install 和 pip install 混用**：两套依赖记录互不知情，会互相覆盖。本项目**统一走 pip**。
- extras 写法：requirements.txt 里直接写 `uvicorn[standard]`（和命令行一致），比 Pipfile 的 TOML 字典写法直观得多。
- `requirements.txt` 只记**直接依赖**；`pip freeze` 记的是**全部依赖（含间接）的精确版本**。要严格复现就用后者（本项目可选）。
- `.env` **不会**被 conda 自动加载，但我们用 `pydantic-settings` 显式读它（见 B.1），所以不需要额外处理。
- conda 的原生清单是 `conda env export > environment.yml`（含平台信息，跨平台复现性一般），本项目不用——知道它是"Conda 版的清单"即可。
- 换台机器：装 conda → `conda create -n blog-api python=3.12` → `conda activate blog-api` → `python -m pip install -r requirements-dev.txt`。
- 进阶：`pipenv` / `Poetry` / `uv` 是"环境 + 依赖"二合一的更严格方案（带锁文件），等阶段 10 实战后按需再学；现在多一层概念不划算。

---

## B.6 数据库换成 MySQL：Docker 起库 + 驱动 + 连接串（阶段2）

**为什么**：SQLite 是**文件**数据库，零配置、适合自己玩，但并发写弱、没有真正的用户/权限体系。真实项目跑的是 MySQL / PostgreSQL。

**概念**：在 SQLAlchemy 里**换数据库几乎只要改两处**——① 装对应驱动；② 改 `DATABASE_URL`。**ORM 代码一行都不用动**，这就是 ORM 的价值。

### 连接串格式（记死）

```text
<方言>+<驱动>://<用户>:<密码>@<主机>:<端口>/<库名>?charset=utf8mb4

mysql+pymysql://blog:blog123456@127.0.0.1:3306/blog?charset=utf8mb4
```

- `mysql` 是**方言**（SQLAlchemy 用哪个数据库），`pymysql` 是**驱动**（用哪个 Python 包去连）。
- `charset=utf8mb4`：MySQL 存中文、emoji **必须**用 `utf8mb4`（别用 `utf8`，它是阉割版）。
- 改库时**只改这一行**，`database.py` / 模型 / 接口全都不动。

### 驱动怎么选

| 驱动 | 包名 | 说明 |
|---|---|---|
| **PyMySQL** | `PyMySQL` | **纯 Python，免编译**，Windows 最省事（本项目用这个） |
| mysqlclient | `mysqlclient` | 更快，但 Windows 要编译，容易装不上 |
| asyncmy / aiomysql | | 异步版，阶段 7 做异步改造时才用 |

### Docker 起一个 MySQL（本项目用）

```bash
docker run -d --name blog-mysql -e MYSQL_ROOT_PASSWORD=root123456 -e MYSQL_USER=blog -e MYSQL_PASSWORD=blog123456 -e MYSQL_DATABASE=blog -e TZ=Asia/Shanghai -p 3306:3306 mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

> PowerShell 里换行要写反引号（`` ` ``），容易出错，直接粘这一整行最省事。

常用命令：

```bash
docker ps                                    # 容器在不在、端口映射对不对
docker logs blog-mysql                       # 看初始化日志，出现 "ready for connections" 才好
docker exec -it blog-mysql mysql -ublog -pblog123456 blog -e "select 1"   # 进库验证
docker stop blog-mysql                       # 停
docker start blog-mysql                      # 再启动（数据还在）
docker rm -f blog-mysql                      # 删掉容器（数据一起没）
```

### 要点/坑

- **`-e MYSQL_DATABASE=blog` 会自动建库**；手动建库要写 `CREATE DATABASE blog CHARACTER SET utf8mb4;`。
- **首次启动要初始化 20~30 秒**，期间连不上是正常的，先看 `docker logs`。
- **端口冲突**：本机已装 MySQL 占了 3306 时，改用 `-p 3307:3306`，连接串里的端口同步改成 3307。
- **报错 `RuntimeError: cryptography is required for sha256_password or caching_sha2_password`**
  - **原因**：MySQL 8 默认的认证插件是 `caching_sha2_password`。密码不能明文走网络，所以非 SSL 连接下要先拿服务端 RSA 公钥把密码加密再发；而 PyMySQL 自己不做 RSA 运算，它调用 `cryptography` 包来实现。包没装 → PyMySQL 宁可直接报错，**也不会降级用明文**（安全优先）。
  - **解决**：`python -m pip install cryptography`（已写进本项目 `requirements.txt`）。
  - 老教程里常见 `--default-authentication-plugin=mysql_native_password`，那是**换掉认证插件来绕过**这个问题，属于退而求其次，不建议当标准做法。
- **报错 `MySQL server has gone away` / `Lost connection to MySQL server`**
  - **原因**：MySQL 会主动掐掉长时间**空闲**的连接（服务端 `wait_timeout`，默认 8 小时）；SQLAlchemy 的连接池并不知道那条连接已经死了，下次直接拿来用就炸。
  - **解决**：引擎上加两个参数——
    - `pool_pre_ping=True`：**取连接前先轻量探活**（ping），发现死了就换一条新的。最实用的一个。
    - `pool_recycle=3600`：连接**最多复用 1 小时**就主动回收重建，保证它的年龄永远小于服务端的 timeout。
  - 这两个参数对 SQLite 也无害，所以直接写在引擎上、不用按方言分支。
- **数据存在容器里**：`docker rm` 后数据全丢；要保留就挂数据卷 `-v blog-mysql-data:/var/lib/mysql`。
- **表不会自动创建**：`Base.metadata.create_all(engine)`（开发）或 Alembic 迁移（正式）才会建表，后面的阶段讲。
- SQLite 的 `connect_args={"check_same_thread": False}` **只对 SQLite 有意义**，代码里已按方言判断，MySQL 分支传空字典。
- 换库之后 `/health/db`（`SELECT 1`）就是最快的连通性验证。

---

## B.7 ORM 模型 + 建表 + CRUD：数据真正入库（阶段4）

**为什么**：前面数据都在内存列表里，一重启就还原；连接池虽然接通了，但一张表都没有。这一步把「内存假数据」换成「数据库真数据」，并加上增删改。

**概念**：这一层有 **三件不同的事**，别混：

| 事 | 谁负责 | 在哪 |
|---|---|---|
| 表长什么样 | ORM 模型（`class Post(Base)`） | `app/models/` |
| 接口收发什么 | Pydantic 模型（`PostCreate` / `PostRead`） | `app/schemas/` |
| 怎么读写数据 | 会话操作（`select` / `add` / `commit`） | 路由里 |

> **ORM 模型 ≠ Pydantic 模型**。前者对应**数据库表**（含 id、created_at），后者对应**对外契约**（客户端只该传 title/content/published）。真实项目几乎都分两套，因为两者变化的原因不同。

### 骨架卡 1：ORM 模型（`app/models/post.py`）

```python
from datetime import datetime
from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(100), index=True)
    content: Mapped[str] = mapped_column(Text)
    published: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
```

**类型怎么选**（够用版）：`int` → `Integer`；`str` → `String(长度)` / 长文本 `Text`；`bool` → `Boolean`；`datetime` → `DateTime`；金额别用 float，用 `Numeric`。

**两个默认值别搞混**：
- `default=` 是 **Python 层**（ORM 插入时填，`Base` 看不到这个默认值）；
- `server_default=func.now()` 是 **数据库层**（DDL 里就是 `DEFAULT CURRENT_TIMESTAMP`，用 SQL 直接插也有值）。
- `onupdate=func.now()`：每次 UPDATE 自动刷新（自动维护"更新时间"的标准做法）。

**注意**：`Mapped[...]` 里没有 `Optional` 就是 `NOT NULL`；想允许空就写 `Mapped[Optional[str]]`。

### 骨架卡 2：建表

```python
Base.metadata.create_all(bind=engine)   # 只建"还不存在的表"，已存在的表不动
```

- 模型类**必须被 import 过**才会注册进 `Base.metadata`，所以 `app/models/__init__.py` 里统一 `from app.models.post import Post`。
- 开发期用 `create_all` 够了；**正式项目要改字段时用 Alembic 迁移**（新增列、改类型不会丢数据），这个后面单独讲。
- 建表不在服务启动时做，用独立脚本（本项目 `app/seed.py`）——服务只管读写。

### 骨架卡 3：CRUD 六件套

```python
# 查（多条）：select + where + order_by + offset/limit
posts = db.scalars(select(Post).where(Post.published == True).offset(skip).limit(limit)).all()

# 查（按主键一条）
post = db.get(Post, post_id)

# 查（总数）
total = db.scalar(select(func.count()).select_from(Post))

# 增
post = Post(**payload.model_dump())
db.add(post); db.commit(); db.refresh(post)     # refresh：拿回数据库生成的 id / 时间

# 改：先查出来 → 改属性 → commit（ORM 会自动生成 UPDATE）
post.title = "新标题"; db.commit()

# 删
db.delete(post); db.commit()
```

**要点/坑**

- **`add` 之后不 `commit` 等于没写**：`add` 只是放进会话，`commit` 才发 SQL。同理 `commit` 前 `post.id` 是 `None`，所以要 `refresh` 才能拿到自增 id。
- **改数据不用再 `add`**：查出来的对象已经在会话里（"被跟踪"），改属性 + `commit` 就是 UPDATE。
- **PATCH 必须 `exclude_unset=True`**：否则没传的字段会以 `None` 盖掉原值。
- **查询用 `select()` 不用 `db.query()`**：后者是 1.x 老写法，2.0 里仍在但不再是主流。结果用 `db.scalars(...)` 拿对象、`db.scalar(...)` 拿单个值。
- **`f"%{q}%"` 放进 `ilike` 是安全的**：SQLAlchemy 会把它变成绑定参数（`%s`），不是拼 SQL 字符串，所以不怕注入；但**千万别自己用 f-string 拼 `text()` 里的 SQL**。
- **分页要交给数据库**：`offset/limit` 让数据库只返回当页数据；先把所有行捞进 Python 再切片是"假分页"，数据量大时会炸。
- **写接口照样用 `def`**：同步 ORM 一用 `async def` 就变成"异步里干阻塞活"，会卡住事件循环。
- **删库不删表**：`Base.metadata.create_all` 不会清理旧数据；想重来用 `python -m app.seed --reset`。
- **本阶段用到的两个"提前量"**：`response_model=PostRead`（响应模型的最小用法）和 `HTTPException(404)`（找不到就报错）——第 6 节和阶段五会展开讲，这里先用起来。
- 常用命令：`python -m app.seed` 建表 + 塞种子；`python -m app.seed --reset` 清空重塞。

---

## B.8 响应模型、状态码、表单与文件（阶段5）

**为什么**：接口不只是"返回数据"，还要说清楚**返回什么结构、什么状态码、出错长什么样**。这三件事是前后端联调最容易扯皮的地方；写进代码，`/docs` 就成了活的接口文档。

### 一、`response_model`：响应的"白名单"

```python
@router.get("/{post_id}", response_model=PostRead)
def get_post(...): ...
```

| 参数 | 作用 |
|---|---|
| `response_model` | ① 按模型**过滤**多余字段 ② 转换类型 ③ 生成文档 |
| `response_model_exclude_unset=True` | 只输出"真的设置过"的字段（PATCH 类接口常用） |
| `response_model_include={...}` / `_exclude={...}` | 只保留 / 去掉某些属性 |

**要点/坑**

- `response_model` 是**白名单**：你 `return` 的对象里多出来的字段会被**自动删掉**。这有直接的安全价值——不声明就不会泄露（比如不小心把 `hashed_password` 带出去）。
- 它和"返回值类型标注"不一样：`-> PostRead` 只是给编辑器和文档看的，**不会真的过滤数据**；要过滤必须用 `response_model`（或 `response_model` 参数位置写返回标注，FastAPI 也认）。
- 返回 ORM 对象时，响应模型要配 `model_config = ConfigDict(from_attributes=True)`，否则 Pydantic 只认 dict。

### 二、同一张表，多个"对外视图"（本项目做法）

| 模型 | 用在哪 | 字段 |
|---|---|---|
| `PostRead` | 详情 / 创建 / 更新的响应 | id、title、**content**、published、时间 |
| `PostSummary` | 列表里的每一项 | id、title、published、created_at（**不带正文**） |
| `PostPage` | 列表接口的整体响应 | total、skip、limit、items |

- 列表页只需要扫标题，把每篇正文都传过去是纯浪费 → 用精简模型。
- 分页信息（total/skip/limit）用一个"信封"模型包起来，比返回裸数组更利于以后扩展。
- 关键认知：**数据库只有一张表，对外可以有很多种形状**。别硬拿一个模型套所有接口。

### 三、状态码：写常量，别写数字

```python
from fastapi import status

@router.post("", status_code=status.HTTP_201_CREATED)    # 201
@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)   # 204
```

| 码 | 含义 | 典型场景 |
|---|---|---|
| 200 | 成功 | GET / PATCH |
| 201 | 创建成功 | POST 新建资源 |
| 204 | 成功但无响应体 | DELETE |
| 400 | 请求本身不对 | 业务性参数错误 |
| 401 / 403 | 未认证 / 无权限 | 阶段九 |
| 404 | 资源不存在 | 按 id 找不到 |
| 422 | 校验失败 | FastAPI 自动返回（参数/请求体不合规） |

**坑**：`status_code=204` 时**不能返回响应体**，接口里不要 `return` 数据，否则报错。

### 四、`HTTPException`：主动报错

```python
raise HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail=f"post {post_id} not found",
    headers={"WWW-Authenticate": "Bearer"},   # 401 常用，其余场景可省
)
```

- **`return` = 正常交回结果；`raise` = 主动制造异常、函数立刻中断**。这是两条完全不同的路。
- FastAPI 捕获后统一返回 `{"detail": "你写的说明"}` + 对应状态码。
- `detail` 是给**调用方**看的，别把 SQL 报错、堆栈、内部路径写进去。
- `responses={404: {"description": "文章不存在"}}` 加在装饰器上**只是文档**（让 /docs 显示这个接口可能返回 404），它**不会**帮你产生 404——真正的 404 还是靠 `raise`。
- 想给 422 也统一格式，要用 `@app.exception_handler(RequestValidationError)`（工程化阶段再上）。

### 五、Form 与 File（本项目 `app/routers/uploads.py`）

```python
from fastapi import File, Form, UploadFile

@router.post("/form")
async def submit_form(username: str = Form(..., min_length=1), password: str = Form(..., min_length=6)): ...

@router.post("/file")
async def upload_file(file: UploadFile = File(...)): ...
```

**要点/坑（前三个是真实项目必须处理的）**

- **类型白名单**：`file.content_type` 是**客户端自己报的**，只能当粗筛，不能当安全依据（真要判断得看文件头）。
- **文件名安全**：客户端可能传 `../../x.png`，用 `Path(file.filename).name` 只取最后一段，防路径穿越。
- **大小限制**：`await file.read(1MB)` **分块**读、边写边数，超限**立刻删除半成品**；不能等全存完再检查（那时磁盘已经被写爆了）。
- `UploadFile` 是异步的：用 `await file.read()` / `await file.close()`；`file.file` 是底层同步句柄（配合 `shutil.copyfileobj` 用）。
- 上传文件落在 `uploads/`（相对启动目录），**已加进 .gitignore**；以后要能被浏览器访问，得挂载 `StaticFiles`（阶段十四）。
- Form / File 请求的 Content-Type 是 `multipart/form-data`，**不是 JSON**——用 curl / Swagger 试的时候别传错格式。
- `/docs` 里这种接口的表单是"键值输入框"，不是 JSON 编辑框，这是最直观的区别。

---

## B.9 依赖注入在项目里落地：分页参数与 404 校验（阶段6）

**为什么**：接口里总有一部分逻辑"每个接口都要再写一遍"（分页参数、按键取对象或 404、当前登录用户）。`Depends` 就是把这些**准备工作外包出去**的机制——写一次、处处复用，接口函数只留真正干活的那几行。

### 一、`Depends` 到底是什么

FastAPI 原生能解析的参数来源就几种：路径、查询、请求体、Header/Cookie、Form/File。`Depends` 让你**自定义第 N 种来源**，语义是：

> "这个参数的值我不管，你去调用我指定的那个东西，把它的返回值给我。"

而那个"东西"**自己的参数，走完全一样的解析规则**——所以依赖里能写 `Path(...)` / `Query(...)`，也能再写一个 `Depends(...)`，于是天然形成**依赖链**。

本项目里第一个依赖就是 `get_db`（B.3）：

```python
def create_post(payload: PostCreate, db: Session = Depends(get_db)): ...
```

**也就是说：从阶段一你就一直在用 `Depends`。** 阶段六只是把它从"拿数据库会话"推广到"拿任何东西"。

### 二、重构一：分页参数打包成"类依赖"

**位置**：`app/core/deps.py`

```python
class PaginationParams:
    def __init__(
        self,
        skip: int = Query(0, ge=0, description="跳过前几条，不能为负"),
        limit: int = Query(2, ge=1, le=50, description="每页条数，1~50"),
    ) -> None:
        self.skip = skip
        self.limit = limit
```

用法：`pagination: PaginationParams = Depends(PaginationParams)`，函数体里读 `pagination.skip` / `pagination.limit`。

| 疑问 | 答案 |
|---|---|
| 为什么用**类**不用函数？ | 函数只能 `return` 一个值；想回两个就得塞 dict（`commons["skip"]` 读着别扭）。类可以 `commons.skip`，编辑器还能补全。 |
| `/docs` 会不会变？ | **不会**。依赖内部的 `Query(...)` 声明照样被收集进 OpenAPI，调用方完全看不出区别。 |
| 好处在哪？ | 以后"分类列表 / 评论列表"一行 `Depends(PaginationParams)`，就接上同一套分页规则和文档说明。 |

**要点**：依赖不是"隐藏参数"。参数依然出现在文档里，只是**定义搬了家**。

### 三、重构二：把"取对象 or 404"做成依赖

```python
def get_post_or_404(
    post_id: int = Path(..., ge=1, description="文章 id，必须 ≥ 1"),
    db: Session = Depends(get_db),
) -> Post:
    post = db.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail=f"post {post_id} not found")
    return post
```

于是三个接口同时变短：

```python
def get_post(post: Post = Depends(get_post_or_404)):
    return post

def update_post(payload: PostUpdate, post: Post = Depends(get_post_or_404), db: Session = Depends(get_db)): ...
def delete_post(post: Post = Depends(get_post_or_404), db: Session = Depends(get_db)): ...
```

**依赖比普通函数多出来的三种能力**：

1. **能中断请求**——`raise` 在依赖里，接口函数**根本不会执行**，所以接口里不用再判空。
2. **返回值变成接口参数**——`post: Post = Depends(...)`，直接在函数体里用。
3. **参数声明也跟着搬家**——`post_id` 从接口签名里消失了，但 `/{post_id}` 依然有效、`ge=1` 依然校验、`/docs` 里依然显示，因为**路径参数是在依赖里声明的**。

**命名习惯**：`_get_post_or_404` 前面的下划线去掉了。下划线 = "本文件内部实现"；去掉 = "可复用的部件"。

### 四、最核心：依赖缓存（`use_cache`）

`update_post` 里出现了**两次** `Depends(get_db)`（接口一次、`get_post_or_404` 内部一次）。为什么不会造出两个会话？

FastAPI 默认 `use_cache=True`：**同一个请求内，同一个依赖只执行一次，结果被复用。**

```
请求进来
  ├─ get_post_or_404 需要 db → 调 get_db → 造出【会话 A】
  └─ update_post 需要 db     → 本请求已执行过 → 直接复用【会话 A】
       ↓
  依赖用 A 查出的 post，接口用 A commit → 同一个会话，一切正常
```

**如果没有这层缓存**：依赖用会话 A 查出 `post`，接口用会话 B `commit()`——`post` 不在 B 里，改动会无声无息地失效，或者报 `not bound to a Session`。

> "拆依赖"能成立，前提就是这层缓存。想亲手关掉看后果：`Depends(get_db, use_cache=False)`。

### 五、顺带补上 §7：`model_dump()` 还是 `jsonable_encoder()`？

本项目建对象用的是 `Post(**payload.model_dump())`（B.7），**没有**用 §7 的 `jsonable_encoder()`。两者都能把模型转成 dict，区别在**转出来的东西给谁用**：

| | `model_dump()`（Pydantic 原生） | `jsonable_encoder()`（FastAPI 提供） |
|---|---|---|
| 返回什么 | Python 对象（`datetime` 还是 `datetime`） | **JSON 兼容**格式（`datetime` → 字符串） |
| 给谁用 | 喂给 ORM 类 / 自己的 Python 逻辑 | 喂给**非 Pydantic 的去处**：内存字典、Redis、手搓 `JSONResponse` |
| 附带能力 | `exclude_unset=True` 等精细控制 | "万能转换器"：模型→dict、`List[模型]`→普通列表 |

**决策规则**：

- 数据要进 **ORM / 自己的 Python 逻辑** → `model_dump()`（本项目就是这样）。
- 数据要**直接变成 JSON**，且**绕过了 FastAPI 的响应通道**（塞进 dict、自己构造 `JSONResponse`）→ `jsonable_encoder()`。
- **`return` 一个模型交给 FastAPI 时，两个都不用写**——FastAPI 发响应前内部已经替你调了 `jsonable_encoder`。这就是 §7 的示例里 `return` 那行从不用手动转换的原因。

### 六、要点/坑

- `Depends(函数)` **函数不带括号**；带了括号 = 立刻执行，于是把**返回值**当成了依赖。
- `dependencies=[Depends(x)]`（装饰器 / 全局）里的依赖**只负责拦截**，返回值不传给接口；只有写在**参数位**上的依赖才把返回值交给你。
- 依赖能干的活：查库、校验参数、验证登录（阶段九的 `get_current_user` 就是它）、读配置。**任何"每个接口开头都要写的那几行重复代码"，都值得考虑做成依赖。**
- 依赖缓存的 key 是"**函数 + 参数**"。参数不同的两个依赖会被各执行一次。

---

## B.10 用户注册与密码哈希（阶段7）

**为什么**：这一阶段的代码几乎全是老套路（models / schemas / routers 三件套），真正的新东西只有一个——**密码绝不能明文入库**。搞懂这一点，剩下都是抄自己。

### 一、为什么不能存明文

数据库一旦泄露，明文密码就等于"全量泄露"。而人在各处往往用同一个密码，于是**撞库**——你这边泄露，用户在别处的账号一起失守。

所以"不存明文"不是洁癖，是对用户**在其他网站账号**的负责。

### 二、哈希 ≠ 加密

| | 加密 | 哈希 |
|---|---|---|
| 方向 | **双向**，能解密还原 | **单向**，不可逆 |
| 目的 | 把数据**取回来** | 只验证"是不是同一个" |
| 例子 | 加密聊天记录 | 密码 |

密码的正确姿势：

> **不存密码，只存它的"指纹"。** 验证时把用户输入**再算一遍指纹**，和库里的比对。

推论：连开发者自己都不可能知道原密码——用户忘了只能**重设**，不能"找回"。这是刻意设计，不是缺陷。

### 三、为什么要"加盐"

不加盐：同一个密码 → 永远同一个哈希。攻击者预先算好"常见密码 → 哈希"的对照表（**彩虹表**），拿到哈希直接查表还原。

加盐：给每个用户配一段**随机字符**，和密码拼在一起再哈希。于是**相同密码的两个用户，哈希也完全不同**，彩虹表失效。

bcrypt **自动**做这件事，盐就藏在哈希串里，不需要你另外存一列。

### 四、为什么用 bcrypt，不用 md5 / sha256

| | 设计目标 | 后果 |
|---|---|---|
| md5 / sha256 | 要求**快**（校验文件完整性） | GPU 每秒几十亿次，密码几分钟爆 |
| **bcrypt** | 有意**慢** | 每次约几十毫秒，暴力破解成本爆炸 |

这类算法叫**密钥派生函数**，专为"存密码"设计。哈希串里的 `$2b$12$` 中那个 `12` 就是慢的档位（2¹² 轮迭代），可调。

### 五、passlib 的用法

**位置**：`app/core/security.py`

```python
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)
```

- `CryptContext` 是"哈希方案的总配置"，将来换算法只改这一处。
- `hash_password` 每次调用结果都不同（盐是随机的），**这不是 bug**。
- `verify_password` 不是"解密"，是"重新哈希再比对"；盐会自动从 `hashed` 串里取回，所以调用方不用管盐。
- 放 `core/` 的理由：它和"文章/用户"业务无关，是可以整块搬走的基础设施。（阶段八的 JWT 函数也放这里，它的定位就是"安全零件仓库"。）

### 六、哈希串长什么样

```
$2b$12$K3J9xQvN8mLpR2sT7wYzEu ......... .........
 └┬┘└┬┘└──────────┬──────────┘
版本  cost     盐（22 字符，公开）
```

**盐是公开写在串里的**，安全靠"**随机**"（防彩虹表）+ "**慢**"（防暴力），不靠"藏盐"。

### 七、三个新增件

**① User 模型**（`app/models/user.py`）—— 列名本身就是一份声明：

```python
username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
email: Mapped[str] = mapped_column(String(120), unique=True, index=True)
hashed_password: Mapped[str] = mapped_column(String(255))   # 注意不叫 password
```

- `unique=True`：数据库层面的唯一约束，是最后一道防线。
- `index=True`：登录时要按用户名查，加索引更快。
- `String(255)`：bcrypt 结果是 60 字符，留宽以防将来换算法。
- `__repr__` 里也不打印 `hashed_password`（日志同样会泄露）。

**② 契约：密码只进不出**（`app/schemas/user.py`）

| 模型 | 用途 | 有密码字段吗 |
|---|---|---|
| `UserCreate` | 注册**收进**来 | **有 `password`**（明文，用完即丢） |
| `UserRead` | 用户信息**回出去** | **没有**，连 `hashed_password` 也没有 |

这是 B.8「白名单」最要紧的一次应用：**不声明，就永远不会被带出去。**

`password` 上写 `max_length=72`：bcrypt 只处理前 72 字节，与其"悄悄截断"，不如在入口拦住。

**③ 注册接口**（`app/routers/auth.py`）—— 三步

```python
@router.post("/register", response_model=UserRead, status_code=201, responses=CONFLICT)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    # 查重
    if db.scalars(select(User).where(User.username == payload.username)).first():
        raise HTTPException(409, f"username {payload.username!r} already taken")
    if db.scalars(select(User).where(User.email == payload.email)).first():
        raise HTTPException(409, f"email {payload.email!r} already registered")

    # 哈希入库
    user = User(username=payload.username, email=payload.email,
                hashed_password=hash_password(payload.password))
    db.add(user); db.commit(); db.refresh(user)
    return user
```

`payload.password`（明文）**只在这一行出现过一次**，之后即丢弃：不写库、不进日志、不返回。

### 八、两个设计选择

**① 为什么"先查再插"？数据库不是已经有 unique 了吗**

| 手段 | 作用 |
|---|---|
| 先查一次 | 让正常路径返回**说得清的 409**，而不是撞约束后抛 500 |
| unique 约束 | 兜底：并发下两个同名请求同时通过检查时，后到的被数据库挡住 |

两层都要：前者管**错误信息友好**，后者管**数据正确**。（要更严谨可以 `try/except IntegrityError`，把兜底也转成 409。）

**② 409 还是 422**

- `422` = **格式**不对（邮箱不是邮箱、密码太短）→ Pydantic 自动返回，一行都不用写。
- `409 Conflict` = 格式没问题，但和**现有资源冲突**（重名、邮箱占用）→ 手动 `raise`。

422 是框架送的，409 是自己送的。

### 九、还要知道的一件事：注册路由是怎么被"接上"的

`app/models/__init__.py` 里的统一 import，让**导入一个模型包 = 所有表都注册进 `Base.metadata`**。所以 `seed.py` 只要 `from app.models import Post` 这一句，`users` 表也会被一起建出来，不用改成 `import User`。

```
from app.models import Post
        ↓ 触发
app/models/__init__.py 执行
        ↓ 里面有
from app.models.post import Post
from app.models.user import User      ← users 表在这里被注册
```

### 十、验证（重点是最后一步）

```powershell
python -m pip install -r requirements.txt   # passlib / bcrypt / python-jose
python -m app.seed                          # 建 users 表（已存在的表跳过）
uvicorn app.main:app --reload
```

`/docs` → `POST /auth/register`：

```json
{"username": "alice", "email": "alice@example.com", "password": "secret123"}
```

期望 `201`，返回体里**一个密码字段都没有**。

拒绝路径：

| 试什么 | 期望 |
|---|---|
| 同一个用户名再注册 | `409` |
| `"email": "not-an-email"` | `422` |
| `"password": "123"` | `422` |

**★ 最后一步（眼见为实）**：

```powershell
docker exec -it blog-mysql mysql -uroot -p123456 blog -e "select id, username, hashed_password from users;"
```

应该看到 `$2b$12$...` 的乱码，而**不是** `secret123`。

再加一个**加盐实验**：用两个不同用户名、**相同密码**注册两次 → 两条 `hashed_password` 会**完全不同**。这就是盐存在的证据。

### 十一、要点 / 坑

- 列名写 `hashed_password` 而不是 `password`——让名字替你守住约定。
- `UserRead` 里绝不出现任何密码字段；`response_model` 就是白名单的执法者。
- `verify_password` 是"重新哈希比对"，不是解密。**别想着"把密码解出来"。**
- 改密码 = 写入新的 `hash_password(...)`；不存在"改回原密码"。
- 忘记密码只能走"重设"流程，做不到"找回"。
- bcrypt 装成 4.1+ 会和 passlib 冲突：`AttributeError: module 'bcrypt' has no attribute '__about__'`。按 `requirements.txt` 装的 `bcrypt==4.0.1` 才对。
- 每新增一个 router 文件，别忘了在 `main.py` 里 `include_router`。

---

## B.11 登录与 JWT（阶段8）

**为什么**：阶段7解决了"密码怎么安全地存"，阶段8解决的是**"登录过一次之后，服务器怎么记住你"**。

### 一、问题的起点：HTTP 是无状态的

用户在第一个请求里登录成功了。第二个请求发过来，服务器**根本不认识他**——因为 HTTP 天生不带记忆。

于是需要一张"凭证"：登录成功时发给客户端，之后每个请求都带着它。服务器看到凭证就知道"这是 alice"。

### 二、两条路线：会话（session）vs 令牌（token）

| | 会话 session | 令牌 JWT |
|---|---|---|
| 凭证存在哪 | 服务器（内存/数据库/Redis） | **客户端自己拿着** |
| 服务器怎么认 | 查表比对 | **验签名，不查表** |
| 横向扩容 | 多台机器要共享 session | 天然无状态，哪台都能验 |
| 注销/踢下线 | 直接删掉即可，**立刻生效** | 到期前一直有效，**要额外做黑名单** |

JWT 的核心取舍：**用"服务器少查一次数据库"换"注销麻烦一点"**。

### 三、JWT 长什么样

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 . eyJzdWIiOiJhbGljZSIsImV4cCI6MTcz…  . 3q2-7w…
└──────── header：声明算法 ─────────┘  └──── payload：放 sub / exp ────┘  └ 签名 ┘
```

三段用 `.` 连接：

| 段 | 内容 | 是不是加密的 |
|---|---|---|
| header | `{"alg": "HS256", "typ": "JWT"}` | **不是**，base64 谁都解得开 |
| payload | `{"sub": "alice", "exp": 1730000000}` | **不是**，base64 谁都解得开 |
| signature | 前两段 + `SECRET_KEY` 算出来的签名 | 这个才是防伪的 |

**关键认知**：

> JWT 是**签名**，不是**加密**。
> 谁都能把 token 解开看内容，但**改不了**——改任何一位，签名立刻对不上。

**推论（非常重要）**：**token 里绝不能放密码、身份证号等敏感信息。** `sub` 放用户名/用户 id 是安全的，因为它本来就半公开。

### 四、SECRET_KEY 是什么

签名用的"私章"。谁拿到它，谁就能伪造出任意用户的 token。

- 所以它**不能写死在代码里**（会进 git 仓库），只能放 `.env` / 环境变量。
- 所以 `config.py` 里只给个 `"dev-only-change-me"` 兜底，真项目必须换。
- 所以**换了 SECRET_KEY = 所有已发出的 token 立刻全部失效**（对开发调试其实很好用）。

### 五、签发与校验（`app/core/security.py`）

```python
def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {"sub": subject, "exp": expire}       # sub=是谁, exp=何时过期
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None                                  # 过期/伪造/格式错 → 统一 None
    return payload.get("sub")
```

- `exp` 用 **UTC**：JWT 标准要求，也避免被服务器时区坑。
- `jwt.decode` 一次检查三件事：**签名**（防伪造）、**exp**（防过期）、**格式**。
- 异常统一吞成 `None`：**不告诉攻击者"你是过期了还是伪造了"**。
- 时间用 `datetime.now(timezone.utc)`，不要用已废弃的 `utcnow()`。

### 六、登录接口（`app/routers/auth.py`）

```python
from fastapi.security import OAuth2PasswordRequestForm

@router.post("/token", response_model=Token, summary="登录获取 access token")
def login(
    form: OAuth2PasswordRequestForm = Depends(),   # 注意：不是 Pydantic 模型！
    db: Session = Depends(get_db),
):
    user = db.scalars(select(User).where(User.username == form.username)).first()

    # 把"用户不存在"和"密码错"合并成同一个错误 —— 否则能被用来试探哪些用户名存在
    if user is None or not verify_password(form.password, user.hashed_password):
        raise HTTPException(401, "Incorrect username or password",
                            headers={"WWW-Authenticate": "Bearer"})

    if not user.is_active:
        raise HTTPException(403, "Inactive user")

    return Token(access_token=create_access_token(user.username))
```

**三个小心思**：

1. `user is None or not verify_password(...)` 写成一行短路——用户不存在时根本不必去算哈希。
2. **错误信息故意含糊**：如果分开报"用户不存在"/"密码错误"，攻击者就能批量试探出哪些用户名是注册过的（**用户名枚举**）。
3. `headers={"WWW-Authenticate": "Bearer"}` 是 401 的标准搭档。

### 七、为什么登录接口收**表单**而不是 JSON

`OAuth2PasswordRequestForm` 要求 `Content-Type: application/x-www-form-urlencoded`，字段固定叫 `username` / `password`。

不是因为 JSON 不好，而是因为**这是 OAuth2 的成文约定**：

- `/docs` 右上角的 **Authorize 按钮**就是按这套规矩发请求的；
- Swagger UI、Postman、各种客户端库都认这套；
- 所以用 `OAuth2PasswordRequestForm` = **白捡一个能用的登录界面**。

（表单依赖需要 `python-multipart`——阶段5 上传文件时已经装过了。）

想收 JSON 也可以（自己写个 `BaseModel`），但那样 `/docs` 的 Authorize 按钮就用不了。

### 八、谁来"认"这个 token（`app/core/deps.py`）

```python
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")
```

它做两件事：

1. **干活**：告诉 FastAPI 从请求头 `Authorization: Bearer <token>` 里取 token。没带？直接 401。
2. **给 /docs 看**：`tokenUrl` 是那一串——Authorize 按钮点开后，会去 POST 这个地址换 token。写错了按钮就废。

```python
def get_current_user(token: str = Depends(oauth2_scheme),
                     db: Session = Depends(get_db)) -> User:
    username = decode_access_token(token)
    if username is None:
        raise _credentials_exception()
    user = db.scalars(select(User).where(User.username == username)).first()
    if user is None:
        raise _credentials_exception()
    return user


def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_active:
        raise HTTPException(403, "Inactive user")
    return current_user
```

**这是本项目第一次出现"依赖链"**：

```
get_current_active_user
      └─ get_current_user
             ├─ oauth2_scheme   （取 token）
             └─ get_db          （拿会话）
```

FastAPI 会自动按依赖顺序执行，把结果一层层往上传。接口侧只要一行 `Depends(get_current_active_user)`。

**为什么 token 里只放用户名，还要回查一次数据库？**

| 好处 | 说明 |
|---|---|
| 能反映最新状态 | 用户被停用/删除了，即使 token 还没过期，也会立刻被拦住 |
| 拿到完整对象 | 接口需要 `user.id`、`user.email`，光有用户名字符串不够用 |
| 查询很便宜 | 用户名上有索引，比"每次都验签 + 还得查权限表"划算 |

（真·高并发时才会考虑"完全无状态、不查库"，那是后话。）

### 九、怎么"上锁"：不是 if 判断，是加一行签名

```python
@router.post("", response_model=PostRead, status_code=201, summary="新建文章")
def create_post(
    payload: PostCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),   # ← 这一行就是锁
):
    ...
```

**为什么这比"函数体里写 if"高级？**

| | `if not current_user: raise 401` | 依赖 |
|---|---|---|
| 检查发生在 | 函数体**执行后** | 函数体**执行前** |
| 忘写会怎样 | 接口裸奔，且没人看得出来 | 签名里没写 = 明摆着"这接口是公开的" |
| /docs 上 | 看不出来 | 自动带 🔒，还能直接点 Authorize 试 |

**读公开、写需登录**——这是最经典的接口权限设计：

| 方法 | 路径 | 是否需要登录 |
|---|---|---|
| GET | `/posts`、`/posts/{id}` | 否 |
| POST | `/posts` | **是** |
| PATCH | `/posts/{id}` | **是** |
| DELETE | `/posts/{id}` | **是** |

### 十、401 与 403 的分工

| 码 | 含义 | 本项目里什么时候出现 |
|---|---|---|
| **401** | "你没证明你是谁" | 没带 token / token 过期 / 签名不对 / 用户已不存在 |
| **403** | "知道你是谁了，但你不能干这事" | 账号被停用（`is_active=False`） |

### 十一、验证

```powershell
python -m pip install -r requirements.txt   # 确认 python-jose 在
uvicorn app.main:app --reload
```

**用 `/docs`（最直观）**：

1. 先 `POST /auth/register` 注册一个 `alice` / `secret123`；
2. 点右上角 **Authorize** → 填 `alice` / `secret123` → Authorize → Close；
3. 这时 `/posts` 的 POST/PATCH/DELETE 旁边会带 🔒，直接就能调用；
4. **点一下 Authorize 里的 Logout，再调 POST /posts → 应该 401。**

**用命令行（看清"带没带 token"的区别）**：

```powershell
# 1) 登录换 token（注意 -d 是表单，不是 JSON）
$resp = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/auth/token `
  -Body @{username="alice"; password="secret123"}
$token = $resp.access_token
$token        # 看清三段：header.payload.signature

# 2) 不带 token 发文章 → 期望 401
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/posts `
  -ContentType "application/json" -Body '{"title":"x","content":"y"}'

# 3) 带上 token 发文章 → 期望 201
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/posts `
  -Headers @{Authorization="Bearer $token"} `
  -ContentType "application/json" -Body '{"title":"hello jwt","content":"ok"}'
```

**★ 最值得做的一次实验：篡改 token**

把 `$token` 的**中间那段**随便改一个字符，再发请求 → 依然 **401**。

这就是"**签名**"的意义：**payload 是公开的，但改不动。**

### 十二、要点 / 坑

- JWT **是签名不是加密**：payload 谁都能读，**别往里放敏感信息**。
- `SECRET_KEY` 必须进 `.env`、不进 git；换掉它 = 全部 token 立即失效。
- 登录接口收**表单**（`OAuth2PasswordRequestForm`），不是 JSON——为了 OAuth2 约定和 `/docs` 的 Authorize 按钮。
- `oauth2_scheme` 的 `tokenUrl` 必须写**真实登录路径**（本项目 `/auth/token`），写错则 Authorize 按钮失效。
- 401 的错误信息要**含糊**（不区分"用户不存在"和"密码错"），防用户名枚举。
- 上锁 = 在**签名里加一行依赖**，而不是在函数体里写 if。
- 依赖链第一次出现在 `deps.py`：`get_current_active_user → get_current_user → oauth2_scheme / get_db`。
- `datetime.utcnow()` 已废弃，用 `datetime.now(timezone.utc)`。
- 阶段9 会在这个地基上做**归属**：给 `Post` 加 `author_id`，让"登录才能写"升级成"只能改自己的"。

---

## B.12 文章归属与权限（阶段9）

**为什么**：阶段8 做到了"**登录才能写**"，但任何登录用户都能改、能删**别人的**文章。阶段9 补上这一环：**只能动自己的**。

### 一、认证（authentication）vs 授权（authorization）

| | 回答的问题 | 失败状态码 | 阶段 |
|---|---|---|---|
| **认证** | **你是谁**？ | 401 | 阶段8 |
| **授权** | **你能不能干这件事**？ | 403 | 阶段9 |

阶段8 解决前者，阶段9 解决后者。**顺序不能反**：不认识你是谁，就谈不上你有没有权限。

### 二、外键：为什么把"必须存在"交给数据库

```python
author_id: Mapped[int | None] = mapped_column(
    ForeignKey("users.id"), index=True, nullable=True
)
```

`ForeignKey("users.id")` 让**数据库**保证：`author_id` 一定指向一个真实存在的用户；写个不存在的 id，插入直接被拒绝。

**为什么不在 Python 里判断？**

| | 代码里判断 | 数据库约束 |
|---|---|---|
| 谁能绕过 | 任何直接写库的脚本 | **没人** |
| 并发下 | 检查完的瞬间，用户可能刚好被删了 | 数据库原子保证 |

**原则**：能交给数据库的不变量，就别只靠代码。

### 三、为什么 author_id 允许 NULL

1. 这张表在阶段9 之前就有数据了——老数据没有作者；
2. 真实项目里"用户注销"一般不连带删文章，而是把作者置空（否则会连带删掉一堆内容）。

**顺带一个安全后果**：`current_user.id` **永远不是** `None`，所以 `post.author_id != current_user.id` 这个判断，对**无主文章**会得出"不是你的" → 403。这正是想要的结果。

### 四、越权赋值（mass assignment）——阶段9 最值得记住的安全点

```python
post = Post(**payload.model_dump(), author_id=current_user.id)
                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^ 服务端自己填
```

**为什么 author_id 不能从请求体来？**

假如 `PostCreate` 里有 `author_id` 字段，用户就能发：

```json
{"title": "x", "content": "y", "author_id": 1}
```

把自己的文章**栽赃**给别人。这类漏洞叫**越权赋值**。

**防御手段就是本项目一直在用的那一招**：`PostCreate` 里**根本不声明** `author_id`。
不声明 → 传了也被丢掉 → 由服务端自己填。

> 和 B.8 的呼应：`response_model` 是**出口**的白名单，不声明就带不出去；
> 这里的请求体模型是**入口**的白名单，不声明就塞不进来。

### 五、依赖再升级：`get_post_or_404` → `get_own_post_or_404`

```python
def get_own_post_or_404(
    post: Post = Depends(get_post_or_404),
    current_user: User = Depends(get_current_active_user),
) -> Post:
    if post.author_id != current_user.id:
        raise HTTPException(403, f"post {post.id} belongs to another user")
    return post
```

PATCH / DELETE 的签名于是变成：

```python
def update_post(payload: PostUpdate,
                post: Post = Depends(get_own_post_or_404),
                db: Session = Depends(get_db)):
```

**一个依赖干了三件事**：文章存在吗（404）、你登录了吗（401）、是你的吗（403）。

此时项目里的依赖链已经长成这样：

```
get_own_post_or_404
   ├─ get_post_or_404 ── get_db
   └─ get_current_active_user
          └─ get_current_user
                 ├─ oauth2_scheme
                 └─ get_db   ← 同一个请求里只执行一次，两处拿到同一个 Session
```

### 六、`GET /posts/mine`

```python
@router.get("/mine", response_model=PostPage, summary="我的文章")
def list_my_posts(
    pagination: PaginationParams = Depends(PaginationParams),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    condition = Post.author_id == current_user.id
    total = db.scalar(select(func.count()).select_from(Post).where(condition)) or 0
    posts = db.scalars(select(Post).where(condition)
                       .order_by(Post.id.desc())
                       .offset(pagination.skip).limit(pagination.limit)).all()
    return {"total": total, "skip": pagination.skip, "limit": pagination.limit, "items": posts}
```

两个细节：

1. **路由顺序**：`/mine` 必须写在 `/{post_id}` **之前**，否则 `mine` 会被当成 id 去转 int → 422。（和 `/latest` 是同一个坑。）
2. 整个接口里**一行 token 相关代码都没有**——"当前是谁"完全由依赖提供。这就是依赖注入的收益。

### 七、表结构改了怎么落地（阶段9 的新问题）

**关键认知：`Base.metadata.create_all()` 只建"还不存在的表"，已存在的表它一个字都不改。**

所以给 `Post` 加了 `author_id` 之后，只跑 `python -m app.seed` 是**没用的**，接口一查就报：

```
(pymysql.err.OperationalError) (1054, "Unknown column 'posts.author_id' in 'field list'")
```

开发阶段两种解法：

| 做法 | 命令 | 特点 |
|---|---|---|
| **重建表**（本项目用这个） | `python -m app.seed --rebuild` | 简单粗暴，**数据全没** |
| **改表** | `ALTER TABLE posts ADD COLUMN author_id INT NULL;` | 不丢数据，但要手写 SQL、手动加外键 |

`seed.py` 里 `--rebuild` 的实现就两行：

```python
Base.metadata.drop_all(bind=engine)   # 按外键依赖排序删表（先 posts 后 users）
Base.metadata.create_all(bind=engine)
```

**那正式项目怎么办？** → **Alembic**（SQLAlchemy 官方的迁移工具）。
它把"表结构变化"写成一个版本文件，`alembic upgrade head` 时自动生成并执行 `ALTER TABLE`，
**不丢数据**、可回滚、可在多台机器上重复执行。

### 八、验证

```powershell
python -m app.seed --rebuild     # 必须！给 posts 表补上 author_id 列
uvicorn app.main:app --reload
```

在 `/docs` 里依次做：

| 步骤 | 操作 | 期望 |
|---|---|---|
| 1 | Authorize 登录 `alice` / `secret123` | 成功 |
| 2 | `GET /posts/mine` | **5 篇**（都是 alice 的种子文章） |
| 3 | `POST /posts` 新建一篇 | `201`，响应里有 `author_id` |
| 4 | `GET /posts/mine` | 变 **6 篇**；`GET /posts` 也是 6 篇 |
| 5 | **Logout**，注册并登录 `bob` | 成功 |
| 6 | `GET /posts/mine` | **0 篇** |
| 7 | bob 去 `PATCH /posts/1`（alice 的文章） | **403** `belongs to another user` |
| 8 | bob 去 `DELETE /posts/1` | **403** |
| 9 | 不带 token 去 `POST /posts` | **401** |

**第 6~8 步才是阶段9 的重点**：bob 能**读**（读是公开的），但动不了别人的。

### 九、要点 / 坑

- **认证 401（你是谁）在前，授权 403（你能不能）在后**，顺序不能反。
- 外键把"引用必须存在"交给数据库，比在代码里判断可靠。
- **归属字段必须由服务端填**，绝不能出现在请求体契约里（越权赋值）。
- 权限判断写进**依赖**（`get_own_post_or_404`），不要抄在两个接口里。
- 固定路径（`/latest`、`/mine`）必须写在 `/{post_id}` **之前**。
- `create_all()` **不会**给已存在的表加列；开发期用 `--rebuild`，生产期用 Alembic。
- 依赖链可以有多个分支；`get_db` 在同一个请求里只执行一次（结果被缓存复用）。

---

## B.13 关联对象与 N+1（阶段10）

**为什么**：阶段9 让 `posts` 表有了 `author_id`，但接口里只有一串数字。本阶段做两件事：
1. 让响应里能带上**作者对象**（`relationship` + 嵌套契约）；
2. 顺手处理它的代价——**N+1 查询**（`selectinload`）。

**注意：这一阶段完全不涉及数据库结构变更**，`relationship` 不是列，所以**不需要 `--rebuild`**。

### 一、外键 vs 关系：最容易混的一对概念

| | `author_id` | `author` |
|---|---|---|
| 是什么 | **数据库里真实存在的一列**，存的是一个整数 | **ORM 层面的导航属性**，数据库里没有它 |
| 你能读到 | `3` | `<User id=3 username='alice'>` |
| 谁生成 | 建表时定义的列 | `relationship()` 声明出来的"虚拟属性" |
| 代价 | 0 | **每次访问可能要查一次库** |

```python
author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), ...)
author: Mapped[Optional["User"]] = relationship(back_populates="posts")
```

**一句话**：`author` 就是"按 `author_id` 帮你查了一下"的结果。
正因为"查一下"要花钱，才有后面的 N+1 问题。

### 二、双向关系与 `back_populates`

```python
# post.py
author: Mapped[Optional["User"]] = relationship(back_populates="posts")

# user.py
posts: Mapped[list["Post"]] = relationship(back_populates="author")
```

- 一对多：**"多"的那边是 `Post`**，因为外键 `posts.author_id` 指向 `users.id`。
- `back_populates` 两边写**对方的名字**，配对声明，缺一边 SQLAlchemy 会报错。
- 加了它之后，`post.author = user` 会自动同步 `user.posts`（内存层面），不用手动两边都改。
- 方向由外键决定，**不需要**写 `primaryjoin` 之类的参数。

### 三、跨模块循环导入：`TYPE_CHECKING` + 字符串

`post.py` 要引用 `User`，`user.py` 要引用 `Post`——两边都真 import 就成死循环了。标准解法：

```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:                 # 只在"类型检查 / 编辑器提示"时执行
    from app.models.user import User

class Post(Base):
    author: Mapped[Optional["User"]] = relationship(back_populates="posts")
```

- `if TYPE_CHECKING:` 是**常量 False**，运行时那行 import 根本不执行。
- 注解写成**字符串** `"User"`，运行时不需要这个名字存在。
- SQLAlchemy 自己会拿字符串 `"User"` 去**已注册的类表**（`Base.registry`）里找——所以只要两个模型都注册过就行。

> **实测确认**（本项目跑过）：
> ```python
> from sqlalchemy.orm import configure_mappers
> import app.models; configure_mappers()
> # Post.author -> User ; User.posts -> Post   ✅
> ```

### 四、N+1 问题（本阶段最核心的概念）

**症状**：1 次查询拿到 N 篇文章，然后**每篇文章各自再查一次作者**，一共 **1 + N** 条 SQL。

**为什么可怕**：N 是"当页条数"。`limit=10` 时 11 条，`limit=50` 时 51 条。
更糟的是它**不报错、不慢得明显**——数据少时完全看不出来，上线后才爆发。

**根因**：`PostRead` 里加了 `author`，序列化时每篇都要访问 `post.author` → 触发**懒加载**（lazy load）。

**实测数字**（造 4 篇**作者各不相同**的文章）：

| 写法 | SQL 条数 |
|---|---|
| 不带预加载 | **5** 条（1 次查文章 + 4 次逐个查作者） |
| 带预加载 | **2** 条（1 次查文章 + 1 次批量查作者） |

> **一个容易踩的测试陷阱**：如果几篇文章**同属一个作者**，懒加载会命中 SQLAlchemy 的**身份映射**（identity map，同一个会话里同一个 id 只保留一个对象），
> 第二次访问就直接返回缓存对象、不再查库。所以 5 篇同作者的文章，不带预加载也只有 2 条 SQL——
> **看上去像没问题，其实是假象**。测 N+1 必须让数据里存在多个不同的关联对象。

### 五、解法：预加载 `selectinload`

```python
from sqlalchemy.orm import selectinload

LOAD_AUTHOR = selectinload(Post.author)

stmt = select(Post).options(LOAD_AUTHOR).order_by(Post.id).offset(...).limit(...)
```

它的做法是**"先查主表，再用一条 `IN (...)` 把涉及的关联对象批量捞回来"**：

```sql
-- 第 1 条
SELECT * FROM posts ORDER BY id LIMIT 5;
-- 第 2 条（注意是一条，不是 5 条）
SELECT * FROM users WHERE users.id IN (1, 2, 3);
```

**关键纪律**：凡是"最终要把文章发给客户端"的查询都挂上它。
本项目里包括 `list_posts` / `latest_post` / `list_my_posts` / `get_post_or_404` / `reload_post`。

`Session.get` 也收 `options`：

```python
post = db.get(Post, post_id, options=[LOAD_AUTHOR])
```

### 六、`selectinload` vs `joinedload`

| | 发出的 SQL | 特点 |
|---|---|---|
| `selectinload` | **2 条**：主表 1 条 + `IN` 批量 1 条 | 适合**一对多 / 多对多**；不会让主表结果行数膨胀 |
| `joinedload` | **1 条**：LEFT OUTER JOIN 一次拿完 | 适合**多对一 / 一对一**；但一对多时会让主表行数重复（笛卡尔积），还要去重 |

本项目的 `post.author` 是**多对一**，`joinedload` 也合适；`selectinload` 更通用、更不容易踩坑，所以选它。

### 七、嵌套契约：`UserSummary` 而不是 `UserRead`

```python
# schemas/user.py
class UserSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str          # ← 没有 email！

# schemas/post.py
class PostRead(BaseModel):
    ...
    author: UserSummary | None = None
```

**为什么不能直接用 `UserRead`？**

| | `UserRead` | `UserSummary` |
|---|---|---|
| 字段 | id / username / **email** / is_active / created_at | id / username |
| 用在哪 | 返回"你自己的资料"（要登录、是自己） | 嵌在**公开**的文章列表里 |
| 原因 | 本人看自己的邮箱没问题 | 文章是公开的，撒作者邮箱 = **隐私泄露** |

又是"**同一张表 → 多个对外视图**"，和 B.8 的白名单一脉相承：
**关联对象也是白名单，露什么由契约决定，不由 ORM 决定。**

### 八、`expire_on_commit` 与"写完重新查一遍"

`database.py` 里 `sessionmaker(...)` 用的默认配置是 **`expire_on_commit=True`**，意思是：

> **commit 之后，这个对象身上所有属性都标记为"过期"，下次访问会重新去数据库读。**

于是 `return post` 时，序列化要读 `post.author` → 触发一次**隐藏的额外查询**。
与其让它偷偷发生，不如主动明确地查：

```python
def reload_post(db: Session, post_id: int) -> Post:
    """写完库之后，重新查一遍再返回（顺带把作者一起带出来）。"""
    return db.scalars(
        select(Post).where(Post.id == post_id).options(LOAD_AUTHOR)
    ).one()
```

`create_post` / `update_post` 都改成 `return reload_post(db, post.id)`：

- 一样能拿到数据库生成的 `id` / `created_at`（原来 `db.refresh(post)` 的作用）；
- 额外把 `author` 加载好，序列化时不再偷偷查库。

`.one()` 要求"恰好一条"，不满足就抛异常——这两个场景都是"刚写完，肯定存在"，用它比 `.first()` 更能暴露意外。

### 九、验证

```powershell
uvicorn app.main:app --reload     # 不需要 --rebuild，表结构没变
```

| 接口 | 期望 |
|---|---|
| `GET /posts` | 每项的 `author` 是 `{"id":1,"username":"alice"}`，**没有 email** |
| `GET /posts/1` | 同上，且**没有** `author_id` 之外的敏感字段 |
| `GET /latest` | 同上 |
| `GET /posts/mine`（带 token） | 同上 |
| `POST /posts`（带 token） | `201`，`author` 就是当前登录用户 |

**想看 SQL 就开 `echo`**：在 `database.py` 的 `create_engine(...)` 里临时加 `echo=True`，
调一次 `GET /posts` 数一下——应该是 **2 条**（posts 一条、users 一条 `IN`）。

### 十、要点 / 坑

- `relationship` **不是数据库的列**，加它**不需要改表结构**。
- `author_id` 是数据，`author` 是"帮你查了一下"——后者每次访问可能要花查询。
- 双向关系用 `back_populates` 配对，`if TYPE_CHECKING` + 字符串注解解决循环导入。
- **N+1 = 1 + N**：列表里出现关联对象，就一定要预加载。隐藏查询不报错，最难查。
- 测 N+1 时注意**身份映射**：同作者的数据会让懒加载只查 1 次，看不出问题。
- `selectinload`（2 条 SQL）适合一对多；`joinedload`（1 条）适合多对一。
- 关联对象也要**白名单**：`UserSummary` 只露 id + username，绝不带 email。
- `expire_on_commit=True` 是默认值：commit 后属性过期，`return obj` 可能触发隐藏查询。
- 写完库统一用"重新查一遍"的写法，别依赖懒加载在序列化时才去补数据。

---

## B.14 数据库迁移：Alembic（阶段11）

**为什么**：到阶段10 为止，每次"改表结构"都靠 `--rebuild`（`drop_all()` + `create_all()`）——
**把表连数据一起铲平重建**。阶段9 之前无所谓（库里是测试数据），但现在库里有**真实注册过的用户、
真发过的文章**（密码是 bcrypt 哈希，丢了不可恢复）。再来一次 `--rebuild`，这些全没。
Alembic 就是"**改表结构而不丢数据**"的正式工序。

**一句话概念**：Alembic 把每次表结构改动**记录成一个 Python 脚本**（内容是一条条 `ALTER TABLE`），
用 `down_revision` 把这些脚本**串成一条链**，数据库里用一张 **`alembic_version` 表**记住自己走到了哪一环。

**当前进度**（下次接着做时先看这个）：

| 步骤 | 状态 |
|---|---|
| ① 装 `alembic`、`alembic init migrations` | ✅ 已完成 |
| ② 改造 `migrations/env.py` + `alembic.ini` | ✅ 已完成 |
| ③ 用空库生成"从零建表"的基线脚本 | ✅ 已完成（`d1ecde516f60_init_tables.py`） |
| ④ `alembic stamp head` 接管已有库 | ✅ 已完成 |
| ⑤ 真实演练：给 `posts` 加一列，走完整流程 | ✅ 已完成（`f269474d87bb_add_views_to_posts.py`） |
| ⑥ 查看状态 + 回退演练 | ✅ 已完成 |

> **阶段 11 已结课。** 以后"改表结构"直接照 §十 那四步工序走，不用再从头读这一节。

---

### 一、先看清问题：`create_all()` 能做什么、不能做什么

`Base.metadata.create_all()` 一直在用，但它只有**一个**能力：
遍历 metadata 里的表，**哪些表在数据库里不存在，就 CREATE 它**。

它的"不能"列表才是关键：

| 你想做的事 | `create_all()` 的反应 |
|---|---|
| 新建一张表 | ✅ 会做 |
| 给已有表**加一列** | ❌ **完全无视**，一个字节都不改 |
| 改已有列的**类型 / 长度** | ❌ 完全无视 |
| 删一列 | ❌ 完全无视 |
| 给已有表加索引 | ❌ 无视 |
| 记录"我做过什么改动" | ❌ 没有这个概念 |
| 撤销上一次改动 | ❌ 做不到 |

所以只要动了模型，唯一出路就是 `drop_all()` + `create_all()` —— **把整张表连数据一起铲平重来**。

**三宗罪**：

1. **只创建，不修改** → 一改模型就得铲平
2. **铲平就丢数据** → 真实数据在裸奔（阶段9 的 `--rebuild` 就是拿数据换的）
3. **不留痕迹** → 无法回答"这个库现在到底是哪个状态？"

---

### 二、Alembic 的答案：变更脚本 + 版本链 + `alembic_version` 表

| 问题 | Alembic 的答案 |
|---|---|
| 只创建不修改 | 生成**变更脚本**：`ALTER TABLE posts ADD COLUMN ...` |
| 丢数据 | 执行 `ALTER TABLE`，**数据原地保留** |
| 不留痕迹 | 每次变更落成一个脚本文件，前后串成一条链 |
| 不知道当前在哪一版 | 往数据库里加一张 **`alembic_version`** 表，只存"当前版本号" |

**`alembic_version` 就是"版本指针"**——这就是上面那张表里最关键的一行：

```sql
SELECT * FROM alembic_version;
-- version_num
-- d1ecde516f60      ← 就这一个值，告诉 Alembic "你走到这一步了"
```

有了它，Alembic 才知道该从哪继续走、该回退到哪。

---

### 三、类比：一个迁移脚本 = 一个 Git commit

这个类比能一次说通所有概念：

| Git | Alembic |
|---|---|
| 一次 `commit` | 一个**迁移脚本**（`versions/xxxx.py`） |
| commit 记的是 **diff**（改了什么），不是整个快照 | 脚本记的是 **`ALTER TABLE ...`**，不是整张表 |
| 有 hash、有 parent | 有 `revision`、有 `down_revision` |
| `HEAD` = 最新提交 | `head` = 最新迁移 |
| `git log` | `alembic history` |
| `git checkout <hash>` 切到历史版本 | `alembic upgrade <revision>` 切到某版本 |
| 仓库靠 `.git/` 记状态 | 数据库靠 **`alembic_version` 表**记状态 |

于是所有脚本被 `down_revision` 串成**一条链**：

```
None ← 脚本1 ← 脚本2 ← 脚本3 ← ... ← 脚本N
                                          ↑
                                        head
```

数据库的 `alembic_version` 指着链上的某一环。
`alembic upgrade head` = 沿着链走到最右边；`alembic downgrade -1` = 往左退一格。

---

### 四、每个迁移脚本长什么样

**骨架卡：一个迁移脚本的固定结构**

```python
revision: str = 'd1ecde516f60'                          # 我自己的 id
down_revision: Union[str, Sequence[str], None] = None   # 我的上一个是谁（parent）；第一个是 None
branch_labels = None
depends_on = None

def upgrade() -> None:
    """往前走：应用这次改动。"""
    op.create_table('users', ...)          # 这里写 DDL

def downgrade() -> None:
    """往回退：撤销这次改动（upgrade 的反操作）。"""
    op.drop_table('users')
```

文件名形如 `d1ecde516f60_init_tables.py` = **版本号 + 你 `-m` 写的说明**。

**两个必须知道的 Python 点**：

1. **`upgrade` / `downgrade` 是靠「名字」被外部调用的**。你从没写过调用它们的代码 ——
   是 Alembic 在执行时去文件里找这两个**固定名字**的函数然后调用。这类"你按约定命名、框架负责调用"
   的函数叫**回调（callback）**，项目里的 `get_db()` 是同一类东西（区别：`get_db` 是 `Depends()` 显式登记，
   这两个是靠名字被找到）。
2. **迁移脚本就是普通 Python 文件**，不是特殊 DSL。Alembic 只认 `revision` / `upgrade` / `downgrade`
   三个名字，其余你想写 `if`、写循环、写辅助函数都行。（以后做"给现有用户批量补数据"就靠这个能力。）

---

### 五、安装与初始化

```powershell
conda activate studyPy312
cd c:\Users\yechen\Desktop\temp\blog-api
python -m pip install -r requirements.txt      # requirements.txt 里已加 alembic>=1.13
alembic init migrations
```

生成的结构：

```
blog-api/
├── alembic.ini          ← 配置文件（Alembic 一启动就读它）
└── migrations/
    ├── env.py           ← 【核心】把项目接进 Alembic 的地方，必改
    ├── script.py.mako   ← 生成新脚本时的"模板"
    ├── README
    └── versions/        ← 空的，以后每个迁移脚本放这里
```

> **顺序很关键**：`init` 之后**先别跑任何 `revision` / `upgrade`**。
> 默认的 `env.py` 既不知道你的模型在哪、也不知道数据库在哪，跑出来只会是空脚本或连不上库。

---

### 六、【必改】改造 `migrations/env.py`

生成的 `env.py` **完全不认识你的项目**，初始状态是：

```python
target_metadata = None        # ← 等于闭着眼睛，不知道你的表长什么样
```

改造分三处（本项目实际代码）：

**改造 1：把项目自己的东西接进来**

```python
from app.core.config import settings        # 数据库 URL（值来自 .env）
from app.core.database import Base          # 装着所有表定义的"总目录"
import app.models                           # 【关键】触发模型注册，删了就失效
```

> **`import app.models` 不能删 —— 本阶段最容易踩的坑，而且它不报错。**

原理：每次写 `class Post(Base)`，SQLAlchemy 就在那一刻把 posts 表的定义**登记进 `Base.metadata`**；
而 **Python 里"执行别的模块里的代码"的唯一办法就是 `import` 它**。

- 少了这句 → `Base.metadata` 是一本**空白目录** → Alembic 打印 `No changes in schema detected.`
- **它不会告诉你"你忘了 import"**，它只是**真的没"看见"你的表**。

本项目 `app/models/__init__.py` 已统一导出 `Post` / `User`，所以一句 `import app.models` 就够。

**改造 2：把真实数据库 URL 交给 Alembic**

```python
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("%", "%%"))
```

- `alembic.ini` 里的 `sqlalchemy.url` 是**占位符**（密码不能进代码仓库）。
- `set_main_option` 把值写进**内存里的 config 副本**，之后所有读这个 key 的地方拿到的都是覆盖后的值。
- 价值不只是"藏密码"：**应用和迁移从此指向同一个库**，不会出现"应用写 A 库、迁移却改 B 库"。
- `replace("%", "%%")` 是纯防御：ini 格式里 `%` 是插值符，密码里万一有 `%` 会报一个看不懂的错。

**改造 3：把"总目录"交出去**

```python
target_metadata = Base.metadata     # autogenerate 的燃料
```

传的是**对象本身（引用）**，不是拷贝 —— 所以改造 1 的 import 必须生效。

**另外：两处 `context.configure(...)` 都加了 `compare_type=True`**

```python
context.configure(
    connection=connection,
    target_metadata=target_metadata,
    compare_type=True,          # 默认【关】；不开就检测不到"列类型变了"
)
```

- 不开它：把 `String(50)` 改成 `String(100)`，autogenerate 会说"没有变化"。
- 开了它：会生成 `op.alter_column('users', 'username', type_=sa.String(length=100))`。

**还有一条硬约束：alembic 命令必须在项目根目录（`blog-api/`）下执行**

`alembic.ini` 里有一行：

```ini
prepend_sys_path = .
```

它把"当前目录"加进 Python 的模块搜索路径 —— `env.py` 里 `from app.core.config import settings`
才找得到 `app` 包。

> **报 `ModuleNotFoundError: No module named 'app'` 时，九成是没在 `blog-api/` 目录下执行。**

---

### 七、【最核心】`--autogenerate` 是"差值计算器"

这是本阶段最值钱的认知，用一条减法式子记住：

```
     你的模型（target_metadata）
   −  数据库当前的真实结构
   ────────────────────────────
     = 生成的升级脚本
```

**同一份模型，跑出什么结果完全取决于"数据库现状"**：

| 数据库现状 | 差值 | 生成什么 |
|---|---|---|
| **空的** | 模型有 N 张表，库里 0 张 | `op.create_table(...)` 全建 |
| 表已存在且结构一致 | 0 | **`pass`（空脚本）** |
| 表存在但少一列 | 模型多一列 | `op.add_column(...)` |
| 表存在但多一列 | 模型没有这列 | `op.drop_column(...)` ← **反向也成立** |
| 列类型不同 | — | `op.alter_column(...)`（需开 `compare_type`） |

**必须记住两点**：

1. **它是双向的**：少东西会生成 `create` / `add`，**多东西会生成 `drop`**。
   也就是说 `--autogenerate` 可能给你写出一份"**删表脚本**" —— 所以**审稿这一步永远不能省**。
2. **`revision` 只写文件，`upgrade` 才动数据库。**
   所以 `revision` 本身是安全的，危险的是 `upgrade`。

---

### 八、实战第一步：给「已有数据的库」建基线

我们的库**已经有 `users` / `posts` 两张表**了（历史上用 `create_all()` 建的），所以第一次跑：

```powershell
alembic revision --autogenerate -m "init tables"
```

**输出里没有任何 `Detected` 行**，生成的脚本是空的：

```python
def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    pass
    # ### end Alembic commands ###
```

**为什么是空的**：库里的表和模型完全一致 → 差值 0 → 没有可写的东西。**这是正常的，不是失败。**

> **一个很有价值的旁证**：假如 `env.py` 里那句 `import app.models` 没生效，Alembic 看到的模型是**空的**，
> 而库里有两张表 → 差值 = "模型没有但库里有" → 它会生成 `op.drop_table('users')`，
> 输出里会出现 `Detected removed table 'users'`。
> **正因为我们一条 `Detected` 都没有，反而证明模型被正确读到了。**

**但空脚本不能当基线**：它意味着"拿一个全新的空库跑 `upgrade head`，什么都建不出来"。
将来写 pytest（需要干净测试库）、部署到新环境（要靠迁移建表）都会需要这份"从零建表"的脚本。

**正确做法：给它一个空库去对比。**

关键是**不要动 `.env`、不要动任何文件**，用**环境变量临时覆盖**
（`pydantic-settings` 的优先级是 **环境变量 > `.env` 文件**）：

```powershell
cd c:\Users\yechen\Desktop\temp\blog-api

# 1) 删掉那个空脚本
Remove-Item migrations\versions\<空脚本文件名>.py

# 2) 临时把数据库指向一个不存在的 SQLite 文件（= 一个空库）
$env:DATABASE_URL = "sqlite:///./_baseline_tmp.db"

# 3) 生成"从零建表"的完整基线
alembic revision --autogenerate -m "init tables"

# 4) 立刻清掉临时变量，让 .env 里的 MySQL 重新生效
Remove-Item Env:DATABASE_URL

# 5) 清掉临时产生的 SQLite 文件
Remove-Item _baseline_tmp.db
```

这次输出就有 `Detected added table 'users'` / `'posts'` / 各种 `Detected added index ...` 了。

> 输出里 `on '('email',)'` 那种怪写法是 **Python 单元素元组的打印形式**（必须有逗号），不用管。

**为什么拿 SQLite 生成的脚本，对 MySQL 也作数**（反直觉但很重要）：

> **`op.create_table(...)` 里的列定义，是 Alembic 照着「模型」写的，不是照着数据库抄的。**
> 数据库只在**对比阶段**参与（提供"我现在长什么样"）；**写脚本阶段**的内容全部来自 `target_metadata`。
> 所以拿哪个空库去对比，写出来的列定义都一样（`sa.Integer()`、`sa.String(50)` 这些和方言无关）。

> 【够用就行】唯一的方言痕迹在 `server_default`：SQLite 那边渲染成 `sa.text('(CURRENT_TIMESTAMP)')`（多了一层括号），
> MySQL 的标准写法是 `DEFAULT CURRENT_TIMESTAMP`。生成后**手工把括号去掉**即可。
> 这正是脚本里那句 `# ### commands auto generated by Alembic - please adjust! ###`（**请自行调整**）的用意。

---

### 九、审稿：怎么读一份迁移脚本

生成的 `d1ecde516f60_init_tables.py` 要和模型**逐行对照**：

| 脚本里写的 | 模型里的出处 |
|---|---|
| `op.create_table('users', ...)` | `class User(Base)` + `__tablename__ = "users"` |
| `sa.Column('username', sa.String(length=50), nullable=False)` | `username: Mapped[str] = mapped_column(String(50), unique=True, index=True)` |
| `op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)` | 上面那个 `unique=True` |
| `sa.PrimaryKeyConstraint('id')` | `primary_key=True` |
| `sa.ForeignKeyConstraint(['author_id'], ['users.id'])` | `ForeignKey("users.id")` |
| `server_default=sa.text('CURRENT_TIMESTAMP')` | `server_default=func.now()` |
| `down_revision = None` | 说明这是版本链的**第一个节点**（第一个 commit） |

**三个"看不出来但很关键"的点**：

**① 建表顺序 = 外键依赖顺序**

```python
op.create_table('users', ...)     # 被依赖的一方先建
op.create_table('posts', ...)     # posts.author_id 指向 users.id，必须等 users 存在
```

**② `downgrade` 是 `upgrade` 的完全逆序**

```python
op.drop_index(... 'posts' ...)    # 先删索引
op.drop_table('posts')            # 再删 posts（它的外键指着 users，必须先删它）
op.drop_index(... 'users' ...)
op.drop_table('users')            # users 最后删
```

先建的后删、后建的先删。`alembic downgrade` 就是靠它干净回退。

**③ 有些东西"应该出现却没出现"，是正常的**

| 没出现的 | 为什么 |
|---|---|
| **`relationship`（`author` / `posts`）** | 它是**纯 Python 层的导航属性**，数据库不知道它存在 → **铁证：`relationship` 永远不进迁移脚本** |
| **`onupdate=func.now()`** | 它属于 **ORM 层**（生成 UPDATE 语句时自动塞值），**不是 DDL** |

> 对照记牢：同一行 `mapped_column` 上的两个参数 —— `server_default` 是 **DDL**（进表定义），
> `onupdate` **不是**（只活在 Python 里）。

---

### 十、三个命令的分工（最容易混，务必分清）

| 命令 | 动数据库吗 | 干什么 |
|---|---|---|
| `alembic revision --autogenerate -m "..."` | **不** | 只写文件（生成脚本 = 画图纸） |
| `alembic stamp <rev>` | **只**写 `alembic_version` | 声明"我已经在这个版本了"，**不执行脚本里的 SQL** |
| `alembic upgrade <rev>` | **会**执行脚本里的 SQL | 真正施工 |

**以后的日常工序（改表结构就走这四步）**：

```
① 改模型（mapped_column 那部分）
② alembic revision --autogenerate -m "说明"
③ 【审稿】打开生成的脚本读一遍，该改的改掉
④ alembic upgrade head
```

---

### 十一、`stamp head`：把「已有数据的库」接管过来

基线脚本有了，最后一步是**让数据库知道自己现在在哪一版**：

```powershell
alembic stamp head
```

`stamp` 的含义：

> **把数据库的版本指针直接拨到 `head`，且不执行任何 SQL。**

它只做两件事：

1. 在 MySQL 里创建 `alembic_version` 表（如果不存在）；
2. 往里写一行版本号（`d1ecde516f60`）。

**为什么不能用 `alembic upgrade head`？** 因为 `upgrade` 会**真的执行脚本里的 SQL** ——
而脚本里写的是 `op.create_table('users', ...)`，你的库里 users 已经存在了 →
直接报 `Table 'users' already exists`。

**验证**：

```powershell
alembic current
# d1ecde516f60 (head)        ← 这就是"迁移系统正式上线"的标志
```

也可以直接去数据库里看：

```sql
SELECT * FROM alembic_version;
```

> **补充**：对"空脚本"来说，`upgrade head` 和 `stamp head` 效果一样（都是建表 + 写版本号，因为脚本里没 SQL）。
> 但**概念上必须用 `stamp`** —— 它的语义就是"我声明这个版本已经应用了，但不要执行"。
> 一旦脚本里真有 `create_table`（我们现在这份基线），用 `upgrade` 就会炸。

---

### 十二、真实演练：给「已有数据的表」加一列

这是"改表结构不丢数据"的第一次亲身体验。目标：给 `posts` 加一列 `views`（浏览量）。

**第 1 步：改模型**

```python
# app/models/post.py
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func

    published: Mapped[bool] = mapped_column(Boolean, default=False)

    views: Mapped[int] = mapped_column(Integer, server_default="0")
```

**⭐ 本节核心：`default` 和 `server_default` 不是一回事**

| | 活在哪儿 | 什么时候起作用 | 表结构里有痕迹吗 |
|---|---|---|---|
| `default=0` | **Python 层**（SQLAlchemy） | ORM 生成 `INSERT` 时替你填 0 | ❌ 数据库不知道有这回事 |
| `server_default="0"` | **表结构层**（DDL） | 建表 / 加列时写成 `DEFAULT 0` | ✅ `SHOW CREATE TABLE` 看得到 |

> 至此同一行 `mapped_column(...)` 上的**三个参数凑齐了**（呼应 §九 的 ③）：
> | 参数 | 属于哪层 | 进迁移脚本吗 |
> |---|---|---|
> | `server_default` | **DDL** | ✅ 进（表结构的一部分） |
> | `default` | ORM 层 | ❌ 不进 |
> | `onupdate` | ORM 层 | ❌ 不进 |

**为什么加列必须写 `server_default`？**

`ALTER TABLE posts ADD COLUMN views INTEGER NOT NULL` 时，数据库要动手去改**已经存在的那几行**——它必须知道"老行的 `views` 填什么"。**它只认表结构里的 `DEFAULT`**，ORM 的 `default=` 对它是隐形的。

两个都不写 → MySQL 答不上来（"新列不许为空，老行填什么？"）→ **`ALTER TABLE` 直接失败**。

> **对照记忆**：`published` 当年是**建表**时加的（表还空着，没有老数据要填），所以只写 `default=False` 也一直没事。
> **同样是"给列一个默认值"，建表时和改表时的要求并不一样** —— 这就是最容易踩的那块石头。

**第 2 步：生成脚本**（只写文件，不动库）

```powershell
alembic revision --autogenerate -m "add views to posts"
```

本项目实际输出：

```
INFO  [alembic.autogenerate.compare.tables] Detected added column 'posts.views'
Generating ...\migrations\versions\f269474d87bb_add_views_to_posts.py ...  done
```

**第 3 步：审稿**

```python
revision: str = 'f269474d87bb'
down_revision: Union[str, Sequence[str], None] = 'd1ecde516f60'    # ← 接在上一个脚本上，链子没断

def upgrade() -> None:
    op.add_column('posts', sa.Column('views', sa.Integer(), server_default='0', nullable=False))

def downgrade() -> None:
    op.drop_column('posts', 'views')
```

逐项对照：

| 脚本里 | 来源 / 期望 | |
|---|---|---|
| `down_revision = 'd1ecde516f60'` | 上一个脚本的 id | ✓ |
| `'posts'` / `'views'` / `sa.Integer()` | `__tablename__` / 属性名 / `Integer` | ✓ |
| `nullable=False` | `Mapped[int]` 没写 `Optional` | ✓ |
| `server_default='0'` | `server_default="0"` | ✓ **关键项在** |
| 只有 `add_column`，没有 `drop_*` / `alter_column` | 没有意外操作 | ✓ |

**审稿第一条永远是：看会不会丢数据。**

`add_column` 是**安全操作** —— 数据库只在每行后面补一列，老行的这一列填 `DEFAULT` 值，**其他列一个字节都不动**。这就是"改表不丢数据"的全部原理。

**那什么时候会丢？改名字的时候：**

```python
# 你以为只是把 content 改名成 body
body: Mapped[str] = mapped_column(Text)
```

Alembic 看到的是"少了一个 `content`、多了一个 `body`"，于是生成：

```python
op.drop_column('posts', 'content')                                  # 💀 文章正文清零
op.add_column('posts', sa.Column('body', sa.Text(), nullable=False))
```

**它不可能知道这俩是同一列、只是换了名字。** 这种情况必须人工改成：

```python
op.alter_column('posts', 'content', new_column_name='body')
```

> **autogenerate 交给你的是一份"草稿"，签字的人是你。** 这是 Alembic 全流程里唯一不能偷懒的一步。

**第 4 步：真正改表**

```powershell
alembic upgrade head
```

```
INFO  [alembic.runtime.migration] Running upgrade d1ecde516f60 -> f269474d87bb, add views to posts
```

> `Running upgrade A -> B` 里的 **A 是数据库 `alembic_version` 里的值**，B 是 A 在版本链上的下一环。
> Alembic 靠这张表知道"我该从哪儿继续走"。

**第 5 步：验证（三条证据）**

```sql
SELECT COUNT(*) FROM posts;            -- 与演练前的数字一致 → 数据没丢
SELECT id, title, views FROM posts;    -- 老数据原样在，views 全为 0
SHOW CREATE TABLE posts;               -- 表结构里出现：`views` int NOT NULL DEFAULT '0'
```

第 3 条是**铁证**：`DEFAULT '0'` 出现在表结构里，说明默认值真的交给数据库管了。
（对照 `default=False`：表结构里查无此事，只在 Python 层存在。）

**⚠️ 必须建立的副作用直觉：改完模型不跑迁移，应用就是坏的**

```python
# 此刻启动 uvicorn 去查 posts，会直接炸：
sqlalchemy.exc.OperationalError: (pymysql.err.OperationalError) (1054, "Unknown column 'posts.views' in 'field list'")
```

这不是 bug，是在提醒你"**代码和表结构漂移了**"。
**Alembic 存在的全部理由，就是这个报错。**

---

### 十三、查看状态 + 回退演练

**三条查看命令**

```powershell
alembic current     # 我现在踩在链条的哪一格
alembic history     # 整条链长什么样
alembic heads       # 链的末端（upgrade head 的目标）是谁
```

```
# alembic current
f269474d87bb (head)

# alembic history
d1ecde516f60 -> f269474d87bb (head), add views to posts
<base> -> d1ecde516f60, init tables

# alembic heads
f269474d87bb (head)
```

**关键区分（排查问题的起点）：**

| 命令 | 读的是哪儿 | 回答的问题 |
|---|---|---|
| `current` | **数据库**里的 `alembic_version` 表 | "实际走到哪了" |
| `history` / `heads` | **脚本目录** `versions/` | "总共有哪些路" |

> **两张纸对不上，就是出问题的时候**（比如脚本被删了、版本号却还指着它）。

**回退演练**

```powershell
alembic downgrade -1        # 往左退一格
```

```
INFO  [alembic.runtime.migration] Running downgrade f269474d87bb -> d1ecde516f60, add views to posts
```

再查 `SHOW CREATE TABLE posts;` → **`views` 列消失了**（因为 `downgrade()` 写的是 `op.drop_column`）。

升回来：

```powershell
alembic upgrade head
```

→ `views` 回来了，但**值是 0**。

**⚠️ 这一趟看清楚的事：**

`downgrade` 把列**连数据一起删了**；`upgrade` 重新加的是一列**全新的、空白的**列，**数值回不到从前**。

> **`downgrade` 不是 Ctrl+Z。** 它的语义是"就当这件事从没做过"，而不是"撤销刚才那一步"。
> 生产环境里它是灾难恢复手段，不是日常操作。

---

### 十四、三条铁律

**① 已经 `upgrade` 过的脚本，永远不要改。**

改了也不会重跑 —— `alembic_version` 里已记着这个版本号，Alembic 认定"它做过了"。

后果：**你的库是旧结构，同事拉代码执行后是新结构，两边版本号相同、表结构不同。** 这种"静默不一致"极难排查。

要变，就**新加一个脚本**。

**② 改模型 ≠ 改表。**

改完 `.py` 不跑迁移，应用就是坏的（`Unknown column`）。

**③ 迁移脚本要提交到 Git，和代码一起走。**

它是项目的一部分，不是本地临时产物。

---

### 十五、要点 / 坑

- `create_all()` **只创建、不修改**：一改模型就得铲平重建，且**丢数据**。
- Alembic 三件武器：**变更脚本**（`ALTER` 而非重建）、**版本链**（`down_revision` 串起来）、**`alembic_version` 表**（当前位置指针）。
- **一个脚本 = 一个 Git commit**：`revision` 是 hash，`down_revision` 是 parent，`head` 是 HEAD。
- `env.py` **三处必改**：`import app.models`（绝不能删）、`set_main_option` 覆盖 URL、`target_metadata = Base.metadata`。
- 不 import 模型 → Alembic 看到空目录 → 说"没有变化"（**不报错，最难查**）。
- `--autogenerate` = **模型 − 数据库现状**，结果由"库现状"决定，**不是**由模型单方面决定。
- 它**双向**：会生成 `create` / `add`，**也会生成 `drop`** → **审稿永远不能省**。
- `revision` 只写文件；`upgrade` 才动库；`stamp` 只拨版本号。
- **接管"已有数据的库"**：先对**空库** `--autogenerate` 生成基线，再对**真库** `stamp head`，**绝不 upgrade**。
- 命令必须在**项目根目录**执行（`prepend_sys_path = .`）；否则 `No module named 'app'`。
- `compare_type=True` 别忘了，否则改列类型检测不到。
- `relationship` / `onupdate` **永远不会**出现在迁移脚本里（一个不进数据库、一个是 ORM 层）。
- 生成后**务必审稿**，尤其 `server_default` 的方言写法（从 SQLite 生成会多一层括号）。
- 给**已有数据**的表加 `NOT NULL` 列，**`server_default` 是必需品**；`default=` 只活在 Python 层，救不了它。
- **改名会被 autogenerate 理解成"删 + 加"**（`drop_column` + `add_column`）→ 数据清零；必须手动改成 `op.alter_column(..., new_column_name=...)`。
- **`downgrade` 会丢数据**，它不是 Ctrl+Z（数值/内容回不来）。
- **已 `upgrade` 过的脚本永不修改**；要变就新加一个，否则本地与同事的库"版本号相同、结构不同"。
- `current` 读**数据库**（`alembic_version`），`history` / `heads` 读**脚本目录**；两者对不上就是在报故障。

---

## B.15 浏览量计数：原子更新与读写分离（阶段12）

**为什么**：阶段11 给 `posts` 加了 `views` 列，但那一列一直是**死的**——没有任何代码去动它。
这次让它真正工作。

看起来只是"加一行 `post.views += 1`"，实际撞上了两个真问题：一个是**并发**（计数会算错），
一个是**HTTP 语义**（写动作不该挂在 GET 上）。两个都不是语法问题，是**设计问题**——
这正是本阶段最大的收获。

**一句话概念**：让计数正确，只要两件事——**① 让数据库自己去加**（并发安全）；
**② 让写动作单独有个地址**（GET 保持只读）。

**当前进度**：✅ 已结课。`views` 列由阶段11 的迁移（`f269474d87bb`）加好，**本次没有新增迁移**。

> 阶段 12 已结课。骨架卡见 §十。

---

### 一、起点：`views` 列已经有了，但是死的

B.14 的演练给 `posts` 加了 `views`（`server_default='0'`）并且 `upgrade` 过了，
但库里所有文章的 `views` 都是 0 —— 因为没有任何代码去改它。

最直觉的写法（就是阶段4 学的"改"）：

```python
post.views += 1
db.commit()
```

**单机自己点，完全没问题。** 问题出在"同时"。

---

### 二、第一个坑：丢失更新（lost update）

`post.views += 1` 在 Python 里其实是**三步**：

```
① 读：把 views 从库里取出来（假设是 5）
② 加：在 Python 里算 5 + 1 = 6
③ 写：UPDATE posts SET views = 6      ← 注意：写的是【死数字 6】
```

它写的不是"加一"，是"**等于 6**"。于是两个请求撞在一起时：

| 时刻 | 请求 A | 请求 B | 库里 `views` |
|---|---|---|---|
| t1 | 读到 5 | | 5 |
| t2 | | 读到 5 | 5 |
| t3 | 算出 6，写回 6 | | **6** |
| t4 | | 算出 6，写回 6 | **6** |

**两次浏览，数字只涨了 1。** 这叫**丢失更新（lost update）**。

它最可怕的地方：**本地单机测试永远发现不了**——你一个人点，不会有第二个请求插进来。
一上量就数字不对，而且**不报错**，只是"比实际少"。这类"只在并发下出现、不报错、不崩"的 bug，
是最难查的一类。

---

### 三、解法：把"加法"交给数据库

```python
db.execute(update(Post).where(Post.id == post.id).values(views=Post.views + 1))
db.commit()
```

生成的是：

```sql
UPDATE posts SET views = views + 1 WHERE id = ?
--                        ↑ 让数据库自己读、自己加
```

**读和加在数据库内部一次完成**，中间不留空档。而且 InnoDB 执行 `UPDATE` 时本来就会给这一行
加**排他锁**，两个请求只能排队，天然算不错。

这就是"**原子操作**"的含义：不可分割，要么全做完，要么没发生。

---

### 四、`Post.views + 1` 的 `+`，不是 Python 加法

本阶段最容易误解的一处。

`Post.views` **不是数字**，它是 SQLAlchemy 的**列对象**。列对象实现了 `__add__` 魔术方法，
所以 `Post.views + 1` 造出来的**不是 6，而是一个 SQL 表达式对象**：

```python
print(Post.views + 1)
# posts.views + :views_1        ← 一段 SQL，不是一个数
```

| 同一个 `+` | 左边是什么 | 谁来算 | 什么时候算 |
|---|---|---|---|
| `5 + 1` | 数字 | Python | 立刻，得到 6 |
| `Post.views + 1` | **列对象** | **数据库** | 执行 SQL 时，在库里算 |

所以 `.values(views=Post.views + 1)` 的意思是"**这一列的新值 = 你自己加 1**"，
而不是"这一列的新值 = 我算好的 6"。

**同一个符号，加在"数字"上和加在"列"上，含义完全不同。**

> 记住这条，你就顺手理解了 SQLAlchemy 里一整类写法：`Post.views + 1`、`func.count()`、
> `Post.title.ilike(...)` —— **它们不是"现在算出一个结果"，而是"描述一段将来在数据库里执行的运算"。**

---

### 五、第二个坑：GET 不该写库

第一版是把 `+1` 直接内联在 `GET /posts/{post_id}` 里的。能跑通，但违反 HTTP 规范。

**GET 属于【安全方法（safe method）】**：规范保证它"只读、无副作用"。这不是洁癖——
现实里有一堆东西会**随手**发 GET：

| 谁会替你发 GET | 后果 |
|---|---|
| 浏览器**预加载**链接（鼠标还没点，请求已经出去了） | 数字虚高 |
| 搜索引擎**爬虫** | 数字暴涨 |
| 超时后**自动重试**的客户端 / 代理（正因为"安全"才敢重试） | 一次浏览算 2~3 次 |
| 缓存 GET 响应的 **CDN / 反向代理** | 行为不可预测 |

副作用挂在 GET 上，计数就会被这些"**根本不算阅读**"的请求灌水。

> **推论：GET 里出现任何写库动作，都是设计出了问题的信号。**

---

### 六、解法：读接口 / 写接口分工

| 接口 | 性质 | 干什么 |
|---|---|---|
| `GET /posts/{post_id}` | 只读（安全方法） | 返回文章内容，**一个字节都不写** |
| `POST /posts/{post_id}/views` | 写（有副作用） | 浏览量 +1，返回 204 |

```python
# 读接口：纯读。注意连 db 依赖都不需要了——没有任何东西要写
@router.get("/{post_id}", response_model=PostRead, responses=NOT_FOUND)
def get_post(post: Post = Depends(get_post_or_404)):
    return post

# 写接口：只负责计数
@router.post("/{post_id}/views", status_code=status.HTTP_204_NO_CONTENT, responses=NOT_FOUND)
def record_view(post: Post = Depends(get_post_or_404), db: Session = Depends(get_db)):
    bump_views(db, post)
```

- **为什么是 POST 而不是 GET**：POST 在 HTTP 里就是"提交一份数据、让服务端做点什么"，
  **允许有副作用**，也不会被预加载 / 缓存 / 自动重试。
- **为什么返回 204**：204 = "收到了，办妥了，没什么要说的"。计数是**通知型动作**，
  客户端不需要结果（文章内容它早就拿到了）。非要返回最新值，前端就得**等这个请求回来**才能渲染，白多一个往返。

**代价是前端要多发一个请求：**

```
打开详情页 → GET  /posts/1          拿到内容，立刻渲染
           → POST /posts/1/views    另发一次，用户完全无感
```

这正是真实项目里**埋点 / 统计上报**的做法。所以这不是"乙方案的缺陷"，而是这件事**本来正确的形态**。

> 展示值会"差一次"：POST 完再 GET 才看到自己那次。真实产品里前端会先本地 `+1` 显示，
> 下次刷新自然对齐。计数场景下这种**最终一致**完全够用。

---

### 七、正解：抽成【普通函数】，不要抽成【依赖】

需求是"**计数要被多处用到**"，直觉会想到 `Depends`。**不行，理由很具体：**

1. **语义错位**：`Depends` 的返回值是**交给接口用的东西**（`pagination` / `current_user` / `post`）。
   而计数**没有返回值**，它是**动作**。把它塞进依赖，等于用"声明参数"的语法表达"执行动作"——
   **签名里完全看不出"这个 GET 会写库"**。

2. **缓存机制不是为它设计的**：依赖默认 `use_cache=True`，同一个请求里只执行一次。
   对"一次 +1"恰好合意，但这是**巧合**。一旦需求变成"给 N 篇各 +1"，依赖模型立刻失效——
   它的粒度天生就是"一个请求一次"。

3. **执行时机不可控**：依赖在**进入函数体之前**就执行完了。接口函数体后面万一抛异常，
   **计数已经加了，用户却什么都没看到**。

4. **测试时会惊讶**：写个测试只发了 GET，数据库却变了。副作用藏得越深，越难发现。

**正确做法——普通函数 + 显式调用：**

```python
def bump_views(db: Session, post: Post) -> None:
    """把一篇文章的浏览量 +1。这是一个【写动作】，只有写接口才该调用它。"""
    db.execute(update(Post).where(Post.id == post.id).values(views=Post.views + 1))
    db.commit()


def record_view(post: Post = Depends(get_post_or_404), db: Session = Depends(get_db)):
    bump_views(db, post)        # ← 动作写在函数体里，一眼能看到"这个接口会写库"
```

> **判据（值得刻进脑子）**：
> **依赖注入管的是"我需要什么"，普通函数管的是"我要做什么"。**
> 动作要**显式调用**，别藏在依赖里。

**附：什么时候该抽函数？**

这次 `bump_views` **只有一个调用点**，所以"消除重复"这个理由**不成立**——它属于**提前抽象**。
真实项目里直接内联进 `record_view` 也完全正确。抽它的理由是两条：

- 这段逻辑**承载了非显而易见的知识**（为什么绝不能用 `post.views += 1`）——**名字是知识的收纳盒**；
- 它是个**领域动作**，将来第二处（批量重算、数据修复脚本）出现时直接复用。

> **抽函数的判据**：不必等"第二次出现"。当一段代码**承载了非显而易见的知识**时，
> 给它一个名字就是划算的；反过来，两行平凡代码只有一个调用点，别急着抽。

---

### 八、一个意外收获：好设计会让"问题"自己消失

一开始的判断是"**有两个 GET 都要 +1**（`/{post_id}` 和 `/latest`），所以要抽函数来复用"。走完乙方案后，
这个问题**自己没了**：

| | 甲：GET 里 +1 | 乙：拆出写接口 |
|---|---|---|
| 计数逻辑在哪 | 散在 2 个 GET 里 | 只有 1 个 POST |
| 以后新增"展示文章"的接口 | 你**得记得**给它也加 +1 | **什么都不用做** |
| `/latest` | 也要改 | 不用动 |
| GET 的只读语义 | 破了 | 保住 |

**甲在治症状（代码重复），乙在治病因（写动作散落在读接口里）。**

> 这是本阶段最值钱的一条经验：**当同一件事需要"每处都记得做一遍"时，
> 更好的解法往往不是"把它封装好"，而是"让需要它的地方只剩一个"。**

---

### 九、验证

启动服务，打开 `http://127.0.0.1:8000/docs`：

| 步骤 | 操作 | 预期 |
|---|---|---|
| 1 | `GET /posts/1`，**连点 3 次** | 每次 200，`views` **始终同一个数** ← 证明 GET 已只读 |
| 2 | `POST /posts/1/views` | **204**，Response body **空** |
| 3 | 再 `GET /posts/1` | `views` 变成 **1**；再 POST 两次 → 变 3 |
| 4 | `SELECT id, title, views FROM posts WHERE id = 1;` | 与页面上的数字一致 |

> 第 1 步的"**不涨**"就是改动生效的铁证（改动前是点一次涨一次）。
> 小提示：验证 GET 别用浏览器直接开 `/posts/1`（浏览器可能缓存）；
> PowerShell 里的 `curl` 是 `Invoke-WebRequest` 的别名，命令行真要用请写 `curl.exe`。

---

### 十、骨架卡

**卡 1｜原子自增（并发安全）**

```python
db.execute(update(Post).where(Post.id == post.id).values(views=Post.views + 1))
db.commit()
#                                        ↑【不是 Python 加法！】
#              它生成的是 SQL：UPDATE posts SET views = views + 1 WHERE id = ?
```

**卡 2｜读写分工**

```
读：GET  /posts/{id}          → 纯读，绝不写库
写：POST /posts/{id}/views    → 计数，返回 204 No Content
```

**卡 3｜动作不要藏在依赖里**

```python
def bump_views(db, post) -> None: ...      # ✅ 普通函数，在函数体里显式调用
# ❌ _: None = Depends(bump_views)         # 语义错位 + 缓存干扰 + 时机不可控
```

**卡 4｜判断"这个动作该放 GET 还是 POST"**

```
会改变服务器状态吗？
  否 → GET（安全方法，可以缓存、可以被预加载、可以被重试）
  是 → POST / PATCH / DELETE（写在路径里，单独一个地址）
```

---

### 十一、生产环境还要做什么（知道就行）

| 问题 | 生产做法 |
|---|---|
| 刷新 / 爬虫灌水 | **防刷**：同一 IP / 用户一段时间内只计一次（Redis key + 过期时间） |
| 每次浏览都写 MySQL 太贵 | **Redis `INCR`** 先计数，定时批量回写数据库 |
| 列表页的 `views` | **只展示，不计数**——列表页涨的是"曝光量"，和"浏览量"是两个指标 |
| 更准确的"阅读" | 前端在**真正读完**（如停留 > 3 秒）之后才发上报请求 |

> 列表页为什么不该计数：用户只是**扫标题**，没有阅读任何一篇。一次请求给 10 篇各 +1，
> 涨的是**曝光量**；执行上也别扭——一次"读列表"引发一次 10 行的批量写，这个形状就说明设计拧了。

---

### 十二、要点 / 坑

- `post.views += 1` 生成的是 `SET views = 6`（**死数字**）→ 并发下**丢失更新**，本地测**永远发现不了**。
- 正解：`values(views=Post.views + 1)` → 生成 `SET views = views + 1`，**数据库内部一次完成**，天然并发安全。
- **`Post.views + 1` 里的 `+` 不是 Python 加法**：`Post.views` 是**列对象**，`+ 1` 造出的是 **SQL 表达式**对象，不是数字。
- 同一类写法还有 `func.count()`、`Post.title.ilike(...)`：**它们"描述运算"，不是"立即计算"**。
- **GET 是安全方法**：只读、无副作用。浏览器预加载 / 爬虫 / 重试 / CDN 都会乱发 GET。
- **GET 里出现写库动作 = 设计有问题**。写动作要有自己的地址（`POST`），别搭 GET 的车。
- 计数接口返回 **204**：通知型动作不需要响应体；返回最新值反而让前端多等一个往返。
- **别用 `Depends` 做副作用**：依赖的语义是"我需要什么"不是"我要做什么"，还有缓存（一请求一次）、
  执行时机在函数体之前、测试时看不见三个问题。
- **抽函数的判据**：不必等"第二次出现"；**承载了非显而易见的知识**时就该有名字。
- **治病因 > 治症状**：与其"每处都记得加一遍 +1"，不如让计数只剩**一个写入口**。
- **列表页不计数**：列表涨的是曝光量，不是浏览量；"展示 `views` 字段"和"给 `views` 加一"是两件事。

---

## B.16 前端页面：FastAPI 托管静态页 + 原生 JS 对接（阶段13）

**为什么**：到阶段12 为止，项目已经是一个功能完整的 API —— 但只能靠 `/docs` 点着玩。
`/docs` 是**给开发者的调试台**（Swagger UI 自动生成），不是用户界面：它没法发给别人用，
也没有"登录后按钮才出现""翻页""编辑自己的文章"这些产品层面的东西。
本阶段给它配一个**真的能点的界面**。

**一句话概念**：后端只管发 JSON，**页面由浏览器自己跑 JS 去调接口**。
两边靠"同源"这个前提，省掉了最麻烦的一环（CORS）。

**当前进度**：✅ 已结课。产物就两处：

| 文件 | 内容 |
|---|---|
| `app/static/index.html` | 约 600 行，HTML + CSS + JS **全在一个文件里** |
| `app/main.py` | 末尾 3 行挂载代码 |

**没有 npm、没有构建、没有第二个进程、没有一行 CORS 配置。**

---

### 一、怎么托管：`StaticFiles` + 同源

```python
# app/main.py
from pathlib import Path
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR, html=True), name="static")
```

| 写法 | 作用 |
|---|---|
| `app.mount("/static", ...)` | 把**一整个目录**挂到某个 URL 前缀下 —— 不是一条路由，是一棵"子树" |
| `directory=STATIC_DIR` | 磁盘上的真实目录。用 `Path(__file__).parent` 拼出来，**不依赖当前工作目录**，换机器/换启动位置都不会找不到 |
| `html=True` | 访问 `/static/`（一个目录）时自动返回 `index.html`，不用手打文件名 |
| `name="static"` | 挂载点的名字，用于反向查找 URL（`app.url_path_for`），起个名就行 |

**为什么这样最省事 —— 同源**：

| 情况 | 页面地址 | 接口地址 | 结果 |
|---|---|---|---|
| 本项目 | `http://127.0.0.1:8000/static/` | `http://127.0.0.1:8000/posts` | 协议 + 域名 + 端口**全一样** → 同源，**CORS 一行都不用配** |
| 若用 Vite | `http://localhost:5173/` | `http://127.0.0.1:8000/posts` | 端口不同 → **跨域**，必须配 `CORSMiddleware`（第 11 章） |

> 呼应第 11 章：**同源策略是浏览器的规矩**，跨域请求要被浏览器拦。
> 这里能省掉，纯粹是因为页面和接口由**同一个服务器、同一个端口**发出来。
> 说白了：**把前端塞进后端一起发，是最省事的破跨域手段**。

**mount 放哪**：放在路由注册**之后**。它按前缀做子树匹配，前缀不冲突就互不影响。

---

### 二、为什么不上框架：单文件就够

这个界面一共只有三块视图（列表 / 详情 / 编辑器）+ 一个弹窗。上 React/Vue 要引入
node、构建、打包、开发服务器 —— **成本远大于收益**，而且会遮住本阶段真正要学的东西
（浏览器怎么发请求、怎么带 token）。

换成框架要重做的事，这里都手写了，但都只有几行：

| 需求 | 框架里的做法 | 本项目 |
|---|---|---|
| 视图切换 | vue-router / react-router | `show('list'\|'detail'\|'editor')`：三个 `hidden` 一拨就完了 |
| 列表渲染 | `v-for` / `map` | 模板字符串 + `innerHTML`（配 `esc()`） |
| 状态 | `ref` / `useState` | 一个普通对象 `state = { skip, limit, q, ... }` |

> **判据**：界面规模小、状态少、不需要跨页复用组件时，**原生 JS 反而更快更清楚**。
> 等"手动同步状态"开始频繁出错，才是上框架的信号。

---

### 三、对接后端时的四个坑（都在 `api()` 里解决）

全站请求都走这一个函数（`async function api(path, opts)`），把重复的脏活收在一处：

**坑 1｜登录接口收的是【表单】，不是 JSON**

后端用 `OAuth2PasswordRequestForm`，它**只认** `Content-Type: application/x-www-form-urlencoded`：

```js
headers['Content-Type'] = 'application/x-www-form-urlencoded';
payload = new URLSearchParams(form);   // 不是 JSON.stringify
```

发 JSON 过去会被判 **422**，而且报错信息不容易看出原因 —— 很多人在这里卡住。
**一个后端项目里同时存在"收 JSON"和"收表单"的接口是正常的**（注册收 JSON，登录收表单），
前端要分别处理。

**坑 2｜204 不能 `res.json()`**

```js
if (res.status === 204) return null;   // 成功但没有响应体，硬解析会抛错
```

计数接口 `POST /posts/{id}/views` 返回的就是 204。

**坑 3｜422 的 `detail` 是【数组】不是字符串**

```js
const d = data.detail;
if (typeof d === 'string') return d;              // 主动报的 HTTPException
if (Array.isArray(d)) return d.map(e => e.msg).join('；');  // FastAPI 参数校验失败
```

两种形状都要认得，否则页面只会显示一句 `HTTP 422`，等于没报错。

**坑 4｜401 顺手清会话**

```js
if (res.status === 401){ clearSession(); renderTopbar(); }
```

token 过期后，任何需要登录的操作都会 401 —— 在这里统一把本地会话清掉、顶栏切回未登录，
不用每个调用点各写一遍。

---

### 四、排查思路：JS 明明跑了，界面却没变 ⭐

这是本阶段唯一卡住的地方，单独留一段 —— 因为它的**症状和病因完全不在同一个地方**：

| | |
|---|---|
| **现象** | 账号密码都对，接口也返回 200，但**登录弹窗不关** |
| **直觉** | JS 逻辑写错了？`saveSession` 抛异常了？事件没绑上？ |
| **实际** | JS **完全正常** —— `$('modal').hidden = true` 老老实实执行了。是 **CSS 把 `hidden` 这个属性顶掉了** |

**根因**：`hidden` **不是魔法开关**。它生效靠的只是浏览器默认样式表里的一条规则：

```css
[hidden] { display: none }
```

而我们的 CSS 里给同一个元素写了：

```css
.modal{ position:fixed; ...; display:flex; ... }
```

**作者样式表里的普通声明，永远压过浏览器默认样式表里的普通声明** ——
这是层叠规则里比"选择器权重"更靠前的**来源（origin）**那一层。
（本例中两者的权重其实一样，都是 `(0,1,0)`；但**来源优先级更高，所以作者赢**。
—— 记牢这句，以后遇到"我的规则权重明明不低啊"就能想起还有来源这一层。）

---

#### 通用排查三步（下次遇到"JS 不生效"照这个走）

| 步骤 | 做什么 | 目的 |
|---|---|---|
| ① 确认属性**有没有设上** | 控制台选中元素，敲 `$0.hidden`、看 `$0.outerHTML` | 排除"JS 逻辑错"。本例这一步会看到 `hidden` **确实在** → 立刻停止改 JS |
| ② 看**计算后**的样式 | DevTools → Elements → **Computed** → 查 `display` | 看到实际值是 `flex`，说明属性没起作用 |
| ③ 看这条样式**从哪来** | **Styles** 面板（能看规则来源是 `Author` 还是 `user agent stylesheet`，被划掉的声明也看得见） | 一眼看到 `.modal{display:flex}` 压过了 `[hidden]{display:none}` |

**三步走完，病因就定位在 CSS 了。**

---

#### 判据与解法

> **只要你在 CSS 里给某个元素写过 `display`，就别指望 `hidden` 属性还能藏住它。**

两种正解：

| 写法 | 说明 |
|---|---|
| `[hidden]{display:none !important}` | 全局压一道，**一处生效**，以后新增带 `display` 的类也不会再中招（本项目选这个） |
| `.modal:not([hidden]){display:flex}` | 用属性选择器自己控制，不用 `!important`；但每个带 `display` 的类都得记得改，容易漏 |

> 这里用 `!important` 是**正当**的：它的意图本来就是"压过所有其他 `display` 声明"，
> 而不是为了偷懒压优先级。

**这个 bug 还有第二个受害者**：`label.field{display:block}` 同样顶掉了
`#row-email` 的 `hidden` —— 所以"登录"模式下邮箱输入框也藏不住。
一条全局规则把两个一起修好了。

---

#### 更值钱的一条（通用）

> **"代码执行了"和"效果出现了"是两件事，中间隔着【层叠 / 优先级 / 来源】。
> JS 验证没错的时候，别继续改 JS。**

同类现象（`hidden` 只是其中一个）：

| 现象 | 同样要先怀疑 CSS |
|---|---|
| `el.disabled = true`，但按钮看着还能点 | 有样式覆盖了 `:disabled` |
| `classList.add('active')` 没反应 | `.active` 规则被更靠后的规则压掉 |
| 内联 `el.style.width = ...` 无效 | 被带 `!important` 的 CSS 顶掉 |

---

### 五、要点 / 坑

- `app.mount("/static", StaticFiles(directory=..., html=True))` 就能让 FastAPI 当文件服务器；
  `html=True` 让 `/static/` 自动返回 `index.html`。
- 目录用 `Path(__file__).parent` 拼，**别用相对路径** —— 相对路径认的是"启动时所在目录"，换地方就崩。
- **同源 = 不用配 CORS**：页面和接口同协议、同域名、同端口就行。把前端塞进后端一起发，是最省事的破跨域手段。
- 登录接口收**表单**（`OAuth2PasswordRequestForm`），发 JSON 会被判 **422**；同一项目里注册收 JSON、登录收表单很正常。
- **204 表示"成功但无响应体"**，直接 `res.json()` 会抛错 —— 先判断状态码再解析。
- **422 的 `detail` 是数组**（元素形如 `{loc, msg, type}`），401/403 等主动抛的 `HTTPException` 才是字符串。两种都要认。
- 401 统一在请求封装里清会话 + 刷新顶栏，**别在调用点各写一遍**。
- token 放 `localStorage` 最直观，代价是**任何能在这台机器上跑 JS 的代码都读得到**；
  更稳妥的是 httpOnly Cookie（但后端要改成发 Cookie，还得处理 CSRF）。
- **前端把按钮藏起来从不等于安全**：`isMine` 只用来决定"显不显示编辑/删除按钮"，
  真正的权限仍由后端把关（不是自己的文章，`PATCH`/`DELETE` 会回 403）。
- 渲染用户内容**必须转义**（`esc()`）：标题/正文是用户写的，直接 `innerHTML` 会让
  `<img onerror=...>` 这种标题在访客浏览器里执行脚本。**防 XSS 是前端渲染时的责任**，后端只管发 JSON。
- 详情页故意"读 → 写 → 再读"一次，是为了让**服务端真实的计数**直接可见 ——
  刷新页面数字还涨不涨一眼就能看出来（正好为"防刷"做准备）。

---

## B.17 浏览量防刷：Redis 去重窗口（阶段14）

**为什么**：阶段12 把计数从 GET 搬到 POST，解决了"预加载 / 爬虫 / 重试随手发 GET"造成的灌水。
但 POST 谁都能打 —— **自己狂按 F5，数字就涨**。所以还差一道闸门：
"同一个人 + 同一篇文章 + 一段时间内，只算一次"。

**一句话概念**：每一次浏览都去问一句"这个 IP 最近 60 秒看过这篇吗"，
判断和记录由 Redis 的**一条原子命令** `SET key 1 NX EX 60` 一次完成。

**当前进度**：✅ 已结课。**接口形状一点没变**（还是 `POST /posts/{id}/views` + 204），
前端一行都没改 —— 只在计数之前多问了一句。

| 文件 | 变化 |
|---|---|
| `app/core/cache.py` | **新增**：Redis 客户端 + `is_first_seen()` |
| `app/routers/posts.py` | `record_view()` 开头加闸门；新增 `client_ip()` |
| `app/core/config.py` | 新增 `REDIS_URL` / `VIEW_DEDUP_SECONDS` |
| `requirements.txt` | 新增 `redis>=5.0` |

---

### 一、为什么用 Redis，而不是 MySQL

防刷需要的是**一处"带过期时间的临时记录"** —— 它天生有三个特点：访问频繁、只关心最近几十秒、**丢了也无所谓**。

| 方案 | 代价 |
|---|---|
| MySQL | 每次浏览**写一张表**，还得自己写定时任务清理过期行 —— 为了一点统计数据加一张表和一套清理逻辑，太重 |
| Redis | 数据在内存里、读写极快、**自带过期时间（TTL）**，到期自动删除，不用管 |

**和 `database.py` 的分工**（这条比语法值钱）：

| 模块 | 管什么 | 特点 |
|---|---|---|
| `database.py` | **要长期保存的数据**（用户、文章） | 丢了是事故 |
| `cache.py` | **随时可以丢的临时数据**（防刷窗口） | 丢了最多多统计几次 |

两套独立连接，谁挂了都不影响对方。

---

### 二、核心：一条命令里塞了三个语义

`app/core/cache.py` 的实现只有一行，但**必须拆开看**：

```
SET  key  "1"  NX  EX  60
             │   │   └── EX 60：60 秒后自动删除，不用自己写清理任务
             │   └────── NX = Not eXists：只在 key 【不存在】时才写入
             └────────── 写成功 = 原本不存在 = 这是第一次 → 该计数
                         写失败 = 原本已存在 = 重复访问   → 不计数
```

```python
def is_first_seen(key: str, window: int) -> bool:
    if window <= 0:
        return True   # 配置成 0 就当作关闭防刷（方便对照测试）
    try:
        return bool(redis_client.set(key, "1", nx=True, ex=window))
    except redis.RedisError as exc:
        logger.warning("Redis 不可用，防刷降级为放行：%s", exc)
        return True
```

#### 为什么不能写成"先 GET 判断，再 SET 记录"

```python
# ❌ 错的写法
if redis_client.get(key) is None:       # ① 读
    redis_client.set(key, "1", ex=60)   # ② 写
```

①② 之间有一个**窗口期**：两个请求同时进来，可能**都**读到 `None`，
于是都认为"我是第一次"，各自计数一次 —— **防刷失效**。

> **这和阶段12 那个 `post.views += 1` 是同一类错误**：
> 把"判断"和"写入"拆成两步，中间的缝隙就会被并发钻进去。
> 解法也一样：**把两步合并成一条原子命令，交给数据库/Redis 自己执行。**
> —— 12 章练的是 SQL 里的 `UPDATE ... SET views = views + 1`，14 章练的是 Redis 里的 `SET NX`，
> **同一个思想，换了把工具。**

#### 返回值是个坑

`SET ... NX` 成功时返回 `True`，被 NX 挡下时返回 **`None` —— 不是 `False`**。
所以用 `bool(...)` 包一层：`None → False`，`True → True`，顺带统一成 bool 类型。

---

### 三、key 的设计：`views:{post_id}:{ip}`

```python
key = f"views:{post.id}:{client_ip(request)}"
```

**把文章 id 和访客身份一起放进 key**，于是只有"同一篇文章 + 同一个人"才会互相去重；
换一篇文章就是另一个 key，各算各的。

| 想怎么算 | key 怎么写 |
|---|---|
| 每篇文章 × 每个 IP（本项目） | `views:{post_id}:{ip}` |
| 全站 × 每个 IP（同一人看 10 篇只算 1 次） | `views:{ip}` |
| 登录用户维度（比 IP 准） | `views:{post_id}:{user_id}` |

> 浏览是**公开行为**，没登录也得计数，所以这里用 IP 而不是 user_id。

---

### 四、访客身份从哪拿：`request.client.host`，不是 `X-Forwarded-For`

```python
def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"
```

| 来源 | 能不能信 |
|---|---|
| `request.client.host` | ASGI 服务器告诉我们的**对端地址**（TCP 连接层面的信息，不是 HTTP 头）→ **客户端伪造不了** |
| `X-Forwarded-For` | 就是一个**普通 HTTP 头，客户端能随手编** |

> 别急着改成读 `X-Forwarded-For`。只有前面确实站着**可信的**反向代理（Nginx）时才该读，
> 而且必须由 Nginx 负责**覆盖**这个头。否则任何人加一行 `X-Forwarded-For: 1.2.3.4` 就能刷爆计数。

`if request.client else "unknown"` 是防一手：某些测试客户端 / 特殊 ASGI 场景下 `client` 是 `None`。
这种"网络身份拿不到"的边界，给个占位值也别让接口崩。

（顺带：`Request` 参数**没有默认值**，签名里得排在那些有 `Depends()` 默认值的参数**前面**。）

---

### 五、为什么重复访问也返回 204，而不是 429

```python
if not is_first_seen(key, settings.VIEW_DEDUP_SECONDS):
    return          # ← 提前 return：窗口内重复浏览，连数据库都不碰

bump_views(db, post)
```

**防刷是服务端自己的统计策略，客户端并没有做错什么** —— 它只是"打开了篇文章"。

回 `429 Too Many Requests` 会让前端把它当错误处理（我们的 `api()` 封装会走 catch 分支弹红字）。
**为了一个用户根本感知不到的统计动作去干扰用户，得不偿失。**

> 204 在这里仍然是"收到了，办妥了"—— 只是这次的结论是"不计数"。

「提前 return」本身也是个好习惯：**能不进数据库就不进**。

---

### 六、降级：Redis 挂了怎么办（fail-open）

这是本项目**第一个"挂了也不能让接口崩"的外部依赖**。

| 策略 | 行为 | 适用 |
|---|---|---|
| **fail-open（放行）** | Redis 出问题当作"是第一次"，照常计数 | **本项目**：浏览量是非核心指标，多统计几次没人受伤；但要是因为它让"打开文章"直接 500，那才是真事故 |
| fail-closed（拦截） | Redis 出问题就拒绝服务 | 如果这个消息用来做**支付去重**，必须拦 |

> **选放行还是拦截，取决于"哪种错更严重"，而不是哪种写法顺手。**

两个细节：

- `except redis.RedisError`（redis-py 所有异常的基类）—— **不抓那个能吞下一切的 `Exception`**，只兜住"我知道怎么处理"的异常。
- 日志用 `%s` 占位而不是 f-string：**日志级别没开时，字符串根本不会被拼出来**。

**还有一个白送的好处**：`redis.Redis.from_url()` 是**懒连接** —— 构造时并不真的去连 Redis，
要等到第一次执行命令才建连接。所以 **Redis 没启动，应用照样能起来**，只是防刷走进降级分支。

---

### 七、实测验证：四步对照 ⭐

**准备**：`docker run -d --name redis -p 6379:6379 redis:7-alpine`

```bash
# 后端起在 8000，拿一篇文章（假设 id=3，当前 views=0）做实验
curl -s -X POST http://127.0.0.1:8000/posts/3/views -o NUL -w "%{http_code}\n"
curl -s http://127.0.0.1:8000/posts/3          # 看 views

docker exec redis redis-cli --scan --pattern "views:*"   # 看留下的 key
docker exec redis redis-cli ttl views:3:127.0.0.1        # 看剩余 TTL
```

| # | 实验 | 预期 | 实测结果 |
|---|---|---|---|
| ① | 第一次 POST | 计数 | `204`，`views: 0 → 1` ✅ |
| ② | **立刻**再 POST | 不计数 | `204`（**不是** 429），`views` **仍为 1** ✅ |
| ③ | 删掉 key（等价于窗口过期）后再 POST | 又能计数 | `204`，`views → 2` ✅ |
| ④ | `docker stop redis` 后再 POST | 降级放行、接口不崩 | `204`，`views → 3`，日志出现 warning ✅ |

实验 ② 后 Redis 里能看到 `views:3:127.0.0.1`，`ttl` 返回 `59`（窗口 60 秒在倒计时）。

**回到前端**（B.16 详情页那个"读 → 写 → 再读"）：

> 点进文章 → ①②③ 三个请求照发不变，但**连按 F5 数字不动了** ——
> 这就是当初故意保留"再读一次"的回报：**防刷效果肉眼可验，一行前端代码都没改。**

---

### 八、要点 / 坑

- **判断 + 记录必须合成一条原子命令**（`SET NX EX`）。拆成 `GET` + `SET`，中间的缝隙会被并发钻 —— 和阶段12 的 `views += 1` 是同一种错误。
- `SET ... NX` 被挡下返回 **`None` 不是 `False`**，记得 `bool()` 包一层。
- **key 里带谁，就按谁去重**：`views:{post_id}:{ip}` 是"每篇 × 每人"，换个 key 就等于换了一种统计口径。
- 访客身份用 `request.client.host`（TCP 层，伪造不了），**别随手读 `X-Forwarded-For`**（客户端能编，除非前置可信 Nginx 且由它覆盖）。
- 重复访问返回 **204 而不是 429**：统计策略不该干扰用户。
- 外部依赖要**主动设计降级**：非核心指标 fail-open，涉及钱/权限的 fail-closed。
- `except` 只抓具体异常（`redis.RedisError`），别用 `Exception` 一把梭。
- **Redis 的 key 自带 TTL**，不需要写清理任务 —— 这正是它适合做"窗口"类需求的原因。
- `VIEW_DEDUP_SECONDS = 0` 可以**一键关掉防刷**，方便做对照测试。
- `.env` 里记得补 `REDIS_URL` / `VIEW_DEDUP_SECONDS`（不写也能跑，走 `config.py` 的默认值，但换机器就会踩空）。
- 加了防刷后，接口的**形状和状态码都没变** —— 这是"好设计"的一个信号：**内部策略升级，对外契约不动**。

---

## B.18 评论功能：第二张表 + 两种外键删除行为（阶段15）

**为什么**：前 14 个阶段只有 `posts` / `users` 两张表、一组关系（用户 1—N 文章）。
评论是第三个模型，也是本项目**第一次在一条外键上处理"删除连带"** ——
而这恰恰是外键最容易出事的地方：**没设计好，删文章会直接 500。**

**一句话概念**：一条评论 = "某个用户" 在 "某篇文章" 下写的一段话。
所以它有**两个外键**；而这两个外键**删起来的行为还不一样** —— 这就是本阶段的核心。

**当前进度**：✅ 已结课。

| 文件 | 变化 |
|---|---|
| `app/models/comment.py` | **新增**：Comment 模型（两个外键 + 两种删除行为） |
| `app/models/post.py` | 加 `comments` 反向关系 + `cascade` / `passive_deletes` |
| `app/models/user.py` | 加 `comments` 反向关系 |
| `app/schemas/comment.py` | **新增**：Create / Update / Read / Page 四件套 |
| `app/routers/comments.py` | **新增**：列表 / 新建 / 改 / 删 + 两级权限依赖 |
| `app/main.py` | 挂载 comments router |
| `app/static/index.html` | 详情页下方加评论区（列表 / 发表 / 删除） |
| `migrations/versions/4dc989b66ae2_add_comments_table.py` | **新增**：建表迁移 |

接口一览：

| 方法 | 路径 | 要登录吗 | 谁可以操作 |
|---|---|---|---|
| GET | `/posts/{post_id}/comments` | 否 | 任何人（公开数据） |
| POST | `/posts/{post_id}/comments` | **是** | 任何登录用户 |
| PATCH | `/comments/{comment_id}` | **是** | **只有作者** |
| DELETE | `/comments/{comment_id}` | **是** | **只有作者** |

---

### 一、新表设计：大部分照抄，三处不一样

`comments` 表整张照抄 `posts` 的套路（`id` + 内容 + 时间戳），只有三处不同，但都关键：

```python
class Comment(Base):
    __tablename__ = "comments"
    id:      Mapped[int]
    content: Mapped[str] = mapped_column(Text)

    post_id:   Mapped[int]      = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int|None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True)
```

| # | 不同点 | 为什么 |
|---|---|---|
| 1 | **两个外键** | 一条评论同时属于"一篇文章"和"一个人"（一张表挂多个外键很常见） |
| 2 | **`post_id` 是 NOT NULL** | 评论不可能脱离文章存在 —— 它不是可空字段 |
| 3 | **两个外键的删除行为不同** | `post_id` 用 `CASCADE`，`author_id` 用 `SET NULL`（见 §二） |

`content` 用 `Text` 而不是 `String(1000)`：**长度限制交给接口层**（`Field(max_length=1000)`）管，
数据库这边留宽松些 —— 将来想放宽到 2000 字，**不用改表**。

---

### 二、⭐ 外键的另一面：它会"阻止删除"

阶段9 学的外键是"防止引用不存在的行"。
但它还有**另一半**作用，直到本阶段删文章时才会撞上：

> **数据库不允许删掉"正被别的行引用"的那一行。**

如果你什么都不写，`ForeignKey("posts.id")` 的默认行为是 **RESTRICT（拒绝）**。
于是 `DELETE /posts/{id}` 会当场炸：

```
(1451, 'Cannot delete or update a parent row: a foreign key constraint fails')
```

原因：数据库发现"还有评论指着这篇文章"，它**不替你决定**这些评论该怎么办。

所以你必须**显式告诉它**。三种选择，按**业务含义**挑（不是按技术偏好）：

| 选项 | 删文章时评论怎么办 | 什么场景用 |
|---|---|---|
| `CASCADE` | **连带删掉** | 评论脱离文章没有意义 → **本项目选它** |
| `SET NULL` | 把外键置空（记录还留着） | "记录本身有价值，只是不再挂在某篇文章上" |
| `RESTRICT`（默认） | **直接拒绝删除** | "想删？先自己清干净" |

> **同一张表里两种删除行为并存是完全正常的**：`post_id` 用 `CASCADE`，`author_id` 用 `SET NULL` ——
> 各自按自己的业务含义定。
> 顺带一提：`Post.author_id` 当年没写 `ondelete`，所以是 RESTRICT ——
> **删用户的账号会被人家的文章挡住**（而评论不会，评论只是被清空作者字段）。这个差异是"有意为之"还是"当初没想过"，值得你自己回查一遍。

---

### 三、ORM 的 `cascade` 和数据库的 `ondelete` 是两回事

光在模型里写 `ondelete` 还不够，ORM 那边也要打声招呼：

```python
# Post 模型里
comments: Mapped[list["Comment"]] = relationship(
    back_populates="post",
    cascade="all, delete-orphan",   # ORM 层：删文章时，评论也属于"该删的"
    passive_deletes=True,           # 别自己一条条删，交给数据库的 ON DELETE CASCADE
)
```

| 概念 | 属于哪一层 | 作用 |
|---|---|---|
| `ondelete` | **数据库**（写在 DDL 里） | 真执行 `DELETE` 时就生效，哪怕绕过 ORM 也一样 |
| `cascade` | **ORM**（Python 层） | 告诉 SQLAlchemy "这些对象的生命周期是绑在一起的" |

**两张网都要有**：

- **少了 `cascade`** → SQLAlchemy 以为"评论该保留"，于是试图把 `post_id` 置成 `NULL`；
  而 `post_id` 是 NOT NULL → **IntegrityError**。
  （这是最容易踩的一脚：光看代码完全想不到，删一次文章就暴露了。）
- **少了 `ondelete`** → 绕过 ORM 直接删数据，就会留下**孤儿评论**（指向一篇不存在的文章）。

`passive_deletes=True` 是性能考量：不加的话，ORM 会先把该文章下所有评论**查进内存**再逐条 DELETE。
告诉它"交给数据库"，就变成一条 `DELETE FROM comments WHERE post_id=...`。

---

### 四、迁移：autogenerate 会把 `ondelete` 一起写进去

```bash
conda run -n blog-api alembic revision --autogenerate -m "add comments table"
conda run -n blog-api alembic upgrade head
```

生成的 DDL 里能直接看到两个规则（**这是必须核对的一步**）：

```python
sa.ForeignKeyConstraint(['post_id'],   ['posts.id'], ondelete='CASCADE'),
sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='SET NULL'),
```

核对数据库里的真实结果：

```bash
docker exec mysql8 mysql -uroot -p123456 -e "SHOW CREATE TABLE blog.comments\G"
# CONSTRAINT `comments_ibfk_1` FOREIGN KEY (`post_id`)   REFERENCES `posts` (`id`) ON DELETE CASCADE
# CONSTRAINT `comments_ibfk_2` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
```

> ⚠️ **新建模型后第一件事：把 `Comment` 加进 `app/models/__init__.py`。**
> Alembic 的 autogenerate 看的是 `Base.metadata`，没 import 的模型它"看不见" ——
> 不但不会建新表，还可能**以为该把那张表删掉**。

---

### 五、接口设计：一组 router，两组路径前缀

```
/posts/{post_id}/comments    ← 评论【从属于】一篇文章，嵌套路径直接把这层关系写进 URL
/comments/{comment_id}       ← 而"改 / 删某一条评论"时，id 已能唯一定位它，不必再带文章 id
```

因为有两组前缀，所以这个 router **不能设 `prefix`**（一个 `APIRouter` 只能有一个 prefix）：

```python
router = APIRouter(tags=["comments"])   # 不设 prefix，路径手写全
```

> 小加分项：`/posts/{post_id}/comments` 和 posts.py 的 `/posts/{post_id}` **不冲突** ——
> 路径段数不同，FastAPI 能分得很清楚。

#### 契约里"没有"什么，比"有"什么更能说明问题

`CommentCreate` 只有 `content` 一个字段 —— **没有 `post_id`，也没有 `author_id`**：

```python
post_id   来自 URL 路径   （挂在哪篇文章下）
author_id 来自 token      （以谁的名义）
```

这两个值服务端**自己就能确定**，所以绝不能让客户端传。
否则发一个 `{"content":"x","author_id":1}` 就能以别人的名义留言 ——
和 `PostCreate` 不带 `author_id` 是同一条规矩（**越权赋值**）。

---

### 六、复用：这一阶段大部分代码是"改个名字"

阶段15 写了将近 200 行新代码，但**几乎没有新概念** —— 全是把旧套路套到新资源上：

| 旧东西（哪一章） | 这次怎么复用 |
|---|---|
| `get_post_or_404`（阶段6） | 抄成 `get_comment_or_404`，改模型名 + 路径参数名 |
| `get_own_post_or_404`（阶段9） | 抄成 `get_own_comment_or_404`（**两级依赖**：先 404 再 403） |
| 分页"三段式"（阶段6） | 攒条件 → 数总数 → 取当页；**只换了 where 条件和排序方向** |
| `Page` 信封（阶段6） | `CommentPage` 和 `PostPage` 长得一模一样 |
| `selectinload` 防 N+1（阶段10） | `LOAD_AUTHOR = selectinload(Comment.author)` |
| 写完 `reload_*` 再返回（阶段10） | `reload_comment()`，避免序列化时触发隐藏查询 |
| `UserSummary` 嵌套（阶段10） | 评论里嵌作者，**只露 id + username**（评论是公开数据，绝不能撒 email） |

**唯一的顺序差异**：评论列表用**正序**（`Comment.id.asc()`）——
评论像对话记录，"先来的在上面"；而文章列表是"新的在上面"。
**同样是分页，排序方向由业务语义决定，没有默认答案。**

#### 跨 router 借依赖，安不安全？

```python
# comments.py
from app.routers.posts import get_post_or_404
```

**安全** —— 因为方向是**单向**的（`comments → posts`），`posts.py` 不会反过来 import 本模块。

> 判据：**只要"被依赖方不知道依赖方的存在"，跨模块 import 就没事。**
> 真正要躲的是 A import B、B 又 import A 这种**环**（import 时互相等对方先加载完 → 循环导入报错）。

---

### 七、前端：评论区是"另一个接口"，要和文章分开

详情页现在有 4 个请求（阶段13 的 3 个 + 评论 1 个）：

```
① GET  /posts/{id}                 文章正文
② POST /posts/{id}/views           计数
③ GET  /posts/{id}                 再读一次（拿真实浏览量）
④ GET  /posts/{id}/comments        评论列表   ← 本阶段新增
```

**④ 故意放在最后、且不在①的 `try` 里**：

```js
  }catch(err){
    el.innerHTML = '<p class="err">' + esc(err.message) + '</p>';
    return;            // 文章都没加载出来，就别再去拉评论了
  }
  loadComments(id);    // 评论单独加载：它慢 / 它挂了，都不该连累文章显示
```

3 个前端细节：

1. **元素是 `innerHTML` 造出来的，事件得重新绑**（阶段13 踩过同一个坑）：
   ```js
   box.querySelectorAll('[data-del]').forEach(btn => {
     btn.onclick = () => removeComment(Number(btn.dataset.del), postId);
   });
   ```
2. **没登录照样能看评论**，所以不藏输入框，只在旁边给一行"需要登录后才能评论"；
   真点了再把登录框弹出来。
3. **"是不是我的评论"只用来决定画不画删除按钮** ——
   安全永远由后端把关。前端把按钮藏起来，从来不等于安全。

---

### 八、实测验证 ⭐

**准备**：alice / bob 两个账号（bob 已存在则会 400，可忽略）。

**接口层（12 项全过）**

| # | 操作 | 预期 | 实测 |
|---|---|---|---|
| 1 | 未登录 `POST .../comments` | 401 | ✅ |
| 2 | alice 发表评论 | **201**，返回体里带 `author.username` | ✅ |
| 3 | `GET .../comments?limit=50` | 200，`total` 与 `items` 正确 | ✅ |
| 4 | `content: ""` | 422（`min_length=1`） | ✅ |
| 5 | `content` 1001 字 | 422（`max_length=1000`） | ✅ |
| 6 | **bob 改 alice 的评论** | **403** | ✅ |
| 7 | **bob 删 alice 的评论** | **403** | ✅ |
| 8 | alice 改自己的评论 | 200，内容已更新 | ✅ |
| 9 | 往不存在的文章发评论 | 404（复用了 `get_post_or_404`） | ✅ |
| 10 | 删自己的评论 | 204 | ✅ |
| 11 | 已删除的评论再 PATCH | 404 | ✅ |
| 12 | 前端 `_tmp_extract`：JS 语法 + 34 个 `$()` 引用 id + 关键函数 | 无缺失 | ✅ |

**重点：两种删除行为，用 SQL 直接查库验证**

```bash
# A) CASCADE：新建一篇文章 → 发 2 条评论 → 删掉这篇文章 → 查残留
docker exec mysql8 mysql -uroot -p123456 -e "SELECT COUNT(*) FROM blog.comments WHERE post_id=11;"
# 结果：0   ← 评论跟着文章一起没了（如果是 RESTRICT，第 10 步根本删不掉，会回 1451 错误）

# B) SET NULL：bob 发一条评论 → SQL 删掉 bob → 看那条评论
docker exec mysql8 mysql -uroot -p123456 -e "DELETE FROM blog.users WHERE username='bob';"
docker exec mysql8 mysql -uroot -p123456 -e "SELECT id, post_id, author_id FROM blog.comments;"
# 结果：author_id 变成 NULL ← 评论还在，作者字段被清空（前端显示"已注销用户"）
```

**验证 B 时顺手发现一个设计后果**（值得记住）：

> 那条 `author_id = NULL` 的评论，**用接口谁也删不掉** ——
> 因为 `author_id != current_user.id` 对任何登录用户都成立（`None != 5`），
> 后端一律回 403。前端的"删除"按钮也不会画出来。
> **无主数据只能靠后台脚本或 SQL 处理** —— 这是当初选 `SET NULL` 换来的代价，写这条规则时就该想到它。

**数据库清理**：验证完 `comments` 表已清空（测试文章、测试评论、以及那条无主评论都删掉了）。

---

### 九、要点 / 坑

- **外键有两面**：既防止"引用不存在的行"，也**阻止"删除被引用的行"**。不写 `ondelete` 时默认 RESTRICT，删父行会报 **1451**。
- `ondelete` 三选一（`CASCADE` / `SET NULL` / `RESTRICT`）**按业务含义定，不是技术偏好**；同一张表里两种行为并存很正常。
- **ORM 的 `cascade` 和数据库的 `ondelete` 是两层网，都要有**：
  - 少 `cascade` → SQLAlchemy 试图把非空外键置 NULL → **IntegrityError**；
  - 少 `ondelete` → 绕过 ORM 删数据会留下**孤儿行**。
- `passive_deletes=True`：别让 ORM 把子行全查进内存再逐条删，**交给数据库一条语句搞定**。
- **新建模型必须加进 `app/models/__init__.py`**，否则 autogenerate "看不见"它，还可能以为该删表。
- 迁移生成后**一定要核对 `ondelete` 有没有真的写进 DDL**（`SHOW CREATE TABLE` 看一眼）。
- **Create 契约里只留"客户端能决定"的字段**：`post_id` 走路径、`author_id` 走 token，一个都不能让客户端传。
- 跨 router 借依赖（`comments → posts`）是安全的，**判据是"没有环"**。
- `SET NULL` 会产生**无主的行**，而按 `author_id` 判权的接口**谁也改不了它们** —— 选这种删除行为时要想清楚后续怎么处理。
- 分页骨架、404 依赖、`Page` 信封、`selectinload` 这一整套都能直接套到新资源上 —— **本阶段 200 行新代码里几乎没有新概念，这就是前面 14 章的复利**。
- 排序方向（正序 / 倒序）是**业务语义**，不是默认值：评论像对话用正序，文章列表用倒序。

---

## B.19 评论回复：让一张表指向自己（阶段16）

**为什么**：阶段15 的评论是一层平铺的。真实评论区要有"回复"——
一旦有了回复，数据就从"列表"变成了"树"，而**树形数据最经典的建模方式是让表指向自己**。

**一句话概念**：给 `comments` 加一列 `parent_id`，指向 `comments.id` ——
"这条评论回复的是哪条"。于是每条评论要么没爹（顶层），要么有一个爹（回复）。

**当前进度**：✅ 已结课。

| 文件 | 变化 |
|---|---|
| `app/models/comment.py` | 加 `parent_id` 列 + `parent` / `replies` 两个自关联关系（含 `remote_side`） |
| `app/schemas/comment.py` | `CommentCreate` 加 `parent_id`；`CommentRead` 加 `parent_id`；**新增 `CommentTree`** |
| `app/routers/comments.py` | 新增 `resolve_parent_id()`；列表改树形查询；发表接口处理 `parent_id` |
| `app/static/index.html` | 树形渲染 + 内联回复框 + **事件委托** |
| `migrations/versions/642d00976f04_add_parent_id_to_comments.py` | **新增**：加列 + 索引 + 自关联外键 |

接口**一个都没新增** —— 还是那四个，只是 GET 返回的多了 `replies`、POST 多了个可选 `parent_id`：

| 方法 | 路径 | 变化 |
|---|---|---|
| GET | `/posts/{post_id}/comments` | 返回**两层树**（顶层评论 + `replies`） |
| POST | `/posts/{post_id}/comments` | 请求体多了可选 `parent_id`（不传 = 顶层评论） |
| PATCH / DELETE | `/comments/{comment_id}` | 逻辑没变（删除时数据库负责连带清回复） |

---

### 一、自关联：多了一列 + 一个绕不开的参数

```python
# comments 表里
parent_id: Mapped[int | None] = mapped_column(
    ForeignKey("comments.id", ondelete="CASCADE"), index=True, nullable=True
)

# 两个方向的关系
parent:  Mapped[Optional["Comment"]] = relationship(
    back_populates="replies", remote_side="Comment.id"     # ← 自关联的钥匙
)
replies: Mapped[list["Comment"]] = relationship(
    back_populates="parent", cascade="all, delete-orphan", passive_deletes=True
)
```

和普通外键只有两点不同：

| # | 不同点 | 为什么 |
|---|---|---|
| 1 | 外键指向 **`comments.id`（自己这张表）** | 回复和评论的字段完全一样，另开一张 `replies` 表等于把结构复制一遍 |
| 2 | 关系里多一个 **`remote_side`** | 两端在同一张表，SQLAlchemy 分不清谁是"一" —— 见下节 |

`nullable=True` 是必须的：**顶层评论没有父**，这一列不能是 NOT NULL。

---

### 二、⭐ `remote_side`：自关联最难理解的那个参数

平时建关系，SQLAlchemy 靠一句简单规则就能判断方向：

> **外键落在哪张表，那张表就是"多"的一端。**

比如 `posts.author_id → users.id`：外键在 `posts` 上，所以"一篇 post 属于一个 user"、
"一个 user 有很多 post"，不需要你解释。

**可自关联时，两端都在 `comments` 里，这条规则失效了** ——
`parent_id` 和 `id` 明明在同一张表，它不知道该把哪个当"一"。

`remote_side` 就是在回答这个问题：

```python
remote_side="Comment.id"
# 把"一"的那一端钉在 Comment.id 上 —— 也就是"父"。
# 于是 parent_id（外键那一端）自然就是"多"，即"子"。
```

少了它会怎样？

- 轻则 SQLAlchemy 在启动时直接抛 `ArgumentError`（它不知道该 JOIN 谁）；
- 重则方向正好反了 —— `comment.replies` 返回的是"我回复的那条"，
  逻辑全错但代码不报错，**这种才是最贵的 bug**。

> 记法：**"远处的那一端" = 被指向的那一端 = 父。**
> 外键在自己身上（近），被指向的 `id` 在别人手里（远）。

---

### 三、⭐ CASCADE 会【递归】：一条 DELETE 带走整棵子树

`parent_id` 选的是 `ondelete="CASCADE"`。这意味着删除是**连锁**的：

```
删 A  →  连带删 A 的回复 B  →  又连带删 B 的回复 C  →  ……
```

一条 `DELETE FROM comments WHERE id=A` 就能把整个子树清干净 ——
**这不是 ORM 干的，是数据库自己的行为**（InnoDB 会递归处理外键的连锁动作）。

那 `passive_deletes=True` 就是必须的：它让 SQLAlchemy **别插手**，
把这件事整个交给数据库。否则 ORM 会先把子行全查进内存、再逐条 DELETE，
层级越深越慢，还可能出现"我删的时候它也在删"的诡异竞态。

为什么这里选 CASCADE 而不是 SET NULL？

> **一条"回复"脱离了被回复的那条评论，就失去了上下文** —— 它只是一句没头没尾的话。
> 而 `author_id` 选 SET NULL，是因为"谁写的"丢了，内容本身还是完整的。
> **同一个删除动作，字段的业务含义不同，该选的行为就不同。**

---

### 四、为什么只做两层：**规范化（normalize）**

技术上完全可以支持 N 层（`parent_id` 指哪都行）。本项目**故意只做两层**，
而且这个限制不是靠前端自觉，是在**服务端入口**强制规范化的：

```python
# "回复的回复" → 挂到那棵树的【顶层评论】下
return parent.parent_id or parent.id
```

于是库里**永远只有两层**：`parent_id IS NULL`（顶层）和 `parent_id = 某顶层 id`（回复）。

为什么不做 N 层？

| 角度 | N 层的问题 |
|---|---|
| 渲染 | 无限缩进在手机上根本没法看 —— 微博 / 小红书 / YouTube 全都只做两层，这不是偷懒，是共识 |
| 查询 | 要么写 MySQL 递归 CTE，要么把整棵树拉进内存再组装，代价陡增 |
| 分页 | "一棵树跨两页"几乎没法处理；两层的话，回复永远跟着自己的顶层评论走，天然同页 |

**代价说清楚**：规范化之后，"这条回复是在回哪条回复"这个信息丢了
（都挂在顶层下面，看不出谁回谁）。想保留它，得再加一个 `reply_to_id` 字段专门记录"回复目标"，
显示成"回复 @某某"—— 这是本项目没做的部分，留给你自己决定要不要加。

> `parent.parent_id or parent.id` 里用 `or` 是安全的：`id` 从 1 开始，
> `parent.parent_id` 只可能是 `None` 或一个正整数，不存在"0 被当成 falsy"的坑。

---

### 五、规则要写在"入口"：`resolve_parent_id` 干的三件事

```python
def resolve_parent_id(db: Session, parent_id: int | None, post: Post) -> int | None:
    if parent_id is None:
        return None                                   # 顶层评论，直接放过

    parent = db.get(Comment, parent_id)
    if parent is None or parent.post_id != post.id:
        raise HTTPException(400, f"parent comment {parent_id} not found under post {post.id}")

    return parent.parent_id or parent.id              # 规范化
```

1. **父评论必须存在** —— 不存在的 id 写进外键，数据库会甩 `IntegrityError`，
   那是 **500 级别**的错误（还暴露了"你们库里有外键"这种内部细节）。
2. **父评论必须属于同一篇文章** —— 这是最容易漏、后果最隐蔽的一条：
   一旦写进去，就得到一条"**永远看不见的评论**"。
   因为列表接口是 `WHERE post_id = ?` 查的，那条回复既不在 A 文章下（它的 `post_id` 是 B），
   也不在 B 文章的树里（它的 `parent_id` 指向 A 的评论）。
   —— **数据没报错，只是悄悄消失了。** 这种坑必须在入口堵。
3. **规范化**（见上节）。

**为什么非法时回 400 而不是 404？**

> `parent_id` 是**请求体里的字段** —— "你给的参数不合法"是 400（Bad Request）；
> 路径里的 `/posts/99999/comments` 才是 404（请求的资源不存在）。
> 另外两种失败（不存在 / 不在同一文章）**故意合成一条消息**，
> 免得泄露"别篇文章下有没有 id=5 这条评论"。

---

### 六、查询：分页只管顶层 + 链式 `selectinload`

```python
condition = (Comment.post_id == post.id) & Comment.parent_id.is_(None)
```

只查顶层。回复不占分页名额 —— 它们跟着自己的顶层评论一起返回。

⚠️ **`.is_(None)` 不能写成 `== None`**：
`== None` 会被翻译成 SQL 的 `= NULL`，而 **SQL 里 NULL 不等于任何东西**
（连 `NULL = NULL` 都是假），结果就是"一条都查不出来"。
`is ` 对应的才是 SQL 的 `IS NULL`。

预加载也升级成了**链式**：

```python
LOAD_TREE = (
    LOAD_AUTHOR,
    selectinload(Comment.replies).selectinload(Comment.author),
)
```

`selectinload(Comment.replies)` 后面再挂一个 `selectinload` ——
"把这些评论的回复查出来，顺便把**每条回复**的作者也查出来"。

查询次数是**固定的 4 次**（顶层 / 作者 / 回复 / 回复的作者），
和评论条数无关。这再次点出 N+1 的本质区别：

> **N+1 的查询次数跟着数据量长；预加载的次数跟着关系层数长。**

`Page.total` 的语义也随之变了：**它数的是顶层评论条数**（因为分页是对顶层分的），
不是"含回复的总条数"。想显示总数得另算一个 `reply_total` —— 本阶段没做，
但这是个**该在文档里写清楚的语义**，否则前端一定会用错。

---

### 七、契约：`post_id` 不能传，`parent_id` **必须**传

```python
class CommentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=1000)
    parent_id: Optional[int] = Field(None, ge=1)
```

三个"id"三种待遇，判据只有一个 —— **服务端能不能自己确定这个值**：

| 字段 | 服务端知道吗 | 结论 |
|---|---|---|
| `post_id` | 知道（URL 路径里写着） | **不让传** —— 冗余，还可能和路径打架 |
| `author_id` | 知道（token 里写着） | **不让传** —— 否则 `{"author_id": 1}` 就能冒名留言 |
| `parent_id` | **不知道**（这是用户的意图） | **必须让传** —— 不传就没法表达"回复谁" |

`ge=1` 也有意思：`parent_id=0` 这种明显算错的值，**在进数据库之前就被 422 拦掉**，
连查都不用查。**校验放得越早，后面要处理的意外就越少。**

`CommentTree` 则是"列表里装的不是单条、而是一棵小树"的自然产物：

```python
class CommentTree(CommentRead):
    replies: list[CommentRead] = []      # 注意类型是 CommentRead，不是 CommentTree
```

`replies` 里的类型**说明了只有两层** —— 回复不能再有回复。
这一行类型，就是第四节那条"规范化"规则在契约层的体现。

`CommentUpdate` 里**依然没有 `parent_id`**：把一条回复挪到别的评论下，
等于让一棵子树整体搬家（还涉及跨文章校验），产品上几乎不会有这个操作，
真需要就删了重发。**契约里的字段越少，能出错的地方越少。**

---

### 八、前端：树形渲染 + 内联回复框 + 事件委托

**1）渲染递归，但只有两层**

```js
const replies = (c.replies || []).map(r => commentHtml(r, depth + 1)).join('');
```

前端**不需要自己拼树** —— 后端返回的 `items` 已经是两层结构了，
这里只是照着结构画。`depth` 只决定加不加缩进样式，取值只会是 0 或 1。

**2）回复框就地插在目标评论下面**（而不是弹窗）：

```
"我正在回复谁"这个状态，前端必须自己记（replyTo）——
因为后端拿不到、也没法猜。把状态【显示出来】（框就长在被回复的评论下方），
是最省事的一种"状态可见"。
```

**3）改用事件委托，不再逐个绑 `onclick`**：

```js
box.onclick = (ev) => {
  const btn = ev.target.closest('button');
  if (!btn) return;
  if (btn.dataset.del)   removeComment(Number(btn.dataset.del), postId);
  if (btn.dataset.reply) toggleReplyBox(postId, Number(btn.dataset.reply), btn.dataset.user);
  if (btn.dataset.send)  submitReply(postId, Number(btn.dataset.send));
  if (btn.dataset.cancel) closeReplyBox();
};
```

阶段15 用的是 `querySelectorAll(...).forEach(btn => btn.onclick = ...)`。
为什么这次要换？

> 因为**回复框是事后才插进 DOM 的**（用户点"回复"时才 `appendChild`）。
> 逐个绑的方式：每次改动 DOM 都得重新遍历一遍，漏一个就是"点了没反应的按钮"。
> 委托绑在容器上 —— **只要按钮在容器里，无论什么时候插进来都有效**。
> 这就是 `ev.target.closest('button')` 的用处：点到文字上也能找到所属的按钮。

**4）顶层评论和回复共用同一个提交函数**：

```js
body: { content, parent_id: parentId ?? null }
```

前端这边也一样：**不因为"多了个 parent_id"就开第二个函数**。
登录检查、错误提示、刷新列表全是同一套，拆开只会把同一段逻辑抄两遍。

---

### 九、实测验证 ⭐（11 项全过）

| # | 操作 | 预期 | 实测 |
|---|---|---|---|
| 1 | 未登录发表回复 | 401 | ✅ |
| 2 | 顶层评论（不传 `parent_id`） | 201，`parent_id = None` | ✅ |
| 3 | 回复顶层评论 | 201，`parent_id` 指向顶层 | ✅ |
| 4 | **回复"一条回复"** | 201，`parent_id` 被**规范化成顶层 id** | ✅ 传入 `7` → 存成 `6` |
| 5 | 列表结构 | `total=2`（顶层），`items=[5,6]`，顶层 6 的 `replies=[7,8]` | ✅ |
| 6 | `Page.total` 只数顶层 | 等于 `len(items)`，不含回复 | ✅ |
| 7 | 父评论不存在 | **400** | ✅ |
| 8 | `parent_id = 0` | **422**（`ge=1` 在进库前拦下） | ✅ |
| 9 | **跨文章回复** | **400** | ✅ |
| 10 | **删顶层评论** | 它的回复被**递归**带走 | ✅ 文章下 `4 → 1` 条（6/7/8 一起消失） |
| 11 | **删文章** | 评论 + 回复全被带走（两层 CASCADE 接力） | ✅ `3 → 0` |

第 4 条是**规范化**生效的证据：客户端传的是 `7`（一条回复的 id），
存进去的是 `6`（那棵树的顶层）—— 库里永远只有两层。

第 10 条是**数据库递归**生效的证据：只发了一条 `DELETE /comments/6`，
`6`（顶层）+ `7`（回复）+ `8`（回复的回复）三条一起消失，
剩下的 `1` 条是同一篇文章下另一条顶层评论 —— **兄弟节点没被误伤**。

**前端静态检查**：JS 语法通过；34 个 `$()` 引用的 id 全部存在；
10 个关键函数都有定义；**事件委托读的 5 个 `dataset` 键，页面上都有对应 `data-*`**
（这个检查专门用来防"委托里写了 `data-del`、HTML 里却写成 `data-delete`"这类拼错）。

---

### 十、要点 / 坑

- **自关联必须写 `remote_side`** —— 两端同表时，SQLAlchemy 判断不出谁是"一"。少了它轻则 `ArgumentError`，重则方向反转（不报错，但逻辑全错）。
- 记法：**`remote_side` = 被指向的那一端 = 父**（外键在近处，父在远处）。
- 自关联外键 **`nullable=True` 是必须的**：顶层记录没有父。
- **`CASCADE` 是递归的**：删一个节点会带走整棵子树，这是数据库行为，不是 ORM 干的。配 `passive_deletes=True` 让它别插手。
- 选择 `CASCADE` 还是 `SET NULL`，看**业务含义**：回复离开父评论就失去上下文 → CASCADE；作者离开但内容完整 → SET NULL。
- **层级限制要放在服务端**（规范化），不能靠前端自觉 —— 前端可以被绕过。
- **跨父级（跨文章）的引用必须在入口拦住**：数据一旦写进去不报错，只是**悄悄看不见了**，这种 bug 最难查。
- **`.is_(None)`，不是 `== None`**。SQL 里 `NULL = NULL` 是假，写错就是"一条都查不出来"。
- 批量赋值 `**payload.model_dump()` 在**需要改写字段时会失效**：`parent_id` 既是 kwargs 又要显式传，Python 直接报 `TypeError: got multiple values`。字段少就逐字段显式写。
- **分页 + 树形要定义清楚"页数按什么算"**：本项目按**顶层**分页，`total` 也就是顶层数 —— 这个语义不写清楚，前端一定会用错。
- **"变体"不该升级成"新接口"**：发表回复和发表评论是同一种数据的同一种操作，只差一个可选字段 —— 用 `parent_id` 表达就够了。判据是**数据形状变没变**，不是"功能听起来新不新"。
- **前端动态插 DOM 时，用事件委托代替逐个绑**。`ev.target.closest('button')` 让点到文字上也能命中。
- 前端必须自己维护"正在回复谁"（`replyTo`）—— **这个状态后端拿不到**，它属于客户端的意图。

---

## B.20 pytest：给 16 个阶段上一张回归网（阶段17）

**为什么**：前 16 个阶段每改一处，我都得手工 curl 一遍 —— 而且**这些验证不会留下来**。
改 A 碰坏 B，只有等下次手点到 B 才发现。到这一步该做的事只有一件：
把"关键行为"从脑子里、从聊天记录里，**搬进代码**。

**一句话概念**：pytest 让你把"手工验证的步骤"写成函数，
每个函数末尾用 `assert` 写下你期望的结果；然后一条命令跑完全部。

**当前进度**：✅ 已结课。**104 个用例全绿，41.8 秒**。

| 文件 | 干什么 |
|---|---|
| `pytest.ini` | **新增**：告诉 pytest 去哪找测试、怎么显示结果 |
| `tests/conftest.py` | **新增**：公共地基（测试库 / fixture / 数据工厂 / 假 Redis） |
| `tests/test_smoke.py` | **新增**：应用活着 + **地基自检**（11 条） |
| `tests/test_migrations.py` | **新增**：模型和迁移链必须一致（1 条，最值钱） |
| `tests/test_auth.py` | **新增**：注册 / 登录 / token 校验链路（18 条） |
| `tests/test_posts.py` | **新增**：CRUD / 越权 / 分页 / 搜索 / 浏览量（37 条） |
| `tests/test_comments.py` | **新增**：树形 / 规范化 / 跨文章 / 级联删除（28 条） |
| `tests/test_uploads.py` | **新增**：表单 / 上传 / 路径穿越 / 超大文件（9 条） |
| `requirements-dev.txt` | 补上用法说明（`httpx` 是 TestClient 的底层） |

**生产代码一行没改。**这一阶段全部是新文件 —— 这是个好信号：
说明前面的分层（依赖注入 / 契约 / 路由）没白做。

---

### 一、⭐ 测试库隔离：**一句话换掉整个应用的数据源**

整套测试的安全性都建立在"不碰开发库"上。做法出乎意料地短：

```python
# tests/conftest.py
@pytest.fixture
def client(db):
    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db      # ← 就这一行
    with TestClient(app) as test_client:
        yield test_client
    finally:
        app.dependency_overrides.clear()
```

于是所有接口里的 `Depends(get_db)` 再也拿不到"连开发库的会话"，
只会拿到测试递过去的那个。

> **这就是阶段6 学依赖注入时说的"解耦"，好处在这一天兑现了。**
>
> 接口代码一行没改，应用就从开发库搬到了测试库。
> 反过来想：如果当初每个接口里写的是 `SessionLocal()`，
> 今天得去改二十个地方，而且还一定会漏一个。

**测试库地址怎么来？不另写配置，只换库名：**

```python
DEV_URL = make_url(settings.DATABASE_URL)                  # .../blog
TEST_DB_NAME = f"{DEV_URL.database}_test"                  # blog_test
TEST_DB_URL = DEV_URL.set(database=TEST_DB_NAME)
```

主机、端口、账号、密码全都复用 `.env` —— 换环境时改一处，测试库跟着走。

**⚠️ 两个坑，都写在这儿免得再踩：**

**坑 1：`str(URL对象)` 会把密码变成 `***`。**

```python
str(TEST_DB_URL)                                    # ...root:***@127.0.0.1:3306/blog_test ❌
TEST_DB_URL.render_as_string(hide_password=False)   # ...root:123456@... ✅
```

SQLAlchemy 的 `URL.__str__()` 默认**打码密码**（防日志泄露）。
拼连接串、写进配置时必须显式 `render_as_string(hide_password=False)`，
否则会拿到一个"密码是三个星号"的地址，**连不上库却看不出原因**。

**坑 2：测试会 `DROP DATABASE`，所以需要一条安全带。**

```python
if not TEST_DB_NAME.endswith("_test"):
    raise RuntimeError(f"测试库名必须以 _test 结尾（当前 {TEST_DB_NAME!r}），拒绝执行")
```

万一哪天有人把库名配成 `blog`，这一行就是唯一能拦住"删掉开发库"的东西。

> **测试代码同样需要安全阀，而且往往更需要：它跑得比谁都勤。**

---

### 二、fixture = **测试版的依赖注入**

```python
def test_patch_others_post_returns_403(client, make_post, alice, bob, auth):
    #                              ↑ 参数名 = fixture 名，框架负责准备好
    post = make_post(bob)
    resp = client.patch(f"/posts/{post.id}", json={"title": "改"}, headers=auth(alice))
    assert resp.status_code == 403
```

和 `Depends` 是同一个思路：**函数签名里声明要什么，框架按正确顺序塞进来**。
区别只是 FastAPI 用 `Depends(...)` 显式写出来，pytest 靠"参数名和 fixture 名对上"。

**scope 是 fixture 最有分量的一个参数**（本项目用到两级）：

| scope | 执行次数 | 本项目用在哪 |
|---|---|---|
| `function`（默认） | 每个测试一次 | `db` / `client` / 所有数据工厂 —— **必须**，否则上一个测试的数据会漏给下一个 |
| `module` | 每个文件一次 | （没用上） |
| `session` | 整个会话一次 | `test_engine` —— 建库 + 跑迁移要一秒多，几百个测试就是几百秒 |

> 判断标准很简单：**这东西"脏"了会不会影响别的测试？**
> 会 → function 级，用完即弃；不会 → 往大了放，省时间。

---

### 三、conftest.py 干四件事

**1）会话级：重建测试库 + 跑真实迁移**

```python
@pytest.fixture(scope="session")
def test_engine():
    # ① 删库重建（每次都是全新起点，不留上次失败的脏数据）
    admin_engine = create_engine(DEV_URL.set(database=None), poolclass=NullPool)
    with admin_engine.begin() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS `{TEST_DB_NAME}`"))
        conn.execute(text(f"CREATE DATABASE `{TEST_DB_NAME}` ..."))

    # ② 【关键一跳】让 alembic 也连测试库
    settings.DATABASE_URL = TEST_DB_URL_STR      # 因为 env.py 读的是它

    # ③ 跑迁移建表
    command.upgrade(alembic_cfg, "head")
```

**为什么用迁移建表，而不是 `Base.metadata.create_all()`？**

> `create_all()` 只是"把模型翻译成建表语句"，它只能反映**模型当前的样子**，
> 完全看不到迁移写错了什么 —— 比如忘了写 `ondelete="CASCADE"`。
>
> 而线上库是**迁移建出来的**。两者一旦不一致，就是**测试全绿、线上一片红**。

配一条测试专门盯这件事（本阶段最值钱的一条）：

```python
# tests/test_migrations.py
def test_models_match_migrations(test_engine):
    with test_engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        diff = compare_metadata(ctx, Base.metadata)
    assert diff == [], f"模型与迁移不一致，请跑 alembic revision --autogenerate。差异：{diff}"
```

它盯住的是**很容易犯、又很难发现**的一类错：改了模型忘了生成迁移。
本地往往看不出来（开发库早就手工调过），等到部署到新环境才炸。

**2）函数级：每个测试前清空数据**

```python
def _truncate_all(engine) -> None:
    with engine.begin() as conn:
        conn.execute(text("SET FOREIGN_KEY_CHECKS = 0"))       # ← 必须
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(text(f"TRUNCATE TABLE `{table.name}`"))
        conn.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
```

`SET FOREIGN_KEY_CHECKS = 0` 不能省：TRUNCATE 一张"正被外键引用"的表时，
MySQL 会直接拒绝（它怕你把父子关系搞断）—— 典型的"我知道我在干什么，请别拦我"。

**清空数据的三种思路，本项目选了第三种：**

| 做法 | 优点 | 代价 |
|---|---|---|
| 每个测试重建库/表 | 最彻底 | 最慢（所以只在 session 级做一次） |
| 事务包住每个测试再回滚 | 最快 | 要求"应用和测试共用同一个连接"，硬上会踩"commit 提交到哪去了"的坑 |
| **TRUNCATE 清数据** | 够快（空表毫秒级） | —— |

**3）HTTP 客户端：`TestClient`**

不用起 uvicorn，请求直接进应用 —— 但**走的是同一条 ASGI 路**：
中间件、依赖、响应模型、状态码，全都和真实请求一样。

**4）⚠️ 关键细节：`client` 和测试必须共用同一个 session**

```python
@pytest.fixture
def client(db):              # ← 把 db 拿进来，而不是自己再建一个
    def override_get_db():
        yield db             # 两个地方用同一个 session
```

为什么？测试里经常"用接口写数据、再直接查库验证"。
如果 `client` 和测试各用一个 session，MySQL 默认的隔离级别是 **REPEATABLE READ**，
测试那个 session 会停在旧快照上，**读不到接口刚提交的数据** ——
于是断言莫名其妙地失败，而且只在某些执行顺序下失败（最难查的那类）。

---

### 四、数据工厂：让测试只写"这次和默认不同的那部分"

```python
alice = make_user("alice")                        # 一句一个用户
post  = make_post(alice, published=False)         # 只强调"这是草稿"
```

好处不只是少打字：**看测试时，注意力会自然落在那个不同的字段上**。
（每条测试的"意图"，往往就藏在那个和默认值不一样的参数里。）

```python
@pytest.fixture
def make_user(db):
    def _make(username: str = "alice", *, password: str = PASSWORD, **overrides) -> User:
        user = User(
            username=username,
            email=f"{username}@example.com",      # 邮箱也有唯一约束，派生最省事
            hashed_password=hash_password(password),
            **overrides,                          # ← 想造"停用用户"就 is_active=False
        )
        db.add(user); db.commit(); db.refresh(user)
        return user
    return _make
```

**认证 fixture 会缓存 token**，同一个用户只真登录一次：

```python
client.patch(url, json=..., headers=auth(alice))     # 传对象或用户名都行
```

> 注意 `auth` 内部的 `assert resp.status_code == 200` ——
> 它断言的不是被测代码，而是**"测试自己搭的台子有没有塌"**。
> 一旦失败说明工厂或登录流程坏了，后面所有测试都会误报，早报早好。

---

### 五、⭐ 该不该 mock：**数据库要真的，Redis 要假的**

这是本阶段最值得记住的一个判断。判据不是"内部还是外部"，而是：

> **这条依赖的行为，是不是被测对象本身？**

| 依赖 | 换假的吗 | 为什么 |
|---|---|---|
| **MySQL** | ❌ **必须用真的** | 外键、`ON DELETE CASCADE` 的**递归**、`SET NULL` —— 这些**正是要测的东西**。换成 SQLite/mock 就等于什么都没测 |
| **Redis** | ✅ 换成内存版 | 它只是**旁路**（"这次算不算数"），而且自带 TTL —— **同一个测试隔 60 秒跑两次结果会不一样**。测试必须可重复，所以这一层恰恰要隔离 |

假 Redis 还带来一个额外好处：**能直接断言"key 写进去了吗、写的是什么"**，
比连真 Redis 再查一遍方便得多。

```python
class FakeRedis:
    def set(self, key, value, nx=False, ex=None):
        # 只模仿 SET ... NX 的返回值约定：写成功 → True；被挡下 → None（不是 False）
        if nx and key in self.data:
            return None
        self.data[key] = value
        return True
```

**再用一个 `BrokenRedis` 把"降级分支"也变成测试**：
"Redis 挂了会怎样"不再是嘴上说说，而是两条断言。

**⭐ 同一套代码里两种相反的失败策略，全都被测试钉住了：**

| 场景 | 策略 | 测试 |
|---|---|---|
| `GET /health/redis` | **fail-closed → 503**（健康检查说谎会让监控失灵，必须如实报） | `test_health_redis_returns_503_when_down` |
| `POST /posts/{id}/views` | **fail-open → 照常 +1**（用户根本感知不到，不能因此让写接口报错） | `test_view_fails_open_when_redis_is_down` |

> 不写进测试的话，下一个人重构时一定会"顺手统一"成其中一种。

---

### 六、⭐ 那个差点翻车的坑：`from X import Y` 到底绑定了什么

写 `broken_redis` 时我先只 patch 了一处，结果**测试红了**：
期望 503、实际 200 —— mock 压根没生效。原因值得单独记一节：

```python
# app/core/cache.py
redis_client = redis.Redis.from_url(...)          # ① 定义在这里

# app/routers/health.py
from app.core.cache import redis_client           # ② 又把名字绑了一次
```

**Python 的 import 不是"起个别名"，而是在当前模块里新建一个名字，指向同一个对象。**

所以改掉 `cache.redis_client` 之后，`health.py` 里的那个 `redis_client`
**依然指着老连接** —— 它早就绑好了，不会跟着变。

```python
def _patch_redis(monkeypatch, replacement) -> None:
    monkeypatch.setattr(cache, "redis_client", replacement)          # 影响 is_first_seen()
    monkeypatch.setattr(health_module, "redis_client", replacement)  # 影响 /health/redis
```

> **这就是很多人写 mock 时"明明 patch 了却不生效"的根源：**
> 要改的不是"那个对象"，而是"**那个模块里的那个名字**"。
> 所以 `monkeypatch.setattr` 的目标必须精确到"哪个模块"。

**为什么 `posts.py` 不用额外处理？**

```python
from app.core.cache import is_first_seen    # 拿到的是【函数】，不是连接对象
```

函数**运行时**才回 `cache` 模块里找 `redis_client` ——
所以只 patch `cache` 那一处，对它就是生效的。

> 一句话：**拿的是"值"（连接对象）就各自绑死，拿的是"函数"就共享同一个查找路径。**
> 这个差别在写可测试代码时很关键 —— 这也是为什么依赖注入比"模块级全局变量"更好测。

---

### 七、地基自检：测试"测试台子"本身的那几条

这一类测试看着多余，但性价比极高 —— **它们失效时，整个套件的结论都会变成"看着全绿、其实什么都没测"**。

```python
def test_uses_isolated_test_database(db):
    """应用此刻连的必须是 blog_test，不能是开发库 blog。"""
    actual = db.execute(text("SELECT DATABASE()")).scalar()
    assert actual.endswith("_test")
```

| 自检 | 防的是什么 |
|---|---|
| `test_uses_isolated_test_database` | conftest 被改错 → 测试开始祸害开发库 |
| `test_redis_is_faked` | Redis 没换成假的 → 测试结果不再可重复 |
| `test_global_settings_point_at_test_db` | alembic 会打到开发库上 |
| `test_models_match_migrations` | 改了模型忘了生成迁移 |

---

### 八、104 个用例分别在守什么

**`test_smoke.py`（11）** 应用活着 + 地基自检。
`-x` 时先跑它，几秒就知道"至少不是一碰就崩"。

**`test_auth.py`（18）** —— 最值钱的是这几条"**不会让功能出问题**"的：

```python
def test_login_does_not_reveal_whether_user_exists(client, alice):
    """⭐ "密码错"和"用户不存在"必须返回完全一样的响应。"""
    wrong_password = client.post(TOKEN, data={"username": "alice", "password": "x" * 12})
    unknown_user   = client.post(TOKEN, data={"username": "nobody", "password": "x" * 12})

    assert wrong_password.status_code == unknown_user.status_code == 401
    assert wrong_password.json() == unknown_user.json()
```

> 分开报错更"友好"，但攻击者能靠差异**一个一个试出哪些用户名真实存在**（用户名枚举），
> 随后针对性撞库。这种错页面照常能用，**只有测试能替你记住**。

还有 token 校验链路的**每一层失败**各一条：没带 / 格式错 / 签名伪造 / 过期 / 用户已删 / 用户已停用。

**`test_posts.py`（37）** —— 三条最有代表性的：

```python
def test_create_post_ignores_client_supplied_author_id(...):
    """越权赋值防线：契约里没这个字段，Pydantic 直接丢掉。"""

def test_patch_only_changes_provided_fields(...):
    """PATCH 语义：没传的字段保持原值（钉住 exclude_unset=True 那个写法）。"""

def test_detail_never_changes_views(...):
    """GET 必须纯读 —— 锁住阶段12 那次返工，别让人把计数写回 GET 里。"""
```

**`test_comments.py`（28）** —— 盯的全是"**出错了也不会报错**"的静默腐败：

```python
def test_reply_across_posts_returns_400(...):
    """⭐⭐ 跨文章回复必须在入口拦住。

    不拦的话会写进一条 post_id 属 B、parent_id 指向 A 的数据 ——
    不违反任何约束，数据库欣然接受，然后它在任何一篇文章下都看不见。
    数据没报错，只是悄悄消失了。
    """

def test_reply_to_a_reply_is_normalized_to_top(...):
    """规范化：传 reply.id，存进去的必须是 top.id。"""

def test_deleting_top_comment_takes_its_replies(...):
    """⭐ 删顶层评论，回复被【数据库递归】带走 —— 接口里没有一行删回复的代码。"""
```

还有一对**对照测试**，把两种删除行为的差别讲得清清楚楚：

| 测试 | 行为 | 结果 |
|---|---|---|
| `test_deleting_post_cascades_to_comments_and_replies` | `post_id` → CASCADE | 文章没了 → 评论**消失** |
| `test_comment_survives_author_deletion` | `author_id` → SET NULL | 作者没了 → 评论**留着**，作者变 None |

**`test_uploads.py`（9）** —— 唯一会真的写磁盘的一组，多一个 `clean_uploads` fixture：

```python
@pytest.fixture
def clean_uploads():
    before = set(UPLOAD_DIR.glob("*"))
    yield
    for path in set(UPLOAD_DIR.glob("*")) - before:
        path.unlink(missing_ok=True)
```

> **不能图省事清空整个 `uploads/`** —— 那里面可能有你手工传过的图片。
> 测试可以弄乱测试自己的环境，但不能删用户的数据（和"测试库 vs 开发库"是同一条纪律）。

---

### 九、怎么跑

```bash
pytest                        # 全部（104 条，约 42 秒）
pytest -k comment             # 只跑名字里带 comment 的
pytest tests/test_auth.py     # 只跑一个文件
pytest -x                     # 第一个失败就停
pytest --collect-only         # 只看有哪些测试，不真跑
```

`pytest.ini` 里把常用参数固化成了默认值：

```ini
[pytest]
testpaths = tests
pythonpath = .                # 让 conftest 里的 `import app` 找得到
addopts = -v --tb=short       # 每个测试一行 + 短回溯
```

**耗时主要在 bcrypt**（每个 `make_user` 要哈希一次密码，100 多个测试就是 100 多次）。
这是"慢一点但真实"的取舍 —— 真要提速，可以整体换成一个更便宜的哈希方案，
但没必要：42 秒的反馈循环已经够用了。

**参数化（parametrize）能让报告直接说话：**

```python
@pytest.mark.parametrize("body", [
    pytest.param(register_body(username="ab"),      id="用户名只有2个字"),
    pytest.param(register_body(password="12345"),   id="密码只有5位"),
    pytest.param(register_body(email="not-an-email"), id="邮箱格式不对"),
])
def test_register_rejects_bad_input(client, body):
    assert client.post(REGISTER, json=body).status_code == 422
```

四个用例共用一段逻辑，失败时报告里直接写着是哪一个（看 `id=`）。

---

### 十、实测验证 ⭐（104 项全过）

```
====================== 104 passed, 3 warnings in 41.80s =======================
```

**并且确认了两个库互不干扰**（这是整套测试的前提，值得手工看一眼）：

| 库 | posts | comments | users |
|---|---|---|---|
| **blog**（开发库） | 6 | 5 | 3 |
| **blog_test**（测试库） | 0 | 0 | 0 |

跑完 104 条测试后，开发库的数据**一条没动**。

---

### 十一、要点 / 坑

- **`app.dependency_overrides[get_db] = ...`** 一句话换数据源 —— 依赖注入的回报，生产代码一行不用改。
- 测试库地址**从 `.env` 派生**（只换库名），别另写一份配置，否则一定会漏改。
- **⚠️ `str(URL)` 会把密码渲染成 `***`**，要 `render_as_string(hide_password=False)`。
- **`DROP DATABASE` 前加一条"库名必须 `_test` 结尾"的断言** —— 测试代码更需要安全阀。
- **fixture = 测试版的 `Depends`**；`scope` 的判据：这玩意"脏"了会影响别的测试吗？
- **建表要走真实迁移**（`alembic upgrade`），不要 `create_all()` —— 否则测不出迁移和模型跑偏。
- 配一条 **`compare_metadata`** 测试钉住"改了模型忘了生成迁移"。
- **`TRUNCATE` 前要 `SET FOREIGN_KEY_CHECKS = 0`**，不然被外键引用的表拒绝清空。
- **`client` 和测试必须共用同一个 session** —— 否则踩到 REPEATABLE READ，读到旧快照。
- **数据工厂的价值不只是少打字**：它让"这次和默认不同的那个字段"跳出来，也就是测试的意图。
- **该不该 mock 的判据：这条依赖的行为是不是被测对象本身？** —— MySQL 要真的（外键/级联正是被测物），Redis 要假的（旁路 + 有 TTL，会让结果不可重复）。
- **同一个依赖可以有相反的失败策略**（健康检查 fail-closed / 浏览量 fail-open），两种都要有测试。
- **⚠️ `from X import Y` 绑的是"当前模块里的一个名字"**，改 `X.Y` 不会影响它 —— 这是"patch 了不生效"的根源。`monkeypatch.setattr` 要精确到模块。
- **拿"值"就各自绑死，拿"函数"就共享查找路径**：这也是依赖注入比模块级全局变量更好测的原因。
- 写几条**地基自检**（连的是不是测试库、Redis 换没换）—— 它们失效时整套测试会变成"假绿"。
- **测试只能弄乱自己的环境**：不能清空 `uploads/`、不能碰开发库。
- 参数化用 `id=` 起中文名，失败报告会直接可读。

---

## B.21 待续

**阶段 17（pytest）已结课**，完整内容见 B.20。

**下一步候选方向**（按需挑，不必按顺序）：

| 方向 | 说明 | 顺带复习到 |
|---|---|---|
| 覆盖率（pytest-cov） | `pytest --cov=app --cov-report=term-missing` —— 找出"根本没被测到"的分支 | B.20 |
| CI（GitHub Actions） | 每次 push 自动跑这 104 条 —— 回归网才真正生效 | B.20 |
| 游标分页 | 相比 `offset/limit`，翻到深页不会越来越慢 | 阶段6 的分页依赖 |
| 文件与文章关联 | 给 `posts` 加 `cover_image`，练习"加列 + 外键"（上传接口阶段5 已有） | 阶段11 迁移 + 阶段9 外键 |
| "回复 @" 标记 | 存一个 `reply_to_id`，显示成"回复 @某某"——补上规范化丢掉的那点信息 | B.19 §四 |
| 评论的软删除 | 加 `is_deleted`，删了保留"该评论已删除"占位（不然楼中楼会断） | 阶段11 迁移 |
| 缓存（Redis） | 热门文章列表 / 详情缓存（阶段14 已有 Redis 客户端，可以直接用） | B.17 |
| 定时任务 | APScheduler / Celery | 新 |
| WebSocket | 实时评论 / 通知 | 新 |
| 打包部署 | Docker 打包应用本体 + Nginx 反向代理 | 阶段2 的 Docker 基础 |

---

# 附录 C：从零复现 blog-api 施工图

> **这份附录解决一个问题**：附录 B 是**上课顺序**（B.1 → B.21），
> 但真要自己动手重建时，顺序不是上课顺序，而是**文件依赖顺序** ——
> 谁被谁 `import`，就得先写谁。
>
> 每步给四样东西：**建什么 → 必须写对的那几行 → 怎么验收 → 最容易错在哪**。
> 深度不够时按每一格后面的编号回查附录 B。

---

## C.0 先说方法：怎么复现才算真学会

三条纪律，比技术更重要：

**1）不要"抄代码"，要"抄验收方式"。**
每写完一层，先跑验收命令。**跑不通就别往下走** ——
越往后，一个底层错误会被包装成上层完全看不懂的报错（第 4 步错的东西，第 10 步才炸）。

**2）卡住再看手册，不要边看边写。**
边看边写只是"手指记住了"。正确做法：
闭卷写 → 卡住 → **只查那一个点** → 合上继续。

**3）分 3~4 次写完，一次做 2 个批次。**
一次写完必然是在抄 —— 因为 36 个文件的体量，大脑不可能一次装下。

**验收的两把尺子**：

| 尺子 | 命令 | 特点 |
|---|---|---|
| 手工 | `uvicorn app.main:app --reload` + `/docs` | 快、直观、能看到错误细节 |
| 自动 | `pytest` | 慢 42 秒，但**会明确告诉你哪儿坏了** |

> 复现期以**手工**为主（你要理解每一步），最后用 `pytest` 总检。

---

## C.1 复现前准备

### 目录骨架（先建空文件，再往里填）

```
blog-api-copy/
├── .env                      ← 密钥 / 数据库地址
├── .gitignore                ← 必须包含 .env 和 __pycache__
├── requirements.txt
├── requirements-dev.txt
├── pytest.ini
├── alembic.ini
├── app/
│   ├── __init__.py
│   ├── main.py               ← 组装入口
│   ├── seed.py               ← 造测试数据（最后写）
│   ├── core/     __init__.py  config.py  database.py  security.py  deps.py  cache.py
│   ├── models/   __init__.py  user.py  post.py  comment.py
│   ├── schemas/  __init__.py  user.py  token.py  post.py  comment.py
│   └── routers/  __init__.py  health.py  auth.py  posts.py  comments.py  uploads.py
├── static/
│   └── index.html
├── migrations/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
└── tests/
    ├── conftest.py
    ├── test_smoke.py
    ├── test_migrations.py
    ├── test_auth.py
    ├── test_posts.py
    ├── test_comments.py
    └── test_uploads.py
```

**⚠️ 每个包目录都要有 `__init__.py`。**
漏了 `app/core/__init__.py`，`from app.core.config import settings` 有时会失败，
报错信息还指向别处（看着像路径问题，其实是包结构问题）。

### MySQL（Docker 起库）

```powershell
docker run -d --name mysql8 -p 3306:3306 `
  -e MYSQL_ROOT_PASSWORD=123456 `
  -e MYSQL_DATABASE=blog `
  -e MYSQL_USER=blog -e MYSQL_PASSWORD=blog123456 `
  mysql:8 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

**⚠️ `utf8mb4` 不能省** —— 否则中文和 emoji 会报 `Incorrect string value`。

### `.env`（连接串格式记死）

```ini
DATABASE_URL=mysql+pymysql://blog:blog123456@127.0.0.1:3306/blog?charset=utf8mb4
SECRET_KEY=换成你自己的长随机串别提交到仓库
ACCESS_TOKEN_EXPIRE_MINUTES=30
REDIS_URL=redis://127.0.0.1:6379/0
```

格式背下来：`mysql+pymysql://用户:密码@主机:端口/库名?charset=utf8mb4`

- `mysql` = 方言（告诉 SQLAlchemy 说 MySQL 的话）
- `pymysql` = 驱动（真正发网络包的那个库）—— **两个都要写**
- 驱动装 `PyMySQL` + `cryptography`（MySQL 8 的认证方式需要后者）

### 依赖：两个文件，别混

| 文件 | 装什么 | 谁用 |
|---|---|---|
| `requirements.txt` | fastapi / uvicorn / sqlalchemy / pymysql / cryptography / pydantic-settings / python-jose / passlib[bcrypt] / redis / python-multipart | 跑应用必须 |
| `requirements-dev.txt` | pytest / httpx | 只有测试要 |

**遇到再装，别提前装一堆** （`python-multipart` 是 `Form`/`File` 需要的；
忘了它，`Form` 接口启动就报错）。

### 命令速查（Windows / PowerShell）

```powershell
conda activate studyPy312
python -m pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --reload
alembic revision --autogenerate -m "说明"
alembic upgrade head
pytest -x
```

> **在 conda 环境里装包一律 `python -m pip`**，同一个包不要 conda/pip 混装。

---

## C.2 ⭐ 施工顺序图（9 个批次）

顺序只有一条规则：**被依赖的先写**。

### 批次 1 · 地基（4 个文件）

| 建什么 | 必须写对的那几行 |
|---|---|
| `requirements.txt` + `.env` + `.gitignore` | 连接串格式；`.env` 必须进 `.gitignore` |
| `app/core/config.py` | `class Settings(BaseSettings)`；`model_config = SettingsConfigDict(env_file=".env", extra="ignore")`；末尾 `settings = Settings()` |
| `app/core/database.py` | `create_engine(url, pool_pre_ping=True, pool_recycle=3600)`；`sessionmaker(bind=engine, autoflush=False)`；`class Base(DeclarativeBase)`；`get_db()` 用 `yield` |

**为什么 `config.py` 排第一**：`database.py` 要读 `settings.DATABASE_URL`，
而**其他所有文件**都直接/间接 import 这两个 —— 它们是全项目的地基。

**⭐ `pool_pre_ping=True` 是干什么的**：从池子里拿连接前先发个"你还在吗"。
MySQL 有 `wait_timeout`（默认 8 小时），连接会被服务端悄悄掐断；
不 ping 的话，第一个用这条死连接的请求会报错。

**验收**：

```powershell
python -c "from app.core.database import engine; print(engine)"
# Engine(mysql+pymysql://blog:***@127.0.0.1:3306/blog?charset=utf8mb4)

python -c "from sqlalchemy import text; from app.core.database import engine; print(engine.connect().execute(text('select 1')).scalar())"
# 1        ← 打印出 1 就是真连上库了
```

> 注意第一行的 `***` —— 是 SQLAlchemy 主动打码的，不是配错了（见 C.5 第 3 条）。

### 批次 2 · 模型（3 张表）

| 建什么 | 必须写对的那几行 |
|---|---|
| `app/models/user.py` | `username` / `email` 都 `unique=True, index=True`；**永远没有 `password` 字段，只有 `hashed_password`** |
| `app/models/post.py` | `author_id` 外键 `ondelete="SET NULL"`（**不是 CASCADE**）；`views` 带 `server_default="0"` |
| `app/models/comment.py` | ⭐ 自关联：`parent_id` → `ForeignKey("comments.id", ondelete="CASCADE")`，`parent = relationship("Comment", remote_side="Comment.id", back_populates="replies")` |
| `app/models/__init__.py` | **把三个模型都 import 进来** |

**⭐⭐ 为什么 `models/__init__.py` 必须汇总 import**：
alembic autogenerate 只认"已经加载进 `Base.metadata` 的表"。
少 import 一个模型，生成的迁移就是**空的** —— **而且完全不报错**。
（这是复现期最阴的坑之一。）

**⭐⭐ 三种删除行为，写之前先想清楚业务**：

| 字段 | 规则 | 作者/文章没了以后 |
|---|---|---|
| `comments.post_id` | **CASCADE** | 文章没了 → 评论**消失**（评论离开文章就没意义） |
| `posts.author_id` | **SET NULL** | 作者没了 → 文章**留着**，作者变 None |
| `comments.author_id` | **SET NULL** | 作者没了 → 评论**留着**，显示"已注销用户" |

> 判据：**这个外键指向的东西没了，我这行数据还有没有独立价值？**
> 有 → SET NULL；没有 → CASCADE。

**验收**：

```powershell
python -c "from app.models import Base; print(sorted(Base.metadata.tables))"
# ['comments', 'posts', 'users']      三个都在才算对
```

### 批次 3 · 迁移（Alembic）

| 建什么 | 必须写对的那几行 |
|---|---|
| `alembic.ini` | `sqlalchemy.url` **留空**（由 `env.py` 从 `.env` 注入，避免两处配置打架） |
| `migrations/env.py` | `from app.models import Base` → `target_metadata = Base.metadata`；`config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)` |
| `versions/xxxx_init_tables.py` | autogenerate 生成的；**生成后一定要读一遍** |

```powershell
alembic revision --autogenerate -m "init tables"
alembic upgrade head
```

**⚠️ 生成后必须读一遍那个文件** —— autogenerate 不是万能的：
它认得出"加了列""加了表"，但**外键的 `ondelete` 规则偶尔会漏**。
读的时候专门找 `ondelete=`，没有就手工补上。

**验收**：进 MySQL 亲眼看

```sql
SHOW TABLES;                 -- users / posts / comments / alembic_version
SHOW CREATE TABLE comments;  -- 找 ON DELETE CASCADE / SET NULL
DESC posts;                  -- views 应该有 DEFAULT '0'
```

**⚠️⚠️ 绝对不要用 `Base.metadata.create_all()`**：
它只复刻"模型现在的样子"，**测不出迁移写错了**。
线上库是迁移建出来的 —— 两边不一致就是"测试全绿、线上一片红"。

**⚠️ 之后每次改模型，固定三步**：
`alembic revision --autogenerate` → **读一遍** → `alembic upgrade head`。
忘了这步，本地往往还正常（开发库手工调过），换台机器就炸。

### 批次 4 · 契约（schemas）

**一个资源四五个类，按"入口 / 出口"分开**：

| 文件 | 类 | 作用 |
|---|---|---|
| `schemas/user.py` | `UserCreate` / `UserRead` / **`UserSummary`** | `UserRead` 有 email；`UserSummary` 只有 id+username |
| `schemas/token.py` | `Token` | `access_token` + `token_type` |
| `schemas/post.py` | `PostCreate` / `PostUpdate` / `PostSummary` / `PostRead` / `PostList` | Summary 无 content（列表用）；Read 全（详情用） |
| `schemas/comment.py` | `CommentCreate` / `CommentUpdate` / `CommentRead` | Read 里嵌套 `replies` 和 `author` |
| `schemas/__init__.py` | 汇总导出 | 路由里 `from app.schemas import PostCreate` 更短 |

**⭐⭐ 契约设计的四条铁律**（复现时最容易写错的地方）：

| # | 铁律 | 漏了会怎样 |
|---|---|---|
| 1 | **`Create` 里绝不出现 `author_id` / `id`** | 客户端能"栽赃"文章给别人（越权赋值） |
| 2 | **`Update` 的字段全部可选**（每个字段都给默认值 `= None`） | PATCH 退化成"必须全传"，或把没传的字段清成 None |
| 3 | **`Read` 里绝不出现 `hashed_password`** | **密码哈希泄露** —— 而且接口照常工作，没人会发现 |
| 4 | **列表用 `Summary`（不含长文本）** | 列表页把每篇正文都传过去，流量白烧 |

> 铁律 1 的实现方式值得记住：**不是靠"记得别读那个字段"，
> 而是靠"契约里根本没有这个字段"** —— Pydantic 默认丢弃未知字段，
> 所以数据压根到不了业务代码。**能出错的代码越少越好。**

**验收**：

```powershell
python -c "from app.schemas import PostCreate; print(list(PostCreate.model_json_schema()['properties']))"
# ['title', 'content', 'published']      ← 看不到 author_id 就对了
```

### 批次 5 · 安全与依赖

| 建什么 | 必须写对的那几行 |
|---|---|
| `app/core/security.py` | `hash_password` / `verify_password`（bcrypt）；`create_access_token` 里 `exp` 用 **UTC**；`oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")` |
| `app/core/deps.py` | `get_current_user`（解 token → 查库 → 401）；`get_current_active_user`（停用 → 403）；`Pagination` 类依赖；`get_post_or_404` |
| `app/core/cache.py` | `redis_client`；`is_first_seen(key, ttl)` 用 `SET nx=True`；**异常必须吞掉（fail-open）** |

**⭐ `exp` 一定要用 UTC**：`datetime.now(timezone.utc) + timedelta(...)`。
用本地时间会在换时区/夏天时差一天，表现为"token 莫名过期/永不过期"。

**⭐⭐ 401 与 403 的分工**（整个项目必须一致）：

| 码 | 含义 | 什么时候 |
|---|---|---|
| **401** | "**我不知道你是谁**" | 没带 token / token 格式错 / 签名伪造 / 过期 / 用户已删 |
| **403** | "**我知道你是谁，但这事不归你**" | 账号已停用 / 改别人的文章 |

**⚠️ 登录失败不能区分"用户不存在"和"密码错误"** ——
否则攻击者能靠差异**枚举出哪些用户名真实存在**，再针对性撞库。
（这种漏洞页面完全正常，只有测试能替你记住。）

**⚠️ `cache.py` 的 fail-open**：Redis 连不上时 `is_first_seen` 应该返回 True（放行），
**不能让浏览接口跟着报错** —— 用户根本感知不到少算一次浏览量。
（对比 `/health/redis` 是 fail-closed：健康检查说谎会让监控失灵，必须如实报 503。）

### 批次 6 · 路由（从简到繁）

| 顺序 | 文件 | 关键点 |
|---|---|---|
| 1️⃣ | `routers/health.py` | 最简单，**先写它**，用来验证 app 能启动 |
| 2️⃣ | `app/main.py` | `app = FastAPI(...)` + `include_router` + lifespan |
| 3️⃣ | `routers/auth.py` | `POST /auth/register`、`POST /auth/token`（用 `OAuth2PasswordRequestForm`） |
| 4️⃣ | `routers/posts.py` | 最大；**先读下面的四条警告再动手** |
| 5️⃣ | `routers/comments.py` | 嵌套路由 `/posts/{post_id}/comments` + 回复规范化 |
| 6️⃣ | `routers/uploads.py` | `Form` / `File` |

> **为什么先写 `health.py`**：它是唯一"不依赖数据库模型、不依赖认证"的接口。
> 用它单独验证"app 能起来、路由能挂上"，比一上来就写 auth 要好排查得多。

**⭐⭐ 写 `posts.py` 必须记住的四点**：

| # | 点 | 漏了会怎样 |
|---|---|---|
| 1 | **路由顺序**：`/posts/latest`、`/posts/mine` 必须写在 `/posts/{post_id}` **之前** | `"latest"` 被当 int 解析 → **422**，错误信息完全看不出是顺序问题 |
| 2 | **`model_dump(exclude_unset=True)`** | PATCH 把没传的字段全清成 `None`，**页面照常打开，数据已坏** |
| 3 | **总数要单独查**：`select(func.count()).select_from(Post).where(...)` | `select(Post, func.count())` 不带 `group_by` 在 MySQL 上直接报错 |
| 4 | **列表加 `.options(selectinload(Post.author))`** | **N+1**：列 100 条 = 101 次查询（功能正常，只是慢） |

**⚠️ 浏览量绝不能写在 GET 详情里**：
GET 是"安全方法"，浏览器预加载、爬虫、CDN、客户端超时重试都会**随手发 GET**。
计数必须走 `POST /posts/{id}/views`。

**⭐⭐ 写 `comments.py` 的三句判断**（按顺序）：

```python
# 1. parent 不存在              → 400
# 2. parent.post_id != 当前 post → 400   ← 不拦就会写出"哪都看不见"的脏数据
# 3. parent.parent_id is not None → 换成 parent.parent_id  ← 收敛成两层
```

> 第 2 条的严重性值得单独记：跨文章回复写进库后，
> 它 `post_id` 属 B、`parent_id` 指向 A 下的评论 —— **不违反任何约束，数据库欣然接受**，
> 然后它在**任何一篇文章下都看不见**。数据没报错，只是悄悄消失了。

**⚠️ `uploads.py` 的文件名必须过 `Path(file.filename).name`**
—— 否则客户端传 `../../../evil.png` 就能写到任意目录。
（另：`content_type` 是**客户端自报的**，只能挡手滑，不能当安全依据。）

### 批次 7 · 中间件与前端页

| 建什么 | 关键点 |
|---|---|
| `main.py` 加中间件 | CORS（`add_middleware`）、计时中间件（`@app.middleware("http")`） |
| 静态页 | `app.mount("/static", StaticFiles(directory="static"))` |
| `static/index.html` | 原生 `fetch` 对接，token 存 `localStorage` |

**⚠️ 中间件顺序是栈式的**：后 `add_middleware` 的**先执行**。
所以"日志/计时"这类想看到全部过程的，要**最后 add**。

**⚠️ CORS 的 `allow_origins=["*"]` 不能和 `allow_credentials=True` 同时用**
—— 浏览器会直接拒绝。要么明确列出来源，要么关掉 credentials。

### 批次 8 · 测试

| 顺序 | 文件 | 关键点 |
|---|---|---|
| 1️⃣ | `pytest.ini` | `testpaths = tests`、**`pythonpath = .`**（少了 `import app` 会失败）、`addopts = -v --tb=short` |
| 2️⃣ | `tests/conftest.py` | ⭐ **分三段写**，别一次写完 |
| 3️⃣ | `tests/test_smoke.py` | **先写自检**（连的是不是测试库、Redis 换没换） |
| 4️⃣ | `test_migrations.py` | `compare_metadata` 一条，钉住"改了模型忘了生成迁移" |
| 5️⃣ | 其余四个 | 按资源写 |

**⭐ `conftest.py` 的三段（分三次调通）**：

```
第一段 · 会话级引擎
    test_engine：DROP + CREATE `blog_test`
                 → settings.DATABASE_URL 指向它（让 alembic 也连过去）
                 → alembic upgrade head

第二段 · 每个测试清库
    db：SET FOREIGN_KEY_CHECKS = 0 → TRUNCATE 全部表 → SET ... = 1

第三段 · 工具
    FakeRedis / BrokenRedis
    client：app.dependency_overrides[get_db] = ...（⭐ 和测试**共用同一个 db**）
    数据工厂：make_user / make_post / make_comment
    auth：按用户缓存 token
```

**⭐ 为什么用迁移建表而不是 `create_all()`**：见批次 3 —— 这条在测试里同样成立。
`compare_metadata` 那个自检就是靠它才有意义。

**⭐ `client` 和测试必须共用同一个 session**：
否则踩到 MySQL 的 **REPEATABLE READ** —— 测试读到的是旧快照，
断言莫名其妙失败，而且**只在某些执行顺序下失败**（最难查的那类 bug）。

**验收**：`pytest` → **104 passed**。
（先跑 `pytest -x`，第一个失败就停，从第一个开始修。）

### 批次 9 · 种子数据

`app/seed.py`：造几个用户 + 十几篇文章 + 一些评论，
用来手工点页面时"有东西可看"。

**⚠️ 种子脚本要能重复跑**（先查有没有、再插），否则第二次跑就撞唯一约束。

---

## C.3 ⭐ 总览：一个请求怎么走完全程

把 17 个阶段的知识串在一条线上 —— 这张图能解释"为什么要分这么多层"。

```
浏览器 / curl
    │
    ▼  POST /posts/12/views
┌──────────────────────────────────────────────────┐
│ ① uvicorn (ASGI 服务器)                          │
│ ② 中间件：后 add 的先跑                           │  基础 #10 / #11
│      CORS → 计时中间件 → …                        │
│ ③ 路由匹配            → 没匹配上 → 404            │  基础 #12
│ ④ 路径 / 查询参数校验  → 不合法   → 422            │  基础 #1 #2 #4
│ ⑤ 请求体校验 (Pydantic) → 不合法  → 422            │  基础 #3
│ ⑥ 依赖链（Depends 递归解析）                       │  基础 #8
│      get_db  ── yield ──→ 先给会话，请求结束再关     │  B.3
│      → get_current_active_user（401 / 403）        │  B.11 B.12
│      → Pagination 类依赖（默认值 + 边界）           │  B.9
│ ⑦ ══ 业务函数 ═══════════════════════════════════  │
│      查库 → 查不到 404 / 不是你的 403                │  B.7
│      列表用 selectinload 防 N+1                    │  B.13
│      写库 → commit → db.refresh(obj)               │  B.7
│      备注：GET 里绝不写数据                         │  B.15
│ ⑧ response_model 过滤（= 响应白名单）              │  基础 #6
│ ⑨ 状态码 status_code=201 / 204                    │  B.8
│ ⑩ 中间件加响应头 → 客户端                          │
└──────────────────────────────────────────────────┘
```

**⭐ 这张图的用法**：遇到报错先问"**它是在第几步炸的？**"

| 状态码 | 大概率在第几步 |
|---|---|
| 422 | ④ / ⑤ —— 参数或请求体不合法 |
| 401 / 403 | ⑥ —— 依赖里拦下的 |
| 404 | ③（路由没匹配）**或** ⑦（查库没查到） |
| 405 | ③ —— 路径对但方法不对 |
| 500 | ⑦ —— 业务代码自己炸了 |

**判 404 是哪一种的方法**：看 `detail` 是不是你自己写的文案。
是 → ⑦ 查库没查到；不是（一大段通用信息）→ ③ 路由没匹配。

---

## C.4 ⭐ 同一个概念，在每一层各出现一次

复现时最困惑的往往是"**这东西不是写过了吗？**" ——
其实同一个概念会在**4 个地方各出现一次，各管一件事**。

以"分页"为例：

| 层 | 在哪 | 管什么 |
|---|---|---|
| 契约 | `schemas/post.py` 的 `PostList` | **出口**长什么样（`items` / `total` / `skip` / `limit`） |
| 依赖 | `deps.py` 的 `Pagination` 类 | **入口**默认值与边界（`skip>=0`、`1<=limit<=50`） |
| 路由 | `posts.py` 的 `pagination: Pagination = Depends()` | 可以覆盖默认值 |
| 测试 | `test_posts.py` | 钉住"翻页不重叠""limit=999 被拒" |

同理，"**权限**"也在 4 个地方各守一次：

```
契约   里不写 author_id           ← 越权赋值防线（数据压根进不来）
依赖   里解析 token → user         ← 401（你是谁）
业务   里比对 post.author_id      ← 403（是不是你的）
数据库 外键 ondelete 规则          ← 数据一致性最后一道（万一前面都漏了）
```

同理，"**树形评论**"在三处配合：

```
模型   parent_id 自关联 + remote_side      ← 结构
迁移   ON DELETE CASCADE（自引用）          ← 删父带走子
路由   回复规范化（三层压成两层）            ← 保证库里永远只有两层
```

> **记住这句话**：一个性质要**在多层各守一次**，而不是相信某一层。
> 前端拦一次是为了体验，后端拦一次是为了安全，数据库约束是为了"万一前面都漏了"。

---

## C.5 复现期的坑清单（按你**会先撞上**的顺序）

附录 A 是"报错 → 原因"，这里是"**做到第几步 → 大概率踩什么**"。

| # | 做到哪 | 坑 | 症状 | 正确写法 |
|---|---|---|---|---|
| 1 | 建目录 | 漏了 `__init__.py` | `ModuleNotFoundError`，看着像路径问题 | 每个包目录都建 |
| 2 | config | 改 `.env` 后没重启 | 改了完全没效果 | `--reload` 只盯 `.py`，`.env` 要**手动重启** uvicorn |
| 3 | database | 用 `str(URL)` 拼连接串 | 密码变成 `***`，连不上 | `render_as_string(hide_password=False)` |
| 4 | models | 漏 import 进 `models/__init__.py` | autogenerate 生成**空迁移**，**不报错** | 三个模型全汇总 |
| 5 | models | 外键忘了 `ondelete` | 删文章 → `IntegrityError` | 想清 CASCADE 还是 SET NULL |
| 6 | models | 自关联忘了 `remote_side` | SQLAlchemy 报 "could not determine join condition" | `remote_side="Comment.id"` |
| 7 | 迁移 | 用 `create_all()` 代替迁移 | 本地能跑，换机器炸 | 一律走 alembic |
| 8 | 迁移 | 改了模型忘了生成迁移 | 同上（**本地看不出来**） | 改模型 = 生成 + 读 + upgrade |
| 9 | schemas | `Update` 字段没给默认值 | PATCH 退化成"必须全传" | 每个字段都给 `= None` |
| 10 | schemas | `Read` 忘了去掉 `hashed_password` | **密码哈希泄露** | 出口模型单独定义 |
| 11 | 路由 | `/latest` 写在 `/{id}` 后面 | 422，且报错看不出原因 | 固定路径写前面 |
| 12 | 路由 | PATCH 用了 `model_dump()` | 没传的字段被清成 None | `exclude_unset=True` |
| 13 | 路由 | GET 里写浏览量 +1 | 计数虚高 | 改成 `POST /views` |
| 14 | 路由 | 列表没 `selectinload` | 慢（N+1） | `.options(selectinload(...))` |
| 15 | 路由 | 上传没剥路径 | 能写到任意目录 | `Path(filename).name` |
| 16 | 路由 | 中间件顺序搞反 | 响应头加不上 / 跨域失效 | 后 add 的先执行 |
| 17 | 测试 | 用真 Redis | 隔几分钟跑结果不一样 | 假 Redis（`FakeRedis`） |
| 18 | 测试 | `client` 和测试各用一个 session | 读不到刚提交的数据 | **共用** `db` |
| 19 | 测试 | TRUNCATE 被外键拦 | `Cannot truncate a table referenced in a foreign key constraint` | 先 `SET FOREIGN_KEY_CHECKS=0` |
| 20 | 测试 | `from X import Y` 后只 patch `X.Y` | mock 不生效 | **两个模块都要 patch** |
| 21 | 测试 | 没设 `pythonpath` | `import app` 失败 | `pytest.ini` 里加 `pythonpath = .` |

> **第 3、5、10、12、15、20 条是"不报错但错得最狠"的** ——
> 它们不会让程序崩，只会**安静地做错事**。
> 这类问题靠手工点页面几乎发现不了，只能靠验收（测试）。

---

## C.6 用测试当验收表

**`pytest` 全绿 = 复现完成。** 每条测试其实在回答一个问题，可以当自查清单：

| 你写的部分 | 对应文件 | 条数 |
|---|---|---|
| 地基（库 / Redis / 迁移同步） | `test_smoke.py` + `test_migrations.py` | 12 |
| 注册 / 登录 / token 链路 | `test_auth.py` | 18 |
| 文章 CRUD / 越权 / 分页 / 浏览量 | `test_posts.py` | 37 |
| 评论树 / 规范化 / 级联删除 | `test_comments.py` | 28 |
| 表单 / 上传 | `test_uploads.py` | 9 |
| **合计** | | **104** |

```powershell
pytest -x                     # 第一个失败就停（复现期最常用）
pytest tests/test_posts.py -v # 只验证某一块
pytest -k comment             # 按名字筛
```

> **复现期建议**：不要一开始就写测试。
> 用 `uvicorn + /docs` 手工调通，**最后再写测试** ——
> 测试的意义是"钉住已经对的行为"，而不是"帮你把它调对"。

---

## C.7 复现完成后的自检题

写完对着这份表逐条自问，**答不上来的就是没真会**：

| # | 问题 | 回查 |
|---|---|---|
| 1 | 为什么 `settings` 要独立成一个模块？ | B.1 |
| 2 | `get_db` 里的 `yield` 有什么意义？谁负责关会话？ | B.3 |
| 3 | 为什么用 `def` 而不是 `async def`？什么时候必须 `async`？ | B.4 |
| 4 | `pool_pre_ping` / `pool_recycle` 解决什么问题？ | B.2 / C.2 |
| 5 | 外键的 CASCADE 和 SET NULL 分别用在哪张表？判据是什么？ | B.18 / B.19 |
| 6 | `PostCreate` 里为什么没有 `author_id`？这防住了什么？ | B.8 |
| 7 | 401 和 403 的分界线是什么？ | B.12 |
| 8 | `selectinload` 解决什么问题？不加会怎样？ | B.13 |
| 9 | 为什么浏览量不能写在 GET 里？ | B.15 |
| 10 | 浏览量去重的 key 怎么设计？Redis 挂了会怎样？ | B.17 |
| 11 | 为什么 Redis 要 fail-open，而健康检查要 fail-closed？ | B.17 / B.20 |
| 12 | `response_model` 和直接返回 `dict` 有什么区别？ | B.8 |
| 13 | 迁移和 `create_all()` 的本质区别？ | B.14 |
| 14 | 为什么评论必须收敛成两层？跨文章回复会写出什么数据？ | B.19 |
| 15 | 路由顺序写反会怎样？为什么报错信息看不出来？ | C.2 批次6 |
| 16 | 测试为什么必须用**真** MySQL、**假** Redis？ | B.20 §五 |
| 17 | `from X import Y` 之后 patch `X.Y` 为什么不生效？ | B.20 §六 |
| 18 | 一个安全性质为什么要"在多层各守一次"？ | C.4 |

---

## C.8 复现计划建议（4 次做完）

| 第几次 | 做哪些批次 | 结束时的验收 |
|---|---|---|
| 第 1 次 | 批次 1~3（地基 + 模型 + 迁移） | MySQL 里三张表 + 外键规则正确 |
| 第 2 次 | 批次 4~6（契约 + 安全 + 路由） | `uvicorn` 起来，`/docs` 里注册→登录→发文→评论全通 |
| 第 3 次 | 批次 7 + 9（中间件 + 前端页 + 种子） | 浏览器里点得动 |
| 第 4 次 | 批次 8（测试） | `pytest` → 104 passed |

> 每次结束**都要能跑起来**，别留"半截状态"过夜 ——
> 半截状态放两天，下次打开就不知道错在哪了。

---

**⏸ 暂停点记录（2026-09-12）**

- 项目在**阶段 17（pytest）已结课**处暂停：104 条测试全绿，生产代码未受影响。
- 下一步：用 `blog-api-copy` **独立手工重建**一遍（按本附录 C.2 的 9 个批次）。
- 复现中遇到的新问题，继续按约定追加到本手册（附录 B 或 C）。
- 原始项目 `blog-api` **保持原样不动**，作为复现完成后的对照答案。

