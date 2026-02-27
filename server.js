const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { getEnv, currentBranch } = require('./lib/env');

const PORT = parseInt(process.env.PORT || '3000', 10);
const LOG_FILE = path.join(__dirname, 'chatroom.log');
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');

// In-memory message store
const messages = [];

// Load existing log on startup
try {
  const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try { messages.push(JSON.parse(line)); } catch {}
  }
  console.log(`Loaded ${messages.length} messages from log`);
} catch {}

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

    messages.push(msg);
    appendLog(msg);
    broadcast(wss, msg);
  });
});

function start() {
  server.listen(PORT, () => {
    console.log(`Arena chatroom running at http://localhost:${PORT}`);
    console.log(`Environment: ${getEnv().environment} | Branch: ${currentBranch()}`);
  });
}

module.exports = { start, server, wss, messages, broadcast };

// Start if run directly
if (require.main === module) {
  start();
}
