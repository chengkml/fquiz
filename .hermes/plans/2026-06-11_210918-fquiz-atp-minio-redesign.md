# fquiz ATP 目录化模型管理改造方案

> **For Hermes:** 后续若按此方案实施，优先按阶段拆分为独立任务执行；每阶段完成后先做接口/数据契约核对，再进入下一阶段。

**Goal:** 把当前基于单个 `atp_text` 文本的 ATP 模型管理，升级为“按电压等级 / 塔型 / 场景 / 工况目录管理的 ATP 资料包管理系统”，由 MinIO 承载完整目录树，最终在运行时将指定资料包同步到本地 Wine 允许运行根目录，再调用 `tpbig.exe` / `rjtzl.exe` 等程序执行。

**Architecture:** 复用现有 `file_storage`（VFS/S3-MinIO）作为对象存储底座，新增 ATP 资料包元数据层、导入任务层、运行物化层三层模型。管理端不再把 ATP 模型等价为一段 `atp_text`，而是把它视为“一个可索引、可发布、可运行的目录包”；运行时通过 Celery 任务将目录包物化到 `wine_allowed_root` 下，再按规则调用 Wine/ATP 程序并回收结果。

**Tech Stack:** FastAPI + SQLAlchemy + PostgreSQL + MinIO(S3) + Celery + Wine + Ant Design + 现有文件管理模块。

---

## 1. 背景与现状判断

### 1.1 真实业务目标
用户期望的 ATP 模型管理，不是现在这种：

- 一个模型
- 对应若干版本
- 每个版本核心是一段 `atp_text`

而是类似真实目录 `/mnt/d/fl/解压目录/ATP` 的管理方式：

- 按电压等级：`35/66/110/220/330/500/750/800/1000`
- 按塔型/线路类型：`ganzi/guxing/jiubei/maotou/sihuita/...`
- 按场景：`fanji/raoji1/raoji2/raoji3`
- 按避雷器/工况组合：`M1/M12/M123/M13/M2/M23/M3/noM/...`
- 目录内混合存在：
  - `work.atp`
  - `*.lis/*.pl4/*.log/*.dbg`
  - `*.lib/*.dat/*.pch`
  - `EGM` 输入/结果
  - `exe`
  - `py` 预处理/后处理脚本
  - `txt/docx/zip` 说明与归档

### 1.2 fquiz 当前 ATP 模块的主要问题
当前文件：

- `api/app/models/atp_model.py`
- `api/app/services/atp_model_service.py`
- `api/app/api/v1/atp_models.py`
- `web/src/app/admin/power-lines/atp-viewer/page.tsx`

现状特征：

1. `AtpModelVersion` 的核心字段是：
   - `atp_text`
   - `graph_json`
   - `artifact_manifest_json`
2. 运行逻辑 `_build_run_command()` 也是把 `version.atp_text` 写到本地文件后直接执行。
3. 这套设计只能覆盖“单文件 ATP 文本模板”，不适合覆盖真实目录资料包。
4. 当前没有把：
   - 电压等级
   - 塔型
   - 场景
   - 工况组合
   - EGM/ATP 双运行器
   纳入一等公民模型。

### 1.3 可直接复用的基础设施
当前仓库已经具备以下可复用能力：

#### 对象存储与文件索引
- `api/app/models/file_storage.py`
- `api/app/services/storage_driver.py`
- `api/app/services/file_service.py`

已支持：
- VFS / S3(MinIO)
- mount 抽象
- 目录列举
- 上传/下载
- 重命名/移动/删除
- index entry 同步

#### MinIO 环境
- `.env`
- `deploy/dev-deploy/compose.yml`
- `deploy/pro-deploy/compose.yml`
- `seed_service.py`

已支持：
- `files.s3.default`
- bucket 自动初始化
- `main` mount 默认挂载

#### Wine 执行能力
- `api/app/services/wine_service.py`

已支持：
- 在 `wine_allowed_root` 下执行 exe
- Celery 异步任务
- 日志/退出码记录

