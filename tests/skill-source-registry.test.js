const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const networkPolicy = require('../lib/network-policy');
const skills = require('../lib/skill-source-registry');

describe('skill-source-registry', () => {
  it('blocks install when network policy denies', async () => {
    await networkPolicy.setPolicy({
      networkEnabled: false,
      allowedDomains: ['github.com'],
    });
    await assert.rejects(
      skills.installSkill({
        skillId: 'frontend-design-plus',
        sourceType: 'url',
        sourceRef: 'https://github.com/example/frontend-design-plus',
        installedBy: 'tester',
      }),
      /network_blocked/,
    );
  });

  it('installs and updates skill status when network allows', async () => {
    await networkPolicy.setPolicy({
      networkEnabled: true,
      allowedDomains: ['github.com'],
      skillModes: { 'skill-installer': 'allow' },
    });
    const installed = await skills.installSkill({
      skillId: 'frontend-design-plus',
      sourceType: 'url',
      sourceRef: 'https://github.com/example/frontend-design-plus',
      installedBy: 'tester',
    });
    assert.equal(installed.skillId, 'frontend-design-plus');
    assert.equal(installed.status, 'active');
    const disabled = await skills.updateSkillStatus('frontend-design-plus', 'disable', 'tester');
    assert.equal(disabled.status, 'disabled');
    const enabled = await skills.updateSkillStatus('frontend-design-plus', 'enable', 'tester');
    assert.equal(enabled.status, 'active');
    const list = await skills.listInstalledSkills();
    assert.ok(list.some((s) => s.skillId === 'frontend-design-plus'));
  });
});
