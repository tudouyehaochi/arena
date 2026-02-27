const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const API_URL = process.env.ARENA_API_URL || 'http://localhost:3000';
const INVOCATION_ID = process.env.ARENA_INVOCATION_ID;
const CALLBACK_TOKEN = process.env.ARENA_CALLBACK_TOKEN;
const POLL_INTERVAL = parseInt(process.env.ARENA_POLL_INTERVAL || '5000', 10);
const MAX_AGENT_TURNS = 3;

if (!INVOCATION_ID || !CALLBACK_TOKEN) {
  console.error('Missing ARENA_INVOCATION_ID or ARENA_CALLBACK_TOKEN');
  console.error('Start the server first (node server.js) and copy the credentials.');
  process.exit(1);
}

const MCP_SCRIPT = path.join(__dirname, 'agent-arena-mcp.js');

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

// ─── HTTP helpers ───

function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    http.get({ hostname: url.hostname, port: url.port, path: url.pathname + url.search }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        else resolve(JSON.parse(data));
      });
    }).on('error', reject);
  });
}

// ─── Run a single agent invocation ───

function runCommand(cmd, args, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${label} ===\n`);
    const childEnv = { ...process.env, ARENA_API_URL: API_URL, ARENA_INVOCATION_ID: INVOCATION_ID, ARENA_CALLBACK_TOKEN: CALLBACK_TOKEN };
    // Allow nested Claude/Codex invocations
    delete childEnv.CLAUDECODE;
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    });
    child.stdout.on('data', (data) => process.stdout.write(`[${label}] ${data}`));
    child.stderr.on('data', (data) => process.stderr.write(`[${label} err] ${data}`));
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${label} exited with code ${code}`));
      else resolve();
    });
    child.on('error', reject);
  });
}

// ─── Decision logic ───

function shouldRespond(status) {
  if (status.consecutiveAgentTurns >= MAX_AGENT_TURNS) {
    return false;
  }
  return true;
}

function pickAgent(recentMessages) {
  if (recentMessages.length === 0) return '清风';

  const lastMsg = recentMessages[recentMessages.length - 1];
  const content = lastMsg.content || '';

  // @mention takes priority
  if (content.includes('@清风')) return '清风';
  if (content.includes('@明月')) return '明月';

  // If last message is from an agent, the other agent responds
  if (lastMsg.from === '清风') return '明月';
  if (lastMsg.from === '明月') return '清风';

  // Default: 清风 goes first for human messages
  return '清风';
}

function buildPrompt(agent, recentMessages) {
  const contextSummary = recentMessages
    .slice(-10)
    .map(m => `[${m.from}]: ${m.content}`)
    .join('\n');

  if (agent === '清风') {
    return [
      '你是清风 (Qingfeng)，一位富有创意的设计师和开发者，常驻在 Arena 聊天室里。',
      '你可以用 arena_get_context 查看聊天记录，用 arena_post_message 发送消息。',
      '发送消息时 from 字段必须填 "清风"。',
      '请根据以下最近对话上下文，自然地参与讨论。简短回复即可，不要太长。',
      '如果是被 @提及，请直接回应提及你的内容。',
      '如果是接着明月的话，可以友好地回应或补充。',
      '',
      '最近对话：',
      contextSummary,
      '',
      '请调用 arena_post_message 发送你的回复。',
    ].join('\n');
  } else {
    return [
      '你是明月 (Mingyue)，一位严谨的测试工程师和代码审查者，常驻在 Arena 聊天室里。',
      '你可以用 arena_get_context 查看聊天记录，用 arena_post_message 发送消息。',
      '发送消息时 from 字段必须填 "明月"。',
      '请根据以下最近对话上下文，自然地参与讨论。简短回复即可，不要太长。',
      '如果是被 @提及，请直接回应提及你的内容。',
      '如果是接着清风的话，可以友好地回应或补充。',
      '',
      '最近对话：',
      contextSummary,
      '',
      '请调用 arena_post_message 发送你的回复。',
    ].join('\n');
  }
}

// ─── Agent invocation ───

async function invokeAgent(agent, recentMessages) {
  const prompt = buildPrompt(agent, recentMessages);

  if (agent === '清风') {
    await runCommand('claude', [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--mcp-config', mcpConfig,
      '--allowedTools', 'mcp__arena__arena_get_context,mcp__arena__arena_post_message',
    ], '清风 (Claude)');
  } else {
    await runCommand('codex', [
      'exec', prompt, '--json',
    ], '明月 (Codex)');
  }
}

// ─── Setup ───

let codexMcpRegistered = false;

async function setupCodexMcp() {
  if (codexMcpRegistered) return;
  console.log('\n=== Registering MCP with Codex ===\n');
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
    console.error('Codex agent will be unavailable.');
  }
}

async function cleanupCodexMcp() {
  if (!codexMcpRegistered) return;
  console.log('\n=== Cleaning up Codex MCP ===\n');
  try {
    await runCommand('codex', ['mcp', 'remove', 'arena'], '明月 MCP remove');
  } catch {}
  codexMcpRegistered = false;
}

// ─── Main polling loop ───

let lastSeenMsgId = null;
let running = true;

async function pollOnce() {
  // 1. Get agent status
  const status = await httpGet(`${API_URL}/api/agent-status`);

  // 2. Get recent messages
  const contextUrl = `${API_URL}/api/callbacks/thread-context?invocationId=${encodeURIComponent(INVOCATION_ID)}&callbackToken=${encodeURIComponent(CALLBACK_TOKEN)}`;
  const context = await httpGet(contextUrl);
  const recentMessages = context.messages || [];

  // 3. Check for new messages
  const currentLastMsgId = status.lastMsgId;
  if (lastSeenMsgId !== null && currentLastMsgId === lastSeenMsgId) {
    return; // No new messages
  }

  // On first run, just record the pointer without responding
  if (lastSeenMsgId === null) {
    lastSeenMsgId = currentLastMsgId;
    console.log(`[poll] Initialized lastSeenMsgId=${lastSeenMsgId}, ${status.totalMessages} messages in room`);
    return;
  }

  lastSeenMsgId = currentLastMsgId;

  // 4. Check if the latest message is from an agent (don't re-respond to our own messages unless it's agent-to-agent)
  const lastMsg = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;

  // 5. Should we respond?
  if (!shouldRespond(status)) {
    console.log(`[poll] Agent turns ${status.consecutiveAgentTurns} >= ${MAX_AGENT_TURNS}, staying silent`);
    return;
  }

  // 6. Pick which agent responds
  const agent = pickAgent(recentMessages);

  // If agent is 明月 but codex isn't available, fall back to 清风
  if (agent === '明月' && !codexMcpRegistered) {
    console.log(`[poll] 明月 selected but Codex unavailable, falling back to 清风`);
    await invokeAgent('清风', recentMessages);
    return;
  }

  console.log(`[poll] New activity detected. Agent turns: ${status.consecutiveAgentTurns}. Selected: ${agent}`);
  await invokeAgent(agent, recentMessages);
}

async function main() {
  console.log('=== Arena Agent Runner (Persistent Mode) ===');
  console.log(`API: ${API_URL}`);
  console.log(`Poll interval: ${POLL_INTERVAL}ms`);
  console.log(`Max agent turns: ${MAX_AGENT_TURNS}`);
  console.log('');

  // Register Codex MCP once
  await setupCodexMcp();

  // SIGINT cleanup
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down...');
    running = false;
    await cleanupCodexMcp();
    process.exit(0);
  });

  // Polling loop
  while (running) {
    try {
      await pollOnce();
    } catch (err) {
      console.error(`[poll error] ${err.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