#### legacy ATP 目录执行样板
- `api/app/services/legacy_atp_adapter.py`

已支持：
- 解析模板目录
- 复制模板目录到运行目录
- 对目录内模型文件做特征绑定
- 运行 `tpbig.exe` / `rjtzl.exe`
- 回读文本结果

#### 大文件/目录导入异步样板
- `api/app/services/elevation_service.py`

已支持成熟链路：
- 上传到对象存储暂存区
- 记录 import job
- Celery 异步解压/整理/导入
- 结果落库

**结论：** 本方案不需要重造存储、任务、执行底座，只需要把 ATP 模型层升级成“目录包元数据 + 目录包导入/发布/运行编排”。

---

## 2. 目标架构

## 2.1 三层模型

### A. ATP 资料包主表（业务维度）
用于表达“一个业务上的 ATP 模型族”。

示例：
- 220kV 四回塔 绕击3
- 500kV 干字塔 反击
- 330kV 酒杯塔 无避雷器

这个层级只关心业务分类与检索，不关心实际目录文件细节。

### B. ATP 场景版本表（发布维度）
用于表达“一个可执行的具体版本/场景”。

一个版本会绑定：
- 电压等级
- 塔型
- 场景
- 工况组合
- 运行器类型（ATP / EGM / HYBRID）
- 存储中的目录根路径
- 入口文件
- 可选结果文件规则
- 可选预处理/后处理脚本

这个层级才是真正供运行选择的对象。

### C. ATP 工件清单表（文件维度）
用于表达一个场景版本内有哪些关键文件。

典型包括：
- `work.atp`
- `work.lis`
- `rjtzl.exe`
- `tpbig.exe`
- `EGM/*.txt`
- `delete_others.py`
- `说明.docx`

这个层级负责：
- 展示
- 校验
- 关键文件定位
- 运行时解析入口

### D. ATP 导入任务表（流程维度）
用于表达一个 zip/目录包从上传到发布的过程。

---

## 2.2 运行时链路

目标运行链路：

1. 管理端在 MinIO 中维护 ATP 资料包目录树
2. 用户在后台选择一个“ATP 场景版本”发起运行
3. API 创建 run 记录
4. Celery 任务：
   - 从 MinIO 读取该版本目录树
   - 物化到本地 `wine_allowed_root` 下的运行目录
   - 如有预处理脚本则执行
   - 调用 `wine tpbig.exe` 或 `wine rjtzl.exe`
   - 回收结果文件 / stdout / stderr
   - 如有后处理脚本则执行
   - 写回 run 结果与产物索引
5. 前端查看运行结果、下载关键输出文件

---

## 3. 数据模型设计

## 3.1 新表设计

### 3.1.1 `atp_asset`
表示 ATP 业务模型族。

建议字段：

- `id` varchar(32) pk
- `code` varchar(64) unique
- `name` varchar(255)
- `description` text
- `status` varchar(20)  `draft/enabled/disabled/archived`
- `voltage_level` varchar(16) 可选冗余主标签，如 `220/500`
- `tower_type` varchar(64) 可选冗余主标签，如 `sihuita/ganzi`
- `scene_type` varchar(32) 可选冗余主标签，如 `fanji/raoji3`
- `tags_json` json
- `create_date/create_user/update_date/update_user`

说明：
- `atp_model` 可保留兼容，但长期建议新建 `atp_asset`，避免语义继续混乱。
- 如果不想新建表，也可将现 `atp_model` 语义提升为 `asset`，但字段命名会继续误导开发者。

### 3.1.2 `atp_asset_release`
表示一个可执行发布版本。

建议字段：

