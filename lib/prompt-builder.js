const SKILL_REF = process.env.ARENA_SKILL_REF || 'SKILL:arena-coding-v1';
const MAX_RECENT = 4;
const MAX_EXCERPT = 180;
const DEFAULT_USER_NAME = process.env.ARENA_DEFAULT_USER || '镇元子';

const MIN_RULES = [
  '## 对话规则（最小集）',
  '- 优先给结论和行动，不写客套。',
  '- 仅在必要时读取代码全文，先读摘要再按需展开。',
  '- 被@提及时优先回应该请求。',
  '- 代码观点必须基于真实源码与命令结果。',
].join('\n');

const TOOLS_BLOCK = [
  '## 可用工具',
  '- arena_get_context：返回结构化上下文摘要',
  '- arena_post_message：发送消息',
  '- arena_read_file：默认返回文件摘要，可按行段展开',
  '- arena_write_file / arena_git_commit / arena_run_test',
].join('\n');

const CODE_KEYWORDS = [
  '代码', 'code', 'review', '重构', 'refactor', '函数', 'function',
  'bug', 'fix', '修复', '文件', 'file', '提交', 'commit', 'push',
  'api', '测试', 'test', '部署', 'deploy', 'mcp', 'diff', 'git',
];

function normalizeMessage(msg) {
  const from = msg?.from || DEFAULT_USER_NAME;
  const content = String(msg?.content ?? msg?.text ?? '').trim();
  return { from, content };
}

function clipText(text, max = MAX_EXCERPT) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function detectFiles(text) {
  const matches = text.match(/\b[\w./-]+\.(js|ts|tsx|jsx|json|md|yml|yaml|sh)\b/g) || [];
  return [...new Set(matches)].slice(0, 6);
}

function makeStructuredContext(recentMessages, sessionSummary) {
  const normalized = recentMessages.map(normalizeMessage);
  const recent = normalized.slice(-MAX_RECENT);
  const currentGoal = [...normalized].reverse().find(m => !['清风', '明月'].includes(m.from))?.content || '无';
  const highlights = normalized
    .filter(m => /P[123]|修复|失败|通过|blocked|error|下一步|next action/i.test(m.content))
    .slice(-4)
    .map(m => `- [${m.from}] ${clipText(m.content, 150)}`)
    .join('\n') || '- 无';
  const files = [...new Set(normalized.flatMap(m => detectFiles(m.content)))].slice(0, 8);
  const fileLine = files.length ? files.map(f => `- ${f}`).join('\n') : '- 无';
  const recentLine = recent.map(m => `- [${m.from}] ${clipText(m.content)}`).join('\n') || '- 无';
  const summaryLine = sessionSummary
    ? JSON.stringify(sessionSummary, null, 2)
    : '{"status":"empty"}';

  return [
    '## 会话结构化上下文',
    `- 当前目标: ${clipText(currentGoal, 180)}`,
    '- 关键进展:',
    highlights,
    '- 关键文件:',
    fileLine,
    '- 最近消息摘录:',
    recentLine,
    '- 历史摘要记忆(session-summary.json):',
    '```json',
    summaryLine,
    '```',
  ].join('\n');
}

function isCodingContext(recentMessages) {
  const text = recentMessages
    .slice(-6)
    .map(m => (m?.content ?? m?.text ?? '').toLowerCase())
    .join(' ');
  return CODE_KEYWORDS.some(kw => text.includes(kw));
}

function buildPrompt(agent, recentMessages, options = {}) {
  const coding = isCodingContext(recentMessages);
  const skillLine = coding
    ? `## 规则来源\n- 使用最小规则集 + 外部技能引用: ${SKILL_REF}`
    : '## 规则来源\n- 普通聊天模式，保持简洁。';
  const sessionContext = makeStructuredContext(recentMessages, options.sessionSummary);
  const isQingfeng = agent === '清风';
  const roleLine = isQingfeng
    ? '你是清风 (Qingfeng)，创意开发者。'
    : '你是明月 (Mingyue)，测试与审查工程师。';
  const otherAgent = isQingfeng ? '明月' : '清风';

  return [
    roleLine,
    TOOLS_BLOCK,
    MIN_RULES,
    skillLine,
    `- 发送消息时 from 必须是 "${agent}"。`,
    `- 如果是接着${otherAgent}的话，直接补充事实或给下一步。`,
    sessionContext,
    '请调用 arena_post_message 发送你的回复。',
  ].join('\n\n');
}

module.exports = { buildPrompt, isCodingContext, normalizeMessage };
