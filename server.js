const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { getEnv, currentBranch } = require('./lib/env');
const auth = require('./lib/auth');
const store = require('./lib/message-store');
const { handlePostMessage, handleGetSnapshot, handleGetWsToken, jsonResponse } = require('./lib/route-handlers');

const PORT = parseInt(process.env.PORT || '3000', 10);
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');

// Load message history on startup
store.loadFromLog();

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
  jsonResponse(res, 200, { ...getEnv(), branch: currentBranch() });
}

function handleGetAgentStatus(req, res) {
  jsonResponse(res, 200, store.getSnapshot(0));
}

function handleSummarizedSnapshot(req, res) {
  jsonResponse(res, 200, store.getSummarizedSnapshot(0));
}

// --- Route dispatch ---

const routes = {
  'GET /': handleGetIndex,
  'GET /api/messages': handleGetMessages,
  'GET /api/env': handleGetEnv,
  'GET /api/agent-status': handleGetAgentStatus,
  'GET /api/ws-token': handleGetWsToken,
};

const server = http.createServer((req, res) => {
  const method = req.method;
  const urlPath = (req.url || '/').split('?')[0];
  const key = `${method} ${urlPath}`;

  if (routes[key]) {
    routes[key](req, res);
  } else if (method === 'POST' && urlPath === '/api/callbacks/post-message') {
    handlePostMessage(req, res, broadcast);
  } else if (method === 'GET' && urlPath === '/api/agent-snapshot') {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.searchParams.get('summary') === '1') {
      handleSummarizedSnapshot(req, res);
    } else {
      handleGetSnapshot(req, res, PORT);
    }
  } else if (method === 'GET' && urlPath === '/api/callbacks/thread-context') {
    handleGetSnapshot(req, res, PORT);
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

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (store.isAgent(msg.from) && ws.identity !== 'agent') {
      msg.from = ws.identity === 'human' ? (msg.from || 'anonymous') : 'anonymous';
      if (store.isAgent(msg.from)) msg.from = 'anonymous';
    }

    msg.from = msg.from || 'anonymous';
    const stored = store.addMessage(msg);
    broadcast(stored);
  });
});

// --- Start ---

function start() {
  server.listen(PORT, () => {
    const creds = auth.getCredentials();
    console.log(`Arena chatroom running at http://localhost:${PORT}`);
    console.log(`Environment: ${getEnv().environment} | Branch: ${currentBranch()}`);
    console.log(`\n--- MCP Callback Credentials (TTL: ${auth.TOKEN_TTL_MS / 60000}min) ---`);
    console.log(`ARENA_INVOCATION_ID=${creds.invocationId}`);
    console.log(`ARENA_CALLBACK_TOKEN=${creds.callbackToken}`);
    console.log(`Auth header: Authorization: Bearer ${creds.invocationId}:${creds.callbackToken}:${creds.jti}`);
    console.log(`--------------------------------------------------\n`);
  });
}

module.exports = { start, server, wss, broadcast };

if (require.main === module) {
  start();
}
