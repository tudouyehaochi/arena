## ADDED Requirements

### Requirement: Mobile viewport compatibility for chat room
The Arena chat web interface SHALL render and remain usable on phone-sized viewports without horizontal scrolling in the primary chat experience.

#### Scenario: Chat room opens on phone viewport
- **WHEN** a user opens an Arena chat room on a viewport width between 360px and 430px
- **THEN** the user can view room content and navigate core chat UI without horizontal scrolling

### Requirement: Mobile message compose and send
The system SHALL allow a user on a phone browser to compose and send chat messages through the same room workflow used on desktop.

#### Scenario: Send message from mobile browser
- **WHEN** a mobile user enters text in the chat input and submits it
- **THEN** the message is accepted and appears in the room message stream

### Requirement: Mobile real-time message updates
The system SHALL present new chat messages to mobile users in near real-time while keeping the compose area operable.

#### Scenario: Receive updates while input is focused
- **WHEN** new messages arrive while a mobile user is typing in the chat input
- **THEN** incoming messages are displayed without preventing the user from continuing to type and submit

### Requirement: Mobile touch interaction safety
Interactive chat controls on mobile SHALL provide touch-target-friendly interaction and avoid overlap with fixed browser UI regions.

#### Scenario: Tap primary chat actions
- **WHEN** a mobile user taps key actions (send, room switch controls, menu controls)
- **THEN** each action is tappable without accidental overlap or clipping in the viewport

### Requirement: Mobile browser support baseline
Mobile chat access SHALL be supported on current major versions of iOS Safari and Android Chrome.

#### Scenario: Access on supported mobile browsers
- **WHEN** a user opens the chat room in iOS Safari or Android Chrome on supported versions
- **THEN** the user can read messages, send messages, and receive updates without blocking UI defects

### Requirement: External network accessibility for mobile clients
The system SHALL support explicit runtime configuration that enables chatroom access from devices outside localhost.

#### Scenario: Mobile client connects from another device
- **WHEN** Arena is started with external-access configuration enabled and a phone accesses the exposed address
- **THEN** the phone can load the chat UI and perform core chat operations without requiring local host-only access

### Requirement: Public endpoint consistency
When external access is enabled, user-facing connection information SHALL use the configured public address instead of localhost-only values.

#### Scenario: Startup and client connection metadata use public address
- **WHEN** the service is configured with a public base URL for external access
- **THEN** startup logs and client-consumed connection metadata expose the configured public address rather than localhost defaults
