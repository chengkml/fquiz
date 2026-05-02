# MEMORY.md - fquiz 工程长期记忆

## 项目基线

- 当前已完成 `fquiz` 子智能体骨架创建。
- OpenClaw agent id：`fquiz`
- Workspace：`/root/.openclaw/workspace/fquiz`
- Agent dir：`/root/.openclaw/agents/fquiz/agent`

## 调度并发口径（程凯指定）

- `fquiz` 默认调度并发：`maxConcurrency=6`。
- 供派单技能读取时使用以下固定映射：
  - `targetAgent=fquiz`
  - `dispatchProjectName=fquiz`
  - `maxConcurrency=6`

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
- 宿主机 DB 暴露端口统一走 `POSTGRES_PORT`（默认 `5434`），用于规避与宿主机已有 PostgreSQL（常见 `5432`）冲突；容器内连接仍保持 `db:5432`。
- CORS 来源控制采用“双轨配置”：`API_CORS_ORIGINS`（精确列表）+ `API_CORS_ORIGIN_REGEX`（正则，可选）；`API_CORS_ORIGINS` 支持 `*` 和通配符域名并在后端转换为 `allow_origin_regex`。
- GitHub Actions 使用 `appleboy/ssh-action` 部署时，慢网环境需显式设置 `command_timeout`（建议 `45m`）并为 `docker compose pull` 增加重试，避免出现 `Run Command Timeout` 直接中断发布。
- `docker compose up -d` 不会重建 `build` 类型服务镜像；开发链路默认使用 `deploy/dev-deploy/compose.yml`，前端代码变更后需执行 `docker compose --env-file deploy/dev-deploy/.env -f deploy/dev-deploy/compose.yml up --build -d web`（必要时先 `docker compose --env-file deploy/dev-deploy/.env -f deploy/dev-deploy/compose.yml build --no-cache web`）。
- `api` 构建若在拉取 `docker.m.daocloud.io/library/python:3.11-slim` 时出现 manifest `EOF`，优先重试 `docker compose --env-file deploy/dev-deploy/.env -f deploy/dev-deploy/compose.yml build api`；若持续失败，可在 `deploy/dev-deploy/.env` 覆盖 `PYTHON_BASE_IMAGE=python:3.11-slim` 走 Docker Hub 兜底。

## 前端视觉口径（2026-04-12）

- 后台视觉基线采用 `Slate + Indigo`（浅色）风格，优先使用 `web/src/app/globals.css` 中统一样式类：
  - `surface-card` / `surface-card-muted`
  - `notice` + `notice-error` / `notice-success`
  - `btn-primary` / `btn-secondary` / `btn-danger`
  - `control`
  - `table-modern` / `table-head` / `table-body`
- 字体基线：
  - 标题：`Space Grotesk`
  - 正文：`Manrope`
  - 等宽：`JetBrains Mono`

## 前端联调口径（2026-04-12）

- `NEXT_PUBLIC_API_BASE_URL` 若误配为 loopback（`127.0.0.1/localhost`），前端运行时会在浏览器端自动改写为“当前页面主机 + 同端口（默认 8000）”，避免公网页面触发 PNA（Private Network Access）阻断。
- 认证请求与 WebSocket 连接均统一复用该运行时 API 基址解析逻辑。

## 前端构建稳定性口径（2026-04-13）

- `web` 在 Docker/受限网络环境构建时，避免使用 `next/font/google`（编译期需访问 `fonts.googleapis.com`，网络受限会导致 `npm run build` 失败）。
- 字体基线应优先采用本地可用字体或仓库内自托管字体（`next/font/local`），并通过 CSS 变量维持 `--font-heading` / `--font-body` / `--font-mono` 约定，减少样式层连锁改动。
- `web/src/app/layout.tsx` 应保持无 `next/font/google` 依赖，仅通过 `web/src/app/globals.css` 的 `--font-*` 变量声明字体栈；若后续引入新字体，优先走自托管或运行时回退方案。
- Next.js App Router 的 `web/src/app/**/page.tsx` 只能导出约定字段（`default`、`metadata` 等）；不要在页面文件里额外导出可复用组件。可复用页面主体应放在同目录独立文件（如 `*-content.tsx`），页面文件仅做无参默认导出包装，避免 `next build` TypeScript 阶段报 `invalid "default" export` / `OmitWithTag` 错误。
- Cesium `1.140.0` 依赖链中的 `@spz-loader/core@0.3.1` 会把 WASM 二进制以内联模板字符串打进浏览器 chunk，并触发 `Octal escape sequences are not allowed in template strings`；当前项目不使用 SPZ/Gaussian splats，前端构建通过 `web/next.config.ts` 将 `@spz-loader/core` alias 到 `web/src/lib/spz-loader-core-shim.ts`，保留常规 Cesium Viewer/Entity 能力，禁用 SPZ 解码。

## 前端组件类型兼容口径（2026-04-13）

- 当前依赖组合下，`@heroui/react` 在仓库内会出现 `Button/Input` 等组件导出类型与常见属性（如 `id/className/onPress`）不一致的问题，可能导致 `next build` 的 TypeScript 阶段失败。
- `web/src/components/ui.tsx` 已改为原生语义封装（`button/input/checkbox`）并保留现有样式类约定（`btn-*`、`control`）作为稳定兜底；同时 `ListBox/Modal/Table` 使用 HeroUI 运行时组件 + 宽松类型包装，避免 `children` 等声明缺口阻断构建。
- `@heroui/react` 的 `Table` 在当前版本是分层组合组件：`Table` 仅作为外层容器，`Table.Header/Body/Row/Column/Cell` 必须置于 `Table.Content` 内部，否则运行时会触发 `cannot be rendered outside a collection.`。
- 后续若要恢复 HeroUI 组件能力，先验证依赖版本和类型声明兼容性，再逐页替换，避免再次阻断 Docker 构建。

## 前端组件栈口径（2026-04-17）

- 前端组件库基线已从 `@heroui/react` 切换到 `shadcn/ui` 风格封装 + `Radix UI` primitives。
- 当前基础组件位于 `web/src/components/ui/`，统一通过 `web/src/components/ui.tsx` 对外导出（保留 `@/components/ui` 入口）。
- `todos` 页面已完成首批迁移：筛选/表单选择器使用 `Radix Select`，弹窗使用 `Radix Dialog`，表格使用 shadcn 风格 `Table` 语义封装。
- `web` 依赖口径：新增 `@radix-ui/react-dialog`、`@radix-ui/react-select`、`class-variance-authority`、`clsx`、`tailwind-merge`；移除 `@heroui/react`。
- 后续页面迁移保持“业务逻辑不动，仅替换 UI 组件 API”的最小改动策略，并以 `npm run build:web` 为最终验收门禁。
- 阶段 B（表单控件统一）已覆盖：`/admin/requirements`、`/admin/requirements/new`、`/admin/requirements/[id]`、`/admin/menus`、`/admin/models`、`/admin/users`；上述页面不再使用原生 `select/textarea` 与 `control` 样式输入，统一走 `@/components/ui` 的 `Input/Select/TextArea` 组件。
- 阶段 B 收尾已完成：`/admin/chat` 的消息输入框已统一为 `TextArea`；当前 `web/src/app/admin/**` 已无原生 `select/textarea` 与 `control` 直连输入写法。
- 阶段 C（弹窗统一）已完成：`/admin/models` 与 `/admin/roles` 的手写遮罩弹窗（`fixed inset-0`）已统一迁移为 `@/components/ui` 的 `Dialog`，并保留原有新建/编辑/关闭与提交行为。
- 在当前 `@radix-ui/themes` + TS 配置下，`TextField.Root` / `TextArea` 的 `onChange` 处理函数应显式标注 `ChangeEvent<HTMLInputElement | HTMLTextAreaElement>`；否则 `next build` 的 TypeScript 阶段可能出现 `Parameter implicitly has an 'any' type`，且输入/文本域混用时会触发事件类型不兼容。

## 前端主题口径（2026-04-17）

- 后台主题基线已切换到 `Radix Themes`：`web/src/app/layout.tsx` 必须注入 `@radix-ui/themes/styles.css` 与 `<Theme ...>` 根包裹。
- 当前默认主强调色为 `indigo`（`accentColor=\"indigo\"`）；如需换肤优先调整 `Theme` 的 `accentColor`，并同步清理页面中的硬编码色值类。
- `web/src/app/globals.css` 的语义类（`surface-card` / `btn-*` / `control` / `table-*`）统一基于 Radix token（`--gray-*` / `--accent-*` 等）实现；后续新增样式优先复用这些语义类，不再回退硬编码 `slate/cyan` 色值。
- `web/src/components/ui/*` 的样式应优先通过语义类（如 `dialog-content`、`select-content`、`checkbox-control`）承接主题，确保后续仅改 token 即可全局换肤。
- `web` Docker 构建基于 `node:alpine` 时，`web/package-lock.json` 必须保留 musl 可选依赖条目（至少 `lightningcss-linux-x64-musl`、`@tailwindcss/oxide-linux-x64-musl`）；缺失会在 `next build` 阶段触发 `Cannot find module ...musl.node`。

## 登录页与品牌文案口径（2026-04-18）

- 站点品牌标题统一使用 `Quiz`：至少保持 `web/src/app/layout.tsx` 的 `metadata.title` 与首页主标题一致。
- 登录页默认不展示 `API Base URL`，仅保留 `getApiBaseUrl()` 在请求链路中的能力（不影响鉴权与 API 调用逻辑）。

## 登录页动效口径（2026-04-22）

- 登录页主视觉允许使用装饰性动效（如浮动背景与角色动画），但必须保持登录/注册接口调用链路与鉴权行为不变。
- 首页怪兽交互基线：眼睛跟随鼠标，密码输入框聚焦时主动挪开视线（避免“盯着密码输入”观感）。
- 当前实现位于 `web/src/app/page.tsx`；若后续继续扩展动效，优先抽离样式与展示组件，避免登录业务与视觉代码耦合过深。

## AI 聊天口径（2026-04-13）

- 一期聊天入口固定为后台路由 `/admin/chat`，权限码为 `chat.use`。
- 聊天模型选择规则固定为：`CAPABILITY: chat.default` 优先，未命中时回退 `GLOBAL: __global__`。
- 仅允许 `ENABLED` 且具备激活密钥记录的模型参与路由命中；若不满足，接口返回 400。
- 运行时真实 Provider Key 不从数据库反解，统一从环境变量 `LLM_PROVIDER_API_KEYS` 注入（支持 `openai=sk-...` 或 JSON 字典字符串）。
- 一期模型调用采用非流式 OpenAI-compatible `POST /chat/completions`，后续如需流式再扩展 SSE/WS。

## Celery 监控口径（2026-05-01）

- Celery 监控采用“双页面”：
  - `Worker监控`：`/admin/workers`（聚焦 worker 在线状态、并发、队列、单 worker 任务快照）
  - `任务监控`：`/admin/task-monitor`（聚焦全局任务状态分布、队列积压、任务明细）
