const { execSync } = require('child_process');
const path = require('path');
const { AgentClient } = require('./agent-client');

const ARENA_DIR = path.join(__dirname, '..');

function exec(cmd) {
  return execSync(cmd, { cwd: ARENA_DIR, encoding: 'utf8' }).trim();
}

/**
 * Propose promoting dev → prod. Sends an approval-request via the chatroom.
 */
function propose(description, wsUrl) {
  const client = new AgentClient('gate', wsUrl);
  return new Promise((resolve) => {
    client.on('connected', () => {
      client.requestApproval(description || 'Promote dev to prod');
      console.log('Approval request sent: ' + description);
      // Keep connection open to listen for response
      client.on('approved', (msg) => {
        console.log('Approved! Executing merge...');
        try {
          const result = approve(wsUrl);
          resolve(result);
        } catch (err) {
          console.error('Merge failed:', err.message);
          resolve(false);
        } finally {
          client.close();
        }
      });
      client.on('rejected', (msg) => {
        console.log('Rejected:', msg.text);
        resolve(false);
        client.close();
      });
    });
  });
}

/**
 * Execute the merge: dev → master (prod).
 */
function approve(wsUrl) {
  try {
    exec('git checkout master');
    exec('git merge dev --no-ff -m "Approved: promote dev to prod"');
    console.log('Merge complete: dev → master');

    // Broadcast result
    const client = new AgentClient('gate', wsUrl);
    client.on('connected', () => {
      client._send({
        from: 'gate',
        text: 'Dev merged into prod successfully',
        type: 'approved',
        timestamp: Date.now(),
      });
      setTimeout(() => client.close(), 500);
    });

    return true;
  } catch (err) {
    console.error('Merge failed:', err.message);
    throw err;
  }
}

/**
 * Reject a promotion request.
 */
function reject(reason, wsUrl) {
  const client = new AgentClient('gate', wsUrl);
  client.on('connected', () => {
    client._send({
      from: 'gate',
      text: reason || 'Promotion rejected',
      type: 'rejected',
      timestamp: Date.now(),
    });
    setTimeout(() => client.close(), 500);
  });
}

module.exports = { propose, approve, reject };
