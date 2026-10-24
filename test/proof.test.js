// Run with: node --test
// The proof worker, run as it is: proof-worker.js and color.js are loaded
// into one context that stands in for the worker's global scope, a message
// goes in through self.onmessage and the plates come back through postMessage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function worker() {
    const replies = [];
    const self = { postMessage: r => replies.push(r) };
    const ctx = vm.createContext({ self, console, Math });
    ctx.importScripts = (...files) => files.forEach(f => vm.runInContext(read(f), ctx, { filename: f }));
    vm.runInContext(read('proof-worker.js'), ctx, { filename: 'proof-worker.js' });
    const send = m => { const before = replies.length; self.onmessage({ data: m }); return replies.length > before ? replies[replies.length - 1] : null; };
    return { send, hexToRgb: ctx.hexToRgb };
}

const THEME = { bg: '#1A1A1A', secondary: '#F5F0E8', primary: '#EF4444', accent: '#3B82F6', text: '#E8C547' };

// A working-size source as proof.js sends it: w × h RGBA, 16:9
function source(paint, { w = 480, imgId = 1 } = {}) {
    const h = w / 16 * 9;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const [r, g, b, a = 255] = paint(x / w, y / h);
        const i = (y * w + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
    return { imgId, data, w, h, soft: 1, crop: { x: 0, y: 0, w, h }, object: false, srcW: w, srcH: h };
}

// A small scene with every kind of edge: dark ground, light sky, a red
// sign, a blue disc, a yellow stripe and a lightness ramp for tone
const scene = (u, v) => {
    if ((u - 0.7) ** 2 + (v - 0.4) ** 2 < 0.02) return [59, 130, 246];
    if (u > 0.15 && u < 0.35 && v > 0.2 && v < 0.6) return [239, 68, 68];
    if (v > 0.75 && v < 0.8) return [232, 197, 71];
    if (v < 0.5) { const t = 200 + Math.round(45 * u); return [t, t - 5, t - 15]; }
    return [26, 26, 26];
};

const message = (src, { W = 960, theme = THEME, shown = theme, id = 1 } = {}) =>
    ({ id, W, H: W / 16 * 9, theme, shown, src });

// Per pixel: how many plates print it, and in which colour
function plateStats(reply, W) {
    const n = W * (W / 16 * 9);
    const hits = new Uint8Array(n);
    const colours = reply.plates.map(buf => {
        const px = new Uint8ClampedArray(buf);
        const seen = new Set();
        let count = 0;
        for (let p = 0; p < n; p++) if (px[p * 4 + 3]) {
            hits[p]++; count++;
            seen.add('#' + [0, 1, 2].map(c => px[p * 4 + c].toString(16).padStart(2, '0')).join('').toUpperCase());
        }
        return { seen, count, bytes: px.length };
    });
    return { hits, colours, n };
}

test('one plate per ink plus K, each the size of the frame', () => {
    const r = worker().send(message(source(scene)));
    assert.equal(r.plates.length, Object.keys(THEME).length + 1);
    for (const buf of r.plates) assert.equal(buf.byteLength, 960 * 540 * 4);
    assert.equal(r.id, 1);
});

test('every pixel is printed by exactly one plate', () => {
    const r = worker().send(message(source(scene)));
    const { hits, n } = plateStats(r, 960);
    let none = 0, many = 0;
    for (let p = 0; p < n; p++) { if (hits[p] === 0) none++; else if (hits[p] > 1) many++; }
    assert.equal(none, 0, `${none} pixels on no plate`);
    assert.equal(many, 0, `${many} pixels on more than one plate`);
});

test('plates print only the palette inks, each plate one ink, K in the darkest', () => {
    const r = worker().send(message(source(scene)));
    const { colours } = plateStats(r, 960);
    const inks = new Set(Object.values(THEME));
    for (const { seen } of colours) {
        assert.ok(seen.size <= 1, `a plate holds ${[...seen].join(', ')}`);
        for (const c of seen) assert.ok(inks.has(c), `${c} is not a palette ink`);
    }
    assert.deepEqual([...colours[colours.length - 1].seen], ['#1A1A1A']);
    assert.ok(r.lineShare > 0 && r.lineShare < 0.5, `line share ${r.lineShare}`);
});

test('ink plates are stacked by area, the largest at the bottom', () => {
    const r = worker().send(message(source(scene)));
    const counts = plateStats(r, 960).colours.slice(0, -1).map(c => c.count);
    for (let i = 1; i < counts.length; i++) assert.ok(counts[i] <= counts[i - 1], `plate ${i} (${counts[i]}) above a smaller one (${counts[i - 1]})`);
});

test('the shown theme sets the inks; the analysis is kept for the same image and palette', () => {
    const w = worker();
    w.send(message(source(scene)));
    const shown = { bg: '#F5F0E8', secondary: '#1A1A1A', primary: '#3B82F6', accent: '#EF4444', text: '#333333' };
    const r = w.send(message(null, { shown, id: 2 }));          // no pixels sent: the cached cut is reused
    assert.ok(r, 'a cached cut must still be printed');
    const used = new Set(plateStats(r, 960).colours.flatMap(c => [...c.seen]));
    for (const c of used) assert.ok(Object.values(shown).includes(c), `${c} is not in the shown theme`);
});

test('nothing is printed before any image has been sent', () => {
    assert.equal(worker().send(message(null)), null);
});

test('a cut-out prints nothing where it is transparent', () => {
    const cutout = (u, v) => ((u - 0.5) ** 2 + (v - 0.5) ** 2 < 0.05 ? [239, 68, 68, 255] : [0, 0, 0, 0]);
    const src = source(cutout);
    src.object = true;
    const r = worker().send(message(src));
    const { hits } = plateStats(r, 960);
    // the frame's corners lie outside the disc
    for (const p of [0, 959, 960 * 539, 960 * 540 - 1]) assert.equal(hits[p], 0, `corner pixel ${p} printed`);
    assert.equal(hits[270 * 960 + 480], 1, 'the disc centre is printed once');
});

for (const [name, paint] of [
    ['pure white', () => [255, 255, 255]],
    ['pure black', () => [0, 0, 0]],
    ['two colours', u => (u < 0.5 ? [239, 68, 68] : [59, 130, 246])],
    ['one pixel of colour in grey', (u, v) => (Math.abs(u - 0.5) < 0.002 && Math.abs(v - 0.5) < 0.004 ? [255, 0, 0] : [128, 128, 128])],
    ['noise', () => [Math.random() * 256, Math.random() * 256, Math.random() * 256]]
]) {
    test(`edge case: ${name} still gives a full set of plates`, () => {
        const r = worker().send(message(source(paint)));
        assert.equal(r.plates.length, 6);
        const { hits, n } = plateStats(r, 960);
        let wrong = 0;
        for (let p = 0; p < n; p++) if (hits[p] !== 1) wrong++;
        assert.equal(wrong, 0, `${wrong} pixels not on exactly one plate`);
    });
}

test('a larger frame (1920 wide) keeps the same plate count and coverage per ink', () => {
    const small = plateStats(worker().send(message(source(scene))), 960);
    const big = plateStats(worker().send(message(source(scene, { w: 1024 }), { W: 1920 })), 1920);
    assert.equal(big.colours.length, small.colours.length);
    // each ink covers about the same share of the frame at either size
    const share = s => Object.fromEntries(s.colours.map(c => [[...c.seen][0], c.count / s.n]));
    const a = share(small), b = share(big);
    for (const ink of Object.keys(a)) if (ink !== 'undefined') assert.ok(Math.abs(a[ink] - (b[ink] ?? 0)) < 0.06, `${ink}: ${a[ink].toFixed(3)} vs ${(b[ink] ?? 0).toFixed(3)}`);
});
