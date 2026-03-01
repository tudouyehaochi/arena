const { AGENT_NAMES } = require('./room');

const ROUTE_TTL_SEC = 10 * 60;

function toText(msg) {
  return String(msg?.content ?? msg?.text ?? '').trim();
}

function parseMentions(text, agents = AGENT_NAMES) {
  const out = [];
  for (const name of agents) {
    if (text.includes(`@${name}`)) out.push(name);
  }
  return out;
}

function isHuman(from, agents = AGENT_NAMES) {
  return !agents.includes(String(from || ''));
}

function isCancelMessage(text) {
  return /^\s*(\/cancel|\/stop)\b/i.test(String(text || '')) || /^(停止|取消)\s*$/.test(String(text || '').trim());
}

function routeKey(roomId, msg, target) {
  return `room:${roomId}:route:dedupe:${msg.seq || 'na'}:${msg.from || 'unknown'}:${target}`;
}

async function dedupe(redisClient, key) {
  if (!redisClient) return true;
  const ok = await redisClient.set(key, '1', 'EX', ROUTE_TTL_SEC, 'NX');
  return ok === 'OK';
}

function createA2ARouter({ roomId, redisClient, agents = AGENT_NAMES, maxDepth = 4, defaultAgent = '清风' }) {
  const queue = [];
  const messageDepth = new Map();
  const pendingDepthByAgent = new Map();

  function noteAgentInvocation(agent, depth) {
    pendingDepthByAgent.set(String(agent), Number(depth || 1));
  }

  function clearQueue() {
    queue.length = 0;
  }

  function nextTask() {
    return queue.shift() || null;
  }

  function stats() {
    return { queued: queue.length, pendingDepthByAgent: Object.fromEntries(pendingDepthByAgent.entries()) };
  }

  async function ingest(messages) {
    const added = [];
    let cancelRequested = false;
    const dropped = [];

    for (const msg of messages || []) {
      if (msg?.type && msg.type !== 'chat') continue;
      const from = String(msg?.from || '');
      const text = toText(msg);
      if (!text) continue;

      if (isHuman(from, agents) && isCancelMessage(text)) {
        cancelRequested = true;
        clearQueue();
        continue;
      }

      if (agents.includes(from) && !messageDepth.has(msg.seq)) {
        const baseDepth = Number(pendingDepthByAgent.get(from) || 1);
        messageDepth.set(msg.seq, Math.max(1, baseDepth));
        pendingDepthByAgent.delete(from);
      }

      const mentions = parseMentions(text, agents);
      const targets = mentions.length > 0 ? mentions : (isHuman(from, agents) ? [defaultAgent] : []);
      for (const target of targets) {
        if (from === target) continue;
        const k = routeKey(roomId, msg, target);
        const ok = await dedupe(redisClient, k);
        if (!ok) continue;

        const sourceDepth = isHuman(from, agents)
          ? 0
          : Number(messageDepth.get(msg.seq) || pendingDepthByAgent.get(from) || 1);
        const depth = sourceDepth + 1;
        if (depth > maxDepth) {
          dropped.push({ reason: 'depth_limit', seq: msg.seq || null, from, target, depth });
          continue;
        }

        const task = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          roomId,
          target,
          sourceSeq: Number(msg.seq || 0),
          sourceFrom: from,
          sourceText: text,
          depth,
        };
        queue.push(task);
        added.push(task);
      }
    }

    return { added, dropped, cancelRequested, queued: queue.length };
  }

  return {
    ingest,
    nextTask,
    clearQueue,
    noteAgentInvocation,
    stats,
  };
}

module.exports = {
  createA2ARouter,
  parseMentions,
  isCancelMessage,
};
