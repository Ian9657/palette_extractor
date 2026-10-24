// A throwaway static server over the repo, for the browser tools in this folder.
// start() resolves to { url, close } on a free port.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json'
};

function start() {
    const server = http.createServer((req, res) => {
        let file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
        if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
        if (file.endsWith(path.sep)) file = path.join(file, 'index.html');
        fs.readFile(file, (err, body) => {
            if (err) { res.writeHead(404).end(); return; }
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
        });
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () =>
        resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}

module.exports = { start };
