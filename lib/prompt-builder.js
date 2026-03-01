const { normalizeMessage, clipText } = require('./message-util');
const { AGENT_NAMES } = require('./room');

const MAX_RECENT = 4;

const META_RULES = [
  '## 行为铁律',
  '1. 不许虚构文件内容或命令输出——必须用工具确认。',
  '2. 不许跳过测试直接宣布完成。',
  '3. 写入前先读取目标文件最新版本，防止覆盖他人改动。',
  '4. 每次回复先完成一个最小动作（读文件/跑测试/改代码其一）再汇报；禁止只汇报“我将处理”。',
  '5. 若先发计划型状态，下一条必须包含新证据（文件/命令/结果），否则不再发送状态消息。',
  '6. 遇到不确定的问题，向镇元子提问而非猜测。',
  '7. 查询历史记录时必须优先走 Redis；若查不到必须明确报错，不得用本地备份日志替代结论。',
  '8. 在聊天室发送“开始处理/我先处理”前，必须已执行至少一个真实任务动作（读文件、运行命令、调用工具）。',
].join('\n');

const CODING_SKILL = [
  '## 编码规范',
  '- 单文件不超过 200 行；超出需拆分。',
  '- 函数体不超过 40 行。',
  '- 变量/函数用 camelCase，常量用 UPPER_SNAKE。',
  '- 修改后必须运行相关测试 (arena_run_test)。',
  '',
  '## 开发流程',
  '1. 读取上下文 (arena_get_context)',
  '2. 读取相关文件 (arena_read_file)',
  '3. 编写/修改代码 (arena_write_file)',
  '4. 运行测试 (arena_run_test)',
  '5. 提交 (arena_git_commit)',
  '6. 发消息汇报结果 (arena_post_message)',
].join('\n');

const TOOLS_BLOCK = [
  '## 可用工具',
  '- arena_get_context：返回结构化上下文摘要',
  '- arena_post_message：发送消息',
  '- arena_read_file：默认返回全文，mode="summary"返回摘要，支持行段读取',
  '- arena_set_context：更新你的结构化状态，让伙伴看到你在做什么',
  '- arena_write_file / arena_git_commit / arena_run_test',
].join('\n');

const CODE_KEYWORDS = [
  '代码', 'code', 'review', '重构', 'refactor', '函数', 'function',
  'bug', 'fix', '修复', '文件', 'file', '提交', 'commit', 'push',
  'api', '测试', 'test', '部署', 'deploy', 'mcp', 'diff', 'git',
];

function detectFiles(text) {
  const matches = text.match(/\b[\w./-]+\.(js|ts|tsx|jsx|json|md|yml|yaml|sh)\b/g) || [];
  return [...new Set(matches)].slice(0, 6);
}

function formatAgentContext(agentContext) {
  if (!agentContext) return '';
  const lines = ['- 伙伴状态:'];
  for (const [agent, ctx] of Object.entries(agentContext)) {
    if (ctx) {
      lines.push(`  ${agent}: ${JSON.stringify(ctx)}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

function makeStructuredContext(recentMessages, sessionSummary, agentContext) {
  const normalized = recentMessages.map(normalizeMessage);
  const recent = normalized.slice(-MAX_RECENT);
  const currentGoal = [...normalized].reverse().find(m => !AGENT_NAMES.includes(m.from))?.content || '无';
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

  const agentCtxLine = formatAgentContext(agentContext);
  const sections = [
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
  ];
  if (agentCtxLine) sections.push(agentCtxLine);
  return sections.join('\n');
}

function isCodingContext(recentMessages) {
  const text = recentMessages
    .slice(-6)
    .map(m => (m?.content ?? m?.text ?? '').toLowerCase())
    .join(' ');
  return CODE_KEYWORDS.some(kw => text.includes(kw));
}

function replyGuidance(recentMessages) {
  const last = recentMessages[recentMessages.length - 1];
  const content = String(last?.content ?? last?.text ?? '');
  if (content.length < 20) return '简短回复（1-2句）。';
  if (content.length > 300) return '可以较详细回复，但控制在核心要点。';
  return '适中长度回复。';
}

function buildPrompt(agent, recentMessages, options = {}) {
  const coding = isCodingContext(recentMessages);
  const sessionContext = makeStructuredContext(recentMessages, options.sessionSummary, options.agentContext);
  const isQingfeng = agent === '清风';
  const roleLine = isQingfeng
    ? '你是清风 (Qingfeng)，创意开发者。'
    : '你是明月 (Mingyue)，测试与审查工程师。';
  const otherAgent = isQingfeng ? '明月' : '清风';

  const sections = [
    roleLine,
    TOOLS_BLOCK,
    META_RULES,
  ];

  if (coding) {
    sections.push(CODING_SKILL);
  }

  sections.push(
    `- 发送消息时 from 必须是 "${agent}"。`,
    `- 如果是接着${otherAgent}的话，直接补充事实或给下一步。`,
    '- 你可以主动发言，不必等待被 @；但不要自我循环刷屏。',
    '- 更像人类的节奏：先做一点，再说一点；不要连续发送空状态。',
    `- 需要交接给${otherAgent}时请明确写 @${otherAgent}。`,
    '- 需要向主持人发起新话题或催办时，可写 @镇元子 并给出简短理由。',
    `- ${replyGuidance(recentMessages)}`,
    sessionContext,
    '请调用 arena_post_message 发送你的回复。',
  );

  return sections.join('\n\n');
}

module.exports = { buildPrompt, isCodingContext };
