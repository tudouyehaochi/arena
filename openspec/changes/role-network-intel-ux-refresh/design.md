## Context

本设计目标是在不破坏现有聊天室能力的前提下，补齐“可预制、可调度、可控联网、可观测”的运营闭环。

## Architecture

```txt
Admin Console
  ├─ Role Presets
  ├─ Skill Catalog (local + remote)
  ├─ Network Policy
  ├─ Scheduler
  └─ Ops Audit

Backend
  ├─ Role Registry (Redis, presetVersion)
  ├─ Skill Registry (source + checksum)
  ├─ Network Policy Engine
  ├─ Scheduler Worker
  └─ Intel Ingest + Prompt Telemetry
```

## Key Decisions

### 1) Role Preset Versioning

- 引入 `presetVersion` 与 `lastSyncedPresetVersion`。
- 提供两种同步模式：
  - `merge_missing`：只补不存在角色。
  - `apply_all`：按预制完整覆盖。
- Admin 增加“一键同步预制角色”入口并显示版本差异。

### 2) Network Policy Engine

统一决策公式：

```txt
effectiveAllow = globalAllow
              && roleAllow(role)
              && skillAllow(skill)
              && domainAllow(targetDomain)
```

- Global: `networkEnabled`。
- Role: `inherit|allow|deny`。
- Skill: `inherit|allow|deny`。
- Domain: `allowedDomains[]`（支持通配规则，默认 deny-all）。

### 3) Scheduled AI Intel

- 调度配置：`enabled`, `cron`, `timezone`, `sources`, `maxItems`, `dedupeWindow`。
- 执行记录：`lastRunAt`, `lastStatus`, `lastError`, `fetchedCount`, `storedCount`。
- 失败联动告警：写入 alert center 并可 ack/追踪。

### 4) Remote Skill Source

- 安装能力依赖 network policy 放行。
- 记录安装审计：`sourceType`, `sourceRef`, `checksum`, `installedBy`, `installedAt`。
- 提供 disable/rollback 的生命周期管理。

### 5) UX Refresh

- Admin 信息架构：
  - 角色中心
  - 技能中心
  - 网络策略
  - 调度任务
  - 运维审计
- Chat 气泡 telemetry 三层展示：
  - model/tokens
  - skills used/trimmed
  - activation reason/memory hit

## Risks & Mitigations

- 风险：联网能力扩大攻击面。
  - 缓解：默认关闭、显式放行、域名白名单、审计追踪。
- 风险：定时任务导致 token/请求成本上升。
  - 缓解：频率上限、来源限额、失败退避。
- 风险：预制覆盖误伤人工配置。
  - 缓解：默认 merge_missing，apply_all 二次确认。

## Validation Strategy

- 单测：策略决策、预制同步、调度器状态机、skill 安装审计。
- 集成：Admin 配置 -> 执行抓取 -> 告警/气泡可观测。
- 回归：现有角色与聊天核心流程无行为回退。
