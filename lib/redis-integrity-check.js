const redis = require('./redis-client');
const { AGENT_NAMES } = require('./room');

function parseIntSafe(v, fallback = 0) {
  const n = Number.parseInt(String(v || ''), 10);
  return Number.isInteger(n) ? n : fallback;
}

function parseMsg(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

async function inspectRoom(c, roomId) {
  const issues = [];
  const meta = await c.hgetall(`room:${roomId}:meta`);
  if (!meta || Object.keys(meta).length === 0) {
    issues.push({ level: 'CRITICAL', code: 'missing_meta', roomId });
    return { roomId, issues, seq: 0, msgCount: 0 };
  }
  const seq = parseIntSafe(await c.get(`room:${roomId}:seq`), 0);
  const agentTurns = parseIntSafe(await c.get(`room:${roomId}:agentTurns`), 0);
  const rawMsgs = await c.zrangebyscore(`room:${roomId}:messages`, '-inf', '+inf');
  let maxSeq = 0;
  let trailingAgentTurns = 0;
  let lastHumanSeq = null;
  const msgs = [];
  for (const raw of rawMsgs) {
    const m = parseMsg(raw);
    if (!m) {
      issues.push({ level: 'CRITICAL', code: 'invalid_message_json', roomId });
      continue;
    }
    msgs.push(m);
    if (Number(m.seq) > maxSeq) maxSeq = Number(m.seq);
    if (String(m.roomId || '') !== roomId) {
      issues.push({ level: 'CRITICAL', code: 'room_id_mismatch', roomId, seq: m.seq });
    }
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    const from = String(msgs[i].from || '');
    if (!AGENT_NAMES.includes(from)) break;
    trailingAgentTurns++;
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    const from = String(msgs[i].from || '');
    if (AGENT_NAMES.includes(from)) continue;
    lastHumanSeq = Number(msgs[i].seq);
    break;
  }
  if (maxSeq > seq) issues.push({ level: 'CRITICAL', code: 'seq_less_than_max_message', roomId, seq, maxSeq });
  if (Math.abs(agentTurns - trailingAgentTurns) > 0) {
    issues.push({ level: 'WARN', code: 'agent_turns_mismatch', roomId, agentTurns, trailingAgentTurns });
  }
  const storedLastHuman = await c.get(`room:${roomId}:lastHumanSeq`);
  const storedVal = storedLastHuman ? Number(storedLastHuman) : null;
  if (storedVal !== lastHumanSeq) {
    issues.push({ level: 'WARN', code: 'last_human_seq_mismatch', roomId, stored: storedVal, computed: lastHumanSeq });
  }
  return { roomId, issues, seq, msgCount: rawMsgs.length };
}

async function runIntegrityCheck(ctx = {}) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const c = redis.getClient();
  const roomIds = await c.smembers('rooms:index');
  const issues = [];
  if (!roomIds.includes('default')) issues.push({ level: 'CRITICAL', code: 'missing_default_room' });
  let totalMessages = 0;
  for (const roomId of roomIds) {
    const result = await inspectRoom(c, roomId);
    totalMessages += result.msgCount;
    issues.push(...result.issues);
  }
  return {
    checkedAt: new Date().toISOString(),
    context: ctx,
    roomCount: roomIds.length,
    totalMessages,
    issues,
    ok: !issues.some((i) => i.level === 'CRITICAL'),
  };
}

module.exports = { runIntegrityCheck };
