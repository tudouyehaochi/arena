const redis = require('./redis-client');

const ALERT_KEY = 'arena:alerts';
const ACK_SET = 'arena:alerts:acked';
const ACK_HASH = 'arena:alerts:ack-meta';
const MAX_ALERTS = 500;

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function pushAlert(level, event, detail = {}) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const item = {
    id: makeId(),
    ts: nowIso(),
    level: String(level || 'WARN').toUpperCase(),
    event: String(event || 'unknown'),
    detail,
  };
  const c = redis.getClient();
  await c.lpush(ALERT_KEY, JSON.stringify(item));
  await c.ltrim(ALERT_KEY, 0, MAX_ALERTS - 1);
  await pruneAckSet(c);
  return item;
}

async function pruneAckSet(c) {
  const raw = await c.lrange(ALERT_KEY, 0, MAX_ALERTS - 1);
  const keep = new Set();
  for (const s of raw) {
    try { keep.add(JSON.parse(s).id); } catch {}
  }
  const acked = await c.smembers(ACK_SET);
  const stale = acked.filter((id) => !keep.has(id));
  if (stale.length > 0) await c.srem(ACK_SET, ...stale);
  const ackMetaIds = await c.hkeys(ACK_HASH);
  const staleMeta = (ackMetaIds || []).filter((id) => !keep.has(id));
  if (staleMeta.length > 0) await c.hdel(ACK_HASH, ...staleMeta);
}

async function listAlerts(limit = 100, filters = {}) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const c = redis.getClient();
  const raw = await c.lrange(ALERT_KEY, 0, Math.max(0, limit - 1));
  const out = [];
  for (const s of raw) {
    try { out.push(JSON.parse(s)); } catch {}
  }
  const result = [];
  for (const a of out) {
    const acked = Number(await c.sismember(ACK_SET, a.id)) === 1;
    let ackMeta = null;
    if (acked) {
      try { ackMeta = JSON.parse(String(await c.hget(ACK_HASH, a.id) || '{}')); } catch {}
    }
    result.push({
      ...a,
      acked,
      ackedBy: ackMeta?.ackedBy || '',
      ackedAt: ackMeta?.ackedAt || '',
    });
  }
  const level = String(filters.level || '').trim().toUpperCase();
  const event = String(filters.event || '').trim();
  const ackedFilter = String(filters.acked || '').trim().toLowerCase();
  const q = String(filters.q || '').trim();
  return result.filter((item) => {
    if (level && item.level !== level) return false;
    if (event && item.event !== event) return false;
    if (ackedFilter === 'true' && item.acked !== true) return false;
    if (ackedFilter === 'false' && item.acked !== false) return false;
    if (q) {
      const blob = `${item.event} ${JSON.stringify(item.detail || {})}`.toLowerCase();
      if (!blob.includes(q.toLowerCase())) return false;
    }
    return true;
  });
}

async function ackAlert(id, actor = 'admin') {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  if (!id) throw new Error('missing_alert_id');
  const c = redis.getClient();
  const ackedAt = nowIso();
  await c.sadd(ACK_SET, String(id));
  await c.hset(ACK_HASH, String(id), JSON.stringify({
    ackedBy: String(actor || 'admin'),
    ackedAt,
  }));
  return { ok: true, id: String(id), ackedBy: String(actor || 'admin'), ackedAt };
}

module.exports = {
  pushAlert,
  listAlerts,
  ackAlert,
};
