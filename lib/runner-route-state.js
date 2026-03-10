function key(roomId) {
  return `room:${roomId}:runner:routeState`;
}

async function writeRouteState(redisClient, roomId, state, ttlSec = 180) {
  const payload = {
    roomId,
    ts: new Date().toISOString(),
    queued: Number(state?.queued || 0),
    maxDepth: Number(state?.maxDepth || 0),
    activeTask: state?.activeTask || null,
    lastDropped: Array.isArray(state?.lastDropped) ? state.lastDropped.slice(0, 5) : [],
    candidateRoles: Array.isArray(state?.candidateRoles) ? state.candidateRoles.slice(0, 10) : [],
    activeRoles: Array.isArray(state?.activeRoles) ? state.activeRoles.slice(0, 10) : [],
    dropReasons: state?.dropReasons && typeof state.dropReasons === 'object' ? state.dropReasons : {},
    reasonByRole: state?.reasonByRole && typeof state.reasonByRole === 'object' ? state.reasonByRole : {},
    executionOrder: Array.isArray(state?.executionOrder) ? state.executionOrder.slice(0, 10) : [],
    retrievalCount: Number(state?.retrievalCount || 0),
    retrievalType: String(state?.retrievalType || ''),
    degradeLevel: Number(state?.degradeLevel || 0),
    circuitOpen: Boolean(state?.circuitOpen),
  };
  await redisClient.set(key(roomId), JSON.stringify(payload), 'EX', ttlSec);
  return payload;
}

async function readRouteState(redisClient, roomId) {
  const raw = await redisClient.get(key(roomId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

module.exports = {
  writeRouteState,
  readRouteState,
};
