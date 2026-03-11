const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const auth = require('./auth');
const redis = require('./redis-client');
const store = require('./message-store');
const alerts = require('./alert-center');
const agentModelConfig = require('./agent-model-config');
const agentRegistry = require('./agent-registry');
const skillCatalog = require('./skill-catalog');
const networkPolicy = require('./network-policy');
const intelScheduler = require('./intel-scheduler');
const skillSourceRegistry = require('./skill-source-registry');
const { runIntegrityCheck } = require('./redis-integrity-check');
const { jsonResponse, readBody } = require('./route-handlers');

const ADMIN_HTML = path.join(__dirname, '..', 'public', 'admin.html');
const LAST_CHECK_KEY = 'arena:integrity:last';
const ADMIN_USER = String(process.env.ARENA_ADMIN_USER || 'admin');
const ADMIN_PASS = String(process.env.ARENA_ADMIN_PASS || '');
const ADMIN_SESSION_PREFIX = 'arena:admin:session:';
const ADMIN_SESSION_TTL_S = 8 * 60 * 60;
const LAST_BACKUP_KEY = 'arena:admin:backup:last';
const LAST_RESTORE_DRILL_KEY = 'arena:admin:restore:last';
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

function runScript(scriptPath, args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    execFile(scriptPath, args, { cwd: process.cwd(), timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = String(stdout || '');
        err.stderr = String(stderr || '');
        reject(err);
        return;
      }
      resolve({
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

async function getStatus() {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const c = redis.getClient();
  const [
    serverInfo,
    memoryInfo,
    clientsInfo,
    rooms,
    alertItems,
    lastCheckRaw,
    lastBackupRaw,
    lastRestoreRaw,
    presetSync,
    netPolicy,
    intelConfig,
    intelStatus,
    installedSkills,
  ] = await Promise.all([
    c.info('server'), c.info('memory'), c.info('clients'), store.listRooms(), alerts.listAlerts(50), c.get(LAST_CHECK_KEY), c.get(LAST_BACKUP_KEY), c.get(LAST_RESTORE_DRILL_KEY),
    agentRegistry.getPresetSyncStatus().catch(() => null),
    networkPolicy.getPolicy().catch(() => null),
    intelScheduler.getConfig().catch(() => null),
    intelScheduler.getStatus().catch(() => null),
    skillSourceRegistry.listInstalledSkills().catch(() => []),
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
    backupTask: lastBackupRaw ? JSON.parse(lastBackupRaw) : null,
    restoreDrill: lastRestoreRaw ? JSON.parse(lastRestoreRaw) : null,
    rolePreset: {
      presetVersion: agentRegistry.getPresetVersion(),
      lastSync: presetSync || null,
    },
    networkPolicy: netPolicy || networkPolicy.defaultPolicy(),
    intelSchedule: {
      config: intelConfig || intelScheduler.defaultConfig(),
      status: intelStatus || null,
    },
    installedSkills,
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

async function handleGetAdminBootstrap(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  const fallbackStatus = {
    runtime: {
      host: os.hostname(),
      pid: process.pid,
      redisUrl: redis.getResolvedUrl(),
      redisReady: redis.isReady(),
      redisVersion: '',
      connectedClients: 0,
      usedMemory: 0,
      usedMemoryHuman: '',
      aofEnabled: false,
    },
    rooms: { total: 0 },
    alerts: [],
    integrity: null,
    backups: [],
    backupTask: null,
    restoreDrill: null,
    rolePreset: {
      presetVersion: agentRegistry.getPresetVersion(),
      lastSync: null,
    },
    networkPolicy: networkPolicy.defaultPolicy(),
    intelSchedule: {
      config: intelScheduler.defaultConfig(),
      status: null,
    },
    installedSkills: [],
  };
  try {
    const [statusRes, rolesRes, modelRes, skillAuditRes] = await Promise.allSettled([
      getStatus(),
      agentRegistry.listRoles(),
      agentModelConfig.getAgentModelMap(),
      skillSourceRegistry.listSkillAudit(100),
    ]);
    const status = statusRes.status === 'fulfilled' ? statusRes.value : fallbackStatus;
    const roles = rolesRes.status === 'fulfilled' ? rolesRes.value : [];
    const modelMap = modelRes.status === 'fulfilled' ? modelRes.value : {};
    jsonResponse(res, 200, {
      ...status,
      roles,
      skills: skillCatalog.listSkills(),
      allowedModels: agentModelConfig.ALLOWED_MODELS,
      allowedActivationModes: agentRegistry.ALLOWED_ACTIVATION_MODES,
      agentModels: modelMap,
      skillAudit: skillAuditRes.status === 'fulfilled' ? skillAuditRes.value : [],
    });
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
    const out = await alerts.ackAlert(parsed.id, parsed.actor || ADMIN_USER);
    jsonResponse(res, 200, out);
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 400;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handlePostAdminAlertsQuery(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const body = await readBody(req, 8192);
    const parsed = JSON.parse(body || '{}');
    const limit = Number.parseInt(String(parsed.limit || 100), 10);
    const items = await alerts.listAlerts(Number.isFinite(limit) ? Math.max(1, Math.min(limit, 500)) : 100, parsed.filters || {});
    jsonResponse(res, 200, { alerts: items });
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
    if (!ADMIN_PASS) {
      jsonResponse(res, 503, { error: 'admin_password_not_configured' });
      return;
    }
    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
      jsonResponse(res, 401, { error: 'invalid_credentials' });
      return;
    }
    if (!redis.isReady()) throw new Error('redis_unavailable');
    const token = crypto.randomUUID();
    await redis.getClient().set(`${ADMIN_SESSION_PREFIX}${token}`, ADMIN_USER, 'EX', ADMIN_SESSION_TTL_S);
    const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
    const cookieParts = [
      `arena_admin_token=${encodeURIComponent(token)}`,
      'Path=/',
      `Max-Age=${ADMIN_SESSION_TTL_S}`,
      'SameSite=Lax',
      'HttpOnly',
    ];
    if (secure) cookieParts.push('Secure');
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': cookieParts.join('; '),
    });
    res.end(JSON.stringify({ status: 'ok', username: ADMIN_USER, ttlSec: ADMIN_SESSION_TTL_S }));
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
    const secure = String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
    const clearCookieParts = [
      'arena_admin_token=',
      'Path=/',
      'Max-Age=0',
      'SameSite=Lax',
      'HttpOnly',
    ];
    if (secure) clearCookieParts.push('Secure');
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': clearCookieParts.join('; '),
    });
    res.end(JSON.stringify({ status: 'ok' }));
  } catch (err) {
    jsonResponse(res, 400, { error: err.message });
  }
}

async function handleGetAdminAgentModels(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const models = await agentModelConfig.getAgentModelMap();
    jsonResponse(res, 200, { models, allowedModels: agentModelConfig.ALLOWED_MODELS });
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 500;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handlePostAdminAgentModels(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const body = await readBody(req, 8192);
    const parsed = JSON.parse(body || '{}');
    const models = await agentModelConfig.setAgentModelMap(parsed.models || {});
    jsonResponse(res, 200, { status: 'ok', models });
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 400;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handleGetAdminRoles(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const roles = await agentRegistry.listRoles();
    jsonResponse(res, 200, {
      roles,
      skills: skillCatalog.listSkills(),
      allowedModels: agentRegistry.ALLOWED_MODELS,
      allowedActivationModes: agentRegistry.ALLOWED_ACTIVATION_MODES,
    });
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 500;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handlePostAdminRoles(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const body = await readBody(req, 65536);
    const parsed = JSON.parse(body || '{}');
    const roles = await agentRegistry.replaceRoles(parsed.roles || []);
    jsonResponse(res, 200, { status: 'ok', roles });
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 400;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handlePostAdminRolePresetSync(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const body = await readBody(req, 4096);
    const parsed = JSON.parse(body || '{}');
    const mode = String(parsed.mode || 'merge_missing').trim();
    const out = await agentRegistry.syncPresetRoles(mode);
    jsonResponse(res, 200, { status: 'ok', ...out });
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 400;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handleGetAdminNetworkPolicy(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const policy = await networkPolicy.getPolicy();
    jsonResponse(res, 200, { policy });
  } catch (err) {
    jsonResponse(res, 500, { error: err.message });
  }
}

async function handlePostAdminNetworkPolicy(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const body = await readBody(req, 16384);
    const parsed = JSON.parse(body || '{}');
    const policy = await networkPolicy.setPolicy(parsed.policy || {});
    jsonResponse(res, 200, { status: 'ok', policy });
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 400;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handleGetAdminIntelSchedule(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const [config, status] = await Promise.all([
      intelScheduler.getConfig(),
      intelScheduler.getStatus(),
    ]);
    jsonResponse(res, 200, { config, status });
  } catch (err) {
    jsonResponse(res, 500, { error: err.message });
  }
}

async function handlePostAdminIntelSchedule(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const body = await readBody(req, 32768);
    const parsed = JSON.parse(body || '{}');
    const config = await intelScheduler.setConfig(parsed.config || {});
    jsonResponse(res, 200, { status: 'ok', config });
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 400;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handlePostAdminIntelScheduleRun(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const config = await intelScheduler.getConfig();
    const out = await intelScheduler.runOnce(config, Date.now(), true);
    if (!out.ok) { jsonResponse(res, 500, out); return; }
    jsonResponse(res, 200, out);
  } catch (err) {
    jsonResponse(res, 500, { error: err.message });
  }
}

async function handleGetAdminInstalledSkills(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const [installed, audit] = await Promise.all([
      skillSourceRegistry.listInstalledSkills(),
      skillSourceRegistry.listSkillAudit(100),
    ]);
    jsonResponse(res, 200, { installed, audit });
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 500;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handlePostAdminInstallSkill(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const body = await readBody(req, 32768);
    const parsed = JSON.parse(body || '{}');
    const out = await skillSourceRegistry.installSkill({
      skillId: parsed.skillId,
      sourceType: parsed.sourceType,
      sourceRef: parsed.sourceRef,
      installedBy: parsed.installedBy || ADMIN_USER,
    });
    jsonResponse(res, 200, { status: 'ok', skill: out });
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 400;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handlePostAdminSkillStatus(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const body = await readBody(req, 8192);
    const parsed = JSON.parse(body || '{}');
    const out = await skillSourceRegistry.updateSkillStatus(parsed.skillId, parsed.action, parsed.actor || ADMIN_USER);
    jsonResponse(res, 200, { status: 'ok', skill: out });
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 400;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handlePostAdminBackupRun(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  try {
    const body = await readBody(req, 4096);
    const parsed = JSON.parse(body || '{}');
    const runtimeEnv = String(process.env.ARENA_ENVIRONMENT || 'dev').toLowerCase() === 'prod' ? 'prod' : 'dev';
    const kind = String(parsed.kind || 'hourly').trim() === 'daily' ? 'daily' : 'hourly';
    const scriptPath = path.join(process.cwd(), 'scripts', 'redis-backup.sh');
    const startedAt = new Date().toISOString();
    const result = await runScript(scriptPath, ['--env', runtimeEnv, '--kind', kind], 180000);
    const task = {
      status: 'ok',
      env: runtimeEnv,
      kind,
      startedAt,
      finishedAt: new Date().toISOString(),
      output: result.stdout.trim(),
    };
    if (redis.isReady()) await redis.getClient().set(LAST_BACKUP_KEY, JSON.stringify(task));
    jsonResponse(res, 200, task);
  } catch (err) {
    const runtimeEnv = String(process.env.ARENA_ENVIRONMENT || 'dev').toLowerCase() === 'prod' ? 'prod' : 'dev';
    const task = {
      status: 'failed',
      env: runtimeEnv,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: String(err.stderr || err.stdout || err.message || 'backup_failed').slice(0, 800),
    };
    if (redis.isReady()) await redis.getClient().set(LAST_BACKUP_KEY, JSON.stringify(task));
    await alerts.pushAlert('CRITICAL', 'backup_failed', { env: runtimeEnv, error: task.error }).catch(() => {});
    jsonResponse(res, 500, task);
  }
}

async function handlePostAdminRestoreDrill(req, res) {
  const gate = await requireAdmin(req);
  if (!gate.ok) { jsonResponse(res, 401, { error: 'unauthorized_admin' }); return; }
  const runtimeEnv = String(process.env.ARENA_ENVIRONMENT || 'dev').toLowerCase() === 'prod' ? 'prod' : 'dev';
  if (runtimeEnv !== 'dev') {
    jsonResponse(res, 400, { error: 'restore_drill_dev_only' });
    return;
  }
  try {
    const body = await readBody(req, 4096);
    const parsed = JSON.parse(body || '{}');
    const backups = await listBackups();
    const selected = String(parsed.backupName || backups[0]?.name || '').trim();
    if (!selected) throw new Error('backup_not_found');
    const backupPath = path.join(process.cwd(), 'backups', runtimeEnv, selected);
    if (!fs.existsSync(backupPath)) throw new Error('backup_not_found');
    const scriptPath = path.join(process.cwd(), 'scripts', 'redis-restore.sh');
    const startedAt = new Date().toISOString();
    const result = await runScript(scriptPath, ['--env', runtimeEnv, '--backup', backupPath, '--force'], 180000);
    const task = {
      status: 'ok',
      env: runtimeEnv,
      backupName: selected,
      startedAt,
      finishedAt: new Date().toISOString(),
      output: result.stdout.trim(),
    };
    if (redis.isReady()) await redis.getClient().set(LAST_RESTORE_DRILL_KEY, JSON.stringify(task));
    jsonResponse(res, 200, task);
  } catch (err) {
    const task = {
      status: 'failed',
      env: runtimeEnv,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: String(err.stderr || err.stdout || err.message || 'restore_failed').slice(0, 800),
    };
    if (redis.isReady()) await redis.getClient().set(LAST_RESTORE_DRILL_KEY, JSON.stringify(task));
    await alerts.pushAlert('CRITICAL', 'restore_drill_failed', { env: runtimeEnv, error: task.error }).catch(() => {});
    jsonResponse(res, 500, task);
  }
}

module.exports = {
  handleGetAdmin,
  handleGetAdminStatus,
  handleGetAdminBootstrap,
  handlePostAdminCheck,
  handlePostAdminAlertAck,
  handlePostAdminAlertsQuery,
  handlePostAdminLogin,
  handlePostAdminLogout,
  handleGetAdminAgentModels,
  handlePostAdminAgentModels,
  handleGetAdminRoles,
  handlePostAdminRoles,
  handlePostAdminRolePresetSync,
  handleGetAdminNetworkPolicy,
  handlePostAdminNetworkPolicy,
  handleGetAdminIntelSchedule,
  handlePostAdminIntelSchedule,
  handlePostAdminIntelScheduleRun,
  handleGetAdminInstalledSkills,
  handlePostAdminInstallSkill,
  handlePostAdminSkillStatus,
  handlePostAdminBackupRun,
  handlePostAdminRestoreDrill,
  runIntegrityCheck,
  LAST_CHECK_KEY,
};
