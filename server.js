const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { getEnv, currentBranch } = require('./lib/env');

const PORT = parseInt(process.env.PORT || '3000', 10);

// Callback credentials for MCP agents
const invocationId = crypto.randomUUID();
const callbackToken = crypto.randomUUID();
const LOG_FILE = path.join(__dirname, 'chatroom.log');
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');

// In-memory message store
const messages = [];

// Agent turn tracking
let consecutiveAgentTurns = 0;

// Load existing log on startup
try {
  const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try { messages.push(JSON.parse(line)); } catch {}
  }
  console.log(`Loaded ${messages.length} messages from log`);
} catch {}

// Restore consecutiveAgentTurns from log
for (let i = messages.length - 1; i >= 0; i--) {
  if (messages[i].from !== '清风' && messages[i].from !== '明月') break;
  consecutiveAgentTurns++;
}
if (consecutiveAgentTurns > 0) {
  console.log(`Restored consecutiveAgentTurns: ${consecutiveAgentTurns}`);
}

function appendLog(msg) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(msg) + '\n');
}

function broadcast(wss, msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data);
    }
  }
}

// HTTP server
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    fs.readFile(INDEX_HTML, (err, data) => {
      if (err) {
        res.writeHead(500); res.end('Error loading UI');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else if (req.method === 'GET' && req.url === '/api/messages') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(messages));
  } else if (req.method === 'GET' && req.url === '/api/env') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...getEnv(), branch: currentBranch() }));
  } else if (req.method === 'POST' && req.url === '/api/callbacks/post-message') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const { invocationId: id, callbackToken: token, content, from: sender } = parsed;
        if (id !== invocationId || token !== callbackToken) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        // Empty content → agent chose to stay silent
        if (!content || content.trim() === '') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'silent' }));
          return;
        }
        const agentName = sender || 'agent';
        console.log(`[agent callback] [${agentName}] ${content}`);
        const msg = {
          type: 'chat',
          from: agentName,
          content,
          timestamp: Date.now(),
        };
        messages.push(msg);
        appendLog(msg);
        broadcast(wss, msg);
        consecutiveAgentTurns++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (err) {
        console.error('[callback error]', err.message, 'body:', body);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request', detail: err.message }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/api/agent-status') {
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    // Find last human message id (timestamp)
    let lastHumanMsgId = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].from !== '清风' && messages[i].from !== '明月') {
        lastHumanMsgId = messages[i].timestamp;
        break;
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      consecutiveAgentTurns,
      lastHumanMsgId,
      lastMsgId: lastMsg ? lastMsg.timestamp : null,
      totalMessages: messages.length,
    }));
  } else if (req.method === 'GET' && req.url?.startsWith('/api/callbacks/thread-context')) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const id = url.searchParams.get('invocationId');
    const token = url.searchParams.get('callbackToken');
    if (id !== invocationId || token !== callbackToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const recent = messages.slice(-50);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages: recent }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  // Send history
  ws.send(JSON.stringify({ type: 'history', messages }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Ensure required fields
    msg.timestamp = msg.timestamp || Date.now();
    msg.type = msg.type || 'chat';
    msg.from = msg.from || 'anonymous';

    // Human message resets agent turn counter
    if (msg.from !== '清风' && msg.from !== '明月') {
      consecutiveAgentTurns = 0;
    }

    messages.push(msg);
    appendLog(msg);
    broadcast(wss, msg);
  });
});

function start() {
  server.listen(PORT, () => {
    console.log(`Arena chatroom running at http://localhost:${PORT}`);
    console.log(`Environment: ${getEnv().environment} | Branch: ${currentBranch()}`);
    console.log(`\n--- MCP Callback Credentials ---`);
    console.log(`ARENA_INVOCATION_ID=${invocationId}`);
    console.log(`ARENA_CALLBACK_TOKEN=${callbackToken}`);
    console.log(`--------------------------------\n`);
  });
}

module.exports = { start, server, wss, messages, broadcast };

// Start if run directly
if (require.main === module) {
  start();
}
