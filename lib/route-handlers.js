const auth = require('./auth');
const store = require('./message-store');

const MAX_BODY_BYTES = 10 * 1024; // 10KB body limit

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

function handlePostMessage(req, res, broadcast) {
  readBody(req, MAX_BODY_BYTES)
    .then(body => {
      const parsed = JSON.parse(body);
      const { content, from: sender } = parsed;
      const authResult = auth.authenticate(req, parsed);
      if (!authResult.ok) {
        const code = authResult.error === 'token_expired' ? 403 : 401;
        jsonResponse(res, code, { error: authResult.error });
        return;
      }
      if (!content || content.trim() === '') {
        jsonResponse(res, 200, { status: 'silent' });
        return;
      }
      const agentName = sender || 'agent';
      console.log(`[agent callback] [${agentName}] ${content}`);
      const msg = store.addMessage({ type: 'chat', from: agentName, content });
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
  jsonResponse(res, 200, store.getSnapshot(since));
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
