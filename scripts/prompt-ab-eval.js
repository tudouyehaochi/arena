#!/usr/bin/env node
const { buildPrompt } = require('../lib/prompt-builder');

const scenarios = [
  {
    name: 'coding-fix',
    agent: '清风',
    messages: [{ from: '镇元子', content: '请 review server.js 并修复一个 bug，然后跑测试' }],
  },
  {
    name: 'review-risk',
    agent: '明月',
    messages: [{ from: '镇元子', content: '帮我做代码审查，列出回归风险和测试建议' }],
  },
  {
    name: 'planning',
    agent: '明月',
    messages: [{ from: '镇元子', content: '给我一个三步实施计划，按依赖顺序' }],
  },
  {
    name: 'small-talk',
    agent: '清风',
    messages: [{ from: '镇元子', content: '你好呀，今天状态如何' }],
  },
];

function qualityChecks(prompt) {
  return {
    hasSafety: /正确性与安全|有证据|不确定就提问/.test(prompt),
    hasToolAction: /arena_post_message/.test(prompt),
    hasOutputShape: /结论\(1句\) \+ 证据\(文件\/命令\) \+ 下一步\(1句\)/.test(prompt),
  };
}

const rows = scenarios.map((s) => {
  const legacy = buildPrompt(s.agent, s.messages, { promptMode: 'legacy' });
  const optimized = buildPrompt(s.agent, s.messages, { promptMode: 'optimized' });
  const delta = optimized.length - legacy.length;
  return {
    scenario: s.name,
    agent: s.agent,
    legacyChars: legacy.length,
    optimizedChars: optimized.length,
    deltaChars: delta,
    deltaPct: Math.round((delta / legacy.length) * 10000) / 100,
    checks: qualityChecks(optimized),
  };
});

const avgLegacy = Math.round(rows.reduce((a, r) => a + r.legacyChars, 0) / rows.length);
const avgOptimized = Math.round(rows.reduce((a, r) => a + r.optimizedChars, 0) / rows.length);
const summary = {
  scenarios: rows,
  average: {
    legacyChars: avgLegacy,
    optimizedChars: avgOptimized,
    deltaChars: avgOptimized - avgLegacy,
    deltaPct: Math.round(((avgOptimized - avgLegacy) / avgLegacy) * 10000) / 100,
  },
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
