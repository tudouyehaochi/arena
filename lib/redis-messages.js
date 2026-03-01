const { getClient } = require('./redis-client');

const AGENT_NAMES = ['清风', '明月'];

function key(roomId, suffix) {
  return `room:${roomId}:${suffix}`;
}

async function incrSeq(roomId) {
  return getClient().incr(key(roomId, 'seq'));
}

async function addMsg(roomId, msg) {
  const pipeline = getClient().multi();
  pipeline.zadd(key(roomId, 'messages'), msg.seq, JSON.stringify(msg));
  if (AGENT_NAMES.includes(msg.from)) {
    pipeline.incr(key(roomId, 'agentTurns'));
  } else {
    pipeline.set(key(roomId, 'agentTurns'), '0');
    pipeline.set(key(roomId, 'lastHumanSeq'), String(msg.seq));
  }
  pipeline.hset(key(roomId, 'meta'), 'lastActiveAt', new Date().toISOString());
  await pipeline.exec();
}

async function getMessagesSince(roomId, cursor) {
  const raw = await getClient().zrangebyscore(key(roomId, 'messages'), `(${cursor}`, '+inf');
  return raw.map((s) => JSON.parse(s));
}

async function getRecentMessages(roomId, count = 50) {
  const raw = await getClient().zrevrangebyscore(
    key(roomId, 'messages'),
    '+inf',
    '-inf',
    'LIMIT',
    0,
    count,
  );
  return raw.reverse().map((s) => JSON.parse(s));
}

async function getMeta(roomId) {
  const [seq, agentTurns, lastHumanSeq] = await getClient().mget(
    key(roomId, 'seq'),
    key(roomId, 'agentTurns'),
    key(roomId, 'lastHumanSeq'),
  );
  return {
    seq: seq ? parseInt(seq, 10) : 0,
    agentTurns: agentTurns ? parseInt(agentTurns, 10) : 0,
    lastHumanSeq: lastHumanSeq ? parseInt(lastHumanSeq, 10) : null,
  };
}

async function seedFromArray(roomId, msgs) {
  if (msgs.length === 0) return;
  const client = getClient();
  const pipeline = client.pipeline();
  let maxSeq = 0;
  let agentTurns = 0;
  let lastHumanSeq = null;

  for (let i = msgs.length - 1; i >= 0; i--) {
    if (!AGENT_NAMES.includes(msgs[i].from)) {
      agentTurns = msgs.length - 1 - i;
      break;
    }
    if (i === 0) agentTurns = msgs.length;
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (!AGENT_NAMES.includes(msgs[i].from)) {
      lastHumanSeq = msgs[i].seq;
      break;
    }
  }

  for (const msg of msgs) {
    pipeline.zadd(key(roomId, 'messages'), msg.seq, JSON.stringify(msg));
    if (msg.seq > maxSeq) maxSeq = msg.seq;
  }
  pipeline.set(key(roomId, 'seq'), String(maxSeq));
  pipeline.set(key(roomId, 'agentTurns'), String(agentTurns));
  if (lastHumanSeq !== null) {
    pipeline.set(key(roomId, 'lastHumanSeq'), String(lastHumanSeq));
  }
  pipeline.hset(key(roomId, 'meta'), 'lastActiveAt', new Date().toISOString());
  await pipeline.exec();
}

async function getMessageCount(roomId) {
  return getClient().zcard(key(roomId, 'messages'));
}

async function ensureRoom(roomId, meta) {
  const payload = {
    createdAt: new Date().toISOString(),
    title: meta && meta.title ? String(meta.title) : roomId,
    createdBy: meta && meta.createdBy ? String(meta.createdBy) : 'system',
    lastActiveAt: new Date().toISOString(),
    boundInstanceId: meta && meta.boundInstanceId ? String(meta.boundInstanceId) : '',
  };
  await getClient().hsetnx(key(roomId, 'meta'), 'createdAt', payload.createdAt);
  await getClient().hsetnx(key(roomId, 'meta'), 'title', payload.title);
  await getClient().hsetnx(key(roomId, 'meta'), 'createdBy', payload.createdBy);
  await getClient().hset(key(roomId, 'meta'), 'lastActiveAt', payload.lastActiveAt);
  if (payload.boundInstanceId) {
    await getClient().hsetnx(key(roomId, 'meta'), 'boundInstanceId', payload.boundInstanceId);
  }
  await getClient().sadd('rooms:index', roomId);
}

async function listRooms() {
  const ids = await getClient().smembers('rooms:index');
  if (!ids || ids.length === 0) return [];
  const out = [];
  for (const id of ids.sort()) {
    const meta = await getClient().hgetall(key(id, 'meta'));
    out.push({
      roomId: id,
      createdAt: meta.createdAt || null,
      title: meta.title || id,
      createdBy: meta.createdBy || null,
      lastActiveAt: meta.lastActiveAt || null,
      boundInstanceId: meta.boundInstanceId || null,
    });
  }
  return out;
}

module.exports = {
  incrSeq,
  addMsg,
  getMessagesSince,
  getRecentMessages,
  getMeta,
  seedFromArray,
  getMessageCount,
  ensureRoom,
  listRooms,
};
