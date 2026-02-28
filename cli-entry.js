#!/usr/bin/env node
const { invoke } = require('./unified-cli');

function parseArgs(argv) {
  const args = argv.slice(2);
  let verbose = false;
  let sessionId = null;
  let timeoutMs = undefined;
  const rest = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--resume') {
      sessionId = args[++i];
    } else if (args[i] === '--timeout') {
      timeoutMs = Number(args[++i]) * 1000;
    } else {
      rest.push(args[i]);
    }
  }

  return { cli: rest[0], prompt: rest.slice(1).join(' '), sessionId, verbose, timeoutMs };
}

async function main() {
  const { cli, prompt, sessionId, verbose, timeoutMs } = parseArgs(process.argv);

  if (!cli || !prompt) {
    console.error(
      'Usage: node cli-entry.js <claude|codex> [--verbose] [--resume <id>] [--timeout <secs>] "prompt"'
    );
    process.exit(1);
  }

  try {
    const result = await invoke(cli, prompt, { sessionId, verbose, timeoutMs });
    process.stdout.write(result.text.trimEnd() + '\n');
    if (result.sessionId) {
      process.stderr.write(`[session: ${result.sessionId}]\n`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
