## ADDED Requirements

### Requirement: Prompt budget targets
The system SHALL define explicit prompt input budget targets and use them as acceptance criteria for prompt optimization.

#### Scenario: Budget target evaluation
- **WHEN** prompt optimization changes are evaluated
- **THEN** prompt size metrics are compared against defined baseline and target thresholds

### Requirement: Prompt size observability
The system SHALL record prompt-size telemetry per invocation to support trend and regression analysis.

#### Scenario: Invocation metrics logging
- **WHEN** an agent invocation is executed
- **THEN** the system records prompt-size metadata sufficient to analyze token-input trends by room and route context

### Requirement: Prompt-size regression guard
The system SHALL provide a reviewable check that detects significant prompt-size regressions after optimization.

#### Scenario: Regression detected in prompt size
- **WHEN** recent prompt-size statistics exceed configured regression threshold relative to baseline
- **THEN** the system reports a regression signal for investigation before declaring optimization successful
