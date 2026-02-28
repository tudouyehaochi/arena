const auth = require('./auth');
const store = require('./message-store');

const MAX_BODY_BYTES = 10 * 1024; // 10KB body limit
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const recentCallbacks = new Map(); // key: invocationId:idempotencyKey -> { seq, expiresAt }

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
    req.on('data', chunk => {
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
  const payload = { event, ...extra };
  const line = `[callback ${level}] ${JSON.stringify(payload)}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

function validateCallbackScope(parsed, runtime) {
  const providedPort = Number.parseInt(String(parsed.targetPort || ''), 10);
  if (!parsed.instanceId || !parsed.runtimeEnv || !Number.isInteger(providedPort)) {
    return { ok: false, error: 'scope_missing' };
  }
  if (parsed.instanceId !== runtime.instanceId || parsed.runtimeEnv !== runtime.runtimeEnv || providedPort !== runtime.targetPort) {
    return { ok: false, error: 'env_mismatch' };
  }
  return { ok: true };
}

function handlePostMessage(req, res, broadcast, runtime) {
  readBody(req, MAX_BODY_BYTES)
    .then(body => {
      const parsed = JSON.parse(body);
      const { content, from: sender, idempotencyKey } = parsed;
      const authResult = auth.authenticate(req, parsed);
      if (!authResult.ok) {
        const code = authResult.error === 'token_expired' ? 403 : 401;
        auditLog('error', 'auth_failed', {
          reason: authResult.error,
          invocationId: authResult.invocationId,
          jti: authResult.jti,
          targetPort: runtime.targetPort,
        });
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
      if (!idempotencyKey || typeof idempotencyKey !== 'string') {
        jsonResponse(res, 400, { error: 'missing_idempotency_key' });
        return;
      }
      const dedupeKey = `${authResult.invocationId}:${idempotencyKey}`;
      const hit = recentCallbacks.get(dedupeKey);
      if (hit && hit.expiresAt > Date.now()) {
        auditLog('info', 'idempotency_hit', {
          invocationId: authResult.invocationId,
          jti: authResult.jti,
          targetPort: runtime.targetPort,
          seq: hit.seq,
          idempotencyKey,
        });
        jsonResponse(res, 200, { status: 'ok', seq: hit.seq, deduped: true });
        return;
      }
      if (!content || content.trim() === '') {
        jsonResponse(res, 200, { status: 'silent' });
        return;
      }
      const agentName = sender || 'agent';
      auditLog('info', 'accepted', {
        invocationId: authResult.invocationId,
        jti: authResult.jti,
        instanceId: parsed.instanceId,
        runtimeEnv: parsed.runtimeEnv,
        targetPort: runtime.targetPort,
        from: agentName,
      });
      const msg = store.addMessage({ type: 'chat', from: agentName, content });
      recentCallbacks.set(dedupeKey, { seq: msg.seq, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
      broadcast(msg);
      jsonResponse(res, 200, { status: 'ok', seq: msg.seq });
    })
    .catch(err => {
      const code = err.message === 'body_too_large' ? 413 : 400;
      jsonResponse(res, code, { error: err.message });
    });
}

function handleGetSnapshot(req, res, port) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const authResult = auth.authenticate(req, {});
  if (!authResult.ok) {
    const code = authResult.error === 'token_expired' ? 403 : 401;
    jsonResponse(res, code, { error: authResult.error });
    return;
  }
  const since = parseInt(url.searchParams.get('since') || '0', 10);
  const wantSummary = url.searchParams.get('summary') === '1';
  const data = wantSummary ? store.getSummarizedSnapshot(since) : store.getSnapshot(since);
  jsonResponse(res, 200, data);
}

function handleGetWsToken(req, res) {
  // Server-side identity determination: Authorization header → agent, else → human
  const authHeader = req.headers['authorization'] || '';
  let identity = 'human';
  if (authHeader.startsWith('Bearer ')) {
    const authResult = auth.authenticate(req, {});
    if (!authResult.ok) {
      const code = authResult.error === 'token_expired' ? 403 : 401;
      jsonResponse(res, code, { error: authResult.error });
      return;
    }
    identity = 'agent';
  }
  const token = auth.issueWsSession(identity);
  jsonResponse(res, 200, { token });
}

module.exports = { handlePostMessage, handleGetSnapshot, handleGetWsToken, jsonResponse };
