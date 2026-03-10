const store = require('./message-store');
const redisContext = require('./redis-context');
const redis = require('./redis-client');
const agentRegistry = require('./agent-registry');
const { readRouteState } = require('./runner-route-state');
const { jsonResponse } = require('./route-handlers');
const { DEFAULT_ROOM_ID, resolveRoomIdFromUrl } = require('./room');

const DEFAULT_AGENT_META = {
  avatar: 'A',
  color: '#64748b',
};

function loadMetrics(messages, validAgents) {
  const valid = new Set(validAgents || []);
  const agg = {};
  for (const m of messages) {
    if (!valid.has(m.from) || !m.usage) continue;
    if (!agg[m.from]) {
      agg[m.from] = { invokeCount: 0, totalInputTokens: 0, totalOutputTokens: 0, avgInputTokens: 0, lastInvokeAt: null };
    }
    const a = agg[m.from];
    a.invokeCount += 1;
    a.totalInputTokens += Number(m.usage.inputTokens || 0);
    a.totalOutputTokens += Number(m.usage.outputTokens || 0);
    a.lastInvokeAt = m.timestamp || a.lastInvokeAt;
  }
  for (const agent of Object.keys(agg)) agg[agent].avgInputTokens = Math.round(agg[agent].totalInputTokens / Math.max(1, agg[agent].invokeCount));
  return agg;
}

function lastSeenByAgent(messages, validAgents) {
  const valid = new Set(validAgents || []);
  const out = {};
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (valid.has(m.from) && !out[m.from]) out[m.from] = m.timestamp || null;
  }
  return out;
}

async function handleGetDashboard(req, res) {
  let roomId;
  try {
    roomId = resolveRoomIdFromUrl(req.url, DEFAULT_ROOM_ID);
  } catch {
    jsonResponse(res, 400, { error: 'invalid_room_id' });
    return;
  }
  let messages;
  let metrics;
  let ctx;
  let seen;
  let route = null;
  let roles = [];
  let roleNames = [];
  try {
    roles = await agentRegistry.listRoles().catch(() => []);
    roleNames = (roles.length > 0 ? roles : [{ name: '清风' }, { name: '明月' }]).map((r) => r.name);
    await store.loadFromLog(roomId);
    messages = store.getMessages(roomId);
    metrics = loadMetrics(messages, roleNames);
    ctx = await redisContext.getAllAgentContext(roomId);
    seen = lastSeenByAgent(messages, roleNames);
    if (redis.isReady()) route = await readRouteState(redis.getClient(), roomId);
  } catch (err) {
    if (err.message === 'room_not_found') { jsonResponse(res, 404, { error: err.message }); return; }
    if (err.message === 'redis_unavailable') { jsonResponse(res, 503, { error: err.message }); return; }
    jsonResponse(res, 500, { error: err.message });
    return;
  }

  const activeRoles = roles.length > 0 ? roles : [
    { name: '清风', avatar: '清', color: '#2dd4bf', model: 'claude', enabled: true },
    { name: '明月', avatar: '明', color: '#60a5fa', model: 'codex', enabled: true },
  ];

  const agents = activeRoles.filter((r) => r.enabled !== false).map((role) => {
    const name = role.name;
    const msgCount = messages.filter((m) => m.from === name).length;
    const usage = metrics[name] || { invokeCount: 0, totalInputTokens: 0, totalOutputTokens: 0, avgInputTokens: 0, lastInvokeAt: null };
    const context = ctx[name] || null;
    return {
      name,
      avatar: role.avatar || DEFAULT_AGENT_META.avatar,
      color: role.color || DEFAULT_AGENT_META.color,
      model: String(role.model || 'claude').toLowerCase() === 'codex' ? 'Codex' : 'Claude',
      status: context?.status || (usage.invokeCount > 0 ? 'active' : 'idle'),
      currentGoal: context?.currentGoal || '',
      lastAction: context?.lastAction || '',
      lastFile: context?.lastFile || '',
      messageCount: msgCount,
      lastSeenAt: seen[name] || null,
      usage,
    };
  });

  jsonResponse(res, 200, {
    roomId,
    totalMessages: messages.length,
    agentTurns: store.getAgentTurns(roomId),
    route,
    agents,
  });
}

module.exports = { handleGetDashboard };
