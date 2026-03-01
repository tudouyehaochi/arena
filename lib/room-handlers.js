const auth = require('./auth');
const store = require('./message-store');
const { jsonResponse, readBody } = require('./route-handlers');
const { resolveRoomId } = require('./room');

const BODY_LIMIT = 10 * 1024;

function fuzzyMatch(haystack, needle) {
  const h = String(haystack || '').toLowerCase();
  const n = String(needle || '').toLowerCase();
  if (!n) return true;
  if (h.includes(n)) return true;
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i++;
    if (i === n.length) return true;
  }
  return false;
}

async function handleGetRooms(req, res) {
  const authResult = await auth.authenticate(req, {});
  if (!authResult.ok) {
    jsonResponse(res, authResult.error === 'token_expired' ? 403 : 401, { error: authResult.error });
    return;
  }
  try {
    const url = new URL(req.url || '/api/rooms', 'http://localhost');
    const q = String(url.searchParams.get('q') || '').trim();
    const rooms = (await store.listRooms()).filter((r) => fuzzyMatch(r.roomId, q));
    jsonResponse(res, 200, { rooms });
  } catch (err) {
    const code = err.message === 'redis_unavailable' ? 503 : 500;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handlePostRooms(req, res, instanceId) {
  const authResult = await auth.authenticate(req, {});
  if (!authResult.ok) {
    jsonResponse(res, authResult.error === 'token_expired' ? 403 : 401, { error: authResult.error });
    return;
  }
  let body;
  try {
    body = await readBody(req, BODY_LIMIT);
  } catch (err) {
    jsonResponse(res, err.message === 'body_too_large' ? 413 : 400, { error: err.message });
    return;
  }
  try {
    const parsed = body ? JSON.parse(body) : {};
    const roomId = resolveRoomId(parsed.roomId || '');
    const exists = (await store.listRooms()).some((r) => r.roomId === roomId);
    if (exists) { jsonResponse(res, 409, { error: 'room_exists' }); return; }
    const title = String(parsed.title || roomId).trim().slice(0, 60) || roomId;
    await store.ensureRoom(roomId, {
      title,
      createdBy: String(parsed.createdBy || '镇元子').trim().slice(0, 30) || '镇元子',
      boundInstanceId: instanceId,
    });
    await store.loadFromLog(roomId);
    jsonResponse(res, 200, { status: 'ok', roomId, title });
  } catch (err) {
    const code = err.message === 'invalid_room_id' ? 400 : err.message === 'room_exists' ? 409 : err.message === 'redis_unavailable' ? 503 : 500;
    jsonResponse(res, code, { error: err.message });
  }
}

async function handleDeleteRoom(req, res) {
  const authResult = await auth.authenticate(req, {});
  if (!authResult.ok) {
    jsonResponse(res, authResult.error === 'token_expired' ? 403 : 401, { error: authResult.error });
    return;
  }
  try {
    const url = new URL(req.url || '/api/rooms', 'http://localhost');
    const roomId = resolveRoomId(url.searchParams.get('roomId') || '');
    await store.deleteRoom(roomId);
    jsonResponse(res, 200, { status: 'ok', roomId });
  } catch (err) {
    const code = ['cannot_delete_default_room', 'invalid_room_id', 'room_not_found'].includes(err.message) ? 400 : err.message === 'redis_unavailable' ? 503 : 500;
    jsonResponse(res, code, { error: err.message });
  }
}

module.exports = { handleGetRooms, handlePostRooms, handleDeleteRoom };
