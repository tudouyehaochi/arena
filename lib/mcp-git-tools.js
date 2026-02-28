const { execFileSync } = require('child_process');
const { z } = require('zod');

const ALLOWED_GIT_COMMANDS = ['log', 'diff', 'show', 'status', 'branch', 'blame', 'add'];
const BLOCKED_PATTERNS = [
  /push\s+.*\b(main|master)\b/,
  /push\s+--force/,
  /reset\s+--hard/,
  /clean\s+-f/,
  /checkout\s+(main|master)\b/,
];

function gitExec(argsArray, projectRoot) {
  return execFileSync('git', argsArray, {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
}

function getCurrentBranch(projectRoot) {
  return gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], projectRoot).trim();
}

function registerGitTools(server, projectRoot, safePath) {
  server.tool(
    'arena_run_git',
    'Run a git command in the project. Allowed: log, diff, show, status, branch, blame, add. Push to main/master is blocked.',
    {
      args: z.string().describe('Git arguments, e.g. "log --oneline -10" or "diff HEAD~1" or "add server.js"'),
    },
    async ({ args }) => {
      try {
        const parts = args.trim().split(/\s+/);
        const subcommand = parts[0];
        if (!ALLOWED_GIT_COMMANDS.includes(subcommand)) {
          return {
            content: [{ type: 'text', text: `Blocked: "git ${subcommand}" is not allowed. Allowed: ${ALLOWED_GIT_COMMANDS.join(', ')}. Use arena_git_commit for commit+push.` }],
            isError: true,
          };
        }
        for (const pattern of BLOCKED_PATTERNS) {
          if (pattern.test(args)) {
            return {
              content: [{ type: 'text', text: 'Blocked: this git command matches a safety rule.' }],
              isError: true,
            };
          }
        }
        const output = gitExec(parts, projectRoot);
        return { content: [{ type: 'text', text: output || '(no output)' }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'arena_git_commit',
    'Stage specified files, commit with a message, and push to the current dev branch. Blocked if current branch is main/master.',
    {
      files: z.array(z.string()).describe('List of file paths to stage, e.g. ["server.js", "lib/auth.js"]'),
      message: z.string().describe('Commit message'),
    },
    async ({ files, message }) => {
      try {
        const branch = getCurrentBranch(projectRoot);
        if (branch === 'main' || branch === 'master') {
          return {
            content: [{ type: 'text', text: `Blocked: cannot commit to ${branch}. Switch to a dev branch first.` }],
            isError: true,
          };
        }
        for (const f of files) {
          safePath(f);
          gitExec(['add', f], projectRoot);
        }
        gitExec(['commit', '-m', message], projectRoot);
        gitExec(['push', 'origin', branch], projectRoot);
        const hash = gitExec(['rev-parse', '--short', 'HEAD'], projectRoot).trim();
        return { content: [{ type: 'text', text: `Committed ${hash} on ${branch} and pushed. Files: ${files.join(', ')}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}

module.exports = { registerGitTools, BLOCKED_PATTERNS, ALLOWED_GIT_COMMANDS };
