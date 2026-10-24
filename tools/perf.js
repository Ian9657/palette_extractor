// Load-time measurements of the live site (npm run perf [url]).
// Chromium, cold cache, three profiles: unthrottled, a mid phone
// (4× slower CPU, fast 4G) and a slow phone (6× CPU, slow 4G). Reports
// first paint, when the press run has finished (the page is usable), the
// bytes fetched by type, the main-thread time per script, and the time from
// a sample click to the palette filed and to the proof developed.
const { chromium } = require('playwright');

const URL = process.argv[2] || 'https://palette.etarc.net/';
const PROFILES = [
    ['desktop', 1, null],
    ['mid phone', 4, { latency: 150, downloadThroughput: 1.6e6 / 8 * 9, uploadThroughput: 750e3 / 8 }],
    ['slow phone', 6, { latency: 300, downloadThroughput: 400e3 / 8 * 4, uploadThroughput: 400e3 / 8 }],
];

(async () => {
    const browser = await chromium.launch();
    for (const [name, cpu, net] of PROFILES) {
        const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        const page = await ctx.newPage();
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        if (net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...net });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

        const bytes = {};
        cdp.on('Network.loadingFinished', e => { bytes[e.requestId] = { ...(bytes[e.requestId] || {}), size: e.encodedDataLength }; });
        cdp.on('Network.responseReceived', e => { bytes[e.requestId] = { ...(bytes[e.requestId] || {}), type: e.type, url: e.response.url }; });

        const t0 = Date.now();
        await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(() => !document.documentElement.classList.contains('booting'), null, { timeout: 60000 });
        const usableMs = Date.now() - t0;
        const nav = await page.evaluate(() => {
            const n = performance.getEntriesByType('navigation')[0];
            const fcp = performance.getEntriesByName('first-contentful-paint')[0];
            return { fcp: fcp && Math.round(fcp.startTime), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) };
        });
        const scripts = await page.evaluate(() => performance.getEntriesByType('resource')
            .filter(r => r.initiatorType === 'script' || r.name.endsWith('.js'))
            .map(r => [r.name.split('/').pop(), Math.round(r.responseEnd)]));

        const t1 = Date.now();
        await page.locator('.sample').first().click();
        await page.waitForFunction(() => document.getElementById('acc-status').textContent === 'FILED', null, { timeout: 120000 });
        const filedMs = Date.now() - t1;
        await page.waitForFunction(() => !document.getElementById('proof-stage').classList.contains('empty'), null, { timeout: 120000 });
        const proofMs = Date.now() - t1;
        const heap = (await cdp.send('Performance.enable'), await cdp.send('Performance.getMetrics')).metrics
            .find(m => m.name === 'JSHeapUsedSize').value;

        const byType = {};
        for (const r of Object.values(bytes)) if (r.size) byType[r.type || 'Other'] = (byType[r.type || 'Other'] || 0) + r.size;
        const kb = n => (n / 1024).toFixed(0) + ' KB';
        console.log(`\n== ${name} (CPU ×${cpu}${net ? `, ${net.latency} ms RTT` : ''})`);
        console.log(`first paint ${nav.fcp} ms · DOM ready ${nav.dcl} ms · load ${nav.load} ms · usable (press run done) ${usableMs} ms`);
        console.log(`sample → filed ${filedMs} ms · → proof ${proofMs} ms · page JS heap ${(heap / 1048576).toFixed(1)} MB`);
        console.log('bytes: ' + Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${kb(n)}`).join(' · '));
        console.log('scripts finished at: ' + scripts.map(([f, t]) => `${f} ${t}`).join(' · '));
        await ctx.close();
    }
    await browser.close();
})();
