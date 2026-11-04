// Regenerates the images the README and link previews show (npm run doc-images):
//   docs/screenshot.jpg    the page with a sample filed
//   docs/proof-eject.webp  04 Proof taken apart and seated again
//   og-image.png           the share card, its colours computed from the sample
// The animation is assembled with Pillow (python3 -c "import PIL").
const { chromium } = require('playwright');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('./serve');
const C = require('../js/color.js');
const D = require('../js/decode.js');

const ROOT = path.join(__dirname, '..');
const SAMPLE = 'NEON CITY', SAMPLE_FILE = 'samples/neon-city.jpg';

async function deposit(page, url) {
    await page.goto(url);
    await page.waitForFunction(() => !document.documentElement.classList.contains('booting'), null, { timeout: 60000 });
    await page.click(`.sample[data-name="${SAMPLE}"]`);
    await page.waitForFunction(() => document.getElementById('acc-status').textContent === 'FILED' && !isExtracting, null, { timeout: 120000 });
    await page.waitForFunction(() => !document.getElementById('proof-stage').classList.contains('empty'), null, { timeout: 120000 });
}

async function screenshot(browser, url) {
    const page = await browser.newPage({ viewport: { width: 1270, height: 800 }, deviceScaleFactor: 2 });
    await deposit(page, url);
    await page.waitForTimeout(2500);
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(ROOT, 'docs/screenshot.jpg'), type: 'jpeg', quality: 82 });
    await page.close();
}

