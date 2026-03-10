const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  CircuitBreaker,
  effectiveActivationBudget,
  selectPromptMessagesByDegrade,
} = require('../lib/ops-governance');

describe('ops-governance', () => {
  it('effectiveActivationBudget degrades by one but keeps minimum one', () => {
    assert.equal(effectiveActivationBudget(3, 0), 3);
    assert.equal(effectiveActivationBudget(3, 1), 2);
    assert.equal(effectiveActivationBudget(1, 2), 1);
  });

  it('selectPromptMessagesByDegrade returns fewer messages on higher degrade', () => {
    const msgs = [{ seq: 1 }, { seq: 2 }, { seq: 3 }];
    assert.equal(selectPromptMessagesByDegrade(msgs, 0).length, 3);
    assert.equal(selectPromptMessagesByDegrade(msgs, 2).length, 1);
    assert.equal(selectPromptMessagesByDegrade(msgs, 3).length, 0);
  });

  it('circuit breaker opens after threshold and closes after success', () => {
    const cb = new CircuitBreaker({ enabled: true, errorWindow: 2, cooldownMs: 1000 });
    const t0 = Date.now();
    cb.recordFailure(t0);
    assert.equal(cb.isOpen(t0), false);
    cb.recordFailure(t0 + 10);
    assert.equal(cb.isOpen(t0 + 20), true);
    assert.equal(cb.isOpen(t0 + 2000), false);
    cb.recordSuccess(t0 + 2000);
    assert.equal(cb.getState(t0 + 2000).failures, 0);
  });
});
