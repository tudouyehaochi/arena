const { Readable } = require('node:stream');
const auth = require('../lib/auth');
const { handlePostMessage } = require('../lib/route-handlers');
const { handlePostRooms, handleDeleteRoom } = require('../lib/room-handlers');

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

function authHeaders() {
  const creds = auth.getCredentials();
  return { authorization: `Bearer ${creds.invocationId}:${creds.callbackToken}` };
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

module.exports = { makeRes, invokePost, authHeaders, invokeCreateRoom, invokeDeleteRoom };