- `id` varchar(32) pk
- `asset_id` fk -> `atp_asset.id`
- `release_no` int
- `release_tag` varchar(64)
- `status` varchar(20) `draft/released/archived`
- `voltage_level` varchar(16) 非空
- `tower_type` varchar(64) 非空
- `scene_type` varchar(32) 非空
- `scenario_code` varchar(64) 如 `M1/noM/M123`
- `runner_kind` varchar(20) `atp/egm/hybrid/wine_script`
- `storage_mount_code` varchar(64) 默认 `main`
- `storage_root_path` varchar(2048) 目录包根路径
- `entry_file` varchar(255) 如 `work.atp`
- `result_file` varchar(255) 可空
- `egm_subdir` varchar(255) 可空
- `egm_result_file` varchar(255) 可空
- `preprocess_script` varchar(255) 可空，如 `1 delete_others.py`
- `postprocess_script` varchar(255) 可空
- `manifest_json` json
- `validation_json` json
- `content_hash` varchar(64)
- `is_active` bool
- `create_date/create_user/update_date/update_user`

说明：
- `storage_root_path` 指向 MinIO 挂载中的目录根，例如：
  - `/atp-library/220/sihuita/raoji3/M1`
- `manifest_json` 保存导入扫描结果：
  - 文件总数
  - 关键文件是否存在
  - 子目录结构
  - 可执行文件定位

### 3.1.3 `atp_asset_file`
表示一个发布版本的关键文件索引。

建议字段：

- `id` bigint pk
- `release_id` fk -> `atp_asset_release.id`
- `relative_path` varchar(2048)
- `name` varchar(255)
- `file_role` varchar(32)
  - `entry_atp`
  - `result_text`
  - `exe_tpbig`
  - `exe_rjtzl`
  - `preprocess_script`
  - `postprocess_script`
  - `library`
  - `doc`
  - `binary`
  - `other`
- `mime_type` varchar(255)
- `size` bigint
- `etag` varchar(255)
- `storage_key` varchar(2048)
- `is_required` bool
- `create_date/update_date`

### 3.1.4 `atp_asset_import_job`
表示导入任务。

建议字段：

- `id` varchar(32) pk
- `asset_id` fk 可空
- `release_id` fk 可空
- `mount_code` varchar(64)
- `stage_path` varchar(2048)
- `source_filename` varchar(255)
- `status` varchar(20)
  - `pending/queued/importing/validating/completed/failed/cancelled`
- `uploaded_file_count` int
- `extracted_file_count` int
- `warning_count` int
- `warnings_json` json
- `staged_files_json` json
- `manifest_json` json
- `task_id` varchar(128)
- `error_message` text
- `create_date/create_user/update_date/update_user`

### 3.1.5 `atp_asset_run`
建议替代或扩展现有 `atp_simulation_run`。

如果保留现有表，建议至少新增：

- `release_id`
- `storage_mount_code`
- `storage_root_path`
- `materialized_root_path`
- `runner_kind`
- `preprocess_status`
- `postprocess_status`
- `output_manifest_json`
- `result_summary_json`

说明：
- 现有 `version_id` 更像文本版本语义，不够表达目录包。

---

## 4. 存储设计（MinIO）

## 4.1 目标目录布局

建议在 `main` mount 下单独规划 ATP 资料根：

- `/atp-library/imports/`：上传暂存区
- `/atp-library/releases/`：正式发布区
- `/atp-library/runs/`：运行结果归档（可选）

推荐正式目录格式：

- `/atp-library/releases/{asset_code}/r{release_no}/...原始目录内容...`

例如：

- `/atp-library/releases/atp-220-sihuita-raoji3/r1/220/sihuita/raoji3/M1/...`

或者更扁平一点：

- `/atp-library/releases/atp-220-sihuita-raoji3/r1/...`

**建议选择扁平方案**，即导入时把用户上传目录整体挂到该 release 根下，不强依赖固定内部第一层路径名。

## 4.2 为什么不要直接把原始 ATP 总目录一比一挂到运行配置
因为运行时真正需要的是：

- 一个明确可执行的 release 根
- 明确入口文件
- 明确结果文件
- 明确 runner 类型

而不是整个海量总库。总库适合归档，不适合直接供运行任务临时扫描。

---

## 5. 导入流程设计

## 5.1 导入入口

后台提供两种导入方式：

1. 上传 zip
2. 从文件管理已有路径选择目录并注册

