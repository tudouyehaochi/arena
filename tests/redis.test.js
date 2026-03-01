const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Mock redis-client before requiring modules that depend on it
const redisClient = require('../lib/redis-client');

describe('withFallback degradation', () => {
  it('uses redis branch when Redis is ready', async () => {
    const result = await redisClient.withFallback(
      async () => 'redis-value',
      () => 'fallback-value',
    );
    assert.equal(result, 'redis-value');
  });

  it('runs fallback when redisFn throws', async () => {
    // Force isReady to return true temporarily by calling internal state
    // Since we can't easily mock, test the error path by verifying the API contract
    const result = await redisClient.withFallback(
      async () => { throw new Error('connection refused'); },
      () => 'safe-fallback',
    );
    // When not ready, goes directly to fallback
    assert.equal(result, 'safe-fallback');
  });

  it('isReady returns true in memory redis mode', () => {
    assert.equal(redisClient.isReady(), true);
  });
});

describe('message-store addMessage (memory Redis)', () => {
  const store = require('../lib/message-store');

  beforeEach(() => {
    store._setLogFile(null); // disable file writes
  });

  it('addMessage returns message with seq (async)', async () => {
    const msg = await store.addMessage({ type: 'chat', from: 'test', content: 'hello' });
    assert.ok(typeof msg.seq === 'number');
    assert.ok(msg.seq > 0);
    assert.equal(msg.content, 'hello');
  });

  it('addMessage increments seq monotonically', async () => {
    const m1 = await store.addMessage({ type: 'chat', from: 'test', content: 'a' });
    const m2 = await store.addMessage({ type: 'chat', from: 'test', content: 'b' });
    assert.ok(m2.seq > m1.seq);
  });

  it('getSnapshot returns correct structure after async addMessage', async () => {
    await store.addMessage({ type: 'chat', from: '镇元子', content: 'snapshot test' });
    const snapshot = store.getSnapshot(0);
    assert.ok(typeof snapshot.cursor === 'number');
    assert.ok(Array.isArray(snapshot.messages));
    assert.ok(snapshot.totalMessages > 0);
  });
});

describe('redis-context (memory Redis)', () => {
  const ctx = require('../lib/redis-context');

  it('setAgentContext stores data in Redis', async () => {
    await ctx.setAgentContext('default', '清风', { currentGoal: 'test', status: 'idle' });
    const got = await ctx.getAgentContext('default', '清风');
    assert.equal(got.currentGoal, 'test');
  });

  it('getAgentContext returns stored value', async () => {
    const result = await ctx.getAgentContext('default', '清风');
    assert.ok(result && typeof result === 'object');
  });

  it('getAllAgentContext returns object entries', async () => {
    const result = await ctx.getAllAgentContext('default');
    assert.ok(Object.prototype.hasOwnProperty.call(result, '清风'));
    assert.ok(Object.prototype.hasOwnProperty.call(result, '明月'));
  });

  it('getSharedGoals returns pushed goals', async () => {
    await ctx.pushSharedGoal('default', 'goal1');
    const goals = await ctx.getSharedGoals('default');
    assert.ok(goals.includes('goal1'));
  });
});

describe('session-memory async (memory Redis)', () => {
  const memory = require('../lib/session-memory');

  it('loadSummary works with Redis', async () => {
    const result = await memory.loadSummary();
    // Returns null or a valid summary object
    assert.ok(result === null || typeof result === 'object');
  });

  it('summarizeMessages returns valid summary', () => {
    const summary = memory.summarizeMessages([
      { from: '镇元子', content: '请修复 auth.js 中的 bug' },
      { from: '清风', content: '已修复 auth.js，测试通过' },
    ]);
    assert.ok(summary.updatedAt);
    assert.ok(Array.isArray(summary.changedFiles));
    assert.ok(summary.changedFiles.includes('auth.js'));
  });
});
