const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function readAndSend(filePath, res) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': (MIME[ext] || 'application/octet-stream') + '; charset=utf-8' });
    res.end(data);
  });
}

function servePublicFile(name) {
  return (_req, res) => {
    const filePath = path.join(PUBLIC_DIR, name);
    readAndSend(filePath, res);
  };
}

function servePublicPath(req, res, prefix = '/public/') {
  const urlPath = (req.url || '/').split('?')[0];
  if (!urlPath.startsWith(prefix)) { res.writeHead(404); res.end('Not Found'); return; }
  const rel = urlPath.slice(prefix.length);
  const normalized = path.normalize(rel).replace(/^([.][.][/\\])+/, '');
  if (!normalized || normalized.startsWith('..')) { res.writeHead(404); res.end('Not Found'); return; }
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(404); res.end('Not Found'); return; }
  readAndSend(filePath, res);
}

module.exports = { servePublicFile, servePublicPath };
