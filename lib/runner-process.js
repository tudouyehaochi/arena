const { spawn } = require('child_process');

function shouldDropCodexNoise(line, isCodex) {
  if (!isCodex) return false;
  return (
    line.includes('responses_websocket: failed to connect to websocket') ||
    line.includes('failed to record rollout items') ||
    line.includes('"type":"error","message":"Reconnecting...') ||
    line.includes('Falling back from WebSockets to HTTPS transport')
  );
}

function attachFilteredOutput(stream, prefix, writeFn, shouldDrop) {
  let buf = '';
  stream.on('data', (d) => {
    buf += d.toString();
    const parts = buf.split('\n');
    buf = parts.pop();
    for (const line of parts) {
      if (!shouldDrop(line)) writeFn(`${prefix}${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buf && !shouldDrop(buf)) writeFn(`${prefix}${buf}`);
  });
}

function runAgentProcess({ cmd, args, label, env, signal }) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${label} ===\n`);
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    const isCodex = cmd === 'codex';
    const shouldDrop = (line) => shouldDropCodexNoise(line, isCodex);
    attachFilteredOutput(child.stdout, `[${label}] `, process.stdout.write.bind(process.stdout), shouldDrop);
    attachFilteredOutput(child.stderr, `[${label} err] `, process.stderr.write.bind(process.stderr), shouldDrop);

    let done = false;
    const onAbort = () => {
      if (done) return;
      done = true;
      try { child.kill('SIGTERM'); } catch {}
      reject(new Error('invoke_aborted'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    child.on('close', (code) => {
      if (done) return;
      done = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      code !== 0 ? reject(new Error(`${label} exited ${code}`)) : resolve();
    });
    child.on('error', (err) => {
      if (done) return;
      done = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}

module.exports = {
  runAgentProcess,
};
