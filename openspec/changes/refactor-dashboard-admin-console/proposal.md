## Why

当前 Arena 的聊天页 (`/`) 同时承载聊天与监控信息，管理页 (`/admin`) 也采用单文件耦合实现，导致以下问题：
- 页面职责混杂，脚本体积偏大，演进风险高。
- 管理面初始化依赖多次接口请求，首屏慢且失败点多。
- 角色数据在前端存在硬编码与后端 Redis 注册中心并存，数据源不一致。
- 刷新策略以轮询为主，和 WS 推送叠加后出现重复请求与抖动。

## What Changes

- 聊天页聚焦会话体验，监控能力独立到 `/dashboard`。
- 管理面按信息架构重排为“系统运维 / 角色管理 / 模型配置 / 告警审计”四个分区。
- 统一角色来源为 Redis Role Registry，前端移除角色硬编码。
- 新增 `GET /api/admin/bootstrap` 聚合接口，合并管理面首屏请求。
- 优先采用事件驱动更新（WS / 触发刷新），轮询仅作为兜底。

## Capabilities

### New Capabilities
- `admin-bootstrap-api`: 管理面聚合初始化接口。
- `dashboard-page-separation`: 独立 `/dashboard` 页面承载监控与编排观测。

### Modified Capabilities
- `admin-console-ia`: 管理页信息架构重排与模块化。
- `role-source-unification`: 前后端统一使用 Redis 角色注册数据。

## Impact

- Affected code:
  - `public/index.html`, `public/admin.html`（拆分与模块化）
  - `lib/admin-handlers.js`, `lib/dashboard-handlers.js`, `server.js`（接口与路由）
- APIs/systems:
  - 新增 `GET /api/admin/bootstrap`
  - `/api/dashboard` 与 `/api/admin/*` 响应模型会补齐前端所需字段
- Dependencies:
  - 无新增外部服务依赖，复用现有 Redis 与现有路由体系
