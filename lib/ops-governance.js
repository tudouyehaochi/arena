function toPositiveInt(value, fallback) {
  const n = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

class CircuitBreaker {
  constructor({ enabled = true, errorWindow = 5, cooldownMs = 30000 } = {}) {
    this.enabled = Boolean(enabled);
    this.errorWindow = toPositiveInt(errorWindow, 5);
    this.cooldownMs = toPositiveInt(cooldownMs, 30000);
    this.failures = 0;
    this.openUntil = 0;
  }

  isOpen(now = Date.now()) {
    if (!this.enabled) return false;
    return now < this.openUntil;
  }

  recordFailure(now = Date.now()) {
    if (!this.enabled) return this.getState(now);
    this.failures += 1;
    if (this.failures >= this.errorWindow) {
      this.openUntil = now + this.cooldownMs;
    }
    return this.getState(now);
  }

  recordSuccess(now = Date.now()) {
    if (!this.enabled) return this.getState(now);
    this.failures = 0;
    if (now >= this.openUntil) this.openUntil = 0;
    return this.getState(now);
  }

  getState(now = Date.now()) {
    const open = this.isOpen(now);
    return {
      enabled: this.enabled,
      open,
      failures: this.failures,
      openUntil: this.openUntil || null,
      retryAfterMs: open ? Math.max(0, this.openUntil - now) : 0,
    };
  }
}

function effectiveActivationBudget(baseBudget, degradeLevel = 0) {
  const base = toPositiveInt(baseBudget, 2);
  if (degradeLevel <= 0) return base;
  return Math.max(1, base - 1);
}

function selectPromptMessagesByDegrade(recentMessages, degradeLevel = 0) {
  const list = Array.isArray(recentMessages) ? recentMessages : [];
  if (degradeLevel >= 3) return [];
  if (degradeLevel >= 2) return list.slice(-1);
  return list;
}

module.exports = {
  toPositiveInt,
  toBool,
  CircuitBreaker,
  effectiveActivationBudget,
  selectPromptMessagesByDegrade,
};
