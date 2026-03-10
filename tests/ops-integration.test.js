const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createA2ARouter } = require('../lib/a2a-router');

function fakeRedis() {
  const seen = new Set();
  return {
    async set(key, _val, _ex, _ttl, nx) {
      if (nx !== 'NX') return 'OK';
      if (seen.has(key)) return null;
      seen.add(key);
      return 'OK';
    },
  };
}

describe('ops integration under burst load', () => {
  it('keeps routing bounded under high message volume', async () => {
    const router = createA2ARouter({
      roomId: 'default',
      redisClient: fakeRedis(),
      agents: ['清风', '明月'],
      defaultAgent: '清风',
      activationBudgetPerTurn: 2,
      maxDepth: 3,
    });
    const burst = [];
    for (let i = 0; i < 200; i++) {
      burst.push({ seq: i + 1, from: '镇元子', content: `@清风 @明月 批量消息 ${i}` });
    }
    const start = Date.now();
    const route = await router.ingest(burst);
    const costMs = Date.now() - start;

    assert.ok(costMs < 3000, `routing too slow: ${costMs}ms`);
    assert.equal(route.added.length, 2);
    assert.ok(route.dropped.length >= 198);
    assert.equal(route.dropReasons.activation_budget >= 198, true);
  });
});
