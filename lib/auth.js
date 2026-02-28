const crypto = require('crypto');

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

// --- Token state ---
const invocationId = crypto.randomUUID();
let callbackToken = crypto.randomUUID();
let currentJti = crypto.randomUUID();
let tokenIssuedAt = Date.now();

// One-time jti tracking: jti → expiry timestamp
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

/**
 * Authenticate a request.
 * Reads Bearer token from Authorization header: "Bearer <invocationId>:<token>:<jti>"
 * Falls back to body/query for backward compat (deprecated, no jti = no one-time).
 * Returns { ok, error? }
 */
function authenticate(req, bodyParsed) {
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

  if (id !== invocationId || token !== callbackToken) {
    return { ok: false, error: 'unauthorized' };
  }
  if (isTokenExpired()) {
    return { ok: false, error: 'token_expired' };
  }

  // One-time jti check (if provided)
  if (jti) {
    if (usedJtis.has(jti)) {
      return { ok: false, error: 'jti_reused' };
    }
    if (jti !== currentJti) {
      return { ok: false, error: 'invalid_jti' };
    }
    // Mark as used, store with expiry for cleanup
    usedJtis.set(jti, Date.now() + TOKEN_TTL_MS);
    // Rotate jti for next request
    currentJti = crypto.randomUUID();
  }

  touchToken();
  return { ok: true };
}

/**
 * Validate a WebSocket session token.
 * Returns { ok, identity? } where identity is 'human' or 'agent'.
 */
const wsSessions = new Map(); // sessionToken → { identity, createdAt }

function issueWsSession(identity) {
  const sessionToken = crypto.randomUUID();
  wsSessions.set(sessionToken, { identity, createdAt: Date.now() });
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
