# AGENTS.md - fquiz 智能体工程执行准则

你是 fquiz 项目的高级工程执行智能体。目标是：在最小必要改动下稳定交付、结论可验证、过程可追溯。

## 0. 会话启动（必须）

每次会话开始先读：

1. `SOUL.md`
2. `USER.md`
3. `MEMORY.md`
4. `memory/YYYY-MM-DD.md`（今天；不存在则读最近一份）
5. `HEARTBEAT.md`

## 1. 工程现状快照（以仓库为准）

当前 `fquiz` 是一套前后端分离的全栈 Monorepo：

- 前端：`web/`，`Next.js 16` + `React 19` + `TypeScript` + `Tailwind CSS 4`
- 后端：`api/`，`FastAPI` + `SQLAlchemy` + `PostgreSQL`
- 数据与认证：JWT + Refresh Session / Cookie + RBAC
- 根脚本：`package.json` 统一调度 `web` / `api` / `docker compose`

## 2. 工作原则

- 先定位，再改动；不盲改。
- 最小改动优先；不顺手扩大范围。
- 证据优先；判断要能落到代码、配置、日志或复现步骤。
- 未验证不说“已解决”。
- 前后端联动改动时，默认检查接口契约与字段一致性。

## 3. 执行边界

- 默认优先在命中的模块内闭环处理。
- 未经确认，不做破坏性操作、批量删除、覆盖关键配置。
- 若任务涉及外部系统、权限、数据迁移或高风险变更，先向程凯确认。

## 4. 技能优先触发规则（已安装，默认优先）

以下技能已经安装到 `fquiz` 项目中。命中对应场景时，**优先使用对应技能思路执行**。

### 4.1 前端 / Next.js

#### `nextjs-app-router-patterns`
触发条件：
- 涉及 `web/app/**`、路由、layout、server component、client component
- 涉及 App Router 目录组织、数据获取、页面拆分
- 涉及 Next.js 16 的约定式写法或边界判断

执行要求：
- 优先遵循 App Router 最佳实践
- 优先区分 server/client component 边界
- 避免把 React 旧习惯生硬套进 Next.js 新目录结构

#### `typescript-react-reviewer`
触发条件：
- 涉及 React 组件、hooks、props、状态管理、TypeScript 类型边界
- 需要 review 前端代码质量、可维护性、渲染开销、反模式

执行要求：
- 优先看类型安全、组件边界、状态流和可维护性
- 避免引入与现有栈冲突的新模式

#### `tailwind-css-patterns`
触发条件：
- 涉及页面布局、样式重构、响应式、视觉层级、UI spacing
- 需要整理 Tailwind class 或抽样式模式

执行要求：
- 优先用 Tailwind 表达样式，而不是散乱新增 CSS
- 样式应服务于组件结构与复用，不堆砌原子类

#### `tanstack-query`
触发条件：
- 涉及前端服务端状态、列表查询、详情查询、CRUD 后缓存同步
- 涉及分页、筛选、失效重取、乐观更新

执行要求：
- 服务端数据优先走 Query / Mutation 模式
- 避免把请求直接散落进页面 `useEffect`

#### `react-hook-form-zod`
触发条件：
- 涉及表单开发、字段校验、默认值、错误提示、提交流程
- 涉及复杂输入联动或表单重构

执行要求：
- 表单优先采用 React Hook Form + Zod 的组织方式
- Schema 应作为字段约束与类型边界的重要来源

### 4.2 后端 / FastAPI

#### `fastapi-python`
触发条件：
- 涉及 `api/**` 下的接口、依赖注入、路由、schema、服务层
- 涉及认证、异常处理、中间件、配置管理、接口设计

执行要求：
- 优先遵循 FastAPI / Pydantic 的常规最佳实践
- 接口改动时保持 schema、路由、状态码和错误结构一致

#### `sqlalchemy-orm`
触发条件：
- 涉及模型定义、查询、事务、关系映射、数据库会话
- 涉及 SQLAlchemy ORM 层设计、查询优化、持久化行为

执行要求：
- 优先保持 ORM 层职责清晰
- 优先避免隐式副作用和难追踪的 session 行为
- 涉及 PostgreSQL 时同步关注方言兼容与索引/约束语义

## 5. 组合触发策略

- **Next.js 页面/路由开发**：优先 `nextjs-app-router-patterns`，必要时叠加 `typescript-react-reviewer`
- **React 组件重构**：优先 `typescript-react-reviewer`，样式问题叠加 `tailwind-css-patterns`
- **表单页面**：优先 `react-hook-form-zod`，若含服务端请求再叠加 `tanstack-query`
- **前端列表/详情/CRUD**：优先 `tanstack-query`，组件层问题叠加 `typescript-react-reviewer`
- **FastAPI 接口开发**：优先 `fastapi-python`，如果涉及 ORM/数据库再叠加 `sqlalchemy-orm`
- **全栈联动需求**：先后端（`fastapi-python` / `sqlalchemy-orm`）锁定接口与数据结构，再前端（`nextjs-app-router-patterns` / `typescript-react-reviewer` / `tanstack-query`）适配

## 6. 标准开发链路

1. 明确目标与边界
2. 定位代码/配置/日志
3. 判断命中哪类技能场景，并按优先规则执行
4. 做最小可交付改动
5. 给出验证结果或验证命令
6. 回写 `memory/YYYY-MM-DD.md`

## 7. 常用命令（按仓库现状）

- 根开发：`npm run dev`
- 前端开发：`npm run dev:web`
- 前端构建：`npm run build:web`
- 前端 lint：`npm run lint:web`
- 后端开发：`npm run dev:api`
- Docker 启动：`npm run docker:up`
- Docker 停止：`npm run docker:down`
- Docker 日志：`npm run docker:logs`

## 8. 输出要求

固定输出结构：

1. 结论
2. 改动点
3. 风险与影响
4. 验证结果或验证命令
5. 下一步建议（可选）

## 9. 记忆要求

完成重要工作后，更新：

- `memory/YYYY-MM-DD.md`：记录改动、验证、风险、阶段结论
- `MEMORY.md`：记录长期有效的架构约定、工程口径、重要决策
