## 1. Metrics & Baseline

- [x] 1.1 扩展运行日志结构
  - 增加 candidate/active/dropped roles、drop reason、retrieval count。
  - 验收：可按房间回放最近 100 轮调度决策。

- [x] 1.2 建立成本/质量基线报表
  - 输出 token 成本、激活数、检索命中率分布。
  - 验收：可生成按日统计结果。

## 2. Budget Control

- [x] 2.1 实现 activation budget 门控
  - 超预算按优先级+收益评分裁剪。
  - 验收：每轮激活角色不超过配置阈值。

- [x] 2.2 实现 prompt/retrieval 预算门控
  - prompt 超限按 section 裁剪；检索限制 top-k。
  - 验收：极端输入下 prompt 体积稳定。

## 3. Degrade & Circuit Breaker

- [x] 3.1 实现三级降级策略（L1/L2/L3）
  - 验收：触发后系统持续可响应，且可自动恢复。

- [x] 3.2 引入熔断器
  - 连续异常达到阈值后打开熔断并上报告警。
  - 验收：故障注入测试可观察到熔断状态变化。

## 4. Memory Hygiene

- [x] 4.1 实现记忆去重与 TTL 策略
  - 资讯短 TTL、决策长 TTL。
  - 验收：重复写入明显下降，检索噪声降低。

- [x] 4.2 增加记忆质量评分
  - 结合 evidence/source/confidence 计算可检索权重。
  - 验收：低质量条目在 top-k 命中率下降。

## 5. Verification

- [x] 5.1 单测
  - 预算门控、降级策略、熔断条件、记忆去重。

- [x] 5.2 集成测试
  - 高负载聊天场景下延迟与错误率可控。

- [x] 5.3 回归测试
  - 清风/明月现有主流程行为无回归。