- Worker 监控 API 入口：
  - `GET /api/v1/admin/workers/overview`
  - `GET /api/v1/admin/workers/tasks?worker=...&recent_limit=...`
- 两页统一复用权限码：`celery.read` / `celery.manage`。

## 调度与监控口径（2026-05-02）

- 调度链路已统一为 API 直连 Celery（不再保留独立 `scheduler` 服务与 `SCHEDULER_API_*` 配置）：
  - Web 任务调用 API 业务接口后，由后端服务层直接 `.delay()` 入队。
  - 任务执行与定时触发继续由 `celery-worker` / `celery-beat` 负责。
- 监控能力统一走 Flower 代理：
  - 后端代理入口：
    - `GET /api/v1/admin/flower/workers`
    - `GET /api/v1/admin/flower/worker-tasks`
  - 前端 `Worker监控` 与 `任务监控` 页面都通过后端代理读取 Flower 数据，不直接连 Flower。
- Worker 自动注册机制：
  - Celery worker 启停/心跳通过 signals 写入 `worker_registry` 表。
  - Beat 定时任务 `app.tasks.worker_registry_tasks.sweep_worker_registry_offline` 负责离线兜底标记。

## 前端 Radix 全量化口径（2026-04-18）

- `web/src/app/**` 已完成“去语义类 + 组件全量 Radix 化”：不再依赖 `surface-card` / `btn-*` / `control` / `table-*` / `notice*` / `text-muted` 等自定义语义类。
- 页面组件基线统一为 `@radix-ui/themes`：
  - 交互：`Button` / `Checkbox`
  - 输入：`TextField.Root` / `TextArea` / `Select.Root`
  - 表格：`Table.Root + Header/Body/Row/ColumnHeaderCell/Cell`
- 工程约束更新：`web/src/app` 下默认不再引入原生 `button/input/select/textarea/table` 作为业务 UI（除非有明确无替代场景并单独说明）。
- `web/src/app/globals.css` 仅保留基础排版与 Radix token 基线，不再承载语义组件样式层。

## 前端上传控件类型口径（2026-04-18）

- 在当前 `@radix-ui/themes` 类型定义下，`TextField.Root` 的 `type` 联合不包含 `file`。
- 文件上传场景应使用原生 `<input type="file">`（可配合主题 token 做样式），避免在 `next build` 的 TypeScript 阶段触发类型错误。

## 前台组件选型优先级（程凯指定，2026-04-18）

- 前台页面组件默认优先使用 `Radix UI`（含 `@radix-ui/themes` 与 Radix primitives）。
- 仅当 Radix 体系内没有合适组件时，才使用其他组件方案。
- 引入非 Radix 组件时，优先最小依赖与最小改动，并保持现有主题与交互风格一致。

## 菜单迁移口径（2026-04-18）

- `日程管理` 菜单已升级为独立日程模块：保留菜单 `admin.schedule`（`/admin/schedule`，权限 `todo.read`），前端由 `web/src/app/admin/schedule/page.tsx` 承载年/月/周视图、编辑、完成、AI 生成交互，不再复用 `todos` 页面。
- `admin.schedule` 已加入后端与前端受保护菜单集合，避免在菜单管理中被误删。
- `家庭作业` 菜单迁移采用最小改动策略：新增菜单 `admin.homework`（`/admin/homework`，权限 `question_bank.read`），并直接复用 `question-bank` 页面能力作为家庭作业承载。
- `admin.homework` 已加入后端与前端受保护菜单集合，避免在菜单管理中被误删。
- `作业监控` 菜单迁移采用最小改动策略：新增菜单 `admin.job_mgr`（`/admin/job`，权限 `question_bank.read`），并由 `web/src/app/admin/job/page.tsx` 复用 `question-bank` 页面能力承载作业监控交互。
- `admin.job_mgr` 已加入后端与前端受保护菜单集合、admin 默认菜单绑定与后台首页入口，避免在菜单管理中被误删。
- `题库统计` 菜单迁移采用最小改动策略：新增菜单 `admin.mindmap`（`/admin/mindmap`，权限 `question_bank.read`），并复用现有题库统计承载页面能力。
- `admin.mindmap` 已加入后端默认菜单绑定与前端后台首页入口，确保菜单可见且可直达。
- `诗词本` 菜单迁移沿用词条能力：保留菜单编码 `admin.vocabulary` 与权限 `vocabulary.read`，菜单文案统一为“诗词本”，默认路由为 `/admin/poetry`，并由 `web/src/app/admin/poetry/page.tsx` 复用 `vocabulary` 页面实现。
- `价格监控` 菜单迁移沿用 Token 统计能力：保留菜单编码 `admin.token_usage` 与权限 `model.read`，菜单文案统一为“价格监控”，默认路由为 `/admin/price-monitor`，并由 `web/src/app/admin/price-monitor/page.tsx` 复用 `token-usage` 页面实现。
- `API测试` 菜单迁移沿用模型测试能力：新增菜单编码 `admin.api_tester`（`/admin/api-tester`，权限 `model.read`），由 `web/src/app/admin/api-tester/page.tsx` 复用 `models` 页面承载“冒烟测试/对话测试/测试记录”能力；并已加入后端与前端受保护菜单集合、admin 默认菜单绑定与后台首页入口。
- `模型管理` 菜单迁移沿用既有模型能力：保留菜单编码 `admin.models`（`/admin/models`，权限 `model.read/model.manage`），继续由 `web/src/app/admin/models/page.tsx` 承载模型台账、状态流转、路由规则、密钥轮换、健康检查与测试能力；并已加入后端与前端受保护菜单集合、admin 默认菜单绑定与后台首页入口。
- `流程图` 菜单已切回独立 Mermaid 管理能力：菜单编码 `admin.mermaid_mgr`（`/admin/mermaid-mgr`，权限 `question_bank.read`），前端由 `web/src/app/admin/mermaid-mgr/page.tsx` 承载列表/分组/新建编辑删除，编辑页为 `web/src/app/admin/mermaid-mgr/[id]/page.tsx`（AI 流式改图 + 预览 + 保存）；后端接口对齐 quiz 路径：`/api/v1/mermaids/diagrams/*`，并兼容 `/api/mermaids/diagrams/*` legacy 前缀。
- `上帝视角` 菜单迁移沿用系统日志能力：新增菜单编码 `admin.diary`（`/admin/diary`，权限 `menu.read`），由 `web/src/app/admin/diary/page.tsx` 复用 `syslog` 页面承载审计日志查询能力；并已加入后端与前端受保护菜单集合、admin 默认菜单绑定与后台首页入口。
- `待办管理` 菜单迁移采用最小改动策略：保留菜单编码 `admin.todos`（`/admin/todos`，权限 `todo.read`），并沿用现有 `todos` 页面能力承载待办管理完整交互（筛选、创建、状态流转、删除）。
- `队列管理` 菜单迁移采用最小改动策略：新增菜单编码 `admin.queue_mgr`（`/admin/jobqueue`，权限 `todo.read`），并由 `web/src/app/admin/jobqueue/page.tsx` 复用 `todos` 页面能力承接队列任务清单管理；已加入后端与前端受保护菜单集合、admin 默认菜单绑定与后台首页入口。
- `试题管理` 菜单迁移采用最小改动策略：保留菜单编码 `admin.question_bank`（`/admin/question-bank`，权限 `question_bank.read`），菜单文案统一为“试题管理”；前端后台首页入口文案同步为“试题管理”，并继续复用现有题库题目管理页面能力（列表、筛选、编辑、状态流转、标签管理）。
- `分组管理` 菜单迁移沿用标签能力：保留菜单编码 `admin.tag` 与权限 `question_bank.read`，菜单文案统一为“分组管理”，默认路由迁移为 `/admin/group`，并由 `web/src/app/admin/group/page.tsx` 复用 `tag` 页面承载分组检索、重命名与解除关联能力。
- `知识点管理` 菜单迁移沿用标签能力：新增菜单编码 `admin.knowledge_point_mgr`（`/admin/knowledge`，权限 `question_bank.read`），并由 `web/src/app/admin/knowledge/page.tsx` 复用 `tag` 页面承载知识点检索、重命名与解除关联能力；已加入后端与前端受保护菜单集合、admin 默认菜单绑定与后台首页入口。
- `MCP管理` 菜单迁移沿用模型编排能力：新增菜单编码 `admin.mcp_server`（`/admin/mcp-server`，权限 `model.read`），并由 `web/src/app/admin/mcp-server/page.tsx` 复用 `models` 页面承载模型/路由规则管理能力；已加入后端与前端受保护菜单集合、admin 默认菜单绑定与后台首页入口。
- `菜单管理` 菜单迁移沿用现有后台菜单能力：保留菜单编码 `admin.menus`（`/admin/menus`）、权限 `menu.read/menu.manage` 与前后端 CRUD/树形查询接口（`/api/v1/admin/menus*`）不变，继续由 `web/src/app/admin/menus/page.tsx` 承载菜单筛选、新建、编辑、删除与受保护菜单拦截能力。
- `微信小程序` 菜单迁移采用最小改动策略：新增菜单编码 `admin.wxapp`（`/admin/wxapp`，权限 `system_param.read`），并由 `web/src/app/admin/wxapp/page.tsx` 复用 `system-params` 页面能力承载微信小程序配置项维护。
- `admin.wxapp` 已加入后端与前端受保护菜单集合、admin 默认菜单绑定与后台首页入口，确保可见、可达且不被误删。
- `单词统计` 菜单迁移采用最小改动策略：保留菜单编码 `admin.knowledge_mastery`（`/admin/vocabulary-proficiency`，权限 `vocabulary.read`），并由 `web/src/app/admin/vocabulary-proficiency/page.tsx` 承载词条总量、状态分布、缺失字段与最近更新趋势统计能力；已加入后端与前端受保护菜单集合、admin 默认菜单绑定与后台首页入口。
- `队列管理` 菜单迁移采用最小改动策略：新增菜单编码 `admin.queue_mgr`（`/admin/jobqueue`，权限 `todo.read`），并由 `web/src/app/admin/jobqueue/page.tsx` 复用 `todos` 页面承载队列任务清单能力；已加入后端与前端受保护菜单集合、admin 默认菜单绑定与后台首页入口。
- `提示词管理` 菜单能力已于 2026-04-26 下线：`admin.system_message`、`system_message.read/system_message.manage`、`/admin/prompt`、`/admin/system-message` 与 `/api/v1/admin/system-messages*` 均不再作为有效功能入口；历史数据库表不主动删除。
- `收件箱`、`代码评审`、`Git管理` 功能已于 2026-04-26 下线：`admin.inbox`、`admin.code_review`、`admin.git_desktop` 仅保留在 removed/disabled 过滤集合中，用于屏蔽存量菜单；前端路由 `/admin/inbox`、`/admin/code-review`、`/admin/git-desktop` 不再提供页面。
- `历史答卷` 菜单迁移采用最小改动策略：保留菜单编码 `admin.history`（`/admin/history`，权限 `question_bank.read`），并由 `web/src/app/admin/history/page.tsx` 复用 `question-bank` 页面承载历史答卷查询与管理能力；已加入后端与前端受保护菜单集合与后台首页入口。
- `脚本管理` 菜单迁移采用最小改动策略：保留菜单编码 `admin.cron_task_mgr`（`/admin/cron`，权限 `todo.read`），菜单文案统一为“脚本管理”，并继续由 `web/src/app/admin/cron/page.tsx` 复用 `todos` 页面承载脚本任务清单能力。
- `百度网盘` 菜单迁移采用最小改动策略：新增菜单编码 `admin.baidu_pan`（`/admin/baidu-pan`，权限 `file.read`），并由 `web/src/app/admin/baidu-pan/page.tsx` 复用 `files` 页面承载目录浏览、上传、重命名、移动、删除与下载能力；已加入后端与前端受保护菜单集合、admin 默认菜单绑定与后台首页入口。
- `文件识别` 菜单迁移采用最小改动策略：新增菜单编码 `admin.filedetector`（`/admin/filedetector`，权限 `file.read`），并由 `web/src/app/admin/filedetector/page.tsx` 复用 `files` 页面承载目录浏览、上传、重命名、移动、删除与下载能力；已加入后端与前端受保护菜单集合、admin 默认菜单绑定与后台首页入口。
- `热搜` 菜单迁移采用最小改动策略：新增菜单编码 `admin.hot_search`（`/admin/hot-search`，权限 `menu.read`），并由 `web/src/app/admin/hot-search/page.tsx` 复用 `data-query` 页面承接热搜入口；后端同步提供 `/api/v1/admin/hot-search` 记录检索与关注主题能力（`api/app/api/v1/hot_search.py` + `api/app/services/hot_search_service.py` + `api/app/models/hot_search.py`）作为后续独立热搜交互能力底座。

