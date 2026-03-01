const { getClient } = require('./redis-client');

const KEY_MESSAGES = 'arena:messages';
const KEY_SEQ = 'arena:meta:seq';
const KEY_AGENT_TURNS = 'arena:meta:agentTurns';
const KEY_LAST_HUMAN_SEQ = 'arena:meta:lastHumanSeq';

const AGENT_NAMES = ['清风', '明月'];

async function incrSeq() {
  return getClient().incr(KEY_SEQ);
}

async function addMsg(msg) {
  const pipeline = getClient().multi();
  pipeline.zadd(KEY_MESSAGES, msg.seq, JSON.stringify(msg));
  if (AGENT_NAMES.includes(msg.from)) {
    pipeline.incr(KEY_AGENT_TURNS);
  } else {
    pipeline.set(KEY_AGENT_TURNS, '0');
    pipeline.set(KEY_LAST_HUMAN_SEQ, String(msg.seq));
  }
  await pipeline.exec();
}

async function getMessagesSince(cursor) {
  const raw = await getClient().zrangebyscore(KEY_MESSAGES, `(${cursor}`, '+inf');
  return raw.map(s => JSON.parse(s));
}

async function getRecentMessages(count = 50) {
  const raw = await getClient().zrevrangebyscore(KEY_MESSAGES, '+inf', '-inf', 'LIMIT', 0, count);
  return raw.reverse().map(s => JSON.parse(s));
}

async function getMeta() {
  const [seq, agentTurns, lastHumanSeq] = await getClient().mget(KEY_SEQ, KEY_AGENT_TURNS, KEY_LAST_HUMAN_SEQ);
  return {
    seq: seq ? parseInt(seq, 10) : 0,
    agentTurns: agentTurns ? parseInt(agentTurns, 10) : 0,
    lastHumanSeq: lastHumanSeq ? parseInt(lastHumanSeq, 10) : null,
  };
}

async function seedFromArray(msgs) {
  if (msgs.length === 0) return;
  const client = getClient();
  const pipeline = client.pipeline();
  let maxSeq = 0;
  let agentTurns = 0;
  let lastHumanSeq = null;

  // Rebuild counters from tail
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (!AGENT_NAMES.includes(msgs[i].from)) {
      // Count consecutive agent turns from end
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
    pipeline.zadd(KEY_MESSAGES, msg.seq, JSON.stringify(msg));
    if (msg.seq > maxSeq) maxSeq = msg.seq;
  }
  pipeline.set(KEY_SEQ, String(maxSeq));
  pipeline.set(KEY_AGENT_TURNS, String(agentTurns));
  if (lastHumanSeq !== null) {
    pipeline.set(KEY_LAST_HUMAN_SEQ, String(lastHumanSeq));
  }
  await pipeline.exec();
}

async function getMessageCount() {
  return getClient().zcard(KEY_MESSAGES);
}

module.exports = {
  incrSeq,
  addMsg,
  getMessagesSince,
  getRecentMessages,
  getMeta,
  seedFromArray,
  getMessageCount,
};
