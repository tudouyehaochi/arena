const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { buildPrompt, getPromptMode } = require('../lib/prompt-builder');
const { registerFileTools } = require('../lib/mcp-file-tools');

describe('prompt-builder regression', () => {
  it('coding context contains compact core rules and coding skill capsule', () => {
    const prompt = buildPrompt('明月', [
      { from: '镇元子', content: '请 review server.js 代码并修复 bug' },
    ]);
    assert.match(prompt, /## 行为铁律/);
    assert.match(prompt, /## Skill: coding-lite/);
    assert.match(prompt, /优先 mode="summary"/);
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

  it('legacy mode remains available for rollback', () => {
    const prompt = buildPrompt('清风', [{ from: '镇元子', content: '请修复 bug' }], { promptMode: 'legacy' });
    assert.match(prompt, /## 编码规范/);
    assert.match(prompt, /单文件不超过 200 行/);
  });

  it('default prompt mode resolves to optimized when unset', () => {
    assert.equal(getPromptMode({}), 'optimized');
  });

  it('qingfeng persona traits are injected in optimized mode', () => {
    const prompt = buildPrompt('清风', [{ from: '镇元子', content: '帮我做个计划' }], { promptMode: 'optimized' });
    assert.match(prompt, /严谨/);
    assert.match(prompt, /不服输/);
    assert.match(prompt, /偶尔害羞/);
  });

  it('mingyue persona traits are injected and bounded by safety rule', () => {
    const prompt = buildPrompt('明月', [{ from: '镇元子', content: '聊聊今天进展' }], { promptMode: 'optimized' });
    assert.match(prompt, /开朗活泼/);
    assert.match(prompt, /不会冷场/);
    assert.match(prompt, /优先正确性与安全性/);
  });

  it('prompt includes long-term memory snippets when provided', () => {
    const prompt = buildPrompt('清风', [{ from: '镇元子', content: '继续推进' }], {
      promptMode: 'optimized',
      longTermMemory: [
        { type: 'decision', summary: '决定采用分层检索策略' },
        { type: 'procedure', summary: '先跑最小测试再扩展验证' },
      ],
    });
    assert.match(prompt, /memory=decision:决定采用分层检索策略/);
    assert.match(prompt, /procedure:先跑最小测试再扩展验证/);
  });

  it('prompt injects active role persona when provided by registry', () => {
    const prompt = buildPrompt('二郎神', [{ from: '镇元子', content: '帮我排查错误日志' }], {
      promptMode: 'optimized',
      activeRoleProfile: {
        name: '二郎神',
        persona: '执行果断，擅长故障定位。',
        skills: ['incident-response', 'debugging'],
      },
    });
    assert.match(prompt, /你是二郎神/);
    assert.match(prompt, /执行果断，擅长故障定位/);
    assert.match(prompt, /Skill: review-bug-risk/);
  });

  it('prompt budget trims skills before dropping core rules', () => {
    const prompt = buildPrompt('清风', [{ from: '镇元子', content: '请做代码review并给出计划，然后实现' }], {
      promptMode: 'optimized',
      promptBudgetChars: 380,
      activeRoleProfile: {
        name: '清风',
        skills: ['planning', 'code-review', 'implementation'],
      },
      sessionSummary: { status: 'ok', details: 'x'.repeat(500) },
    });
    assert.match(prompt, /## 行为铁律/);
    assert.ok(!/Skill: coding-lite/.test(prompt) || !/Skill: planning/.test(prompt));
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
