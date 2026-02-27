#!/bin/bash
# Run this from a regular terminal (NOT inside a Claude Code session)
# cd ~/arena && bash test-unified.sh

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Test 1: Claude (plain text) ==="
node "$DIR/unified-cli.js" claude "What LLM model are you? Answer in one sentence."
echo ""

echo "=== Test 2: Claude (verbose, stream-json) ==="
node "$DIR/unified-cli.js" claude --verbose "What LLM model are you? Answer in one sentence."
echo ""

echo "=== Test 3: Codex ==="
CODEX_CWD="$DIR" node "$DIR/unified-cli.js" codex "What LLM model are you? Answer in one sentence."
echo ""

echo "=== Test 4: Resume ==="
echo "Copy the [session: ...] ID from Test 2 output above, then run:"
echo "  node $DIR/unified-cli.js claude --verbose --resume <SESSION_ID> \"Now answer in Chinese\""
