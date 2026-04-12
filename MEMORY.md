# MEMORY.md - fquiz 工程长期记忆

## 项目基线

- 当前已完成 `fquiz` 子智能体骨架创建。
- OpenClaw agent id：`fquiz`
- Workspace：`/root/.openclaw/workspace/fquiz`
- Agent dir：`/root/.openclaw/agents/fquiz/agent`

## 约定

- 在未明确项目技术栈、目录结构、部署方式前，避免把其他工程（如 `quiz` / `nquiz`）的具体规则直接套用到 `fquiz`。
- 后续若 `fquiz` 绑定真实仓库或明确职责，应在此文件补充长期有效口径。
- API 镜像构建阶段支持通过 `PIP_INDEX_URL`（Secrets/Variables）和 `PIP_DEFAULT_TIMEOUT`（Variables）调优 pip 拉包稳定性；默认索引为 `https://pypi.org/simple`。
- `web` 目录用于 Docker 独立构建时，`web/package.json` 与 `web/package-lock.json` 必须保持同步；否则 `web/Dockerfile` 中的 `npm ci` 会因锁文件不一致直接失败（`EUSAGE`）。

## 模型管理口径（2026-04-12）

- 模型业务引用键统一使用 `code`（`llm_models.code`），`name` 仅用于展示文案。
- 模型状态机固定为：`DRAFT/ENABLED/DISABLED/DEPRECATED`，并遵循受限流转规则，禁止任意跳转。
- 路由规则类型固定为：`GLOBAL/CAPABILITY/BUSINESS/AGENT`；其中 `GLOBAL` 保留 key 为 `__global__`。
- 模型删除前必须做引用检查（至少检查路由规则引用）；`ENABLED` 状态禁止直接删除。
- 密钥默认只保留 hash + masked + fingerprint，不通过 API 返回明文。

## 文件管理口径（2026-04-12）

- 文件管理一期采用三层模型：
  - `file_storage_backends`（后端定义：VFS/S3）
  - `file_storage_mounts`（挂载点）
  - `file_index_entries`（目录索引快照）
- 后台 API 入口统一在 `/api/v1/admin/files` 前缀，权限码为：
  - `file.read`：浏览挂载点和目录列表
  - `file.manage`：创建目录、删除路径
- 存储驱动抽象位于 `api/app/services/storage_driver.py`，VFS/S3 必须通过同一工厂分发，避免业务层直接耦合具体存储 SDK。
- VFS 默认根目录由 `FILE_VFS_ROOT` 控制（默认 `./data/vfs`）。

## 启动与部署稳定性口径（2026-04-12）

- SQLAlchemy 关联加载选项（`selectinload/joinedload`）避免在模块导入期以全局常量初始化，优先在函数内惰性构建，防止导入顺序导致 mapper 提前配置失败。
- `app.models` 包初始化需预加载全部模型模块，确保字符串关系（如 `"AuditLog"`）在启动阶段可解析。
- 部署 compose 中 DB 镜像应通过 `POSTGRES_IMAGE` 可配置，默认使用镜像站的 pgvector 镜像（`docker.m.daocloud.io/pgvector/pgvector:pg16`）。
- 宿主机 DB 暴露端口统一走 `POSTGRES_PORT`（默认 `5433`），用于规避与宿主机已有 PostgreSQL（常见 `5432`）冲突；容器内连接仍保持 `db:5432`。
- GitHub Actions 使用 `appleboy/ssh-action` 部署时，慢网环境需显式设置 `command_timeout`（建议 `45m`）并为 `docker compose pull` 增加重试，避免出现 `Run Command Timeout` 直接中断发布。
