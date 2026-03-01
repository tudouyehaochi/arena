const auth = require('./auth');
const redisContext = require('./redis-context');
const { jsonResponse, readBody } = require('./route-handlers');
const { DEFAULT_ROOM_ID, resolveRoomIdFromUrl, resolveRoomId } = require('./room');

const VALID_AGENTS = ['清风', '明月'];
const FIELD_MAX_LEN = {
  from: 20,
  currentGoal: 500,
  status: 50,
  lastFile: 200,
  lastAction: 500,
};
const BODY_LIMIT = 10 * 1024;

async function handlePostAgentContext(req, res) {
  const authResult = await auth.authenticate(req, {});
  if (!authResult.ok) {
    const code = authResult.error === 'token_expired' ? 403 : 401;
    jsonResponse(res, code, { error: authResult.error });
    return;
  }
  let body;
  try {
    body = await readBody(req, BODY_LIMIT);
  } catch (err) {
    const code = err.message === 'body_too_large' ? 413 : 400;
    jsonResponse(res, code, { error: err.message });
    return;
  }
  try {
    const parsed = JSON.parse(body);
    const { from, currentGoal, status, lastFile, lastAction } = parsed;
    let roomId;
    try {
      roomId = resolveRoomId(parsed.roomId || DEFAULT_ROOM_ID);
    } catch {
      jsonResponse(res, 400, { error: 'invalid_room_id' });
      return;
    }
    if (!from) { jsonResponse(res, 400, { error: 'missing_from' }); return; }
    if (!VALID_AGENTS.includes(from)) {
      jsonResponse(res, 400, { error: `invalid_from: must be one of ${VALID_AGENTS.join(', ')}` });
      return;
    }
    const fields = { from, currentGoal, status, lastFile, lastAction };
    for (const [key, val] of Object.entries(fields)) {
      if (val && typeof val === 'string' && val.length > FIELD_MAX_LEN[key]) {
        jsonResponse(res, 400, { error: `${key} exceeds max length ${FIELD_MAX_LEN[key]}` });
        return;
      }
    }
    await redisContext.setAgentContext(roomId, from, { currentGoal, status, lastFile, lastAction });
    jsonResponse(res, 200, { status: 'ok' });
  } catch (err) {
    jsonResponse(res, 400, { error: err.message });
  }
}

async function handleGetAgentContext(req, res) {
  const authResult = await auth.authenticate(req, {});
  if (!authResult.ok) {
    const code = authResult.error === 'token_expired' ? 403 : 401;
    jsonResponse(res, code, { error: authResult.error });
    return;
  }
  try {
    const roomId = resolveRoomIdFromUrl(req.url, DEFAULT_ROOM_ID);
    const ctx = await redisContext.getAllAgentContext(roomId);
    jsonResponse(res, 200, ctx);
  } catch (err) {
    const code = err.message === 'invalid_room_id' ? 400 : 500;
    jsonResponse(res, code, { error: err.message });
  }
}

module.exports = { handlePostAgentContext, handleGetAgentContext, VALID_AGENTS };
