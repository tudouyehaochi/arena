const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { getEnv, currentBranch } = require('./lib/env');
const { inferEnvironment, resolvePort } = require('./lib/runtime-config');
const { DEFAULT_ROOM_ID, resolveRoomIdFromUrl } = require('./lib/room');
const runtimeRegistry = require('./lib/runtime-registry');
const auth = require('./lib/auth');
const store = require('./lib/message-store');
const redis = require('./lib/redis-client');
const { handlePostMessage, handleGetSnapshot, handleGetWsToken, jsonResponse } = require('./lib/route-handlers');
const { handlePostAgentContext, handleGetAgentContext } = require('./lib/agent-context-handlers');
const { handleGetDashboard } = require('./lib/dashboard-handlers');
const { handleGetRooms, handlePostRooms, handleDeleteRoom } = require('./lib/room-handlers');
const { handlePostUsage } = require('./lib/usage-handlers');
const { handleGetAdmin, handleGetAdminStatus, handlePostAdminCheck, handlePostAdminAlertAck, runIntegrityCheck, LAST_CHECK_KEY } = require('./lib/admin-handlers');
const alerts = require('./lib/alert-center');
const BRANCH = currentBranch();
const RUNTIME_ENV = inferEnvironment(process.env.ARENA_ENVIRONMENT);
const PORT = resolvePort({ port: process.env.PORT, environment: RUNTIME_ENV, branch: BRANCH });
const INSTANCE_ID = process.env.ARENA_INSTANCE_ID || `${RUNTIME_ENV}:${BRANCH}:${PORT}`;
const DEFAULT_ROOM = process.env.ARENA_ROOM_ID || DEFAULT_ROOM_ID;
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');
redis.startConnect();
function handleGetIndex(_req, res) {
  fs.readFile(INDEX_HTML, (err, data) => {
    if (err) { res.writeHead(500); res.end('Error loading UI'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
}

function roomFromReq(req) {
  return resolveRoomIdFromUrl(req.url || '/', DEFAULT_ROOM);
}
function handleGetMessages(req, res) {
  try { jsonResponse(res, 200, store.getMessages(roomFromReq(req))); }
  catch { jsonResponse(res, 400, { error: 'invalid_room_id' }); }
}
function handleGetEnv(_req, res) {
  jsonResponse(res, 200, { ...getEnv(), runtimeEnvironment: RUNTIME_ENV, branch: BRANCH, port: PORT, instanceId: INSTANCE_ID, defaultRoomId: DEFAULT_ROOM });
}
function handleGetAgentStatus(req, res) {
  try { jsonResponse(res, 200, store.getSnapshot(roomFromReq(req), 0)); }
  catch { jsonResponse(res, 400, { error: 'invalid_room_id' }); }
}
const routes = {
  'GET /': handleGetIndex,
  'GET /api/messages': handleGetMessages,
  'GET /api/env': handleGetEnv,
  'GET /api/agent-status': handleGetAgentStatus,
  'GET /api/ws-token': handleGetWsToken,
  'GET /api/agent-context': handleGetAgentContext,
  'GET /api/dashboard': handleGetDashboard,
  'GET /api/rooms': handleGetRooms,
  'GET /admin': handleGetAdmin,
  'GET /api/admin/status': handleGetAdminStatus,
};
function safeAsync(handler) {
  return (req, res, ...args) => {
    const result = handler(req, res, ...args);
    if (result && typeof result.catch === 'function') {
      result.catch((err) => {
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
  if (routes[key]) { safeAsync(routes[key])(req, res); return; }
  if (method === 'POST' && urlPath === '/api/callbacks/post-message') {
    safeAsync(handlePostMessage)(req, res, broadcast, { instanceId: INSTANCE_ID, runtimeEnv: RUNTIME_ENV, targetPort: PORT });
    return;
  }
  if (method === 'POST' && urlPath === '/api/agent-context') { safeAsync(handlePostAgentContext)(req, res); return; }
  if (method === 'POST' && urlPath === '/api/rooms') { safeAsync(handlePostRooms)(req, res, INSTANCE_ID); return; }
  if (method === 'DELETE' && urlPath === '/api/rooms') { safeAsync(handleDeleteRoom)(req, res); return; }
  if (method === 'POST' && urlPath === '/api/internal/usage') { safeAsync(handlePostUsage)(req, res); return; }
  if (method === 'POST' && urlPath === '/api/admin/check') { safeAsync(handlePostAdminCheck)(req, res, { instanceId: INSTANCE_ID, runtimeEnv: RUNTIME_ENV, port: PORT }); return; }
  if (method === 'POST' && urlPath === '/api/admin/alerts/ack') { safeAsync(handlePostAdminAlertAck)(req, res); return; }
  if (method === 'GET' && (urlPath === '/api/agent-snapshot' || urlPath === '/api/callbacks/thread-context')) {
    safeAsync(handleGetSnapshot)(req, res, PORT); return;
  }
  res.writeHead(404); res.end('Not Found');
});
const wss = new WebSocketServer({ server });
function broadcast(msg, roomId) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    if ((client.roomId || DEFAULT_ROOM) !== roomId) continue;
    try { client.send(data); } catch {}
  }
}
wss.on('connection', async (ws, req) => {
  let roomId;
  try { roomId = roomFromReq(req); }
  catch { ws.close(1008, 'invalid_room'); return; }
  if (!(await store.roomExists(roomId))) {
    ws.close(1008, 'room_not_found');
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sessionToken = url.searchParams.get('token');
  const session = sessionToken ? await auth.validateWsSession(sessionToken, roomId) : { ok: false };
  ws.identity = session.ok ? session.identity : 'anonymous';
  ws.roomId = roomId;
  try {
    await store.loadFromLog(roomId);
  } catch {
    ws.close(1011, 'store_unavailable');
    return;
  }
  ws.send(JSON.stringify({ type: 'history', roomId, messages: store.getMessages(roomId) }));
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (store.isAgent(msg.from) && ws.identity !== 'agent') {
      msg.from = ws.identity === 'human' ? (msg.from || 'anonymous') : 'anonymous';
      if (store.isAgent(msg.from)) msg.from = 'anonymous';
    }
    msg.from = msg.from || 'anonymous';
    const stored = await store.addMessage({ ...msg, roomId }, roomId);
    broadcast(stored, roomId);
  });
});
let heartbeatTimer = null;
async function start() {
  await redis.waitUntilReady(5000);
  const check = await runIntegrityCheck({ instanceId: INSTANCE_ID, runtimeEnv: RUNTIME_ENV, port: PORT });
  await redis.getClient().set(LAST_CHECK_KEY, JSON.stringify(check));
  if (!check.ok) {
    await alerts.pushAlert('CRITICAL', 'startup_integrity_failed', { issueCount: check.issues.length });
    throw new Error('startup_integrity_failed');
  }
  if (check.issues.length > 0) {
    await alerts.pushAlert('WARN', 'startup_integrity_warning', { issueCount: check.issues.length });
  }
  await store.ensureRoom(DEFAULT_ROOM, { title: DEFAULT_ROOM, createdBy: 'system', boundInstanceId: INSTANCE_ID });
  await store.loadFromLog(DEFAULT_ROOM);
  await runtimeRegistry.registerInstance({
    instanceId: INSTANCE_ID,
    runtimeEnv: RUNTIME_ENV,
    branch: BRANCH,
    port: PORT,
    pid: process.pid,
    roomId: DEFAULT_ROOM,
  });
  heartbeatTimer = setInterval(() => {
    runtimeRegistry.heartbeatInstance(INSTANCE_ID).catch(() => {});
  }, 30000);
  heartbeatTimer.unref();
  server.listen(PORT, () => {
    const creds = auth.getCredentials();
    const credsFile = process.env.ARENA_CREDENTIALS_FILE;
    if (credsFile) {
      try { fs.writeFileSync(credsFile, JSON.stringify({ invocationId: creds.invocationId, callbackToken: creds.callbackToken, jti: creds.jti })); }
      catch (e) { console.error(`Failed to write credentials file: ${e.message}`); }
    }
    console.log(`Arena chatroom running at http://localhost:${PORT}`);
    console.log(`Environment: ${RUNTIME_ENV} | Branch: ${BRANCH}`);
    console.log(`Instance: ${INSTANCE_ID} | Default room: ${DEFAULT_ROOM}`);
    console.log(`\n--- MCP Callback Credentials (TTL: ${auth.TOKEN_TTL_MS / 60000}min) ---`);
    console.log(`ARENA_INVOCATION_ID=${creds.invocationId}`);
    console.log(`ARENA_CALLBACK_TOKEN=${creds.callbackToken}`);
    console.log(`Auth header: Authorization: Bearer ${creds.invocationId}:${creds.callbackToken}:${creds.jti}`);
    console.log('--------------------------------------------------\n');
  });
}
async function shutdown() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  await runtimeRegistry.stopInstance(INSTANCE_ID);
  await redis.disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
module.exports = { start, server, wss, broadcast };
if (require.main === module) start();