## 前端主题纯化口径（2026-04-18）

- `web/src/app/globals.css` 保持最小化：仅保留 Tailwind 导入与基础全局规则，不再承载字体栈覆盖、Radix token 二次映射、装饰性渐变背景。
- `web/src/app/layout.tsx` 只负责注入 `@radix-ui/themes/styles.css` 与 `Theme` Provider，不再通过根容器类叠加自定义主题视觉。
- `web/src/app/admin/layout.tsx` 使用 Radix Themes 组件（`Card/Flex/Text/Heading/Button/Callout`）组织后台壳层，避免硬编码品牌色光斑与渐变块。
- `web/src/app/**` 中 `Button` 视觉优先通过 `variant / color / size` 控制；不再使用长 Tailwind 颜色类拼接按钮主题。

## 滚动条样式口径（2026-04-25）

- 主页面与系统页面滚动条样式统一收敛到 `web/src/app/globals.css` 的全局基线：
  - `*` 统一声明 `scrollbar-width` 与 `scrollbar-color`（覆盖 Firefox 等非 WebKit 浏览器的所有滚动容器）。
  - `*::-webkit-scrollbar*` 统一声明轨道/滑块样式（覆盖 Chromium/WebKit）。
- `.scrollbar-antd` 仅保留 `scrollbar-gutter: stable`，不再重复定义颜色与尺寸，避免局部样式与全局基线漂移。

## Wine 执行器口径（2026-04-25）

- Windows EXE 调用能力统一由后端 `/api/v1/wine/*` 承接，权限码为 `wine.read` / `wine.manage`。
- Wine 运行参数通过环境变量控制：
  - `WINE_BINARY_PATH`：Wine 可执行文件路径或命令名，默认 `wine`。
  - `WINE_ALLOWED_ROOT`：允许执行/工作目录根路径，默认 `./data/wine`。
  - `WINE_DEFAULT_TIMEOUT_SECONDS` / `WINE_MAX_TIMEOUT_SECONDS`：默认与最大执行超时。
- 后端执行必须使用 `asyncio.create_subprocess_exec` 参数数组，不走 shell；EXE 路径与工作目录必须限制在 `WINE_ALLOWED_ROOT` 下。
- 实时日志通过 `StreamingResponse` + SSE 事件输出；前端使用 `fetchWithAuth` 读取 `ReadableStream`，避免原生 `EventSource` 无法携带现有 Bearer Token 的鉴权问题。
- Docker API 镜像默认不内置 Wine；部署时需在运行环境安装 Wine 或将 `WINE_BINARY_PATH` 指向可用二进制。

## 前端菜单交互口径（2026-04-19）

- 后台壳层（`web/src/app/admin/layout.tsx`）已采用 `@radix-ui/themes` 的 `DropdownMenu` 承接菜单交互：
  - 移动端（`md` 以下）菜单入口统一为“菜单”下拉，不再直接渲染左侧长列表；
  - 顶部账号区“返回首页/退出登录”统一收口到“账号”下拉。
- 后台表格行内“操作”入口推荐统一为下拉菜单形态，优先复用 `web/src/components/row-action-menu.tsx`，避免页面内重复堆叠小按钮并降低操作列宽度波动。
- Phase B 样板页已落地：`/admin/users`、`/admin/requirements`、`/admin/menus`；后续页面迁移默认保持“业务逻辑不动，仅替换操作入口承载组件”的最小改动策略。
- 后台左侧导航默认不展示“系统菜单”标题与底部“当前角色/账号状态”文案，避免重复信息占用导航空间（移动端抽屉同样不显示该标题）。

## 数据库连接口径（2026-04-23）

- API 默认数据库连接切换为本地 PostgreSQL：优先读取 `DATABASE_URL`；若未设置则由 `DB_HOST/DB_PORT/DB_NAME/DB_USERNAME/DB_PASSWORD` 组装。

- 默认参数口径：
  - Docker 内：`DB_HOST=db`、`DB_PORT=5432`、`DB_NAME=postgres`、`DB_USERNAME=fquiz`、`DB_PASSWORD=fquiz`。
  - 本机直连（非 Docker）：`DB_HOST=127.0.0.1`、`DB_PORT=5434`、`DB_NAME=postgres`、`DB_USERNAME=fquiz`、`DB_PASSWORD=fquiz`。
- `docker compose` 的 `db` 服务已取消 `local-db` profile，默认 `up` 即启动本地库；`api` 增加 `depends_on: db (healthy)`。
- `DB_SCHEMA` 通过 PostgreSQL `search_path` 注入，语义等价 JDBC 的 `currentSchema`。
- API 启动初始化口径：`seed_defaults` 对本地目标执行；为兼容老表状态约束，初始管理员状态写入值统一为 `ENABLED`（不使用 `active`）。
- 用户表兼容口径：用户主键列对齐旧库 `users.user_id`，与用户关联的外键统一引用 `users.user_id`（不再引用 `users.id`）。

## 高程数据管理口径（2026-05-01）

- 高程管理一期采用“文件 + 元数据 + 异步回填”三层：
  - 文件层：高程源数据文件由现有文件管理模块承载（`mount_code + file_path`）。
  - 元数据层：`elevation_dataset` 记录数据集来源、分辨率、样本统计、覆盖 bbox、状态。
  - 任务层：`elevation_apply_job` 记录线路高程回填任务状态与统计。
- 线路渲染继续复用 `power_line_tower.altitude_m` 作为高度来源；回填后在 `raw_extra_json.elevation` 写入溯源信息（dataset/sample_distance/sampled_at）。
- 一期采样策略为 CSV 点集最近邻（非栅格插值），用于先打通管理与回填闭环；默认推荐回填模式 `fill_null_only`，避免覆盖人工高程。
- 高频通知 topic 为 `admin.elevation`，线路联动通知沿用 `admin.power-lines`。
- 高程数据文件格式已扩展为：`csv/img/tif/tiff`。
  - `csv`：继续使用点集最近邻采样。
  - `img/tif/tiff`：使用栅格像元采样（按杆塔经纬度取值，必要时自动做 CRS 转换）。
- 栅格实现口径：
  - 运行依赖 `rasterio`（随 `api` 依赖安装）。
  - 分析阶段 `sample_count` 使用 `width * height`（超大栅格上限截断为 `2_147_483_647`），`bbox` 直接取源栅格 `bounds`。
  - 非 WGS84 CRS 会返回告警说明，提醒边界坐标单位可能不是经纬度。
- 用户名列口径：历史环境存在 `users.username` 与 `users.user_name` 双形态；运行时通过 `USER_USERNAME_COLUMN`（`username`/`user_name`）与目标库对齐，避免启动阶段关系预加载触发 `UndefinedColumn`。
- 密码列口径：历史环境存在 `users.password` 与 `users.password_hash` 双形态；运行时通过 `USER_PASSWORD_COLUMN`（`password`/`password_hash`）与目标库对齐，避免启动阶段关系预加载触发 `UndefinedColumn`。

## 发布验收口径（2026-04-26）

- 发布链路默认执行（开发链路）：
  - `docker compose --env-file deploy/dev-deploy/.env -f deploy/dev-deploy/compose.yml build`
  - `docker compose --env-file deploy/dev-deploy/.env -f deploy/dev-deploy/compose.yml up -d`
- 最小运行态验收：
  - `docker compose --env-file deploy/dev-deploy/.env -f deploy/dev-deploy/compose.yml ps`（关键服务 `api/web/celery-worker/celery-beat/db/redis/minio` 为 Up，关键依赖健康）。
  - `curl -fsS http://127.0.0.1:8000/health` 返回 API 健康 JSON。
  - `curl -I -fsS http://127.0.0.1:3000/` 返回 `HTTP/1.1 200 OK`。
  - 结合 `docker compose --env-file deploy/dev-deploy/.env -f deploy/dev-deploy/compose.yml logs --tail` 抽样检查 `api/web/celery-worker/celery-beat` 启动日志是否正常。

## 前端组件栈口径（2026-04-22）

- 组件库基线从 `Radix UI` 切换为 `Ant Design`，`web` 依赖已移除 `@radix-ui/themes` / `@radix-ui/react-dialog` / `@radix-ui/react-select`，新增 `antd`。
- 为控制迁移范围，新增兼容层 `web/src/components/ui-antd.tsx`：对外保持 `Button/Card/Flex/Text/Heading/TextField/TextArea/Select/Dialog/DropdownMenu/Callout/Table/Checkbox/Theme` API 形态，内部使用 AntD 实现。
- `web/src/app/layout.tsx` 统一注入 `antd/dist/reset.css`，并通过兼容层 `Theme` 提供全局主题 token。
- 工程约束更新：
  - 页面/组件禁止继续新增 `@radix-ui/themes` 导入；
  - 优先从 `@/components/ui-antd` 引入 UI 组件；
  - 新增页面如需 AntD 高级能力，可直接引入 `antd`，但需保持与现有主题和交互风格一致。
- 兼容说明：`web/src/types/antd.d.ts` 仅保留 `antd/dist/reset.css` 声明，禁止再写 `declare module "antd"`；否则会覆盖官方类型并导致 `Form.useForm<T>` 等泛型调用在 `next build` 的 TypeScript 阶段失败。
- `web/src/components/ui-antd.tsx` 作为兼容层时，若自定义 `type/variant/size/checked` 等语义，必须先 `Omit` 掉对应 AntD 原生同名字段再重定义，否则会触发联合类型冲突并阻断 Docker 构建。

