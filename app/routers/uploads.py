# AI生成
"""表单（Form）与文件上传（File / UploadFile）练习。

这两个不是文章业务的核心，但凡是"客户端发的不是 JSON"的场景都靠它们：
- `Form`：HTML 表单、OAuth2 登录（阶段九的登录接口就用它收 username / password）
- `File`：上传封面、头像、附件

两者的共同点：请求头必须是 `multipart/form-data`（不是 JSON），而且都需要装了
`python-multipart` 才能启动（本项目 requirements.txt 里已有）。

═══════════════════════════════════════════════════════════════
本阶段把"写文件"抽去了 crud 层、"白名单 / 大小限制"抽去了 services 层，
本文件的定位变纯粹了：

    本文件（接线层）：解析 multipart、调用 services 校验、调 crud 写盘、关闭 UploadFile
    app/crud/file.py（数据层）：分块读 + open("wb") + unlink
    app/services/upload.py（业务规则层）：白名单 + 大小限制 + 路径穿越防护

判据：凡是出现 File(...) / UploadFile / multipart 解析的行，都留在本文件。
═══════════════════════════════════════════════════════════════
"""

from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile, status

from app.crud import file as file_crud
from app.services import upload as upload_svc

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("/form", summary="表单提交（Form）")
async def submit_form(
    # Form 的用法和 Query / Path 一模一样：第一个参数是默认值，... 表示必填
    username: str = Form(..., min_length=1, max_length=20, description="用户名"),
    password: str = Form(..., min_length=6, description="密码，至少 6 位"),
):
    """演示"从表单里取字段"。真正的登录（校验密码、发 token）在阶段九。"""
    # 注意：密码只回一个长度，别把原文回显给客户端
    return {"username": username, "password_length": len(password)}


@router.post(
    "/file",
    summary="上传文件（UploadFile）",
    status_code=status.HTTP_201_CREATED,
)
async def upload_file(
    file: UploadFile = File(..., description="要上传的图片"),
):
    """把上传的图片存到 UPLOAD_DIR 目录，返回文件信息。

    这里刻意保留了三个真实项目必须处理的点：
    1. 类型校验【两道】——content_type 白名单（粗筛，客户端自报，只能挡"手滑"）
       + 文件头魔数 sniff（阶段17：服务器自己读字节，才真正算数）；
    2. 文件名安全 —— 客户端可能传 "../../xx.png"，用 services.safe_filename 只取最后一段；
    3. 大小限制 —— 边写边数，超了让 services 抛 413，由 crud.delete_from_disk 清掉半成品。

    分层后的典型形态：
        1. router 解析 multipart 拿 UploadFile
        2. router 调 services 做类型校验（粗筛 + 魔数；不匹配由 services 抛 400）
        3. router 算文件名 → 读文件头 → 调 crud.save_to_disk（读走的头用 initial 补写回去）
        4. 超出大小 → 调 services.raise_too_large() 抛 413 → except 里 crud.delete_from_disk
        5. router 负责 await file.close()（crud 不接管 stream 的生命周期）
    """
    # 0) 先确保目录在（services 帮你建好空目录并返回路径）
    upload_dir = upload_svc.ensure_upload_dir_exists()

    # 1) 文件名安全：客户端原样传过来的文件名剥掉路径部分
    safe_name = upload_svc.safe_filename(file.filename)
    dest = upload_dir / safe_name

    # 2) 类型校验 + 3) 写盘，全放进 try：任何一步失败都要清掉半成品、并关闭上传流
    try:
        # 粗筛：content_type 必须以 image/ 开头（挡"手滑"，不是安全依据）
        if not upload_svc.is_valid_image_content_type(file.content_type):
            upload_svc.raise_wrong_type()                 # 400

        # 真校验（阶段17）：读文件头魔数，由【服务器自己】判断真实类型
        head = await file.read(upload_svc.HEADER_SIZE)
        if not upload_svc.sniff_image_type(head):
            upload_svc.raise_wrong_type()                 # 400：自称图片但内容不是图片

        # 边写边数（把已读走的文件头 initial 补写回去），超了就让 services 抛 413
        size = file_crud.save_to_disk(dest, file, initial=head)
        if upload_svc.is_over_size(size):
            upload_svc.raise_too_large()
    except Exception:
        # 校验失败 / 写盘失败 —— 都清掉半成品（不存在也无妨）
        file_crud.delete_from_disk(dest)
        raise
    finally:
        await file.close()

    return {
        "filename": safe_name,
        "content_type": file.content_type,
        "size": size,
        "saved_to": str(dest),
    }