const { spawn } = require('child_process');
const http = require('http');
const { AGENT_NAMES: VALID_AGENTS } = require('./lib/room');

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
let lastSyncWarnAt = 0;

if (!INVOCATION_ID || !CALLBACK_TOKEN) {
  console.error('[room-runners] missing ARENA_INVOCATION_ID or ARENA_CALLBACK_TOKEN');
  process.exit(1);
}

function requestJson(method, path, body, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_URL);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
      timeout,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${path} HTTP ${res.statusCode}: ${data}`));
        try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(new Error(`${path} parse: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`${path} timeout`)); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function postUsage(roomId, agent, usage) {
  await requestJson('POST', '/api/internal/usage', { roomId, agent, usage }, 5000).catch(() => {});
}

function parseUsageLine(line) {
  const m = line.match(/^\[(.+?) \((Codex|Claude)\)\]\s+(\{.*\})$/);
  if (!m) return null;
  const agent = m[1];
  if (!VALID_AGENTS.includes(agent)) return null;
  try {
    const obj = JSON.parse(m[3]);
    if (obj.type !== 'turn.completed' || !obj.usage) return null;
    return {
      agent,
      usage: {
        inputTokens: Number(obj.usage.input_tokens || obj.usage.inputTokens || 0),
        outputTokens: Number(obj.usage.output_tokens || obj.usage.outputTokens || 0),
        cachedInputTokens: Number(obj.usage.cached_input_tokens || obj.usage.cachedInputTokens || 0),
      },
    };
  } catch {
    return null;
  }
}

function attachRunnerOutput(child, roomId) {
  let outBuf = '';
  child.stdout.on('data', (d) => {
    outBuf += d.toString();
    const parts = outBuf.split('\n');
    outBuf = parts.pop();
    for (const line of parts) {
      process.stdout.write(`[runner:${roomId}] ${line}\n`);
      const parsed = parseUsageLine(line);
      if (parsed) postUsage(roomId, parsed.agent, parsed.usage).catch(() => {});
    }
  });
  child.stdout.on('end', () => {
    if (!outBuf) return;
    process.stdout.write(`[runner:${roomId}] ${outBuf}`);
    const parsed = parseUsageLine(outBuf);
    if (parsed) postUsage(roomId, parsed.agent, parsed.usage).catch(() => {});
  });
  child.stderr.on('data', (d) => process.stderr.write(`[runner:${roomId} err] ${d}`));
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
  attachRunnerOutput(child, roomId);
  child.on('exit', (code) => {
    RUNNERS.delete(roomId);
    console.log(`[room-runners] exited room=${roomId} code=${code}`);
    if (!shuttingDown) setTimeout(() => spawnRunner(roomId), 2000);
  });
}

function stopRunner(roomId) {
  const p = RUNNERS.get(roomId);
  if (!p) return;
  RUNNERS.delete(roomId);
  p.kill('SIGTERM');
}

async function syncRooms() {
  const data = await requestJson('GET', '/api/rooms', null, 12000);
  const rooms = Array.isArray(data.rooms) ? data.rooms : [];
  const roomIds = new Set([BOOTSTRAP_ROOM, 'default']);
  for (const r of rooms) {
    if (r && typeof r.roomId === 'string' && r.roomId) roomIds.add(r.roomId);
  }
  for (const roomId of roomIds) spawnRunner(roomId);
  for (const roomId of [...RUNNERS.keys()]) {
    if (!roomIds.has(roomId) && roomId !== 'default' && roomId !== BOOTSTRAP_ROOM) {
      stopRunner(roomId);
      console.log(`[room-runners] stopped deleted room=${roomId}`);
    }
  }
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
syncRooms().catch((e) => console.log('[room-runners] initial sync retrying:', e.message));
setInterval(() => {
  syncRooms().catch((e) => {
    const now = Date.now();
    if (now - lastSyncWarnAt > 60000) {
      lastSyncWarnAt = now;
      console.log('[room-runners] sync warning:', e.message);
    }
  });
}, ROOM_SYNC_MS);
