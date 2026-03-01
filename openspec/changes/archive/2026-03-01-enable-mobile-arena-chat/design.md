## Context

Arena chat currently assumes desktop viewport dimensions and interaction density. Core chat operations must remain available on phone browsers without introducing a separate app or breaking existing desktop behavior. In addition, practical phone usage requires the chatroom to be reachable from outside localhost (for example, LAN devices or externally routed domains), which is not guaranteed by the current local-first runtime setup. The project serves web assets from the existing Node service, so mobile support should be delivered in the same deployment path.

## Goals / Non-Goals

**Goals:**
- Provide reliable mobile browser access to chat rooms on common phone widths.
- Preserve core chat flows on mobile: message list readability, composing/sending messages, receiving updates.
- Keep desktop behavior backward compatible while introducing mobile-specific layout adjustments.
- Establish explicit compatibility and performance expectations for mobile usage.
- Support explicit runtime configuration for external network reachability used by phones.

**Non-Goals:**
- Building native iOS/Android applications.
- Redesigning all desktop information-dense views for parity with mobile.
- Introducing server-side API breaking changes only for mobile.
- Full internet-facing hardening and zero-trust perimeter redesign.

## Decisions

1. Responsive-first enhancement in existing web client
- Decision: implement mobile support with CSS breakpoints and small interaction/layout adjustments in current frontend code.
- Rationale: fastest path with lowest operational complexity; preserves single codebase and deployment route.
- Alternatives considered:
  - Separate mobile web bundle: rejected due to duplicated UI logic and higher maintenance.
  - Native app: rejected as out of scope and slower to deliver.

2. Mobile baseline viewport and browser support contract
- Decision: define a baseline viewport width range (roughly 360px-430px) and require support for modern Safari and Chrome mobile browsers.
- Rationale: creates a measurable acceptance boundary and test matrix.
- Alternatives considered:
  - “Best effort” only: rejected because it is hard to validate and regressions are likely.

3. Add explicit external-network runtime configuration
- Decision: introduce runtime configuration for network exposure (for example bind host and public base URL) so the same server can run in local-only or externally reachable mode.
- Rationale: mobile support is incomplete if off-device clients cannot reach the service; explicit configuration avoids hidden environment coupling.
- Alternatives considered:
  - Keep implicit localhost/default URLs: rejected because phone access fails in many real setups.
  - Hard-code public addresses: rejected because environments vary (LAN IP, tunnel, reverse proxy, domain).

4. Preserve API contracts and handle mobile with presentation and runtime-layer changes
- Decision: keep existing chat transport and endpoints unchanged unless a clear UX blocker appears.
- Rationale: minimizes backend risk and avoids multi-client protocol drift.
- Alternatives considered:
  - Mobile-specific endpoints: rejected due to added complexity and versioning cost.

5. Prioritize interaction safety on small screens
- Decision: enforce touch-friendly controls, fixed message input visibility, and no horizontal scrolling in primary chat flow.
- Rationale: small-screen usability failures are the main barrier to mobile adoption.
- Alternatives considered:
  - Minimal style-only tweaks without interaction checks: rejected due to high chance of unusable flows.

## Risks / Trade-offs

- [Risk] Existing dense desktop components may collapse poorly at narrow widths.
  → Mitigation: establish explicit breakpoint behavior per major chat panel and add viewport-based test coverage.

- [Risk] Real-time updates may cause input jump/scroll issues on mobile browsers.
  → Mitigation: validate auto-scroll and input focus behavior on Safari + Chrome mobile and add regression checks.

- [Risk] External exposure may unintentionally reveal admin or callback endpoints.
  → Mitigation: document secure deployment defaults, require explicit admin key handling, and verify endpoint protections before enabling broad exposure.

- [Trade-off] One responsive UI keeps maintenance low but may limit aggressive mobile-specific optimization.
  → Mitigation: preserve extension points for future mobile-focused variants if needed.
