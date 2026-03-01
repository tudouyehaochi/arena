const fs = require('fs');
const path = require('path');
const store = require('./message-store');
const redisContext = require('./redis-context');
const { jsonResponse } = require('./route-handlers');
const { DEFAULT_ROOM_ID, resolveRoomIdFromUrl } = require('./room');

const METRICS_LOG = path.join(__dirname, '..', 'agent-metrics.log');
const AGENT_META = {
  清风: { model: 'Claude', avatar: '清', color: '#2dd4bf' },
  明月: { model: 'Codex', avatar: '明', color: '#60a5fa' },
};

function loadMetrics(roomId) {
  let lines = [];
  try {
    lines = fs.readFileSync(METRICS_LOG, 'utf8').split('\n').filter(Boolean).slice(-3000);
  } catch {
    return {};
  }
  const agg = {};
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.roomId !== roomId || !row.agent) continue;
    if (!agg[row.agent]) agg[row.agent] = { invokeCount: 0, totalPromptChars: 0, avgPromptChars: 0, lastInvokeAt: null };
    const a = agg[row.agent];
    a.invokeCount += 1;
    a.totalPromptChars += Number(row.promptChars || 0);
    a.lastInvokeAt = row.ts || a.lastInvokeAt;
  }
  for (const agent of Object.keys(agg)) {
    const a = agg[agent];
    a.avgPromptChars = a.invokeCount > 0 ? Math.round(a.totalPromptChars / a.invokeCount) : 0;
  }
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
  await store.loadFromLog(roomId);
  const messages = store.getMessages(roomId);
  const metrics = loadMetrics(roomId);
  const ctx = await redisContext.getAllAgentContext(roomId);
  const seen = lastSeenByAgent(messages);

  const agents = Object.keys(AGENT_META).map((name) => {
    const msgCount = messages.filter((m) => m.from === name).length;
    const usage = metrics[name] || { invokeCount: 0, totalPromptChars: 0, avgPromptChars: 0, lastInvokeAt: null };
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
