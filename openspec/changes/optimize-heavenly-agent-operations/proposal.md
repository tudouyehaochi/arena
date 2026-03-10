## Why

`heavenly-agent-orchestration` 已定义了多角色联通与按需激活方向，但在真正落地前还缺少一套“运行优化计划”，确保系统在角色规模扩大后仍然保持低 token 成本、可预测延迟和可调试性。

## What Changes

- 建立多角色运行期的成本治理策略（激活预算、prompt 预算、检索预算）。
- 引入激活质量与路由质量评估机制，减少误激活和无效调用。
- 强化记忆检索质量控制（命中率、噪声率、过期策略）。
- 完善运行可观测与熔断降级策略，避免高峰期失控。

## Capabilities

### New Capabilities
- `agent-ops-cost-governance`: 角色激活和 prompt/token 预算治理。
- `agent-ops-quality-evaluation`: 激活/路由/检索质量评估与回放分析。
- `agent-ops-fallback-control`: 过载或异常时的分级降级与熔断能力。

### Modified Capabilities
- `agent-activation-orchestration`: 增加质量阈值与预算门控。
- `memory-tiered-retrieval`: 增加检索质量打分与淘汰策略。

## Impact

- Affected code:
  - `run-arena.js`, `lib/a2a-router.js`, `lib/prompt-builder.js`
  - `lib/session-memory.js`, `lib/runner-route-state.js`, dashboard handlers
- Affected runtime config:
  - 新增预算与阈值类环境变量（激活上限、检索上限、降级开关）
- Operational impact:
  - 增加指标采集和告警规则，支持按房间和按角色排查
