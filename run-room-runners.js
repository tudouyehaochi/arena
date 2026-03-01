const { spawn } = require('child_process');
const http = require('http');

const API_URL = process.env.ARENA_API_URL || 'http://localhost:3000';
const INVOCATION_ID = process.env.ARENA_INVOCATION_ID;
const CALLBACK_TOKEN = process.env.ARENA_CALLBACK_TOKEN;
const RUNTIME_ENV = process.env.ARENA_ENVIRONMENT || 'dev';
const INSTANCE_ID = process.env.ARENA_INSTANCE_ID || '';
const BOOTSTRAP_ROOM = process.env.ARENA_ROOM_ID || 'default';
const ROOM_SYNC_MS = parseInt(process.env.ARENA_ROOM_SYNC_MS || '4000', 10);
const AUTH_HEADER = `Bearer ${INVOCATION_ID}:${CALLBACK_TOKEN}`;
const RUNNERS = new Map();
let shuttingDown = false;

if (!INVOCATION_ID || !CALLBACK_TOKEN) {
  console.error('[room-runners] missing ARENA_INVOCATION_ID or ARENA_CALLBACK_TOKEN');
  process.exit(1);
}

function httpGetRooms() {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/rooms', API_URL);
    const req = http.get({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { Authorization: AUTH_HEADER },
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`rooms HTTP ${res.statusCode}: ${data}`));
        try {
          const parsed = JSON.parse(data || '{}');
          resolve(Array.isArray(parsed.rooms) ? parsed.rooms : []);
        } catch (e) {
          reject(new Error(`rooms parse: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('rooms timeout')); });
  });
}

function spawnRunner(roomId) {
  if (RUNNERS.has(roomId) || shuttingDown) return;
  const child = spawn('node', ['run-arena.js'], {
    env: {
      ...process.env,
      ARENA_API_URL: API_URL,
      ARENA_INVOCATION_ID: INVOCATION_ID,
      ARENA_CALLBACK_TOKEN: CALLBACK_TOKEN,
      ARENA_ENVIRONMENT: RUNTIME_ENV,
      ARENA_INSTANCE_ID: INSTANCE_ID,
      ARENA_ROOM_ID: roomId,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  RUNNERS.set(roomId, child);
  console.log(`[room-runners] started room=${roomId}`);
  child.stdout.on('data', (d) => process.stdout.write(`[runner:${roomId}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[runner:${roomId} err] ${d}`));
  child.on('exit', (code) => {
    RUNNERS.delete(roomId);
    console.log(`[room-runners] exited room=${roomId} code=${code}`);
    if (!shuttingDown) setTimeout(() => spawnRunner(roomId), 2000);
  });
}

async function syncRooms() {
  const rooms = await httpGetRooms();
  const roomIds = new Set([BOOTSTRAP_ROOM, 'default']);
  for (const r of rooms) {
    if (r && typeof r.roomId === 'string' && r.roomId) roomIds.add(r.roomId);
  }
  for (const roomId of roomIds) spawnRunner(roomId);
}

async function shutdown() {
  shuttingDown = true;
  for (const p of RUNNERS.values()) p.kill('SIGTERM');
  setTimeout(() => {
    for (const p of RUNNERS.values()) {
      if (!p.killed) p.kill('SIGKILL');
    }
    process.exit(0);
  }, 1200);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[room-runners] API=${API_URL} bootstrapRoom=${BOOTSTRAP_ROOM} sync=${ROOM_SYNC_MS}ms`);
syncRooms().catch((e) => console.error('[room-runners] initial sync failed:', e.message));
setInterval(() => {
  syncRooms().catch((e) => console.error('[room-runners] sync failed:', e.message));
}, ROOM_SYNC_MS).unref();
