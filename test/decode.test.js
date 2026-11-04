const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../public/js/decode.js');
const C = require('../public/js/color.js');

const root = path.join(__dirname, '..');
const fixture = name => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', name)));
const W = 96, H = 64;

// What tools/make-jpeg-fixtures.py painted at (x, y)
const painted = (x, y) => (x < 16 && y < 16 ? [230, 30, 30] : [40 + x * 2, 200 - y * 2, 60 + x + y]);

function meanError(img, skipEdge = 2) {
    let sum = 0, n = 0;
    for (let y = skipEdge; y < H - skipEdge; y++) {
        for (let x = skipEdge; x < W - skipEdge; x++) {
            if (x > 13 && x < 18 && y < 18) continue;   // the marker block's edge rings under JPEG
            if (y > 13 && y < 18 && x < 18) continue;
            const want = painted(x, y), i = (y * W + x) * 4;
            for (let c = 0; c < 3; c++) { sum += Math.abs(img.data[i + c] - want[c]); n++; }
        }
    }
    return sum / n;
}

for (const name of ['baseline-420', 'baseline-422', 'baseline-444', 'progressive-420', 'progressive-444', 'restart', 'progressive-restart', 'icc-srgb']) {
    test(`${name}: reads back what was painted`, () => {
        const img = D.decodeJpeg(fixture(name + '.jpg'));
        assert.equal(img.width, W);
        assert.equal(img.height, H);
        assert.ok(meanError(img) < 2.5, `mean error ${meanError(img)}`);
    });
}

test('progressive and baseline decode to the same pixels at 4:4:4 quality', () => {
    const a = D.decodeJpeg(fixture('baseline-444.jpg')), b = D.decodeJpeg(fixture('progressive-444.jpg'));
    assert.equal(D.pixelChecksum(a.data), D.pixelChecksum(b.data));
});

test('restart markers change nothing', () => {
    const a = D.decodeJpeg(fixture('baseline-420.jpg')), b = D.decodeJpeg(fixture('restart.jpg'));
    assert.equal(D.pixelChecksum(a.data), D.pixelChecksum(b.data));
});

for (let o = 2; o <= 8; o++) {
    test(`EXIF orientation ${o} brings the marker back to the top left`, () => {
        const img = D.decodeJpeg(fixture(`orientation-${o}.jpg`));
        assert.deepEqual([img.width, img.height], [W, H]);
        assert.ok(meanError(img) < 2.5, `mean error ${meanError(img)}`);
    });
}

test('greyscale gives equal channels', () => {
    const { data } = D.decodeJpeg(fixture('grey.jpg'));
    for (let i = 0; i < data.length; i += 4) {
        assert.equal(data[i], data[i + 1]);
        assert.equal(data[i], data[i + 2]);
        assert.equal(data[i + 3], 255);
    }
});

test('a Display P3 file is converted to sRGB: the same numbers mean a more saturated colour', () => {
    const p3 = D.decodeJpeg(fixture('icc-display-p3.jpg')).data, srgb = D.decodeJpeg(fixture('icc-srgb.jpg')).data;
    assert.ok(p3[0] > srgb[0] + 10, `red ${p3[0]} vs ${srgb[0]}`);
    assert.ok(p3[1] < srgb[1], `green ${p3[1]} vs ${srgb[1]}`);
});

test('a profile with sRGB primaries leaves the pixels alone', () => {
    const a = D.decodeJpeg(fixture('icc-srgb.jpg')), b = D.decodeJpeg(fixture('baseline-444.jpg'));
    assert.equal(D.pixelChecksum(a.data), D.pixelChecksum(b.data));
});

test('CMYK and non-JPEG files go back to the browser', () => {
    assert.equal(D.decodeJpeg(fixture('cmyk.jpg')), null);
    assert.equal(D.decodeJpeg(new Uint8Array(fs.readFileSync(path.join(root, 'regression', 'flat-illustration.png')))), null);
    assert.equal(D.decodeJpeg(new Uint8Array(0)), null);
});

test('a truncated file still gives a full image, and garbage after the header does not throw', () => {
    const img = D.decodeJpeg(fixture('truncated.jpg'));
    assert.deepEqual([img.width, img.height], [W, H]);
    const noisy = fixture('baseline-420.jpg');
    for (let i = noisy.length >> 1; i < noisy.length; i += 7) noisy[i] = (i * 31) & 255;
    D.decodeJpeg(noisy);
});

test('far above the reading size, DC terms stand in for pixels', () => {
    const img = D.decodeJpeg(fixture('baseline-444.jpg'), 8);
    assert.deepEqual([img.width, img.height, img.scale], [12, 8, 8]);
    const full = D.decodeJpeg(fixture('baseline-444.jpg'));
    const small = D.areaDownscale(full.data, W, H, 12, 8);
    for (let i = 0; i < small.length; i++) assert.ok(Math.abs(small[i] - img.data[i]) <= 2, `byte ${i}`);
});

test('area downscale keeps the mean, and transparent pixels lend no colour', () => {
    const src = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]);
    const out = D.areaDownscale(src, 2, 1, 1, 1);
    assert.deepEqual([...out], [255, 0, 0, 128]);
    const flat = new Uint8ClampedArray(16 * 4).fill(100);
    assert.deepEqual([...D.areaDownscale(flat, 4, 4, 2, 2)], new Array(16).fill(100));
});

test('reading size: longest side capped, never upscaled, never zero', () => {
    assert.deepEqual(D.readingSize(1920, 1440, 400), { width: 400, height: 300 });
    assert.deepEqual(D.readingSize(58, 62, 400), { width: 58, height: 62 });
    assert.deepEqual(D.readingSize(40, 3000, 400), { width: 5, height: 400 });
    assert.deepEqual(D.readingSize(1, 8000, 400), { width: 1, height: 400 });
});

// The records themselves. tools/cross.js checks Chromium and WebKit against this
// same file, so a green run here and there means the same image gives the same
// record in Node, Chrome and Safari. After a deliberate algorithm change:
//   UPDATE_RECORDS=1 node --test test/decode.test.js
const RECORDS = path.join(__dirname, 'records.json');
test('every JPEG in the repo still gives its recorded checksum and palettes', () => {
    // Records are keyed samples/x.jpg and regression/x.jpg, whatever folder those live in.
    const dirs = { samples: path.join(root, 'public', 'samples'), regression: path.join(root, 'regression') };
    const files = Object.keys(dirs).flatMap(dir => fs.readdirSync(dirs[dir])
        .filter(f => f.endsWith('.jpg')).map(f => `${dir}/${f}`));
    const now = {};
    for (const file of files) {
        const img = D.decodeJpeg(new Uint8Array(fs.readFileSync(path.join(dirs[file.split('/')[0]], path.basename(file)))), 400);
        const { width, height } = D.readingSize(img.width * img.scale, img.height * img.scale, 400);
        const data = D.areaDownscale(img.data, img.width, img.height, width, height);
        now[file] = { checksum: D.pixelChecksum(data), palettes: {} };
        for (const k of [3, 5, 8]) now[file].palettes[k] = C.extractPalette(data, width, height, k, { seed: 1 }).theme;
    }
    if (process.env.UPDATE_RECORDS) fs.writeFileSync(RECORDS, JSON.stringify(now, null, 1) + '\n');
    assert.deepEqual(now, JSON.parse(fs.readFileSync(RECORDS, 'utf8')));
});
