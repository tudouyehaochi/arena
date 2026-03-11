## Why

当前 Arena 已具备角色注册、技能绑定、管理面和基础运维能力，但仍有四个阻塞体验与可运营性的缺口：

- 角色预制缺少“版本化同步”机制，导致旧 Redis 数据下新角色不出现。
- AI 资讯抓取缺少可配置的定时任务与审计闭环。
- skill 网络安装缺少权限策略，不足以安全开放。
- 管理面与聊天页在信息架构和可读性上仍有优化空间。

## What Changes

建立一个主变更，分 4 个 capability 逐步落地：

1. `preset-role-sync-and-versioning`
- 角色预制版本化与一键同步机制（补缺/覆盖可选）。

2. `network-policy-for-role-skill`
- 全局 + 角色 + skill 三级网络访问策略与域名白名单。
- 管理面可配置网络权限，作为 skill 下载与联网执行的统一闸门。

3. `scheduled-ai-intel-ingest`
- 每日定时抓取 AI 资讯（cron/timezone/source 配置）。
- 去重、失败告警、任务状态审计。

4. `admin-chat-ux-refresh`
- Admin 重构为明确分区（角色中心/技能中心/网络策略/调度任务/运维审计）。
- Chat 气泡 telemetry 分层展示（模型与 token、skills used/trimmed、激活原因）。

## Impact

- Affected docs/code areas:
  - `lib/agent-registry.js`, `lib/admin-handlers.js`, `lib/alert-center.js`
  - `lib/ai-intel-pipeline.js`, `run-arena.js`
  - `public/admin.html`, `public/js/admin-app.js`, `public/js/chat-app.js`
  - 新增 scheduler/network-policy/skill-source 相关模块
- API:
  - 新增/扩展 `admin bootstrap`, `role preset sync`, `network policy`, `intel schedules`, `skill source` 接口
- Data:
  - Redis 新增 preset 版本、网络策略、任务状态、安装审计等 key 空间

## Non-Goals

- 本期不做多租户 RBAC。
- 本期不做云对象存储备份架构重构。
- 本期不做跨项目 skill 市场平台。
