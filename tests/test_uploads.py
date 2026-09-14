"""上传测试：Form（表单）与 File（文件）。

这组是**唯一会真的往磁盘写文件**的测试，所以多了一个"收拾现场"的 fixture。

测试的纪律和"不碰开发库"是同一条：**可以弄乱测试自己的环境，
但不能动用户的东西**。所以这里不能图省事清空整个 uploads/ ——
那里面可能有你手工传过的图片。
"""

from pathlib import Path

import pytest

# 和 uploads.py 里一样，相对"启动目录"（pytest 从 blog-api/ 跑）
UPLOAD_DIR = Path("uploads")

# 一个"够用"的 PNG：有正确的文件头，内容随便。
# 接口只看 content_type，不会真的解码图片，所以这样就够了。
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32

FORM = "/uploads/form"
FILE = "/uploads/file"


@pytest.fixture
def clean_uploads():
    """记下"测试前已经有哪些文件"，结束后删掉这次新增的。

    为什么不直接清空目录？—— 见文件头。测试不能删用户的数据。
    """
    before = set(UPLOAD_DIR.glob("*"))
    yield
    for path in set(UPLOAD_DIR.glob("*")) - before:
        if path.is_file():
            path.unlink(missing_ok=True)


# ══════════════════════════════════════════════════════════════
# 一、表单（Form）
# ══════════════════════════════════════════════════════════════
def test_submit_form(client):
    """注意请求用的是 data= 而不是 json= —— 表单和 JSON 是两种不同的请求体。

    Form 走的 content-type 是 application/x-www-form-urlencoded，
    OAuth2 的登录接口（/auth/token）用的也是这一种。
    """
    resp = client.post(FORM, data={"username": "alice", "password": "secret123"})

    assert resp.status_code == 200
    assert resp.json() == {"username": "alice", "password_length": 9}


def test_submit_form_never_echoes_password(client):
    """密码只回长度，不回原文 —— 回显是常见的低级泄露。"""
    resp = client.post(FORM, data={"username": "alice", "password": "topsecret"})

    assert "topsecret" not in resp.text


def test_submit_form_rejects_short_password(client):
    resp = client.post(FORM, data={"username": "alice", "password": "123"})

    assert resp.status_code == 422


def test_submit_form_rejects_missing_field(client):
    """少传一个必填字段 → 422。

    注意这里要传 ["username"] 这种列表形式：httpx 用它表示"这个字段只出现一次"，
    否则字符串会被当成"同名多值"处理（表单允许一个字段出现多次）。
    """
    resp = client.post(FORM, data={"username": ["alice"]})

    assert resp.status_code == 422


# ══════════════════════════════════════════════════════════════
# 二、上传文件（File）
# ══════════════════════════════════════════════════════════════
def test_upload_image(client, clean_uploads):
    resp = client.post(FILE, files={"file": ("cat.png", PNG_BYTES, "image/png")})

    assert resp.status_code == 201
    data = resp.json()
    assert data["filename"] == "cat.png"
    assert data["content_type"] == "image/png"
    assert data["size"] == len(PNG_BYTES)
    # 光看响应还不够 —— 文件得真的落到盘上
    assert (UPLOAD_DIR / "cat.png").exists()
    assert (UPLOAD_DIR / "cat.png").read_bytes() == PNG_BYTES


def test_upload_rejects_non_image(client, clean_uploads):
    resp = client.post(FILE, files={"file": ("evil.sh", b"rm -rf /", "text/x-sh")})

    assert resp.status_code == 400
    # 被拒的文件不能留在盘上
    assert not (UPLOAD_DIR / "evil.sh").exists()


def test_upload_strips_path_traversal(client, clean_uploads):
    """⭐ 文件名里的"路径穿越"必须被剥掉。

    客户端如果传 `../../../evil.png`，而服务端直接拿它拼路径，
    文件就会落到 uploads/ 的上级目录去 —— 攻击者可以借此覆盖任意文件。

    防线只有一句：`Path(file.filename).name`。
    它把路径里最后一段取出来（`Path("../../a/b.png").name == "b.png"`），
    目录部分全被丢掉。

    ⚠️ 顺带记住：`content_type` 是**客户端自报的**，只能用来挡"手滑"，
    绝不能当安全依据 —— 想真正校验类型，得读文件头（magic number）。
    """
    resp = client.post(FILE, files={"file": ("../../../evil.png", PNG_BYTES, "image/png")})

    assert resp.status_code == 201
    assert resp.json()["filename"] == "evil.png"          # 目录部分被剥掉了
    assert (UPLOAD_DIR / "evil.png").exists()             # 老老实实待在 uploads/ 里


def test_upload_rejects_oversized_file(client, clean_uploads):
    """超过 2MB → 413，而且不留残骸。

    这个接口的大小检查是**边写边数**的（读一块、判一次、再写），
    不是"先存完再检查" —— 所以超限时那个写了一半的文件必须被删掉，
    否则磁盘上会慢慢堆满半截垃圾。
    """
    oversized = PNG_BYTES + b"\x00" * (3 * 1024 * 1024)

    resp = client.post(FILE, files={"file": ("big.png", oversized, "image/png")})

    assert resp.status_code == 413
    assert not (UPLOAD_DIR / "big.png").exists()


def test_upload_without_file_field(client):
    resp = client.post(FILE)

    assert resp.status_code == 422
