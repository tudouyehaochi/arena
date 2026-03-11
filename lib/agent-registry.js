const redis = require('./redis-client');
const { AGENT_NAMES: DEFAULT_AGENT_NAMES } = require('./room');
const skillCatalog = require('./skill-catalog');

const ROLE_INDEX_KEY = 'arena:roles:index';
const ROLE_KEY_PREFIX = 'arena:role:';
const ROLE_PRESET_VERSION_KEY = 'arena:roles:preset:version';
const ROLE_PRESET_SYNC_KEY = 'arena:roles:preset:last-sync';
const ROLE_PRESET_VERSION = '2026-03-11.1';
const ALLOWED_MODELS = new Set(['claude', 'codex']);
const ALLOWED_STATUS = new Set(['idle', 'active', 'muted']);
const ALLOWED_ACTIVATION_MODES = new Set(['mention', 'always_on']);

const DEFAULT_ROLE_DEFINITIONS = [
  {
    name: '清风',
    alias: ['qingfeng'],
    model: 'claude',
    avatar: '清',
    color: '#2dd4bf',
    enabled: true,
    status: 'idle',
    priority: 90,
    activationMode: 'mention',
    skillBindings: [
      { id: 'planning', priority: 'high' },
      { id: 'code-review', priority: 'high' },
      { id: 'risk-check', priority: 'medium' },
    ],
    persona: '严谨、不服输、偶尔害羞。',
  },
  {
    name: '明月',
    alias: ['mingyue'],
    model: 'codex',
    avatar: '明',
    color: '#60a5fa',
    enabled: true,
    status: 'idle',
    priority: 85,
    activationMode: 'always_on',
    skillBindings: [
      { id: 'frontend-design', priority: 'high' },
      { id: 'summarize', priority: 'medium' },
    ],
    persona: '开朗活泼、可爱、不会冷场。',
  },
  {
    name: '二郎神',
    alias: ['二郎', '真君'],
    model: 'claude',
    avatar: '二',
    color: '#0ea5e9',
    enabled: true,
    status: 'idle',
    priority: 88,
    activationMode: 'mention',
    skillBindings: [
      { id: 'incident-response', priority: 'high' },
      { id: 'debugging', priority: 'high' },
      { id: 'validation', priority: 'medium' },
    ],
    persona: '执行果断，擅长故障定位。',
  },
  {
    name: '哪吒',
    alias: ['三太子'],
    model: 'codex',
    avatar: '哪',
    color: '#f97316',
    enabled: true,
    status: 'idle',
    priority: 80,
    activationMode: 'mention',
    skillBindings: [
      { id: 'implementation', priority: 'high' },
      { id: 'delivery', priority: 'medium' },
      { id: 'automation', priority: 'medium' },
    ],
    persona: '行动快，擅长把方案变成可运行结果。',
  },
  {
    name: '千里眼',
    alias: ['千里'],
    model: 'claude',
    avatar: '千',
    color: '#10b981',
    enabled: true,
    status: 'idle',
    priority: 75,
    activationMode: 'always_on',
    skillBindings: [
      { id: 'intel-watch', priority: 'high' },
      { id: 'source-verification', priority: 'medium' },
    ],
    persona: '善于追踪外部动态与来源真实性。',
  },
  {
    name: '顺风耳',
    alias: ['顺风'],
    model: 'codex',
    avatar: '顺',
    color: '#a855f7',
    enabled: true,
    status: 'idle',
    priority: 74,
    activationMode: 'always_on',
    skillBindings: [
      { id: 'signal-filter', priority: 'high' },
      { id: 'trend-tagging', priority: 'medium' },
    ],
    persona: '擅长噪声过滤与趋势标注。',
  },
  {
    name: '文曲星',
    alias: ['文曲', 'ux'],
    model: 'codex',
    avatar: '文',
    color: '#14b8a6',
    enabled: true,
    status: 'idle',
    priority: 82,
    activationMode: 'mention',
    skillBindings: [
      { id: 'frontend-design', priority: 'high' },
      { id: 'planning', priority: 'medium' },
      { id: 'summarize', priority: 'low' },
    ],
    persona: '温润从容，重视体验细节与可用性闭环。',
  },
];

let cachedRoles = defaultRoles();
let cacheUpdatedAt = Date.now();

