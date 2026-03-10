## ADDED Requirements

### Requirement: All configured roles are chatroom-addressable
The system SHALL allow all configured roles in the heavenly roster to connect to Arena chatrooms with distinct role identities.

#### Scenario: Role identity is available in chatroom
- **WHEN** the orchestration service initializes a room session
- **THEN** each configured role has an addressable identity that can be referenced in routing and `@` mentions

### Requirement: Presence does not imply continuous inference
The system SHALL keep roles chatroom-connected without forcing each role to run inference on every turn.

#### Scenario: Non-triggered role remains idle
- **WHEN** a message does not match a role's activation rule and does not include an `@` mention to that role
- **THEN** the role remains idle for that turn while staying available for future activation

### Requirement: Mention-based explicit activation
The system SHALL activate a role for the current discussion when the role is explicitly mentioned using `@角色名`.

#### Scenario: Mention wakes target role
- **WHEN** a message includes `@二郎神`
- **THEN** 二郎神 is activated for the current turn and can contribute to the discussion output

### Requirement: Rule-based conditional activation
The system SHALL support deterministic activation rules that map topic intent to specific roles.

#### Scenario: News topic triggers intel roles
- **WHEN** a message intent is classified as AI news or updates
- **THEN** the configured intel roles (for example 千里眼 and 顺风耳) are activated according to policy

### Requirement: Prompt budget with dynamic role packing
The system SHALL assemble prompts by budgeted sections and include persona/skill blocks only for active roles.

#### Scenario: Inactive role prompt blocks are omitted
- **WHEN** a role is not active in the current turn
- **THEN** that role's persona and skill capsule are not included in the prompt payload for the turn
