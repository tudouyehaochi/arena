const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { Readable } = require('node:stream');

const auth = require('../lib/auth');
const { handleGetWsToken, handleGetSnapshot, handlePostMessage } = require('../lib/route-handlers');
const store = require('../lib/message-store');
const { handlePostRooms, handleDeleteRoom } = require('../lib/room-handlers');
const { buildPrompt } = require('../lib/prompt-builder');
const { registerFileTools } = require('../lib/mcp-file-tools');
store._setLogFile(null);

function makeRes() {
  return {
    status: null,
    headers: null,
    body: '',
    headersSent: false,
    writeHead(code, headers) {
      this.status = code;
      this.headers = headers;
      this.headersSent = true;
    },
    end(payload) {
      this.body = payload || '';
    },
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
function invokeCreateRoom(payload, instanceId = 'dev:dev:3000') {
  return new Promise((resolve) => {
    const req = Readable.from([JSON.stringify(payload)]);
    req.headers = {};
    const res = makeRes();
    const origEnd = res.end.bind(res);
    res.end = (data) => { origEnd(data); resolve(res); };
    handlePostRooms(req, res, instanceId);
  });
}
function invokeDeleteRoom(roomId) {
  return new Promise((resolve) => {
    const req = { url: `/api/rooms?roomId=${encodeURIComponent(roomId)}`, headers: {} };
    const res = makeRes();
    const origEnd = res.end.bind(res);
    res.end = (data) => { origEnd(data); resolve(res); };
    handleDeleteRoom(req, res);
  });
}

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

  it('POST /api/callbacks/post-message rejects env mismatch', async () => {
    const creds = auth.getCredentials();
    const authHeader = `Bearer ${creds.invocationId}:${creds.callbackToken}`;
    const runtime = { instanceId: 'dev:dev:3000', runtimeEnv: 'dev', targetPort: 3000 };
    const res = await invokePost({
      content: 'test',
      from: '明月',
      roomId: 'default',
      instanceId: 'prod:master:3001',
      runtimeEnv: 'prod',
      targetPort: 3001,
      idempotencyKey: 'idem-mismatch-1',
    }, authHeader, runtime);
    assert.equal(res.status, 409);
    assert.equal(JSON.parse(res.body).error, 'env_mismatch');
  });

  it('POST /api/callbacks/post-message deduplicates by idempotency key', async () => {
    const creds = auth.getCredentials();
    const authHeader = `Bearer ${creds.invocationId}:${creds.callbackToken}`;
    const runtime = { instanceId: 'dev:dev:3000', runtimeEnv: 'dev', targetPort: 3000 };
    const totalBefore = store.getSnapshot(0).totalMessages;
    const payload = {
      content: 'idempotent-msg',
      from: '明月',
      roomId: 'default',
      instanceId: 'dev:dev:3000',
      runtimeEnv: 'dev',
      targetPort: 3000,
      idempotencyKey: 'idem-same-1',
    };
    const r1 = await invokePost(payload, authHeader, runtime);
    const r2 = await invokePost(payload, authHeader, runtime);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    const b1 = JSON.parse(r1.body);
    const b2 = JSON.parse(r2.body);
    assert.equal(b1.seq, b2.seq);
    assert.equal(b2.deduped, true);
    const totalAfter = store.getSnapshot(0).totalMessages;
    assert.equal(totalAfter, totalBefore + 1);
  });

  it('GET /api/agent-snapshot returns room_not_found for deleted room', async () => {
    const roomId = `deleted_room_${Date.now()}`;
    const created = await invokeCreateRoom({ roomId, title: roomId, createdBy: 'tester' });
    assert.equal(created.status, 200);
    const deleted = await invokeDeleteRoom(roomId);
    assert.equal(deleted.status, 200);

    const creds = auth.getCredentials();
    const req = {
      url: `/api/agent-snapshot?since=0&roomId=${encodeURIComponent(roomId)}`,
      headers: { authorization: `Bearer ${creds.invocationId}:${creds.callbackToken}` },
    };
    const res = makeRes();
    await handleGetSnapshot(req, res, 3000);
    assert.equal(res.status, 404);
    assert.equal(JSON.parse(res.body).error, 'room_not_found');
    const rooms = await store.listRooms();
    assert.ok(!rooms.some((r) => r.roomId === roomId));
  });
});

describe('prompt-builder regression', () => {
  it('coding context contains core rules and coding skill', () => {
    const prompt = buildPrompt('明月', [
      { from: '镇元子', content: '请 review server.js 代码并修复 bug' },
    ]);
    assert.match(prompt, /## 行为铁律/);
    assert.match(prompt, /## 编码规范/);
    assert.match(prompt, /单文件不超过 200 行/);
  });

  it('non-coding context still contains core rules', () => {
    const prompt = buildPrompt('清风', [{ from: '镇元子', content: '你好呀' }]);
    assert.match(prompt, /## 行为铁律/);
    assert.doesNotMatch(prompt, /## 编码规范/);
  });
});

describe('mcp-file-tools default behavior', () => {
  it('arena_read_file defaults to full numbered content', async () => {
    const tools = [];
    const mockServer = { tool: (...args) => tools.push(args) };
    registerFileTools(mockServer, path.join(__dirname, '..'));
    const read = tools.find(t => t[0] === 'arena_read_file')[3];
    const result = await read({ path: 'lib/message-util.js' });
    const text = result.content[0].text;
    assert.match(text, /^1:\s/);
    assert.match(text, /module\.exports/);
    assert.ok(text.split('\n').length > 10);
  });
});

describe('cli-entry regression', () => {
  it('cli-entry with missing args exits non-zero and prints usage', () => {
    const r = spawnSync('node', ['cli-entry.js'], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr || '', /Usage: node cli-entry\.js/);
  });
});
