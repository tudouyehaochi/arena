const redis = require('./redis-client');
const { AGENT_NAMES } = require('./room');

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

function sanitizeAgentModelMap(input = {}) {
  const out = {};
  for (const agent of AGENT_NAMES) {
    const fallback = DEFAULT_AGENT_MODELS[agent] || 'claude';
    out[agent] = normalizeModel(input[agent], fallback);
  }
  return out;
}

function getDefaultAgentModelMap() {
  return sanitizeAgentModelMap(DEFAULT_AGENT_MODELS);
}

async function getAgentModelMap() {
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
