const crypto = require('crypto');
const redis = require('./redis-client');

const MEMORY_TYPES = new Set(['decision', 'preference', 'procedure', 'news']);
const DEFAULT_TOPK = 5;

function memoryIndexKey(roomId) {
  return `room:${roomId}:memory:index`;
}

function memoryItemKey(roomId, id) {
  return `room:${roomId}:memory:item:${id}`;
}

function memoryFingerprintKey(roomId, fingerprint) {
  return `room:${roomId}:memory:fp:${fingerprint}`;
}

function normalizeType(type) {
  const t = String(type || '').trim().toLowerCase();
  return MEMORY_TYPES.has(t) ? t : 'procedure';
}

function defaultTtlSecByType(type) {
  const t = normalizeType(type);
  if (t === 'news') return 3 * 24 * 3600;
  if (t === 'decision') return 30 * 24 * 3600;
  if (t === 'preference') return 14 * 24 * 3600;
  return 7 * 24 * 3600;
}

function clamp01(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function qualityScore({ summary, confidence, evidence = [], type }) {
  const safeSummary = String(summary || '');
  const conf = clamp01(confidence, 0.5);
  const evidenceCount = Array.isArray(evidence) ? evidence.length : 0;
  const typeBoost = normalizeType(type) === 'decision' ? 8 : normalizeType(type) === 'news' ? 3 : 5;
  return (
    Math.min(20, Math.floor(safeSummary.length / 30)) +
    Math.min(10, evidenceCount * 2) +
    Math.round(conf * 20) +
    typeBoost
  );
}

function fingerprintFor(type, summary) {
  const seed = `${normalizeType(type)}|${String(summary || '').trim().toLowerCase()}`;
  return crypto.createHash('sha1').update(seed).digest('hex');
}

function inferTypeFromText(text) {
  const t = String(text || '');
  if (/资讯|发布|announce|release|更新|模型|新闻/i.test(t)) return 'news';
  if (/决定|采用|方案|决议/i.test(t)) return 'decision';
  if (/偏好|喜欢|习惯|倾向/i.test(t)) return 'preference';
  return 'procedure';
}

function inferConfidenceFromText(text) {
  const t = String(text || '');
  if (/通过|验证|证据|日志|测试/i.test(t)) return 0.85;
  if (/失败|阻塞|错误|error/i.test(t)) return 0.7;
  return 0.6;
}

async function upsertMemory(roomId, item, options = {}) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const c = redis.getClient();
  const summary = String(item?.summary || '').trim();
  if (!summary) return null;
  const type = normalizeType(item?.type || inferTypeFromText(summary));
  const confidence = clamp01(item?.confidence, inferConfidenceFromText(summary));
  const evidence = Array.isArray(item?.evidence) ? item.evidence.slice(0, 8) : [];
  const tags = Array.isArray(item?.tags) ? item.tags.slice(0, 8) : [];
  const source = String(item?.source || options.source || 'runtime');
  const ttlSec = Math.max(60, Number(options.ttlSec || defaultTtlSecByType(type)));
  const nowTs = Date.now();
  const updatedAt = new Date(nowTs).toISOString();
  const expiresAt = new Date(nowTs + ttlSec * 1000).toISOString();
  const fp = fingerprintFor(type, summary);

  let id = await c.get(memoryFingerprintKey(roomId, fp));
  if (!id) id = crypto.randomUUID();
  const score = qualityScore({ summary, confidence, evidence, type }) + (nowTs / 1e13);

  await c.multi()
    .hset(memoryItemKey(roomId, id), {
      id,
      roomId,
      type,
      summary,
      evidence: JSON.stringify(evidence),
      tags: JSON.stringify(tags),
      source,
      confidence: String(confidence),
      qualityScore: String(score),
      fingerprint: fp,
      updatedAt,
      expiresAt,
    })
    .expire(memoryItemKey(roomId, id), ttlSec + 3600)
    .zadd(memoryIndexKey(roomId), score, id)
    .set(memoryFingerprintKey(roomId, fp), id, 'EX', ttlSec)
    .exec();

  return { id, type, summary, confidence, qualityScore: score, expiresAt };
}

async function upsertMemoryBatch(roomId, items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (const item of list) {
    const saved = await upsertMemory(roomId, item, options);
    if (saved) out.push(saved);
  }
  return out;
}

function parseJsonArray(raw) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function listTopMemory(roomId, options = {}) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const c = redis.getClient();
  const topK = Math.max(1, Number(options.topK || DEFAULT_TOPK));
  const type = options.type ? normalizeType(options.type) : '';
  const nowTs = options.nowTs || Date.now();
  const ids = await c.zrevrangebyscore(memoryIndexKey(roomId), '+inf', '-inf', 'LIMIT', 0, topK * 4);
  const out = [];
  for (const id of ids) {
    const data = await c.hgetall(memoryItemKey(roomId, id));
    if (!data || !data.id) continue;
    const expiresAtMs = Date.parse(String(data.expiresAt || ''));
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowTs) continue;
    if (type && normalizeType(data.type) !== type) continue;
    out.push({
      id: data.id,
      roomId,
      type: normalizeType(data.type),
      summary: String(data.summary || ''),
      evidence: parseJsonArray(data.evidence),
      tags: parseJsonArray(data.tags),
      source: String(data.source || ''),
      confidence: Number(data.confidence || 0),
      qualityScore: Number(data.qualityScore || 0),
      updatedAt: data.updatedAt || null,
      expiresAt: data.expiresAt || null,
    });
  }
  out.sort((a, b) => b.qualityScore - a.qualityScore);
  return out.slice(0, topK);
}

async function pruneExpiredMemory(roomId, options = {}) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const c = redis.getClient();
  const limit = Math.max(1, Number(options.limit || 200));
  const nowTs = options.nowTs || Date.now();
  const ids = await c.zrevrangebyscore(memoryIndexKey(roomId), '+inf', '-inf', 'LIMIT', 0, limit);
  let removed = 0;
  for (const id of ids) {
    const data = await c.hgetall(memoryItemKey(roomId, id));
    if (!data || !data.id) continue;
    const expiresAtMs = Date.parse(String(data.expiresAt || ''));
    if (!Number.isFinite(expiresAtMs) || expiresAtMs > nowTs) continue;
    await c.multi()
      .zrem(memoryIndexKey(roomId), id)
      .del(memoryItemKey(roomId, id))
      .del(memoryFingerprintKey(roomId, String(data.fingerprint || '')))
      .exec();
    removed += 1;
  }
  return removed;
}

module.exports = {
  normalizeType,
  defaultTtlSecByType,
  qualityScore,
  inferTypeFromText,
  inferConfidenceFromText,
  upsertMemory,
  upsertMemoryBatch,
  listTopMemory,
  pruneExpiredMemory,
};
