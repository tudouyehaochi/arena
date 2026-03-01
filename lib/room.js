const DEFAULT_ROOM_ID = process.env.ARENA_ROOM_ID || 'default';
const ROOM_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const AGENT_NAMES = ['清风', '明月'];
const HOST_NAMES = ['镇元子', '玉皇大帝'];

function resolveRoomId(value) {
  const raw = String(value || '').trim();
  const roomId = raw || DEFAULT_ROOM_ID;
  if (!ROOM_ID_RE.test(roomId)) {
    throw new Error('invalid_room_id');
  }
  return roomId;
}

function resolveRoomIdFromUrl(urlStr, fallbackRoomId = DEFAULT_ROOM_ID) {
  const url = new URL(urlStr, 'http://localhost');
  return resolveRoomId(url.searchParams.get('roomId') || fallbackRoomId);
}

function isHost(from) {
  return HOST_NAMES.includes(String(from || ''));
}

module.exports = {
  DEFAULT_ROOM_ID,
  AGENT_NAMES,
  HOST_NAMES,
  resolveRoomId,
  resolveRoomIdFromUrl,
  isHost,
};
