const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const chatJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'chat-app.js'), 'utf8');

test('mobile layout uses responsive breakpoints and avoids horizontal overflow', () => {
  assert.match(html, /@media \(max-width:\s*560px\)/);
  assert.match(html, /overflow-x:\s*hidden/);
  assert.match(html, /grid-template-rows:\s*auto 1fr auto/);
});

test('composer supports keyboard-safe mobile behavior', () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /env\(safe-area-inset-bottom\)/);
  assert.match(chatJs, /scrollIntoView/);
});

test('chat flow scripts still support send and realtime websocket updates', () => {
  assert.match(chatJs, /new WebSocket/);
  assert.ok(chatJs.includes('/api/ws-token'));
  assert.match(chatJs, /function send\(\)/);
  assert.match(chatJs, /renderMsg/);
});
