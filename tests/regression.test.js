const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { buildPrompt } = require('../lib/prompt-builder');
const { registerFileTools } = require('../lib/mcp-file-tools');

describe('prompt-builder regression', () => {
  it('coding context contains core rules and coding skill', () => {
    const prompt = buildPrompt('明月', [
      { from: '镇元子', content: '请 review server.js 代码并修复 bug' },
    ]);
    assert.match(prompt, /## 行为铁律/);
    assert.match(prompt, /## 编码规范/);
    assert.match(prompt, /单文件不超过 200 行/);
    assert.match(prompt, /先完成一个最小动作/);
  });

  it('non-coding context still contains core rules', () => {
    const prompt = buildPrompt('清风', [{ from: '镇元子', content: '你好呀' }]);
    assert.match(prompt, /## 行为铁律/);
    assert.doesNotMatch(prompt, /## 编码规范/);
  });

  it('prompt includes all dynamic host names', () => {
    const prompt = buildPrompt('清风', [
      { from: '镇元子', content: '请处理一下' },
    ]);
    assert.match(prompt, /镇元子／玉皇大帝/, 'meta rules should list all hosts');
    assert.match(prompt, /@镇元子 或 @玉皇大帝/, 'reply guidance should mention all host @-handles');
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
