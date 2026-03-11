### Requirement: Admin UX supports role/skill/network/schedule operations
The system SHALL provide a structured admin UX that supports role preset sync, skill management, network policy, and scheduler operations.

#### Scenario: Admin configures network policy
- **WHEN** admin updates policy in the network section
- **THEN** policy is persisted and visible in effective policy preview

### Requirement: Chat telemetry is layered and readable
The system SHALL present chat telemetry in layered form for quick understanding.

#### Scenario: Bubble shows layered telemetry
- **WHEN** role message is rendered
- **THEN** bubble shows model/tokens, skill used/trimmed, and activation/memory indicators without obscuring message content
