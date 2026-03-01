const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const REDIS_MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60000;

function createSupervisor({ env, port, projectRoot, log }) {
  let proc = null;
  let managed = false;
  let restarts = 0;
  let firstFailAt = 0;
  let shuttingDown = false;
  let onFatalCb = null;

  function onFatal(cb) { onFatalCb = cb; }

  function probeRedis(targetPort, timeoutMs = 3000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      function tryConnect() {
        const sock = net.createConnection(targetPort, '127.0.0.1');
        sock.on('connect', () => { sock.destroy(); resolve(true); });
        sock.on('error', () => {
          sock.destroy();
          if (Date.now() - start > timeoutMs) resolve(false);
          else setTimeout(tryConnect, 100);
        });
      }
      tryConnect();
    });
  }

  function buildConf() {
    const tmplFile = path.join(projectRoot, 'redis', `redis-${env}.conf`);
    if (!fs.existsSync(tmplFile)) return null;
    const dataDir = path.join(projectRoot, 'redis');
    const tmpl = fs.readFileSync(tmplFile, 'utf8');
    const conf = tmpl.replace(/^#\s*dir is injected.*$/m, `dir ${dataDir}`);
    const tmpConf = path.join(dataDir, `.redis-${env}-runtime.conf`);
    fs.writeFileSync(tmpConf, conf, 'utf8');
    return tmpConf;
  }

  function spawnRedis(confFile) {
    log(`starting redis-server (${env}, port ${port})`);
    proc = spawn('redis-server', [confFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', (d) => process.stdout.write(`[redis] ${d}`));
    proc.stderr.on('data', (d) => process.stderr.write(`[redis err] ${d}`));
    proc.on('exit', (code) => {
      log(`redis exited with code ${code}`);
      proc = null;
      if (shuttingDown) return;
      handleCrash(confFile);
    });
  }

  async function handleCrash(confFile) {
    const now = Date.now();
    if (now - firstFailAt > RESTART_WINDOW_MS) {
      restarts = 0;
      firstFailAt = now;
    }
    restarts++;
    if (restarts > REDIS_MAX_RESTARTS) {
      log(`redis crashed ${restarts} times in ${RESTART_WINDOW_MS / 1000}s, giving up`);
      if (onFatalCb) onFatalCb();
      return;
    }
    const delay = Math.min(restarts * 1000, 5000);
    log(`redis restart ${restarts}/${REDIS_MAX_RESTARTS}, retrying in ${delay}ms...`);
    await new Promise((r) => setTimeout(r, delay));
    if (shuttingDown) return;
    spawnRedis(confFile);
    const alive = await probeRedis(port);
    if (alive) {
      log(`redis recovered on port ${port}`);
    } else {
      log('redis restart failed');
      if (onFatalCb) onFatalCb();
    }
  }

  async function start() {
    const occupied = await probeRedis(port, 500);
    if (occupied) {
      log(`redis already running on port ${port}, reusing`);
      managed = false;
      return;
    }
    const confFile = buildConf();
    if (!confFile) {
      throw new Error(`redis config template not found for env=${env}`);
    }
    managed = true;
    spawnRedis(confFile);
    const ready = await probeRedis(port);
    if (!ready) throw new Error(`redis not ready on port ${port} after startup`);
    log(`redis ready on port ${port}`);
  }

  function stop() {
    shuttingDown = true;
    if (proc) proc.kill('SIGTERM');
  }

  function forceKill() {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  }

  function isManaged() { return managed; }

  return { start, stop, forceKill, onFatal, isManaged };
}

module.exports = { createSupervisor };
