const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { getEnv, currentBranch } = require('./lib/env');
const auth = require('./lib/auth');
const store = require('./lib/message-store');

const PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_BODY_BYTES = 10 * 1024; // 10KB body limit (P2)
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');

// Load message history on startup
store.loadFromLog();

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let rejected = false;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > limit && !rejected) {
        rejected = true;
        reject(new Error('body_too_large'));
        req.resume(); // drain remaining data
        return;
      }
      if (!rejected) body += chunk;
    });
    req.on('end', () => { if (!rejected) resolve(body); });
    req.on('error', reject);
  });
}

function jsonResponse(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

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

function handlePostMessage(req, res) {
  readBody(req, MAX_BODY_BYTES)
    .then(body => {
      const parsed = JSON.parse(body);
      const { content, from: sender } = parsed;
      const authResult = auth.authenticate(req, parsed);
      if (!authResult.ok) {
        const code = authResult.error === 'token_expired' ? 403 : 401;
        jsonResponse(res, code, { error: authResult.error });
        return;
      }
      if (!content || content.trim() === '') {
        jsonResponse(res, 200, { status: 'silent' });
        return;
      }
      const agentName = sender || 'agent';
      console.log(`[agent callback] [${agentName}] ${content}`);
      const msg = store.addMessage({ type: 'chat', from: agentName, content });
      broadcast(msg);
      jsonResponse(res, 200, { status: 'ok', seq: msg.seq });
    })
    .catch(err => {
      const code = err.message === 'body_too_large' ? 413 : 400;
      jsonResponse(res, code, { error: err.message });
    });
}

function handleGetSnapshot(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const authResult = auth.authenticate(req, {});
  if (!authResult.ok) {
    const code = authResult.error === 'token_expired' ? 403 : 401;
    jsonResponse(res, code, { error: authResult.error });
    return;
  }
  const since = parseInt(url.searchParams.get('since') || '0', 10);
  jsonResponse(res, 200, store.getSnapshot(since));
}

function handleGetAgentStatus(req, res) {
  jsonResponse(res, 200, store.getSnapshot(0));
}

// Issue a WS session token for authenticated clients
function handleGetWsToken(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const identity = url.searchParams.get('identity') || 'human';
  const token = auth.issueWsSession(identity);
  jsonResponse(res, 200, { token });
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
    handlePostMessage(req, res);
  } else if (method === 'GET' && urlPath === '/api/agent-snapshot') {
    handleGetSnapshot(req, res);
  } else if (method === 'GET' && urlPath === '/api/callbacks/thread-context') {
    handleGetSnapshot(req, res); // backward compat, same as snapshot
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
  // Auth: check session token from query string
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sessionToken = url.searchParams.get('token');
  const session = sessionToken ? auth.validateWsSession(sessionToken) : { ok: false };

  // Tag connection with identity (defaults to 'anonymous' if no valid token)
  ws.identity = session.ok ? session.identity : 'anonymous';

  ws.send(JSON.stringify({ type: 'history', messages: store.getMessages() }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Server-side identity enforcement: override client-reported 'from'
    // Agent names can only be used by authenticated agent sessions
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
