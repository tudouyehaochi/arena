const fs = require('fs');
const path = require('path');
const { normalizeMessage, clipText } = require('./message-util');
const redis = require('./redis-client');
const redisMsg = require('./redis-messages');
const { DEFAULT_ROOM_ID, resolveRoomId } = require('./room');
const { pruneRoomFromLog } = require('./room-log');

let LOG_FILE = path.join(__dirname, '..', 'chatroom.log');
const DEFAULT_USER_NAME = process.env.ARENA_DEFAULT_USER || '镇元子';
const AGENT_NAMES = ['清风', '明月'];
const stateByRoom = new Map();
const roomMetaById = new Map([[DEFAULT_ROOM_ID, { roomId: DEFAULT_ROOM_ID, title: DEFAULT_ROOM_ID }]]);

function ensureState(roomId) {
  const id = resolveRoomId(roomId);
  if (!stateByRoom.has(id)) stateByRoom.set(id, { messages: [], messageSeq: 0, consecutiveAgentTurns: 0 });
  return stateByRoom.get(id);
}
function isAgent(from) { return AGENT_NAMES.includes(from); }
function setRoomMeta(roomId, meta = {}) {
  const id = resolveRoomId(roomId);
  const prev = roomMetaById.get(id) || { roomId: id, title: id };
  roomMetaById.set(id, { ...prev, ...meta, roomId: id, title: String(meta.title || prev.title || id) });
}
function parseRoomLogLine(line) {
  try {
    const msg = JSON.parse(line);
    return { ...msg, roomId: resolveRoomId(msg.roomId || DEFAULT_ROOM_ID) };
  } catch { return null; }
}

async function loadFromLog(roomId = DEFAULT_ROOM_ID) {
  const id = resolveRoomId(roomId);
  setRoomMeta(id, { title: id });
  const state = ensureState(id);
  if (state.messages.length > 0) return;
  const seeded = await redis.withFallback(async () => {
    const count = await redisMsg.getMessageCount(id);
    if (count <= 0) return false;
    const meta = await redisMsg.getMeta(id);
    state.messages.push(...await redisMsg.getRecentMessages(id, 10000));
    state.messageSeq = meta.seq;
    state.consecutiveAgentTurns = meta.agentTurns;
    return true;
  }, () => false);
  if (seeded) return;
  try {
    for (const line of fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean)) {
      const parsed = parseRoomLogLine(line);
      if (!parsed || parsed.roomId !== id) continue;
      state.messageSeq++; parsed.seq = state.messageSeq; state.messages.push(parsed);
    }
  } catch {}
  state.consecutiveAgentTurns = 0;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (!isAgent(state.messages[i].from)) break;
    state.consecutiveAgentTurns++;
  }
  await redis.withFallback(async () => {
    await redisMsg.ensureRoom(id, { title: id, createdBy: 'system', boundInstanceId: process.env.ARENA_INSTANCE_ID || '' });
    if (state.messages.length > 0) await redisMsg.seedFromArray(id, state.messages);
  }, () => {});
}

function appendLog(msg) {
  if (!LOG_FILE) return;
  const { seq, ...logMsg } = msg;
  fs.appendFileSync(LOG_FILE, `${JSON.stringify(logMsg)}\n`);
}

async function addMessage(msg, roomId = DEFAULT_ROOM_ID) {
  const id = resolveRoomId(roomId || msg.roomId);
  setRoomMeta(id, { title: id });
  const state = ensureState(id);
  const next = {
    ...msg,
    roomId: id,
    from: msg.from || DEFAULT_USER_NAME,
    content: String(msg.content ?? msg.text ?? '').trim(),
    timestamp: msg.timestamp || Date.now(),
    type: msg.type || 'chat',
  };
  if (!next.content && next.type === 'chat') next.content = '(empty)';
  const rawSeq = await redis.withFallback(() => redisMsg.incrSeq(id), () => null);
  const redisSeq = rawSeq !== null ? (typeof rawSeq === 'string' ? parseInt(rawSeq, 10) : rawSeq) : null;
  state.messageSeq++;
  if (redisSeq !== null && redisSeq > state.messageSeq) state.messageSeq = redisSeq;
  next.seq = state.messageSeq;
  state.messages.push(next);
  appendLog(next);
  redis.withFallback(async () => {
    await redisMsg.ensureRoom(id, { title: id, createdBy: next.from, boundInstanceId: process.env.ARENA_INSTANCE_ID || '' });
    await redisMsg.addMsg(id, next);
  }, () => {});
  state.consecutiveAgentTurns = isAgent(next.from) ? state.consecutiveAgentTurns + 1 : 0;
  return next;
}

