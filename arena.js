#!/usr/bin/env node

const { getEnv, currentBranch } = require('./lib/env');
const gate = require('./lib/gate');

const [,, command, ...args] = process.argv;
const wsUrl = process.env.WS_URL || 'ws://localhost:3000';

function usage() {
  console.log(`
Arena CLI

Usage:
  node arena.js server              Start the chatroom server
  node arena.js env                 Show current environment
  node arena.js chat <message>      Send a chat message as "user"
  node arena.js promote <desc>      Propose dev → prod promotion
  node arena.js approve             Approve pending promotion
  node arena.js reject [reason]     Reject pending promotion
`.trim());
}

async function main() {
  switch (command) {
    case 'server': {
      const { start } = require('./server');
      start();
      break;
    }

    case 'env': {
      const env = getEnv();
      const branch = currentBranch();
      console.log(`Environment: ${env.environment}`);
      console.log(`Branch:      ${branch}`);
      break;
    }

    case 'chat': {
      const text = args.join(' ');
      if (!text) { console.error('Usage: node arena.js chat <message>'); process.exit(1); }
      const { AgentClient } = require('./lib/agent-client');
      const client = new AgentClient('user', wsUrl);
      client.on('connected', () => {
        client.send(text);
        console.log('Sent: ' + text);
        setTimeout(() => { client.close(); process.exit(0); }, 500);
      });
      break;
    }

    case 'promote': {
      const desc = args.join(' ') || 'Promote dev to prod';
      await gate.propose(desc, wsUrl);
      break;
    }

    case 'approve': {
      gate.approve(wsUrl);
      break;
    }

    case 'reject': {
      const reason = args.join(' ') || 'Rejected by user';
      gate.reject(reason, wsUrl);
      setTimeout(() => process.exit(0), 1000);
      break;
    }

    default:
      usage();
      break;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
