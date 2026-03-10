const fs = require('fs');
const path = require('path');
const { normalizeMessage } = require('./message-util');
const redis = require('./redis-client');
const agentRegistry = require('./agent-registry');
const { AGENT_NAMES } = require('./room');

const SUMMARY_PATH = path.join(__dirname, '..', 'session-summary.json');
const SUMMARY_KEY = 'arena:session:summary';
const MAX_ITEMS = 8;
const DEFAULT_TOP_K = 5;

function safeParseJSON(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function loadSummary(summaryPath = SUMMARY_PATH, redisKey = SUMMARY_KEY) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  const val = await redis.getClient().get(redisKey);
  if (!val) return null;
  return safeParseJSON(val, null);
}

function pickUnique(items) {
  return [...new Set(items.filter(Boolean))].slice(0, MAX_ITEMS);
}

function scoreMemoryCandidate(text) {
  const t = String(text || '');
  let score = 0;
  if (/\b(error|failed|failure|bug|阻塞|失败|修复|通过)\b/i.test(t)) score += 4;
  if (/\b(js|ts|tsx|jsx|json|md|sh)\b/i.test(t)) score += 2;
  if (/[0-9]/.test(t)) score += 1;
  score += Math.min(3, Math.floor(t.length / 60));
  return score;
}

function rankMemoryCandidates(items, topK = DEFAULT_TOP_K) {
  return (items || [])
    .map((item) => ({ item, score: scoreMemoryCandidate(item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Number(topK || DEFAULT_TOP_K)))
    .map((r) => r.item);
}

function summarizeMessages(messages, options = {}) {
  const topK = Math.max(1, Number.parseInt(String(options.topK || DEFAULT_TOP_K), 10) || DEFAULT_TOP_K);
  const normalized = messages.map(normalizeMessage);
  const userMsgs = normalized.filter((m) => {
    const from = String(m.from || '');
    return !agentRegistry.isAgentName(from) && !AGENT_NAMES.includes(from);
  });
  const lastUser = userMsgs[userMsgs.length - 1];
  const changedFiles = pickUnique(
    normalized.flatMap(m => m.content.match(/\b[\w./-]+\.(js|ts|tsx|jsx|json|md|sh)\b/g) || [])
  );
  const decisions = pickUnique(
    normalized
      .filter(m => /决定|采用|方案|将会|改为|use|switch|migrate/i.test(m.content))
      .map(m => `${m.from}: ${m.content.slice(0, 120)}`)
  );
  const openIssues = pickUnique(
    normalized
      .filter(m => /P1|P2|未通过|失败|error|bug|block|阻塞/i.test(m.content))
      .map(m => `${m.from}: ${m.content.slice(0, 120)}`)
  );
  const nextActions = pickUnique(
    normalized
      .filter(m => /下一步|next action|请修复|复测|todo|待办|计划/i.test(m.content))
      .map(m => `${m.from}: ${m.content.slice(0, 120)}`)
  );
  const retrievalCandidates = rankMemoryCandidates(
    pickUnique([...decisions, ...openIssues, ...nextActions]),
    topK,
  );

  return {
    updatedAt: new Date().toISOString(),
    currentGoal: lastUser ? lastUser.content.slice(0, 200) : '',
    changedFiles,
    decisions,
    openIssues,
    nextActions,
    retrievalCandidates,
    retrievalCount: retrievalCandidates.length,
  };
}

async function saveSummary(summary, summaryPath = SUMMARY_PATH, redisKey = SUMMARY_KEY) {
  if (!redis.isReady()) throw new Error('redis_unavailable');
  // Keep local file as debug artifact only.
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await redis.getClient().set(redisKey, JSON.stringify(summary));
}

module.exports = {
  loadSummary,
  saveSummary,
  summarizeMessages,
  scoreMemoryCandidate,
  rankMemoryCandidates,
  SUMMARY_PATH,
};
