// Reference screenshots for checking a visual change (npm run shots [dir]).
// Desktop 1400 px in Chromium and an iPhone 13 in WebKit, each: the empty
// page, the page with the first sample filed, and the proof taken apart.
// Reduced motion is on so every shot is the settled page (no title cards
// mid-cut, no press run), and the same sample and seed give the same colours
// run after run: shoot before a change, shoot after, compare. The page's
// clock is fixed, so dates and the accession time don't change either.
const { chromium, webkit, devices } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./serve');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'shots'));
const URL = process.env.URL;   // shoot the live site instead: URL=https://palette.etarc.net/ npm run shots

const SETS = [
    ['desktop', chromium, { viewport: { width: 1400, height: 900 } }],
    ['phone', webkit, { ...devices['iPhone 13'] }],
];

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const server = URL ? null : await start();
    const base = URL || server.url;
    const made = [];
    for (const [name, type, opts] of SETS) {
        const browser = await type.launch();
        const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' });
        await ctx.clock.setFixedTime(new Date('2026-01-01T12:00:00'));
        const page = await ctx.newPage();
        const shot = async (label, target = page, full = true) => {
            const file = path.join(OUT, `${name}-${label}.png`);
            await (target === page ? page.screenshot({ path: file, fullPage: full }) : target.screenshot({ path: file }));
            made.push(file);
        };
        await page.goto(base, { waitUntil: 'networkidle' });
        // fonts, and the sample thumbnails (CSS backgrounds, which networkidle can miss)
        await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.querySelectorAll('.sample')].map(b => {
            const i = new Image(); i.src = b.dataset.thumb; return i.decode().catch(() => {});
        })]));
        if (URL) await page.waitForTimeout(1500);   // over the network a decoded thumbnail can still be a frame from painted
        await shot('1-empty');

        await page.locator('.sample').first().click();
        await page.waitForFunction(() => document.getElementById('acc-status').textContent === 'FILED');
        await page.waitForFunction(() => !document.getElementById('proof-stage').classList.contains('empty'));
        await page.waitForTimeout(300);
        await shot('2-filed');

        const stage = page.locator('#proof-stage');
        await stage.scrollIntoViewIfNeeded();
        await stage.focus();
        await page.keyboard.press('End');
        await page.waitForTimeout(300);
        await shot('3-proof-apart', page.locator('#proof-screen'));
        await browser.close();
    }
    if (server) server.close();
    console.log(made.map(f => path.relative(process.cwd(), f)).join('\n'));
})();
