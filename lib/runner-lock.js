async function acquireRunnerLock(redisClient, roomId, owner, ttlSec = 30) {
  const key = `room:${roomId}:runner:lock`;
  const ok = await redisClient.set(key, owner, 'EX', ttlSec, 'NX');
  if (ok !== 'OK') throw new Error(`runner_lock_busy:${roomId}`);
  return { key, owner, ttlSec };
}

async function renewRunnerLock(redisClient, lock) {
  const script = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
`;
  const out = await redisClient.eval(script, 1, lock.key, lock.owner, String(lock.ttlSec));
  return Number(out) === 1;
}

async function releaseRunnerLock(redisClient, lock) {
  const script = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
  await redisClient.eval(script, 1, lock.key, lock.owner);
}

module.exports = {
  acquireRunnerLock,
  renewRunnerLock,
  releaseRunnerLock,
};
