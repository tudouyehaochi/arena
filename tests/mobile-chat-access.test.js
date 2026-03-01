const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('mobile layout uses responsive breakpoints and avoids horizontal overflow', () => {
  assert.match(html, /@media \(max-width: 920px\)/);
  assert.match(html, /@media \(max-width: 560px\)/);
  assert.match(html, /overflow-x:\s*hidden/);
  assert.match(html, /grid-template-columns:\s*1fr/);
});

test('composer supports keyboard-safe mobile behavior', () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /env\(safe-area-inset-bottom\)/);
  assert.match(html, /window\.visualViewport/);
  assert.match(html, /scrollIntoView/);
});

test('chat flow scripts still support send and realtime websocket updates', () => {
  assert.match(html, /new WebSocket/);
  assert.ok(html.includes('/api/ws-token'));
  assert.match(html, /function send\(\)/);
  assert.match(html, /renderMsg/);
});
