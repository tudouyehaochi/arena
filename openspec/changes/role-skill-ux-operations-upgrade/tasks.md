## 1. UX Role & Skill Foundation

- [x] 1.1 新增 UX 角色 `文曲星`
  - 默认字段：alias/model/avatar/color/status/priority/activationMode。
  - 验收：角色在 registry 与 dashboard/admin 可见。

- [x] 1.2 新增 `frontend-design` skill catalog
  - 维护技能元数据与推荐优先级。
  - 验收：管理面可读取技能列表。

## 2. Role Management UX Upgrade

- [x] 2.1 角色管理去 JSON 化
  - 改为卡片/表单编辑，支持新增、编辑、启停、排序。
  - 验收：无需手写 JSON 即可完成角色配置。

- [x] 2.2 技能绑定支持筛选 + 优先级
  - 高/中/低优先级 + 推荐提示。
  - 验收：角色可绑定多个技能并持久化。

- [x] 2.3 激活规则收敛为两种
  - mention（@名字）/ always_on（持续在线互动）。
  - 验收：配置后路由行为与规则一致。

- [x] 2.4 Persona 模板化输入
  - 提供定位/风格/擅长/边界模板与示例。
  - 验收：非技术用户可独立完成填写。

## 3. Chat Skill Telemetry

- [x] 3.1 Prompt 按优先级注入技能
  - 注入顺序：高 -> 中 -> 低，超预算先裁低。
  - 验收：日志与输出体现优先级裁剪。

- [x] 3.2 聊天气泡展示技能使用
  - 气泡下展示本轮 skillUsage。
  - 验收：可直观看到角色本轮启用技能。

## 4. Ops Audit & Backup Operability

- [x] 4.1 告警审计能力增强
  - 过滤/确认人/确认时间/归档查询。
  - 验收：可按条件检索并追踪处理闭环。

- [x] 4.2 备份能力增强
  - 手动触发、任务状态、失败联动告警。
  - 验收：可在管理面执行并查看结果。

- [x] 4.3 恢复演练入口（dev）
  - 提供受控恢复流程与确认机制。
  - 验收：dev 环境可完成一次恢复演练。

## 5. Verification

- [x] 5.1 单元测试
  - 激活模式、技能优先级、telemetry、告警备份 handler。

- [x] 5.2 集成验证
  - admin 配置角色技能后在聊天室可观测生效。

- [x] 5.3 回归测试
  - 清风/明月与现有路由行为无回归。
