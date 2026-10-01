// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../color.js');

// Solid-colour blocks laid side by side: [{ rgb: [r,g,b], w: columns }]
function blocks(spec, height = 20) {
    const width = spec.reduce((s, b) => s + b.w, 0);
    const data = new Uint8ClampedArray(width * height * 4);
    let x0 = 0;
    for (const { rgb, w } of spec) {
        for (let y = 0; y < height; y++) {
            for (let x = x0; x < x0 + w; x++) {
                const i = (y * width + x) * 4;
                data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
            }
        }
        x0 += w;
    }
    return { data, width, height };
}

test('OKLab round trip is within 1 per channel', () => {
    let worst = 0;
    for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) {
        const ok = C.rgbToOklab(r, g, b);
        const back = C.oklabToRgb(ok.L, ok.a, ok.b);
        worst = Math.max(worst, Math.abs(back.r - r), Math.abs(back.g - g), Math.abs(back.b - b));
    }
    assert.ok(worst <= 1, `worst channel error ${worst}`);
});

test('black on white contrast is ~21', () => {
    const ratio = C.contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    assert.ok(Math.abs(ratio - 21) < 0.01, `got ${ratio}`);
});

test('k-means recovers three known solid colours exactly', () => {
    const truth = [[220, 40, 40], [30, 160, 70], [40, 70, 200]];
    const img = blocks(truth.map(rgb => ({ rgb, w: 30 })));
    const hist = C.buildHistogram(img.data, img.width, img.height);
    const { centroids, counts } = C.kmeans(hist.bins, 3, { seed: 1 });
    for (const [r, g, b] of truth) {
        assert.ok(centroids.some(c => c.r === r && c.g === g && c.b === b), `missing ${r},${g},${b}`);
    }
    assert.deepEqual(counts.slice().sort(), [600, 600, 600]);
});

test('final assignment is consistent with reported centroids', () => {
    const img = blocks([{ rgb: [250, 245, 235], w: 50 }, { rgb: [20, 20, 30], w: 20 }, { rgb: [200, 60, 30], w: 10 }]);
    const hist = C.buildHistogram(img.data, img.width, img.height);
    let last;
    C.kmeans(hist.bins, 3, { seed: 4, onFrame: f => { last = f; } });
    assert.ok(last.final);
    hist.bins.forEach((bin, i) => {
        const dists = last.centroids.map(c => C.colorDistanceOklab(bin.oklab, C.rgbToOklab(c.r, c.g, c.b)));
        assert.equal(last.assign[i], dists.indexOf(Math.min(...dists)));
    });
});

test('same seed gives identical results', () => {
    const rand = C.mulberry32(99);
    const width = 60, height = 60;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = rand() * 256; data[i + 1] = rand() * 256; data[i + 2] = rand() * 256; data[i + 3] = 255;
    }
    for (const k of [3, 5, 8]) {
        const a = C.extractPalette(data, width, height, k, { seed: 7 });
        const b = C.extractPalette(data, width, height, k, { seed: 7 });
        assert.deepEqual(a, b);
    }
});

test('background is chosen by area, not by lightness', () => {
    // 80% dark navy, light text, red accent — a dark-mode screenshot
    const img = blocks([{ rgb: [18, 22, 40], w: 80 }, { rgb: [235, 235, 240], w: 12 }, { rgb: [220, 50, 50], w: 8 }]);
    const p = C.extractPalette(img.data, img.width, img.height, 3);
    assert.equal(p.theme.bg, '#121628');
    assert.equal(p.theme.text, '#EBEBF0');
    assert.equal(p.theme.primary, '#DC3232');
    assert.equal(p.coverage, 20);
});

test('role assignment is a permutation and repaired TEXT/BASE contrast >= 4.5', () => {
    const rand = C.mulberry32(2024);
    for (let trial = 0; trial < 150; trial++) {
        const k = 3 + (trial % 6);
        const colors = Array.from({ length: k }, () => ({
            r: Math.floor(rand() * 256), g: Math.floor(rand() * 256), b: Math.floor(rand() * 256), share: rand()
        }));
        const order = C.assignRoles(colors, C.ROLE_KEYS[k]);
        assert.equal(new Set(order).size, k, `duplicate role colour in ${order}`);

        const counts = colors.map(c => Math.round(c.share * 1000) + 1);
        const p = C.buildPalette(colors, counts, k);
        const bg = C.hexToRgb(p.theme.bg);
        assert.ok(C.contrastRatio(C.hexToRgb(p.theme.text), bg) >= 4.5, `text ${p.theme.text} on ${p.theme.bg}`);
        assert.ok(C.contrastRatio(C.hexToRgb(p.theme.primary), bg) >= 3, `primary ${p.theme.primary} on ${p.theme.bg}`);
    }
});

