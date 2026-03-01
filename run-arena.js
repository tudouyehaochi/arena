const path = require('path');
const fs = require('fs');
const { buildPrompt } = require('./lib/prompt-builder');
const memory = require('./lib/session-memory');
const { startRealtimeListener } = require('./lib/realtime-listener');
const { createAgentRuntime } = require('./lib/agent-runtime');
const { createA2ARouter } = require('./lib/a2a-router');
const { acquireRunnerLock, renewRunnerLock, releaseRunnerLock } = require('./lib/runner-lock');
const { runAgentProcess } = require('./lib/runner-process');
const { httpGetJson } = require('./lib/runner-http');
const { currentBranch } = require('./lib/env');
const { inferEnvironment, resolvePort } = require('./lib/runtime-config');
const { DEFAULT_ROOM_ID, AGENT_NAMES, resolveRoomId } = require('./lib/room');
const redis = require('./lib/redis-client');

const BRANCH = currentBranch();
const RUNTIME_ENV = inferEnvironment(process.env.ARENA_ENVIRONMENT);
const PORT = resolvePort({ port: process.env.PORT, environment: RUNTIME_ENV, branch: BRANCH });
const INSTANCE_ID = process.env.ARENA_INSTANCE_ID || `${RUNTIME_ENV}:${BRANCH}:${PORT}`;
const ROOM_ID = resolveRoomId(process.env.ARENA_ROOM_ID || DEFAULT_ROOM_ID);
const API_URL = process.env.ARENA_API_URL || `http://localhost:${PORT}`;
const INVOCATION_ID = process.env.ARENA_INVOCATION_ID;
const CALLBACK_TOKEN = process.env.ARENA_CALLBACK_TOKEN;
const AUTH_HEADER = `Bearer ${INVOCATION_ID}:${CALLBACK_TOKEN}`;
const POLL_INTERVAL = parseInt(process.env.ARENA_POLL_INTERVAL || '5000', 10);
const MAX_AGENT_TURNS = 3;
const MAX_A2A_DEPTH = parseInt(process.env.ARENA_MAX_A2A_DEPTH || '4', 10);
const MAX_TASKS_PER_POLL = parseInt(process.env.ARENA_MAX_TASKS_PER_POLL || '2', 10);
const SESSION_REBUILD_EVERY = parseInt(process.env.ARENA_SESSION_REBUILD_EVERY || '6', 10);
const REQUEST_TIMEOUT_MS = 10000;
const METRICS_LOG = path.join(__dirname, 'agent-metrics.log');
const SUMMARY_PATH = path.join(__dirname, `session-summary.${ROOM_ID}.json`);
const MCP_SCRIPT = path.join(__dirname, 'agent-arena-mcp.js');
const AGENTS = new Set(AGENT_NAMES);
if (!INVOCATION_ID || !CALLBACK_TOKEN) process.exit(1);

const runnerEnv = {
  ...process.env,
  ARENA_API_URL: API_URL,
  ARENA_INVOCATION_ID: INVOCATION_ID,
  ARENA_CALLBACK_TOKEN: CALLBACK_TOKEN,
  ARENA_ENVIRONMENT: RUNTIME_ENV,
  ARENA_INSTANCE_ID: INSTANCE_ID,
  ARENA_TARGET_PORT: String(PORT),
  ARENA_ROOM_ID: ROOM_ID,
};
delete runnerEnv.CLAUDECODE;

const runCommand = (cmd, args, label, signal) => runAgentProcess({ cmd, args, label, env: runnerEnv, signal });
const agentRuntime = createAgentRuntime({ API_URL, INVOCATION_ID, CALLBACK_TOKEN, RUNTIME_ENV, INSTANCE_ID, TARGET_PORT: PORT, ROOM_ID, runCommand, MCP_SCRIPT });

let lastSeenCursor = null;
let sessionSummary = null;
let invokeCount = 0;
let router = null;
let running = true;
let activeAbort = null;
let wakeResolver = null;
let lock = null;
let renewTimer = null;

function wakePolling(reason) {
  if (!wakeResolver) return;
  const fn = wakeResolver;
  wakeResolver = null;
  console.log(`[listen] wake poll (${reason})`);
  fn();
}

function waitTick(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { wakeResolver = null; resolve(); }, ms);
    wakeResolver = () => { clearTimeout(t); resolve(); };
  });
}

function logInvoke(task, prompt, count, summaryOnly) {
  const row = {
    ts: new Date().toISOString(), roomId: ROOM_ID, agent: task.target, promptChars: prompt.length,
    recentCount: count, summaryOnly, route: { sourceSeq: task.sourceSeq, sourceFrom: task.sourceFrom, depth: task.depth },
  };
  fs.appendFileSync(METRICS_LOG, JSON.stringify(row) + '\n');
}

