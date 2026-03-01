const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const auth = require('../lib/auth');
const store = require('../lib/message-store');
const { handlePostMessage } = require('../lib/route-handlers');

function makeRes() {
  return {
    status: null,
    body: '',
    headersSent: false,
    writeHead(code) { this.status = code; this.headersSent = true; },
    end(payload) { this.body = payload || ''; },
  };
}

function invokePost(payload, authHeader, runtime) {
  return new Promise((resolve) => {
    const req = Readable.from([JSON.stringify(payload)]);
    req.headers = authHeader ? { authorization: authHeader } : {};
    const res = makeRes();
    const origEnd = res.end.bind(res);
    res.end = (data) => { origEnd(data); resolve(res); };
    handlePostMessage(req, res, () => {}, runtime);
  });
}

describe('room isolation', () => {
  it('store keeps room messages separated', async () => {
    store._setLogFile(null);
    await store.ensureRoom('roomA', { title: 'roomA', createdBy: 'test' });
    await store.ensureRoom('roomB', { title: 'roomB', createdBy: 'test' });
    await store.addMessage({ type: 'chat', from: 'u1', content: 'a1' }, 'roomA');
    await store.addMessage({ type: 'chat', from: 'u2', content: 'b1' }, 'roomB');
    const a = store.getSnapshot('roomA', 0);
    const b = store.getSnapshot('roomB', 0);
    assert.ok(a.messages.some((m) => m.content === 'a1'));
    assert.ok(!a.messages.some((m) => m.content === 'b1'));
    assert.ok(b.messages.some((m) => m.content === 'b1'));
    assert.ok(!b.messages.some((m) => m.content === 'a1'));
  });

  it('ws token is room-scoped', async () => {
    const token = await auth.issueWsSession('human', 'roomA');
    assert.equal((await auth.validateWsSession(token, 'roomA')).ok, true);
    assert.equal((await auth.validateWsSession(token, 'roomB')).ok, false);
  });

  it('callback post requires roomId', async () => {
    const creds = auth.getCredentials();
    const authHeader = `Bearer ${creds.invocationId}:${creds.callbackToken}`;
    const runtime = { instanceId: 'dev:dev:3000', runtimeEnv: 'dev', targetPort: 3000 };
    const res = await invokePost({
      content: 'missing room',
      from: '明月',
      instanceId: 'dev:dev:3000',
      runtimeEnv: 'dev',
      targetPort: 3000,
      idempotencyKey: 'room-required-1',
    }, authHeader, runtime);
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.body).error, 'missing_room_id');
  });
});