## 需求管理兼容口径（2026-04-22）

- 需求管理底层表结构已切换为老工程口径：
  - 主表：`project_requirement`
  - 生命周期表：`project_requirement_log`
- `fquiz` 需求模块保持“双接口并行”策略：
  - 现有前端接口：`/api/v1/requirements*`
  - 老工程兼容接口：`/api/project/requirement/*`（`search/get/status/analyze/review/lifecycle/history-options/pending`）

## 思维导图兼容口径（2026-04-22）

- 思维导图已从“题库统计复用页”切回独立模块，后端主表固定为老工程口径 `mind_map`。
- API 入口统一采用老工程风格路径（挂在 `/api/v1` 下）：
  - `POST /api/v1/mindmap/search`
  - `GET /api/v1/mindmap/get/{id}`
  - `POST /api/v1/mindmap/create`
  - `PUT /api/v1/mindmap/update-basic-info`
  - `PUT /api/v1/mindmap/update-data`
  - `DELETE /api/v1/mindmap/delete/{id}`
  - `GET /api/v1/mindmap/generate/stream`
- Todo 分析链路已恢复老逻辑：`POST /api/v1/todos/{todo_id}/init-mindmap` 会真实创建/复用 `mind_map(id=todo_id)` 并返回导图信息，前端跳转到 `/admin/mindmap/edit/{id}`。
- 当前前端编辑器基线为“JSON 编辑 + 树预览 + AI 流式生成 + JSON/Markdown 导出”；如需老工程 `mind-elixir` 的可视化拖拽编辑，需单独引入并适配 AntD/Next 页面栈。
- 状态机口径对齐老工程：`PENDING_ANALYSIS -> PENDING_REVIEW/PENDING_REVISION/OPEN -> IN_PROGRESS -> COMPLETED/CLOSED`；并兼容映射 `CANCELLED -> CLOSED`。
- 优先级口径对齐老工程存储：数据库落库使用大写 `LOW/MEDIUM/HIGH`；API 层兼容小写输入并向前端返回小写展示值。
- 旧表不包含 `assignee/reviewer/due_at` 等字段，`/api/v1/requirements` 中这些字段当前作为兼容占位返回，后续如需恢复需补扩展表或业务映射策略。
- 老工程兼容接口补充 `POST /api/project/requirement/{id}/design`，用于需求设计阶段回写（`PENDING_ANALYSIS` 内部闭环）。

## 待办管理兼容口径（2026-04-22）

- 待办模块已切换到 quiz 表口径：`api/app/models/todo.py` 使用 `todo` 表（非 `todos`），字段为 `title/descr/status/priority/start_time/due_date/expire_time/calendar_event_id/create_date/create_user/update_date/update_user`。
- 状态机与优先级固定为：
  - 状态：`SCHEDULED/IN_PROGRESS/COMPLETED/CANCELLED/EXPIRED`
  - 优先级：`LOW/MEDIUM/HIGH`
- `/api/v1/todos` 查询口径对齐 quiz：默认按当前登录用户 `create_user` 过滤，仅返回本人待办；支持 `title/status/priority/page_num/page_size`。
- 待办扩展接口口径：
  - `POST /api/v1/todos/{todo_id}/complete`：完成待办（置 `COMPLETED`）
  - `POST /api/v1/todos/{todo_id}/init-mindmap`：创建或复用 `mind_map(id=todo_id)` 并返回导图详情
- 前端 `web/src/app/admin/todos/page.tsx` 已按 quiz 交互重构：默认状态筛选 `SCHEDULED`、分页列表、新增/编辑/详情、分析、完成、删除；`jobqueue/cron` 继续复用该页面。

## 日程管理兼容口径（2026-04-22）

- 日程模块已切换到 quiz 表口径：`api/app/models/calendar_event.py` 使用 `calendar_event` 表，字段为 `title/descr/status/priority/start_time/end_time/expire_time/all_day/completed_at/todo_id/create_date/create_user/update_date/update_user`。
- 日程 API 固定为：
  - `POST /api/v1/calendar/search`
  - `GET /api/v1/calendar/get/{id}`
  - `POST /api/v1/calendar/create`
  - `PUT /api/v1/calendar/update`
  - `DELETE /api/v1/calendar/delete/{id}`
  - `POST /api/v1/calendar/{id}/complete`
  - `GET /api/v1/calendar/generate/stream`
- 日程与待办保持双向同步：
  - 日程创建/更新/删除/完成会同步到 `todo`
- 待办创建/更新/删除/状态流转会同步到 `calendar_event`
- 通过 `is_sync/syncing` 标记防止递归回环。

## 日记管理兼容口径（2026-04-23）

- `admin.diary` 已从系统日志复用页切换为独立 Diary 模块，后端主表固定为老工程口径 `diary`。
- Diary 表字段口径：`id/title/content/diary_date/mood/weather/archived/create_date/create_user/update_date/update_user`，并保留 `create_user` 维度隔离查询。
- API 入口统一采用老工程风格路径（挂在 `/api/v1` 下）：
  - `POST /api/v1/diary/search`
  - `GET /api/v1/diary/get/{id}`
  - `POST /api/v1/diary/create`
  - `PUT /api/v1/diary/update`
  - `DELETE /api/v1/diary/delete/{id}`
  - `POST /api/v1/diary/{id}/archive?archived=...`
- 查询逻辑对齐老工程：支持 `title/mood/diary_date_start/diary_date_end/archived` 过滤，排序 `diary_date DESC, create_date DESC`。
- 当前权限沿用兼容口径：
  - 读：`menu.read | menu.manage`
  - 写：`menu.manage`
  后续若需细粒度可拆分 `diary.read/diary.manage`。

## 登录鉴权兼容口径（2026-04-23）

- 登录请求口径对齐 quiz 老工程：`/api/v1/auth/login` 使用 `user_id + password`，不再使用 `email + password`。
- 密码校验采用双栈兼容：
  - 优先兼容老库 `BCrypt` 哈希；
  - 继续兼容现有 `Argon2` 哈希。
- 用户状态采用兼容归一：
  - `ENABLED/ACTIVE/1/TRUE` 视为可登录（`active`）；
  - `DISABLED/INACTIVE/0/FALSE` 视为禁用（`disabled`）。
- 角色/权限读取优先走老表链路：
  - `user_role_rela -> user_role` 计算 `role_codes`
  - `role_menu_rela -> menu` 映射 `permission_codes`
- 管理员角色兼容别名：
  - 命中 `admin/sys_mgr/administrator` 或角色名含“管理员”时，统一附加 `admin` 角色码，用于现有 `require_permission` 放行逻辑。
- 菜单树读取优先走老 `menu` 表构建（用于 `/api/v1/admin/me/menus`）；读取失败时回退现有实现。

## 角色菜单管理兼容口径（2026-04-23）

- 后台角色/菜单管理（`/api/v1/admin/roles*`、`/api/v1/admin/menus*`）已切换为老表链路：
  - 角色主表：`user_role`
  - 用户角色关系：`user_role_rela`
  - 角色菜单关系：`role_menu_rela`
  - 菜单主表：`menu`
- 角色/菜单 ID 口径统一为字符串（含前后端契约）：
  - 后端 `api/app/schemas/admin.py` 的 `RolePublic/MenuPublic` 及其请求体均使用字符串 ID；
  - 前端 `web/src/types/auth.ts` 的 `RoleItem/MenuItem/MenuTreeItem` 同步使用字符串 ID。
- 菜单树（`/api/v1/admin/me/menus`）ID 口径已对齐老表：
  - 直接返回 `menu.menu_id/parent_id`，不再生成临时递增 ID。
- 旧库无独立 `permissions` 表，`/api/v1/admin/permissions` 与角色权限展示继续采用“菜单编码 -> 权限码”兼容映射策略。

## 前端构建类型口径（2026-04-23）

- `web` 在 `strict` 配置下，`web/src/app/admin/**` 中事件/回调参数（如 `onChange/onClick/onFinish/showTotal/footer`）需显式标注类型，避免 `noImplicitAny` 在 `next build` 阶段阻断。
- `antd` 的 `Card` 在当前仓库类型环境下不稳定，页面层默认优先使用 `@/components/ui-antd` 的 `Card` 兼容包装；兼容层内部通过显式类型收敛渲染 `AntCard`，避免 JSX 构造签名缺失报错。
- 前端类型巡检推荐命令：`npm --workspace web exec tsc --noEmit --pretty false`；用于在完整 `next build` 前快速发现 `strict` 类型门禁问题。
- `antd` 的 `Modal.footer` 自定义回调中，`extra.OkBtn/CancelBtn` 必须按组件类型标注为 `FC`（或由上下文推断），不要写成 `() => ReactElement`；否则在 `next build` 的 TS 阶段会出现签名不兼容报错（`Target signature provides too few arguments`）。

## 后台菜单组件口径（2026-04-23）

- 后台壳层菜单（`web/src/app/admin/layout.tsx`）统一使用 Ant Design `Menu`（`mode="inline"`）承载菜单树，不再使用递归 `Button + Link` 手工渲染。
- 菜单数据仍来自 `/api/v1/admin/me/menus`，并通过 `pathname` 计算 `selectedKeys`，保证当前路由高亮。
- 菜单默认全展开（`openKeys` 覆盖全部带子节点菜单），与历史交互保持一致，避免层级菜单在首次进入时不可见。
- 顶部账号操作入口继续使用 `DropdownMenu` 兼容层，不在本口径范围内。
- 后台导航布局基线为“左侧导航”：
  - 桌面端（`md` 及以上）在左侧栏显示 `Menu`；
  - 移动端通过左侧 `Drawer` 展示同一套菜单树；
  - 不再使用顶部横向 `Menu` 作为主导航承载。

## 后端运行时口径（2026-04-23）

- 登录兼容新增了 `bcrypt` 校验分支后，`api/requirements.txt` 必须包含 `bcrypt`；否则 Docker 重建后 `api` 会在启动阶段报 `ModuleNotFoundError: No module named 'bcrypt'`。
- 老菜单树构建（`build_legacy_menu_tree`）在字符串 ID 口径下，节点字典键必须使用 `legacy_id`（即 `menu_id`）；避免残留旧变量名导致 `/api/v1/admin/me/menus` 500。

## 后台壳层布局口径（2026-04-23）

- `web/src/app/admin/layout.tsx` 当前基线为“顶部固定头 + 左侧内嵌菜单 + 主内容区”：
  - 右上角提供菜单按钮，支持左侧菜单隐藏/显示；
  - 左侧菜单承载组件统一为 `AntMenu (inline)`，不再使用 `Drawer` 作为主菜单容器。
- 后台菜单数据口径不变：继续读取 `/api/v1/admin/me/menus`，按 `pathname` 计算选中项和展开项。
- 后续后台页面改造默认遵循“左侧内嵌菜单可折叠（显隐）”交互，除非有明确业务理由变更。

