# fquiz

基于 Next.js + Python（FastAPI）的全栈 Monorepo，内置用户管理与登录认证。

## 目录结构

```text
.
├── web/                 # Next.js 16 + TypeScript + App Router（登录态与用户管理页）
├── api/                 # FastAPI 服务（JWT + Refresh Session + RBAC）
├── scripts/dev.sh       # 前后端一键并行启动脚本
├── .env.example         # 根环境变量模板
└── package.json         # Monorepo 根脚本
```

## 技术栈

- 前端：Next.js 16、React 19、TypeScript
- 后端：FastAPI、SQLAlchemy、PostgreSQL/SQLite、Pydantic Settings
- 认证：JWT Access Token（15m）+ Refresh Session（HttpOnly Cookie, 轮换）
- 权限：RBAC（roles / permissions / user_roles / role_permissions）

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

## 认证接口

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/users`（需要 `user.manage`）
- `GET /api/v1/users/{id}`（本人或 `user.manage`）
- `PATCH /api/v1/users/{id}`（需要 `user.manage`）
- `POST /api/v1/users/{id}/roles`（需要 `user.manage`）

初始化管理员（可选）：
- 在 `.env` 设置 `INITIAL_ADMIN_EMAIL`、`INITIAL_ADMIN_USERNAME`、`INITIAL_ADMIN_PASSWORD`
- API 启动时会自动创建并赋予 `admin` 角色

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
- PostgreSQL：`localhost:5432`

5. 停止并清理：

   ```bash
   docker compose down
   ```

说明：
- `NEXT_PUBLIC_API_BASE_URL` 在 Next.js 中是构建期注入；如果修改该值，需要重新执行 `docker compose up --build`。
- 若使用 Docker Compose，默认 `DATABASE_URL` 指向容器内 `db` 服务（PostgreSQL）。
- 默认镜像源已配置为 `docker.m.daocloud.io`，如你网络环境可直连 Docker Hub，可在 `.env` 中覆盖 `POSTGRES_IMAGE / PYTHON_BASE_IMAGE / NODE_BASE_IMAGE`。
