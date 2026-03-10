const longMemory = require('./long-memory');
const redis = require('./redis-client');

const LAST_RUN_PREFIX = 'arena:intel:last-run:';
const ARCHIVE_PREFIX = 'arena:intel:archive:';

function todayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function normalizeDomain(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isAllowedSource(url, whitelistDomains = []) {
  const host = normalizeDomain(url);
  if (!host) return false;
  if (!Array.isArray(whitelistDomains) || whitelistDomains.length === 0) return true;
  return whitelistDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function parseSourceConfig(raw) {
  if (Array.isArray(raw)) return raw.map((v) => String(v || '').trim()).filter(Boolean);
  const text = String(raw || '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v || '').trim()).filter(Boolean);
    } catch {}
  }
  return text.split(',').map((v) => v.trim()).filter(Boolean);
}

function parseWhitelist(raw) {
  return parseSourceConfig(raw).map((v) => String(v || '').toLowerCase());
}

function parseItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && Array.isArray(payload.articles)) return payload.articles;
  return [];
}

function normalizeItem(item, sourceUrl) {
  const title = String(item?.title || item?.headline || item?.name || '').trim();
  const url = String(item?.url || item?.link || item?.href || '').trim();
  const summary = String(item?.summary || item?.description || item?.content || title).trim();
  const publishedAt = String(item?.publishedAt || item?.published_at || item?.date || '').trim();
  if (!title && !summary) return null;
  return {
    title: title || summary.slice(0, 80),
    url,
    summary,
    publishedAt,
    sourceUrl,
  };
}

function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = item.url
      ? `url:${item.url.toLowerCase()}`
      : `title:${item.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function tagItem(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const tags = ['ai-news'];
  if (/openai|anthropic|google|meta|xai|mistral/.test(text)) tags.push('vendor-model');
  if (/release|发布|上线|launch|announce/.test(text)) tags.push('release');
  if (/policy|regulation|法规|合规|law/.test(text)) tags.push('policy');
  if (/agent|workflow|tool|sdk|api/.test(text)) tags.push('tooling');
  return tags;
}

function confidenceScore(item, tags = []) {
  const hasUrl = item.url ? 0.15 : 0;
  const hasTime = item.publishedAt ? 0.1 : 0;
  const isRelease = tags.includes('release') ? 0.15 : 0;
  const hasVendor = tags.includes('vendor-model') ? 0.1 : 0;
  const base = 0.45;
  return Math.min(0.95, Number((base + hasUrl + hasTime + isRelease + hasVendor).toFixed(2)));
}

async function fetchJsonWithRetry(url, { fetchImpl = global.fetch, timeoutMs = 8000, retries = 2 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`fetch_status_${res.status}`);
      const parsed = await res.json();
      clearTimeout(timer);
      return parsed;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }
  throw lastErr || new Error('fetch_failed');
}

async function appendArchive(roomId, report) {
  if (!redis.isReady()) return;
  const c = redis.getClient();
  const key = `${ARCHIVE_PREFIX}${roomId}`;
  await c.rpush(key, JSON.stringify(report));
  const all = await c.lrange(key, 0, -1);
  if (all.length > 200) {
    const removeCount = all.length - 200;
    for (let i = 0; i < removeCount; i++) {
      all.shift();
    }
    await c.del(key);
    if (all.length > 0) await c.rpush(key, ...all);
  }
}

async function runDailyIntelIngest({
  roomId,
  now = Date.now(),
  sources = parseSourceConfig(process.env.ARENA_AI_INTEL_SOURCES),
  whitelistDomains = parseWhitelist(process.env.ARENA_AI_INTEL_WHITELIST),
  fetchImpl = global.fetch,
  force = false,
} = {}) {
  const safeRoomId = String(roomId || 'default');
  const day = todayKey(now);
  if (redis.isReady()) {
    const c = redis.getClient();
    const last = await c.get(`${LAST_RUN_PREFIX}${safeRoomId}`);
    if (!force && last === day) {
      return { skipped: true, reason: 'already_ran_today', day, roomId: safeRoomId };
    }
  }

  const validSources = (Array.isArray(sources) ? sources : []).filter((url) => isAllowedSource(url, whitelistDomains));
  const fetched = [];
  const errors = [];
  for (const source of validSources) {
    try {
      const payload = await fetchJsonWithRetry(source, { fetchImpl, timeoutMs: 8000, retries: 2 });
      const items = parseItems(payload).map((it) => normalizeItem(it, source)).filter(Boolean);
      fetched.push(...items);
    } catch (err) {
      errors.push({ source, error: err.message || 'fetch_failed' });
    }
  }

  const deduped = dedupeItems(fetched);
  const memoryItems = deduped.map((item) => {
    const tags = tagItem(item);
    const confidence = confidenceScore(item, tags);
    return {
      type: 'news',
      summary: item.summary,
      evidence: [item.title, item.url, item.publishedAt].filter(Boolean),
      tags: [...tags, 'daily-intel'],
      source: item.sourceUrl || 'daily-intel',
      confidence,
    };
  });
  const stored = await longMemory.upsertMemoryBatch(safeRoomId, memoryItems, { ttlSec: 3 * 24 * 3600 });
  const report = {
    ts: new Date(now).toISOString(),
    day,
    roomId: safeRoomId,
    sourceCount: validSources.length,
    fetchedCount: fetched.length,
    dedupedCount: deduped.length,
    storedCount: stored.length,
    errors,
  };

  if (redis.isReady()) {
    const c = redis.getClient();
    await c.set(`${LAST_RUN_PREFIX}${safeRoomId}`, day, 'EX', 3 * 24 * 3600);
  }
  await appendArchive(safeRoomId, report);
  return report;
}

module.exports = {
  todayKey,
  parseSourceConfig,
  parseWhitelist,
  isAllowedSource,
  parseItems,
  normalizeItem,
  dedupeItems,
  tagItem,
  confidenceScore,
  fetchJsonWithRetry,
  runDailyIntelIngest,
};
