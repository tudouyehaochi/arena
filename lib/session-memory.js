const fs = require('fs');
const path = require('path');
const { normalizeMessage } = require('./message-util');
const redis = require('./redis-client');

const SUMMARY_PATH = path.join(__dirname, '..', 'session-summary.json');
const SUMMARY_KEY = 'arena:session:summary';
const MAX_ITEMS = 8;

function safeParseJSON(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function loadSummary() {
  return redis.withFallback(
    async () => {
      const val = await redis.getClient().get(SUMMARY_KEY);
      if (val) return safeParseJSON(val, null);
      // Fallback to file if Redis has no data
      try {
        const raw = fs.readFileSync(SUMMARY_PATH, 'utf8');
        return safeParseJSON(raw, null);
      } catch {
        return null;
      }
    },
    () => {
      try {
        const raw = fs.readFileSync(SUMMARY_PATH, 'utf8');
        return safeParseJSON(raw, null);
      } catch {
        return null;
      }
    },
  );
}

function pickUnique(items) {
  return [...new Set(items.filter(Boolean))].slice(0, MAX_ITEMS);
}

function summarizeMessages(messages) {
  const normalized = messages.map(normalizeMessage);
  const userMsgs = normalized.filter(m => !['清风', '明月'].includes(m.from));
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

  return {
    updatedAt: new Date().toISOString(),
    currentGoal: lastUser ? lastUser.content.slice(0, 200) : '',
    changedFiles,
    decisions,
    openIssues,
    nextActions,
  };
}

async function saveSummary(summary) {
  // Always write to file
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  // Also write to Redis
  await redis.withFallback(
    () => redis.getClient().set(SUMMARY_KEY, JSON.stringify(summary)),
    () => {},
  );
}

module.exports = {
  loadSummary,
  saveSummary,
  summarizeMessages,
  SUMMARY_PATH,
};