优先建议先做 **zip 导入**，因为最容易闭环。

## 5.2 zip 导入流程

### Step 1: 上传到对象存储暂存区
复用 `elevation_service` 的 staging 模式：

- `driver.write_file()` 到 `/atp-library/imports/{job_id}/source.zip`

### Step 2: Celery 异步解压
任务：
- 读出 zip
- 解压到 `/atp-library/imports/{job_id}/expanded/...`
- 统计文件数、目录数、关键文件

### Step 3: 自动校验
校验规则：

- 是否存在 `work.atp` 或配置指定入口
- 是否存在 `tpbig.exe` / `rjtzl.exe` 或可通过系统默认路径补足
- 是否存在 `EGM` 子目录（若 runner_kind=egm/hybrid）
- 是否存在 `*.lis` / 结果文本（若声明需要）
- 是否存在预处理脚本
- 是否包含潜在危险脚本（例如 `.bat/.cmd/.ps1`）

### Step 4: 写 release 记录
生成：
- `atp_asset`
- `atp_asset_release`
- `atp_asset_file`
- `manifest_json`

### Step 5: 发布到正式区
将暂存目录移动或复制到：
- `/atp-library/releases/{asset_code}/r{release_no}/`

### Step 6: 前端展示导入报告
包括：
- 识别出的电压等级/塔型/场景/工况
- 关键文件清单
- 告警项
- 是否允许激活

---

## 6. 运行流程设计

## 6.1 物化策略
MinIO 不能直接供 Wine exe 当本地目录运行，因此必须“物化”到本地：

- 本地根：`settings.wine_allowed_root`
- ATP 运行根建议新增子目录：
  - `./data/wine/atp-runtime/releases/...`
  - `./data/wine/atp-runtime/runs/{run_id}/...`

### 运行前动作
1. 根据 `release.storage_root_path` 枚举 MinIO 下文件
2. 全量同步到：
   - `wine_allowed_root/atp-runtime/runs/{run_id}/payload/`
3. 校验入口文件存在
4. 如配置了 `preprocess_script`，先执行该脚本
5. 调用对应运行器

## 6.2 运行器策略

### runner_kind = `atp`
- 调 `tpbig.exe`
- 输入：`entry_file`
- 工作目录：release 物化目录

### runner_kind = `egm`
- 调 `rjtzl.exe`
- 工作目录：`egm_subdir`
- 结果文件按 `egm_result_file`

### runner_kind = `hybrid`
- 先跑 `egm`
- 再按配置决定是否跑 `atp`
- 或按 legacy adapter 的 contract 合并结果

### runner_kind = `wine_script`
- 允许指定一个 exe + 参数模板
- 仅作为扩展位，第一期不必开放 UI

## 6.3 后处理
如果有：
- `postprocess_script`

则运行结束后执行，用于：
- 清理参数块
- 汇总结果文件
- 生成前端展示摘要

## 6.4 结果回收
回收内容：

- stdout/stderr
- exit_code
- 关键结果文件列表
- 输出目录 manifest
- 结果摘要 json

可选增强：
- 将结果目录再回传到 MinIO：
  - `/atp-library/runs/{run_id}/...`

这样可支持：
- 后台下载结果
- 历史运行审计
- 二次分析

---

## 7. API 改造方案

## 7.1 保留现接口但升级语义（不推荐）
当前 `/api/v1/atp/models` 的命名会继续误导为“单文本模型”。

## 7.2 新接口（推荐）
建议新增一组目录化接口：

### 资料包主资源
- `GET /api/v1/atp/assets`
- `POST /api/v1/atp/assets`
- `GET /api/v1/atp/assets/{id}`
- `PATCH /api/v1/atp/assets/{id}`
- `DELETE /api/v1/atp/assets/{id}`

### release 资源
- `GET /api/v1/atp/assets/{id}/releases`
- `POST /api/v1/atp/assets/{id}/releases/import`
- `GET /api/v1/atp/releases/{release_id}`
- `PATCH /api/v1/atp/releases/{release_id}`
- `POST /api/v1/atp/releases/{release_id}/activate`
- `GET /api/v1/atp/releases/{release_id}/files`
- `GET /api/v1/atp/releases/{release_id}/preview`

