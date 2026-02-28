# Arena Test Plan

This plan defines end-to-end test coverage for Arena.  
Status tags:
- `AUTO`: already automated in `tests/*.test.js`
- `MANUAL`: manual or integration command
- `TODO`: not implemented yet

## 1) Auth & Security
- `AUTH-01` Valid Bearer token auth succeeds (`AUTO`)
- `AUTH-02` JTI replay blocked (`AUTO`)
- `AUTH-03` Wrong token rejected (`AUTO`)
- `AUTH-04` Expired token rejected (`TODO`)
- `AUTH-05` Unknown WS session rejected (`AUTO`)
- `AUTH-06` `/api/ws-token` anonymous -> human token (`AUTO`)
- `AUTH-07` `/api/ws-token` valid auth -> agent token (`AUTO`)
- `AUTH-08` `/api/ws-token` invalid auth rejected (`AUTO`)
- `AUTH-09` `/api/agent-snapshot` requires auth (`AUTO`)
- `AUTH-10` `/api/agent-snapshot?summary=1` requires auth (`TODO`)

## 2) Message Store & Snapshot
- `STORE-01` Message seq monotonic increasing (`AUTO`)
- `STORE-02` Snapshot has cursor/messages (`AUTO`)
- `STORE-03` Agent turn count increments (`AUTO`)
- `STORE-04` Human message resets agent turn count (`AUTO`)
- `STORE-05` Summarized snapshot format (`AUTO`)
- `STORE-06` Memory cap for messages (`TODO`)

## 3) API Handlers
- `API-01` Callback post writes message and returns seq (`TODO`)
- `API-02` Empty callback post returns `silent` (`TODO`)
- `API-03` Oversized body returns `413` (`TODO`)
- `API-04` Invalid JSON returns `400` (`TODO`)
- `API-05` Snapshot `since` returns incremental messages (`TODO`)

## 4) WebSocket
- `WS-01` History pushed on connect (`MANUAL`)
- `WS-02` Anonymous cannot spoof `清风/明月` (`MANUAL`)
- `WS-03` Agent session can post as `清风/明月` (`MANUAL`)
- `WS-04` Broadcast fanout to multiple clients (`MANUAL`)
- `WS-05` Ping/pong heartbeat for stale socket cleanup (`TODO`)

## 5) Prompt & Context
- `PROMPT-01` Core rule block exists in prompt (`AUTO`)
- `PROMPT-02` Coding context activates coding skill block (`AUTO`)
- `PROMPT-03` Non-coding context skips coding block (`AUTO`)
- `PROMPT-04` Structured context includes goal/highlights/files (`TODO`)
- `PROMPT-05` Session summary load/save cycle (`AUTO`)

## 6) MCP Tools
- `MCP-FILE-01` `arena_read_file` default full text (`AUTO`)
- `MCP-FILE-02` `mode=summary` returns concise output (`TODO`)
- `MCP-FILE-03` range >220 lines rejected (`TODO`)
- `MCP-FILE-04` path traversal blocked (`AUTO`)
- `MCP-GIT-01` blocked git command patterns (`AUTO`)
- `MCP-GIT-02` commit to main/master blocked (`TODO`)
- `MCP-GIT-03` commit message shell injection blocked (`TODO`)
- `MCP-TEST-01` run_test whitelist enforcement (`TODO`)

## 7) Runner & Process
- `RUNNER-01` first poll initializes cursor only (`TODO`)
- `RUNNER-02` dedupe by `lastHumanMsgSeq` (`TODO`)
- `RUNNER-03` codex-unavailable fallback works (`TODO`)
- `RUNNER-04` fallback branch does not duplicate same user msg (`TODO`)
- `RUNNER-05` graceful shutdown cleans MCP registration (`TODO`)
- `RUNNER-06` metrics log row written per invoke (`TODO`)

## 8) CLI
- `CLI-01` `cli-entry.js` usage + exit code on missing args (`AUTO`)
- `CLI-02` legacy `unified-cli.js` direct execution behavior (`TODO`)
- `CLI-03` timeout watchdog kills stuck process (`TODO`)
- `CLI-04` resume behavior for claude/codex (`TODO`)

## 9) Frontend
- `UI-01` default username is `镇元子` (`MANUAL`)
- `UI-02` browser fetches ws-token before websocket connect (`MANUAL`)
- `UI-03` reconnect on socket close (`MANUAL`)
- `UI-04` message renders both `text` and `content` (`MANUAL`)
- `UI-05` markdown rendering support (`TODO`)

## 10) Performance & Stability
- `PERF-01` 5k-message snapshot latency baseline (`TODO`)
- `PERF-02` long-running memory trend (`TODO`)
- `PERF-03` log rotation for `chatroom.log` and `agent-metrics.log` (`TODO`)
- `PERF-04` concurrent websocket clients stress (`TODO`)

## Commands
- Run automated tests: `npm test`
- Syntax checks: `node --check server.js run-arena.js agent-arena-mcp.js`
- Manual smoke:
  - Open UI: `http://localhost:3000`
  - Verify env: `curl --noproxy '*' -sS http://localhost:3000/api/env`
