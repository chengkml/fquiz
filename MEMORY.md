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
