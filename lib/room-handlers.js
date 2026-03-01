const store = require('./message-store');
const { jsonResponse, readBody } = require('./route-handlers');
const { resolveRoomId } = require('./room');

const BODY_LIMIT = 10 * 1024;

async function handleGetRooms(_req, res) {
  try {
    const rooms = await store.listRooms();
    jsonResponse(res, 200, { rooms });
  } catch (err) {
    jsonResponse(res, 500, { error: err.message });
  }
}

async function handlePostRooms(req, res, instanceId) {
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
    const title = String(parsed.title || roomId).trim().slice(0, 60) || roomId;
    await store.ensureRoom(roomId, {
      title,
      createdBy: String(parsed.createdBy || '镇元子').trim().slice(0, 30) || '镇元子',
      boundInstanceId: instanceId,
    });
    await store.loadFromLog(roomId);
    jsonResponse(res, 200, { status: 'ok', roomId, title });
  } catch (err) {
    const code = err.message === 'invalid_room_id' ? 400 : 500;
    jsonResponse(res, code, { error: err.message });
  }
}

module.exports = { handleGetRooms, handlePostRooms };
