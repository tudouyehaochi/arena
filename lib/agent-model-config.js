const redis = require('./redis-client');
const { AGENT_NAMES } = require('./room');
const agentRegistry = require('./agent-registry');

const AGENT_MODEL_KEY = 'arena:admin:agent-models';
const ALLOWED_MODELS = new Set(['claude', 'codex']);

const DEFAULT_AGENT_MODELS = {
  清风: 'claude',
  明月: 'codex',
};

function normalizeModel(value, fallback = 'claude') {
  const v = String(value || '').trim().toLowerCase();
  return ALLOWED_MODELS.has(v) ? v : fallback;
}

function sanitizeAgentModelMap(input = {}, agentNames = AGENT_NAMES) {
  const out = {};
  const names = Array.isArray(agentNames) && agentNames.length > 0 ? agentNames : AGENT_NAMES;
  for (const agent of names) {
    const fallback = DEFAULT_AGENT_MODELS[agent] || 'claude';
    out[agent] = normalizeModel(input[agent], fallback);
  }
  return out;
}

function getDefaultAgentModelMap() {
  return sanitizeAgentModelMap(DEFAULT_AGENT_MODELS);
}

async function getAgentModelMap() {
  const roles = await agentRegistry.listRoles().catch(() => []);
  if (roles.length > 0) {
    const dynamic = {};
    const names = [];
    for (const r of roles) dynamic[r.name] = normalizeModel(r.model, DEFAULT_AGENT_MODELS[r.name] || 'claude');
    for (const r of roles) names.push(r.name);
    return sanitizeAgentModelMap({ ...DEFAULT_AGENT_MODELS, ...dynamic }, names);
  }
  const defaults = getDefaultAgentModelMap();
  if (!redis.isReady()) return defaults;
  const raw = await redis.getClient().get(AGENT_MODEL_KEY);
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return sanitizeAgentModelMap({ ...defaults, ...(parsed || {}) });
  } catch {
    return defaults;
  }
}

async function setAgentModelMap(nextMap = {}) {
  const roles = await agentRegistry.listRoles().catch(() => []);
  if (roles.length > 0) {
    const names = roles.map((r) => r.name);
    const merged = sanitizeAgentModelMap(nextMap, names);
    const nextRoles = roles.map((r) => ({ ...r, model: normalizeModel(merged[r.name], r.model || DEFAULT_AGENT_MODELS[r.name] || 'claude') }));
    await agentRegistry.replaceRoles(nextRoles);
    return sanitizeAgentModelMap(Object.fromEntries(nextRoles.map((r) => [r.name, r.model])), names);
  }
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const merged = sanitizeAgentModelMap(nextMap);
  await redis.getClient().set(AGENT_MODEL_KEY, JSON.stringify(merged));
  return merged;
}

module.exports = {
  ALLOWED_MODELS: [...ALLOWED_MODELS],
  getDefaultAgentModelMap,
  getAgentModelMap,
  setAgentModelMap,
  sanitizeAgentModelMap,
  normalizeModel,
};
