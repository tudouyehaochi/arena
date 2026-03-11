const crypto = require('crypto');
const redis = require('./redis-client');
const networkPolicy = require('./network-policy');

const SKILL_INSTALL_HASH = 'arena:skills:installed:v1';
const SKILL_AUDIT_LIST = 'arena:skills:audit:v1';
const MAX_AUDIT = 500;

function nowIso() {
  return new Date().toISOString();
}

function normalizeSourceType(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === 'repo' ? 'repo' : 'url';
}

function normalizeSkillId(v) {
  return String(v || '').trim().toLowerCase();
}

function checksumFor(sourceRef) {
  return crypto.createHash('sha256').update(String(sourceRef || '')).digest('hex');
}

function parseSourceHost(sourceRef) {
  const raw = String(sourceRef || '').trim();
  if (!raw) return '';
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).hostname.toLowerCase();
    const withProtocol = raw.includes('://') ? raw : `https://${raw}`;
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return '';
  }
}

async function listInstalledSkills() {
  if (!redis.isReady()) return [];
  const raw = await redis.getClient().hgetall(SKILL_INSTALL_HASH);
  const out = [];
  for (const [skillId, payload] of Object.entries(raw || {})) {
    try { out.push({ skillId, ...JSON.parse(String(payload || '{}')) }); } catch {}
  }
  return out.sort((a, b) => String(a.skillId).localeCompare(String(b.skillId)));
}

async function appendAudit(entry) {
  if (!redis.isReady()) return;
  const c = redis.getClient();
  const payload = JSON.stringify(entry);
  if (typeof c.lpush === 'function') {
    await c.lpush(SKILL_AUDIT_LIST, payload);
    if (typeof c.ltrim === 'function') await c.ltrim(SKILL_AUDIT_LIST, 0, MAX_AUDIT - 1);
    return;
  }
  if (typeof c.rpush === 'function') {
    await c.rpush(SKILL_AUDIT_LIST, payload);
    if (typeof c.lrange === 'function' && typeof c.del === 'function') {
      const rows = await c.lrange(SKILL_AUDIT_LIST, 0, -1);
      const keep = Array.isArray(rows) ? rows.slice(-MAX_AUDIT) : [];
      await c.del(SKILL_AUDIT_LIST);
      if (keep.length > 0) await c.rpush(SKILL_AUDIT_LIST, ...keep);
    }
  }
}

async function listSkillAudit(limit = 100) {
  if (!redis.isReady()) return [];
  const raw = await redis.getClient().lrange(SKILL_AUDIT_LIST, 0, Math.max(0, Math.min(limit, MAX_AUDIT) - 1));
  const out = [];
  for (const row of raw) {
    try { out.push(JSON.parse(String(row || '{}'))); } catch {}
  }
  return out;
}

async function installSkill({
  skillId,
  sourceType = 'url',
  sourceRef,
  installedBy = 'admin',
} = {}) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const id = normalizeSkillId(skillId);
  if (!id) throw new Error('missing_skill_id');
  const ref = String(sourceRef || '').trim();
  if (!ref) throw new Error('missing_source_ref');

  const host = parseSourceHost(ref);
  const policy = await networkPolicy.getPolicy();
  const evalRes = networkPolicy.evaluateAccess(policy, {
    role: 'admin',
    skills: ['skill-installer'],
    domain: host,
  });
  if (!evalRes.allow) throw new Error(`network_blocked:${evalRes.reason}`);

  const existingAll = await redis.getClient().hgetall(SKILL_INSTALL_HASH);
  const existingRaw = existingAll && Object.prototype.hasOwnProperty.call(existingAll, id) ? existingAll[id] : '';
  const existing = existingRaw ? JSON.parse(existingRaw) : null;
  const meta = {
    status: 'active',
    sourceType: normalizeSourceType(sourceType),
    sourceRef: ref,
    sourceHost: host,
    checksum: checksumFor(ref),
    installedBy: String(installedBy || 'admin'),
    installedAt: nowIso(),
    updatedAt: nowIso(),
    version: Number(existing?.version || 0) + 1,
    previous: existing ? {
      sourceType: existing.sourceType,
      sourceRef: existing.sourceRef,
      checksum: existing.checksum,
      version: existing.version,
      updatedAt: existing.updatedAt,
    } : null,
  };
  await redis.getClient().hset(SKILL_INSTALL_HASH, id, JSON.stringify(meta));
  await appendAudit({
    ts: nowIso(),
    action: 'install',
    skillId: id,
    by: String(installedBy || 'admin'),
    sourceType: meta.sourceType,
    sourceRef: meta.sourceRef,
    checksum: meta.checksum,
  });
  return { skillId: id, ...meta };
}

async function updateSkillStatus(skillId, action = 'disable', actor = 'admin') {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const id = normalizeSkillId(skillId);
  if (!id) throw new Error('missing_skill_id');
  const all = await redis.getClient().hgetall(SKILL_INSTALL_HASH);
  const raw = all && Object.prototype.hasOwnProperty.call(all, id) ? all[id] : '';
  if (!raw) throw new Error('skill_not_found');
  const current = JSON.parse(raw);
  if (action === 'disable') {
    current.status = 'disabled';
  } else if (action === 'enable') {
    current.status = 'active';
  } else if (action === 'rollback') {
    if (!current.previous || !current.previous.sourceRef) throw new Error('no_previous_version');
    current.sourceType = current.previous.sourceType;
    current.sourceRef = current.previous.sourceRef;
    current.checksum = current.previous.checksum;
    current.status = 'active';
    current.version = Number(current.version || 1) + 1;
  } else {
    throw new Error('invalid_action');
  }
  current.updatedAt = nowIso();
  await redis.getClient().hset(SKILL_INSTALL_HASH, id, JSON.stringify(current));
  await appendAudit({
    ts: nowIso(),
    action,
    skillId: id,
    by: String(actor || 'admin'),
  });
  return { skillId: id, ...current };
}

module.exports = {
  SKILL_INSTALL_HASH,
  SKILL_AUDIT_LIST,
  parseSourceHost,
  listInstalledSkills,
  listSkillAudit,
  installSkill,
  updateSkillStatus,
};
