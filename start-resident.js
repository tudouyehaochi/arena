#!/usr/bin/env node
const { spawn } = require('child_process');

const ARENA_API_URL = process.env.ARENA_API_URL || 'http://localhost:3000';
const SERVER_CMD = process.env.ARENA_SERVER_CMD || 'node';
const SERVER_ARGS = process.env.ARENA_SERVER_ARGS ? process.env.ARENA_SERVER_ARGS.split(' ') : ['server.js'];
const RUNNER_CMD = process.env.ARENA_RUNNER_CMD || 'node';
const RUNNER_ARGS = process.env.ARENA_RUNNER_ARGS ? process.env.ARENA_RUNNER_ARGS.split(' ') : ['run-arena.js'];

let serverProc = null;
let runnerProc = null;
let shuttingDown = false;
let invocationId = '';
let callbackToken = '';

function log(msg) {
  process.stdout.write(`[resident] ${msg}\n`);
}

function spawnServer() {
  log(`starting server: ${SERVER_CMD} ${SERVER_ARGS.join(' ')}`);
  serverProc = spawn(SERVER_CMD, SERVER_ARGS, {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc.stdout.on('data', (d) => {
    const text = d.toString();
    process.stdout.write(`[server] ${text}`);
    const inv = text.match(/ARENA_INVOCATION_ID=([a-zA-Z0-9-]+)/);
    const tok = text.match(/ARENA_CALLBACK_TOKEN=([a-zA-Z0-9-]+)/);
    if (inv) invocationId = inv[1];
    if (tok) callbackToken = tok[1];
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
    ARENA_API_URL,
    ARENA_INVOCATION_ID: invocationId,
    ARENA_CALLBACK_TOKEN: callbackToken,
  };
  log(`starting runner: ${RUNNER_CMD} ${RUNNER_ARGS.join(' ')}`);
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
  setTimeout(() => process.exit(0), 800);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

spawnServer();
