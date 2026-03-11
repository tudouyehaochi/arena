const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../lib/network-policy');

describe('network-policy', () => {
  it('normalizes policy payload', () => {
    const out = policy.normalizePolicy({
      networkEnabled: 1,
      roleModes: { 清风: 'allow', 明月: 'x' },
      skillModes: { planning: 'deny' },
      allowedDomains: ['OpenAI.com', '*.github.com', '*.github.com'],
    });
    assert.equal(out.networkEnabled, true);
    assert.equal(out.roleModes.清风, 'allow');
    assert.equal(out.roleModes.明月, 'inherit');
    assert.equal(out.skillModes.planning, 'deny');
    assert.deepEqual(out.allowedDomains, ['openai.com', '*.github.com']);
  });

  it('evaluates allow/deny with domain whitelist', () => {
    const p = policy.normalizePolicy({
      networkEnabled: true,
      roleModes: { 清风: 'allow' },
      skillModes: { 'skill-installer': 'allow' },
      allowedDomains: ['github.com'],
    });
    const ok = policy.evaluateAccess(p, {
      role: '清风',
      skills: ['skill-installer'],
      url: 'https://github.com/openai/codex',
    });
    assert.equal(ok.allow, true);
    const denied = policy.evaluateAccess(p, {
      role: '清风',
      skills: ['skill-installer'],
      url: 'https://example.com/repo',
    });
    assert.equal(denied.allow, false);
    assert.equal(denied.reason, 'domain_denied');
  });
});
