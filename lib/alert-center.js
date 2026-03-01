const redis = require('./redis-client');

const ALERT_KEY = 'arena:alerts';
const ACK_SET = 'arena:alerts:acked';
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
}

async function listAlerts(limit = 100) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const c = redis.getClient();
  const raw = await c.lrange(ALERT_KEY, 0, Math.max(0, limit - 1));
  const out = [];
  for (const s of raw) {
    try { out.push(JSON.parse(s)); } catch {}
  }
  const result = [];
  for (const a of out) {
    result.push({ ...a, acked: Number(await c.sismember(ACK_SET, a.id)) === 1 });
  }
  return result;
}

async function ackAlert(id) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  if (!id) throw new Error('missing_alert_id');
  await redis.getClient().sadd(ACK_SET, String(id));
  return { ok: true, id: String(id) };
}

module.exports = {
  pushAlert,
  listAlerts,
  ackAlert,
};
