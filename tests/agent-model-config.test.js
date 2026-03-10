const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cfg = require('../lib/agent-model-config');

describe('agent-model-config', () => {
  it('returns defaults when unset', async () => {
    const models = await cfg.getAgentModelMap();
    assert.equal(models['清风'], 'claude');
    assert.equal(models['明月'], 'codex');
  });

  it('persists valid models and normalizes invalid values', async () => {
    const saved = await cfg.setAgentModelMap({ 清风: 'codex', 明月: 'invalid' });
    assert.equal(saved['清风'], 'codex');
    assert.equal(saved['明月'], 'codex');
    const loaded = await cfg.getAgentModelMap();
    assert.equal(loaded['清风'], 'codex');
    assert.equal(loaded['明月'], 'codex');
  });
});
