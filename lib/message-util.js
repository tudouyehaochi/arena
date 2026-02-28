const DEFAULT_USER_NAME = process.env.ARENA_DEFAULT_USER || '镇元子';

function normalizeMessage(msg) {
  return {
    from: msg?.from || DEFAULT_USER_NAME,
    content: String(msg?.content ?? msg?.text ?? '').trim(),
    seq: msg?.seq || null,
    timestamp: msg?.timestamp || null,
  };
}

function clipText(text, max = 180) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

module.exports = { normalizeMessage, clipText, DEFAULT_USER_NAME };
