const redis = require('./redis-client');

const AGENTS = ['清风', '明月'];
const SHARED_GOALS_KEY = 'arena:agent:shared:goals';

function contextKey(agent) {
  return `arena:agent:${agent}:context`;
}

async function setAgentContext(agent, ctx) {
  return redis.withFallback(
    () => {
      const flat = {};
      for (const [k, v] of Object.entries(ctx)) {
        if (v !== undefined && v !== null) flat[k] = String(v);
      }
      return redis.getClient().hset(contextKey(agent), flat);
    },
    () => {},
  );
}

async function getAgentContext(agent) {
  return redis.withFallback(
    async () => {
      const data = await redis.getClient().hgetall(contextKey(agent));
      return Object.keys(data).length > 0 ? data : null;
    },
    () => null,
  );
}

async function getAllAgentContext() {
  const result = {};
  for (const agent of AGENTS) {
    result[agent] = await getAgentContext(agent);
  }
  return result;
}

async function pushSharedGoal(goal) {
  return redis.withFallback(
    () => redis.getClient().rpush(SHARED_GOALS_KEY, goal),
    () => {},
  );
}

async function getSharedGoals() {
  return redis.withFallback(
    () => redis.getClient().lrange(SHARED_GOALS_KEY, 0, -1),
    () => [],
  );
}

module.exports = {
  setAgentContext,
  getAgentContext,
  getAllAgentContext,
  pushSharedGoal,
  getSharedGoals,
};
