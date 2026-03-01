## 1. Prompt Architecture Refactor

- [x] 1.1 Refactor prompt builder into compact core section plus conditional skill-capsule composition pipeline.
- [x] 1.2 Implement deterministic skill-capsule selection rules for at least coding, review, and planning contexts.
- [x] 1.3 Ensure non-coding and low-complexity requests render minimal core-only prompt output.

## 2. Persona Profile System

- [x] 2.1 Introduce structured persona profiles for Qingfeng and Mingyue with explicit style fields and behavioral constraints.
- [x] 2.2 Wire persona profile injection into prompt generation while preserving shared safety and evidence rules.
- [x] 2.3 Add validation checks to guarantee persona style never overrides correctness/safety constraints.

## 3. Token Budgeting and Metrics

- [x] 3.1 Define baseline and target thresholds for prompt-size optimization using recent invocation metrics.
- [x] 3.2 Extend prompt metrics logging and reporting to support p50/p90 trend comparison by room and route context.
- [x] 3.3 Add regression detection check for prompt-size increase beyond configured threshold.

## 4. Verification and Rollout

- [x] 4.1 Run A/B evaluation between legacy and optimized prompt composition on representative task sets.
- [x] 4.2 Verify task quality and completion behavior remain acceptable after optimization.
- [x] 4.3 Enable optimized prompt mode as default with rollback toggle for legacy mode.
