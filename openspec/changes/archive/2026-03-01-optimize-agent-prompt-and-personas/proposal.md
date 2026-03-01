## Why

Arena 当前 agent prompt 中存在较多常驻规则与上下文重复注入，导致 token 输入偏高，且清风/明月的人格表达还不够稳定。需要在不牺牲任务执行能力的前提下，重构 prompt 架构，实现“更省 token + 角色更鲜明”。

## What Changes

- 将 prompt 从“长常驻规则”调整为“短核心规则 + 按需技能包（skills）”的结构。
- 优化 meta-rule，保留高约束力最小集合，并将可程序化约束下沉到 runtime guard，减少每轮提示长度。
- 为清风与明月建立稳定人格配置，并在 prompt 生成时注入一致语气与行为边界。
  - 清风：男生，小道童，严谨、不服输，偶尔害羞。
  - 明月：女生，小道童，开朗活泼、可爱、不冷场。
- 增加 prompt token 预算目标与观测指标（如 promptChars 分位数、单轮调用输入规模）用于验证降耗效果。

## Capabilities

### New Capabilities
- `agent-prompt-skill-composition`: 基于任务类型按需组合技能包的 prompt 生成能力。
- `agent-persona-profile`: 清风/明月人格配置与一致性注入能力。
- `prompt-token-budgeting`: prompt 输入预算约束与观测能力。

### Modified Capabilities
- None.

## Impact

- Affected code:
  - prompt 构建链路（如 `lib/prompt-builder.js`、`run-arena.js`）
  - 运行时约束与路由协作边界（如 `lib/a2a-router.js` 及相关 guard）
- APIs/systems:
  - 不新增外部 API；主要影响内部 prompt 结构与 agent 行为策略。
- Dependencies:
  - 无必须新增第三方依赖；优先复用现有 metrics（`agent-metrics.log`）与上下文机制。