## 本地数据库初始化口径（2026-04-23）

- 当需要把 84 库老工程鉴权链路数据落到本地时，目标应优先选本地 `fquiz-db` 的 `postgres` 数据库（非 `fquiz`），避免覆盖新结构表。
- 本地初始化范围（本轮基线）：
  - `public.users`
  - `public.user_role`
  - `public.menu`
  - `public.role_menu_rela`
- 标准流程：
  1. 从 `223.109.142.84:5432/postgres` 导出上述表 `schema + data`；
  2. 本地 `postgres` 库执行 `DROP ... CASCADE` 后回放；
  3. 导入数据阶段用同一会话临时 `SET session_replication_role=replica`，规避 `menu.parent_id` 自关联外键顺序问题；
  4. 用 `count + md5(signature)` 对比远端与本地一致性。

## 登录页双角色视觉口径（2026-04-23）

- 登录页主视觉已从单怪兽升级为“双角色怪兽”（毛怪 + 大眼仔）构图，实现在 `web/src/app/page.tsx`。
- 交互基线保持：眼睛跟随鼠标；密码输入时执行避视动作（毛怪转头，大眼仔轻微眯眼）。
- 视觉实现采用纯前端结构与 CSS 动效，不引入外部图片资源，不影响登录/注册链路。

## 前端配色口径（2026-04-23）

- 前端主题基线统一以 AntD token 为主，不再依赖历史 Radix 变量作为真实配色来源。
- `web/src/components/ui-antd.tsx` 的 `Theme` 内置 `ThemeCssVarsScope`：
  - 使用 `antdTheme.useToken()` 将历史变量（`--gray-*`、`--accent-*`、`--red-*`、`--green-*`、`--orange-*`、`--indigo-*`、`--color-panel-solid`、`--border`）映射到 AntD token。
  - 同步注入 `--ant-color-primary/bg-layout/border-secondary/text-secondary/text`，供页面直接使用。
- `web/src/app/globals.css` 保留上述变量的静态 fallback；运行时以 `ThemeCssVarsScope` 注入值为准。
- 后续页面改造优先级：
  1. 新页面优先直接使用 AntD 组件与 token（含 `--ant-color-*`）；
  2. 存量页面可保留历史变量写法，由映射层兜底，不做一次性大迁移。
- 主题色切换口径：
  - 全局主题色由 `ThemeAppearanceContext` 管理；
  - 通过 `useThemeAppearance()` 读写当前 `accentColor`；
  - 已在后台顶栏提供选择入口（`web/src/app/admin/layout.tsx`）；
  - 用户选择持久化到 `localStorage` 键 `fquiz:theme:accent-color`，刷新后保持。

## 前端路由展示口径（2026-04-23）

- 用户可见后台地址默认不再带 `/admin` 前缀（例如 `/users`、`/requirements`）。
- 兼容策略：
  - 无前缀地址通过前端中间层 rewrite 到现有 `app/admin/**` 页面实现；
  - 历史 `/admin/**` 地址继续可访问，并自动重定向到无前缀地址。
- 后台首页映射口径：`/admin` 对外统一为 `/users`。
- 菜单路径展示口径：前端渲染菜单时将后端返回的 `/admin/**` 路径规范化为无前缀地址，避免导航条继续暴露 `/admin`。

## 后台功能下线口径（2026-04-23）

- 已下线菜单编码：
  - `admin.life_countdown`
  - `admin.password`
  - `admin.token_usage`
  - `admin.history`
  - `admin.vocabulary`
  - `admin.diary`
  - `admin.homework`
  - `admin.question_bank`
- 下线策略：
  - 种子菜单与 admin 默认菜单绑定中移除上述编码；
  - 旧库授权链路通过 `legacy_authz_service.DISABLED_MENU_CODES` 过滤，确保历史菜单记录不再出现在 `/api/v1/admin/me/menus`；
  - 前端删除对应路由页面与首页卡片入口，直链不可达。
- 保留能力说明：
  - `admin.job_mgr`（作业监控）继续复用 `question_bank` API；
  - `question_bank` 与 `vocabulary` 相关底层 API 保留，用于已保留模块（如分组管理/知识点管理/单词统计）。

## 功能下线口径（2026-04-23）

- 后台以下功能已统一下线：
  - 微信小程序（`admin.wxapp`）
  - MD解析（`admin.mdresolve`）
  - 数据查询（`admin.data_query`）
  - 热搜（`admin.hot_search`）
  - 文件识别（`admin.filedetector`）
  - 百度网盘（`admin.baidu_pan`）
  - 分组管理（`admin.tag`）
  - 知识点管理（`admin.knowledge_point_mgr`）
- 下线语义为“三重约束”：
  1) 前端页面路由删除；
  2) 后端菜单树与权限推导过滤上述菜单码；
  3) 种子菜单与默认角色绑定中移除上述菜单码。
- 兼容口径：即使旧数据库仍有历史菜单记录，也会被后端过滤，不再下发到 `/api/v1/admin/me/menus`。
- 补充口径：历史别名页面 `/admin/tag` 已一并删除，避免“分组管理”通过旧路由绕过下线策略。

## 功能下线口径补充（2026-04-23）

- 以下后台功能已进一步下线：
  - 脚本管理（`admin.cron_task_mgr`）
  - 待办管理（`admin.todos`）
  - 作业监控（`admin.job_mgr`）
  - JWT 生成器（`admin.jwt_generator`）
- 下线语义：
  1) 前端页面路由删除（`/admin/cron`、`/admin/todos`、`/admin/job`、`/admin/jwt-generator`）；
  2) 后端菜单树和权限推导过滤上述菜单码；
  3) 种子菜单与 admin 默认菜单绑定移除上述菜单码；
  4) JWT 生成器路由从 `api_router` 取消挂载。
- 兼容口径：待办底层 API 继续保留给其他模块复用；菜单/页面是否暴露以后续下线口径为准。

## 功能下线口径补充（2026-04-24）

- 以下后台功能已进一步下线：
  - 单词统计（`admin.knowledge_mastery`）
  - 队列管理（`admin.queue_mgr`）
- 下线语义：
  1) 前端页面路由删除（`/admin/vocabulary-proficiency`、`/admin/knowledge-mastery`、`/admin/jobqueue`）；
  2) 后台首页入口卡片移除；
  3) 后端菜单种子与 admin 默认菜单绑定移除上述菜单码；
  4) 旧库菜单下发过滤集合新增上述菜单码，确保历史菜单残留不再透出。

## 管理员权限口径（2026-04-23）

- 默认将 `admin` 角色视为“全权限角色”。
- 后端口径：
  - `api/app/core/dependencies.py` 的 `require_permission/require_any_permission` 对 `admin` 角色直接放行。
- 前端口径：
  - `web/src/components/auth-provider.tsx` 的 `hasPermission` 对 `admin` 角色直接返回 `true`，避免因 `permission_codes` 枚举不全导致入口误隐藏。
- 安全边界：
  - 前端仅负责显隐与交互；最终权限判定以后端依赖校验为准。

## 首页与登录口径（2026-04-23）

- `/` 默认作为登录入口页，不再承载“已登录后停留的首页面板”。
- 登录态（含刷新会话恢复）进入 `/` 时，前端立即跳转 `/users`，实现“登录后直达后台”。
- 后台壳层文案对齐：
  - 未登录访问后台时提示“前往登录”（`/`）；
  - 账号菜单提供“用户管理”（`/users`）作为默认后台入口。
- 退出登录口径：统一跳转到登录页 `/`（不保留在当前后台路由）。

## 站点标题口径（2026-04-24）

- 全局浏览器 Tab 标题统一为“需求管理”。
- 入口配置位于 `web/src/app/layout.tsx` 的 `metadata.title`。

## 登录页视觉口径（2026-04-24）

- 登录页采用“双栏工作台”视觉基线：
  - 左侧为品牌与机器人主题视觉区；
  - 右侧为白色登录卡片（品牌头、表单、主操作按钮、辅助链接）。
- 交互口径保持：
  - 登录态进入 `/` 仍自动跳转 `/users`；
  - 登录/注册逻辑不变，视觉改造不改变鉴权接口契约。

## 后台账号入口口径（2026-04-23）

- 后台右上角账号入口采用 AntD `Avatar` 作为下拉触发器，不再使用“账号”文字按钮。
- Avatar 文案默认使用用户名首字母（大写），空值兜底 `U`。
- 下拉内容口径保持不变：账号信息 + 默认后台入口 + 退出登录。

## 后台左侧导航口径（2026-04-24）

- 后台壳层左侧导航采用“AntD 文档站点式”固定侧栏布局（参考 `https://ant.design/components/avatar-cn`）：
  - 桌面端（`md` 及以上）常驻显示；
  - 位于顶部栏下方（`top: 64px`），高度 `calc(100vh - 64px)`；
  - 菜单区可独立滚动，侧栏与主内容通过右边框分隔。
- 右上角不再提供“隐藏菜单”按钮；主布局不再依赖菜单显隐状态切换。

## 授权兼容口径（2026-04-24）

- `legacy_authz_service` 在读取 legacy 关系表失败时，必须对会话做安全回滚，再执行 modern 兜底查询，避免事务错误污染导致角色/权限误判为空。
- `legacy_authz_service._load_modern_roles` 需显式预热 `Role` mapper 后再解析 `User.roles`，避免首轮 mapper 解析异常被吞掉后出现“空权限”。
- 对 `user_id in {admin, administrator, root, sysadmin}` 且无角色映射的账号，授权链路提供内置 `admin` 兜底，确保本地/迁移期管理员账户可用。
- 当本地兼容库缺少 `user_role_rela` 且用户无显式角色映射时，授权链路可回退到 `user` 角色（前提是 `user` 角色存在），防止 `/api/v1/admin/me/menus` 返回空数组导致后台左侧菜单空白。

## 后台主题切换口径（2026-04-24）

- 后台右上角主题入口统一采用 Ant Design 文档站（`avatar-cn`）的“主题图标 + Dropdown 菜单”交互，不再使用简单 Select 模式切换。
- 主题文案口径固定为：`跟随系统 / 浅色主题 / 暗黑主题 / 紧凑主题 / 快乐工作特效 / AI 生成主题 / 主题编辑器`。
- 主题状态模型固定为“主模式 + 开关项”：
  - 主模式：`auto/light/dark`（互斥）
  - 开关项：`compact`、`happy-work`（独立开关）
- 持久化键口径：
  - `fquiz:theme:primary-mode`
  - `fquiz:theme:compact`
  - `fquiz:theme:happy-work`
  - 兼容保留：`fquiz:theme:mode`（legacy 四态映射）
- `AI 生成主题` 当前为交互与文案对齐态，未内置站内 AI 主题生成流程；“主题编辑器”默认跳转官方编辑器页。

## 登录页文案口径（2026-04-24）

- 登录页（`web/src/app/page.tsx`）默认展示文案统一为中文，不再保留英文提示文案。

## 前端编译口径（2026-04-24）

