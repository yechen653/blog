# AI生成
"""文件系统的"数据访问层"。

为什么连文件系统也要分层？
    crud 这一层的本质不是"用 SQL"，而是【"对某一种存储做读写"】。
    数据库是一种存储、Redis 是一种存储、本地磁盘也是一种存储。
    把磁盘读写集中到 crud/file.py 的好处：
        · 测试时可以把上传目录临时指向 tmp 路径，不必改 router；
        · 如果将来要换成 S3 / MinIO，只改这一个文件，router 完全不动；
        · router 里【没有任何】Path.open / Path.unlink / .write 之类，逻辑更薄。

判据微调："crud = SQLAlchemy 那一层"是不准确的；准确版是
    **crud = 跟某种持久化存储打交道的层**，具体什么存储不限。
"""

from pathlib import Path


def save_to_disk(
    dest: Path, source, chunk_size: int = 1024 * 1024, initial: bytes = b""
) -> int:
    """把 source 分块写入 dest，返回实际写入的字节数。

    分块读是为了【不让大文件一下全塞进内存】—— UploadFile.read() 不带参数就是全读，
    几十 MB 的图就把内存吃掉一大块。

    initial：调用方为了"先读文件头做类型校验"而已经读走的那几个字节。
        校验通过后必须把它们【原样补写回文件开头】，
        否则存到盘上的文件会缺一个头（图片打不开，且 size 也会少算）。

    source 由 caller 负责关闭（这里只接住，不 .close()）—— 通常 caller 是 FastAPI 的
    UploadFile，关闭它的责任在 router 里那一段 `await file.close()`。

    参数类型说明：source 不写死类型，是因为它可以是 BinaryIO，也可以是 FastAPI 的
    UploadFile —— 两者都有 .read(size) -> bytes 方法，但 UploadFile 不是 BinaryIO 实例。
    """
    size = 0
    with dest.open("wb") as out:
        if initial:
            out.write(initial)
            size += len(initial)
        while chunk := source.read(chunk_size):
            size += len(chunk)
            out.write(chunk)
    return size


def delete_from_disk(path: Path) -> None:
    """删一个文件。missing_ok=True：文件本来就不在也不报错。

    这一层只负责"删了没有"；"为什么删、超没超限"是 router / services 关心的事。
    """
    path.unlink(missing_ok=True)


def get_file_size(path: Path) -> int:
    """取文件大小（字节）。文件不在会抛 FileNotFoundError —— 这是异常路径，
    让 caller 决定怎么处理（接口多半转 404，本项目这一层没人调用它）。
    """
    return path.stat().st_size