# Render / Docker: Root Directory = services/doc-ai 일 때 이 파일이 사용됩니다.
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Render가 PORT 환경변수로 할당
ENV PYTHONUNBUFFERED=1
CMD sh -c "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"
