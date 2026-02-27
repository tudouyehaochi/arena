const { spawn } = require("child_process");
const { createInterface } = require("readline");

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

const adapters = {
  claude: {
    buildArgs(prompt, { sessionId, verbose }) {
      const args = ["-p", prompt];
      if (verbose) {
        // stream-json must be paired with --verbose
        args.push("--output-format", "stream-json", "--verbose");
      }
      if (sessionId) args.push("--resume", sessionId);
      return args;
    },
    bin: "/Users/mohanma/.local/bin/claude",
    spawnOpts: {},
    extractText(event) {
      if (event.type === "assistant") {
        return (event.message?.content ?? [])
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
      }
      return null;
    },
    extractSessionId(event) {
      if (event.type === "system" && event.session_id) return event.session_id;
      return null;
    },
  },

  codex: {
    buildArgs(prompt, { sessionId }) {
      if (sessionId) return ["exec", "resume", "--last", "--json"];
      return ["exec", "--json", prompt];
    },
    bin: "codex",
    // codex needs a git repo — override with CODEX_CWD env var
    spawnOpts: { cwd: process.env.CODEX_CWD || process.cwd() },
    extractText(event) {
      if (
        event.type === "item.completed" &&
        event.item?.type === "agent_message"
      ) {
        return event.item.text ?? null;
      }
      return null;
    },
    extractSessionId(event) {
      if (event.type === "thread.started" && event.thread_id)
        return event.thread_id;
      return null;
    },
  },
};

// ---------------------------------------------------------------------------
// invoke(cli, prompt, options?) → Promise<{ text, sessionId }>
// ---------------------------------------------------------------------------

function invoke(cli, prompt, options = {}) {
  const adapter = adapters[cli];
  if (!adapter) return Promise.reject(new Error(`Unknown CLI: ${cli}`));

  const {
    sessionId,
    verbose = false,
    timeoutMs = 600_000,   // 10 min default — agent tasks can be long
    killGraceMs = 5_000,   // wait 5s after SIGTERM before SIGKILL
  } = options;
  const args = adapter.buildArgs(prompt, { sessionId, verbose });

  // Remove Claude-related env vars so claude CLI can run from inside a claude session
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const child = spawn(adapter.bin, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env,
    ...adapter.spawnOpts,
  });

  const isStreamJson = verbose && cli === "claude";
  const isJsonMode = cli === "codex" || isStreamJson;

  return new Promise((resolve, reject) => {
    let settled = false;
    let lastActivity = Date.now();
    const stderrBuf = [];  // capture stderr for error diagnostics

    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(val);
    };

    // Graceful kill: SIGTERM → wait → SIGKILL
    const killChild = () => {
      child.kill("SIGTERM");
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
      }, killGraceMs);
    };

    // Timeout watchdog — monitors both stdout and stderr activity
    const timer = timeoutMs > 0 && setInterval(() => {
      if (Date.now() - lastActivity > timeoutMs) {
        killChild();
        settle(reject, new Error(
          `${cli} timed out after ${timeoutMs / 1000}s of inactivity`
        ));
      }
    }, 5_000);

    // Forward SIGINT/SIGTERM to child so Ctrl+C cleans up
    const onSignal = (sig) => {
      killChild();
      settle(reject, new Error(`${cli} killed by ${sig}`));
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    const cleanup = () => {
      if (timer) clearInterval(timer);
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    };
    const touch = () => { lastActivity = Date.now(); };

    if (isJsonMode) {
      // Parse JSON lines (stream-json for claude, --json for codex)
      const chunks = [];
      let sid = null;

      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        touch();
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line);
          const text = adapter.extractText(event);
          if (text) chunks.push(text);
          const s = adapter.extractSessionId(event);
          if (s) sid = s;
        } catch {
          // ignore non-JSON lines
        }
      });

      child.stderr.on("data", (chunk) => {
        touch();
        stderrBuf.push(chunk);
        process.stderr.write(chunk);
      });

      child.on("close", (code) => {
        if (code !== 0) {
          const msg = Buffer.concat(stderrBuf).toString().trim();
          settle(reject, new Error(
            `${cli} exited with code ${code}${msg ? `\n${msg}` : ""}`
          ));
        } else {
          settle(resolve, { text: chunks.join(""), sessionId: sid });
        }
      });
    } else {
      // Plain text mode (claude without --verbose)
      const chunks = [];

      child.stdout.on("data", (chunk) => { touch(); chunks.push(chunk); });
      child.stderr.on("data", (chunk) => {
        touch();
        stderrBuf.push(chunk);
        process.stderr.write(chunk);
      });

      child.on("close", (code) => {
        if (code !== 0) {
          const msg = Buffer.concat(stderrBuf).toString().trim();
          settle(reject, new Error(
            `${cli} exited with code ${code}${msg ? `\n${msg}` : ""}`
          ));
        } else {
          settle(resolve, { text: Buffer.concat(chunks).toString(), sessionId: null });
        }
      });
    }

    child.on("error", (err) => settle(reject, err));
  });
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  let verbose = false;
  let sessionId = null;
  let timeoutMs = undefined;
  const rest = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--verbose" || args[i] === "-v") {
      verbose = true;
    } else if (args[i] === "--resume") {
      sessionId = args[++i];
    } else if (args[i] === "--timeout") {
      timeoutMs = Number(args[++i]) * 1000; // accept seconds from CLI
    } else {
      rest.push(args[i]);
    }
  }

  return {
    cli: rest[0],
    prompt: rest.slice(1).join(" "),
    sessionId,
    verbose,
    timeoutMs,
  };
}

async function main() {
  const { cli, prompt, sessionId, verbose, timeoutMs } = parseArgs(process.argv);

  if (!cli || !prompt) {
    console.error(
      "Usage: node unified-cli.js <claude|codex> [--verbose] [--resume <id>] [--timeout <secs>] \"prompt\""
    );
    process.exit(1);
  }

  try {
    const result = await invoke(cli, prompt, { sessionId, verbose, timeoutMs });
    process.stdout.write(result.text.trimEnd() + "\n");
    if (result.sessionId) {
      process.stderr.write(`[session: ${result.sessionId}]\n`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();

module.exports = { invoke };
