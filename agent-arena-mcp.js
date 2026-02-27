const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const http = require('http');

const API_URL = process.env.ARENA_API_URL || 'http://localhost:3000';
const INVOCATION_ID = process.env.ARENA_INVOCATION_ID;
const CALLBACK_TOKEN = process.env.ARENA_CALLBACK_TOKEN;

function httpRequest(method, urlStr, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const server = new McpServer({
  name: 'arena',
  version: '1.0.0',
});

server.tool(
  'arena_post_message',
  'Post a message to the Arena chatroom',
  {
    content: z.string().describe('The message content to post'),
    from: z.string().describe('The sender name (e.g. "清风" or "明月")'),
  },
  async ({ content, from }) => {
    const result = await httpRequest('POST', `${API_URL}/api/callbacks/post-message`, {
      invocationId: INVOCATION_ID,
      callbackToken: CALLBACK_TOKEN,
      content,
      from,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

server.tool(
  'arena_get_context',
  'Get recent messages from the Arena chatroom',
  {},
  async () => {
    const url = `${API_URL}/api/callbacks/thread-context?invocationId=${encodeURIComponent(INVOCATION_ID)}&callbackToken=${encodeURIComponent(CALLBACK_TOKEN)}`;
    const result = await httpRequest('GET', url);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
