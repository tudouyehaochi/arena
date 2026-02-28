const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const auth = require('../lib/auth');
const { handleGetWsToken, handleGetSnapshot } = require('../lib/route-handlers');
const store = require('../lib/message-store');
const { buildPrompt } = require('../lib/prompt-builder');
const { registerFileTools } = require('../lib/mcp-file-tools');

function makeRes() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(code, headers) {
      this.status = code;
      this.headers = headers;
    },
    end(payload) {
      this.body = payload || '';
    },
  };
}

describe('route-handlers auth regression', () => {
  it('GET /api/ws-token without Authorization issues human session', () => {
    const req = { url: '/api/ws-token', headers: {} };
    const res = makeRes();
    handleGetWsToken(req, res);
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    const session = auth.validateWsSession(data.token);
    assert.equal(session.ok, true);
    assert.equal(session.identity, 'human');
  });

  it('GET /api/ws-token with valid Authorization issues agent session', () => {
    const creds = auth.getCredentials();
    const req = {
      url: '/api/ws-token',
      headers: { authorization: `Bearer ${creds.invocationId}:${creds.callbackToken}` },
    };
    const res = makeRes();
    handleGetWsToken(req, res);
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    const session = auth.validateWsSession(data.token);
    assert.equal(session.ok, true);
    assert.equal(session.identity, 'agent');
  });

  it('GET /api/ws-token with invalid Authorization is rejected', () => {
    const req = { url: '/api/ws-token', headers: { authorization: 'Bearer bad:bad' } };
    const res = makeRes();
    handleGetWsToken(req, res);
    assert.equal(res.status, 401);
    const data = JSON.parse(res.body);
    assert.equal(data.error, 'unauthorized');
  });

  it('GET /api/agent-snapshot without Authorization is rejected', () => {
    const req = { url: '/api/agent-snapshot?since=0', headers: {} };
    const res = makeRes();
    handleGetSnapshot(req, res, 3000);
    assert.equal(res.status, 401);
  });

  it('GET /api/agent-snapshot with Authorization returns snapshot', () => {
    const creds = auth.getCredentials();
    store.addMessage({ type: 'chat', from: '镇元子', content: 'snapshot seed' });
    const req = {
      url: '/api/agent-snapshot?since=0',
      headers: { authorization: `Bearer ${creds.invocationId}:${creds.callbackToken}` },
    };
    const res = makeRes();
    handleGetSnapshot(req, res, 3000);
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(typeof data.cursor === 'number');
    assert.ok(Array.isArray(data.messages));
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
