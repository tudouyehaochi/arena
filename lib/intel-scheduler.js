const redis = require('./redis-client');
const aiIntel = require('./ai-intel-pipeline');
const alerts = require('./alert-center');

const INTEL_SCHEDULE_CONFIG_KEY = 'arena:intel:schedule:config:v1';
const INTEL_SCHEDULE_STATUS_KEY = 'arena:intel:schedule:status:v1';

function defaultConfig() {
  return {
    enabled: false,
    cron: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    roomId: 'default',
    sources: [],
    whitelistDomains: [],
    maxItems: 50,
    dedupeWindow: '1d',
    updatedAt: new Date().toISOString(),
  };
}

function parseCronHM(expr) {
  const text = String(expr || '').trim();
  const parts = text.split(/\s+/);
  if (parts.length < 2) return { minute: 0, hour: 9 };
  const minute = Number.parseInt(parts[0], 10);
  const hour = Number.parseInt(parts[1], 10);
  return {
    minute: Number.isFinite(minute) && minute >= 0 && minute <= 59 ? minute : 0,
    hour: Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : 9,
  };
}

function getTimeParts(now, timezone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function normalizeConfig(input = {}) {
  const cfg = defaultConfig();
  const next = {
    ...cfg,
    ...input,
  };
  next.enabled = Boolean(next.enabled);
  next.cron = String(next.cron || cfg.cron).trim();
  next.timezone = String(next.timezone || cfg.timezone).trim();
  next.roomId = String(next.roomId || cfg.roomId).trim() || cfg.roomId;
  next.sources = Array.isArray(next.sources) ? next.sources.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 30) : [];
  next.whitelistDomains = Array.isArray(next.whitelistDomains)
    ? next.whitelistDomains.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean).slice(0, 100)
    : [];
  next.maxItems = Math.max(1, Math.min(200, Number.parseInt(String(next.maxItems || cfg.maxItems), 10) || cfg.maxItems));
  next.dedupeWindow = String(next.dedupeWindow || cfg.dedupeWindow).trim();
  next.updatedAt = new Date().toISOString();
  return next;
}

async function getConfig() {
  if (!redis.isReady()) return defaultConfig();
  const raw = await redis.getClient().get(INTEL_SCHEDULE_CONFIG_KEY);
  if (!raw) return defaultConfig();
  try { return normalizeConfig(JSON.parse(raw)); } catch { return defaultConfig(); }
}

async function setConfig(input) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const cfg = normalizeConfig(input || {});
  await redis.getClient().set(INTEL_SCHEDULE_CONFIG_KEY, JSON.stringify(cfg));
  return cfg;
}

async function getStatus() {
  if (!redis.isReady()) return null;
  const raw = await redis.getClient().get(INTEL_SCHEDULE_STATUS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function setStatus(status) {
  if (!redis.isReady()) return;
  await redis.getClient().set(INTEL_SCHEDULE_STATUS_KEY, JSON.stringify({
    ...(status || {}),
    updatedAt: new Date().toISOString(),
  }));
}

function shouldRunNow(config, status = null, now = new Date()) {
  if (!config || !config.enabled) return false;
  const { hour, minute, dayKey } = getTimeParts(now, config.timezone);
  const target = parseCronHM(config.cron);
  if (hour !== target.hour || minute !== target.minute) return false;
  const lastDay = String(status?.lastDayKey || '');
  return lastDay !== dayKey;
}

async function runOnce(config, now = Date.now(), force = false) {
  const cfg = normalizeConfig(config || defaultConfig());
  const startedAt = new Date(now).toISOString();
  try {
    const report = await aiIntel.runDailyIntelIngest({
      roomId: cfg.roomId,
      now,
      sources: cfg.sources,
      whitelistDomains: cfg.whitelistDomains,
      force,
    });
    const parts = getTimeParts(new Date(now), cfg.timezone);
    const status = {
      lastRunAt: startedAt,
      lastStatus: 'ok',
      lastError: '',
      fetchedCount: Number(report?.fetchedCount || 0),
      storedCount: Number(report?.storedCount || 0),
      sourceCount: Number(report?.sourceCount || 0),
      lastDayKey: parts.dayKey,
    };
    await setStatus(status);
    return { ok: true, report, status };
  } catch (err) {
    const status = {
      lastRunAt: startedAt,
      lastStatus: 'failed',
      lastError: String(err?.message || 'intel_schedule_failed').slice(0, 800),
      fetchedCount: 0,
      storedCount: 0,
      sourceCount: cfg.sources.length,
    };
    await setStatus(status);
    await alerts.pushAlert('CRITICAL', 'intel_schedule_failed', {
      roomId: cfg.roomId,
      error: status.lastError,
    }).catch(() => {});
    return { ok: false, error: status.lastError, status };
  }
}

module.exports = {
  INTEL_SCHEDULE_CONFIG_KEY,
  INTEL_SCHEDULE_STATUS_KEY,
  defaultConfig,
  normalizeConfig,
  parseCronHM,
  getTimeParts,
  shouldRunNow,
  getConfig,
  setConfig,
  getStatus,
  runOnce,
};
