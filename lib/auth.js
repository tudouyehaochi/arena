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
 * Atomically consume a JTI in Redis.
 */
async function consumeJti(jti) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const r = await redis.getClient().set(`arena:jti:used:${jti}`, '1', 'EX', TOKEN_TTL_S, 'NX');
  return r === 'OK';
}
async function isJtiConsumed(jti) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const v = await redis.getClient().get(`arena:jti:used:${jti}`);
  return v !== null;
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
    if (await isJtiConsumed(jti)) {
      return { ok: false, error: 'jti_reused', invocationId: id || null, jti: jti || null };
    }
    if (jti !== currentJti) {
      return { ok: false, error: 'invalid_jti', invocationId: id || null, jti: jti || null };
    }
    if (!(await consumeJti(jti))) {
      return { ok: false, error: 'jti_reused', invocationId: id || null, jti: jti || null };
    }
    // Rotate jti for next request
    currentJti = crypto.randomUUID();
  }

  touchToken();
  return { ok: true, invocationId: id || null, jti: jti || null };
}

// --- WebSocket sessions ---

async function issueWsSession(identity, roomId) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const sessionToken = crypto.randomUUID();
  const createdAt = Date.now();
  const safeRoom = String(roomId || 'default');
  const payload = JSON.stringify({ identity, roomId: safeRoom, createdAt });
  await redis.getClient().set(`arena:ws:${sessionToken}`, payload, 'EX', WS_SESSION_TTL_S);
  return sessionToken;
}

async function validateWsSession(sessionToken, roomId) {
  if (!redis.isReady()) return { ok: false };
  const raw = await redis.getClient().get(`arena:ws:${sessionToken}`);
  if (!raw) return { ok: false };
  let session;
  try { session = JSON.parse(raw); } catch { return { ok: false }; }
  if (roomId && session.roomId !== roomId) return { ok: false };
  // Expire after 24h
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    await redis.getClient().del(`arena:ws:${sessionToken}`);
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
