const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const auth = require('../lib/auth');
const { handleGetWsToken, handleGetSnapshot } = require('../lib/route-handlers');
const store = require('../lib/message-store');
const { handleGetAdmin, handleGetAdminStatus, handlePostAdminLogin } = require('../lib/admin-handlers');
const { handleGetRooms } = require('../lib/room-handlers');
const { handleGetDashboard } = require('../lib/dashboard-handlers');
const { makeRes, invokePost, invokeCreateRoom, invokeDeleteRoom } = require('./test-helpers');
store._setLogFile(null);

describe('route-handlers auth regression', () => {
  it('GET /api/ws-token without Authorization issues human session', async () => {
    const req = { url: '/api/ws-token?roomId=default', headers: {} };
    const res = makeRes();
    await handleGetWsToken(req, res);
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    const session = await auth.validateWsSession(data.token, 'default');
    assert.equal(session.ok, true);
    assert.equal(session.identity, 'human');
  });

  it('GET /api/ws-token with valid Authorization issues agent session', async () => {
    const creds = auth.getCredentials();
    const req = {
      url: '/api/ws-token?roomId=default',
      headers: { authorization: `Bearer ${creds.invocationId}:${creds.callbackToken}` },
    };
    const res = makeRes();
    await handleGetWsToken(req, res);
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    const session = await auth.validateWsSession(data.token, 'default');
    assert.equal(session.ok, true);
    assert.equal(session.identity, 'agent');
  });

  it('GET /api/ws-token with invalid Authorization is rejected', async () => {
    const req = { url: '/api/ws-token?roomId=default', headers: { authorization: 'Bearer bad:bad' } };
    const res = makeRes();
    await handleGetWsToken(req, res);
    assert.equal(res.status, 401);
    const data = JSON.parse(res.body);
    assert.equal(data.error, 'unauthorized');
  });

  it('GET /api/agent-snapshot without Authorization is rejected', async () => {
    const req = { url: '/api/agent-snapshot?since=0', headers: {} };
    const res = makeRes();
    await handleGetSnapshot(req, res, 3000);
    assert.equal(res.status, 401);
  });

  it('GET /api/agent-snapshot with Authorization returns snapshot', async () => {
    const creds = auth.getCredentials();
    await store.addMessage({ type: 'chat', from: '镇元子', content: 'snapshot seed' });
    const req = {
      url: '/api/agent-snapshot?since=0&roomId=default',
      headers: { authorization: `Bearer ${creds.invocationId}:${creds.callbackToken}` },
    };
    const res = makeRes();
    await handleGetSnapshot(req, res, 3000);
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(typeof data.cursor === 'number');
    assert.ok(Array.isArray(data.messages));
  });

  it('POST rejects env mismatch', async () => {
    const creds = auth.getCredentials();
    const authHeader = `Bearer ${creds.invocationId}:${creds.callbackToken}`;
    const runtime = { instanceId: 'dev:dev:3000', runtimeEnv: 'dev', targetPort: 3000 };
    const res = await invokePost({
      content: 'test', from: '明月', roomId: 'default',
      instanceId: 'prod:master:3001', runtimeEnv: 'prod', targetPort: 3001,
      idempotencyKey: 'idem-mismatch-1',
    }, authHeader, runtime);
    assert.equal(res.status, 409);
    assert.equal(JSON.parse(res.body).error, 'env_mismatch');
  });

  it('POST deduplicates by idempotency key', async () => {
    const creds = auth.getCredentials();
    const authHeader = `Bearer ${creds.invocationId}:${creds.callbackToken}`;
    const runtime = { instanceId: 'dev:dev:3000', runtimeEnv: 'dev', targetPort: 3000 };
    const totalBefore = store.getSnapshot(0).totalMessages;
    const payload = {
      content: 'idempotent-msg', from: '明月', roomId: 'default',
      instanceId: 'dev:dev:3000', runtimeEnv: 'dev', targetPort: 3000,
      idempotencyKey: 'idem-same-1',
    };
    const r1 = await invokePost(payload, authHeader, runtime);
    const r2 = await invokePost(payload, authHeader, runtime);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(JSON.parse(r1.body).seq, JSON.parse(r2.body).seq);
    assert.equal(JSON.parse(r2.body).deduped, true);
    assert.equal(store.getSnapshot(0).totalMessages, totalBefore + 1);
  });

  it('POST blocks consecutive status-only agent replies', async () => {
    const creds = auth.getCredentials();
    const authHeader = `Bearer ${creds.invocationId}:${creds.callbackToken}`;
    const runtime = { instanceId: 'dev:dev:3000', runtimeEnv: 'dev', targetPort: 3000 };
    const base = {
      from: '明月', roomId: 'default',
      instanceId: 'dev:dev:3000', runtimeEnv: 'dev', targetPort: 3000,
    };
    const r1 = await invokePost(
      { ...base, content: '收到，我先处理。', idempotencyKey: 'status-loop-1' },
      authHeader, runtime,
    );
    const r2 = await invokePost(
      { ...base, content: '在执行，稍后回报。', idempotencyKey: 'status-loop-2' },
      authHeader, runtime,
    );
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 409);
    assert.equal(JSON.parse(r2.body).error, 'status_without_progress');
  });

  it('snapshot returns room_not_found for deleted room', async () => {
    const roomId = `deleted_room_${Date.now()}`;
    await invokeCreateRoom({ roomId, title: roomId, createdBy: 'tester' });
    await invokeDeleteRoom(roomId);
    const creds = auth.getCredentials();
    const req = {
      url: `/api/agent-snapshot?since=0&roomId=${encodeURIComponent(roomId)}`,
      headers: { authorization: `Bearer ${creds.invocationId}:${creds.callbackToken}` },
    };
    const res = makeRes();
    await handleGetSnapshot(req, res, 3000);
    assert.equal(res.status, 404);
    assert.equal(JSON.parse(res.body).error, 'room_not_found');
  });

  it('GET /api/admin/status rejects unauthenticated request', async () => {
    const prev = process.env.ARENA_ADMIN_KEY;
    process.env.ARENA_ADMIN_KEY = 'admin-test-key';
    const req = { url: '/api/admin/status', headers: {} };
    const res = makeRes();
    await handleGetAdminStatus(req, res);
    assert.equal(res.status, 401);
    process.env.ARENA_ADMIN_KEY = prev;
  });

  it('GET /admin returns login page without auth', async () => {
    const req = { url: '/admin', headers: {} };
    const res = await new Promise((resolve) => {
      const r = makeRes();
      const origEnd = r.end.bind(r);
      r.end = (data) => { origEnd(data); resolve(r); };
      handleGetAdmin(req, r);
    });
    assert.equal(res.status, 200);
    assert.match(String(res.body || ''), /Admin Login/);
  });

  it('GET /api/dashboard works without bearer auth', async () => {
    const req = { url: '/api/dashboard?roomId=default', headers: {} };
    const res = makeRes();
    await handleGetDashboard(req, res);
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.roomId, 'default');
    assert.ok(Array.isArray(data.agents));
    assert.ok(Object.prototype.hasOwnProperty.call(data, 'route'));
  });

  it('POST /api/rooms works without bearer auth', async () => {
    const roomId = `guest_create_${Date.now()}`;
    await invokeCreateRoom({ roomId, title: roomId, createdBy: 'tester' });
    await invokeDeleteRoom(roomId);
  });

  it('GET /api/rooms works without bearer auth', async () => {
    const req = { url: '/api/rooms', headers: {} };
    const res = makeRes();
    await handleGetRooms(req, res);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(JSON.parse(res.body).rooms));
  });

  it('POST /api/admin/login accepts default credentials', async () => {
    const req = Readable.from([JSON.stringify({ username: 'admin', password: 'arena_123' })]);
    req.headers = {};
    const res = makeRes();
    await handlePostAdminLogin(req, res);
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.status, 'ok');
    assert.ok(typeof data.token === 'string' && data.token.length > 10);
  });
});
