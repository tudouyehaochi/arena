const { getEnv } = require('./env');

function normalizeEnvironment(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === 'prod' ? 'prod' : 'dev';
}

function inferEnvironment(explicitValue) {
  if (explicitValue) return normalizeEnvironment(explicitValue);
  if (process.env.ARENA_ENVIRONMENT) return normalizeEnvironment(process.env.ARENA_ENVIRONMENT);
  return normalizeEnvironment(getEnv().environment);
}

function toPortNumber(value) {
  const n = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(n)) return null;
  if (n <= 0 || n > 65535) return null;
  return n;
}

function resolvePort({ port, environment, branch }) {
  const explicit = toPortNumber(port || process.env.PORT);
  if (explicit) return explicit;
  const env = normalizeEnvironment(environment);
  const branchName = String(branch || '').trim().toLowerCase();
  const isMain = branchName === 'main' || branchName === 'master';
  if (env === 'prod' || isMain) return 3001;
  return 3000;
}

function resolveApiUrl({ apiUrl, port }) {
  const provided = String(apiUrl || '').trim();
  if (provided) return provided;
  return `http://localhost:${port}`;
}

module.exports = {
  inferEnvironment,
  resolvePort,
  resolveApiUrl,
};
