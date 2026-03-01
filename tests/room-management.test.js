const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { Readable } = require('node:stream');

const store = require('../lib/message-store');
const { handlePostRooms, handleDeleteRoom } = require('../lib/room-handlers');

function tempLogFile(name) {
  return path.join(os.tmpdir(), `arena-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
}

function makeRes(done) {
  return {
    status: 0,
    body: '',
    headersSent: false,
    writeHead(code) { this.status = code; this.headersSent = true; },
    end(payload) { this.body = payload || ''; done(this); },
  };
}

function invokeCreateRoom(payload, instanceId = 'dev:dev:3000') {
  return new Promise((resolve) => {
    const req = Readable.from([JSON.stringify(payload)]);
    req.headers = {};
    handlePostRooms(req, makeRes(resolve), instanceId);
  });
}

function invokeDeleteRoom(roomId) {
  return new Promise((resolve) => {
    const req = { url: `/api/rooms?roomId=${encodeURIComponent(roomId)}`, headers: {} };
    handleDeleteRoom(req, makeRes(resolve));
  });
}

describe('room management', () => {
  it('listRooms does not resurrect deleted room from backup log only', async () => {
    const log = tempLogFile('rooms-list-no-resurrect');
    const roomId = `new_day_deleted_${Date.now()}`;
    store._setLogFile(log);
    const c1 = await invokeCreateRoom({ roomId, title: roomId, createdBy: 'tester' });
    assert.equal(c1.status, 200);
    const d1 = await invokeDeleteRoom(roomId);
    assert.equal(d1.status, 200);
    fs.appendFileSync(log, `${JSON.stringify({ type: 'chat', from: 'u', content: 'stale', roomId, timestamp: Date.now() })}\n`, 'utf8');
    const rooms = await store.listRooms();
    assert.ok(!rooms.some((r) => r.roomId === roomId));
  });

  it('create room rejects duplicate room id', async () => {
    const log = tempLogFile('rooms-dup');
    store._setLogFile(log);
    const roomId = `dup_room_${Date.now()}`;
    const r1 = await invokeCreateRoom({ roomId, title: roomId, createdBy: 'tester' });
    const r2 = await invokeCreateRoom({ roomId, title: roomId, createdBy: 'tester' });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 409);
    assert.equal(JSON.parse(r2.body).error, 'room_exists');
  });

  it('deleteRoom removes backup log content and allows clean re-create', async () => {
    const log = tempLogFile('rooms-delete');
    store._setLogFile(log);
    const roomId = `room_del_${Date.now()}`;
    await store.addMessage({ type: 'chat', from: 'tester', content: 'old message' }, roomId);
    assert.ok(fs.readFileSync(log, 'utf8').includes(`\"roomId\":\"${roomId}\"`));
    await store.deleteRoom(roomId);
    assert.ok(!fs.readFileSync(log, 'utf8').includes(`\"roomId\":\"${roomId}\"`));

    const created = await invokeCreateRoom({ roomId, title: roomId, createdBy: 'tester' });
    assert.equal(created.status, 200);
    const snap = store.getSnapshot(roomId, 0);
    assert.equal(snap.totalMessages, 0);
  });

  it('delete then create same room id succeeds via handlers', async () => {
    const log = tempLogFile('rooms-delete-create');
    store._setLogFile(log);
    const roomId = `new_day_${Date.now()}`;
    const c1 = await invokeCreateRoom({ roomId, title: roomId, createdBy: 'tester' });
    assert.equal(c1.status, 200);
    const d1 = await invokeDeleteRoom(roomId);
    assert.equal(d1.status, 200);
    const c2 = await invokeCreateRoom({ roomId, title: roomId, createdBy: 'tester' });
    assert.equal(c2.status, 200);
  });
});
