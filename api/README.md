# API Service

Python FastAPI 后端服务。

## 本地开发

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r api/requirements.txt
python -m uvicorn api.app.main:app --reload --host 0.0.0.0 --port 8000
```

## 默认接口

- `GET /health`
- `GET /api/v1/ping`
