# fquiz

基于 Next.js + Python（FastAPI）的全栈 Monorepo 初始化工程。

## 目录结构

```text
.
├── web/                 # Next.js 16 + TypeScript + App Router
├── api/                 # FastAPI 服务
├── scripts/dev.sh       # 前后端一键并行启动脚本
├── .env.example         # 根环境变量模板
└── package.json         # Monorepo 根脚本
```

## 技术栈

- 前端：Next.js 16、React 19、TypeScript
- 后端：FastAPI、Uvicorn、Pydantic Settings
- 协议：REST（默认 `/health`、`/api/v1/ping`）

## 环境要求

- Node.js >= 20
- Python >= 3.10
- Python 需要可用的 `venv` 和 `pip`（Debian/Ubuntu 可安装 `python3-venv`）

## 快速开始

1. 克隆仓库并进入目录。
2. 安装前端依赖：

   ```bash
   npm --prefix web install
   ```

3. 配置环境变量：

   ```bash
   cp .env.example .env
   cp web/.env.local.example web/.env.local
   ```

4. 准备 Python 环境并安装依赖（示例）：

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   python -m pip install -r api/requirements.txt
   ```

5. 一键启动前后端：

   ```bash
   npm run dev
   ```

## 常用命令

```bash
# 启动前端
npm run dev:web

# 仅启动后端
npm run dev:api

# 构建前端
npm run build:web

# 前端 lint
npm run lint:web
```

## Docker Compose 部署

1. 准备环境变量：

   ```bash
   cp .env.example .env
   ```

2. 构建并启动容器：

   ```bash
   docker compose up --build -d
   ```

3. 查看运行状态和日志：

   ```bash
   docker compose ps
   docker compose logs -f
   ```

4. 访问服务：

- 前端：`http://localhost:3000`
- 后端：`http://localhost:8000/health`

5. 停止并清理：

   ```bash
   docker compose down
   ```

说明：
- `NEXT_PUBLIC_API_BASE_URL` 在 Next.js 中是构建期注入；如果修改该值，需要重新执行 `docker compose up --build`。
