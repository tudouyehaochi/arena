const path = require('path');
const fs = require('fs');
const { buildPrompt } = require('./lib/prompt-builder');
const memory = require('./lib/session-memory');
const longMemory = require('./lib/long-memory');
const agentRegistry = require('./lib/agent-registry');
const { startRealtimeListener } = require('./lib/realtime-listener');
const { createAgentRuntime } = require('./lib/agent-runtime');
const { createA2ARouter } = require('./lib/a2a-router');
const { acquireRunnerLock, renewRunnerLock, releaseRunnerLock } = require('./lib/runner-lock');
const { runAgentProcess } = require('./lib/runner-process');
const { httpGetJson } = require('./lib/runner-http');
const { writeRouteState } = require('./lib/runner-route-state');
const { currentBranch } = require('./lib/env');
const { inferEnvironment, resolvePort } = require('./lib/runtime-config');
const { DEFAULT_ROOM_ID, AGENT_NAMES, resolveRoomId } = require('./lib/room');
const {
  toPositiveInt,
  toBool,
  CircuitBreaker,
  effectiveActivationBudget,
  selectPromptMessagesByDegrade,
} = require('./lib/ops-governance');
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
const MAX_A2A_DEPTH = parseInt(process.env.ARENA_MAX_A2A_DEPTH || '10', 10);
const MAX_TASKS_PER_POLL = parseInt(process.env.ARENA_MAX_TASKS_PER_POLL || '2', 10);
const SESSION_REBUILD_EVERY = parseInt(process.env.ARENA_SESSION_REBUILD_EVERY || '3', 10);
const REQUEST_TIMEOUT_MS = 10000;
const METRICS_LOG = path.join(__dirname, 'agent-metrics.log');
const SUMMARY_PATH = path.join(__dirname, `session-summary.${ROOM_ID}.json`);
const MCP_SCRIPT = path.join(__dirname, 'agent-arena-mcp.js');
const ACTIVATION_BUDGET_PER_TURN = toPositiveInt(process.env.ARENA_ACTIVATION_BUDGET_PER_TURN, 2);
const PROMPT_BUDGET_CHARS = toPositiveInt(process.env.ARENA_PROMPT_BUDGET_CHARS, 12000);
const RETRIEVAL_TOPK = toPositiveInt(process.env.ARENA_RETRIEVAL_TOPK, 5);
const DEGRADE_ENABLED = toBool(process.env.ARENA_DEGRADE_ENABLED, true);
const CIRCUIT_BREAKER_ENABLED = toBool(process.env.ARENA_CIRCUIT_BREAKER_ENABLED, true);
const CIRCUIT_ERROR_WINDOW = toPositiveInt(process.env.ARENA_CIRCUIT_ERROR_WINDOW, 5);
const CIRCUIT_COOLDOWN_MS = toPositiveInt(process.env.ARENA_CIRCUIT_COOLDOWN_MS, 30000);
let currentAgentNames = [...AGENT_NAMES];
let currentAgents = new Set(currentAgentNames);
const PROMPT_MODE = String(process.env.ARENA_PROMPT_MODE || 'optimized').trim().toLowerCase() === 'legacy'
  ? 'legacy'
  : 'optimized';
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
let degradeLevel = 0;
let lastRouteMeta = { candidateRoles: [], activeRoles: [], droppedRoles: 0, dropReasons: {}, retrievalCount: 0 };
let longTermMemory = [];
let roleMap = {};
let modelRefreshTimer = null;
const circuit = new CircuitBreaker({
  enabled: CIRCUIT_BREAKER_ENABLED,
  errorWindow: CIRCUIT_ERROR_WINDOW,
  cooldownMs: CIRCUIT_COOLDOWN_MS,
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireRoomLockWithRetry(redisClient, roomId, owner) {
  while (true) {
    try {
      return await acquireRunnerLock(redisClient, roomId, owner);
    } catch (err) {
      const msg = err && err.message ? String(err.message) : '';
      if (!msg.startsWith('runner_lock_busy:')) throw err;
      console.log(`[lock] busy room=${roomId}, retry in 5000ms`);
      await wait(5000);
    }
  }
}

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

function logInvoke(task, prompt, count, summaryOnly, meta = {}) {
  const circuitState = circuit.getState();
  const row = {
    ts: new Date().toISOString(), roomId: ROOM_ID, agent: task.target, promptChars: prompt.length,
    recentCount: count,
    summaryOnly,
    promptMode: PROMPT_MODE,
    retrievalCount: Number(meta.retrievalCount || 0),
    candidateRoles: Array.isArray(meta.candidateRoles) ? meta.candidateRoles : [],
    activeRoles: Array.isArray(meta.activeRoles) ? meta.activeRoles : [],
    droppedRoles: Number(meta.droppedRoles || 0),
    dropReasons: meta.dropReasons || {},
    degradeLevel: Number(meta.degradeLevel || 0),
    circuitOpen: circuitState.open,
    route: {
      sourceSeq: task.sourceSeq,
      sourceFrom: task.sourceFrom,
      sourceType: currentAgents.has(task.sourceFrom) ? 'agent' : 'human',
      depth: task.depth,
    },
  };
  fs.appendFile(METRICS_LOG, JSON.stringify(row) + '\n', 'utf8', () => {});
}

async function invokeTask(task, recentMessages) {
  const baseMessages = (invokeCount > 0 && invokeCount % SESSION_REBUILD_EVERY === 0)
    ? recentMessages.slice(-2)
    : recentMessages;
  let promptMessages = selectPromptMessagesByDegrade(baseMessages, degradeLevel);
  let prompt = buildPrompt(task.target, promptMessages, { sessionSummary, longTermMemory, promptMode: PROMPT_MODE });
  let summaryOnly = promptMessages.length <= 1;
  if (PROMPT_BUDGET_CHARS > 0 && prompt.length > PROMPT_BUDGET_CHARS) {
    promptMessages = promptMessages.slice(-1);
    prompt = buildPrompt(task.target, promptMessages, { sessionSummary, longTermMemory, promptMode: PROMPT_MODE });
    summaryOnly = true;
  }
  if (PROMPT_BUDGET_CHARS > 0 && prompt.length > PROMPT_BUDGET_CHARS) {
    promptMessages = [];
    prompt = buildPrompt(task.target, promptMessages, { sessionSummary, longTermMemory, promptMode: PROMPT_MODE });
    summaryOnly = true;
  }
  if (PROMPT_BUDGET_CHARS > 0 && prompt.length > PROMPT_BUDGET_CHARS) {
    prompt = prompt.slice(0, PROMPT_BUDGET_CHARS);
  }
  logInvoke(task, prompt, promptMessages.length, summaryOnly, {
    ...lastRouteMeta,
    degradeLevel,
  });
  const rt = agentRuntime[task.target] || agentRuntime.ensureRole(task.target);
  if (!rt) return;
  const controller = new AbortController();
  const configuredRole = roleMap[task.target] || {};
  const resolved = rt.resolve(prompt, configuredRole.model);
  activeAbort = controller;
  await writeRouteState(redis.getClient(), ROOM_ID, {
    queued: router.stats().queued,
    maxDepth: MAX_A2A_DEPTH,
    activeTask: task,
    lastDropped: [],
    candidateRoles: lastRouteMeta.candidateRoles,
    activeRoles: lastRouteMeta.activeRoles,
    dropReasons: lastRouteMeta.dropReasons,
    retrievalCount: lastRouteMeta.retrievalCount,
    degradeLevel,
    circuitOpen: circuit.getState().open,
  }).catch(() => {});
  try {
    await runCommand(
      resolved.cmd,
      resolved.args,
      `${task.target} (${resolved.model === 'claude' ? 'Claude' : 'Codex'})`,
      controller.signal,
    );
    invokeCount++;
    router.noteAgentInvocation(task.target, task.depth);
  } finally {
    activeAbort = null;
    await writeRouteState(redis.getClient(), ROOM_ID, {
      queued: router.stats().queued,
      maxDepth: MAX_A2A_DEPTH,
      activeTask: null,
      lastDropped: [],
      candidateRoles: lastRouteMeta.candidateRoles,
      activeRoles: lastRouteMeta.activeRoles,
      dropReasons: lastRouteMeta.dropReasons,
      retrievalCount: lastRouteMeta.retrievalCount,
      degradeLevel,
      circuitOpen: circuit.getState().open,
    }).catch(() => {});
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
    sessionSummary = memory.summarizeMessages(recentMessages, { topK: RETRIEVAL_TOPK });
    const candidates = (sessionSummary.retrievalCandidates || []).map((line) => ({
      summary: line,
      type: longMemory.inferTypeFromText(line),
      confidence: longMemory.inferConfidenceFromText(line),
      evidence: [String(sessionSummary.currentGoal || '').slice(0, 120)],
      tags: [ROOM_ID, 'session'],
      source: 'session-summary',
    }));
    await longMemory.upsertMemoryBatch(ROOM_ID, candidates).catch(() => []);
    if (invokeCount % 20 === 0) await longMemory.pruneExpiredMemory(ROOM_ID, { limit: 100 }).catch(() => {});
    longTermMemory = await longMemory.listTopMemory(ROOM_ID, { topK: RETRIEVAL_TOPK }).catch(() => []);
    sessionSummary.longTermMemory = longTermMemory.map((m) => ({
      type: m.type,
      summary: m.summary,
      qualityScore: m.qualityScore,
    }));
    sessionSummary.retrievalCount = longTermMemory.length;
    await memory.saveSummary(sessionSummary, SUMMARY_PATH, `room:${ROOM_ID}:session:summary`);
  }

  const route = await router.ingest(recentMessages, {
    activationBudget: effectiveActivationBudget(ACTIVATION_BUDGET_PER_TURN, DEGRADE_ENABLED ? degradeLevel : 0),
  });
  lastRouteMeta = {
    candidateRoles: route.candidateRoles || [],
    activeRoles: route.activeRoles || [],
    droppedRoles: Array.isArray(route.dropped) ? route.dropped.length : 0,
    dropReasons: route.dropReasons || {},
    retrievalCount: Number(sessionSummary?.retrievalCount || 0),
  };
  if (route.cancelRequested && activeAbort) {
    console.log('[route] cancel requested by human');
    activeAbort.abort();
  }
  for (const d of route.dropped) console.log(`[route] dropped ${d.reason} target=${d.target} depth=${d.depth}`);
  await writeRouteState(redis.getClient(), ROOM_ID, {
    queued: route.queued,
    maxDepth: MAX_A2A_DEPTH,
    activeTask: activeAbort ? { status: 'running' } : null,
    lastDropped: route.dropped,
    candidateRoles: route.candidateRoles || [],
    activeRoles: route.activeRoles || [],
    dropReasons: route.dropReasons || {},
    retrievalCount: Number(sessionSummary?.retrievalCount || 0),
    degradeLevel,
    circuitOpen: circuit.getState().open,
  }).catch(() => {});

  let processed = 0;
  const maxTasksThisPoll = Math.min(
    MAX_TASKS_PER_POLL,
    effectiveActivationBudget(ACTIVATION_BUDGET_PER_TURN, DEGRADE_ENABLED ? degradeLevel : 0),
  );
  while (processed < maxTasksThisPoll) {
    const task = router.nextTask();
    if (!task) break;
    if (snapshot.consecutiveAgentTurns >= MAX_AGENT_TURNS && currentAgents.has(task.sourceFrom)) continue;
    const runtime = agentRuntime[task.target] || agentRuntime.ensureRole(task.target);
    if (!runtime || !runtime.canRun()) continue;
    console.log(`[route] exec target=${task.target} depth=${task.depth} source=${task.sourceFrom}#${task.sourceSeq}`);
    await invokeTask(task, recentMessages);
    processed++;
  }
}

async function main() {
  console.log('=== Arena Agent Runner ===');
  console.log(`API: ${API_URL} | Room: ${ROOM_ID} | Poll: ${POLL_INTERVAL}ms | MaxDepth: ${MAX_A2A_DEPTH}`);
  console.log(`Ops: activationBudget=${ACTIVATION_BUDGET_PER_TURN} promptBudget=${PROMPT_BUDGET_CHARS} retrievalTopK=${RETRIEVAL_TOPK}`);
  redis.startConnect();
  await redis.waitUntilReady(5000);
  const loaded = await agentRegistry.refreshRoleCache().catch(() => null);
  if (loaded && Array.isArray(loaded.enabledAgentNames) && loaded.enabledAgentNames.length > 0) {
    currentAgentNames = loaded.enabledAgentNames;
    currentAgents = new Set(currentAgentNames);
    roleMap = Object.fromEntries((loaded.roles || []).map((r) => [r.name, r]));
  }
  router = createA2ARouter({
    roomId: ROOM_ID,
    redisClient: redis.getClient(),
    agents: currentAgentNames,
    maxDepth: MAX_A2A_DEPTH,
    defaultAgent: currentAgentNames[0] || '清风',
  });
  sessionSummary = await memory.loadSummary(SUMMARY_PATH, `room:${ROOM_ID}:session:summary`);
  lock = await acquireRoomLockWithRetry(redis.getClient(), ROOM_ID, `${INSTANCE_ID}:${process.pid}`);
  renewTimer = setInterval(async () => {
    const ok = await renewRunnerLock(redis.getClient(), lock).catch(() => false);
    if (!ok) { console.error('[lock] lost runner lock, exiting'); process.exit(1); }
  }, 10000);
  renewTimer.unref();

  await Promise.all(currentAgentNames.map((name) => {
    const rt = agentRuntime.ensureRole(name);
    return rt ? rt.setup().catch(() => {}) : Promise.resolve();
  }));
  modelRefreshTimer = setInterval(async () => {
    const latest = await agentRegistry.refreshRoleCache().catch(() => null);
    if (!latest) return;
    const nextNames = Array.isArray(latest.enabledAgentNames) && latest.enabledAgentNames.length > 0
      ? latest.enabledAgentNames
      : currentAgentNames;
    currentAgentNames = nextNames;
    currentAgents = new Set(nextNames);
    roleMap = Object.fromEntries((latest.roles || []).map((r) => [r.name, r]));
    if (router && typeof router.setAgents === 'function') router.setAgents(nextNames);
    await Promise.all(nextNames.map((name) => {
      const rt = agentRuntime.ensureRole(name);
      return rt ? rt.setup().catch(() => {}) : Promise.resolve();
    }));
  }, 5000);
  modelRefreshTimer.unref();
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
    if (modelRefreshTimer) clearInterval(modelRefreshTimer);
    await Promise.all(currentAgentNames.map((name) => {
      const rt = agentRuntime.ensureRole(name);
      return rt ? rt.cleanup().catch(() => {}) : Promise.resolve();
    }));
    if (lock) await releaseRunnerLock(redis.getClient(), lock).catch(() => {});
    await redis.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  let errors = 0;
  while (running) {
    const circuitState = circuit.getState();
    if (circuitState.open) {
      degradeLevel = DEGRADE_ENABLED ? 3 : 0;
      await writeRouteState(redis.getClient(), ROOM_ID, {
        queued: router ? router.stats().queued : 0,
        maxDepth: MAX_A2A_DEPTH,
        activeTask: null,
        lastDropped: [],
        candidateRoles: [],
        activeRoles: [],
        dropReasons: {},
        retrievalCount: 0,
        degradeLevel,
        circuitOpen: true,
      }).catch(() => {});
      console.error(`[circuit] open, retry after ${circuitState.retryAfterMs}ms`);
      await waitTick(Math.max(POLL_INTERVAL, 1000));
      continue;
    }
    try { await pollOnce(); errors = 0; }
    catch (err) {
      errors++;
      circuit.recordFailure();
      if (DEGRADE_ENABLED) degradeLevel = Math.min(3, degradeLevel + 1);
      const backoff = Math.min(POLL_INTERVAL * Math.pow(2, errors), 60000);
      console.error(`[poll error #${errors}] ${err.message}`);
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    circuit.recordSuccess();
    if (DEGRADE_ENABLED) degradeLevel = 0;
    await waitTick(POLL_INTERVAL);
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
