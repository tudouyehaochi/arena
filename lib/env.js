const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ENV_FILE = path.join(__dirname, '..', 'env.json');

function getEnv() {
  try {
    const data = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
    return data;
  } catch {
    return { environment: 'dev' };
  }
}

function isDev() {
  return getEnv().environment === 'dev';
}

function isProd() {
  return getEnv().environment === 'prod';
}

function requireWriteAccess() {
  if (isProd()) {
    throw new Error(
      'Write access denied: current environment is prod. ' +
      'Use the approval gate to promote changes from dev.'
    );
  }
}

function currentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

module.exports = { getEnv, isDev, isProd, requireWriteAccess, currentBranch };