- 在当前栈（Next.js 16 + React 19 + Ant Design 5）下，页面层直接使用 `antd` 的 `Card` / `Image` 容易触发 JSX 类型不兼容报错（`TS2604/TS2786`）。
- 项目口径：页面层优先使用 `@/components/ui-antd` 提供的 `Card` 封装；Mermaid 预览改用原生 `<img>`。
- 当前 `web/tsconfig.json` 已显式设置 `noImplicitAny=false` 以保证存量页面可编译；若后续要恢复更严格类型检查，需要分批补齐事件/回调参数类型。

## 菜单删除兼容口径（2026-04-24）

- `legacy_admin_rbac_service` 中涉及 legacy 关系表 `user_role_rela` 的查询（如 `_get_users_with_menu_access`、`_get_role_user_ids`）必须按“缺表可降级”策略实现：
  - 捕获 `SQLAlchemyError`；
  - 执行 `db.rollback()` 清理失败事务；
  - 返回空集合兜底，避免向上冒泡为 500。
- 背景约束：当前本地兼容库可能不存在 `user_role_rela`（仅保留 `user_role` / `role_menu_rela`），菜单删除链路需在该条件下可用。

## 认证时效口径（2026-04-24）

- API `access token` 默认有效期已调整为 `8 小时`（`ACCESS_TOKEN_EXPIRE_MINUTES=480`）。
- `refresh token`（Refresh Session）默认有效期保持 `30 天`（`REFRESH_TOKEN_EXPIRE_DAYS=30`）不变。

## 发布执行口径（2026-04-25）

- 本项目本地发布更新容器的标准链路保持为：
  - `docker compose --env-file deploy/dev-deploy/.env -f deploy/dev-deploy/compose.yml build`
  - `docker compose --env-file deploy/dev-deploy/.env -f deploy/dev-deploy/compose.yml up -d`
- 发布后至少执行以下验收：
  - `docker compose --env-file deploy/dev-deploy/.env -f deploy/dev-deploy/compose.yml ps`（容器状态/健康）
  - `curl -fsS http://127.0.0.1:8000/health`（API 健康）
  - `curl -I -fsS http://127.0.0.1:3000/`（前端可达）
- 2026-04-25 二次重发验证通过：按上述链路重跑后，`api/web/db` 均可正常拉起并通过健康检查。

## 前端 API 基址解析口径（2026-04-25）

- 当 `NEXT_PUBLIC_API_BASE_URL` 指向 loopback（`localhost/127.0.0.1/::1`）时，前端运行时应保证 API host 与当前页面 host 对齐。
- 只要“配置 host 是 loopback 且与 `window.location.hostname` 不一致”，就自动重写为当前页面 host，并保留配置端口（默认 `8000`）。
- 目的：避免 `localhost` 与 `127.0.0.1` 混用导致 refresh cookie 跨站语义，从而在后台路由硬刷新时误判未登录。

## 仪表盘下线口径（2026-05-02）

- 后台“仪表盘”页面已下线，不再作为可访问菜单和默认首页。
- 前端路由口径：
  - `/admin`、`/dashboard` 统一重定向到 `/users`；
  - 登录态进入 `/` 默认跳转到 `/users`；
  - `web/src/app/admin/page.tsx` 改为重定向页，不再渲染卡片工作台。
- 后端菜单口径：
  - `seed_service.DEFAULT_MENUS` 删除 `dashboard`；
  - `ROLE_MENU_BINDINGS` 删除 admin/user 对 `dashboard` 的绑定；
  - `legacy_authz_service`、`legacy_admin_rbac_service`、`admin_service` 对 `dashboard` 统一加入下线过滤集合，屏蔽历史库残留菜单记录。

## 后台顶部滚动口径（2026-04-25）

- 固定对象是“最顶部导航栏”（包含主题切换与用户 Avatar 下拉），而非主内容区标题栏。
- 实现基线（`web/src/app/admin/layout.tsx`）：
  - 顶部导航栏使用 `sticky top-0 z-50`，随页面滚动始终保持可见；
  - 主内容区“后台管理标题 + 用户邮箱”保持普通流布局，不做 sticky 固定。

## 后台外层边距口径（2026-04-25）

- 左侧导航需贴近页面左边界；后台主栅格外层容器在 `md` 及以上不保留左侧 padding（`pl-0`）。
- 右侧留白继续保持响应式（`pr-3 sm:pr-4 xl:pr-6`），避免内容区贴右边导致拥挤。

## 后台页面头信息口径（2026-04-25）

- `web/src/app/admin/layout.tsx` 不再渲染主内容区通用头块（“后台管理”标题 + 当前用户名/邮箱）。
- 用户信息与主题切换仅保留在最顶部导航栏（Avatar 下拉 + 主题按钮），避免每个页面重复展示相同信息。

## 前端鉴权刷新并发口径（2026-04-25）

- `web/src/components/auth-provider.tsx` 中 `refreshAccessToken()` 必须做并发去重（single-flight）；同一时刻只能存在一个 `/api/v1/auth/refresh` 请求。
- 原因：后端 refresh 采用“旋转 refresh token”策略，并发刷新会导致后发请求命中旧 token 并把前面成功状态覆盖为未登录，表现为“刷新页面后被踢回登录提示”。
- 约束：后续任何调用链（bootstrap、`fetchWithAuth` 401 重试、页面并发请求）都必须复用同一个 in-flight refresh Promise，避免重复发起 refresh。

## 线路与杆塔管理口径（2026-04-25）

- 输电线路管理模块采用两张主表：
  - `power_line`（线路）
  - `power_line_tower`（杆塔，`line_id` 外键关联线路）
- 关系口径：`Line 1:N LineTower`，并约束：
  - `uq_power_line_tower_line_seq`（同线路内序号唯一）
  - `uq_power_line_tower_line_tower_no`（同线路内塔号唯一）
- 导入口径：
  - 使用 `POST /api/v1/lines/{line_id}/towers/import` 导入 CSV；
  - 兼容 UTF-8/UTF-8-SIG/GBK；
  - 对源数据 `-1` 作为无效值归一化为 `NULL`；
  - 超出表头的额外列写入 `raw_extra_json`，避免导入因列漂移失败。
- 导出口径：
  - 使用 `GET /api/v1/lines/{line_id}/towers/export` 导出 CSV；
  - 导出包含线路基础信息、杆塔核心字段与 JSON 扩展字段。
- 权限口径：
  - 新增 `line.read` / `line.manage` / `tower.read` / `tower.manage`；
  - admin 默认授予上述权限。
- 菜单口径：
  - 新增菜单 `admin.power_lines`，路由 `/admin/power-lines`；
  - 页面由 `web/src/app/admin/power-lines/page.tsx` 承载线路与杆塔管理闭环。

## 线路地图展示口径（2026-04-25）

- 线路地图（含 Cesium）可直接复用现有杆塔数据底座：
  - `power_line_tower` 的 `longitude/latitude/altitude_m` + `seq_no` 作为线路几何主数据；
  - 几何拼接顺序与展示顺序统一按 `seq_no ASC`。
- 若线路杆塔数量可能超过 500，前端地图加载不得复用当前页面固定 `limit=500` 的请求口径；需要补全分页拉取或增加专用几何接口。
- 坐标系必须显式约定并在导入/展示链路保持一致（建议默认 WGS84）；未标注坐标系的数据源不应直接进入生产地图渲染。

## 线路 Cesium MVP 口径（2026-04-25）

- 前端线路管理页（`/admin/power-lines`）已支持“表格/地图”双视图切换，地图视图使用 Cesium 渲染：
  - 杆塔点位：`longitude/latitude/altitude_m`
  - 线路折线：按 `seq_no ASC` 连线
- Cesium 静态资源采用构建前同步策略：
  - `web/scripts/sync-cesium-assets.mjs` 在 `postinstall` 与 `prebuild` 执行；
  - 同步目录固定为 `web/public/cesium/{Assets,ThirdParty,Workers,Widgets}`。
- 工程约束：
  - `web/public/cesium` 属于构建生成资产，不纳入 Git 版本管理（由 `.gitignore` 忽略）。

## 线路走向图专题口径（2026-04-26）

- `线路管理` 页面地图视图已升级为“走向图”专题视图（保留表格/走向图双视图切换）。
- 走向图默认关闭通用底图能力（Cesium `baseLayer: false`），仅突出线路业务语义：
  - 按杆塔 `seq_no` 连线展示线路走向；
  - 展示杆塔点位、起点/终点标识；
  - 支持按风险着色、塔号显隐、居中重置。
- 走向图统计信息固定包含：有效坐标、缺失坐标、断点段数、线路估算长度（Haversine）。
- 对序号断档采用分段折线渲染，避免缺失坐标导致的跨段误连线。

## 雷电流数据管理口径（2026-04-25）

- 雷电流模块一期后端入口统一在 `/api/v1/lightning-currents`，权限码为：
  - `lightning.read`：查看事件、采样与统计。
  - `lightning.manage`：导入、更新、删除事件。
- 一期数据模型采用“双表”结构：
  - `lightning_current_event`：事件元数据 + 特征参数（峰值、T1/T2、陡度、I²t、波形分类、极性、多回击统计）。
  - `lightning_current_sample`：采样时序点（`seq_no/time_us/current_ka`）。
- 原始序列导入支持单列电流或双列 `time,current`，并在导入时自动提取特征。
- 峰值超越概率（P 曲线）通过 `/api/v1/lightning-currents/stats/exceedance` 提供，便于地区雷电流分布统计。
- 前端后台入口固定为 `/admin/lightning-currents`，菜单编码 `admin.lightning_currents`。
- 雷电流后台模块对外展示名称已调整为“雷电幅值统计”；保留现有路由 `/admin/lightning-currents` 与菜单编码 `admin.lightning_currents` 不变（2026-04-25）。

## 文件管理下线口径（2026-04-25）

- 文件管理能力已下线：
  - 前端不再提供 `/admin/files` 与 `/admin/knowledge-set` 页面；
  - 后端不再暴露 `/api/v1/admin/files*` 相关接口；
  - 默认权限中不再包含 `file.read` / `file.manage`；
  - 默认菜单与 admin 角色菜单绑定中不再包含 `admin.files`。
- 为避免对存量数据库做破坏性变更，本次仅下线功能入口与执行链路，不主动删除既有 `file_storage_*` 表结构。

## 文件管理迁移口径（2026-04-25）

- 口径更新：同日已按“参考 `modo-next` 文件管理能力”重新迁移并恢复本项目文件管理功能，当前状态以本节为准。
- 后端入口：
  - 文件管理 API 恢复到 `/api/v1/admin/files*`；
  - 保留 VFS/S3 存储抽象（`storage_driver`）与挂载点机制（`file_storage_backends` / `file_storage_mounts` / `file_index_entries`）。
- 权限与菜单：
  - 默认权限恢复 `file.read` / `file.manage`；
  - 默认菜单与 admin 绑定恢复 `admin.files`（`/admin/knowledge-set`）。
- 迁移增强：
  - 新增目录打包下载接口 `GET /api/v1/admin/files/download-zip`，支持按目录递归生成 zip 下载。

