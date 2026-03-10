const redis = require('./redis-client');
const { AGENT_NAMES: DEFAULT_AGENT_NAMES } = require('./room');

const ROLE_INDEX_KEY = 'arena:roles:index';
const ROLE_KEY_PREFIX = 'arena:role:';
const ALLOWED_MODELS = new Set(['claude', 'codex']);

let cachedRoles = defaultRoles();
let cacheUpdatedAt = Date.now();

function defaultRoles() {
  return DEFAULT_AGENT_NAMES.map((name, i) => ({
    name,
    model: i === 0 ? 'claude' : 'codex',
    avatar: String(name || '?')[0] || '?',
    color: i === 0 ? '#2dd4bf' : '#60a5fa',
    enabled: true,
    persona: '',
    updatedAt: new Date().toISOString(),
  }));
}

function normalizeModel(value, fallback = 'claude') {
  const v = String(value || '').trim().toLowerCase();
  return ALLOWED_MODELS.has(v) ? v : fallback;
}

function normalizeRole(input, fallback = {}) {
  const name = String(input?.name || fallback.name || '').trim();
  if (!name) return null;
  const model = normalizeModel(input?.model, fallback.model || 'claude');
  const enabled = input?.enabled === undefined ? (fallback.enabled !== false) : Boolean(input.enabled);
  const avatar = String(input?.avatar || fallback.avatar || name[0] || '?').slice(0, 2);
  const color = String(input?.color || fallback.color || (model === 'codex' ? '#60a5fa' : '#2dd4bf')).trim();
  const persona = String(input?.persona || fallback.persona || '').trim();
  return {
    name,
    model,
    avatar,
    color,
    enabled,
    persona,
    updatedAt: new Date().toISOString(),
  };
}

function roleKey(name) {
  return `${ROLE_KEY_PREFIX}${name}`;
}

function setCache(roles) {
  cachedRoles = roles && roles.length > 0 ? roles : defaultRoles();
  cacheUpdatedAt = Date.now();
}

function getCachedRoles() {
  return cachedRoles.slice();
}

function getEnabledAgentNamesFromCache() {
  return cachedRoles.filter((r) => r.enabled !== false).map((r) => r.name);
}

function isAgentName(name) {
  const n = String(name || '');
  return getEnabledAgentNamesFromCache().includes(n);
}

async function ensureDefaultRoles() {
  if (!redis.isReady()) return getCachedRoles();
  const c = redis.getClient();
  const names = await c.smembers(ROLE_INDEX_KEY);
  if (Array.isArray(names) && names.length > 0) return null;
  const defs = defaultRoles();
  for (const role of defs) {
    await c.sadd(ROLE_INDEX_KEY, role.name);
    await c.hset(roleKey(role.name), {
      name: role.name,
      model: role.model,
      avatar: role.avatar,
      color: role.color,
      enabled: role.enabled ? '1' : '0',
      persona: role.persona,
      updatedAt: role.updatedAt,
    });
  }
  return defs;
}

async function listRoles() {
  if (!redis.isReady()) return getCachedRoles();
  await ensureDefaultRoles();
  const c = redis.getClient();
  const names = await c.smembers(ROLE_INDEX_KEY);
  if (!names || names.length === 0) return getCachedRoles();
  const roles = [];
  for (const name of names.sort()) {
    const raw = await c.hgetall(roleKey(name));
    const normalized = normalizeRole({
      name: raw.name || name,
      model: raw.model,
      avatar: raw.avatar,
      color: raw.color,
      enabled: String(raw.enabled || '1') !== '0',
      persona: raw.persona || '',
    });
    if (normalized) roles.push(normalized);
  }
  setCache(roles);
  return roles;
}

async function replaceRoles(nextRoles) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const normalized = (Array.isArray(nextRoles) ? nextRoles : [])
    .map((r) => normalizeRole(r))
    .filter(Boolean);
  if (normalized.length === 0) throw new Error('invalid_roles');
  const dedup = [];
  const seen = new Set();
  for (const role of normalized) {
    if (seen.has(role.name)) continue;
    seen.add(role.name);
    dedup.push(role);
  }
  const c = redis.getClient();
  const oldNames = await c.smembers(ROLE_INDEX_KEY);
  const newNames = dedup.map((r) => r.name);
  for (const oldName of oldNames || []) {
    if (newNames.includes(oldName)) continue;
    await c.srem(ROLE_INDEX_KEY, oldName);
    await c.del(roleKey(oldName));
  }
  for (const role of dedup) {
    await c.sadd(ROLE_INDEX_KEY, role.name);
    await c.hset(roleKey(role.name), {
      name: role.name,
      model: role.model,
      avatar: role.avatar,
      color: role.color,
      enabled: role.enabled ? '1' : '0',
      persona: role.persona,
      updatedAt: role.updatedAt,
    });
  }
  setCache(dedup);
  return dedup;
}

async function refreshRoleCache() {
  const roles = await listRoles();
  return {
    roles,
    enabledAgentNames: getEnabledAgentNamesFromCache(),
    updatedAt: cacheUpdatedAt,
  };
}

module.exports = {
  ALLOWED_MODELS: [...ALLOWED_MODELS],
  normalizeModel,
  normalizeRole,
  listRoles,
  replaceRoles,
  refreshRoleCache,
  getCachedRoles,
  getEnabledAgentNamesFromCache,
  isAgentName,
};
