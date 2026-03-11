## 1. Preset Roles

- [x] 1.1 增加角色预制版本字段与同步状态字段
- [x] 1.2 实现 `merge_missing` 与 `apply_all` 两种同步模式
- [x] 1.3 管理面增加“同步预制角色”入口与结果反馈

## 2. Network Policy

- [x] 2.1 设计并落地全局/角色/skill 三级网络策略模型
- [x] 2.2 增加域名白名单配置与策略评估器
- [x] 2.3 管理面增加网络权限配置页与生效预览

## 3. Scheduled Intel

- [x] 3.1 增加每日资讯调度配置（cron/timezone/sources）
- [x] 3.2 实现调度执行、去重和失败重试
- [x] 3.3 增加抓取任务审计与告警联动

## 4. Remote Skill Source

- [x] 4.1 增加 skill 网络安装入口（受网络策略控制）
- [x] 4.2 增加来源校验与安装审计字段
- [x] 4.3 支持 skill disable/rollback

## 5. UX Refresh

- [x] 5.1 Admin 重排信息架构为五分区
- [x] 5.2 Chat telemetry 分层展示优化
- [x] 5.3 移动端与桌面端交互一致性回归

## 6. Verification

- [x] 6.1 单元测试：preset sync / policy engine / scheduler / skill source
- [x] 6.2 集成测试：管理面配置到聊天室行为链路
- [x] 6.3 回归测试：现有角色路由、消息存储、运维接口