### import job
- `GET /api/v1/atp/import-jobs`
- `GET /api/v1/atp/import-jobs/{job_id}`

### run
- `POST /api/v1/atp/releases/{release_id}/runs`
- `GET /api/v1/atp/releases/{release_id}/runs`
- `GET /api/v1/atp/runs/{run_id}`
- `GET /api/v1/atp/runs/{run_id}/outputs`
- `GET /api/v1/atp/runs/{run_id}/outputs/download`

### engine
- `GET /api/v1/atp/engine/status`

## 7.3 兼容策略
第一期可保留旧接口 `/api/v1/atp/models`，但：

- 页面入口迁到新资源
- 旧接口标记为 legacy
- 若必须兼容，则让旧 `AtpModelSummary` 映射到新 `asset` 的摘要视图

---

## 8. 前端改造方案

## 8.1 页面定位
当前页面：
- `web/src/app/admin/power-lines/atp-viewer/page.tsx`

它现在混合承载：
- 模型台账
- 模板文本编辑
- 仿真运行
- ATP 文本可视化

这不适合目录化模型管理。

## 8.2 拆页建议
建议拆成 4 个页面：

### A. ATP 资料包管理页
路由：`/admin/atp-models`

展示：
- 资料包列表
- 电压等级筛选
- 塔型筛选
- 场景筛选
- 状态筛选
- 当前激活 release

### B. ATP Release 详情页
路由：`/admin/atp-models/[assetId]`

展示：
- release 列表
- 关键元数据
- 文件清单
- 校验结果
- 激活/归档按钮

### C. ATP 导入页/抽屉
功能：
- 上传 zip
- 选择 mount 中现有目录
- 填写：电压等级/塔型/场景/工况/runner
- 显示导入校验报告

### D. ATP 运行页
路由可继续沿用子面板或独立页

展示：
- 选择 release
- 运行参数
- 任务状态
- 结果摘要
- 输出文件下载

## 8.3 ATP 文本预览功能保留方式
现有“ATP 文本转换与预览”不应删除，但应降级为工具页：

- 输入：从 release 文件清单中选择 `work.atp`
- 读取后本地渲染
- 不再承担“模型主编辑器”角色

---

## 9. 分阶段实施计划

## Phase 1：目录化元数据落库（最小闭环）

**Objective:** 能在后台录入 ATP 资料包和 release 元数据，但先不做 zip 自动导入。

**Files:**
- Create: `api/app/models/atp_asset.py`
- Create: `api/app/schemas/atp_asset.py`
- Create: `api/app/services/atp_asset_service.py`
- Create: `api/app/api/v1/atp_assets.py`
- Modify: `api/app/api/router.py`
- Modify: `api/app/services/seed_service.py`
- Create: `web/src/app/admin/atp-models/page.tsx`
- Create: `web/src/app/admin/atp-models/[id]/page.tsx`

**Deliverables:**
- 资料包 CRUD
- release CRUD
- release 激活
- 文件清单只存元数据，不自动导入

**Acceptance:**
- 能录入一个 release，指向 MinIO 中某目录
- 能在前端展示该 release
- 能激活切换 release

## Phase 2：zip 导入 + manifest 扫描

**Objective:** 能上传 zip 到 MinIO，异步解压并生成 release。

**Files:**
- Create: `api/app/tasks/atp_asset_tasks.py`
- Create: `api/app/services/atp_asset_import_service.py`
- Modify: `api/app/services/storage_driver.py`（如需补目录递归遍历辅助）
- Modify: `api/app/services/file_service.py`（如需复用目录打包逻辑）
- Create: `web/src/components/atp-asset-import-modal.tsx`

**Deliverables:**
- upload zip
- import job
- manifest
- 关键文件识别

**Acceptance:**
- 能导入一个 ATP 目录 zip
- 能识别 `work.atp` / `EGM` / exe / 说明文件
- 能生成 release + file 清单