function getMessages(roomId = DEFAULT_ROOM_ID) { return ensureState(roomId).messages; }
function getRecentMessages(roomId = DEFAULT_ROOM_ID, count = 50) { return ensureState(roomId).messages.slice(-count); }
function normalizeRoomAndCursor(roomOrCursor, maybeCursor) {
  if (typeof roomOrCursor === 'number') return { roomId: DEFAULT_ROOM_ID, cursor: roomOrCursor };
  return { roomId: roomOrCursor || DEFAULT_ROOM_ID, cursor: maybeCursor };
}
function getMessagesSince(roomOrCursor = DEFAULT_ROOM_ID, maybeCursor) {
  const { roomId, cursor } = normalizeRoomAndCursor(roomOrCursor, maybeCursor);
  const list = ensureState(roomId).messages;
  if (!cursor || cursor <= 0) return list.slice(-50);
  return list.filter((m) => m.seq > cursor);
}

function getSnapshot(roomOrCursor = DEFAULT_ROOM_ID, maybeCursor) {
  const { roomId, cursor } = normalizeRoomAndCursor(roomOrCursor, maybeCursor);
  const id = resolveRoomId(roomId);
  const state = ensureState(id);
  const newMessages = cursor ? getMessagesSince(id, cursor) : getRecentMessages(id, 50);
  const lastMsg = state.messages.length > 0 ? state.messages[state.messages.length - 1] : null;
  let lastHumanMsgSeq = null;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (!isAgent(state.messages[i].from)) { lastHumanMsgSeq = state.messages[i].seq; break; }
  }
  return {
    roomId: id,
    cursor: state.messageSeq,
    consecutiveAgentTurns: state.consecutiveAgentTurns,
    lastHumanMsgSeq,
    lastMsgSeq: lastMsg ? lastMsg.seq : null,
    totalMessages: state.messages.length,
    messages: newMessages,
  };
}

function getAgentTurns(roomId = DEFAULT_ROOM_ID) { return ensureState(roomId).consecutiveAgentTurns; }
function getSummarizedSnapshot(roomOrCursor = DEFAULT_ROOM_ID, maybeCursor) {
  const { roomId, cursor } = normalizeRoomAndCursor(roomOrCursor, maybeCursor);
  const snapshot = getSnapshot(roomId, cursor);
  const normalized = (snapshot.messages || []).map(normalizeMessage);
  const recent = normalized.slice(-4).map((m) => ({ seq: m.seq, from: m.from, content: clipText(m.content, 180), roomId: snapshot.roomId }));
  const highlights = normalized.filter((m) => /P1|P2|P3|error|失败|通过|修复|todo|下一步/i.test(m.content)).slice(-5).map((m) => `[${m.from}] ${m.content.slice(0, 120)}`);
  return { roomId: snapshot.roomId, cursor: snapshot.cursor, consecutiveAgentTurns: snapshot.consecutiveAgentTurns, totalMessages: snapshot.totalMessages, highlights, recent, messages: recent };
}

function ensureRoom(roomId, meta = {}) {
  const id = resolveRoomId(roomId);
  ensureState(id);
  setRoomMeta(id, { title: String(meta.title || id), createdBy: meta.createdBy || null, boundInstanceId: meta.boundInstanceId || null });
  return redis.withFallback(() => redisMsg.ensureRoom(id, meta), () => {});
}
async function listRooms() {
  const byId = new Map();
  for (const [id, meta] of roomMetaById.entries()) byId.set(id, meta);
  const redisRooms = await redis.withFallback(() => redisMsg.listRooms(), () => []);
  for (const r of redisRooms) byId.set(r.roomId, { ...byId.get(r.roomId), ...r });
  if (!byId.has(DEFAULT_ROOM_ID)) byId.set(DEFAULT_ROOM_ID, { roomId: DEFAULT_ROOM_ID, title: DEFAULT_ROOM_ID });
  return [...byId.values()].sort((a, b) => String(a.roomId).localeCompare(String(b.roomId)));
}
async function deleteRoom(roomId) {
  const id = resolveRoomId(roomId);
  if (id === DEFAULT_ROOM_ID) throw new Error('cannot_delete_default_room');
  if (!(await listRooms()).some((r) => r.roomId === id)) throw new Error('room_not_found');
  stateByRoom.delete(id);
  roomMetaById.delete(id);
  pruneRoomFromLog(LOG_FILE, id);
  await redis.withFallback(() => redisMsg.deleteRoom(id), () => {});
}
function _setLogFile(p) { LOG_FILE = p; }
function attachAgentUsage(roomId = DEFAULT_ROOM_ID, agent, usage) {
  const state = ensureState(roomId);
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.from !== agent || m.type !== 'chat') continue;
    if (!m.usage) {
      m.usage = {
        inputTokens: Number(usage?.inputTokens || 0),
        outputTokens: Number(usage?.outputTokens || 0),
        cachedInputTokens: Number(usage?.cachedInputTokens || 0),
      };
      return { ok: true, seq: m.seq };
    }
    break;
  }
  return { ok: false };
}

module.exports = {
  loadFromLog,
  addMessage,
  getMessages,
  getRecentMessages,
  getMessagesSince,
  getSnapshot,
  getAgentTurns,
  getSummarizedSnapshot,
  ensureRoom,
  listRooms,
  deleteRoom,
  attachAgentUsage,
  isAgent,
  _setLogFile,
};
