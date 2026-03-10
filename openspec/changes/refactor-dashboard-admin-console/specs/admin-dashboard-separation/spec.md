## ADDED Requirements

### Requirement: Chat and dashboard pages are separated by responsibility
The system SHALL keep `/` focused on chat interaction and expose monitoring/orchestration visualization on `/dashboard`.

#### Scenario: Chat page stays conversation-focused
- **WHEN** a user opens `/`
- **THEN** the page prioritizes message flow and input controls without coupling full monitoring panels

#### Scenario: Dashboard page exposes orchestration observability
- **WHEN** a user opens `/dashboard`
- **THEN** the page shows route/agent observability including active roles, reasons, dropped events, and retrieval metrics

### Requirement: Admin console uses a bootstrap API for first paint
The system SHALL provide `GET /api/admin/bootstrap` to aggregate data required by admin initial rendering.

#### Scenario: Single-request admin bootstrap
- **WHEN** admin page finishes authentication
- **THEN** it can render core sections using a single bootstrap response without chaining multiple initial requests

### Requirement: Role presentation is sourced from Redis registry
The system SHALL use Redis Role Registry as the single source of truth for role metadata in chat/dashboard/admin pages.

#### Scenario: Role metadata consistency
- **WHEN** a role is updated in Redis registry
- **THEN** chat/dashboard/admin displays converge to the same role metadata (name/model/avatar/color/status)