## Phase 3：运行时物化到 Wine 根目录

**Objective:** 运行时不再依赖 `atp_text`，改为从 MinIO 物化目录后执行。

**Files:**
- Modify: `api/app/services/atp_model_service.py`（或拆分为新 `atp_run_service.py`）
- Create: `api/app/services/atp_runtime_materializer.py`
- Modify: `api/app/services/wine_service.py`（如需复用执行封装）
- Modify: `api/app/services/legacy_atp_adapter.py`

**Deliverables:**
- release -> local runtime dir
- preprocess -> run -> postprocess
- result harvest

**Acceptance:**
- 指定 release 可成功同步到本地运行目录
- 调用 `tpbig.exe` 或 `rjtzl.exe`
- run 记录中能看到目录来源、工作目录、结果清单

## Phase 4：结果产物回写与下载

**Objective:** 支持结果文件长期归档与下载。

**Files:**
- Modify: `api/app/services/atp_asset_service.py`
- Modify: `api/app/api/v1/atp_assets.py`
- Modify: `web/src/app/admin/atp-models/[id]/page.tsx`

**Deliverables:**
- 结果同步回 MinIO
- 结果文件清单下载
- 历史运行追溯

**Acceptance:**
- 后台能下载某次 run 的关键输出文件
- 结果可回溯到 release 版本

## Phase 5：迁移旧 ATP 文本模型

**Objective:** 把现有 `atp_model/atp_model_version` 迁移到新体系或降级为 legacy。

**策略：**
- 短期保留旧表
- 新页面只读 legacy 数据或不展示
- 如确实有价值，把旧 `atp_text` 版本导出成目录包（单文件场景）迁入新 release

---

## 10. 关键实现细节

## 10.1 目录递归枚举能力
当前 `storage_driver` 公开的是 `list_dir(path)`，如果要做 release manifest 扫描，需要补一个服务层递归工具：

- `walk_virtual_tree(driver, root_path)`

要求：
- 返回相对路径列表
- 限制最大文件数/最大深度，避免超大目录拖垮任务

## 10.2 本地物化安全边界
运行物化目录必须严格限制在：

- `settings.wine_allowed_root`

例如：
- `./data/wine/atp-runtime/runs/{run_id}`

所有同步、脚本执行、exe 调用都只能在这个根内进行，防止目录穿越与任意执行。

## 10.3 脚本执行白名单
真实 ATP 目录里可能带：
- `.py`
- `.bat`
- `.cmd`

为了安全，第一期建议：

- 仅允许执行 `.py`
- 且脚本路径必须位于 release 根目录内
- 且必须在 release 元数据里显式配置为 `preprocess_script/postprocess_script`
- 默认不自动执行任意发现到的脚本

`.bat/.cmd/.ps1` 第一阶段不要自动执行。

## 10.4 入口文件发现规则
导入时的默认入口发现：

优先级：
1. 用户手工指定
2. 根目录下 `work.atp`
3. 唯一的 `*.atp`
4. 未发现则标记需人工补充

EGM 结果文件类似：
1. 用户手工指定
2. `result.txt`
3. 唯一的 `*_result*.txt`

## 10.5 分类字段规范化
建议新增枚举/规范字典：

- `voltage_level`: `35/66/110/220/330/500/750/800/1000`
- `scene_type`: `fanji/raoji1/raoji2/raoji3/other`
- `runner_kind`: `atp/egm/hybrid`

`tower_type` 和 `scenario_code` 先保持字符串自由录入，避免第一期过度建模。

---

## 11. 与当前 legacy ATP 适配器的关系

## 11.1 短期
不要删除 `legacy_atp_adapter.py`。

应改造为：
- 既能吃老配置
- 也能吃新 `release` 解析结果

让它从“配置驱动目录执行器”，演进为“目录包运行引擎适配层”。

## 11.2 中期
把以下逻辑上提为公共运行层：

- 运行目录准备
- 模板目录复制
- 脚本执行
- 结果解析

