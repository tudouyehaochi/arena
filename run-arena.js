const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { buildPrompt } = require('./lib/prompt-builder');
const memory = require('./lib/session-memory');
const { startRealtimeListener } = require('./lib/realtime-listener');
const { createAgentRuntime } = require('./lib/agent-runtime');
const { currentBranch } = require('./lib/env');
const { inferEnvironment, resolvePort } = require('./lib/runtime-config');
const redis = require('./lib/redis-client');
const BRANCH = currentBranch();
const DEFAULT_ENV = inferEnvironment(process.env.ARENA_ENVIRONMENT);
const DEFAULT_PORT = resolvePort({ port: process.env.PORT, environment: DEFAULT_ENV, branch: BRANCH });
const INSTANCE_ID = process.env.ARENA_INSTANCE_ID || `${DEFAULT_ENV}:${BRANCH}:${DEFAULT_PORT}`;
const API_URL = process.env.ARENA_API_URL || `http://localhost:${DEFAULT_PORT}`;
const { ARENA_INVOCATION_ID: INVOCATION_ID, ARENA_CALLBACK_TOKEN: CALLBACK_TOKEN } = process.env;
const POLL_INTERVAL = parseInt(process.env.ARENA_POLL_INTERVAL || '5000', 10);
const MAX_AGENT_TURNS = 3, REQUEST_TIMEOUT_MS = 10000;
const SESSION_REBUILD_EVERY = parseInt(process.env.ARENA_SESSION_REBUILD_EVERY || '6', 10);
const METRICS_LOG = path.join(__dirname, 'agent-metrics.log');
const STATE_PATH = path.join(__dirname, 'runner-state.json');
const MCP_SCRIPT = path.join(__dirname, 'agent-arena-mcp.js');
const AUTH_HEADER = `Bearer ${INVOCATION_ID}:${CALLBACK_TOKEN}`;
const AGENTS = new Set(['清风', '明月']);
if (!INVOCATION_ID || !CALLBACK_TOKEN) { console.error('Missing ARENA_INVOCATION_ID or ARENA_CALLBACK_TOKEN'); process.exit(1); }
function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.get({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { Authorization: AUTH_HEADER }, timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
    req.on('error', reject);
  });
}
function runCommand(cmd, args, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${label} ===\n`);
    const env = {
      ...process.env,
      ARENA_API_URL: API_URL,
      ARENA_INVOCATION_ID: INVOCATION_ID,
      ARENA_CALLBACK_TOKEN: CALLBACK_TOKEN,
      ARENA_ENVIRONMENT: DEFAULT_ENV,
      ARENA_INSTANCE_ID: INSTANCE_ID,
      ARENA_TARGET_PORT: String(DEFAULT_PORT),
    };
    delete env.CLAUDECODE;
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    child.stdout.on('data', (d) => process.stdout.write(`[${label}] ${d}`));
    child.stderr.on('data', (d) => process.stderr.write(`[${label} err] ${d}`));
    child.on('close', (code) => code !== 0 ? reject(new Error(`${label} exited ${code}`)) : resolve());
    child.on('error', reject);
  });
}
function logInvokeMetrics(agent, prompt, recentMessages, summaryOnly) {
  const row = { ts: new Date().toISOString(), agent, promptChars: prompt.length, recentCount: recentMessages.length, summaryOnly };
  fs.appendFileSync(METRICS_LOG, JSON.stringify(row) + '\n');
}
function readStateFile() { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; } }
async function loadRunnerState() {
  return redis.withFallback(async () => {
    const val = await redis.getClient().get('arena:runner:lastHandledHumanSeq');
    return val ? { lastHandledHumanSeq: parseInt(val, 10) } : readStateFile();
  }, readStateFile);
}
async function saveRunnerState(state) {
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(state) + '\n', 'utf8'); } catch {}
  await redis.withFallback(() => redis.getClient().set('arena:runner:lastHandledHumanSeq', String(state.lastHandledHumanSeq || 0)), () => {});
}
function pickAgent(recentMessages) {
  if (recentMessages.length === 0) return '清风';
  const lastMsg = recentMessages[recentMessages.length - 1];
  const content = String(lastMsg.content ?? lastMsg.text ?? '');
  if (content.includes('@清风')) return '清风';
  if (content.includes('@明月')) return '明月';
  if (lastMsg.from === '清风') return '明月';
  if (lastMsg.from === '明月') return '清风';
  return '清风';
}
let sessionSummary = null;
const agentRuntime = createAgentRuntime({
  API_URL,
  INVOCATION_ID,
  CALLBACK_TOKEN,
  RUNTIME_ENV: DEFAULT_ENV,
  INSTANCE_ID,
  TARGET_PORT: DEFAULT_PORT,
  runCommand,
  MCP_SCRIPT,
});
async function invokeAgent(agent, recentMessages) {
  const prompt = buildPrompt(agent, recentMessages, { sessionSummary });
  logInvokeMetrics(agent, prompt, recentMessages, recentMessages.length <= 2);
  const rt = agentRuntime[agent];
  return runCommand(rt.cmd, rt.buildArgs(prompt), `${agent} (${rt.cmd === 'claude' ? 'Claude' : 'Codex'})`);
}
let lastSeenCursor = null;
let running = true;
let invokeCount = 0;
let lastHandledHumanSeq = null;
let wakeResolver = null;
function wakePolling(reason) {
  if (!wakeResolver) return;
  const fn = wakeResolver;
  wakeResolver = null;
  console.log(`[listen] wake poll (${reason})`);
  fn();
}
function waitForNextTick(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { wakeResolver = null; resolve(); }, ms);
    wakeResolver = () => { clearTimeout(timer); resolve(); };
  });
}
async function pollOnce() {
  const since = lastSeenCursor ? `?since=${lastSeenCursor}` : '';
  const snapshot = await httpGet(`${API_URL}/api/agent-snapshot${since}`);
  if (lastSeenCursor !== null && snapshot.cursor === lastSeenCursor) return;
  if (lastSeenCursor === null) {
    lastSeenCursor = snapshot.cursor;
    console.log(`[poll] Initialized cursor=${lastSeenCursor}, ${snapshot.totalMessages} messages`);
    return;
  }
  lastSeenCursor = snapshot.cursor;
  const recentMessages = snapshot.messages || [];
  if (recentMessages.length > 0) {
    sessionSummary = memory.summarizeMessages(recentMessages);
    await memory.saveSummary(sessionSummary);
  }
  if (snapshot.consecutiveAgentTurns >= MAX_AGENT_TURNS) return console.log(`[poll] Agent turns ${snapshot.consecutiveAgentTurns} >= ${MAX_AGENT_TURNS}, silent`);
  if (snapshot.lastHumanMsgSeq && snapshot.lastHumanMsgSeq === lastHandledHumanSeq) return console.log(`[poll] Human seq ${snapshot.lastHumanMsgSeq} already handled`);
  const promptMessages = (invokeCount > 0 && invokeCount % SESSION_REBUILD_EVERY === 0) ? recentMessages.slice(-2) : recentMessages;
  if (promptMessages.length !== recentMessages.length) console.log(`[poll] Rebuild context using summary file: ${memory.SUMMARY_PATH}`);
  const agent = pickAgent(recentMessages);
  if (!agentRuntime[agent].canRun()) throw new Error(`${agent} runtime unavailable`);
  console.log(`[poll] New activity. Turns: ${snapshot.consecutiveAgentTurns}. Agent: ${agent}`);
  await invokeAgent(agent, promptMessages);
  invokeCount++;
  if (snapshot.lastHumanMsgSeq) {
    lastHandledHumanSeq = snapshot.lastHumanMsgSeq;
    await saveRunnerState({ lastHandledHumanSeq });
  }
}
async function main() {
  console.log('=== Arena Agent Runner ===');
  console.log(`API: ${API_URL} | Poll: ${POLL_INTERVAL}ms | Max turns: ${MAX_AGENT_TURNS}`);
  redis.startConnect();
  sessionSummary = await memory.loadSummary();
  lastHandledHumanSeq = (await loadRunnerState()).lastHandledHumanSeq || null;
  await Promise.all([
    agentRuntime.清风.setup().catch((e) => console.error('清风 MCP setup failed:', e.message)),
    agentRuntime.明月.setup().catch((e) => console.error('明月 MCP setup failed:', e.message)),
  ]);
  const listener = startRealtimeListener({
    apiUrl: API_URL,
    authHeader: AUTH_HEADER,
    onStateChange: (state) => console.log(`[listen] ${state}`),
    onMessage: (msg) => {
      const from = msg?.from || '';
      if (msg?.type === 'history' || msg?.type !== 'chat') return;
      if (!AGENTS.has(from)) wakePolling(`chat from ${from}`);
    },
  });
  const shutdown = async () => {
    console.log('\nShutting down...');
    running = false;
    listener.stop();
    await Promise.all([
      agentRuntime.清风.cleanup().catch(() => {}),
      agentRuntime.明月.cleanup().catch(() => {}),
    ]);
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
      console.error(`[poll error #${errors}] ${err.message} (retry in ${backoff / 1000}s)`);
      await new Promise(r => setTimeout(r, backoff));
      continue;
    }
    await waitForNextTick(POLL_INTERVAL);
  }
}
main().catch(err => { console.error('Fatal:', err); process.exit(1); });
