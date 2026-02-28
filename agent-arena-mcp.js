const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { registerFileTools } = require('./lib/mcp-file-tools');
const { registerGitTools } = require('./lib/mcp-git-tools');

const API_URL = process.env.ARENA_API_URL || 'http://localhost:3000';
const INVOCATION_ID = process.env.ARENA_INVOCATION_ID;
const CALLBACK_TOKEN = process.env.ARENA_CALLBACK_TOKEN;
const PROJECT_ROOT = process.env.ARENA_PROJECT_ROOT || path.join(__dirname);
const REQUEST_TIMEOUT_MS = 10000;
const RUNTIME_ENV = process.env.ARENA_ENVIRONMENT || 'dev';
const INSTANCE_ID = process.env.ARENA_INSTANCE_ID || '';
const TARGET_PORT = Number.parseInt(new URL(API_URL).port || '80', 10);

if (!INVOCATION_ID || !CALLBACK_TOKEN) {
  console.error('FATAL: Missing ARENA_INVOCATION_ID or ARENA_CALLBACK_TOKEN');
  process.exit(1);
}

const AUTH_HEADER = `Bearer ${INVOCATION_ID}:${CALLBACK_TOKEN}`;

function httpRequest(method, urlStr, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': AUTH_HEADER },
      timeout: REQUEST_TIMEOUT_MS,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (parseErr) {
          reject(new Error(`JSON parse error: ${parseErr.message}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`)); });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// --- MCP Server setup ---

const server = new McpServer({ name: 'arena', version: '1.0.0' });

server.tool(
  'arena_post_message',
  'Post a message to the Arena chatroom',
  { content: z.string().describe('The message content to post'), from: z.string().describe('The sender name (e.g. "清风" or "明月")') },
  async ({ content, from }) => {
    const result = await httpRequest('POST', `${API_URL}/api/callbacks/post-message`, {
      content,
      from,
      runtimeEnv: RUNTIME_ENV,
      instanceId: INSTANCE_ID,
      targetPort: TARGET_PORT,
      idempotencyKey: crypto.randomUUID(),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

server.tool(
  'arena_get_context',
  'Get recent messages from the Arena chatroom',
  { detail: z.boolean().optional().describe('If true, return full snapshot. Default false returns concise summary.') },
  async ({ detail = false }) => {
    const endpoint = detail ? 'agent-snapshot' : 'agent-snapshot?summary=1';
    const result = await httpRequest('GET', `${API_URL}/api/${endpoint}`);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

// Register file & git tools
const { safePath } = registerFileTools(server, PROJECT_ROOT);
registerGitTools(server, PROJECT_ROOT, safePath);

// --- Test tool with whitelist ---

const ALLOWED_TEST_PREFIXES = ['npm test', 'npm run '];
const ALLOWED_NODE_PATTERNS = [
  /^node\s+--test\s/,               // node --test tests/...
  /^node\s+tests?\//,               // node tests/... or node test/...
  /^npx\s+(jest|vitest|mocha|c8)\b/, // common test runners via npx
];
const BLOCKED_COMMANDS = [/rm\s+-rf/, /mkfs/, /dd\s+if=/, />\s*\/dev/];

function isAllowedTestCommand(command) {
  if (ALLOWED_TEST_PREFIXES.some(p => command.startsWith(p))) return true;
  if (command === 'npm test') return true;
  if (ALLOWED_NODE_PATTERNS.some(p => p.test(command))) return true;
  return false;
}

server.tool(
  'arena_run_test',
  'Run a test command. Allowed: "npm test", "npm run <script>", "node --test tests/...", "npx jest/vitest/mocha".',
  { command: z.string().describe('The test command to run, e.g. "npm test" or "node --test tests/"') },
  async ({ command }) => {
    try {
      if (!isAllowedTestCommand(command)) {
        return {
          content: [{ type: 'text', text: 'Blocked: only npm test, npm run, node --test tests/, npx <test-runner> are allowed.' }],
          isError: true,
        };
      }
      for (const p of BLOCKED_COMMANDS) {
        if (p.test(command)) {
          return { content: [{ type: 'text', text: 'Blocked: dangerous command.' }], isError: true };
        }
      }
      const parts = command.split(/\s+/);
      const output = execFileSync(parts[0], parts.slice(1), {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024,
        shell: false,
      });
      return { content: [{ type: 'text', text: output || '(no output)' }] };
    } catch (err) {
      const msg = err.stdout ? `stdout:\n${err.stdout}\nstderr:\n${err.stderr}` : err.message;
      return { content: [{ type: 'text', text: `Exit code ${err.status || 1}:\n${msg}` }], isError: true };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => { console.error(err); process.exit(1); });
