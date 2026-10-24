// Compare two folders of shots (npm run compare -- before/ after/).
// For each PNG in both: how many pixels changed and the box around them.
// A few stray pixels are font antialiasing jitter between runs, not a
// change, so files under NOISE changed pixels are reported as the same.
// Writes <after>/diff-<name>.png with the changed pixels in red over a dimmed copy.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const [a, b] = process.argv.slice(2).map(d => path.resolve(d || ''));
if (!a || !b) { console.error('usage: npm run compare -- <before dir> <after dir>'); process.exit(2); }
const NOISE = 100;

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    let changed = 0;
    for (const f of fs.readdirSync(a).filter(f => f.endsWith('.png') && !f.startsWith('diff-'))) {
        if (!fs.existsSync(path.join(b, f))) { console.log(`- ${f}: missing in ${path.basename(b)}`); continue; }
        const r = await page.evaluate(async ([x, y]) => {
            const load = s => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + s; });
            const [A, B] = await Promise.all([load(x), load(y)]);
            const w = Math.max(A.width, B.width), h = Math.max(A.height, B.height);
            const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
            const c = cv.getContext('2d');
            c.drawImage(A, 0, 0); const da = c.getImageData(0, 0, w, h).data;
            c.clearRect(0, 0, w, h);
            c.drawImage(B, 0, 0); const db = c.getImageData(0, 0, w, h);
            let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
            const out = db.data;
            for (let i = 0; i < out.length; i += 4) {
                const diff = da[i] !== out[i] || da[i + 1] !== out[i + 1] || da[i + 2] !== out[i + 2];
                if (diff) {
                    n++; const p = i / 4, X = p % w, Y = (p / w) | 0;
                    if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
                    out[i] = 255; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 255;
                } else { out[i] *= 0.3; out[i + 1] *= 0.3; out[i + 2] *= 0.3; }
            }
            c.putImageData(db, 0, 0);
            return { n, box: [x0, y0, x1, y1], size: `${A.width}×${A.height} → ${B.width}×${B.height}`, png: n ? cv.toDataURL().split(',')[1] : null };
        }, [fs.readFileSync(path.join(a, f)).toString('base64'), fs.readFileSync(path.join(b, f)).toString('base64')]);
        if (r.n < NOISE) { console.log(`= ${f}${r.n ? ` (${r.n} px of jitter)` : ''}`); continue; }
        changed++;
        fs.writeFileSync(path.join(b, 'diff-' + f), Buffer.from(r.png, 'base64'));
        console.log(`≠ ${f}: ${r.n} px changed in x ${r.box[0]}–${r.box[2]}, y ${r.box[1]}–${r.box[3]} (${r.size}) → diff-${f}`);
    }
    await browser.close();
    console.log(changed ? `\n${changed} shot(s) changed` : '\nno visible change');
})();
