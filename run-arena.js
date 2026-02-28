const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const { buildPrompt } = require('./lib/prompt-builder');

const API_URL = process.env.ARENA_API_URL || 'http://localhost:3000';
const INVOCATION_ID = process.env.ARENA_INVOCATION_ID;
const CALLBACK_TOKEN = process.env.ARENA_CALLBACK_TOKEN;
const POLL_INTERVAL = parseInt(process.env.ARENA_POLL_INTERVAL || '5000', 10);
const MAX_AGENT_TURNS = 3;
const REQUEST_TIMEOUT_MS = 10000;

if (!INVOCATION_ID || !CALLBACK_TOKEN) {
  console.error('Missing ARENA_INVOCATION_ID or ARENA_CALLBACK_TOKEN');
  process.exit(1);
}

const MCP_SCRIPT = path.join(__dirname, 'agent-arena-mcp.js');
const AUTH_HEADER = `Bearer ${INVOCATION_ID}:${CALLBACK_TOKEN}`;

const mcpConfig = JSON.stringify({
  mcpServers: {
    arena: {
      command: 'node',
      args: [MCP_SCRIPT],
      env: {
        ARENA_API_URL: API_URL,
        ARENA_INVOCATION_ID: INVOCATION_ID,
        ARENA_CALLBACK_TOKEN: CALLBACK_TOKEN,
      },
    },
  },
});

// --- HTTP helper with timeout ---

function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Authorization': AUTH_HEADER },
      timeout: REQUEST_TIMEOUT_MS,
    };
    const req = http.get(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
    req.on('error', reject);
  });
}

// --- Agent invocation ---

function runCommand(cmd, args, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${label} ===\n`);
    const childEnv = { ...process.env, ARENA_API_URL: API_URL, ARENA_INVOCATION_ID: INVOCATION_ID, ARENA_CALLBACK_TOKEN: CALLBACK_TOKEN };
    delete childEnv.CLAUDECODE;
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv });
    child.stdout.on('data', (d) => process.stdout.write(`[${label}] ${d}`));
    child.stderr.on('data', (d) => process.stderr.write(`[${label} err] ${d}`));
    child.on('close', (code) => code !== 0 ? reject(new Error(`${label} exited ${code}`)) : resolve());
    child.on('error', reject);
  });
}

function pickAgent(recentMessages) {
  if (recentMessages.length === 0) return '清风';
  const lastMsg = recentMessages[recentMessages.length - 1];
  const content = lastMsg.content || '';
  if (content.includes('@清风')) return '清风';
  if (content.includes('@明月')) return '明月';
  if (lastMsg.from === '清风') return '明月';
  if (lastMsg.from === '明月') return '清风';
  return '清风';
}

async function invokeAgent(agent, recentMessages) {
  const prompt = buildPrompt(agent, recentMessages);
  if (agent === '清风') {
    await runCommand('claude', [
      '-p', prompt, '--output-format', 'stream-json', '--verbose',
      '--mcp-config', mcpConfig,
      '--allowedTools', 'mcp__arena__arena_get_context,mcp__arena__arena_post_message,mcp__arena__arena_read_file,mcp__arena__arena_write_file,mcp__arena__arena_list_files,mcp__arena__arena_run_git,mcp__arena__arena_git_commit,mcp__arena__arena_run_test',
    ], '清风 (Claude)');
  } else {
    await runCommand('codex', ['exec', prompt, '--json'], '明月 (Codex)');
  }
}

// --- Codex MCP setup/cleanup ---

let codexMcpRegistered = false;

async function setupCodexMcp() {
  if (codexMcpRegistered) return;
  try {
    await runCommand('codex', [
      'mcp', 'add', 'arena',
      '--env', `ARENA_API_URL=${API_URL}`,
      '--env', `ARENA_INVOCATION_ID=${INVOCATION_ID}`,
      '--env', `ARENA_CALLBACK_TOKEN=${CALLBACK_TOKEN}`,
      '--', 'node', MCP_SCRIPT,
    ], '明月 MCP add');
    codexMcpRegistered = true;
  } catch (err) {
    console.error('Failed to register MCP with Codex:', err.message);
  }
}

async function cleanupCodexMcp() {
  if (!codexMcpRegistered) return;
  try { await runCommand('codex', ['mcp', 'remove', 'arena'], '明月 MCP remove'); } catch {}
  codexMcpRegistered = false;
}

// --- Main polling loop (uses atomic snapshot) ---

let lastSeenCursor = null;
let running = true;

async function pollOnce() {
  const sinceParam = lastSeenCursor ? `?since=${lastSeenCursor}` : '';
  const snapshot = await httpGet(`${API_URL}/api/agent-snapshot${sinceParam}`);

  if (lastSeenCursor !== null && snapshot.cursor === lastSeenCursor) return;

  if (lastSeenCursor === null) {
    lastSeenCursor = snapshot.cursor;
    console.log(`[poll] Initialized cursor=${lastSeenCursor}, ${snapshot.totalMessages} messages`);
    return;
  }

  lastSeenCursor = snapshot.cursor;
  const recentMessages = snapshot.messages || [];

  if (snapshot.consecutiveAgentTurns >= MAX_AGENT_TURNS) {
    console.log(`[poll] Agent turns ${snapshot.consecutiveAgentTurns} >= ${MAX_AGENT_TURNS}, silent`);
    return;
  }

  const agent = pickAgent(recentMessages);
  if (agent === '明月' && !codexMcpRegistered) {
    console.log('[poll] 明月 selected but Codex unavailable, fallback to 清风');
    await invokeAgent('清风', recentMessages);
    return;
  }

  console.log(`[poll] New activity. Turns: ${snapshot.consecutiveAgentTurns}. Agent: ${agent}`);
  await invokeAgent(agent, recentMessages);
}

async function main() {
  console.log('=== Arena Agent Runner ===');
  console.log(`API: ${API_URL} | Poll: ${POLL_INTERVAL}ms | Max turns: ${MAX_AGENT_TURNS}`);

  await setupCodexMcp();

  // Handle both SIGINT and SIGTERM (P2)
  const shutdown = async () => {
    console.log('\nShutting down...');
    running = false;
    await cleanupCodexMcp();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  let consecutiveErrors = 0;
  while (running) {
    try {
      await pollOnce();
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      const backoff = Math.min(POLL_INTERVAL * Math.pow(2, consecutiveErrors), 60000);
      console.error(`[poll error #${consecutiveErrors}] ${err.message} (retry in ${backoff / 1000}s)`);
      await new Promise(r => setTimeout(r, backoff));
      continue;
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
