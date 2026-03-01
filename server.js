const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { getEnv, currentBranch } = require('./lib/env');
const { inferEnvironment, resolvePort } = require('./lib/runtime-config');
const auth = require('./lib/auth');
const store = require('./lib/message-store');
const redis = require('./lib/redis-client');
const { handlePostMessage, handleGetSnapshot, handleGetWsToken, jsonResponse } = require('./lib/route-handlers');
const { handlePostAgentContext, handleGetAgentContext } = require('./lib/agent-context-handlers');

const BRANCH = currentBranch();
const RUNTIME_ENV = inferEnvironment(process.env.ARENA_ENVIRONMENT);
const PORT = resolvePort({ port: process.env.PORT, environment: RUNTIME_ENV, branch: BRANCH });
const INSTANCE_ID = process.env.ARENA_INSTANCE_ID || `${RUNTIME_ENV}:${BRANCH}:${PORT}`;
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');

// Trigger Redis connection early so it's ready by loadFromLog()
redis.startConnect();

function handleGetIndex(req, res) {
  fs.readFile(INDEX_HTML, (err, data) => {
    if (err) { res.writeHead(500); res.end('Error loading UI'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
}

function handleGetMessages(req, res) {
  jsonResponse(res, 200, store.getMessages());
}

function handleGetEnv(req, res) {
  jsonResponse(res, 200, { ...getEnv(), runtimeEnvironment: RUNTIME_ENV, branch: BRANCH, port: PORT });
}

function handleGetAgentStatus(req, res) {
  jsonResponse(res, 200, store.getSnapshot(0));
}

// --- Route dispatch ---

const routes = {
  'GET /': handleGetIndex,
  'GET /api/messages': handleGetMessages,
  'GET /api/env': handleGetEnv,
  'GET /api/agent-status': handleGetAgentStatus,
  'GET /api/ws-token': handleGetWsToken,
  'GET /api/agent-context': handleGetAgentContext,
};

function safeAsync(handler) {
  return (req, res, ...args) => {
    const result = handler(req, res, ...args);
    if (result && typeof result.catch === 'function') {
      result.catch(err => {
        console.error(`Route error: ${err.message}`);
        if (!res.headersSent) { res.writeHead(500); res.end('Internal Server Error'); }
      });
    }
  };
}

const server = http.createServer((req, res) => {
  const method = req.method;
  const urlPath = (req.url || '/').split('?')[0];
  const key = `${method} ${urlPath}`;

  if (routes[key]) {
    safeAsync(routes[key])(req, res);
  } else if (method === 'POST' && urlPath === '/api/callbacks/post-message') {
    safeAsync(handlePostMessage)(req, res, broadcast, {
      instanceId: INSTANCE_ID,
      runtimeEnv: RUNTIME_ENV,
      targetPort: PORT,
    });
  } else if (method === 'POST' && urlPath === '/api/agent-context') {
    safeAsync(handlePostAgentContext)(req, res);
  } else if (method === 'GET' && urlPath === '/api/agent-snapshot') {
    safeAsync(handleGetSnapshot)(req, res, PORT);
  } else if (method === 'GET' && urlPath === '/api/callbacks/thread-context') {
    safeAsync(handleGetSnapshot)(req, res, PORT);
  } else {
    res.writeHead(404); res.end('Not Found');
  }
});

// --- WebSocket ---

const wss = new WebSocketServer({ server });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sessionToken = url.searchParams.get('token');
  const session = sessionToken ? auth.validateWsSession(sessionToken) : { ok: false };
  ws.identity = session.ok ? session.identity : 'anonymous';

  ws.send(JSON.stringify({ type: 'history', messages: store.getMessages() }));

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (store.isAgent(msg.from) && ws.identity !== 'agent') {
      msg.from = ws.identity === 'human' ? (msg.from || 'anonymous') : 'anonymous';
      if (store.isAgent(msg.from)) msg.from = 'anonymous';
    }

    msg.from = msg.from || 'anonymous';
    const stored = await store.addMessage(msg);
    broadcast(stored);
  });
});

// --- Start ---

async function start() {
  await store.loadFromLog();
  server.listen(PORT, () => {
    const creds = auth.getCredentials();
    const credsFile = process.env.ARENA_CREDENTIALS_FILE;
    if (credsFile) {
      try {
        fs.writeFileSync(credsFile, JSON.stringify({
          invocationId: creds.invocationId,
          callbackToken: creds.callbackToken,
          jti: creds.jti,
        }));
      } catch (e) {
        console.error(`Failed to write credentials file: ${e.message}`);
      }
    }
    console.log(`Arena chatroom running at http://localhost:${PORT}`);
    console.log(`Environment: ${RUNTIME_ENV} | Branch: ${BRANCH}`);
    console.log(`Instance: ${INSTANCE_ID}`);
    console.log(`\n--- MCP Callback Credentials (TTL: ${auth.TOKEN_TTL_MS / 60000}min) ---`);
    console.log(`ARENA_INVOCATION_ID=${creds.invocationId}`);
    console.log(`ARENA_CALLBACK_TOKEN=${creds.callbackToken}`);
    console.log(`Auth header: Authorization: Bearer ${creds.invocationId}:${creds.callbackToken}:${creds.jti}`);
    console.log(`--------------------------------------------------\n`);
  });
}

// Graceful shutdown
process.on('SIGINT', async () => { await redis.disconnect(); process.exit(0); });
process.on('SIGTERM', async () => { await redis.disconnect(); process.exit(0); });

module.exports = { start, server, wss, broadcast };

if (require.main === module) {
  start();
}
