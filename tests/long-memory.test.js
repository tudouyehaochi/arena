const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const memory = require('../lib/long-memory');

describe('long-memory', () => {
  it('deduplicates same summary by fingerprint', async () => {
    const roomId = `mem_dedupe_${Date.now()}`;
    const a = await memory.upsertMemory(roomId, {
      type: 'decision',
      summary: '决定采用方案A并完成修复',
      confidence: 0.9,
      evidence: ['test passed'],
    });
    const b = await memory.upsertMemory(roomId, {
      type: 'decision',
      summary: '决定采用方案A并完成修复',
      confidence: 0.7,
      evidence: ['logs'],
    });
    assert.ok(a && b);
    assert.equal(a.id, b.id);
    const top = await memory.listTopMemory(roomId, { topK: 5 });
    assert.equal(top.length, 1);
  });

  it('ranks higher quality item first', async () => {
    const roomId = `mem_rank_${Date.now()}`;
    await memory.upsertMemory(roomId, {
      type: 'procedure',
      summary: 'todo fix',
      confidence: 0.3,
      evidence: [],
    });
    await memory.upsertMemory(roomId, {
      type: 'decision',
      summary: '决定采用方案B，已通过回归测试并附带证据',
      confidence: 0.95,
      evidence: ['test-1', 'test-2'],
    });
    const top = await memory.listTopMemory(roomId, { topK: 2 });
    assert.equal(top.length, 2);
    assert.equal(top[0].type, 'decision');
    assert.ok(top[0].qualityScore >= top[1].qualityScore);
  });

  it('prunes expired records', async () => {
    const roomId = `mem_ttl_${Date.now()}`;
    await memory.upsertMemory(roomId, {
      type: 'news',
      summary: '模型发布资讯',
      confidence: 0.7,
      evidence: ['source-a'],
    }, { ttlSec: 1 });
    const removed = await memory.pruneExpiredMemory(roomId, { limit: 20, nowTs: Date.now() + 70000 });
    assert.ok(removed >= 1);
    const top = await memory.listTopMemory(roomId, { topK: 5, nowTs: Date.now() + 70000 });
    assert.equal(top.length, 0);
  });
});
