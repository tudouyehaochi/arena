const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ---------------------------------------------------------------------------
// auth.js tests
// ---------------------------------------------------------------------------
describe('auth', () => {
  let auth;
  beforeEach(() => {
    // Re-require to get fresh state is tricky; we test with the singleton.
    auth = require('../lib/auth');
  });

  it('getCredentials returns invocationId, callbackToken, jti', () => {
    const creds = auth.getCredentials();
    assert.ok(creds.invocationId, 'invocationId exists');
    assert.ok(creds.callbackToken, 'callbackToken exists');
    assert.ok(creds.jti, 'jti exists');
  });

  it('authenticate succeeds with valid Bearer header', () => {
    const creds = auth.getCredentials();
    const req = { headers: { authorization: `Bearer ${creds.invocationId}:${creds.callbackToken}:${creds.jti}` } };
    const result = auth.authenticate(req, {});
    assert.equal(result.ok, true);
  });

  it('authenticate fails with wrong token', () => {
    const creds = auth.getCredentials();
    const req = { headers: { authorization: `Bearer ${creds.invocationId}:wrong:${creds.jti}` } };
    const result = auth.authenticate(req, {});
    assert.equal(result.ok, false);
    assert.equal(result.error, 'unauthorized');
  });

  it('jti replay is blocked', () => {
    const creds = auth.getCredentials();
    const jti = creds.jti;
    // First use succeeds
    const req1 = { headers: { authorization: `Bearer ${creds.invocationId}:${creds.callbackToken}:${jti}` } };
    const r1 = auth.authenticate(req1, {});
    assert.equal(r1.ok, true);
    // Replay with same jti fails
    const req2 = { headers: { authorization: `Bearer ${creds.invocationId}:${creds.callbackToken}:${jti}` } };
    const r2 = auth.authenticate(req2, {});
    assert.equal(r2.ok, false);
    assert.equal(r2.error, 'jti_reused');
  });

  it('issueWsSession and validateWsSession round-trip', () => {
    const token = auth.issueWsSession('human');
    const result = auth.validateWsSession(token);
    assert.equal(result.ok, true);
    assert.equal(result.identity, 'human');
  });

  it('validateWsSession rejects unknown token', () => {
    const result = auth.validateWsSession('nonexistent');
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// message-store.js tests
// ---------------------------------------------------------------------------
describe('message-store', () => {
  // Note: message-store is a singleton. Tests add to global state.
  const store = require('../lib/message-store');

  it('addMessage assigns seq and timestamp', () => {
    const msg = store.addMessage({ type: 'chat', from: 'testUser', content: 'hello' });
    assert.ok(msg.seq > 0, 'seq is positive');
    assert.ok(msg.timestamp > 0, 'timestamp is set');
    assert.equal(msg.content, 'hello');
  });

  it('getSnapshot returns cursor and messages', () => {
    const snap = store.getSnapshot(0);
    assert.ok(snap.cursor > 0);
    assert.ok(Array.isArray(snap.messages));
    assert.ok(snap.totalMessages > 0);
  });

  it('consecutiveAgentTurns increments for agents', () => {
    // Reset by sending a human message
    store.addMessage({ type: 'chat', from: '镇元子', content: 'reset' });
    assert.equal(store.getAgentTurns(), 0);
    store.addMessage({ type: 'chat', from: '清风', content: 'agent msg 1' });
    assert.equal(store.getAgentTurns(), 1);
    store.addMessage({ type: 'chat', from: '明月', content: 'agent msg 2' });
    assert.equal(store.getAgentTurns(), 2);
    // Human resets counter
    store.addMessage({ type: 'chat', from: '镇元子', content: 'human msg' });
    assert.equal(store.getAgentTurns(), 0);
  });

  it('isAgent identifies agent names', () => {
    assert.equal(store.isAgent('清风'), true);
    assert.equal(store.isAgent('明月'), true);
    assert.equal(store.isAgent('镇元子'), false);
    assert.equal(store.isAgent('random'), false);
  });

  it('getSummarizedSnapshot returns compact format', () => {
    const snap = store.getSummarizedSnapshot(0);
    assert.ok(Array.isArray(snap.recent));
    assert.ok(Array.isArray(snap.highlights));
    assert.ok(snap.cursor > 0);
  });
});

// ---------------------------------------------------------------------------
// mcp-git-tools.js tests
// ---------------------------------------------------------------------------
describe('mcp-git-tools', () => {
  const { BLOCKED_PATTERNS, ALLOWED_GIT_COMMANDS } = require('../lib/mcp-git-tools');

  it('blocked patterns catch push to main', () => {
    assert.ok(BLOCKED_PATTERNS.some(p => p.test('push origin main')));
    assert.ok(BLOCKED_PATTERNS.some(p => p.test('push origin master')));
  });

  it('blocked patterns catch force push', () => {
    assert.ok(BLOCKED_PATTERNS.some(p => p.test('push --force')));
  });

  it('blocked patterns catch hard reset', () => {
    assert.ok(BLOCKED_PATTERNS.some(p => p.test('reset --hard')));
  });

  it('allowed commands include safe operations', () => {
    assert.ok(ALLOWED_GIT_COMMANDS.includes('log'));
    assert.ok(ALLOWED_GIT_COMMANDS.includes('diff'));
    assert.ok(ALLOWED_GIT_COMMANDS.includes('status'));
    assert.ok(!ALLOWED_GIT_COMMANDS.includes('push'));
    assert.ok(!ALLOWED_GIT_COMMANDS.includes('commit'));
  });
});

// ---------------------------------------------------------------------------
// mcp-file-tools.js — safePath tests
// ---------------------------------------------------------------------------
describe('mcp-file-tools safePath', () => {
  const { registerFileTools } = require('../lib/mcp-file-tools');
  // Create a mock server that records tool registrations
  const tools = [];
  const mockServer = { tool: (...args) => tools.push(args) };
  const projectRoot = path.join(__dirname, '..');
  const { safePath } = registerFileTools(mockServer, projectRoot);

  it('allows paths within project root', () => {
    const result = safePath('server.js');
    assert.ok(result.startsWith(path.resolve(projectRoot)));
  });

  it('blocks path traversal', () => {
    assert.throws(() => safePath('../../etc/passwd'), /Access denied/);
  });

  it('blocks absolute path outside root', () => {
    assert.throws(() => safePath('/etc/passwd'), /Access denied/);
  });
});

// ---------------------------------------------------------------------------
// message-util.js tests
// ---------------------------------------------------------------------------
describe('message-util', () => {
  const { normalizeMessage, clipText } = require('../lib/message-util');

  it('normalizeMessage fills defaults', () => {
    const msg = normalizeMessage({});
    assert.equal(msg.from, '镇元子');
    assert.equal(msg.content, '');
    assert.equal(msg.seq, null);
  });

  it('normalizeMessage extracts text field', () => {
    const msg = normalizeMessage({ text: 'hello', from: 'test' });
    assert.equal(msg.content, 'hello');
    assert.equal(msg.from, 'test');
  });

  it('clipText truncates long text', () => {
    const long = 'a'.repeat(200);
    const clipped = clipText(long, 50);
    assert.equal(clipped.length, 53); // 50 + '...'
    assert.ok(clipped.endsWith('...'));
  });

  it('clipText leaves short text unchanged', () => {
    assert.equal(clipText('short', 50), 'short');
  });
});
