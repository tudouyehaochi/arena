const { AGENT_NAMES } = require('./room');
const agentRegistry = require('./agent-registry');

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

function classifyIntent(text) {
  const raw = String(text || '');
  const intents = [];
  if (/资讯|新闻|动态|发布|模型更新|announcement|release/i.test(raw)) intents.push('ai_news');
  if (/错误|异常|故障|排查|修复|回归|debug|error|failed/i.test(raw)) intents.push('debug');
  if (/实现|开发|写代码|落地|交付|编码|feature/i.test(raw)) intents.push('implementation');
  if (/方案|设计|架构|规划|计划|拆分|review|评审/i.test(raw)) intents.push('planning');
  if (intents.length === 0) intents.push('discussion');
  return intents;
}

function normalizeRoleProfiles(roleProfiles = [], activeAgents = []) {
  const active = new Set(activeAgents);
  return (Array.isArray(roleProfiles) ? roleProfiles : [])
    .filter((role) => role && active.has(String(role.name || '')))
    .filter((role) => role.enabled !== false && role.status !== 'muted');
}

function matchRule(rule, text, intents) {
  if (!rule) return false;
  const ruleIntents = Array.isArray(rule.intents) ? rule.intents.map((v) => String(v || '').toLowerCase()) : [];
  const ruleKeywords = Array.isArray(rule.keywords) ? rule.keywords.map((v) => String(v || '')) : [];
  const genericIntentOnly = ruleIntents.length === 1 && ruleIntents[0] === 'discussion';
  const intentHit = ruleIntents.length > 0 && ruleIntents.some((intent) => intents.includes(intent));
  const keywordHit = ruleKeywords.length > 0 && ruleKeywords.some((kw) => kw && text.includes(kw));
  if (genericIntentOnly && !keywordHit) return false;
  return intentHit || keywordHit;
}

function pickRuleTargets(text, intents, roleProfiles) {
  const ranked = [];
  for (const role of roleProfiles) {
    const rules = Array.isArray(role.activationRules) ? role.activationRules : [];
    let best = null;
    for (const rule of rules) {
      if (!matchRule(rule, text, intents)) continue;
      if (!best || Number(rule.priority || 0) > Number(best.priority || 0)) best = rule;
    }
    if (!best) continue;
    ranked.push({
      target: role.name,
      ruleId: String(best.id || 'rule'),
      rolePriority: Number(role.priority || 50),
      rulePriority: Number(best.priority || 50),
    });
  }
  ranked.sort((a, b) => (b.rulePriority - a.rulePriority) || (b.rolePriority - a.rolePriority));
  return ranked;
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
  let activeAgents = Array.isArray(agents) && agents.length > 0 ? [...agents] : [...AGENT_NAMES];
  let fallbackAgent = defaultAgent;
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
    return {
      queued: queue.length,
      pendingDepthByAgent: Object.fromEntries(pendingDepthByAgent.entries()),
      agents: activeAgents.slice(),
    };
  }

  function setAgents(nextAgents) {
    const next = Array.isArray(nextAgents) ? [...new Set(nextAgents.map((a) => String(a || '').trim()).filter(Boolean))] : [];
    if (next.length === 0) return activeAgents.slice();
    activeAgents = next;
    if (!activeAgents.includes(fallbackAgent)) fallbackAgent = activeAgents[0];
    return activeAgents.slice();
  }

  async function ingest(messages, options = {}) {
    const added = [];
    let cancelRequested = false;
    const dropped = [];
    const candidateRoles = new Set();
    const activeRoles = new Set();
    const reasonByRole = {};
    const dropReasons = {};
    const executionOrder = [];
    const configuredBudget = Number(options.activationBudget || activationBudgetPerTurn || 0);
    const activationBudget = Number.isFinite(configuredBudget) && configuredBudget > 0
      ? Math.floor(configuredBudget)
      : Infinity;
    const roleProfiles = normalizeRoleProfiles(
      options.roleProfiles || agentRegistry.getCachedRoles(),
      activeAgents,
    );

    for (const msg of messages || []) {
      if (msg?.type && msg.type !== 'chat') continue;
      const from = String(msg?.from || '');
      const text = toText(msg);
      if (!text) continue;

      if (isHuman(from, activeAgents)) {
        // New human turn starts a fresh depth chain.
        resetDepthState();
        if (isCancelMessage(text)) {
          cancelRequested = true;
          clearQueue();
          continue;
        }
      }

      if (activeAgents.includes(from) && !messageDepth.has(msg.seq)) {
        const baseDepth = Number(pendingDepthByAgent.get(from) || 1);
        rememberDepth(msg.seq, Math.max(1, baseDepth));
        pendingDepthByAgent.delete(from);
      }

      const intents = classifyIntent(text);
      const mentions = agentRegistry.resolveMentionTargets(text, roleProfiles);
      const mentionTargets = mentions.length > 0 ? mentions : parseMentions(text, activeAgents);
      let targets = [];
      if (mentionTargets.length > 0) {
        targets = mentionTargets.map((name) => ({ target: name, reason: 'mention', ruleId: null }));
      } else if (isHuman(from, activeAgents)) {
        const ruleTargets = pickRuleTargets(text, intents, roleProfiles);
        if (ruleTargets.length > 0) {
          targets = ruleTargets.map((item) => ({ target: item.target, reason: 'rule', ruleId: item.ruleId }));
        } else {
          targets = [{ target: fallbackAgent, reason: 'fallback', ruleId: null }];
        }
      }
      for (const item of targets) {
        const target = item.target;
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

        const sourceDepth = isHuman(from, activeAgents)
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
          reason: item.reason,
          ruleId: item.ruleId,
          intents,
        };
        queue.push(task);
        added.push(task);
        activeRoles.add(target);
        executionOrder.push(target);
        reasonByRole[target] = item.reason === 'rule' && item.ruleId
          ? `rule:${item.ruleId}`
          : item.reason;
      }
    }

    return {
      added,
      dropped,
      cancelRequested,
      queued: queue.length,
      candidateRoles: [...candidateRoles],
      activeRoles: [...activeRoles],
      reasonByRole,
      executionOrder,
      dropReasons,
    };
  }

  return {
    ingest,
    nextTask,
    clearQueue,
    noteAgentInvocation,
    stats,
    setAgents,
  };
}

module.exports = {
  createA2ARouter,
  parseMentions,
  classifyIntent,
  isCancelMessage,
};
