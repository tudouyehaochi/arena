const http = require('http');
const WebSocket = require('ws');

function toWsUrl(apiUrl) {
  const u = new URL(apiUrl);
  const protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${u.host}`;
}

function getWsToken(apiUrl, authHeader, roomId) {
  const u = new URL('/api/ws-token', apiUrl);
  if (roomId) u.searchParams.set('roomId', roomId);
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: { Authorization: authHeader },
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`ws-token HTTP ${res.statusCode}: ${data}`));
        try {
          const body = JSON.parse(data || '{}');
          if (!body.token) return reject(new Error('ws-token missing token'));
          resolve(body.token);
        } catch (e) {
          reject(new Error(`ws-token parse: ${e.message}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('ws-token timeout')); });
    req.on('error', reject);
  });
}

function startRealtimeListener({ apiUrl, authHeader, roomId, onMessage, onStateChange }) {
  let ws = null;
  let stopped = false;
  let reconnectTimer = null;

  const clearReconnect = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    clearReconnect();
    reconnectTimer = setTimeout(connect, 2000);
  };

  const connect = async () => {
    try {
      const token = await getWsToken(apiUrl, authHeader, roomId);
      const wsUrlObj = new URL(toWsUrl(apiUrl));
      wsUrlObj.searchParams.set('token', token);
      if (roomId) wsUrlObj.searchParams.set('roomId', roomId);
      const wsUrl = wsUrlObj.toString();
      ws = new WebSocket(wsUrl);
      ws.on('open', () => onStateChange && onStateChange('connected'));
      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        if (msg.type === 'history') return;
        onMessage && onMessage(msg);
      });
      ws.on('close', () => {
        onStateChange && onStateChange('disconnected');
        scheduleReconnect();
      });
      ws.on('error', (err) => {
        onStateChange && onStateChange(`ws-error:${err.message}`);
      });
    } catch (e) {
      onStateChange && onStateChange(`error:${e.message}`);
      scheduleReconnect();
    }
  };

  connect();

  return {
    stop() {
      stopped = true;
      clearReconnect();
      if (ws) ws.close();
    },
  };
}

module.exports = { startRealtimeListener };
