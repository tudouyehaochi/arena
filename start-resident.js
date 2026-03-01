#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { currentBranch } = require('./lib/env');
const { inferEnvironment, resolvePort, resolveApiUrl } = require('./lib/runtime-config');

const SERVER_CMD = process.env.ARENA_SERVER_CMD || 'node';
const SERVER_ARGS = process.env.ARENA_SERVER_ARGS ? process.env.ARENA_SERVER_ARGS.split(' ') : ['server.js'];
const RUNNER_CMD = process.env.ARENA_RUNNER_CMD || 'node';
const RUNNER_ARGS = process.env.ARENA_RUNNER_ARGS ? process.env.ARENA_RUNNER_ARGS.split(' ') : ['run-room-runners.js'];

let redisProc = null;
let serverProc = null;
let runnerProc = null;
let shuttingDown = false;
let redisRestarts = 0;
const REDIS_MAX_RESTARTS = 5;
const REDIS_RESTART_WINDOW_MS = 60000;
let redisFirstFailAt = 0;
let invocationId = '';
let callbackToken = '';
const CRED_FILE = path.join(os.tmpdir(), `arena-creds-${process.pid}.json`);
const cli = parseArgs(process.argv.slice(2));
const branch = currentBranch();
const runtimeEnv = inferEnvironment(cli.env);
const runtimePort = resolvePort({ port: cli.port, environment: runtimeEnv, branch });
const runtimeApiUrl = resolveApiUrl({ apiUrl: cli.apiUrl, port: runtimePort });
const runtimeInstanceId = `${runtimeEnv}:${branch}:${runtimePort}`;
const runtimeRoomId = cli.roomId || process.env.ARENA_ROOM_ID || 'default';
const redisPort = runtimeEnv === 'prod' ? 6380 : 6379;
const LOCK_FILE = path.join(os.tmpdir(), `arena-resident-${runtimePort}.lock`);

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  try {
    const existing = fs.readFileSync(LOCK_FILE, 'utf8');
    const lock = JSON.parse(existing);
    if (isPidRunning(lock.pid)) {
      throw new Error(`port ${runtimePort} already owned by pid ${lock.pid}`);
    }
  } catch (e) {
    if (!String(e.message || '').includes('ENOENT')) {
      throw e;
    }
  }
  const content = {
    pid: process.pid,
    port: runtimePort,
    branch,
    env: runtimeEnv,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(LOCK_FILE, `${JSON.stringify(content)}\n`, 'utf8');
}

function log(msg) {
  process.stdout.write(`[resident] ${msg}\n`);
}

function parseArgs(args) {
  const out = { env: '', port: '', apiUrl: '', roomId: '' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--env' && args[i + 1]) out.env = args[++i];
    else if (a === '--port' && args[i + 1]) out.port = args[++i];
    else if (a === '--api-url' && args[i + 1]) out.apiUrl = args[++i];
    else if (a === '--room-id' && args[i + 1]) out.roomId = args[++i];
  }
  return out;
}

function spawnRedis() {
  const confFile = path.join(__dirname, 'redis', `redis-${runtimeEnv}.conf`);
  if (!fs.existsSync(confFile)) {
    log(`redis config not found: ${confFile}, skipping managed redis`);
    return;
  }
  log(`starting redis-server (${runtimeEnv}, port ${redisPort})`);
  redisProc = spawn('redis-server', [confFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  redisProc.stdout.on('data', (d) => process.stdout.write(`[redis] ${d}`));
  redisProc.stderr.on('data', (d) => process.stderr.write(`[redis err] ${d}`));
  redisProc.on('exit', (code) => {
    log(`redis exited with code ${code}`);
    redisProc = null;
    if (shuttingDown) return;
    const now = Date.now();
    if (now - redisFirstFailAt > REDIS_RESTART_WINDOW_MS) {
      redisRestarts = 0;
      redisFirstFailAt = now;
    }
    redisRestarts++;
    if (redisRestarts > REDIS_MAX_RESTARTS) {
      log(`redis crashed ${redisRestarts} times in ${REDIS_RESTART_WINDOW_MS / 1000}s, giving up`);
      shutdown();
      return;
    }
    const delay = Math.min(redisRestarts * 1000, 5000);
    log(`redis restart ${redisRestarts}/${REDIS_MAX_RESTARTS}, retrying in ${delay}ms...`);
    setTimeout(async () => {
      if (shuttingDown) return;
      spawnRedis();
      try {
        await waitForRedis(redisPort);
        log(`redis recovered on port ${redisPort}`);
      } catch (e) {
        log(`redis restart failed: ${e.message}`);
        shutdown();
      }
    }, delay);
  });
}

function waitForRedis(port, timeoutMs = 5000) {
  const net = require('net');
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryConnect() {
      const sock = net.createConnection(port, '127.0.0.1');
      sock.on('connect', () => { sock.destroy(); resolve(); });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`redis not ready on port ${port} after ${timeoutMs}ms`));
        } else {
          setTimeout(tryConnect, 100);
        }
      });
    }
    tryConnect();
  });
}

