const fs = require('fs');

function parseLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function pruneRoomFromLog(logFile, roomId) {
  if (!logFile) return;
  try {
    const out = [];
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const msg = parseLine(line);
      if (!msg) continue;
      if (String(msg.roomId || '') === roomId) continue;
      out.push(JSON.stringify(msg));
    }
    fs.writeFileSync(logFile, `${out.join('\n')}${out.length ? '\n' : ''}`, 'utf8');
  } catch {}
}

module.exports = { pruneRoomFromLog };
