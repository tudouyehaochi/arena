## Why

Arena chat is currently optimized for desktop usage and local-host access, which prevents phones from connecting unless they run on the same machine. Enabling mobile access now requires external network reachability so users can monitor and reply from phones in real environments.

## What Changes

- Add first-class mobile web support for the Arena chat interface.
- Ensure chat room core flows (view messages, send messages, receive updates) work reliably on common phone screen sizes.
- Add responsive layout behavior for key chat surfaces and controls.
- Add configurable external network access so phones can connect from outside localhost (for example via LAN IP or reverse-proxy domain).
- Define mobile-specific usability and compatibility requirements for browsers and interactions.

## Capabilities

### New Capabilities
- `mobile-chat-access`: Mobile web access and interaction requirements for Arena chatrooms.

### Modified Capabilities
- None.

## Impact

- Affected code: frontend chat UI in `public/` and server-side static/API paths in `server.js` if mobile routing or payload shaping is required.
- APIs/systems: existing chat endpoints and websocket/stream updates must remain compatible while working over externally reachable addresses.
- Dependencies: may require runtime network configuration (bind host/public base URL), deployment networking updates, and clearer security defaults for externally exposed admin/chat endpoints.
