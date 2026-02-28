const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { buildPrompt } = require('./lib/prompt-builder');
const memory = require('./lib/session-memory');
const { startRealtimeListener } = require('./lib/realtime-listener');

const API_URL = process.env.ARENA_API_URL || 'http://localhost:3000';
const INVOCATION_ID = process.env.ARENA_INVOCATION_ID;
const CALLBACK_TOKEN = process.env.ARENA_CALLBACK_TOKEN;
const POLL_INTERVAL = parseInt(process.env.ARENA_POLL_INTERVAL || '5000', 10);
const MAX_AGENT_TURNS = 3;
const REQUEST_TIMEOUT_MS = 10000;
const SESSION_REBUILD_EVERY = parseInt(process.env.ARENA_SESSION_REBUILD_EVERY || '6', 10);
const METRICS_LOG = path.join(__dirname, 'agent-metrics.log');
const MCP_SCRIPT = path.join(__dirname, 'agent-arena-mcp.js');
const AUTH_HEADER = `Bearer ${INVOCATION_ID}:${CALLBACK_TOKEN}`;
const AGENTS = new Set(['清风', '明月']);

if (!INVOCATION_ID || !CALLBACK_TOKEN) {
  console.error('Missing ARENA_INVOCATION_ID or ARENA_CALLBACK_TOKEN');
  process.exit(1);
}

const mcpConfig = JSON.stringify({ mcpServers: { arena: { command: 'node', args: [MCP_SCRIPT], env: {
  ARENA_API_URL: API_URL, ARENA_INVOCATION_ID: INVOCATION_ID, ARENA_CALLBACK_TOKEN: CALLBACK_TOKEN,
} } } });

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
    const env = { ...process.env, ARENA_API_URL: API_URL, ARENA_INVOCATION_ID: INVOCATION_ID, ARENA_CALLBACK_TOKEN: CALLBACK_TOKEN };
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

let sessionSummary = memory.loadSummary();
async function invokeAgent(agent, recentMessages) {
  const prompt = buildPrompt(agent, recentMessages, { sessionSummary });
  logInvokeMetrics(agent, prompt, recentMessages, recentMessages.length <= 2);
  if (agent === '清风') return runCommand('claude', [
    '-p', prompt, '--output-format', 'stream-json', '--verbose', '--mcp-config', mcpConfig,
    '--allowedTools', 'mcp__arena__arena_get_context,mcp__arena__arena_post_message,mcp__arena__arena_read_file,mcp__arena__arena_write_file,mcp__arena__arena_list_files,mcp__arena__arena_run_git,mcp__arena__arena_git_commit,mcp__arena__arena_run_test',
  ], '清风 (Claude)');
  return runCommand('codex', ['exec', prompt, '--json'], '明月 (Codex)');
}

let codexMcpRegistered = false;
async function setupCodexMcp() {
  if (codexMcpRegistered) return;
  try {
    await runCommand('codex', [
      'mcp', 'add', 'arena', '--env', `ARENA_API_URL=${API_URL}`, '--env', `ARENA_INVOCATION_ID=${INVOCATION_ID}`,
      '--env', `ARENA_CALLBACK_TOKEN=${CALLBACK_TOKEN}`, '--', 'node', MCP_SCRIPT,
    ], '明月 MCP add');
    codexMcpRegistered = true;
  } catch (err) { console.error('Failed to register MCP with Codex:', err.message); }
}
async function cleanupCodexMcp() {
  if (!codexMcpRegistered) return;
  try { await runCommand('codex', ['mcp', 'remove', 'arena'], '明月 MCP remove'); } catch {}
  codexMcpRegistered = false;
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
    memory.saveSummary(sessionSummary);
  }
  if (snapshot.consecutiveAgentTurns >= MAX_AGENT_TURNS) return console.log(`[poll] Agent turns ${snapshot.consecutiveAgentTurns} >= ${MAX_AGENT_TURNS}, silent`);
  if (snapshot.lastHumanMsgSeq && snapshot.lastHumanMsgSeq === lastHandledHumanSeq) return console.log(`[poll] Human seq ${snapshot.lastHumanMsgSeq} already handled`);

  const promptMessages = (invokeCount > 0 && invokeCount % SESSION_REBUILD_EVERY === 0) ? recentMessages.slice(-2) : recentMessages;
  if (promptMessages.length !== recentMessages.length) console.log(`[poll] Rebuild context using summary file: ${memory.SUMMARY_PATH}`);

  const agent = pickAgent(recentMessages);
  if (agent === '明月' && !codexMcpRegistered) {
    console.log('[poll] 明月 selected but Codex unavailable, fallback to 清风');
    await invokeAgent('清风', promptMessages);
    invokeCount++;
    if (snapshot.lastHumanMsgSeq) lastHandledHumanSeq = snapshot.lastHumanMsgSeq;
    return;
  }
  console.log(`[poll] New activity. Turns: ${snapshot.consecutiveAgentTurns}. Agent: ${agent}`);
  await invokeAgent(agent, promptMessages);
  invokeCount++;
  if (snapshot.lastHumanMsgSeq) lastHandledHumanSeq = snapshot.lastHumanMsgSeq;
}

async function main() {
  console.log('=== Arena Agent Runner ===');
  console.log(`API: ${API_URL} | Poll: ${POLL_INTERVAL}ms | Max turns: ${MAX_AGENT_TURNS}`);
  await setupCodexMcp();
  const listener = startRealtimeListener({
    apiUrl: API_URL,
    authHeader: AUTH_HEADER,
    onStateChange: (state) => console.log(`[listen] ${state}`),
    onMessage: (msg) => { const from = msg?.from || ''; if (msg?.type === 'chat' && !AGENTS.has(from)) wakePolling(`chat from ${from}`); },
  });

  const shutdown = async () => {
    console.log('\nShutting down...');
    running = false;
    listener.stop();
    await cleanupCodexMcp();
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