function defaultRoles() {
  const fromRoster = DEFAULT_ROLE_DEFINITIONS.map((r) => normalizeRole(r)).filter(Boolean);
  const known = new Set(fromRoster.map((r) => r.name));
  for (let i = 0; i < DEFAULT_AGENT_NAMES.length; i++) {
    const name = DEFAULT_AGENT_NAMES[i];
    if (known.has(name)) continue;
    const fallback = normalizeRole({
      name,
      model: i === 0 ? 'claude' : 'codex',
      enabled: true,
      status: 'idle',
      priority: 60 - i,
      avatar: String(name || '?')[0] || '?',
      color: i === 0 ? '#2dd4bf' : '#60a5fa',
    });
    if (fallback) fromRoster.push(fallback);
  }
  return fromRoster;
}

function getPresetVersion() {
  return ROLE_PRESET_VERSION;
}

function normalizeModel(value, fallback = 'claude') {
  const v = String(value || '').trim().toLowerCase();
  return ALLOWED_MODELS.has(v) ? v : fallback;
}

function normalizeStatus(value, fallback = 'idle') {
  const v = String(value || '').trim().toLowerCase();
  return ALLOWED_STATUS.has(v) ? v : fallback;
}

function normalizeStringList(values, maxItems = 8) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const raw of values) {
    const v = String(raw || '').trim();
    if (!v || out.includes(v)) continue;
    out.push(v);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeActivationMode(value, fallback = 'mention') {
  const v = String(value || '').trim().toLowerCase();
  return ALLOWED_ACTIVATION_MODES.has(v) ? v : fallback;
}

function normalizeSkillBindings(input, fallback = []) {
  const raw = Array.isArray(input) && input.length > 0
    ? input
    : (Array.isArray(fallback) ? fallback : []);
  const out = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const id = skillCatalog.normalizeSkillId(item);
      if (!id || out.some((s) => s.id === id)) continue;
      out.push({ id, priority: 'medium' });
      continue;
    }
    const id = skillCatalog.normalizeSkillId(item?.id || item?.skill || '');
    if (!id || out.some((s) => s.id === id)) continue;
    out.push({
      id,
      priority: skillCatalog.normalizePriority(item?.priority, 'medium'),
    });
  }
  return out.slice(0, 16);
}

function normalizeRule(input, fallback = {}, index = 0) {
  const id = String(input?.id || fallback.id || `rule_${index + 1}`).trim();
  const intents = normalizeStringList(input?.intents || fallback.intents || [], 6).map((s) => s.toLowerCase());
  const keywords = normalizeStringList(input?.keywords || fallback.keywords || [], 10);
  const priorityRaw = Number.parseInt(String(input?.priority ?? fallback.priority ?? 50), 10);
  const priority = Number.isInteger(priorityRaw) ? Math.max(1, Math.min(100, priorityRaw)) : 50;
  return { id, intents, keywords, priority };
}