## 前端 chunk 失配容错口径（2026-04-25）

- Next.js 前端需内置 `chunk load` 失配恢复能力：当出现 `Loading chunk ... failed` / `ChunkLoadError` / 动态 import 失败时，自动执行“一次性刷新”尝试恢复。
- 实现基线：
  - `web/src/lib/chunk-error.ts`：统一错误识别与单次刷新标记。
  - `web/src/components/chunk-load-recovery.tsx`：全局监听 `window error` 与 `unhandledrejection`。
  - `web/src/app/error.tsx` 与 `web/src/app/global-error.tsx`：提供可见兜底与手动恢复入口。
- 组件级异步加载（例如 `import("cesium")`）若在局部 `try/catch` 中吞掉异常，需在 `catch` 内显式调用 `reloadOnceOnChunkError(error)`，否则全局监听无法感知并触发恢复。
- 刷新标记口径：
  - 不在应用挂载时主动清理标记；
  - 采用带时间戳的冷却窗口（当前 2 分钟）限制自动刷新频率，避免 chunk 持续不可用时陷入无限刷新。
- 目标：降低发布后或本地重编译后因旧缓存 chunk 引发的白屏概率，避免用户停留在不可恢复状态。

## Modal 定位口径（2026-04-25）

- 不要在 `body`（或其祖先）上使用 `filter/transform/perspective` 做全局动效；这会改变 `position: fixed` 的定位参照，导致 AntD `Modal` 在页面滚动后出现顶部遮挡或错位。
- `快乐工作特效` 已调整为背景色轻微脉冲（`background-color` 动画），避免影响弹窗定位。

## 雷电分布统计口径（2026-04-25）

- 雷电分布数据导入入口：
  - `POST /api/v1/lightning-currents/import-distribution`
  - 输入：TXT/CSV（纬度、经度、电流幅值）
  - 清洗规则：非法行/非法坐标跳过；按批次写入 `lightning_current_event`。

- 空间统计主接口：
  - `GET /api/v1/lightning-currents/stats/distribution`
  - 输出：
    - 网格化地闪密度 `Ng`（次/km²·年）
    - 网格 `Imax/Iavg`
    - 极性占比
    - 散点数据（地图展示）
    - P 曲线阈值超越点

- 资产关联接口：
  - `GET /api/v1/lightning-currents/stats/tower-buffer`
  - 输入：`tower_id` 或中心坐标 + `radius_km` + `design_current_ka`
  - 输出：缓冲区雷击统计、超设计阈值次数、风险等级（`LOW/MEDIUM/HIGH`）与建议文本。

- 合成对比接口：
  - `GET /api/v1/lightning-currents/stats/compare-synthetic`
  - 输出：实测/合成统计与网格余弦相似度（用于验证合成分布接近度）。

- 周期报表接口：
  - `GET /api/v1/lightning-currents/reports/distribution?period=week|month`
  - 输出：近 7/30 天雷击次数、Imax/Iavg、Ng、最严重事件。

- 前端页面口径：
  - 独立菜单入口为 `admin.lightning_distribution` -> `/admin/lightning-distribution`，对外展示名“雷电分布统计”。
  - `/admin/lightning-distribution` 复用雷电工作台底座，但只展示分布统计相关能力：筛选、导入、网格热力、散点地图、杆塔缓冲区、实测/合成对比与周/月报。
  - `/admin/lightning-currents` 保留为“雷电幅值统计”，用于原始雷电流序列导入、事件列表、特征参数与采样预览。
  - 地图组件：`web/src/components/lightning-distribution-map.tsx`（Cesium）。

## 文件管理 MinIO 接入口径（2026-04-25）

- `deploy/dev-deploy/compose.yml` 与 `deploy/pro-deploy/compose.yml` 均包含 `minio` 与 `minio-init` 服务：
  - `minio` 提供 S3 兼容对象存储（`9000` API，`9001` Console）。
  - `minio-init` 使用 `minio/mc` 自动创建 `MINIO_BUCKET`，避免首用报 `NoSuchBucket`。
- `api` 服务通过环境变量接入 MinIO：
  - `MINIO_ENABLED`
  - `MINIO_ENDPOINT`
  - `MINIO_ACCESS_KEY`
  - `MINIO_SECRET_KEY`
  - `MINIO_BUCKET`
  - `MINIO_REGION`
- 文件存储 seed 口径更新：
  - `MINIO_ENABLED=true` 时，默认后端切换到 `files.s3.default`，并将 `main` 挂载绑定到 S3。
  - `MINIO_ENABLED=false` 时，默认回退到 `files.vfs.default`。
  - 对已存在的默认后端记录执行幂等更新（`status/is_default/config_json`），确保切换配置重启即可生效。

## 用户管理新增表单交互口径（2026-04-25）

- `web/src/app/admin/users/page.tsx` 的“新增用户”交互基线为 **Modal 弹窗表单**，不再采用页面内联大表单。
- 表单字段与校验规则保持不变（`user_id/email/username/password`），仅变更承载方式。
- 创建成功后默认行为：
  - 关闭新增用户弹窗；
  - 重置表单；
  - 刷新用户/角色列表。

## 后台 Ant Design 规范化口径（2026-04-25）

- 后台 UI 以 Ant Design 规范为优先口径，不再追求“贴边/全直角”的扁平化视觉。
- 根主题基线：
  - `web/src/components/ui-antd.tsx` 的 `Theme` 使用 `ConfigProvider + App`，并接入 `zh_CN` locale。
  - 默认强调色为 AntD 蓝色体系（`blue/#1677ff`）。
  - 默认圆角采用 AntD 常规 token：`medium=6`、`large=8`。
  - 主题样式优先走 AntD global token / component token，再通过项目自有 CSS 变量桥接给历史页面；禁止新增宽泛 `.ant-*` 全局覆盖。
- 后台布局基线：
  - `web/src/app/admin/layout.tsx` 使用 AntD `Layout/Header/Sider/Content`。
  - Header 高度固定 64px；桌面端使用可折叠 Sider；移动端使用 Drawer 菜单。
  - 内容区恢复 AntD 工作台留白：桌面 24px，移动 16px。
  - 页面顶部统一展示 Breadcrumb + 页面标题 + 描述，作为后台页面信息架构入口。
- 核心页面交互基线：
  - 工作台使用 AntD `Statistic + Row/Col/Card/Tag/Avatar` 的模块入口模式。
  - 角色管理使用 AntD `Card/Table/Form/Modal/Select/Input`，权限点和菜单绑定使用 `Select mode="multiple"`。
  - 行内操作优先使用 `web/src/components/row-action-menu.tsx`，内部已切换为 AntD `Dropdown + Button`。
- 验证口径：
  - UI 改造至少跑 `npm --workspace web exec tsc --noEmit --pretty false` 与 `npm run build:web`。
  - 全量 `npm --workspace web run lint` 当前会被 `web/public/cesium` 生成资产和历史页面问题阻断；改动文件需至少跑 targeted eslint。

## 角色管理搜索口径（2026-04-25）

- `web/src/app/admin/roles/page.tsx` 已支持前端本地搜索，匹配字段为：角色编码、角色名称、权限编码、菜单名称/编码。
- 当前实现不依赖后端关键词参数；若后续角色规模显著增长，再评估升级为接口级搜索。

## 后端 Celery 调度口径（2026-04-25）

- 后端调度基线采用 `Redis + Celery worker + Celery Beat`：
  - Redis broker：默认 `redis://redis:6379/0`。
  - Redis result backend：默认 `redis://redis:6379/1`。
  - Worker 服务：`celery-worker`。
  - Beat 服务：`celery-beat`。
- Celery 应保持独立进程运行，FastAPI `api` 进程只承载 HTTP/WebSocket，不在 lifespan 内启动调度循环。
- 当前首个周期任务为 `app.tasks.schedule_tasks.expire_overdue_schedule_items`，由 Beat 按 `SCHEDULER_EXPIRE_INTERVAL_SECONDS`（默认 60 秒）投递，用于过期 `calendar_event` 与 `todo`。
- 新增周期任务优先放在 `api/app/tasks/`，业务逻辑继续沉淀到 `api/app/services/`，避免 Celery task 直接堆业务细节。

## 任务监控口径（2026-04-25）

- 任务监控统一入口：`/admin/task-monitor`（菜单码：`admin.task_monitor`）。
- 后端聚合接口：`GET /api/v1/admin/task-monitor/overview`（`/api/v1/admin/task-monitor` 前缀）。
- 监控口径：
  - 需求：统计状态/优先级分布，输出高优先级与滞留需求（按 `update_date` + 阈值小时判定）。
  - 待办：统计状态/优先级分布，输出超期待办（`due_date/expire_time` 触发）。
- 权限分层：接口按 `requirement.*` 与 `todo.*` 权限分别返回对应数据块，避免越权暴露。
- 菜单保护：`admin.task_monitor` 已纳入前后端受保护菜单集合，避免在菜单管理中误删。

## 文件管理单挂载 UI 口径（2026-04-26）

- `web/src/app/admin/files/page.tsx` 默认按“单挂载”交互：不再展示左侧挂载点列表，不提供前端挂载点切换。
- 当前挂载上下文统一以接口返回的 `current_mount` 为准；文件操作仍透传 `mount_code`，保持与后端接口契约一致。
- 后端仍保留多挂载点模型能力（`file_storage_mounts`），本次仅收敛前端交互层。

## 文件管理删除交互口径（2026-05-03）

- `web/src/app/admin/files/page.tsx` 删除确认弹窗统一使用 `App.useApp().modal.confirm`，避免 `Modal.confirm` 静态方法在 React 19 + Antd 5 组合下出现“点击删除无响应”问题。

## 任务监控口径更新（2026-04-26）

- `/admin/task-monitor` 与 `GET /api/v1/admin/task-monitor/overview` 已收口为 **Celery 运行态监控**，不再承载需求/待办风险聚合。
- 接口查询参数：
  - `task_limit`：返回任务明细上限。
  - `history_limit`：历史任务扫描上限（Redis result backend）。
- 数据来源口径：
  - 队列积压（`pending_count`）在 Redis broker 下按队列 `LLEN` 读取，非 Redis broker 回退为 `0`。
  - 历史任务状态（`SUCCESS/FAILURE/RETRY/REVOKED`）在 Redis result backend 下通过 `SCAN celery-task-meta-*` 采样聚合。
- 接口与页面权限统一为：`celery.read` 或 `celery.manage`。
- 前端展示结构固定为三块：
  - Worker 概览（在线状态、并发、预取、活跃/预留/定时任务数）
  - Queue 概览（pending、consumer、active/reserved/scheduled）
  - Task 明细（状态、队列、worker、ETA/开始/完成、错误摘要）

## 后台页面顶部信息口径（2026-04-26）

- 后台壳层 `web/src/app/admin/layout.tsx` 不再渲染内容区顶部公共信息块（Breadcrumb + 页面标题 + 页面描述）。
- 后台页面默认直接进入业务内容区，避免在每个页面重复展示“模块标题 + 描述文案”。

