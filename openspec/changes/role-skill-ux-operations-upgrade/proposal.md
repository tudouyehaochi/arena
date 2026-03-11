## Why

当前重构后 dashboard/admin 已具备基础结构，但 follow-ups 里的四个关键能力尚未落地：
- 缺少独立 UX skill 与 UX 角色，体验策略难以复用。
- 角色管理仍以 JSON 为主，配置门槛高。
- 角色技能绑定缺少优先级与可视化反馈，难以调优。
- 告警审计与备份仍偏展示，缺少可运维闭环。

## What Changes

- 新增 UX 角色 `文曲星`，并引入独立 `frontend-design` 技能能力。
- 管理面角色配置从 JSON 升级为表单化/卡片化，支持技能筛选与绑定。
- 激活规则收敛为两种：`@名字(mention)` 与 `持续在线互动(always_on)`。
- 技能绑定支持优先级（高/中/低）与系统建议，并在聊天气泡下展示“本轮生效技能”。
- 告警审计与备份升级为可执行运维能力（筛选/确认/归档 + 手动备份/状态/联动）。

## Capabilities

### New Capabilities
- `ux-role-and-skill`: 文曲星角色与 frontend-design 技能能力。
- `role-skill-priority-binding`: 角色技能绑定（筛选 + 优先级 + 推荐）。
- `ops-audit-backup-operability`: 告警审计与备份闭环能力。

### Modified Capabilities
- `admin-role-management-ui`: 管理面角色管理从 JSON 配置升级为结构化 UI。
- `chat-bubble-skill-telemetry`: 聊天气泡展示本轮技能注入信息。

## Impact

- Affected code:
  - `public/admin.html`, `public/js/admin-app.js`
  - `public/index.html`, `public/js/chat-app.js`
  - `lib/agent-registry.js`, `lib/prompt-builder.js`, `lib/a2a-router.js`
  - `lib/admin-handlers.js`, `lib/alert-center.js`, 备份脚本与相关 handler
- APIs/systems:
  - 角色管理与技能列表接口增强
  - 告警审计与备份操作接口新增/扩展
- Dependencies:
  - 需接入本地 skill 清单读取（.codex/skills）