async function ejectAnimation(browser, url) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palette-frames-'));
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    await deposit(page, url);
    await page.addStyleTag({ content: '.proof-stage.apart .proof-layer:last-child::after { content: none !important; }' });   // the slug is for visitors to find
    await page.evaluate(() => document.getElementById('proof-screen').closest('section').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(2500);
    const box = await page.evaluate(() => {
        const sec = document.getElementById('proof-screen').closest('section').getBoundingClientRect();
        const sheet = document.querySelector('.sheet').getBoundingClientRect();
        const meta = document.getElementById('proof-rev').parentElement.getBoundingClientRect();
        return { x: sec.x, y: Math.max(0, sec.y), right: sheet.right - 24, bottom: Math.min(innerHeight, meta.bottom + 28) };
    });
    const cdp = await page.context().newCDPSession(page);
    let n = 0, t0 = null;
    cdp.on('Page.screencastFrame', f => {
        if (t0 === null) t0 = f.metadata.timestamp;
        fs.writeFileSync(path.join(dir, `${String(n++).padStart(4, '0')}_${Math.round((f.metadata.timestamp - t0) * 1000)}.jpg`), Buffer.from(f.data, 'base64'));
        cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1, maxWidth: 2560, maxHeight: 1800 });
    await page.waitForTimeout(900);
    await page.click('#proof-eject');
    await page.waitForTimeout(2600);
    await page.click('#proof-eject');
    await page.waitForTimeout(1600);
    await cdp.send('Page.stopScreencast');
    await page.close();
    const py = spawnSync('python3', ['-c', `
import json, os, sys
from PIL import Image
d, out, box = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
files = sorted(f for f in os.listdir(d) if f.endswith('.jpg'))
ts = [int(f.split('_')[1][:-4]) for f in files]
sc = Image.open(os.path.join(d, files[0])).width / 1280
crop = tuple(round(box[k] * sc) for k in ('x', 'y', 'right', 'bottom'))
W, frames, durs, last = 880, [], [], -999
for i, f in enumerate(files):
    if ts[i] - last < 40 and i + 1 < len(files): continue
    im = Image.open(os.path.join(d, f)).convert('RGB').crop(crop)
    frames.append(im.resize((W, round(W * im.height / im.width)), Image.LANCZOS))
    if durs: durs[-1] = ts[i] - last
    durs.append(1200); last = ts[i]
frames[0].save(out, save_all=True, append_images=frames[1:], duration=durs, loop=0, quality=72, method=6)
`, dir, path.join(ROOT, 'docs/proof-eject.webp'), JSON.stringify(box)], { encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    if (py.status !== 0) throw new Error(py.stderr);
}

async function shareCard(browser, url) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, SAMPLE_FILE)));
    const img = D.decodeJpeg(bytes, 400);
    const { width, height } = D.readingSize(img.width * img.scale, img.height * img.scale, 400);
    const { theme } = C.extractPalette(D.areaDownscale(img.data, img.width, img.height, width, height), width, height, 5, { seed: 1 });
    const names = C.ROLE_NAMES[5];
    const swatches = C.ROLE_KEYS[5].map((key, i) => `<div class="sw" style="background:${theme[key]};color:${C.inkOn(theme[key])}"><b>${names[i]}</b><span>${theme[key]}</span></div>`).join('');
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.goto(url + 'gallery.html');
    await page.setContent(`<!doctype html><link rel="stylesheet" href="${url}fonts/fonts.css"><style>
        * { box-sizing: border-box; margin: 0; }
        body { width: 1200px; height: 630px; background: #111927; color: #F5F0E8; padding: 44px 56px; font-family: 'Space Grotesk'; overflow: hidden; }
        .mono { font-family: 'IBM Plex Mono'; font-weight: 600; letter-spacing: .12em; font-size: 15px; }
        .top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid #F5F0E8; }
        .tag { background: #F0EF00; color: #191C23; padding: 1px 8px; }
        .mast { display: flex; justify-content: space-between; align-items: flex-end; padding: 14px 0 20px; border-bottom: 5px double #F5F0E8; }
        h1 { font-family: 'Chakra Petch'; font-weight: 700; font-size: 150px; line-height: .86; letter-spacing: -.04em; text-shadow: .035em .025em 0 #00E5FF; }
        .side { text-align: right; }
        .side b { display: block; font-family: 'Chakra Petch'; font-size: 40px; letter-spacing: -.02em; line-height: 1; margin-bottom: 10px; }
        .body { display: grid; grid-template-columns: 430px 1fr; gap: 36px; margin-top: 28px; }
        .shot { position: relative; height: 252px; background: url(${url}${SAMPLE_FILE}) center / cover; }
        .shot::after { content: ''; position: absolute; inset: -8px; --c: #00E5FF; filter: drop-shadow(0 0 4px #00E5FF); background:
            linear-gradient(var(--c), var(--c)) left top / 24px 3px, linear-gradient(var(--c), var(--c)) left top / 3px 24px,
            linear-gradient(var(--c), var(--c)) right top / 24px 3px, linear-gradient(var(--c), var(--c)) right top / 3px 24px,
            linear-gradient(var(--c), var(--c)) left bottom / 24px 3px, linear-gradient(var(--c), var(--c)) left bottom / 3px 24px,
            linear-gradient(var(--c), var(--c)) right bottom / 24px 3px, linear-gradient(var(--c), var(--c)) right bottom / 3px 24px; background-repeat: no-repeat; }
        .kick { color: #00E5FF; }
        p { font-size: 28px; font-weight: 500; line-height: 1.22; margin: 14px 0 22px; }
        .bar { display: flex; border: 2px solid #F5F0E8; height: 118px; }
        .sw { flex: 1; padding: 10px 12px; display: flex; flex-direction: column; justify-content: space-between; font-size: 17px; }
        .sw b { font-family: 'Chakra Petch'; }
        .sw span { font-family: 'IBM Plex Mono'; font-weight: 600; font-size: 15px; }
    </style><div class="top mono"><span>VOL. 01 — SIGNAL EDITION</span><span>PALETTE.ETARC.NET</span><span class="tag">FILED</span></div>
    <div class="mast"><h1>PALETTE</h1><div class="side"><b>EXTRACTOR</b><span class="mono">A REGISTER OF COLOUR</span></div></div>
    <div class="body"><div class="shot"></div><div><span class="mono kick">ACCESSION — PE-2026-0001</span>
    <p>Five colours chosen by saliency, coverage and diversity — measured, proofed and filed.</p><div class="bar">${swatches}</div></div></div>`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(ROOT, 'og-image.png') });
    await page.close();
}

(async () => {
    const server = await start();
    const browser = await chromium.launch({ args: ['--mute-audio'] });
    await screenshot(browser, server.url);
    await ejectAnimation(browser, server.url);
    await shareCard(browser, server.url);
    await browser.close();
    server.close();
    for (const f of ['docs/screenshot.jpg', 'docs/proof-eject.webp', 'og-image.png']) {
        console.log(`${f}: ${Math.round(fs.statSync(path.join(ROOT, f)).size / 1024)} KB`);
    }
})();