async function invokeTask(task, recentMessages) {
  const promptMessages = (invokeCount > 0 && invokeCount % SESSION_REBUILD_EVERY === 0)
    ? recentMessages.slice(-2)
    : recentMessages;
  const prompt = buildPrompt(task.target, promptMessages, { sessionSummary });
  logInvoke(task, prompt, promptMessages.length, promptMessages.length <= 2);
  const rt = agentRuntime[task.target];
  const controller = new AbortController();
  activeAbort = controller;
  try {
    await runCommand(rt.cmd, rt.buildArgs(prompt), `${task.target} (${rt.cmd === 'claude' ? 'Claude' : 'Codex'})`, controller.signal);
    invokeCount++;
    router.noteAgentInvocation(task.target, task.depth);
  } finally {
    activeAbort = null;
  }
}

async function pollOnce() {
  const q = lastSeenCursor ? `?since=${lastSeenCursor}&roomId=${encodeURIComponent(ROOM_ID)}` : `?roomId=${encodeURIComponent(ROOM_ID)}`;
  const snapshot = await httpGetJson(`${API_URL}/api/agent-snapshot${q}`, AUTH_HEADER, REQUEST_TIMEOUT_MS);
  if (lastSeenCursor !== null && snapshot.cursor === lastSeenCursor) return;
  if (lastSeenCursor === null) { lastSeenCursor = snapshot.cursor; console.log(`[poll] cursor=${lastSeenCursor} room=${ROOM_ID}`); return; }
  lastSeenCursor = snapshot.cursor;

  const recentMessages = snapshot.messages || [];
  if (recentMessages.length > 0) {
    sessionSummary = memory.summarizeMessages(recentMessages);
    await memory.saveSummary(sessionSummary, SUMMARY_PATH, `room:${ROOM_ID}:session:summary`);
  }

  const route = await router.ingest(recentMessages);
  if (route.cancelRequested && activeAbort) {
    console.log('[route] cancel requested by human');
    activeAbort.abort();
  }
  for (const d of route.dropped) console.log(`[route] dropped ${d.reason} target=${d.target} depth=${d.depth}`);

  let processed = 0;
  while (processed < MAX_TASKS_PER_POLL) {
    const task = router.nextTask();
    if (!task) break;
    if (snapshot.consecutiveAgentTurns >= MAX_AGENT_TURNS && AGENTS.has(task.sourceFrom)) continue;
    if (!agentRuntime[task.target].canRun()) continue;
    console.log(`[route] exec target=${task.target} depth=${task.depth} source=${task.sourceFrom}#${task.sourceSeq}`);
    await invokeTask(task, recentMessages);
    processed++;
  }
}

async function main() {
  console.log('=== Arena Agent Runner ===');
  console.log(`API: ${API_URL} | Room: ${ROOM_ID} | Poll: ${POLL_INTERVAL}ms | MaxDepth: ${MAX_A2A_DEPTH}`);
  redis.startConnect();
  await redis.waitUntilReady(5000);
  router = createA2ARouter({ roomId: ROOM_ID, redisClient: redis.getClient(), agents: AGENT_NAMES, maxDepth: MAX_A2A_DEPTH, defaultAgent: '清风' });
  sessionSummary = await memory.loadSummary(SUMMARY_PATH, `room:${ROOM_ID}:session:summary`);
  lock = await acquireRunnerLock(redis.getClient(), ROOM_ID, `${INSTANCE_ID}:${process.pid}`);
  renewTimer = setInterval(async () => {
    const ok = await renewRunnerLock(redis.getClient(), lock).catch(() => false);
    if (!ok) { console.error('[lock] lost runner lock, exiting'); process.exit(1); }
  }, 10000);
  renewTimer.unref();

  await Promise.all([agentRuntime.清风.setup().catch(() => {}), agentRuntime.明月.setup().catch(() => {})]);
  const listener = startRealtimeListener({
    apiUrl: API_URL,
    authHeader: AUTH_HEADER,
    roomId: ROOM_ID,
    onStateChange: (state) => console.log(`[listen] ${state}`),
    onMessage: (msg) => { if (msg?.type === 'chat' && msg?.roomId === ROOM_ID) wakePolling(`chat from ${msg.from}`); },
  });

  const shutdown = async () => {
    running = false;
    listener.stop();
    if (activeAbort) activeAbort.abort();
    if (renewTimer) clearInterval(renewTimer);
    await Promise.all([agentRuntime.清风.cleanup().catch(() => {}), agentRuntime.明月.cleanup().catch(() => {})]);
    if (lock) await releaseRunnerLock(redis.getClient(), lock).catch(() => {});
    await redis.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  let errors = 0;
  while (running) {
    try { await pollOnce(); errors = 0; }
    catch (err) {
      errors++;
      const backoff = Math.min(POLL_INTERVAL * Math.pow(2, errors), 60000);
      console.error(`[poll error #${errors}] ${err.message}`);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    await waitTick(POLL_INTERVAL);
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
