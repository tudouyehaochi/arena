const redis = require('./redis-client');

const { AGENT_NAMES: AGENTS } = require('./room');

function contextKey(roomId, agent) {
  return `room:${roomId}:agent:${agent}:context`;
}

function goalsKey(roomId) {
  return `room:${roomId}:shared:goals`;
}

async function setAgentContext(roomId, agent, ctx) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const flat = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v !== undefined && v !== null) flat[k] = String(v);
  }
  if (Object.keys(flat).length === 0) return 0;
  return redis.getClient().hset(contextKey(roomId, agent), flat);
}

async function getAgentContext(roomId, agent) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const data = await redis.getClient().hgetall(contextKey(roomId, agent));
  return Object.keys(data).length > 0 ? data : null;
}

async function getAllAgentContext(roomId) {
  const result = {};
  for (const agent of AGENTS) {
    result[agent] = await getAgentContext(roomId, agent);
  }
  return result;
}

async function pushSharedGoal(roomId, goal) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  return redis.getClient().rpush(goalsKey(roomId), goal);
}

async function getSharedGoals(roomId) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const goals = await redis.getClient().lrange(goalsKey(roomId), 0, -1);
  return goals || [];
}

module.exports = {
  setAgentContext,
  getAgentContext,
  getAllAgentContext,
  pushSharedGoal,
  getSharedGoals,
};
