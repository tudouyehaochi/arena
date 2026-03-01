const fs = require('fs');
const path = require('path');

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function servePublicFile(name) {
  return (_req, res) => {
    const filePath = path.join(PUBLIC_DIR, name);
    const ext = path.extname(name);
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      res.writeHead(200, { 'Content-Type': (MIME[ext] || 'application/octet-stream') + '; charset=utf-8' });
      res.end(data);
    });
  };
}

module.exports = { servePublicFile };
