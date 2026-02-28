function createAgentRuntime({ API_URL, INVOCATION_ID, CALLBACK_TOKEN, runCommand, MCP_SCRIPT }) {
  const mcpConfig = JSON.stringify({ mcpServers: { arena: { command: 'node', args: [MCP_SCRIPT], env: {
    ARENA_API_URL: API_URL, ARENA_INVOCATION_ID: INVOCATION_ID, ARENA_CALLBACK_TOKEN: CALLBACK_TOKEN,
  } } } });

  return {
    清风: {
      ready: true,
      async setup() { console.log('[mcp] 清风 inline MCP ready'); },
      async cleanup() {},
      canRun() { return true; },
      cmd: 'claude',
      buildArgs(prompt) {
        return [
          '-p', prompt, '--output-format', 'stream-json', '--verbose', '--mcp-config', mcpConfig,
          '--allowedTools', 'mcp__arena__arena_get_context,mcp__arena__arena_post_message,mcp__arena__arena_read_file,mcp__arena__arena_write_file,mcp__arena__arena_list_files,mcp__arena__arena_run_git,mcp__arena__arena_git_commit,mcp__arena__arena_run_test',
        ];
      },
    },
    明月: {
      ready: false,
      async setup() {
        if (this.ready) return;
        await runCommand('codex', [
          'mcp', 'add', 'arena', '--env', `ARENA_API_URL=${API_URL}`, '--env', `ARENA_INVOCATION_ID=${INVOCATION_ID}`,
          '--env', `ARENA_CALLBACK_TOKEN=${CALLBACK_TOKEN}`, '--', 'node', MCP_SCRIPT,
        ], '明月 MCP add');
        this.ready = true;
      },
      async cleanup() {
        if (!this.ready) return;
        try { await runCommand('codex', ['mcp', 'remove', 'arena'], '明月 MCP remove'); } catch {}
        this.ready = false;
      },
      canRun() { return this.ready; },
      cmd: 'codex',
      buildArgs(prompt) { return ['exec', prompt, '--json']; },
    },
  };
}

module.exports = { createAgentRuntime };
