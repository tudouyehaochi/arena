## ADDED Requirements

### Requirement: Core-and-skill prompt composition
The system SHALL construct agent prompts using a compact core section and conditionally injected skill capsules relevant to the current task context.

#### Scenario: Coding task receives coding skill capsule
- **WHEN** incoming context is classified as coding-related
- **THEN** the generated prompt includes coding skill guidance and omits unrelated skill capsules

### Requirement: Minimal always-on meta rules
The prompt core SHALL contain only a minimal invariant rule set required for safe and effective execution.

#### Scenario: Non-coding interaction uses minimal core
- **WHEN** context is non-coding and no special skill capsule is required
- **THEN** the generated prompt includes only core invariants and essential context payload

### Requirement: Skill capsule composability
The system SHALL support combining multiple compatible skill capsules within one prompt when task context requires it.

#### Scenario: Review-and-fix request combines review and coding skills
- **WHEN** a request includes both defect review and code change intent
- **THEN** the generated prompt includes both relevant skill capsules in deterministic order
