## 1. Phase A: Structure First

- [x] 1.1 拆分前端脚本职责
  - 将 chat/dashboard/admin 脚本拆为独立模块文件。
  - 验收：页面行为与拆分前等价。

- [x] 1.2 新增 `/dashboard` 页面路由
  - 从 `/` 中抽离监控信息面板到独立页面。
  - 验收：`/dashboard` 可独立查看运行与角色状态。

## 2. Phase B: Data Unification

- [x] 2.1 移除聊天页角色硬编码
  - 删除前端固定角色颜色/模型映射。
  - 验收：角色展示完全由后端数据驱动。

- [x] 2.2 统一角色数据来源
  - dashboard/admin 使用同一 Redis Role Registry 数据。
  - 验收：同一角色在两页显示信息一致。

## 3. Phase C: Admin Bootstrap

- [x] 3.1 增加 `GET /api/admin/bootstrap`
  - 聚合 runtime、integrity、alerts、backups、roles、agentModels。
  - 验收：管理面首屏只需 1 次初始化请求。

- [x] 3.2 管理面信息架构重排
  - 按“系统运维 / 角色管理 / 模型配置 / 告警审计”分区展示。
  - 验收：操作入口层级清晰，配置路径稳定。

## 4. Phase D: Observability & Refresh

- [x] 4.1 Dashboard 增强调度可视化
  - 展示 activeRoles、reasonByRole、executionOrder、lastDropped、retrieval。
  - 验收：可追踪每轮角色激活与裁剪原因。

- [x] 4.2 事件驱动优先 + 轮询兜底
  - 增加刷新节流，避免重复请求。
  - 验收：WS 活跃时请求频率稳定，无明显抖动。

## 5. Verification

- [x] 5.1 单元测试
  - bootstrap 聚合、字段兼容、异常降级。

- [x] 5.2 页面联调
  - `/`、`/dashboard`、`/admin` 在桌面与手机端可用。

- [x] 5.3 回归测试
  - 管理面登录、角色热加载、聊天链路无回归。
