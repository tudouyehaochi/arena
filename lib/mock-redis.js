class MockRedis {
  constructor() {
    this.kv = new Map(); this.hashes = new Map(); this.sets = new Map();
    this.lists = new Map(); this.zsets = new Map(); this.expireAt = new Map();
  }
  _now() { return Date.now(); }
  _purge(key) {
    const at = this.expireAt.get(key);
    if (!at || this._now() <= at) return;
    this.expireAt.delete(key); this.kv.delete(key); this.hashes.delete(key);
    this.sets.delete(key); this.lists.delete(key); this.zsets.delete(key);
  }
  async connect() { return 'OK'; }
  async quit() { return 'OK'; }
  disconnect() {}
  on() {}

  async get(key) { this._purge(key); return this.kv.has(key) ? this.kv.get(key) : null; }
  async set(key, value, ...args) {
    this._purge(key);
    let nx = false; let ex = null;
    for (let i = 0; i < args.length; i++) {
      const a = String(args[i]).toUpperCase();
      if (a === 'NX') nx = true;
      if (a === 'EX' && args[i + 1] != null) ex = Number(args[++i]);
    }
    if (nx && this.kv.has(key)) return null;
    this.kv.set(key, String(value));
    if (ex) this.expireAt.set(key, this._now() + ex * 1000);
    return 'OK';
  }
  async del(keys) {
    const arr = Array.isArray(keys) ? keys : [keys];
    let n = 0;
    for (const k of arr) {
      this._purge(k);
      if (this.kv.delete(k)) n++;
      if (this.hashes.delete(k)) n++;
      if (this.sets.delete(k)) n++;
      if (this.lists.delete(k)) n++;
      if (this.zsets.delete(k)) n++;
      this.expireAt.delete(k);
    }
    return n;
  }
  async incr(key) { const n = Number((await this.get(key)) || '0') + 1; await this.set(key, String(n)); return n; }
  async mget(...keys) { return Promise.all(keys.map((k) => this.get(k))); }
  async expire(key, sec) { this.expireAt.set(key, this._now() + Number(sec) * 1000); return 1; }

  async hset(key, ...args) {
    this._purge(key);
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    const h = this.hashes.get(key);
    let n = 0;
    if (args.length === 1 && typeof args[0] === 'object' && args[0]) {
      for (const [k, v] of Object.entries(args[0])) { if (!h.has(k)) n++; h.set(k, String(v)); }
      return n;
    }
    for (let i = 0; i < args.length; i += 2) {
      const k = String(args[i]); const v = String(args[i + 1]);
      if (!h.has(k)) n++; h.set(k, v);
    }
    return n;
  }
  async hsetnx(key, field, value) {
    this._purge(key);
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    const h = this.hashes.get(key);
    if (h.has(field)) return 0;
    h.set(field, String(value)); return 1;
  }
  async hgetall(key) {
    this._purge(key);
    const h = this.hashes.get(key); if (!h) return {};
    const out = {}; for (const [k, v] of h.entries()) out[k] = v; return out;
  }

  async sadd(key, ...members) {
    this._purge(key);
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    const s = this.sets.get(key); let n = 0;
    for (const m of members) { if (!s.has(m)) { s.add(m); n++; } }
    return n;
  }
  async smembers(key) { this._purge(key); return [...(this.sets.get(key) || new Set())]; }
  async srem(key, ...members) {
    this._purge(key);
    const s = this.sets.get(key); if (!s) return 0;
    let n = 0; for (const m of members) if (s.delete(m)) n++; return n;
  }
  async sismember(key, member) { this._purge(key); const s = this.sets.get(key); return s && s.has(member) ? 1 : 0; }

  _z(key) { if (!this.zsets.has(key)) this.zsets.set(key, []); return this.zsets.get(key); }
  async zadd(key, score, member) {
    this._purge(key);
    const z = this._z(key); const s = Number(score);
    const i = z.findIndex((x) => x.member === member);
    if (i >= 0) z[i].score = s; else z.push({ score: s, member });
    z.sort((a, b) => a.score - b.score); return 1;
  }
  async zrem(key, member) {
    this._purge(key);
    const z = this._z(key); const n0 = z.length;
    this.zsets.set(key, z.filter((x) => x.member !== member));
    return n0 - this.zsets.get(key).length;
  }
  async zcard(key) { this._purge(key); return this._z(key).length; }
  async zrangebyscore(key, min, max) {
    this._purge(key);
    const z = this._z(key);
    const minEx = String(min).startsWith('('); const minV = Number(String(min).replace('(', ''));
    const maxV = max === '+inf' ? Number.POSITIVE_INFINITY : Number(String(max));
    return z.filter((x) => (minEx ? x.score > minV : x.score >= minV) && x.score <= maxV).map((x) => x.member);
  }
  async zrevrangebyscore(key, max, min, ...args) {
    this._purge(key);
    const z = this._z(key).slice().sort((a, b) => b.score - a.score);
    const maxV = max === '+inf' ? Number.POSITIVE_INFINITY : Number(String(max));
    const minV = min === '-inf' ? Number.NEGATIVE_INFINITY : Number(String(min));
    let out = z.filter((x) => x.score <= maxV && x.score >= minV).map((x) => x.member);
    const i = args.findIndex((a) => String(a).toUpperCase() === 'LIMIT');
    if (i >= 0) out = out.slice(Number(args[i + 1] || 0), Number(args[i + 1] || 0) + Number(args[i + 2] || out.length));
    return out;
  }

  async lrange(key, start, stop) {
    this._purge(key);
    const l = this.lists.get(key) || [];
    const s = Number(start); const e = Number(stop);
    return l.slice(s, e < 0 ? undefined : e + 1);
  }
  async rpush(key, ...vals) {
    this._purge(key);
    if (!this.lists.has(key)) this.lists.set(key, []);
    const l = this.lists.get(key); for (const v of vals) l.push(String(v)); return l.length;
  }

  async scan(_cursor, _matchTok, pattern) {
    const keys = new Set([...this.kv.keys(), ...this.hashes.keys(), ...this.sets.keys(), ...this.lists.keys(), ...this.zsets.keys()]);
    const prefix = String(pattern || '').replace('*', '');
    return ['0', [...keys].filter((k) => k.startsWith(prefix))];
  }

  multi() { return this.pipeline(); }
  pipeline() {
    const cmds = []; const p = {};
    for (const fn of ['zadd', 'zrem', 'incr', 'set', 'hset', 'hsetnx', 'sadd', 'srem', 'del', 'expire']) {
      p[fn] = (...args) => { cmds.push([fn, args]); return p; };
    }
    p.exec = async () => { const out = []; for (const [fn, args] of cmds) out.push([null, await this[fn](...args)]); return out; };
    return p;
  }
}

module.exports = MockRedis;
