// Does the same file give the same record everywhere? (npm run cross)
// Every image in the repo through decode.js + color.js in Chromium and WebKit,
// k = 3, 5, 8 and seeds 1–3, compared with each other; the JPEGs also against
// test/records.json, which the Node tests hold to the same values. Then each
// sample deposited through the real page, and a very large JPEG timed.
// Exits non-zero on any difference. WebP and other formats still decode in the
// browser (decode.js), so they are not covered by the promise, or by this tool.
const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');

const ROOT = path.join(__dirname, '..');
const RECORDS = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'records.json'), 'utf8'));
const list = dir => fs.readdirSync(path.join(ROOT, dir)).filter(f => /\.(jpg|png)$/.test(f)).map(f => `${dir}/${f}`);
const FILES = [...list('samples'), ...list('regression'), ...list('test/fixtures')];
const SAMPLES = ['NEON CITY', 'CONCERT', 'GARAGE', 'DOG', 'BLOSSOM', 'JELLYFISH'];

const readAll = async files => {
    const out = {};
    for (const url of files) {
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        const img = new Image();
        img.src = url;
        try { await img.decode(); } catch { continue; }   // a file this browser won't show at all
        const r = readPixels(img, bytes, 400);
        const palettes = {};
        for (const k of [3, 5, 8]) for (const seed of [1, 2, 3]) {
            palettes[`${k}/${seed}`] = extractPalette(r.data, r.width, r.height, k, { seed }).theme;
        }
        out[url] = { checksum: pixelChecksum(r.data), decoder: r.decoder, palettes };
    }
    return out;
};

// 8000 × 6000, drawn once in Chromium, so both engines read the same bytes
const makeHuge = async () => {
    const c = document.createElement('canvas');
    c.width = 8000; c.height = 6000;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 8000, 6000);
    g.addColorStop(0, '#1E3A8A'); g.addColorStop(0.5, '#DB2777'); g.addColorStop(1, '#FDE68A');
    x.fillStyle = g; x.fillRect(0, 0, 8000, 6000);
    for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${i * 37 % 360} 80% 55%)`; x.fillRect((i * 997) % 8000, (i * 613) % 6000, 120, 120); }
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
    const a = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode.apply(null, a.subarray(i, i + 32768));
    return btoa(s);
};
const readHuge = b64 => {
    const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    const t0 = performance.now();
    const d = decodeJpeg(bytes, 400);
    const ms = Math.round(performance.now() - t0);
    const { width, height } = { width: 400, height: 300 };
    return { ms, mb: +(bytes.length / 1048576).toFixed(1), dc: d.scale === 8, checksum: pixelChecksum(areaDownscale(d.data, d.width, d.height, width, height)) };
};

(async () => {
    const server = await start();
    const results = {}, pages = {}, huge = {};
    let hugeBytes = null;
    for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
        const browser = await type.launch({ args: name === 'chromium' ? ['--mute-audio'] : [] });
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(server.url + 'gallery.html');
        results[name] = await page.evaluate(readAll, FILES);
        if (!hugeBytes) hugeBytes = await page.evaluate(makeHuge);
        huge[name] = await page.evaluate(readHuge, hugeBytes);

        await page.goto(server.url);
        pages[name] = {};
        for (const sample of SAMPLES) {
            await page.click(`.sample[data-name="${sample}"]`);
            await page.waitForFunction(() => document.getElementById('acc-status').textContent === 'FILED' && !isExtracting, null, { timeout: 120000 });
            pages[name][sample] = await page.evaluate(() => ({ checksum: document.getElementById('acc-check').textContent, theme: palette.theme }));
            await page.evaluate(() => { document.getElementById('acc-status').textContent = ''; });
        }
        await browser.close();
    }
    server.close();

    let cases = 0, same = 0, problems = 0;
    const say = msg => { problems++; console.log('✖ ' + msg); };
    for (const file of FILES) {
        const a = results.chromium[file], b = results.webkit[file];
        if (!a || !b) { console.log(`- ${file}: not shown by ${a ? 'WebKit' : 'Chromium'}, skipped`); continue; }
        // A format decoded by the browser is outside the promise; report, don't fail
        if (a.decoder === 'browser' && a.checksum !== b.checksum) { console.log(`· ${file}: browser-decoded, pixels differ between engines`); continue; }
        if (a.checksum !== b.checksum) say(`${file}: checksum ${a.checksum} vs ${b.checksum}`);
        for (const key in a.palettes) {
            cases++;
            if (JSON.stringify(a.palettes[key]) === JSON.stringify(b.palettes[key])) same++;
            else say(`${file} k/seed ${key}: palettes differ`);
        }
        const rec = RECORDS[file];
        if (rec) {
            if (rec.checksum !== a.checksum) say(`${file}: browser checksum ${a.checksum}, records.json ${rec.checksum}`);
            for (const k of [3, 5, 8]) {
                if (JSON.stringify(rec.palettes[k]) !== JSON.stringify(a.palettes[`${k}/1`])) say(`${file} k=${k}: palette differs from records.json`);
            }
        }
    }
    console.log(`Same file, same palette: ${same}/${cases} (${FILES.length} files, k = 3, 5, 8, seeds 1–3)`);

    for (const sample of SAMPLES) {
        const a = pages.chromium[sample], b = pages.webkit[sample];
        if (JSON.stringify(a) !== JSON.stringify(b)) say(`page, ${sample}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
    console.log(`Real page: ${SAMPLES.length} samples deposited in both engines`);

    if (huge.chromium.checksum !== huge.webkit.checksum) say('8000 × 6000 JPEG: checksums differ');
    console.log(`8000 × 6000 JPEG, ${huge.chromium.mb} MB: ${huge.chromium.ms} ms Chromium, ${huge.webkit.ms} ms WebKit (DC only: ${huge.chromium.dc})`);

    console.log(problems ? `${problems} problem(s)` : 'No differences.');
    process.exit(problems ? 1 : 0);
})();
