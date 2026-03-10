## Context

该优化 change 是 `heavenly-agent-orchestration` 的运行保障层，目标不是增加角色功能，而是让系统在“更多角色 + 更长会话 + 更多外部资讯”情况下仍然稳定、可控、可调。

## Design Goals

- 成本可控：避免因角色扩展导致 token 与调用数线性爆炸。
- 质量可测：可量化“激活是否正确、检索是否有用、回复是否增益”。
- 故障可退：外部依赖异常时系统自动降级而非整体失效。
- 变更可回滚：所有优化开关支持逐项开闭。

## Architecture

### 1) Budget Controller

新增统一预算控制器（按轮次决策）：
- `activationBudget`: 本轮最多激活角色数。
- `promptBudget`: 本轮最大 prompt token/char。
- `retrievalBudget`: 本轮检索条目上限。

控制流程：
1. router 产出候选角色。
2. 预算控制器按优先级和收益评分筛选最终激活列表。
3. prompt builder 根据预算裁剪 sections。
4. memory retrieval 在预算内返回 top-k。

### 2) Quality Evaluator

新增轻量质量评估链路：
- 激活质量：`activation_precision_proxy`（被激活角色是否真正输出了有效贡献）。
- 检索质量：`retrieval_hit_rate`（检索条目被引用比例）。
- 回答质量代理：`actionable_reply_rate`（含可执行结论/步骤的比例）。

实现方式：
- 在现有 metrics log 基础上增加结构化字段。
- 提供离线回放脚本对样本房间进行评估。

### 3) Fallback & Circuit Breaker

分级降级策略：
- L1：关闭低优先级角色自动激活，仅保留 @唤醒 + 主角色。
- L2：检索降级为短期记忆，不查长期记忆与资讯库。
- L3：切换为 summary-only prompt（最小上下文）。

熔断触发条件（可配置）：
- 连续 N 次调用超时。
- 单房间 token 消耗超过阈值。
- 外部资讯源失败率超过阈值。

### 4) Memory Hygiene

长期记忆维护策略：
- 写入去重（语义近似 + 来源签名）。
- 衰减与 TTL（资讯类短 TTL，决策类长 TTL）。
- 周期清理与压缩（保留高 confidence 条目）。

### 5) Observability

新增 dashboard/metrics 字段：
- 每轮：`candidateRoles`, `activeRoles`, `droppedRoles`, `dropReasons`
- 成本：`promptChars`, `inputTokens`, `outputTokens`, `retrievalCount`
- 质量：`activationPrecisionProxy`, `retrievalHitRate`
- 运行状态：`degradeLevel`, `circuitOpen`

## Config Surface

建议新增环境变量：
- `ARENA_ACTIVATION_BUDGET_PER_TURN` (default: 2)
- `ARENA_PROMPT_BUDGET_CHARS` (default: 12000)
- `ARENA_RETRIEVAL_TOPK` (default: 5)
- `ARENA_DEGRADE_ENABLED` (default: 1)
- `ARENA_CIRCUIT_BREAKER_ENABLED` (default: 1)
- `ARENA_CIRCUIT_ERROR_WINDOW` (default: 5)

## Rollout

### Phase 1
- 指标埋点与预算控制器（只观测、不拦截）。

### Phase 2
- 启用预算裁剪与 L1/L2 降级。

### Phase 3
- 启用熔断器与自动恢复机制，完成回放评估。

## Risks

- 风险：过度裁剪导致回答质量下降。
  - 方案：先 shadow mode 评估，再逐步放量。
- 风险：指标噪声大导致误判。
  - 方案：使用滑动窗口与最小样本阈值。
