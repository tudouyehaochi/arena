## Context

Arena currently uses a prompt-building pipeline where meta-rules, tools guidance, coding guidance, and session context are often bundled together in each invocation. This keeps behavior aligned but increases input tokens and can dilute role expression for Qingfeng and Mingyue. The change must preserve task execution capability while reducing prompt size and improving persona consistency.

## Goals / Non-Goals

**Goals:**
- Introduce a compact prompt architecture: short core rules + conditional skill capsules + budgeted context payload.
- Make Qingfeng and Mingyue persona behavior stable and distinguishable without requiring long repeated persona prose.
- Define measurable token-input budget targets and observability checks for prompt size changes.
- Keep existing runtime safety constraints and avoid breaking current tool-based workflows.

**Non-Goals:**
- Replacing model providers or adding new LLM infrastructure.
- Full conversational style redesign for all user-facing copy.
- Building complex adaptive memory systems beyond current summary/context mechanisms.

## Decisions

1. Split prompt into fixed core + conditional skill capsules
- Decision: keep a minimal always-on core section and inject only relevant skill capsules by intent/task classification.
- Rationale: static long prompts cause repeated token waste; conditional blocks lower average input size.
- Alternatives considered:
  - Keep one universal full prompt: rejected due to high repeated token cost.
  - Per-agent fully custom prompts with no shared core: rejected due to maintenance drift risk.

2. Move enforceable behavior from prompt text into runtime guards where possible
- Decision: retain only high-level non-negotiables in prompt and rely on existing guard logic for deterministic checks (status-loop prevention, queue/depth limits, etc.).
- Rationale: constraints enforced in code are cheaper and more reliable than repeating instructions each call.
- Alternatives considered:
  - Keep all guardrails in prompt only: rejected due to inconsistent compliance and token overhead.

3. Define persona profile as structured fields, not long narrative blocks
- Decision: represent each persona with compact fields (tone, social energy, conflict style, response rhythm) and inject compact behavior hints.
- Rationale: structured persona profile is cheaper, easier to tune, and more consistent.
- Alternatives considered:
  - Long persona story paragraphs: rejected for token cost and drift.

4. Introduce prompt budget targets and regressions checks
- Decision: add budget thresholds (for example p50/p90 prompt chars) and compare against recent baseline from metrics logs.
- Rationale: optimization must be measurable and protected from future regressions.
- Alternatives considered:
  - Optimize ad hoc without metrics: rejected due to unverifiable impact.

## Risks / Trade-offs

- [Risk] Over-compressing prompt may reduce task success on complex coding turns.
  → Mitigation: keep minimal core invariants and allow selective skill expansion for complex contexts.

- [Risk] Persona stylization may conflict with technical accuracy or brevity goals.
  → Mitigation: define persona constraints under execution-first rules (accuracy and evidence before style).

- [Trade-off] More modular prompt composition adds classification logic complexity.
  → Mitigation: start with simple deterministic routing rules and iterate only with measured gains.

## Migration Plan

1. Establish baseline metrics from recent `agent-metrics.log` (promptChars distribution by room/task type).
2. Implement core/skill/persona composition behind configuration flag.
3. Run A/B sessions on representative tasks and compare token/prompt metrics + task quality.
4. Switch default to optimized mode after acceptance criteria are met.
5. Keep rollback path by preserving legacy prompt builder mode toggle.

## Open Questions

- Should persona intensity be globally configurable per room (formal vs playful mode)?
- Should coding skill capsule include model-specific variants (Claude vs Codex) or stay provider-agnostic?
- What exact thresholds define acceptance (for example p50 and p90 promptChars reduction percentages)?
