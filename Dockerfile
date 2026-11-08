# 单阶段足够：依赖少、没有需要编译的产物。
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 先只拷依赖清单：只要它没变，重装依赖这一层就能命中缓存，
# 之后改代码不会触发重装 —— 构建更快。
COPY requirements.txt ./
RUN pip install -r requirements.txt

# 再拷应用代码与迁移文件
COPY alembic.ini ./
COPY app ./app
COPY migrations ./migrations

EXPOSE 8000

# 这里【只起一个 uvicorn 进程】。要更多并发 / 多进程：
#   uvicorn --workers N
# 或换成 gunicorn + uvicorn worker（生产常用）。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]