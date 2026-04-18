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
- 宿主机 DB 暴露端口统一走 `POSTGRES_PORT`（默认 `5433`），用于规避与宿主机已有 PostgreSQL（常见 `5432`）冲突；容器内连接仍保持 `db:5432`。
- CORS 来源控制采用“双轨配置”：`API_CORS_ORIGINS`（精确列表）+ `API_CORS_ORIGIN_REGEX`（正则，可选）；`API_CORS_ORIGINS` 支持 `*` 和通配符域名并在后端转换为 `allow_origin_regex`。
- GitHub Actions 使用 `appleboy/ssh-action` 部署时，慢网环境需显式设置 `command_timeout`（建议 `45m`）并为 `docker compose pull` 增加重试，避免出现 `Run Command Timeout` 直接中断发布。
- `docker compose up -d` 不会重建 `build` 类型服务镜像；本项目 `web` 无源码挂载且运行 Next.js 生产构建产物，前端代码变更后需执行 `docker compose up --build -d web`（必要时先 `docker compose build --no-cache web`）。
- `api` 构建若在拉取 `docker.m.daocloud.io/library/python:3.11-slim` 时出现 manifest `EOF`，优先重试 `docker compose build api`；若持续失败，可在 `.env` 覆盖 `PYTHON_BASE_IMAGE=python:3.11-slim` 走 Docker Hub 兜底。

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

## AI 聊天口径（2026-04-13）

- 一期聊天入口固定为后台路由 `/admin/chat`，权限码为 `chat.use`。
- 聊天模型选择规则固定为：`CAPABILITY: chat.default` 优先，未命中时回退 `GLOBAL: __global__`。
- 仅允许 `ENABLED` 且具备激活密钥记录的模型参与路由命中；若不满足，接口返回 400。
- 运行时真实 Provider Key 不从数据库反解，统一从环境变量 `LLM_PROVIDER_API_KEYS` 注入（支持 `openai=sk-...` 或 JSON 字典字符串）。
- 一期模型调用采用非流式 OpenAI-compatible `POST /chat/completions`，后续如需流式再扩展 SSE/WS。

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

- `日程管理` 菜单迁移采用最小改动策略：新增菜单 `admin.schedule`（`/admin/schedule`，权限 `todo.read`），并直接复用 `todos` 页面能力作为日程管理承载。
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
- `流程图` 菜单迁移沿用 MD 解析能力：新增菜单编码 `admin.mermaid_mgr`（`/admin/mermaid-mgr`，权限 `question_bank.read`），由 `web/src/app/admin/mermaid-mgr/page.tsx` 复用 `mdresolve` 页面承载 Markdown 解析与批量导入能力；并已加入后端与前端受保护菜单集合、admin 默认菜单绑定与后台首页入口。
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
- `提示词管理` 菜单迁移沿用系统消息能力：保留菜单编码 `admin.system_message` 与权限 `system_message.read/system_message.manage`，菜单文案统一为“提示词管理”，默认路由迁移为 `/admin/prompt`，并由 `web/src/app/admin/prompt/page.tsx` 复用 `system-message` 页面承载提示词内容、等级、有效期与发布状态维护能力。
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
