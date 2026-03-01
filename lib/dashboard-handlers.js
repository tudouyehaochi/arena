const store = require('./message-store');
const redisContext = require('./redis-context');
const { jsonResponse } = require('./route-handlers');
const { DEFAULT_ROOM_ID, AGENT_NAMES, resolveRoomIdFromUrl } = require('./room');

const AGENT_META = {
  清风: { model: 'Claude', avatar: '清', color: '#2dd4bf' },
  明月: { model: 'Codex', avatar: '明', color: '#60a5fa' },
};

function loadMetrics(messages) {
  const agg = {};
  for (const m of messages) {
    if (!AGENT_META[m.from] || !m.usage) continue;
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

function lastSeenByAgent(messages) {
  const out = {};
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (AGENT_META[m.from] && !out[m.from]) out[m.from] = m.timestamp || null;
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
  try {
    await store.loadFromLog(roomId);
    messages = store.getMessages(roomId);
    metrics = loadMetrics(messages);
    ctx = await redisContext.getAllAgentContext(roomId);
    seen = lastSeenByAgent(messages);
  } catch (err) {
    if (err.message === 'room_not_found') { jsonResponse(res, 404, { error: err.message }); return; }
    if (err.message === 'redis_unavailable') { jsonResponse(res, 503, { error: err.message }); return; }
    jsonResponse(res, 500, { error: err.message });
    return;
  }

  const agents = Object.keys(AGENT_META).map((name) => {
    const msgCount = messages.filter((m) => m.from === name).length;
    const usage = metrics[name] || { invokeCount: 0, totalInputTokens: 0, totalOutputTokens: 0, avgInputTokens: 0, lastInvokeAt: null };
    const context = ctx[name] || null;
    return {
      name,
      ...AGENT_META[name],
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
    agents,
  });
}

module.exports = { handleGetDashboard };
