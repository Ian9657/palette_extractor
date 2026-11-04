const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const csp = read('_headers').match(/Content-Security-Policy: (.+)/)[1];

// The policy names the one inline script by hash, so editing it without
// updating _headers would silently stop it running, and the press run with it.
test('the inline script in index.html matches its hash in _headers', () => {
    const inline = [...read('index.html').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.equal(inline.length, 1);
    const hash = crypto.createHash('sha256').update(inline[0]).digest('base64');
    assert.ok(csp.includes(`'sha256-${hash}'`), `expected sha256-${hash} in _headers`);
});

test('requests can only go to this site', () => {
    assert.match(csp, /connect-src 'self' blob:;/);
    assert.match(csp, /default-src 'none'/);
    assert.ok(!/https?:/.test(csp), 'no outside host in the policy');
});

test('the pages load nothing from another host', () => {
    for (const page of ['index.html', 'gallery.html']) {
        const external = [...read(page).matchAll(/<(?:script|link|img)[^>]+(?:src|href)="(https?:[^"]+)"/g)].map(m => m[1]);
        assert.deepEqual(external, [], page);
    }
});
