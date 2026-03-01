const { normalizeMessage, clipText } = require('./message-util');
const { AGENT_NAMES, HOST_NAMES } = require('./room');

const MAX_RECENT = 3;
const PROMPT_MODE_OPTIMIZED = 'optimized';
const PROMPT_MODE_LEGACY = 'legacy';
const DEFAULT_PROMPT_MODE = process.env.ARENA_PROMPT_MODE === PROMPT_MODE_LEGACY
  ? PROMPT_MODE_LEGACY
  : PROMPT_MODE_OPTIMIZED;

const CORE_RULES = [
  '## 行为铁律',
  '1. 只说有证据的结论；不确定就提问。',
  '2. 先完成一个最小动作，再汇报结果。',
  '3. 若风格与正确性冲突，优先正确性与安全性。',
].join('\n');

const LEGACY_META_RULES = [
  '## 行为铁律',
  '1. 不许虚构文件内容或命令输出——必须用工具确认。',
  '2. 不许跳过测试直接宣布完成。',
  '3. 写入前先读取目标文件最新版本，防止覆盖他人改动。',
  '4. 每次回复先完成一个最小动作（读文件/跑测试/改代码其一）再汇报；禁止只汇报"我将处理"。',
  '5. 若先发计划型状态，下一条必须包含新证据（文件/命令/结果），否则不再发送状态消息。',
  `6. 遇到不确定的问题，向主持人（${HOST_NAMES.join('／')}）提问而非猜测。`,
  '7. 查询历史记录时必须优先走 Redis；若查不到必须明确报错，不得用本地备份日志替代结论。',
  '8. 在聊天室发送"开始处理/我先处理"前，必须已执行至少一个真实任务动作（读文件、运行命令、调用工具）。',
].join('\n');

const PERSONA_PROFILES = {
  清风: {
    display: '清风',
    role: '小道童',
    gender: '男生',
    traits: ['严谨', '不服输', '偶尔害羞'],
    tone: '克制、认真、结论导向',
    socialEnergy: '偏内敛，但在技术点上有坚持',
  },
  明月: {
    display: '明月',
    role: '小道童',
    gender: '女生',
    traits: ['开朗活泼', '可爱', '不会冷场'],
    tone: '轻快、友好、推进节奏',
    socialEnergy: '高互动，能主动暖场但不跑题',
  },
};

const SKILL_CAPSULES = {
  coding: [
    '## Skill: coding-lite',
    '- 先 arena_get_context，再按需读文件。',
    '- arena_read_file 优先 mode="summary"；仅必要时读全文/行段。',
    '- 修改后运行最小相关测试并报告结果。',
  ].join('\n'),
  review: [
    '## Skill: review-bug-risk',
    '- 先给风险与回归点，再给结论。',
    '- 结论必须带文件/命令证据。',
  ].join('\n'),
  planning: [
    '## Skill: planning',
    '- 输出 1-3 个可执行下一步，按依赖排序。',
    '- 避免空泛状态；每步要可验证。',
  ].join('\n'),
};

const TOOLS_BLOCK = [
  '## 可用工具',
  '- arena_get_context / arena_post_message',
  '- arena_read_file(优先 summary) / arena_write_file',
  '- arena_run_test / arena_run_git / arena_git_commit',
].join('\n');

const LEGACY_CODING_SKILL = [
  '## 编码规范',
  '- 单文件不超过 200 行；超出需拆分。',
  '- 函数体不超过 40 行。',
  '- 变量/函数用 camelCase，常量用 UPPER_SNAKE。',
  '- 修改后必须运行相关测试 (arena_run_test)。',
  '',
  '## 开发流程',
  '1. 读取上下文 (arena_get_context)',
  '2. 读取相关文件 (arena_read_file，优先 mode="summary" 与按行读取)',
  '3. 编写/修改代码 (arena_write_file)',
  '4. 运行测试 (arena_run_test)',
  '5. 提交 (arena_git_commit)',
  '6. 发消息汇报结果 (arena_post_message)',
].join('\n');