让 `legacy_atp_adapter.py` 只保留：
- 特征绑定逻辑
- EGM/ATP 结果合并逻辑

---

## 12. 风险与影响

### 风险 1：对象存储目录大、文件多，导入慢
**应对：**
- 走 import job 异步链路
- 限制单次导入 zip 大小、文件数
- manifest 预扫描超限直接失败

### 风险 2：Wine 运行依赖本地目录语义，MinIO 无法直跑
**应对：**
- 明确采用“本地物化后再执行”
- 运行完成后可选回写产物

### 风险 3：目录内脚本存在安全风险
**应对：**
- 第一阶段仅白名单 `.py`
- 必须显式配置
- 严格限制在 `wine_allowed_root`

### 风险 4：旧 ATP 文本模型与新目录包模型并存，前后端易混淆
**应对：**
- 新接口使用 `assets/releases` 命名
- 旧 `models` 标记 legacy
- UI 迁移后默认只展示新模型

### 风险 5：真实 ATP 目录结构不完全统一
**应对：**
- release 允许手工修正：
  - `entry_file`
  - `result_file`
  - `egm_subdir`
  - `preprocess_script`
- 不强依赖固定目录模板

---

## 13. 推荐落地顺序（最务实）

如果要最快闭环，建议按以下顺序推进：

1. **先不上来推翻旧 ATP 模块**
2. 先新建 `atp assets/releases` 模型与接口
3. 先支持“手工录入 storage_root_path”的目录化 release
4. 打通“从 MinIO 目录 -> 本地物化 -> Wine 执行”
5. 跑通后再补 zip 导入/manifest 自动识别
6. 最后再考虑迁移旧 `atp_text`

这样可以最快得到一个能用版本，而不是一上来做完整导入系统导致战线过长。

---

## 14. 最小可交付版本（MVP）定义

MVP 应满足：

1. 后台可创建 ATP 资料包
2. 后台可为资料包创建一个 release
3. release 可绑定 MinIO 中一个目录根路径
4. 可手工配置：
   - runner_kind
   - entry_file
   - result_file / egm_subdir
   - preprocess_script
5. 发起运行时：
   - 能把整个目录同步到本地
   - 能运行 Wine + exe
   - 能回收 stdout/stderr/exit_code
6. 后台能看到运行记录

**MVP 不要求：**
- 自动识别所有目录分类
- 自动解析所有结果格式
- 完整图形化编辑 ATP 文本
- 完整历史迁移旧模型

---

## 15. 本方案对应的仓库改造重点

### 后端新增重点
- `atp_asset` / `atp_asset_release` / `atp_asset_file` / `atp_asset_import_job`
- 目录递归扫描
- MinIO -> 本地物化
- release 运行器
- import job

### 前端新增重点
- 资料包列表页
- release 详情页
- 导入弹窗
- 运行记录与结果下载

### 现有代码复用重点
- 文件存储驱动
- MinIO 部署
- Wine 执行
- legacy ATP 目录执行逻辑
- elevation 异步导入样板

---

## 16. 验收标准

### 功能验收
- 能上传或绑定一个 ATP 目录包到 MinIO
- 能在后台按电压/塔型/场景检索 release
- 能运行指定 release
- 能拿到运行结果
- 能查看和下载关键输出

### 架构验收
- 不再要求核心执行必须依赖 `atp_text`
- 目录包是系统一等公民
- MinIO 是资料包权威存储
- Wine 只消费本地物化运行目录

### 可维护性验收
- API 命名明确区分 `asset/release/run`
- legacy 与新体系边界清晰
- 关键目录路径、入口文件、运行器类型可配置

---

## 17. 一句话结论

**推荐把 fquiz 的 ATP 模型管理，从“单 ATP 文本文档管理”升级为“MinIO 承载的目录化 ATP 资料包管理 + 本地物化执行架构”；复用现有文件存储、MinIO、Wine、Celery、legacy ATP 适配器与高程导入链路，按 `asset -> release -> file -> import_job -> run` 五层模型落地。**
