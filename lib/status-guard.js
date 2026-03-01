const store = require('./message-store');

function isEvidenceLikeText(text) {
  const s = String(text || '');
  if (!s) return false;
  const patterns = [
    /\b(node|npm|git|rg|curl|redis-cli|claude|codex)\b/i,
    /\b(pass|fail|通过|失败|报错|error|diff|line|行号|commit)\b/i,
    /\b\d+\s*\/\s*\d+\b/,
    /\b[\w./-]+\.(js|ts|tsx|jsx|json|md|yml|yaml|sh)\b/i,
    /`[^`]+`/,
  ];
  return patterns.some((re) => re.test(s));
}

function isStatusOnlyText(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  const statusRe = /(收到|在执行|处理中|开始处理|我会|我将|先处理|稍后回报|马上回报|我先)/i;
  return statusRe.test(s) && !isEvidenceLikeText(s);
}

function shouldBlockStatusLoop(roomId, agentName, content) {
  if (!store.isAgent(agentName)) return false;
  if (!isStatusOnlyText(content)) return false;
  const list = store.getRecentMessages(roomId, 8);
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (String(m.type || 'chat') !== 'chat') continue;
    if (String(m.from || '') !== agentName) break;
    if (isStatusOnlyText(m.content || m.text || '')) return true;
    break;
  }
  return false;
}

module.exports = {
  shouldBlockStatusLoop,
};
