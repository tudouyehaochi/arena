const redis = require('./redis-client');

function key(instanceId) {
  return `runtime:instance:${instanceId}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function registerInstance({ instanceId, runtimeEnv, branch, port, pid, roomId }) {
  const payload = {
    instanceId,
    runtimeEnv,
    branch,
    port: String(port),
    pid: String(pid),
    roomId: roomId || 'default',
    status: 'running',
    startedAt: nowIso(),
    heartbeatAt: nowIso(),
  };
  await redis.withFallback(
    async () => {
      const c = redis.getClient();
      await c.hset(key(instanceId), payload);
      await c.expire(key(instanceId), 120);
      await c.sadd('runtime:instances', instanceId);
    },
    () => {},
  );
}

async function heartbeatInstance(instanceId) {
  await redis.withFallback(
    async () => {
      const c = redis.getClient();
      await c.hset(key(instanceId), 'heartbeatAt', nowIso(), 'status', 'running');
      await c.expire(key(instanceId), 120);
    },
    () => {},
  );
}

async function stopInstance(instanceId) {
  await redis.withFallback(
    async () => {
      await redis.getClient().hset(key(instanceId), 'status', 'stopped', 'stoppedAt', nowIso());
    },
    () => {},
  );
}

module.exports = {
  registerInstance,
  heartbeatInstance,
  stopInstance,
};
