const fs = require('fs');

function parseLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function listRoomsFromLog(logFile) {
  if (!logFile) return [];
  try {
    const ids = new Set();
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const msg = parseLine(line);
      const roomId = String(msg?.roomId || '').trim();
      if (roomId) ids.add(roomId);
    }
    return [...ids].sort().map((roomId) => ({ roomId, title: roomId }));
  } catch {
    return [];
  }
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

module.exports = { listRoomsFromLog, pruneRoomFromLog };
