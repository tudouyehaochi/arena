const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createA2ARouter, parseMentions, isCancelMessage } = require('../lib/a2a-router');

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

describe('a2a-router', () => {
  it('parseMentions finds mentioned agents', () => {
    const out = parseMentions('@清风 你好 @明月', ['清风', '明月']);
    assert.deepEqual(out, ['清风', '明月']);
  });

  it('cancel message detection works', () => {
    assert.equal(isCancelMessage('/cancel'), true);
    assert.equal(isCancelMessage('停止'), true);
    assert.equal(isCancelMessage('普通消息'), false);
  });

  it('human message without mention routes to default agent', async () => {
    const router = createA2ARouter({ roomId: 'default', redisClient: fakeRedis(), agents: ['清风', '明月'], defaultAgent: '清风' });
    const r = await router.ingest([{ seq: 1, from: '镇元子', content: '帮我看下这个报错' }]);
    assert.equal(r.added.length, 1);
    assert.equal(r.added[0].target, '清风');
    assert.equal(r.added[0].depth, 1);
  });

  it('agent mention increments depth and enforces limit', async () => {
    const router = createA2ARouter({ roomId: 'default', redisClient: fakeRedis(), agents: ['清风', '明月'], maxDepth: 2 });
    router.noteAgentInvocation('清风', 2);
    const r = await router.ingest([{ seq: 10, from: '清风', content: '@明月 接力处理' }]);
    assert.equal(r.added.length, 0);
    assert.equal(r.dropped.length, 1);
    assert.equal(r.dropped[0].reason, 'depth_limit');
  });

  it('dedupe prevents duplicate enqueue from same source', async () => {
    const router = createA2ARouter({ roomId: 'default', redisClient: fakeRedis(), agents: ['清风', '明月'], defaultAgent: '清风' });
    const msg = { seq: 2, from: '镇元子', content: '@明月 ping' };
    const r1 = await router.ingest([msg]);
    const r2 = await router.ingest([msg]);
    assert.equal(r1.added.length, 1);
    assert.equal(r2.added.length, 0);
  });

  it('cancel clears queue and reports cancelRequested', async () => {
    const router = createA2ARouter({ roomId: 'default', redisClient: fakeRedis(), agents: ['清风', '明月'], defaultAgent: '清风' });
    await router.ingest([{ seq: 3, from: '镇元子', content: '先做这个' }]);
    const r = await router.ingest([{ seq: 4, from: '镇元子', content: '/cancel' }]);
    assert.equal(r.cancelRequested, true);
    assert.equal(router.nextTask(), null);
  });
});
