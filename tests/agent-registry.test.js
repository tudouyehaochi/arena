const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../lib/agent-registry');

describe('agent-registry', () => {
  it('lists default roles when empty', async () => {
    const roles = await registry.listRoles();
    assert.ok(Array.isArray(roles));
    assert.ok(roles.some((r) => r.name === '清风'));
    assert.ok(roles.some((r) => r.name === '明月'));
    assert.ok(roles.some((r) => r.name === '文曲星'));
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

  it('normalizes activation mode and skill bindings', () => {
    const role = registry.normalizeRole({
      name: '测试角色',
      activationMode: 'always_on',
      skills: ['planning'],
      skillBindings: [{ id: 'frontend-design', priority: 'high' }],
    });
    assert.equal(role.activationMode, 'always_on');
    assert.ok(Array.isArray(role.skillBindings));
    assert.equal(role.skillBindings[0].id, 'frontend-design');
    assert.equal(role.skills.includes('frontend-design'), true);
  });

  it('syncs preset roles in merge_missing mode', async () => {
    await registry.replaceRoles([
      { name: '清风', model: 'claude', enabled: true, avatar: '清', color: '#2dd4bf' },
    ]);
    const out = await registry.syncPresetRoles('merge_missing');
    assert.equal(out.mode, 'merge_missing');
    assert.ok(out.changedCount >= 1);
    const roles = await registry.listRoles();
    assert.ok(roles.some((r) => r.name === '文曲星'));
    const sync = await registry.getPresetSyncStatus();
    assert.equal(sync.presetVersion, registry.getPresetVersion());
  });
});
