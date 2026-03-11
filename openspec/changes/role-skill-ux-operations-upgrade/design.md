## Context

该 change 在现有分离式 UI 基础上，补齐“角色体验治理 + 运维闭环”两条能力线，并保持低风险迭代。

## Goals / Non-Goals

### Goals
- 新增 UX 角色 `文曲星`，具备清晰 persona 与可管理技能绑定。
- 管理面角色配置对非技术用户友好，不再依赖原始 JSON。
- 激活规则标准化：只保留 `mention` 与 `always_on` 两种模式。
- 技能绑定支持高/中/低优先级 + 系统推荐 + 气泡可视化。
- 告警审计与备份具备实际操作链路。

### Non-Goals
- 不引入前端框架迁移。
- 不引入复杂 RBAC 多租户权限。
- 不在本期处理外部对象存储备份。

## Architecture

### 1) UX Role & Skill
- Role Registry 默认角色新增 `文曲星`：
  - `name: 文曲星`
  - `alias: [文曲]`
  - `skills`: 含 `frontend-design`
  - `activationMode`: 默认 `mention`
- skill catalog 新增 `frontend-design` 元数据：
  - `id`, `name`, `description`, `category`, `recommendedPriority`

### 2) Role Management UI (No JSON)
- Admin 角色管理区改为卡片式编辑：
  - 基础信息：name/avatar/color/model/status/priority
  - Persona 模板：定位/风格/擅长/边界（带示例）
  - 技能绑定：可筛选列表 + 优先级选择（高/中/低）+ 推荐提示
  - 激活规则：`mention` 或 `always_on`

### 3) Activation Modes
- `mention`：仅 `@角色名` 或别名触发。
- `always_on`：每轮默认候选，但仍受 activation budget/depth/circuit breaker 约束。

### 4) Skill Priority & Bubble Telemetry
- Prompt 组装按优先级注入技能：高 -> 中 -> 低。
- 超预算时先裁剪低优先级技能。
- 聊天气泡扩展展示：`skills: frontend-design(H), review(M)`。

### 5) Ops Audit & Backup Operability
- 告警审计：筛选（级别/状态/时间）、确认人/确认时间、归档查询。
- 备份：手动触发、最近任务状态、失败联动告警、dev 恢复演练入口。

## Data Contracts

### Role Skill Binding
```json
{
  "name": "文曲星",
  "activationMode": "mention",
  "skills": [
    {"id": "frontend-design", "priority": "high"},
    {"id": "summarize", "priority": "medium"}
  ],
  "persona": {
    "positioning": "体验设计师",
    "tone": "清晰、克制",
    "strengths": ["信息架构", "交互文案"],
    "boundaries": ["不编造实现状态"]
  }
}
```

### Skill Catalog Item
```json
{
  "id": "frontend-design",
  "name": "Frontend Design",
  "category": "ux",
  "description": "结构/视觉/交互体验设计技能",
  "recommendedPriority": "high"
}
```

### Bubble Skill Telemetry
```json
{
  "from": "文曲星",
  "text": "...",
  "skillUsage": [
    {"id": "frontend-design", "priority": "high", "used": true}
  ]
}
```

## Rollout Plan

### Phase 1
- 新增文曲星默认角色 + frontend-design skill catalog。
- 角色激活规则收敛到 mention/always_on。

### Phase 2
- 管理面角色配置 UI 化（去 JSON），支持技能筛选与优先级建议。

### Phase 3
- prompt 注入优先级落地 + 气泡 skill 可视化。

### Phase 4
- 告警审计与备份操作闭环。

## Risks & Mitigations

- 风险：always_on 造成 token 成本上升。
  - 缓解：预算裁剪 + 优先级降级 + 指标监控。
- 风险：角色配置复杂度上升。
  - 缓解：模板化 persona 与推荐优先级，默认值可用。
- 风险：运维操作误触发。
  - 缓解：手动备份/恢复增加确认与审计记录。

## Validation

- 单测：激活模式、技能优先级裁剪、skill telemetry。
- 集成：管理面配置 -> 聊天室生效 -> dashboard/admin 可观测。
- 回归：现有角色与消息链路保持兼容。
