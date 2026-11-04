// A throwaway static server for the browser tools in this folder, and npm run serve.
// Serves public/ as the site root, as Cloudflare does. Paths not found there fall back
// to the repo, so /regression/gallery.html and /test/fixtures/ work locally only.
// start() resolves to { url, close } on a free port.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'public');
const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json'
};

// With { headers: true } it also sends what _headers asks of Cloudflare (npm run csp).
// Not by default: Playwright's waitForFunction uses eval, which the policy forbids.
function start({ headers = false } = {}) {
    const extra = {};
    if (headers) {
        for (const line of fs.readFileSync(path.join(SITE, '_headers'), 'utf8').split('\n')) {
            const m = line.match(/^\s+([\w-]+):\s*(.+)$/);
            if (m) extra[m[1]] = m[2];
        }
    }
    const server = http.createServer((req, res) => {
        let name = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (name.endsWith('/')) name += 'index.html';
        let file = path.join(SITE, name);
        if (!file.startsWith(SITE)) { res.writeHead(403).end(); return; }
        if (!fs.existsSync(file)) file = path.join(ROOT, name);
        fs.readFile(file, (err, body) => {
            if (err) { res.writeHead(404).end(); return; }
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ...extra }).end(body);
        });
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () =>
        resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}

module.exports = { start };

if (require.main === module) start().then(({ url }) => console.log(`${url}  ·  ${url}regression/gallery.html`));
