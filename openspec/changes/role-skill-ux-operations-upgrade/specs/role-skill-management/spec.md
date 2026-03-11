## ADDED Requirements

### Requirement: UX role Wenquxing exists as a first-class managed role
The system SHALL provide a default UX role named `文曲星` that can be managed in the same way as other roles.

#### Scenario: Wenquxing appears in role registry and admin
- **WHEN** the system initializes default roles
- **THEN** `文曲星` is available with role metadata, persona template fields, and skill bindings

### Requirement: Role management UI does not require raw JSON editing
The system SHALL provide structured UI for role editing and skill binding.

#### Scenario: Non-technical user edits a role
- **WHEN** an admin edits role settings in the console
- **THEN** they can configure persona, activation mode, skills, and priorities without writing JSON

### Requirement: Role activation mode is standardized
The system SHALL support exactly two activation modes: `mention` and `always_on`.

#### Scenario: Mention activation
- **WHEN** activation mode is `mention` and a message contains `@文曲星`
- **THEN** `文曲星` is activated for current turn

#### Scenario: Always-on activation
- **WHEN** activation mode is `always_on`
- **THEN** the role is included as default candidate each turn, subject to budget/depth constraints

### Requirement: Skill bindings support priority and recommendations
The system SHALL support high/medium/low priority for each bound skill and expose recommended priority.

#### Scenario: Priority-aware prompt composition
- **WHEN** prompt budget is constrained
- **THEN** lower priority skills are trimmed before higher priority skills

### Requirement: Chat bubbles show per-turn skill usage
The system SHALL expose and render skill usage metadata under role chat bubbles.

#### Scenario: Skill telemetry visible in chat
- **WHEN** a role responds in chat
- **THEN** the message bubble shows which skills were applied and their priorities
