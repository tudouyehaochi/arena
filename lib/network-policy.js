const redis = require('./redis-client');

const NETWORK_POLICY_KEY = 'arena:network:policy:v1';
const MODE_SET = new Set(['inherit', 'allow', 'deny']);

function normalizeMode(v, fallback = 'inherit') {
  const s = String(v || '').trim().toLowerCase();
  return MODE_SET.has(s) ? s : fallback;
}

function normalizeDomainRule(v) {
  return String(v || '').trim().toLowerCase();
}

function normalizePolicy(input = {}) {
  const roleModes = {};
  const skillModes = {};
  const rawRoleModes = input.roleModes && typeof input.roleModes === 'object' ? input.roleModes : {};
  const rawSkillModes = input.skillModes && typeof input.skillModes === 'object' ? input.skillModes : {};
  for (const [k, v] of Object.entries(rawRoleModes)) roleModes[String(k)] = normalizeMode(v, 'inherit');
  for (const [k, v] of Object.entries(rawSkillModes)) skillModes[String(k)] = normalizeMode(v, 'inherit');
  const allowedDomains = Array.isArray(input.allowedDomains)
    ? [...new Set(input.allowedDomains.map(normalizeDomainRule).filter(Boolean))].slice(0, 200)
    : [];
  return {
    networkEnabled: Boolean(input.networkEnabled),
    roleModes,
    skillModes,
    allowedDomains,
    updatedAt: new Date().toISOString(),
  };
}

function defaultPolicy() {
  return normalizePolicy({
    networkEnabled: false,
    roleModes: {},
    skillModes: {},
    allowedDomains: [],
  });
}

function parseHost(input) {
  const v = String(input || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) {
    try { return new URL(v).hostname.toLowerCase(); } catch { return ''; }
  }
  return v.toLowerCase().replace(/:\d+$/, '');
}

function matchDomain(host, rule) {
  if (!host || !rule) return false;
  if (rule === '*') return true;
  if (rule.startsWith('*.')) {
    const base = rule.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === rule || host.endsWith(`.${rule}`);
}

function isDomainAllowed(hostOrUrl, allowedDomains = []) {
  const host = parseHost(hostOrUrl);
  if (!host) return false;
  const rules = Array.isArray(allowedDomains) ? allowedDomains : [];
  return rules.some((rule) => matchDomain(host, normalizeDomainRule(rule)));
}

function resolveModeFlag(mode, fallback = true) {
  const m = normalizeMode(mode, 'inherit');
  if (m === 'allow') return true;
  if (m === 'deny') return false;
  return fallback;
}

function evaluateAccess(policy, options = {}) {
  const p = normalizePolicy(policy || defaultPolicy());
  const role = String(options.role || '').trim();
  const skills = Array.isArray(options.skills) ? options.skills.map((s) => String(s || '').trim()).filter(Boolean) : [];
  const domainInput = String(options.domain || options.url || '').trim();

  const globalAllow = Boolean(p.networkEnabled);
  const roleAllow = resolveModeFlag(role ? p.roleModes[role] : 'inherit', true);
  const skillAllow = skills.length === 0
    ? true
    : skills.every((skillId) => resolveModeFlag(p.skillModes[skillId], true));
  const domainAllow = domainInput ? isDomainAllowed(domainInput, p.allowedDomains) : true;
  const allow = globalAllow && roleAllow && skillAllow && domainAllow;

  return {
    allow,
    reason: allow ? 'allowed' : (
      !globalAllow ? 'global_disabled'
        : !roleAllow ? 'role_denied'
          : !skillAllow ? 'skill_denied'
            : !domainAllow ? 'domain_denied'
              : 'blocked'
    ),
    detail: {
      globalAllow,
      roleAllow,
      skillAllow,
      domainAllow,
      host: parseHost(domainInput),
    },
  };
}

async function getPolicy() {
  if (!redis.isReady()) return defaultPolicy();
  const raw = await redis.getClient().get(NETWORK_POLICY_KEY);
  if (!raw) return defaultPolicy();
  try {
    return normalizePolicy(JSON.parse(raw));
  } catch {
    return defaultPolicy();
  }
}

async function setPolicy(next) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const policy = normalizePolicy(next || {});
  await redis.getClient().set(NETWORK_POLICY_KEY, JSON.stringify(policy));
  return policy;
}

module.exports = {
  NETWORK_POLICY_KEY,
  normalizeMode,
  normalizePolicy,
  defaultPolicy,
  parseHost,
  matchDomain,
  isDomainAllowed,
  evaluateAccess,
  getPolicy,
  setPolicy,
};