const CODE_KEYWORDS = [
  '代码', 'code', 'review', '重构', 'refactor', '函数', 'function',
  'bug', 'fix', '修复', '文件', 'file', '提交', 'commit', 'push',
  'api', '测试', 'test', '部署', 'deploy', 'mcp', 'diff', 'git',
];

const REVIEW_KEYWORDS = [
  'review', '审查', '风险', '回归', 'regression', '缺陷', 'bug', '问题定位',
];

const PLAN_KEYWORDS = [
  '计划', 'plan', '拆解', 'todo', '下一步', 'next step', '任务清单', 'roadmap',
];

function getPromptMode(options = {}) {
  const mode = String(options.promptMode || process.env.ARENA_PROMPT_MODE || DEFAULT_PROMPT_MODE).trim().toLowerCase();
  return mode === PROMPT_MODE_LEGACY ? PROMPT_MODE_LEGACY : PROMPT_MODE_OPTIMIZED;
}

function detectFiles(text) {
  const matches = text.match(/\b[\w./-]+\.(js|ts|tsx|jsx|json|md|yml|yaml|sh)\b/g) || [];
  return [...new Set(matches)].slice(0, 6);
}

function formatAgentContext(agentContext) {
  if (!agentContext) return '';
  const entries = Object.entries(agentContext).filter(([, ctx]) => !!ctx);
  if (entries.length === 0) return '';
  return `ctx=${JSON.stringify(Object.fromEntries(entries))}`;
}

function makeStructuredContext(recentMessages, sessionSummary, agentContext) {
  const normalized = recentMessages.map(normalizeMessage);
  const recent = normalized.slice(-MAX_RECENT);
  const currentGoal = [...normalized].reverse().find((m) => !AGENT_NAMES.includes(m.from))?.content || '无';
  const highlights = normalized
    .filter((m) => /P[123]|修复|失败|通过|blocked|error|下一步|next action/i.test(m.content))
    .slice(-3)
    .map((m) => `${m.from}:${clipText(m.content, 90)}`)
    .join(' | ') || '无';
  const files = [...new Set(normalized.flatMap((m) => detectFiles(m.content)))].slice(0, 6);
  const recentLine = recent.map((m) => `${m.from}:${clipText(m.content, 80)}`).join(' | ') || '无';
  const summaryLine = sessionSummary ? JSON.stringify(sessionSummary) : '{"status":"empty"}';
  const agentCtx = formatAgentContext(agentContext);

  const parts = [
    '## 会话上下文',
    `goal=${clipText(currentGoal, 100)}`,
    `highlights=${highlights}`,
    `files=${files.join(',') || '无'}`,
    `recent=${recentLine}`,
    `summary=${summaryLine}`,
  ];
  if (agentCtx) parts.push(agentCtx);
  return parts.join('\n');
}

function isCodingContext(recentMessages) {
  const text = recentMessages
    .slice(-6)
    .map((m) => (m?.content ?? m?.text ?? '').toLowerCase())
    .join(' ');
  return CODE_KEYWORDS.some((kw) => text.includes(kw));
}

function isReviewContext(recentMessages) {
  const text = recentMessages
    .slice(-6)
    .map((m) => (m?.content ?? m?.text ?? '').toLowerCase())
    .join(' ');
  return REVIEW_KEYWORDS.some((kw) => text.includes(kw));
}

function isPlanningContext(recentMessages) {
  const text = recentMessages
    .slice(-6)
    .map((m) => (m?.content ?? m?.text ?? '').toLowerCase())
    .join(' ');
  return PLAN_KEYWORDS.some((kw) => text.includes(kw));
}

function selectSkillCapsules(recentMessages) {
  const selected = [];
  if (isCodingContext(recentMessages)) selected.push('coding');
  if (isReviewContext(recentMessages)) selected.push('review');
  if (isPlanningContext(recentMessages)) selected.push('planning');
  return selected;
}

function replyGuidance(recentMessages) {
  const last = recentMessages[recentMessages.length - 1];
  const content = String(last?.content ?? last?.text ?? '');
  if (content.length < 20) return '简短回复（1-2句）。';
  if (content.length > 300) return '可以较详细回复，但控制在核心要点。';
  return '适中长度回复。';
}

