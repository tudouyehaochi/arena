# Arena Test Cases

## Scope
This document describes all current automated tests (`58` total) under `tests/*.test.js`.

## basic.test.js

### auth suite (6)
1. getCredentials returns invocationId, callbackToken, jti: verify credential payload fields exist.
2. authenticate succeeds with valid Bearer header: valid callback auth is accepted.
3. authenticate fails with wrong token: invalid token is rejected.
4. jti replay is blocked: one-time jti cannot be reused.
5. issueWsSession and validateWsSession round-trip: WS session token can be validated.
6. validateWsSession rejects unknown token: unknown WS token is rejected.

### message-store suite (5)
7. addMessage assigns seq and timestamp: message gains monotonic seq and timestamp.
8. getSnapshot returns cursor and messages: snapshot has expected structure.
9. consecutiveAgentTurns increments for agents: agent-turn counter increments and resets by human.
10. isAgent identifies agent names: only agent names are treated as agents.
11. getSummarizedSnapshot returns compact format: summarized snapshot contains compact fields.

### mcp-git-tools suite (4)
12. blocked patterns catch push to main: push to main/master blocked.
13. blocked patterns catch force push: force push blocked.
14. blocked patterns catch hard reset: hard reset blocked.
15. allowed commands include safe operations: safe git commands are allowed.

### mcp-file-tools safePath suite (3)
16. allows paths within project root: in-root paths are allowed.
17. blocks path traversal: traversal paths are denied.
18. blocks absolute path outside root: out-of-root absolute paths denied.

### message-util suite (4)
19. normalizeMessage fills defaults: default fields applied.
20. normalizeMessage extracts text field: `text` normalized to `content`.
21. clipText truncates long text: long text is clipped with ellipsis.
22. clipText leaves short text unchanged: short text unchanged.

## redis.test.js

### withFallback degradation suite (3)
23. runs fallback when Redis is not ready: fallback path works when redis unavailable.
24. runs fallback when redisFn throws: fallback path works on redis error.
25. isReady returns false when no connection: readiness state is false offline.

### message-store addMessage (no Redis) suite (3)
26. addMessage returns message with seq (async): seq works without redis.
27. addMessage increments seq monotonically: seq remains monotonic.
28. getSnapshot returns correct structure after async addMessage: snapshot still valid.

### redis-context (no Redis fallback) suite (4)
29. setAgentContext does not throw without Redis: write is graceful.
30. getAgentContext returns null without Redis: read falls back to null.
31. getAllAgentContext returns null entries without Redis: all-agent read degrades safely.
32. getSharedGoals returns empty array without Redis: shared goals fallback is empty list.

### session-memory async (no Redis) suite (2)
33. loadSummary works without Redis: summary load fallback works.
34. summarizeMessages returns valid summary: summary structure is valid.

## regression.test.js

### route-handlers auth regression suite (7)
35. GET /api/ws-token without Authorization issues human session: human WS token issued.
36. GET /api/ws-token with valid Authorization issues agent session: agent WS token issued.
37. GET /api/ws-token with invalid Authorization is rejected: invalid auth denied.
38. GET /api/agent-snapshot without Authorization is rejected: snapshot endpoint protected.
39. GET /api/agent-snapshot with Authorization returns snapshot: snapshot returns with auth.
40. POST /api/callbacks/post-message rejects env mismatch: callback scope mismatch rejected.
41. POST /api/callbacks/post-message deduplicates by idempotency key: duplicate callback deduped.

### prompt-builder regression suite (2)
42. coding context contains core rules and coding skill: coding prompt includes meta/coding rules.
43. non-coding context still contains core rules: non-coding prompt keeps meta rules.

### mcp-file-tools default behavior suite (1)
44. arena_read_file defaults to full numbered content: default read mode returns full numbered file.

### cli-entry regression suite (1)
45. cli-entry with missing args exits non-zero and prints usage: CLI input validation/usage output.

## room-isolation.test.js

### room isolation suite (3)
46. store keeps room messages separated: room A/B messages are isolated.
47. ws token is room-scoped: WS token cannot be reused across rooms.
48. callback post requires roomId: callback must include roomId.

## runtime-config.test.js

49. resolvePort: prod defaults to 3001: prod default port policy.
50. resolvePort: master branch defaults to 3001: master default port policy.
51. resolvePort: dev non-main defaults to 3000: dev default port policy.
52. resolvePort: explicit port wins: explicit port overrides defaults.
53. resolveApiUrl: uses provided api url first: explicit api url precedence.
54. resolveApiUrl: falls back to localhost with resolved port: default api url generation.

## room-management.test.js

55. listRooms does not resurrect deleted room from backup log only: stale log lines cannot bring a deleted room back.
56. create room rejects duplicate room id: duplicate room creation returns conflict.
57. deleteRoom removes backup log content and allows clean re-create: delete cleans backup data and re-create starts empty.
58. delete then create same room id succeeds via handlers: after delete API succeeds, create API can re-create the same room id.

## Notes
- Current test command: `npm test`.
- Current expected result: `58/58 pass`.
