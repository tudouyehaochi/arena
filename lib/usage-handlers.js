const auth = require('./auth');
const store = require('./message-store');
const { jsonResponse, readBody } = require('./route-handlers');
const { DEFAULT_ROOM_ID, resolveRoomId } = require('./room');

async function handlePostUsage(req, res) {
  const authResult = await auth.authenticate(req, {});
  if (!authResult.ok) {
    jsonResponse(res, authResult.error === 'token_expired' ? 403 : 401, { error: authResult.error });
    return;
  }
  let body;
  try {
    body = await readBody(req, 8 * 1024);
  } catch (err) {
    jsonResponse(res, err.message === 'body_too_large' ? 413 : 400, { error: err.message });
    return;
  }
  try {
    const parsed = JSON.parse(body || '{}');
    const roomId = resolveRoomId(parsed.roomId || DEFAULT_ROOM_ID);
    const agent = String(parsed.agent || '').trim();
    if (!agent) {
      jsonResponse(res, 400, { error: 'missing_agent' });
      return;
    }
    const result = await store.attachAgentUsage(roomId, agent, parsed.usage || {});
    jsonResponse(res, 200, { status: 'ok', ...result });
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 400;
    jsonResponse(res, code, { error: err.message });
  }
}

module.exports = { handlePostUsage };
