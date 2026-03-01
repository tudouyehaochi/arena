const fs = require('fs');
const path = require('path');
const os = require('os');
const redis = require('./redis-client');
const store = require('./message-store');
const alerts = require('./alert-center');
const { runIntegrityCheck } = require('./redis-integrity-check');
const { jsonResponse, readBody } = require('./route-handlers');

const ADMIN_HTML = path.join(__dirname, '..', 'public', 'admin.html');
const LAST_CHECK_KEY = 'arena:integrity:last';

function parseInfo(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    if (!line || line.startsWith('#') || !line.includes(':')) continue;
    const idx = line.indexOf(':');
    out[line.slice(0, idx)] = line.slice(idx + 1).trim();
  }
  return out;
}

async function listBackups() {
  const env = String(process.env.ARENA_ENVIRONMENT || 'dev').toLowerCase() === 'prod' ? 'prod' : 'dev';
  const dir = path.join(process.cwd(), 'backups', env);
  try {
    const names = fs.readdirSync(dir).filter((n) => n.endsWith('.tar.gz')).sort().reverse().slice(0, 20);
    return names.map((name) => {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      return { name, size: st.size, mtime: st.mtime.toISOString() };
    });
  } catch {
    return [];
  }
}

async function getStatus() {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const c = redis.getClient();
  const [serverInfo, memoryInfo, clientsInfo, rooms, alertItems, lastCheckRaw] = await Promise.all([
    c.info('server'), c.info('memory'), c.info('clients'), store.listRooms(), alerts.listAlerts(50), c.get(LAST_CHECK_KEY),
  ]);
  const server = parseInfo(serverInfo);
  const memory = parseInfo(memoryInfo);
  const clients = parseInfo(clientsInfo);
  const backups = await listBackups();
  return {
    runtime: {
      host: os.hostname(),
      pid: process.pid,
      redisUrl: redis.getResolvedUrl(),
      redisReady: redis.isReady(),
      redisVersion: server.redis_version || '',
      connectedClients: Number(clients.connected_clients || 0),
      usedMemory: Number(memory.used_memory || 0),
      usedMemoryHuman: memory.used_memory_human || '',
      aofEnabled: String(server.aof_enabled || '') === '1',
    },
    rooms: { total: rooms.length },
    alerts: alertItems,
    integrity: lastCheckRaw ? JSON.parse(lastCheckRaw) : null,
    backups,
  };
}

async function handleGetAdmin(_req, res) {
  fs.readFile(ADMIN_HTML, (err, data) => {
    if (err) { res.writeHead(500); res.end('Error loading admin UI'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
}

async function handleGetAdminStatus(_req, res) {
  try {
    jsonResponse(res, 200, await getStatus());
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 500;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handlePostAdminCheck(_req, res, context = {}) {
  try {
    const check = await runIntegrityCheck(context);
    await redis.getClient().set(LAST_CHECK_KEY, JSON.stringify(check));
    if (!check.ok) await alerts.pushAlert('CRITICAL', 'integrity_check_failed', { issueCount: check.issues.length });
    else if (check.issues.length > 0) await alerts.pushAlert('WARN', 'integrity_check_warning', { issueCount: check.issues.length });
    jsonResponse(res, 200, check);
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 500;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handlePostAdminAlertAck(req, res) {
  try {
    const body = await readBody(req, 4096);
    const parsed = JSON.parse(body || '{}');
    const out = await alerts.ackAlert(parsed.id);
    jsonResponse(res, 200, out);
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 400;
    jsonResponse(res, code, { error: err.message });
  }
}

module.exports = {
  handleGetAdmin,
  handleGetAdminStatus,
  handlePostAdminCheck,
  handlePostAdminAlertAck,
  runIntegrityCheck,
  LAST_CHECK_KEY,
};
