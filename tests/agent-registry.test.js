const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../lib/agent-registry');

describe('agent-registry', () => {
  it('lists default roles when empty', async () => {
    const roles = await registry.listRoles();
    assert.ok(Array.isArray(roles));
    assert.ok(roles.some((r) => r.name === '清风'));
    assert.ok(roles.some((r) => r.name === '明月'));
    assert.ok(roles.length >= 6);
  });

  it('replaces roles and updates enabled agent cache', async () => {
    const roles = await registry.replaceRoles([
      { name: '清风', model: 'claude', enabled: true, avatar: '清', color: '#2dd4bf' },
      { name: '明月', model: 'codex', enabled: false, avatar: '明', color: '#60a5fa' },
      { name: '二郎神', model: 'codex', enabled: true, avatar: '二', color: '#0ea5e9' },
    ]);
    assert.ok(roles.some((r) => r.name === '二郎神'));
    const refreshed = await registry.refreshRoleCache();
    assert.equal(refreshed.enabledAgentNames.includes('二郎神'), true);
    assert.equal(refreshed.enabledAgentNames.includes('明月'), false);
  });

  it('resolves mentions from role alias', async () => {
    const roles = [
      { name: '二郎神', alias: ['二郎', '真君'], enabled: true, status: 'idle' },
      { name: '哪吒', alias: ['三太子'], enabled: true, status: 'idle' },
    ];
    const out = registry.resolveMentionTargets('@二郎 先排查，@三太子 去实现', roles);
    assert.deepEqual(out, ['二郎神', '哪吒']);
  });
});
