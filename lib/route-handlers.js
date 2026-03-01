const auth = require('./auth');
const store = require('./message-store');
const redis = require('./redis-client');
const { DEFAULT_ROOM_ID, resolveRoomId, resolveRoomIdFromUrl } = require('./room');

const MAX_BODY_BYTES = 10 * 1024;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const IDEMPOTENCY_TTL_S = 600;
const recentCallbacks = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of recentCallbacks.entries()) {
    if (v.expiresAt <= now) recentCallbacks.delete(k);
  }
}, 60 * 1000).unref();

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > limit && !rejected) {
        rejected = true;
        reject(new Error('body_too_large'));
        req.resume();
        return;
      }
      if (!rejected) body += chunk;
    });
    req.on('end', () => { if (!rejected) resolve(body); });
    req.on('error', reject);
  });
}

function jsonResponse(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function auditLog(level, event, extra) {
  const line = `[callback ${level}] ${JSON.stringify({ event, ...extra })}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

function validateCallbackScope(parsed, runtime) {
  const providedPort = Number.parseInt(String(parsed.targetPort || ''), 10);
  if (!parsed.instanceId || !parsed.runtimeEnv || !Number.isInteger(providedPort)) return { ok: false, error: 'scope_missing' };
  if (parsed.instanceId !== runtime.instanceId || parsed.runtimeEnv !== runtime.runtimeEnv || providedPort !== runtime.targetPort) {
    return { ok: false, error: 'env_mismatch' };
  }
  return { ok: true };
}

function resolveRoomFromParsed(parsed) {
  if (!parsed.roomId) return { ok: false, error: 'missing_room_id' };
  try { return { ok: true, roomId: resolveRoomId(parsed.roomId) }; }
  catch { return { ok: false, error: 'invalid_room_id' }; }
}

async function handlePostMessage(req, res, broadcast, runtime) {
  let body;
  try { body = await readBody(req, MAX_BODY_BYTES); }
  catch (err) { jsonResponse(res, err.message === 'body_too_large' ? 413 : 400, { error: err.message }); return; }
  try {
    const parsed = JSON.parse(body);
    const { content, from: sender, idempotencyKey } = parsed;
    const room = resolveRoomFromParsed(parsed);
    if (!room.ok) { jsonResponse(res, 400, { error: room.error }); return; }
    const roomId = room.roomId;
    const authResult = await auth.authenticate(req, parsed);
    if (!authResult.ok) {
      const code = authResult.error === 'token_expired' ? 403 : 401;
      auditLog('error', 'auth_failed', { reason: authResult.error, invocationId: authResult.invocationId, jti: authResult.jti, targetPort: runtime.targetPort });
      jsonResponse(res, code, { error: authResult.error });
      return;
    }
    const scopeResult = validateCallbackScope(parsed, runtime);
    if (!scopeResult.ok) {
      auditLog('error', 'scope_rejected', {
        reason: scopeResult.error,
        invocationId: authResult.invocationId,
        jti: authResult.jti,
        instanceId: parsed.instanceId,
        runtimeEnv: parsed.runtimeEnv,
        targetPort: parsed.targetPort,
        expectedInstanceId: runtime.instanceId,
        expectedEnv: runtime.runtimeEnv,
        expectedPort: runtime.targetPort,
      });
      jsonResponse(res, 409, { error: scopeResult.error });
      return;
    }
    if (!(await store.roomExists(roomId))) { jsonResponse(res, 404, { error: 'room_not_found' }); return; }
    if (!idempotencyKey || typeof idempotencyKey !== 'string') { jsonResponse(res, 400, { error: 'missing_idempotency_key' }); return; }
    if (idempotencyKey.length > 128) { jsonResponse(res, 400, { error: 'idempotency_key_too_long' }); return; }
    const dedupeKey = `${roomId}:${authResult.invocationId}:${idempotencyKey}`;
    const redisIdemKey = `room:${roomId}:idempotency:${authResult.invocationId}:${idempotencyKey}`;
    if (!redis.isReady()) { jsonResponse(res, 503, { error: 'redis_unavailable' }); return; }
    const val = await redis.getClient().get(redisIdemKey);
    const cachedSeq = val ? parseInt(val, 10) : null;
    if (cachedSeq !== null) {
      auditLog('info', 'idempotency_hit', { invocationId: authResult.invocationId, jti: authResult.jti, targetPort: runtime.targetPort, seq: cachedSeq, idempotencyKey });
      jsonResponse(res, 200, { status: 'ok', seq: cachedSeq, deduped: true });
      return;
    }
    if (!content || content.trim() === '') { jsonResponse(res, 200, { status: 'silent' }); return; }
    const agentName = sender || 'agent';
    auditLog('info', 'accepted', {
      invocationId: authResult.invocationId,
      jti: authResult.jti,
      instanceId: parsed.instanceId,
      runtimeEnv: parsed.runtimeEnv,
      targetPort: runtime.targetPort,
      from: agentName,
    });
    const msg = await store.addMessage({ type: 'chat', from: agentName, content, roomId }, roomId);
    recentCallbacks.set(dedupeKey, { seq: msg.seq, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
    await redis.getClient().set(redisIdemKey, String(msg.seq), 'EX', IDEMPOTENCY_TTL_S);
    broadcast(msg, roomId);
    jsonResponse(res, 200, { status: 'ok', seq: msg.seq });
  } catch (err) {
    if (err.message === 'redis_unavailable') { jsonResponse(res, 503, { error: err.message }); return; }
    jsonResponse(res, 400, { error: err.message });
  }
}

async function handleGetSnapshot(req, res, port) {
  const authResult = await auth.authenticate(req, {});
  if (!authResult.ok) { jsonResponse(res, authResult.error === 'token_expired' ? 403 : 401, { error: authResult.error }); return; }
  const url = new URL(req.url, `http://localhost:${port}`);
  const since = parseInt(url.searchParams.get('since') || '0', 10);
  const wantSummary = url.searchParams.get('summary') === '1';
  let roomId = DEFAULT_ROOM_ID;
  try { roomId = resolveRoomId(url.searchParams.get('roomId') || DEFAULT_ROOM_ID); }
  catch { jsonResponse(res, 400, { error: 'invalid_room_id' }); return; }
  try {
    if (!(await store.roomExists(roomId))) { jsonResponse(res, 404, { error: 'room_not_found' }); return; }
    await store.loadFromLog(roomId);
    const data = wantSummary ? store.getSummarizedSnapshot(roomId, since) : store.getSnapshot(roomId, since);
    jsonResponse(res, 200, data);
  } catch (err) {
    if (err.message === 'redis_unavailable') { jsonResponse(res, 503, { error: err.message }); return; }
    jsonResponse(res, 500, { error: err.message });
  }
}

async function handleGetWsToken(req, res) {
  const authHeader = req.headers.authorization || '';
  let identity = 'human';
  if (authHeader.startsWith('Bearer ')) {
    const authResult = await auth.authenticate(req, {});
    if (!authResult.ok) { jsonResponse(res, authResult.error === 'token_expired' ? 403 : 401, { error: authResult.error }); return; }
    identity = 'agent';
  }
  let roomId;
  try { roomId = resolveRoomIdFromUrl(req.url, DEFAULT_ROOM_ID); }
  catch { jsonResponse(res, 400, { error: 'invalid_room_id' }); return; }
  try {
    const token = await auth.issueWsSession(identity, roomId);
    jsonResponse(res, 200, { token, roomId });
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 500;
    jsonResponse(res, code, { error: err.message });
  }
}

module.exports = { handlePostMessage, handleGetSnapshot, handleGetWsToken, jsonResponse, readBody };
