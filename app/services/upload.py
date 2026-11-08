# AI生成
"""上传相关的业务规则。

凡是"涉及多个 crud 调用 + 业务约束"的东西放在这里；
纯粹的"读 / 写一条记录"那种简单活留在 crud。
"""
from fastapi import HTTPException, status
from fastapi import UploadFile
from pathlib import Path

from app.core.config import settings


# 上传目录：相对"启动目录"（也就是 blog-api/）。不存在就先建出来。
# 这里只暴露【路径】，不在这里直接 mkdir —— mkdir 是"创建存储位置"的动作，
# 属于 crud 那侧（文件系统也算存储）；services 只决定"该往哪存"。
UPLOAD_DIR: Path = Path(settings.UPLOAD_DIR)
# 单个文件上限 2MB —— 这条规矩放在 services，因为它是"业务约束"。
MAX_SIZE: int = 2 * 1024 * 1024

# 读文件头用的字节数：够覆盖要认的几种格式（WebP 要看到第 12 字节）。
HEADER_SIZE: int = 32

# 常见图片格式的"魔数"（magic number）：文件开头的固定字节，改不掉地暴露真实类型。
_IMAGE_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"BM", "image/bmp"),
)


def sniff_image_type(head: bytes) -> str | None:
    """按文件头魔数判断【真实】类型；认不出来返回 None。

    为什么必须读文件头？—— 因为 `content_type` 是客户端【自报】的，
    随手就能伪造成 image/png（is_valid_image_content_type 只能挡"手滑"）。
    读开头几个字节由【服务器自己】判断，才算数。

    覆盖：PNG / JPEG / GIF / BMP / WebP。
    注意 WebP 是 RIFF 容器：头 4 字节是 `RIFF`、第 8~11 字节必须是 `WEBP`，
    不能只看前 4 字节（否则任何 RIFF 文件——比如 .wav——都会被当成 WebP）。
    """
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    for signature, name in _IMAGE_SIGNATURES:
        if head.startswith(signature):
            return name
    return None


def ensure_upload_dir_exists() -> Path:
    """第一次启动时把上传目录建出来。"""
    UPLOAD_DIR.mkdir(exist_ok=True)
    return UPLOAD_DIR


def is_valid_image_content_type(content_type: str | None) -> bool:
    """白名单：客户端声明的 content_type 必须以 image/ 开头。

    注意这是"粗筛"，不是"安全依据"——客户端可以自报类型。
    真正的安全靠【服务器自己读魔数】或至少看后缀名（这里没有）。
    本项目为了简单，先靠 content_type。
    """
    return (content_type or "").startswith("image/")


def safe_filename(raw: str | None) -> str:
    """剥掉客户端传来的路径部分，只留最后一段（防路径穿越）。

    `Path("../../x.png").name == "x.png"`：这是 pathlib 的标准特性。
    """
    return Path(raw or "unnamed").name


def is_over_size(size: int) -> bool:
    """判断是否超出 2MB 上限。"""
    return size > MAX_SIZE


# 业务错误：把"超出大小限制"翻译成 413 + 业务术语。
# 因为 raise HTTPException 在本项目 services 里是被允许的（见 services/__init__.py），
# 这里直接复用同一约定。
def raise_too_large() -> None:
    raise HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail="图片不能超过 2MB",
    )


def raise_wrong_type() -> None:
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="只允许上传图片",
    )