function normalizeRole(input, fallback = {}) {
  const name = String(input?.name || fallback.name || '').trim();
  if (!name) return null;
  const model = normalizeModel(input?.model, fallback.model || 'claude');
  const enabled = input?.enabled === undefined ? (fallback.enabled !== false) : Boolean(input.enabled);
  const avatar = String(input?.avatar || fallback.avatar || name[0] || '?').slice(0, 2);
  const color = String(input?.color || fallback.color || (model === 'codex' ? '#60a5fa' : '#2dd4bf')).trim();
  const persona = String(input?.persona || fallback.persona || '').trim();
  const alias = normalizeStringList(input?.alias || fallback.alias || [], 8);
  const skillBindings = normalizeSkillBindings(
    input?.skillBindings || input?.skills || [],
    fallback.skillBindings || fallback.skills || [],
  );
  const skills = skillBindings.map((s) => s.id);
  const activationMode = normalizeActivationMode(input?.activationMode, fallback.activationMode || 'mention');
  const activationRules = [];
  const priorityRaw = Number.parseInt(String(input?.priority ?? fallback.priority ?? 50), 10);
  const priority = Number.isInteger(priorityRaw) ? Math.max(1, Math.min(100, priorityRaw)) : 50;
  const status = normalizeStatus(input?.status, fallback.status || 'idle');
  return {
    name,
    model,
    avatar,
    color,
    enabled,
    status,
    priority,
    activationMode,
    alias,
    skills,
    skillBindings,
    activationRules,
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

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getCachedRoles() {
  return cachedRoles.slice();
}

function getEnabledAgentNamesFromCache() {
  return cachedRoles.filter((r) => r.enabled !== false && r.status !== 'muted').map((r) => r.name);
}

function isAgentName(name) {
  const n = String(name || '');
  return getEnabledAgentNamesFromCache().includes(n);
}

function resolveMentionTargets(text, roles = cachedRoles) {
  const raw = String(text || '');
  if (!raw.includes('@')) return [];
  const hits = [];
  for (const role of roles || []) {
    const aliases = [role.name, ...(Array.isArray(role.alias) ? role.alias : [])];
    for (const alias of aliases) {
      if (!alias) continue;
      if (!raw.includes(`@${alias}`)) continue;
      if (!hits.includes(role.name)) hits.push(role.name);
      break;
    }
  }
  return hits;
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
      status: role.status,
      priority: String(role.priority),
      alias: JSON.stringify(role.alias || []),
      skills: JSON.stringify(role.skills || []),
      skillBindings: JSON.stringify(role.skillBindings || []),
      activationMode: role.activationMode || 'mention',
      activationRules: JSON.stringify(role.activationRules || []),
      persona: role.persona,
      updatedAt: role.updatedAt,
    });
  }
  await c.set(ROLE_PRESET_VERSION_KEY, ROLE_PRESET_VERSION);
  await c.set(ROLE_PRESET_SYNC_KEY, JSON.stringify({
    mode: 'seed',
    presetVersion: ROLE_PRESET_VERSION,
    changedCount: defs.length,
    syncedAt: new Date().toISOString(),
  }));
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
      status: raw.status || 'idle',
      priority: raw.priority,
      alias: parseJsonArray(raw.alias),
      skills: parseJsonArray(raw.skills),
      skillBindings: parseJsonArray(raw.skillBindings),
      activationMode: raw.activationMode || 'mention',
      activationRules: parseJsonArray(raw.activationRules),
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
      status: role.status,
      priority: String(role.priority),
      alias: JSON.stringify(role.alias || []),
      skills: JSON.stringify(role.skills || []),
      skillBindings: JSON.stringify(role.skillBindings || []),
      activationMode: role.activationMode || 'mention',
      activationRules: JSON.stringify(role.activationRules || []),
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

async function getPresetSyncStatus() {
  if (!redis.isReady()) return null;
  const raw = await redis.getClient().get(ROLE_PRESET_SYNC_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function syncPresetRoles(mode = 'merge_missing') {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const selectedMode = String(mode || 'merge_missing').trim().toLowerCase() === 'apply_all'
    ? 'apply_all'
    : 'merge_missing';
  const presetRoles = defaultRoles();
  const current = await listRoles();
  const byName = new Map(current.map((r) => [r.name, r]));
  let next = [];
  let changedCount = 0;

  if (selectedMode === 'merge_missing') {
    next = current.slice();
    for (const preset of presetRoles) {
      if (byName.has(preset.name)) continue;
      next.push(preset);
      changedCount += 1;
    }
  } else {
    const presetNames = new Set(presetRoles.map((r) => r.name));
    const custom = current.filter((r) => !presetNames.has(r.name));
    next = [...presetRoles, ...custom];
    for (const preset of presetRoles) {
      const existing = byName.get(preset.name);
      if (!existing || JSON.stringify(existing) !== JSON.stringify(preset)) changedCount += 1;
    }
  }

  const saved = await replaceRoles(next);
  const syncMeta = {
    mode: selectedMode,
    presetVersion: ROLE_PRESET_VERSION,
    changedCount,
    syncedAt: new Date().toISOString(),
  };
  const c = redis.getClient();
  await c.set(ROLE_PRESET_VERSION_KEY, ROLE_PRESET_VERSION);
  await c.set(ROLE_PRESET_SYNC_KEY, JSON.stringify(syncMeta));
  return {
    mode: selectedMode,
    presetVersion: ROLE_PRESET_VERSION,
    changedCount,
    totalRoles: saved.length,
    roles: saved,
  };
}

module.exports = {
  ALLOWED_MODELS: [...ALLOWED_MODELS],
  ALLOWED_STATUS: [...ALLOWED_STATUS],
  ALLOWED_ACTIVATION_MODES: [...ALLOWED_ACTIVATION_MODES],
  normalizeModel,
  normalizeStatus,
  normalizeActivationMode,
  normalizeRule,
  normalizeRole,
  listRoles,
  replaceRoles,
  refreshRoleCache,
  getPresetVersion,
  getPresetSyncStatus,
  syncPresetRoles,
  getCachedRoles,
  getEnabledAgentNamesFromCache,
  isAgentName,
  resolveMentionTargets,
};