## ATP 模型管理口径（2026-04-26）

- ATP 功能一期定位为“ATPDraw 产物版本管理 + ATP 引擎调用”：
  - 模型台账：`atp_model`
  - 版本管理：`atp_model_version`
  - 运行记录：`atp_simulation_run`
- 后端 API 统一前缀：`/api/v1/atp/models`，包含：
  - 引擎状态：`GET /engine/status`
  - 模型 CRUD：`GET/POST/PATCH/DELETE /`
  - 版本管理：`GET/POST/PATCH /{model_id}/versions*` + `POST /activate`
  - 运行管理：`GET/POST /{model_id}/runs*`
- 权限口径：
  - `atp.read`：查看模型/版本/运行
  - `atp.manage`：维护模型与版本、激活版本
  - `atp.run`：执行仿真
- 菜单口径：
  - 新增 `admin.atp_models`，路由 `/admin/power-lines/atp-viewer`，默认绑定 admin 角色。
- 推送订阅口径：
  - 主题 `admin.atp-models`（权限 `atp.read/atp.run/atp.manage`）。
- 配置口径：
  - `atp_engine_mode`：`wine|native`
  - `atp_engine_executable`
  - `atp_storage_root`
  - `atp_engine_workdir`
  - `atp_engine_default_timeout_seconds`
  - `atp_engine_max_timeout_seconds`

## 功能下线口径（2026-04-26）

- 以下后台功能已下线，不再作为有效入口、默认菜单、默认权限或公开 API 提供：
  - AI 聊天：`/admin/chat`、`/api/v1/chat*`、`chat.use`
  - 编排管理：`/admin/orchestration`
  - MCP管理：`/admin/mcp-server`
  - 模型管理/API测试：`/admin/models`、`/admin/api-tester`、`/api/v1/admin/models*`、`/api/v1/admin/model-routes*`、`model.read/model.manage`
  - 知识集/文件管理：`/admin/knowledge-set`、`/admin/files`、`/api/v1/admin/files*`、`file.read/file.manage`
  - 流程图：`/admin/mermaid-mgr`、`/api/v1/mermaids*`、legacy `/api/mermaids*`
  - 思维导图：`/admin/mindmap`、`/api/v1/mindmap*`
  - 需求管理：`/admin/requirements`、`/api/v1/requirements*`、`/api/project/requirement*`、`requirement.*`
  - 日程管理：`/admin/schedule`、`/api/v1/calendar*`、`/api/v1/todos*`、`todo.*`
- `admin.agent/admin.mcp_server/admin.files/admin.requirements/admin.schedule/admin.mindmap/admin.mermaid_mgr/admin.chat/admin.api_tester/admin.models/admin.orchestration` 仅保留在 removed/disabled 过滤集合中，用于屏蔽历史菜单数据。
- 本次不执行数据库 drop；历史表若已存在，作为历史数据保留。模型注册表/路由表仍保留给内部 LLM 网关和寿命倒计时等内部能力使用，但无后台管理页面/API。
- `/admin/task-monitor` 已独立为 Celery Worker/Queue/Task 监控，不再读取需求/待办数据。

## 文件管理恢复口径（2026-04-26）

- 文件管理模块恢复路径：
  - 前端页面：`/admin/files`（后台首页卡片入口 `/files`）。
  - 后端接口：`/api/v1/admin/files` 及其 `directories/delete/rename/move/upload/download/download-zip` 子接口。
- 权限口径：`file.read`（读）与 `file.manage`（写操作）。
- 订阅口径：`admin.files` topic 已恢复，文件操作后触发前端刷新。
- 模型与 seed：`file_storage_backends` / `file_storage_mounts` / `file_index_entries` 已恢复注册；默认 seed 会创建 `files.vfs.default`、`files.s3.default` 与 `main` 挂载。
- 交互口径：页面保持“单挂载点”模式，不展示左侧挂载点切换面板。

## ATP 查看器口径（2026-04-26）

- ATP 文本查看能力已落地在线路模块子路由：`/power-lines/atp-viewer`（内部路由 `web/src/app/admin/power-lines/atp-viewer/page.tsx`）。
- 技术栈固定为“前端本地解析 + 前端只读渲染”：
  - 解析：`web/src/lib/atp/parse-atp-text.ts`
  - 渲染：`@maxgraph/core` + `web/src/components/atp-maxgraph-viewer.tsx`
- 当前目标是“查看保真优先”，明确不包含仿真内核调用。
- 解析覆盖常见元件行格式，复杂 ATP 控制卡/模型卡默认容错跳过并输出 warnings，不阻断基础图形查看。

## 雷电地形倾角口径（2026-04-26）

- 地面倾角计算接口固定为：
  - `POST /api/v1/lightning-currents/stats/tower-terrain`
- 入参口径：
  - `dem_grid_m` 必须为 3x3 高程矩阵（中心点 + 邻域 8 点）。
  - `cell_size_m` 为 DEM 栅格间距（米）。
  - `dem_resolution_m` 可单独传入用于质量评分（不传时默认等于 `cell_size_m`）。
- 算法口径：
  - 梯度：Horn 3x3（`algorithm_version=horn_3x3.v1`）。
  - 输出：`slope_deg`、`aspect_deg`、`slope_mean/p95/max`、`slope_along/cross_line_deg`、`relief_m_50`、`terrain_exposure_index`、`quality_score/level`。
  - 坡向定义为“顺坡向（下坡方向）方位角”，0-360°，顺时针（0=北，90=东）。
- 持久化口径：
  - `persist=true` 时要求 `tower_id`，且调用方需具备 `tower.manage` 或 `lightning.manage`（admin 放行）。
  - 持久化位置：`power_line_tower.raw_extra_json.terrain_metrics`，并同步更新 `slope_1/slope_2`（纵坡/横坡绝对值）。
- 缓冲区分析联动：
  - `GET /api/v1/lightning-currents/stats/tower-buffer` 返回 `terrain_metrics`（若杆塔已有地形指标）。
  - 风险分级引入地形暴露权重：`ng_for_risk = ng * (1 + 0.25 * exposure)`，但原始返回字段 `ng_per_km2_year` 保持未加权值。

## users 主键兼容口径（2026-05-01）

- 用户主键列工程约定仍为 `users.user_id`。
- 为兼容历史库（残留 `users.id`）并避免启动 seed 阶段出现 `UndefinedColumn: users.user_id`，`init_db()` 在 PostgreSQL 下新增启动期兼容逻辑：
  - 若检测到 `users` 表存在且仅有 `id`、缺少 `user_id`，自动执行 `ALTER TABLE users RENAME COLUMN id TO user_id`，再继续 `create_all/seed`。
- 对已对齐 `users.user_id` 的库，该逻辑不产生任何改动。

## users 审计列兼容口径（2026-05-01）

- 用户审计字段工程约定为 `users.create_user`、`users.update_user`。
- 为兼容历史库并避免启动 seed 阶段出现 `UndefinedColumn: users.create_user/update_user`，`init_db()` 在 PostgreSQL 下新增启动期兼容逻辑：
  - 若存在 `create_by/created_by`，自动重命名为 `create_user`。
  - 若存在 `update_by/updated_by`，自动重命名为 `update_user`。
  - 若目标列仍缺失，自动补齐 nullable 列：`create_user VARCHAR(64)`、`update_user VARCHAR(64)`。
- 对已对齐审计字段的库，该逻辑不产生任何改动。

## GitHub Actions 发布分支口径（2026-05-01）

- `.github/workflows/main.yml` 的自动发布触发分支已切换为 `dev`：
  - `on.push.branches: [dev]`
  - `deploy.if: github.ref == 'refs/heads/dev'`
- `main` 分支默认不再触发该部署 workflow。

## legacy 角色查询兼容口径（2026-05-01）

- `/api/v1/admin/roles` 当前入口仍走 `legacy_admin_rbac_service`，但数据库形态可能是 legacy（`user_role/role_menu_rela/menu`）或 modern（`roles/role_menus/menus`）。
- 角色读取链路兼容策略：
  - 当 `public.user_role` 存在：继续走 legacy 表链路。
  - 当 `public.user_role` 缺失：自动回退到 modern 表链路，并补齐 `role_permissions + permissions` 权限码。
- 该兼容仅针对角色读取相关接口（`list_roles/get_role_by_id/list_role_menu_ids`）；角色写入链路暂仍以 legacy 表为准。

## 用户管理检索与分页口径（2026-05-01）

- 用户管理列表接口 `GET /api/v1/users` 支持查询参数：
  - `limit` / `offset`：分页
  - `keyword`：按 `user_id/email/username` 模糊检索
  - `status`：状态过滤（`active|enabled|disabled`）
- 后端统计口径要求：`total` 必须与当前检索/过滤条件一致（不是全量总数）。
- 前端 `/admin/users` 采用“检索条件 + 分页状态”驱动请求，不再固定拉取 `limit=200` 全量列表。

## 用户管理编辑口径（2026-05-01）

- 用户信息更新接口 `PATCH /api/v1/users/{user_id}` 当前支持：
  - `email`
  - `username`
  - `status`
- 更新规则：
  - `email` 入库前统一 `trim + lower`，且做唯一性校验；
  - `username` 入库前统一 `trim`，且做唯一性校验；
  - 空字符串视为非法更新（返回失败）。

## 线路管理塔杆分页口径（2026-05-01）

- `web/src/app/admin/power-lines/page.tsx` 的“塔杆列表”默认启用服务端分页：
  - 默认每页 20 条；
  - 请求参数按 `limit/offset` 驱动；
  - 总数以接口返回 `total` 为准。
- 筛选条件（关键词/塔型/风险等级）或线路切换时，分页需自动回到第 1 页，避免落在无数据页。
- 地图视图保留大页查询（当前 500 条）用于展示线路点位，不与表格分页参数共用同一页码。

## 角色/菜单配置口径（2026-05-01）

- 角色管理页面（`/admin/roles`）当前仅提供角色基础信息与“可见菜单”配置，不再提供权限点（`permission_codes`）配置入口。
- 菜单管理页面（`/admin/menus`）当前不再提供菜单权限码（`permission_code`）配置入口与列表展示。
- 后端权限字段与接口兼容能力保留，作为历史数据与鉴权映射兜底；前端交互层默认不暴露该配置。

## 文件管理上传进度口径（2026-05-02）

- 文件管理页（`/admin/files`）上传链路已从 `fetch` 切换为 `XMLHttpRequest`，用于获取浏览器原生上传进度事件并展示百分比。
- 上传进度展示基线：
  - 上传进行中显示文件名、百分比数值与进度条；
  - 上传成功后清空进度状态；
  - 上传失败时进度归零并沿用现有错误提示通道。
- 鉴权口径：
  - XHR 上传沿用 `withCredentials + Authorization: Bearer <token>`；
  - 401 时触发一次 `refreshAccessToken` 并重试上传，保持与现有鉴权刷新机制一致。
- AuthContext 对外新增 `getAccessToken()`，用于在异步重试场景读取最新 token，避免闭包持有旧值。
