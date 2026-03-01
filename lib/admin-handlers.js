const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const auth = require('./auth');
const redis = require('./redis-client');
const store = require('./message-store');
const alerts = require('./alert-center');
const { runIntegrityCheck } = require('./redis-integrity-check');
const { jsonResponse, readBody } = require('./route-handlers');

const ADMIN_HTML = path.join(__dirname, '..', 'public', 'admin.html');
const LAST_CHECK_KEY = 'arena:integrity:last';
const ADMIN_USER = String(process.env.ARENA_ADMIN_USER || 'admin');
const ADMIN_PASS = String(process.env.ARENA_ADMIN_PASS || 'arena_123');
const ADMIN_SESSION_PREFIX = 'arena:admin:session:';
const ADMIN_SESSION_TTL_S = 8 * 60 * 60;
function getAdminKey() {
  return String(process.env.ARENA_ADMIN_KEY || '').trim();
}
function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}
async function validateAdminSession(token) {
  if (!token || !redis.isReady()) return false;
  const v = await redis.getClient().get(`${ADMIN_SESSION_PREFIX}${token}`);
  return v === ADMIN_USER;
}

async function requireAdmin(req) {
  const url = new URL(req.url || '/admin', 'http://localhost');
  const q = String(url.searchParams.get('adminKey') || '').trim();
  const h = String(req.headers['x-admin-key'] || '').trim();
  const key = q || h;
  const adminKey = getAdminKey();
  if (adminKey && key === adminKey) return { ok: true, mode: 'admin_key' };
  const tokenHeader = String(req.headers['x-admin-token'] || '').trim();
  const tokenCookie = parseCookies(req).arena_admin_token || '';
  if (await validateAdminSession(tokenHeader || tokenCookie)) return { ok: true, mode: 'admin_session' };
  const a = await auth.authenticate(req, {});
  if (a.ok) return { ok: true, mode: 'bearer' };
  return { ok: false };
}

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

async function handleGetAdmin(req, res) {
  fs.readFile(ADMIN_HTML, (err, data) => {
    if (err) { res.writeHead(500); res.end('Error loading admin UI'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
}

async function handleGetAdminStatus(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    jsonResponse(res, 200, await getStatus());
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 500;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handlePostAdminCheck(req, res, context = {}) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const safeContext = {
      instanceId: String(context.instanceId || ''),
      runtimeEnv: String(context.runtimeEnv || ''),
      port: Number(context.port || 0),
    };
    const check = await runIntegrityCheck(safeContext);
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
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
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

async function handlePostAdminLogin(req, res) {
  try {
    const body = await readBody(req, 4096);
    const parsed = JSON.parse(body || '{}');
    const username = String(parsed.username || '').trim();
    const password = String(parsed.password || '');
    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
      jsonResponse(res, 401, { error: 'invalid_credentials' });
      return;
    }
    if (!redis.isReady()) throw new Error('redis_unavailable');
    const token = crypto.randomUUID();
    await redis.getClient().set(`${ADMIN_SESSION_PREFIX}${token}`, ADMIN_USER, 'EX', ADMIN_SESSION_TTL_S);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `arena_admin_token=${encodeURIComponent(token)}; Path=/; Max-Age=${ADMIN_SESSION_TTL_S}; SameSite=Lax`,
    });
    res.end(JSON.stringify({ status: 'ok', token, username: ADMIN_USER, ttlSec: ADMIN_SESSION_TTL_S }));
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 400;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handlePostAdminLogout(req, res) {
  try {
    const tokenHeader = String(req.headers['x-admin-token'] || '').trim();
    const tokenCookie = parseCookies(req).arena_admin_token || '';
    const token = tokenHeader || tokenCookie;
    if (token && redis.isReady()) {
      await redis.getClient().del(`${ADMIN_SESSION_PREFIX}${token}`);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'arena_admin_token=; Path=/; Max-Age=0; SameSite=Lax',
    });
    res.end(JSON.stringify({ status: 'ok' }));
  } catch (err) {
    jsonResponse(res, 400, { error: err.message });
  }
}

module.exports = {
  handleGetAdmin,
  handleGetAdminStatus,
  handlePostAdminCheck,
  handlePostAdminAlertAck,
  handlePostAdminLogin,
  handlePostAdminLogout,
  runIntegrityCheck,
  LAST_CHECK_KEY,
};