test('contrast repair keeps hue and is flagged', () => {
    // mid-grey bg with slightly lighter blue "text" — must be pushed lighter or darker
    const p = C.buildPalette([{ r: 120, g: 120, b: 120 }, { r: 140, g: 150, b: 190 }, { r: 200, g: 40, b: 40 }], [80, 10, 10], 3);
    assert.ok(p.adjusted.text, 'text should be marked as adjusted');
    const before = C.toLch(C.hexToRgb(p.adjusted.text)), after = C.toLch(C.hexToRgb(p.theme.text));
    if (after.C > 0.02) assert.ok(C.hueDistance(before, after) < 0.05, 'hue drifted');
});

test('near-grey image is flagged as low chroma', () => {
    const img = blocks([{ rgb: [240, 238, 235], w: 40 }, { rgb: [128, 126, 124], w: 30 }, { rgb: [30, 30, 32], w: 30 }]);
    assert.equal(C.extractPalette(img.data, img.width, img.height, 3).lowChroma, true);
});

test('fewer colours than k: fills are generated, distinct and flagged', () => {
    const img = blocks([{ rgb: [239, 230, 210], w: 90 }, { rgb: [31, 42, 68], w: 8 }, { rgb: [230, 57, 70], w: 2 }]);
    const p = C.extractPalette(img.data, img.width, img.height, 6);
    const hexes = Object.values(p.theme);
    assert.equal(new Set(hexes).size, hexes.length, `duplicates in ${hexes}`);
    assert.equal(Object.keys(p.generated).length, 3);
    assert.ok(!hexes.includes('#000000'));
});

test('score breakdown exists for every role', () => {
    const img = blocks([{ rgb: [18, 22, 40], w: 60 }, { rgb: [235, 235, 240], w: 20 }, { rgb: [220, 50, 50], w: 10 },
        { rgb: [40, 180, 120], w: 10 }, { rgb: [60, 70, 100], w: 10 }]);
    const p = C.extractPalette(img.data, img.width, img.height, 5);
    for (const key of C.ROLE_KEYS[5]) assert.ok(Object.keys(p.scores[key]).length > 0, key);
    assert.ok(p.error >= 0 && p.error < 0.01, `solid blocks should reconstruct ~exactly, got ${p.error}`);
});

test('pixels below alpha 128 are ignored', () => {
    const img = blocks([{ rgb: [255, 0, 0], w: 10 }, { rgb: [0, 0, 255], w: 10 }]);
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i - 1] === 255) img.data[i] = 60; // fade the blue half
    assert.equal(C.buildHistogram(img.data, img.width, img.height).bins.length, 1);
});

test('tonal scale is monotonic in lightness and keeps hue', () => {
    const scale = C.tonalScale('#2E7DD7');
    const ls = C.SCALE_STEPS.map(s => C.toLch(C.hexToRgb(scale[s])));
    for (let i = 1; i < ls.length; i++) assert.ok(ls[i].L < ls[i - 1].L, `step ${C.SCALE_STEPS[i]}`);
    const base = C.toLch(C.hexToRgb('#2E7DD7'));
    for (const l of ls.slice(2, 9)) assert.ok(C.hueDistance(l, base) < 0.05);
});

test('inverted theme flips mode and keeps contrast', () => {
    const light = { bg: '#FAFAF7', secondary: '#222222', primary: '#0B63CE', accent: '#E89C30', text: '#111111' };
    const dark = C.invertTheme(light);
    assert.equal(C.isDarkTheme(light), false);
    assert.equal(C.isDarkTheme(dark), true);
    const bg = C.hexToRgb(dark.bg);
    assert.ok(C.contrastRatio(C.hexToRgb(dark.text), bg) >= 4.5);
    assert.ok(C.contrastRatio(C.hexToRgb(dark.primary), bg) >= 3);
});

test('CVD: red/green pair collapses for deutan, red/blue does not', () => {
    const w = C.cvdWarnings({ primary: '#D43C3C', accent: '#4C9A2A' });
    assert.ok(w.some(x => x.type === 'deutan'), JSON.stringify(w));
    assert.ok(!C.cvdWarnings({ primary: '#D43C3C', accent: '#2850D0' }).some(x => x.type === 'deutan'));
});

test('APCA reference values', () => {
    const black = { r: 0, g: 0, b: 0 }, white = { r: 255, g: 255, b: 255 };
    assert.ok(Math.abs(C.apcaContrast(black, white) - 106.04) < 0.1);
    assert.ok(Math.abs(C.apcaContrast(white, black) + 107.88) < 0.1);
    assert.ok(Math.abs(C.apcaContrast({ r: 136, g: 136, b: 136 }, white) - 63.06) < 0.2);
});
