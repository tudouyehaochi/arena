const fs = require('fs');
const path = require('path');
const { normalizeMessage, clipText } = require('./message-util');

const LOG_FILE = path.join(__dirname, '..', 'chatroom.log');

// --- In-memory message store with monotonic cursor ---
const messages = [];
let messageSeq = 0; // monotonic cursor, increments per message
const DEFAULT_USER_NAME = process.env.ARENA_DEFAULT_USER || '镇元子';

// Agent turn tracking (global for now; TODO: per-thread if multi-room)
let consecutiveAgentTurns = 0;

const AGENT_NAMES = ['清风', '明月'];

function isAgent(from) {
  return AGENT_NAMES.includes(from);
}

// Load existing messages from log on startup
function loadFromLog() {
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        messageSeq++;
        msg.seq = messageSeq;
        messages.push(msg);
      } catch {}
    }
    console.log(`Loaded ${messages.length} messages from log`);
  } catch {}

  // Restore consecutiveAgentTurns from tail of messages
  consecutiveAgentTurns = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!isAgent(messages[i].from)) break;
    consecutiveAgentTurns++;
  }
  if (consecutiveAgentTurns > 0) {
    console.log(`Restored consecutiveAgentTurns: ${consecutiveAgentTurns}`);
  }
}

function appendLog(msg) {
  // Write without seq to keep log format clean
  const { seq, ...logMsg } = msg;
  fs.appendFileSync(LOG_FILE, JSON.stringify(logMsg) + '\n');
}

function addMessage(msg) {
  msg.from = msg.from || DEFAULT_USER_NAME;
  msg.content = String(msg.content ?? msg.text ?? '').trim();
  if (!msg.content && msg.type === 'chat') msg.content = '(empty)';
  messageSeq++;
  msg.seq = messageSeq;
  msg.timestamp = msg.timestamp || Date.now();
  msg.type = msg.type || 'chat';
  messages.push(msg);
  appendLog(msg);

  if (isAgent(msg.from)) {
    consecutiveAgentTurns++;
  } else {
    consecutiveAgentTurns = 0;
  }

  return msg;
}

function getMessages() {
  return messages;
}

function getRecentMessages(count = 50) {
  return messages.slice(-count);
}

function getMessagesSince(cursor) {
  if (!cursor || cursor <= 0) return messages.slice(-50);
  return messages.filter(m => m.seq > cursor);
}

/** Atomic snapshot: status + messages + cursor in one call */
function getSnapshot(sinceCursor) {
  const newMessages = sinceCursor ? getMessagesSince(sinceCursor) : getRecentMessages(50);
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

  let lastHumanMsgSeq = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!isAgent(messages[i].from)) {
      lastHumanMsgSeq = messages[i].seq;
      break;
    }
  }

  return {
    cursor: messageSeq,
    consecutiveAgentTurns,
    lastHumanMsgSeq,
    lastMsgSeq: lastMsg ? lastMsg.seq : null,
    totalMessages: messages.length,
    messages: newMessages,
  };
}

function getAgentTurns() {
  return consecutiveAgentTurns;
}

function getSummarizedSnapshot(sinceCursor) {
  const snapshot = getSnapshot(sinceCursor);
  const normalized = (snapshot.messages || []).map(normalizeMessage);
  const recent = normalized.slice(-4).map(m => ({
    seq: m.seq,
    from: m.from,
    content: clipText(m.content, 180),
  }));
  const highlights = normalized
    .filter(m => /P1|P2|P3|error|失败|通过|修复|todo|下一步/i.test(m.content))
    .slice(-5)
    .map(m => `[${m.from}] ${m.content.slice(0, 120)}`);
  return {
    cursor: snapshot.cursor,
    consecutiveAgentTurns: snapshot.consecutiveAgentTurns,
    totalMessages: snapshot.totalMessages,
    highlights,
    recent,
    messages: recent,
  };
}

module.exports = {
  loadFromLog,
  addMessage,
  getMessages,
  getRecentMessages,
  getMessagesSince,
  getSnapshot,
  getAgentTurns,
  getSummarizedSnapshot,
  isAgent,
};
