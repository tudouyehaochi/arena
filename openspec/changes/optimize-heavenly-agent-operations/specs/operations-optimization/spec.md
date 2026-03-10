## ADDED Requirements

### Requirement: Turn-level budget governance
The system SHALL enforce configurable per-turn budgets for role activation, prompt size, and retrieval count.

#### Scenario: Activation is capped
- **WHEN** the router returns more candidate roles than `ARENA_ACTIVATION_BUDGET_PER_TURN`
- **THEN** the system only activates roles within budget and records dropped roles with reasons

### Requirement: Progressive degrade under pressure
The system SHALL degrade gracefully in levels instead of failing hard when runtime pressure or dependency errors exceed thresholds.

#### Scenario: Degrade level escalates
- **WHEN** timeout/error metrics exceed configured window thresholds
- **THEN** the system escalates from L1 to L2/L3 degrade policies and keeps chat response path available

### Requirement: Retrieval quality-aware ranking
The system SHALL rank long-term memory retrieval results by quality score and confidence.

#### Scenario: Low-quality memory is deprioritized
- **WHEN** retrieval candidates contain mixed confidence and evidence completeness
- **THEN** lower-quality items are ranked below high-confidence items in top-k results

### Requirement: Circuit breaker with recovery
The system SHALL open a circuit breaker after repeated runtime failures and automatically recover after a cool-down period.

#### Scenario: Circuit opens and recovers
- **WHEN** consecutive failures exceed `ARENA_CIRCUIT_ERROR_WINDOW`
- **THEN** the circuit is opened, low-cost fallback is used, and the system retries recovery after cool-down
