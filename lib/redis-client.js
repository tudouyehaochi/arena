const Redis = require('ioredis');

const REDIS_URL = process.env.ARENA_REDIS_URL || 'redis://localhost:6379';
const COMMAND_TIMEOUT = 2000;

let client = null;
let ready = false;

function getClient() {
  if (client) return client;
  client = new Redis(REDIS_URL, {
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

function isReady() {
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

module.exports = { getClient, isReady, withFallback, disconnect, startConnect };
