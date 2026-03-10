## 1. Foundation

- [ ] 1.1 新建角色注册中心（Role Registry）
  - 输入：角色定义（name/persona/skills/rules/priority）
  - 输出：可查询角色清单与状态（idle/active/muted）
  - 验收：可动态读取至少 6 个角色并在运行时被路由读取

- [ ] 1.2 扩展聊天室角色可寻址能力
  - 支持在路由中识别并标准化 `@角色名`
  - 验收：`@清风`、`@明月`、`@二郎神` 可正确映射角色 ID

## 2. Activation Orchestration

- [ ] 2.1 实现显式激活（Mention-based）
  - 规则：出现 `@角色名` 即激活目标角色进入当前轮
  - 验收：未提及角色保持 idle，不触发推理

- [ ] 2.2 实现规则激活（Rule-based）
  - 依据意图分类触发角色组（如资讯类触发情报角色）
  - 验收：提供至少 4 条可配置规则并通过单测

- [ ] 2.3 增加激活约束与裁剪
  - 每轮最大激活数、优先级裁剪、深度限制协同
  - 验收：超限时产生 `droppedRoles` 且记录原因

## 3. Prompt Budgeting

- [ ] 3.1 落地 Prompt Composer 分区拼装
  - Core + Persona + Skills + Context
  - 验收：未激活角色 persona/skills 不进入 prompt

- [ ] 3.2 实现预算控制与裁剪顺序
  - 超预算裁剪：技能块 -> 历史细节 -> 非关键 persona
  - 验收：在压测输入下 prompt 长度稳定且 Core 保留

## 4. Memory Strategy

- [ ] 4.1 定义长期记忆结构与写入策略
  - 类型：decision/preference/procedure/news
  - 验收：可写入、去重、按类型检索

- [ ] 4.2 接入按意图检索策略
  - 故障、资讯、方案评审等意图对应不同记忆源
  - 验收：检索命中结果可在回复中引用 summary/evidence

## 5. Daily AI Intel Pipeline

- [ ] 5.1 建立定时抓取任务
  - 支持来源白名单、超时与失败重试
  - 验收：每日任务可运行并产出归档记录

- [ ] 5.2 实现去重、打标签、可信度评分
  - 验收：同源重复资讯不会重复入库

- [ ] 5.3 与长期记忆联动
  - 资讯以记忆条目形式存储，按需检索注入
  - 验收：资讯问题场景下可命中最近 24h 条目

## 6. Observability & Guardrails

- [ ] 6.1 Dashboard 增强
  - 展示 activeRoles、激活原因、droppedRoles、memory hit
  - 验收：可视化页能追踪每轮激活决策

- [ ] 6.2 成本与质量指标
  - 记录 prompt 长度、token、激活角色数、检索命中率
  - 验收：提供周维度统计输出

## 7. Verification

- [ ] 7.1 单元测试
  - 激活逻辑、预算裁剪、检索路由、资讯去重

- [ ] 7.2 集成测试
  - 多角色聊天室链路（含 `@` 唤醒与 idle 角色）

- [ ] 7.3 回归测试
  - 清风/明月双角色模式行为与现网兼容
