const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePort, resolveApiUrl, resolveBindHost, resolvePublicBaseUrl } = require('../lib/runtime-config');

test('resolvePort: prod defaults to 3001', () => {
  assert.equal(resolvePort({ environment: 'prod', branch: 'dev' }), 3001);
});

test('resolvePort: master branch defaults to 3001', () => {
  assert.equal(resolvePort({ environment: 'dev', branch: 'master' }), 3001);
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

test('resolveBindHost: defaults to loopback for safe local-only mode', () => {
  assert.equal(resolveBindHost(''), '127.0.0.1');
});

test('resolveBindHost: accepts explicit external bind host', () => {
  assert.equal(resolveBindHost('0.0.0.0'), '0.0.0.0');
});

test('resolvePublicBaseUrl: uses explicit public URL when provided', () => {
  assert.equal(resolvePublicBaseUrl({ publicBaseUrl: 'https://arena.example.com/', port: 3000 }), 'https://arena.example.com');
});

test('resolvePublicBaseUrl: falls back to localhost URL by port', () => {
  assert.equal(resolvePublicBaseUrl({ publicBaseUrl: '', port: 3001 }), 'http://localhost:3001');
});
