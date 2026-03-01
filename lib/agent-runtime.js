function createAgentRuntime({ API_URL, INVOCATION_ID, CALLBACK_TOKEN, RUNTIME_ENV, INSTANCE_ID, TARGET_PORT, ROOM_ID, runCommand, MCP_SCRIPT }) {
  const mcpConfig = JSON.stringify({ mcpServers: { arena: { command: 'node', args: [MCP_SCRIPT], env: {
    ARENA_API_URL: API_URL, ARENA_INVOCATION_ID: INVOCATION_ID, ARENA_CALLBACK_TOKEN: CALLBACK_TOKEN,
    ARENA_ENVIRONMENT: RUNTIME_ENV, ARENA_INSTANCE_ID: INSTANCE_ID, ARENA_TARGET_PORT: String(TARGET_PORT),
    ARENA_ROOM_ID: ROOM_ID,
  } } } });
  const codexMcpArgs = [
    '-c', 'mcp_servers={}',
    '-c', 'mcp_servers.arena.command="node"',
    '-c', `mcp_servers.arena.args=["${MCP_SCRIPT}"]`,
    '-c', `mcp_servers.arena.env.ARENA_API_URL="${API_URL}"`,
    '-c', `mcp_servers.arena.env.ARENA_INVOCATION_ID="${INVOCATION_ID}"`,
    '-c', `mcp_servers.arena.env.ARENA_CALLBACK_TOKEN="${CALLBACK_TOKEN}"`,
    '-c', `mcp_servers.arena.env.ARENA_ENVIRONMENT="${RUNTIME_ENV}"`,
    '-c', `mcp_servers.arena.env.ARENA_INSTANCE_ID="${INSTANCE_ID}"`,
    '-c', `mcp_servers.arena.env.ARENA_TARGET_PORT="${TARGET_PORT}"`,
    '-c', `mcp_servers.arena.env.ARENA_ROOM_ID="${ROOM_ID}"`,
  ];

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
      ready: true,
      async setup() {
        console.log('[mcp] 明月 inline MCP ready');
      },
      async cleanup() {
        return;
      },
      canRun() { return this.ready; },
      cmd: 'codex',
      buildArgs(prompt) { return ['exec', prompt, '--json', ...codexMcpArgs]; },
    },
  };
}

module.exports = { createAgentRuntime };
