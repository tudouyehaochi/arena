const fs = require('fs');
const path = require('path');
const os = require('os');

function parseLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function pruneRoomFromLog(logFile, roomId) {
  if (!logFile) return;
  if (!fs.existsSync(logFile)) return;
  const out = [];
  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    const msg = parseLine(line);
    if (!msg) continue;
    if (String(msg.roomId || '') === roomId) continue;
    out.push(JSON.stringify(msg));
  }
  const tmpFile = path.join(path.dirname(logFile), `.chatroom.log.tmp.${process.pid}`);
  fs.writeFileSync(tmpFile, `${out.join('\n')}${out.length ? '\n' : ''}`, 'utf8');
  fs.renameSync(tmpFile, logFile);
}

module.exports = { pruneRoomFromLog };
