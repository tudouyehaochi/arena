## 1. Responsive Layout Foundation

- [x] 1.1 Audit current chat UI containers and identify desktop-only layout assumptions that break below 430px width.
- [x] 1.2 Add mobile breakpoints and responsive style rules for chat shell, message list, and composer areas.
- [x] 1.3 Ensure primary chat experience has no horizontal scrolling between 360px/390px and 430px viewport widths.

## 2. Mobile Interaction Reliability

- [x] 2.1 Adjust chat composer behavior to stay visible and operable with mobile keyboard open/close transitions.
- [x] 2.2 Verify send-message flow on mobile viewport and fix any focus/submit regressions.
- [x] 2.3 Validate real-time message updates while typing and stabilize scroll/input behavior on mobile browsers.

## 3. Compatibility and Quality Gates

- [x] 3.1 Define and document supported mobile browser baseline (iOS Safari, Android Chrome) in project docs or QA checklist.
- [x] 3.2 Add automated or scripted viewport tests for core mobile chat flows (open room, read, send, receive).
- [x] 3.3 Run manual verification on representative iOS Safari and Android Chrome environments and record results.

## 4. External Network Access Enablement

- [x] 4.1 Add runtime configuration for network exposure (for example bind host/public base URL) with safe defaults.
- [x] 4.2 Ensure server startup and client connection metadata use configured public address values when external access is enabled.
- [x] 4.3 Validate end-to-end access from a phone on an external device/network path (LAN IP or routed domain), including message send/receive.
- [x] 4.4 Document deployment/security checks required before enabling external access (admin key handling, endpoint exposure scope, firewall/proxy notes).

## 5. Manual Verification Record

- [x] 5.1 Device: iPhone 14; OS: iOS 26.3; Browser: Chrome 145.0.7632.108; URL: http://192.168.0.104:3000/?roomId=default; Result: all steps for 3.3 and 4.3 passed.
