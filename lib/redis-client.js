const Redis = require('ioredis');
const MockRedis = require('./mock-redis');

const COMMAND_TIMEOUT = 2000;

let client = null;
let ready = false;
let resolvedUrl = '';

function normalizeEnvironment(value) {
  return String(value || '').trim().toLowerCase() === 'prod' ? 'prod' : 'dev';
}

function getRedisUrl() {
  const env = normalizeEnvironment(process.env.ARENA_ENVIRONMENT);
  const explicit = String(process.env.ARENA_REDIS_URL || '').trim();
  const devUrl = String(process.env.ARENA_REDIS_URL_DEV || '').trim();
  const prodUrl = String(process.env.ARENA_REDIS_URL_PROD || '').trim();
  if (explicit) return explicit;
  if (env === 'prod') return prodUrl || 'redis://localhost:6380';
  return devUrl || 'redis://localhost:6379';
}

function ensureEnvironmentIsolation(url) {
  const env = normalizeEnvironment(process.env.ARENA_ENVIRONMENT);
  const devUrl = String(process.env.ARENA_REDIS_URL_DEV || '').trim();
  const prodUrl = String(process.env.ARENA_REDIS_URL_PROD || '').trim();
  if (devUrl && prodUrl && devUrl === prodUrl) {
    throw new Error('ARENA_REDIS_URL_DEV and ARENA_REDIS_URL_PROD must be different instances');
  }
  if (env === 'prod' && devUrl && url === devUrl) {
    throw new Error('prod runtime cannot use dev redis instance');
  }
  if (env === 'dev' && prodUrl && url === prodUrl) {
    throw new Error('dev runtime cannot use prod redis instance');
  }
}

function getClient() {
  if (client) return client;
  if (String(process.env.ARENA_USE_MEMORY_REDIS || '') === '1') {
    client = new MockRedis();
    ready = true;
    resolvedUrl = 'memory://redis';
    return client;
  }
  const url = getRedisUrl();
  ensureEnvironmentIsolation(url);
  resolvedUrl = url;
  client = new Redis(url, {
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 10) return null; // stop retrying after 10 attempts
      return Math.min(times * 500, 5000);
    },
    commandTimeout: COMMAND_TIMEOUT,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  client.on('ready', () => { ready = true; });
  client.on('error', () => { ready = false; });
  client.on('close', () => { ready = false; });
  return client;
}

/**
 * Start Redis connection. Call this explicitly at app startup.
 * Not called automatically to avoid keeping test processes alive.
 */
function startConnect() {
  const c = getClient();
  c.connect().catch(() => {});
}

async function waitUntilReady(timeoutMs = 5000) {
  startConnect();
  const start = Date.now();
  while (!isReady()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('redis_unavailable');
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function isReady() {
  if (String(process.env.ARENA_USE_MEMORY_REDIS || '') === '1') {
    if (!client) getClient();
    return true;
  }
  return ready && client !== null;
}

/**
 * Try redisFn; if Redis unavailable or errors, run fallbackFn.
 * Caller must have called startConnect() first (at app boot).
 */
async function withFallback(redisFn, fallbackFn) {
  if (!isReady()) return fallbackFn();
  try {
    return await redisFn();
  } catch {
    return fallbackFn();
  }
}

async function disconnect() {
  if (client) {
    try { await client.quit(); } catch { client.disconnect(); }
    client = null;
    ready = false;
  }
}

function getResolvedUrl() {
  return resolvedUrl || getRedisUrl();
}

module.exports = { getClient, isReady, withFallback, disconnect, startConnect, waitUntilReady, getResolvedUrl };
