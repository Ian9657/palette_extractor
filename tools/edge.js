// Extreme-image run through the real page (npm run edge).
// Each image is drawn and encoded by the browser itself, deposited through
// the file input, and the whole page is checked: no errors or dialogs, a
// full set of distinct colours, the proof developed (or the test card for a
// source with nothing to read), and SAVE IMG / CSS VARIABLES still download.
// Runs in Chromium and WebKit. Exit code 1 if any check fails.
const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('./serve');

// name, file type, width, height, and how to paint it (runs in the page)
const CASES = [
    ['white', 'png', 800, 600, 'c.fillStyle="#fff";c.fillRect(0,0,w,h)'],
    ['black', 'png', 800, 600, 'c.fillStyle="#000";c.fillRect(0,0,w,h)'],
    ['two-colours', 'png', 800, 600, 'c.fillStyle="#EF4444";c.fillRect(0,0,w/2,h);c.fillStyle="#3B82F6";c.fillRect(w/2,0,w/2,h)'],
    ['one-pixel', 'png', 1, 1, 'c.fillStyle="#C81E5A";c.fillRect(0,0,1,1)'],
    ['tiny-icon', 'png', 24, 24, 'c.fillStyle="#1A1A1A";c.fillRect(0,0,w,h);c.fillStyle="#E8C547";c.beginPath();c.arc(12,12,7,0,7);c.fill()'],
    ['cut-out', 'png', 256, 256, 'c.fillStyle="#EF4444";c.beginPath();c.arc(128,128,90,0,7);c.fill();c.fillStyle="#fff";c.fillRect(100,100,56,56)'],
    ['transparent', 'png', 400, 300, ''],
    ['screenshot', 'png', 1440, 900, 'c.fillStyle="#F7F7F8";c.fillRect(0,0,w,h);c.fillStyle="#111827";c.fillRect(0,0,w,64);c.fillStyle="#2563EB";c.fillRect(40,120,300,44);c.fillStyle="#9CA3AF";for(let y=200;y<860;y+=28)c.fillRect(40,y,600+((y*37)%500),10)'],
    ['tall-strip', 'png', 40, 3000, 'const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,"#0F172A");g.addColorStop(1,"#F59E0B");c.fillStyle=g;c.fillRect(0,0,w,h)'],
    ['huge-photo', 'jpeg', 8000, 6000, 'const g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,"#1E3A8A");g.addColorStop(.5,"#DB2777");g.addColorStop(1,"#FDE68A");c.fillStyle=g;c.fillRect(0,0,w,h);for(let i=0;i<400;i++){c.fillStyle=`hsl(${i*37%360} 80% 55%)`;c.fillRect((i*997)%w,(i*613)%h,120,120)}'],
];

async function makeImages(browser, dir) {
    const page = await browser.newPage();
    for (const [name, type, w, h, paint] of CASES) {
        const b64 = await page.evaluate(async ([type, w, h, paint]) => {
            const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
            const c = cv.getContext('2d');
            new Function('c', 'w', 'h', paint)(c, w, h);
            const blob = await new Promise(r => cv.toBlob(r, 'image/' + type, 0.9));
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return btoa(s);
        }, [type, w, h, paint]);
        fs.writeFileSync(path.join(dir, `${name}.${type === 'jpeg' ? 'jpg' : type}`), Buffer.from(b64, 'base64'));
    }
    await page.close();
}

async function runCase(browser, url, file) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', e => problems.push('page error: ' + e.message));
    page.on('console', m => m.type() === 'error' && problems.push('console: ' + m.text()));
    page.on('dialog', d => { problems.push('dialog: ' + d.message()); d.dismiss(); });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2600);

    const t0 = Date.now();
    await page.setInputFiles('#file-input', file);
    // the extraction is done when the accession is filed (register.js) or the caption reports an error
    await page.waitForFunction(() => document.getElementById('acc-status')?.textContent === 'FILED' || document.querySelector('.fig-error'), null, { timeout: 30000 })
        .catch(() => problems.push('neither filed nor refused'));
    const filedMs = Date.now() - t0;
    const refusedNow = await page.evaluate(() => !!document.querySelector('.fig-error'));
    if (refusedNow) await page.waitForTimeout(500);   // let the error finish decoding in
    const proofReady = await page.waitForFunction(() => !document.getElementById('proof-stage').classList.contains('empty'), null, { timeout: refusedNow ? 1 : 30000 })
        .then(() => true, () => false);
    const proofMs = Date.now() - t0;

    const state = await page.evaluate(() => ({
        theme: palette && palette.theme,
        error: document.querySelector('.fig-error')?.textContent || '',
        cap: document.getElementById('fig1-cap').textContent,
        proofWhy: document.querySelector('.proof-why')?.textContent || ''
    }));
    const hexes = state.theme ? Object.values(state.theme) : [];
    const refused = path.basename(file).startsWith('transparent');   // nothing visible: must be refused in the caption
    if (refused) {
        if (!/TRANSPARENT/.test(state.error)) problems.push('a fully transparent image was not refused in the caption');
        await ctx.close();
        return { filedMs, proofMs, proofReady, proofWhy: state.proofWhy, hexes: [], problems, note: state.error };
    }
    if (hexes.length !== 5 || new Set(hexes).size !== 5) problems.push('palette: ' + hexes.join(' '));
    if (state.error) problems.push('caption error: ' + state.error);

    // exports still work on what came out
    for (const [sel, ext] of [['#btn-export-image', '.png']]) {
        const dl = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click(sel)]).then(([d]) => d, () => null);
        if (!dl || !dl.suggestedFilename().endsWith(ext)) problems.push(`no ${ext} download from ${sel}`);
    }
    await page.evaluate(() => { document.getElementById('export-menu').open = true; });
    const css = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#btn-export-css')]).then(([d]) => d, () => null);
    if (!css) problems.push('no CSS download');

    await ctx.close();
    return { filedMs, proofMs, proofReady, proofWhy: state.proofWhy, hexes, problems };
}

(async () => {
    const server = await start();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palette-edge-'));
    let failed = 0;
    for (const [engine, type] of [['chromium', chromium], ['webkit', webkit]]) {
        const browser = await type.launch();
        await makeImages(browser, dir);
        console.log(`\n== ${engine}`);
        for (const [name, type] of CASES) {
            const file = path.join(dir, `${name}.${type === 'jpeg' ? 'jpg' : type}`);
            const r = await runCase(browser, server.url, file);
            const proof = r.note ? `refused: ${r.note}` : r.proofReady ? `proof ${(r.proofMs / 1000).toFixed(1)}s` : `proof: test card (${r.proofWhy || 'empty'})`;
            console.log(`${r.problems.length ? '✖' : '✔'} ${name.padEnd(12)} filed ${(r.filedMs / 1000).toFixed(1)}s · ${proof} · ${r.hexes.join(' ')}`);
            for (const p of r.problems) console.log('    ' + p);
            if (r.problems.length) failed++;
        }
        await browser.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
    server.close();
    console.log(failed ? `\n${failed} case(s) failed` : '\nall cases passed');
    process.exit(failed ? 1 : 0);
})();
