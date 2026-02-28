const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePort, resolveApiUrl } = require('../lib/runtime-config');

test('resolvePort: prod defaults to 3001', () => {
  assert.equal(resolvePort({ environment: 'prod', branch: 'dev' }), 3001);
});

test('resolvePort: main branch defaults to 3001', () => {
  assert.equal(resolvePort({ environment: 'dev', branch: 'main' }), 3001);
});

test('resolvePort: dev non-main defaults to 3000', () => {
  assert.equal(resolvePort({ environment: 'dev', branch: 'feature-x' }), 3000);
});

test('resolvePort: explicit port wins', () => {
  assert.equal(resolvePort({ port: '4567', environment: 'prod', branch: 'main' }), 4567);
});

test('resolveApiUrl: uses provided api url first', () => {
  assert.equal(resolveApiUrl({ apiUrl: 'http://localhost:9999', port: 3000 }), 'http://localhost:9999');
});

test('resolveApiUrl: falls back to localhost with resolved port', () => {
  assert.equal(resolveApiUrl({ apiUrl: '', port: 3001 }), 'http://localhost:3001');
});
