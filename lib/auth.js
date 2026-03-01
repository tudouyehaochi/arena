const crypto = require('crypto');
const redis = require('./redis-client');

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const TOKEN_TTL_S = 1800;
const WS_SESSION_TTL_S = 86400; // 24h

// --- Token state ---
const invocationId = crypto.randomUUID();
let callbackToken = crypto.randomUUID();
let currentJti = crypto.randomUUID();
let tokenIssuedAt = Date.now();

// One-time jti tracking: jti → expiry timestamp (memory fallback)
const usedJtis = new Map();
const JTI_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// Periodically purge expired jtis to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [jti, expiry] of usedJtis) {
    if (now > expiry) usedJtis.delete(jti);
  }
}, JTI_CLEANUP_INTERVAL_MS).unref();

function getCredentials() {
  return { invocationId, callbackToken, jti: currentJti };
}

function rotateToken() {
  callbackToken = crypto.randomUUID();
  currentJti = crypto.randomUUID();
  tokenIssuedAt = Date.now();
  return getCredentials();
}

function isTokenExpired() {
  return Date.now() - tokenIssuedAt > TOKEN_TTL_MS;
}

// Extend TTL on successful auth (sliding window)
function touchToken() {
  tokenIssuedAt = Date.now();
}

function parseAuth(req, bodyParsed) {
  let id, token, jti;
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    const parts = authHeader.slice(7).split(':');
    id = parts[0];
    token = parts[1];
    jti = parts[2]; // optional for backward compat
  } else {
    id = bodyParsed?.invocationId;
    token = bodyParsed?.callbackToken;
  }
  return { id, token, jti };
}

/**
 * Check if a JTI has been used, checking both Redis and memory.
 * Returns true if the JTI was already consumed (replay detected).
 */
async function isJtiUsed(jti) {
  if (usedJtis.has(jti)) return true;
  return redis.withFallback(
    async () => {
      const val = await redis.getClient().get(`arena:jti:used:${jti}`);
      return val !== null;
    },
    () => false,
  );
}

/**
 * Mark a JTI as used in both memory and Redis (atomic SET+EX).
 */
async function markJtiUsed(jti) {
  usedJtis.set(jti, Date.now() + TOKEN_TTL_MS);
  await redis.withFallback(
    () => redis.getClient().set(`arena:jti:used:${jti}`, '1', 'EX', TOKEN_TTL_S),
    () => {},
  );
}

/**
 * Authenticate a request (async for cross-process JTI check).
 * Returns { ok, error?, invocationId?, jti? }
 */
async function authenticate(req, bodyParsed) {
  const { id, token, jti } = parseAuth(req, bodyParsed);
  if (id !== invocationId || token !== callbackToken) {
    return { ok: false, error: 'unauthorized', invocationId: id || null, jti: jti || null };
  }
  if (isTokenExpired()) {
    return { ok: false, error: 'token_expired', invocationId: id || null, jti: jti || null };
  }

  // One-time jti check (if provided) — cross-process via Redis
  if (jti) {
    if (await isJtiUsed(jti)) {
      return { ok: false, error: 'jti_reused', invocationId: id || null, jti: jti || null };
    }
    if (jti !== currentJti) {
      return { ok: false, error: 'invalid_jti', invocationId: id || null, jti: jti || null };
    }
    await markJtiUsed(jti);
    // Rotate jti for next request
    currentJti = crypto.randomUUID();
  }

  touchToken();
  return { ok: true, invocationId: id || null, jti: jti || null };
}

// --- WebSocket sessions ---

const wsSessions = new Map(); // sessionToken → { identity, roomId, createdAt }

/**
 * Issue a WS session token. Uses atomic SET with EX for Redis
 * to avoid hset+expire split-brain.
 */
function issueWsSession(identity, roomId) {
  const sessionToken = crypto.randomUUID();
  const createdAt = Date.now();
  const safeRoom = String(roomId || 'default');
  wsSessions.set(sessionToken, { identity, roomId: safeRoom, createdAt });
  // Store in Redis with atomic TTL (no separate expire call)
  const payload = JSON.stringify({ identity, roomId: safeRoom, createdAt });
  redis.withFallback(
    () => redis.getClient().set(
      `arena:ws:${sessionToken}`, payload, 'EX', WS_SESSION_TTL_S,
    ),
    () => {},
  );
  return sessionToken;
}

function validateWsSession(sessionToken, roomId) {
  const session = wsSessions.get(sessionToken);
  if (!session) return { ok: false };
  if (roomId && session.roomId !== roomId) return { ok: false };
  // Expire after 24h
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    wsSessions.delete(sessionToken);
    return { ok: false };
  }
  return { ok: true, identity: session.identity, roomId: session.roomId };
}

module.exports = {
  TOKEN_TTL_MS,
  getCredentials,
  rotateToken,
  authenticate,
  issueWsSession,
  validateWsSession,
};
