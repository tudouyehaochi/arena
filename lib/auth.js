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
 * Authenticate a request.
 * Returns { ok, error?, invocationId?, jti? }
 */
function authenticate(req, bodyParsed) {
  const { id, token, jti } = parseAuth(req, bodyParsed);
  if (id !== invocationId || token !== callbackToken) {
    return { ok: false, error: 'unauthorized', invocationId: id || null, jti: jti || null };
  }
  if (isTokenExpired()) {
    return { ok: false, error: 'token_expired', invocationId: id || null, jti: jti || null };
  }

  // One-time jti check (if provided)
  if (jti) {
    if (usedJtis.has(jti)) {
      return { ok: false, error: 'jti_reused', invocationId: id || null, jti: jti || null };
    }
    if (jti !== currentJti) {
      return { ok: false, error: 'invalid_jti', invocationId: id || null, jti: jti || null };
    }
    // Mark as used in memory
    usedJtis.set(jti, Date.now() + TOKEN_TTL_MS);
    // Mark in Redis (TTL auto-expires, no setInterval needed)
    redis.withFallback(
      () => redis.getClient().set(`arena:jti:used:${jti}`, '1', 'EX', TOKEN_TTL_S),
      () => {},
    );
    // Rotate jti for next request
    currentJti = crypto.randomUUID();
  }

  touchToken();
  return { ok: true, invocationId: id || null, jti: jti || null };
}

/**
 * Validate a WebSocket session token.
 * Returns { ok, identity? } where identity is 'human' or 'agent'.
 */
const wsSessions = new Map(); // sessionToken → { identity, createdAt }

function issueWsSession(identity) {
  const sessionToken = crypto.randomUUID();
  const createdAt = Date.now();
  wsSessions.set(sessionToken, { identity, createdAt });
  // Also store in Redis
  redis.withFallback(
    () => redis.getClient().hset(`arena:ws:${sessionToken}`, { identity, createdAt: String(createdAt) }),
    () => {},
  ).then(() => {
    redis.withFallback(
      () => redis.getClient().expire(`arena:ws:${sessionToken}`, WS_SESSION_TTL_S),
      () => {},
    );
  });
  return sessionToken;
}

function validateWsSession(sessionToken) {
  const session = wsSessions.get(sessionToken);
  if (!session) return { ok: false };
  // Expire after 24h
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    wsSessions.delete(sessionToken);
    return { ok: false };
  }
  return { ok: true, identity: session.identity };
}

module.exports = {
  TOKEN_TTL_MS,
  getCredentials,
  rotateToken,
  authenticate,
  issueWsSession,
  validateWsSession,
};