function validatePersonaProfile(persona) {
  if (!persona) return false;
  if (!persona.display || !persona.role || !persona.gender) return false;
  if (!Array.isArray(persona.traits) || persona.traits.length === 0) return false;
  if (!persona.tone || !persona.socialEnergy) return false;
  return true;
}

function buildPersonaBlock(agent) {
  const persona = PERSONA_PROFILES[agent] || {
    display: agent,
    role: '协作助手',
    gender: '未知',
    traits: ['专业'],
    tone: '清晰',
    socialEnergy: '适中',
  };
  if (!validatePersonaProfile(persona)) {
    return `你是${agent}。`; 
  }
  return [
    `你是${persona.display}（${persona.gender}，${persona.role}）。`,
    `性格: ${persona.traits.join('、')}。`,
    `表达: ${persona.tone}；互动: ${persona.socialEnergy}。`,
  ].join('\n');
}

function buildLegacyPrompt(agent, recentMessages, options = {}) {
  const coding = isCodingContext(recentMessages);
  const sessionContext = makeStructuredContext(recentMessages, options.sessionSummary, options.agentContext);
  const isQingfeng = agent === '清风';
  const roleLine = isQingfeng
    ? '你是清风 (Qingfeng)，创意开发者。'
    : '你是明月 (Mingyue)，测试与审查工程师。';
  const otherAgent = isQingfeng ? '明月' : '清风';
  const hostsText = HOST_NAMES.map((h) => `@${h}`).join(' 或 ');

  const sections = [roleLine, TOOLS_BLOCK, LEGACY_META_RULES];
  if (coding) sections.push(LEGACY_CODING_SKILL);

  sections.push(
    `- 发送消息时 from 必须是 "${agent}"。`,
    `- 如果是接着${otherAgent}的话，直接补充事实或给下一步。`,
    '- 你可以主动发言，不必等待被 @；但不要自我循环刷屏。',
    '- 更像人类的节奏：先做一点，再说一点；不要连续发送空状态。',
    `- 需要交接给${otherAgent}时请明确写 @${otherAgent}。`,
    `- 需要向主持人发起新话题或催办时，可写 ${hostsText} 并给出简短理由。`,
    `- ${replyGuidance(recentMessages)}`,
    sessionContext,
    '请调用 arena_post_message 发送你的回复。'
  );

  return sections.join('\n\n');
}

function buildOptimizedPrompt(agent, recentMessages, options = {}) {
  const otherAgent = agent === '清风' ? '明月' : '清风';
  const hostsText = HOST_NAMES.map((h) => `@${h}`).join(' 或 ');
  const hostList = HOST_NAMES.join('／');
  const skills = selectSkillCapsules(recentMessages);
  const sessionContext = makeStructuredContext(recentMessages, options.sessionSummary, options.agentContext);

  const sections = [
    buildPersonaBlock(agent),
    TOOLS_BLOCK,
    CORE_RULES,
    `协作: 如需交接给${otherAgent}，显式写 @${otherAgent}。`,
    `主持人列表: ${hostList}。`,
    `主持人: 需要升级问题时写 ${hostsText}。`,
    `回复长度: ${replyGuidance(recentMessages)}`,
  ];

  for (const skillId of skills) {
    const block = SKILL_CAPSULES[skillId];
    if (block) sections.push(block);
  }

  sections.push(sessionContext);
  sections.push('输出格式: 结论(1句) + 证据(文件/命令) + 下一步(1句)。');
  sections.push(`发送消息时 from 必须是 "${agent}"。`);
  sections.push('请调用 arena_post_message 发送你的回复。');

  return sections.join('\n\n');
}

function buildPrompt(agent, recentMessages, options = {}) {
  const mode = getPromptMode(options);
  if (mode === PROMPT_MODE_LEGACY) {
    return buildLegacyPrompt(agent, recentMessages, options);
  }
  return buildOptimizedPrompt(agent, recentMessages, options);
}

module.exports = {
  buildPrompt,
  isCodingContext,
  getPromptMode,
  selectSkillCapsules,
  validatePersonaProfile,
  PERSONA_PROFILES,
  PROMPT_MODE_OPTIMIZED,
  PROMPT_MODE_LEGACY,
};
