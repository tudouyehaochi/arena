## Context

该重构以“降低耦合 + 提升可观测 + 保持低风险”为目标，不改变核心聊天与调度语义，优先做页面与接口层重构。

## Goals / Non-Goals

### Goals
- `/` 专注聊天，会话链路与输入体验不受影响。
- `/dashboard` 独立承载监控与编排可视化（activeRoles/reason/dropped/retrieval）。
- `/admin` 采用分区信息架构和聚合初始化接口，减少首屏请求数量。
- 角色元信息只读 Redis Role Registry，避免前端硬编码漂移。

### Non-Goals
- 本期不重写底层 runner/router 逻辑。
- 本期不引入新前端框架，沿用当前静态页面 + 原生脚本模式。
- 本期不处理多租户权限，仅维持现有 admin 鉴权能力。

## Architecture

### 1) Route Separation
- `GET /` -> Chat App
- `GET /dashboard` -> Dashboard App
- `GET /admin` -> Admin Console

Chat App 仅显示会话上下文与最小状态；Dashboard 显示调度观测；Admin 负责配置与运维。

### 2) Admin Bootstrap API
新增 `GET /api/admin/bootstrap`，返回管理面首屏所需聚合数据：
- runtime / rooms / alerts / integrity / backups
- roles / allowedModels
- agentModels

目标：将当前管理面 3~5 次初始化请求收敛为 1 次。

### 3) Frontend Module Split
将页面脚本拆为模块（可先在 `public/` 下按文件拆分）：
- `chat-app.js`
- `dashboard-app.js`
- `admin-app.js`
- `shared/api-client.js` / `shared/format.js`

先做物理拆分和职责边界，不引入构建系统。

### 4) Data Source Unification
- 角色名、头像、颜色、模型、状态统一由 Redis Role Registry 提供。
- 前端不再维护 `AGENT_COLORS/AGENT_MODELS` 常量映射。
- Dashboard 与 Admin 显示同一角色源，保证一致性。

### 5) Refresh Strategy
- 事件驱动优先：WS 事件触发局部刷新。
- 轮询兜底：低频轮询用于容错（如每 10~15s）。
- 增加节流机制，避免 WS + 轮询重复拉取。

## Data Contracts

### GET /api/admin/bootstrap
```json
{
  "runtime": {},
  "rooms": {"total": 0},
  "alerts": [],
  "integrity": null,
  "backups": [],
  "roles": [],
  "allowedModels": ["claude", "codex"],
  "agentModels": {}
}
```

### GET /api/dashboard
继续返回并强化以下字段供可视化：
- `route.activeRoles`
- `route.reasonByRole`
- `route.executionOrder`
- `route.lastDropped`
- `route.retrievalCount` / `route.retrievalType`

## Rollout Plan

### Phase A (结构先行)
- 页面脚本物理拆分与职责边界划分。
- 不改行为，仅保证等价运行。

### Phase B (数据统一)
- 移除聊天页角色硬编码。
- 改为读取 `/api/dashboard` + 角色注册数据。

### Phase C (管理面体验)
- 新增 `/api/admin/bootstrap`。
- 管理面首屏改为单请求初始化。

### Phase D (可观测增强)
- Dashboard 增强调度决策可视化。
- 增加刷新节流和兜底策略。

## Risks & Mitigations

- 风险：拆分后页面加载失败。
  - 缓解：分阶段发布；保留单文件回退入口。
- 风险：聚合接口过大导致延迟上升。
  - 缓解：字段分层 + 必需字段优先；保留子接口作为降级。
- 风险：前端数据字段不兼容。
  - 缓解：先扩展后替换，保证旧字段短期并存。

## Validation

- 单测：新增 bootstrap handler、字段映射与容错。
- 集成：`/`、`/dashboard`、`/admin` 三页面联调。
- 回归：聊天消息链路、管理面登录、角色热加载能力保持可用。