function spawnServer() {
  log(`starting server: ${SERVER_CMD} ${SERVER_ARGS.join(' ')}`);
  log(`runtime env=${runtimeEnv} branch=${branch} port=${runtimePort} api=${runtimeApiUrl} instance=${runtimeInstanceId} room=${runtimeRoomId}`);
  serverProc = spawn(SERVER_CMD, SERVER_ARGS, {
    env: {
      ...process.env,
      PORT: String(runtimePort),
      ARENA_ENVIRONMENT: runtimeEnv,
      ARENA_INSTANCE_ID: runtimeInstanceId,
      ARENA_ROOM_ID: runtimeRoomId,
      ARENA_CREDENTIALS_FILE: CRED_FILE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc.stdout.on('data', (d) => {
    const text = d.toString();
    process.stdout.write(`[server] ${text}`);
    if (!invocationId || !callbackToken) {
      try {
        const file = fs.readFileSync(CRED_FILE, 'utf8');
        const cred = JSON.parse(file);
        invocationId = cred.invocationId || invocationId;
        callbackToken = cred.callbackToken || callbackToken;
      } catch {}
    }
    if (!invocationId || !callbackToken) {
      const inv = text.match(/ARENA_INVOCATION_ID=([a-zA-Z0-9-]+)/);
      const tok = text.match(/ARENA_CALLBACK_TOKEN=([a-zA-Z0-9-]+)/);
      if (inv) invocationId = inv[1];
      if (tok) callbackToken = tok[1];
    }
    if (!runnerProc && invocationId && callbackToken) spawnRunner();
  });
  serverProc.stderr.on('data', (d) => process.stderr.write(`[server err] ${d}`));
  serverProc.on('exit', (code) => {
    log(`server exited with code ${code}`);
    if (!shuttingDown && runnerProc) {
      runnerProc.kill('SIGTERM');
      runnerProc = null;
    }
    if (!shuttingDown) process.exit(code || 1);
  });
}

function spawnRunner() {
  const env = {
    ...process.env,
    ARENA_API_URL: runtimeApiUrl,
    ARENA_ENVIRONMENT: runtimeEnv,
    ARENA_INSTANCE_ID: runtimeInstanceId,
    ARENA_ROOM_ID: runtimeRoomId,
    ARENA_INVOCATION_ID: invocationId,
    ARENA_CALLBACK_TOKEN: callbackToken,
  };
  log(`starting runner-manager: ${RUNNER_CMD} ${RUNNER_ARGS.join(' ')}`);
  runnerProc = spawn(RUNNER_CMD, RUNNER_ARGS, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  runnerProc.stdout.on('data', (d) => process.stdout.write(`[runner] ${d}`));
  runnerProc.stderr.on('data', (d) => process.stderr.write(`[runner err] ${d}`));
  runnerProc.on('exit', (code) => {
    log(`runner exited with code ${code}`);
    if (!shuttingDown) process.exit(code || 1);
  });
}

function shutdown() {
  shuttingDown = true;
  log('shutting down resident stack...');
  if (runnerProc) runnerProc.kill('SIGTERM');
  if (serverProc) serverProc.kill('SIGTERM');
  if (redisProc) redisProc.kill('SIGTERM');
  setTimeout(() => {
    if (runnerProc && !runnerProc.killed) runnerProc.kill('SIGKILL');
    if (serverProc && !serverProc.killed) serverProc.kill('SIGKILL');
    if (redisProc && !redisProc.killed) redisProc.kill('SIGKILL');
    try { fs.unlinkSync(CRED_FILE); } catch {}
    try { fs.unlinkSync(LOCK_FILE); } catch {}
    process.exit(0);
  }, 1200);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch {} });

try {
  acquireLock();
} catch (e) {
  log(`failed to start: ${e.message}`);
  process.exit(1);
}

(async () => {
  spawnRedis();
  if (redisProc) {
    try {
      await waitForRedis(redisPort);
      log(`redis ready on port ${redisPort}`);
    } catch (e) {
      log(`${e.message}`);
      process.exit(1);
    }
  }
  spawnServer();
})();
