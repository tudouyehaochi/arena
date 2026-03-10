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

const MAX_DEPTH_MEMORY = 400;

function createA2ARouter({
  roomId,
  redisClient,
  agents = AGENT_NAMES,
  maxDepth = 10,
  defaultAgent = '清风',
  activationBudgetPerTurn = 2,
}) {
  const queue = [];
  const messageDepth = new Map();
  const pendingDepthByAgent = new Map();
  const depthOrder = [];

  function noteAgentInvocation(agent, depth) {
    pendingDepthByAgent.set(String(agent), Number(depth || 1));
  }

  function resetDepthState() {
    messageDepth.clear();
    pendingDepthByAgent.clear();
    depthOrder.length = 0;
  }

  function rememberDepth(seq, depth) {
    if (messageDepth.has(seq)) return;
    messageDepth.set(seq, depth);
    depthOrder.push(seq);
    while (depthOrder.length > MAX_DEPTH_MEMORY) {
      const staleSeq = depthOrder.shift();
      messageDepth.delete(staleSeq);
    }
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

  async function ingest(messages, options = {}) {
    const added = [];
    let cancelRequested = false;
    const dropped = [];
    const candidateRoles = new Set();
    const activeRoles = new Set();
    const dropReasons = {};
    const configuredBudget = Number(options.activationBudget || activationBudgetPerTurn || 0);
    const activationBudget = Number.isFinite(configuredBudget) && configuredBudget > 0
      ? Math.floor(configuredBudget)
      : Infinity;

    for (const msg of messages || []) {
      if (msg?.type && msg.type !== 'chat') continue;
      const from = String(msg?.from || '');
      const text = toText(msg);
      if (!text) continue;

      if (isHuman(from, agents)) {
        // New human turn starts a fresh depth chain.
        resetDepthState();
        if (isCancelMessage(text)) {
          cancelRequested = true;
          clearQueue();
          continue;
        }
      }

      if (agents.includes(from) && !messageDepth.has(msg.seq)) {
        const baseDepth = Number(pendingDepthByAgent.get(from) || 1);
        rememberDepth(msg.seq, Math.max(1, baseDepth));
        pendingDepthByAgent.delete(from);
      }

      const mentions = parseMentions(text, agents);
      const targets = mentions.length > 0 ? mentions : (isHuman(from, agents) ? [defaultAgent] : []);
      for (const target of targets) {
        candidateRoles.add(target);
        if (from === target) continue;
        const k = routeKey(roomId, msg, target);
        const ok = await dedupe(redisClient, k);
        if (!ok) continue;

        if (added.length >= activationBudget) {
          dropped.push({ reason: 'activation_budget', seq: msg.seq || null, from, target, depth: null });
          dropReasons.activation_budget = (dropReasons.activation_budget || 0) + 1;
          continue;
        }

        const sourceDepth = isHuman(from, agents)
          ? 0
          : Number(messageDepth.get(msg.seq) || pendingDepthByAgent.get(from) || 1);
        const depth = sourceDepth + 1;
        if (depth > maxDepth) {
          dropped.push({ reason: 'depth_limit', seq: msg.seq || null, from, target, depth });
          dropReasons.depth_limit = (dropReasons.depth_limit || 0) + 1;
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
        activeRoles.add(target);
      }
    }

    return {
      added,
      dropped,
      cancelRequested,
      queued: queue.length,
      candidateRoles: [...candidateRoles],
      activeRoles: [...activeRoles],
      dropReasons,
    };
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
