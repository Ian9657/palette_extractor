// Pure colour logic — no DOM. Loaded as a classic <script> in the browser
// (functions become globals), required as CommonJS in Node tests, and the
// k-means half is stringified into the Web Worker via fn.toString().
// Functions that run in the worker must only reference other functions in
// WORKER_FUNCTIONS (see bottom), never top-level constants.

const ROLE_NAMES = {
    3: ['BASE', 'PRIMARY', 'TEXT'],
    4: ['BASE', 'SECOND', 'PRIMARY', 'TEXT'],
    5: ['BASE', 'SECOND', 'PRIMARY', 'ACCENT', 'TEXT'],
    6: ['BASE', 'SURFACE', 'SECOND', 'PRIMARY', 'ACCENT', 'TEXT'],
    7: ['BASE', 'SURFACE', 'SECOND', 'PRIMARY', 'ACCENT', 'HILITE', 'TEXT'],
    8: ['BASE', 'SURFACE', 'SECOND', 'MUTED', 'PRIMARY', 'ACCENT', 'HILITE', 'TEXT']
};

const ROLE_KEYS = {
    3: ['bg', 'primary', 'text'],
    4: ['bg', 'secondary', 'primary', 'text'],
    5: ['bg', 'secondary', 'primary', 'accent', 'text'],
    6: ['bg', 'surface', 'secondary', 'primary', 'accent', 'text'],
    7: ['bg', 'surface', 'secondary', 'primary', 'accent', 'highlight', 'text'],
    8: ['bg', 'surface', 'secondary', 'muted', 'primary', 'accent', 'highlight', 'text']
};

const MIN_CONTRAST = { text: 4.5, primary: 3 };
const LOW_CHROMA = 0.03;
// Pixels below this alpha are mostly anti-aliased edge garbage
const MIN_ALPHA = 128;

// ---- Conversions ----
function srgbToLinear(v) {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(x) {
    x = Math.min(1, Math.max(0, x));
    return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
}

function rgbToOklab(r, g, b) {
    const r_l = srgbToLinear(r), g_l = srgbToLinear(g), b_l = srgbToLinear(b);
    const l = 0.4122214708 * r_l + 0.5363325363 * g_l + 0.0514459929 * b_l;
    const m = 0.2119034982 * r_l + 0.6806995451 * g_l + 0.1073969566 * b_l;
    const s = 0.0883024619 * r_l + 0.2817188376 * g_l + 0.6299787005 * b_l;
    const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    return {
        L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    };
}

// Unclamped linear sRGB; components outside 0..1 mean out of gamut
function oklabToLinearRgb(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return [
         4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
}

function oklabToRgb(L, a, b) {
    const lin = oklabToLinearRgb(L, a, b);
    return { r: linearToSrgb(lin[0]), g: linearToSrgb(lin[1]), b: linearToSrgb(lin[2]) };
}

function colorDistanceOklab(c1, c2) {
    const dL = c1.L - c2.L, da = c1.a - c2.a, db = c1.b - c2.b;
    return Math.sqrt(dL * dL + da * da + db * db);
}

// OKLCH → sRGB, shrinking chroma (not clipping channels) so hue survives
function lchToRgb(L, C, H) {
    L = Math.min(1, Math.max(0, L));
    for (let i = 0; i < 60 && C > 1e-4; i++) {
        const lin = oklabToLinearRgb(L, C * Math.cos(H), C * Math.sin(H));
        if (lin.every(v => v >= -1e-4 && v <= 1 + 1e-4)) break;
        C *= 0.93;
    }
    return oklabToRgb(L, C * Math.cos(H), C * Math.sin(H));
}

function rgbToHex({ r, g, b }) {
    return '#' + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1).toUpperCase();
}

function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

// ---- WCAG ----
function relativeLuminance({ r, g, b }) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(c1, c2) {
    const l1 = relativeLuminance(c1), l2 = relativeLuminance(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Ink colour (#1a1a1a or paper) that reads on top of a swatch
function inkOn(hex) {
    const { r, g, b } = hexToRgb(hex);
    return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? '#1a1a1a' : '#F5F0E8';
}

// ---- Seeded RNG ----
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---- Histogram: 5-bit-per-channel bins, each carrying the mean of its real pixels ----
function buildHistogram(data, width, height, rect) {
    rect = rect || { x: 0, y: 0, w: width, h: height };
    const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(width, Math.ceil(rect.x + rect.w)), y1 = Math.min(height, Math.ceil(rect.y + rect.h));

    const binOf = new Int32Array(32768).fill(-1);
    const sums = [];
    const offsets = [], pixelBins = [];
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            if (data[i + 3] < MIN_ALPHA) continue;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
            let bin = binOf[key];
            if (bin < 0) { bin = binOf[key] = sums.length; sums.push([0, 0, 0, 0]); }
            const s = sums[bin];
            s[0] += r; s[1] += g; s[2] += b; s[3]++;
            offsets.push(i);
            pixelBins.push(bin);
        }
    }

    const bins = sums.map(([sr, sg, sb, n]) => {
        const r = Math.round(sr / n), g = Math.round(sg / n), b = Math.round(sb / n);
        const oklab = rgbToOklab(r, g, b);
        const chroma = Math.sqrt(oklab.a * oklab.a + oklab.b * oklab.b);
        return { r, g, b, oklab, count: n, weight: n * (1 + Math.min(chroma * 10, 5)) };
    });
    return { bins, offsets: Int32Array.from(offsets), pixelBins: Int32Array.from(pixelBins), total: offsets.length };
}

// ---- K-means (worker-safe) ----
function initKMeansPP(items, k, rand) {
    const cents = [items[Math.floor(rand() * items.length)]];
    const d2 = new Float64Array(items.length).fill(Infinity);
    while (cents.length < k) {
        const last = cents[cents.length - 1];
        let total = 0;
        for (let i = 0; i < items.length; i++) {
            const d = colorDistanceOklab(items[i].oklab, last.oklab);
            d2[i] = Math.min(d2[i], d * d);
            total += d2[i] * items[i].weight;
        }
        if (total === 0) break; // fewer distinct colours than k
        let r = rand() * total, pick = items.length - 1;
        for (let i = 0; i < items.length; i++) {
            r -= d2[i] * items[i].weight;
            if (r <= 0) { pick = i; break; }
        }
        cents.push(items[pick]);
    }
    return cents;
}

// bins: [{ r, g, b, oklab, count, weight }]. onFrame receives every iteration;
// the last call has final: true, assignments matching the returned colours.
function kmeans(bins, k, opts) {
    const seed = (opts && opts.seed) || 1;
    const maxIter = (opts && opts.maxIter) || 15;
    const onFrame = opts && opts.onFrame;
    const n = bins.length;
    if (n === 0) return { centroids: [], assign: new Uint8Array(0), counts: [] };
    const rand = mulberry32(seed);

    let cents = initKMeansPP(bins, Math.min(k, n), rand)
        .map(b => ({ r: b.r, g: b.g, b: b.b, oklab: b.oklab }));
    const kk = cents.length;
    const assign = new Uint8Array(n);

    function assignAll() {
        for (let i = 0; i < n; i++) {
            let best = Infinity, bi = 0;
            for (let j = 0; j < kk; j++) {
                const d = colorDistanceOklab(bins[i].oklab, cents[j].oklab);
                if (d < best) { best = d; bi = j; }
            }
            assign[i] = bi;
        }
    }
    function emit(iter, final, counts) {
        if (onFrame) onFrame({
            iter, maxIter, final, counts,
            centroids: cents.map(c => ({ r: c.r, g: c.g, b: c.b })),
            assign: assign.slice()
        });
    }

    for (let iter = 0; iter < maxIter; iter++) {
        assignAll();

        // Weighted mean in OKLab, the same space the distances are measured in
        const sums = Array.from({ length: kk }, () => [0, 0, 0, 0, 0]);
        for (let i = 0; i < n; i++) {
            const s = sums[assign[i]], bin = bins[i];
            s[0] += bin.oklab.L * bin.weight; s[1] += bin.oklab.a * bin.weight; s[2] += bin.oklab.b * bin.weight;
            s[3] += bin.weight; s[4] += bin.count;
        }
        cents = cents.map((c, j) => {
            const [sL, sa, sb, sw] = sums[j];
            if (sw === 0) return c;
            const oklab = { L: sL / sw, a: sa / sw, b: sb / sw };
            const rgb = oklabToRgb(oklab.L, oklab.a, oklab.b);
            return { r: rgb.r, g: rgb.g, b: rgb.b, oklab };
        });

        // Two centroids collapsed onto the same colour: re-seed the smaller one
        // at the most distant (chroma-weighted) colour not yet represented.
        if (iter < maxIter - 2 && kk > 1) {
            let merged = false;
            for (let a = 0; a < kk && !merged; a++) {
                for (let b = a + 1; b < kk && !merged; b++) {
                    if (colorDistanceOklab(cents[a].oklab, cents[b].oklab) >= 0.07) continue;
                    const toReplace = sums[a][4] < sums[b][4] ? a : b;
                    let maxScore = -1, bestBin = null;
                    for (let i = 0; i < n; i++) {
                        let minD = Infinity;
                        for (let j = 0; j < kk; j++) {
                            if (j === toReplace) continue;
                            const d = colorDistanceOklab(bins[i].oklab, cents[j].oklab);
                            if (d < minD) minD = d;
                        }
                        const chromaW = bins[i].weight / bins[i].count;
                        const score = minD * Math.min(chromaW, 3) * Math.log(1 + bins[i].count);
                        if (score > maxScore) { maxScore = score; bestBin = bins[i]; }
                    }
                    if (bestBin) {
                        cents[toReplace] = { r: bestBin.r, g: bestBin.g, b: bestBin.b, oklab: bestBin.oklab };
                        merged = true;
                    }
                }
            }
        }
        emit(iter, false);
    }

    // Snap each centroid to the closest real colour in its cluster, so we never
    // report an averaged mud that doesn't exist in the image, then reassign once
    // more so coverage and preview match the reported colours exactly.
    assignAll();
    cents = cents.map((c, j) => {
        let best = Infinity, pick = null;
        for (let i = 0; i < n; i++) {
            if (assign[i] !== j) continue;
            const d = colorDistanceOklab(bins[i].oklab, c.oklab);
            if (d < best) { best = d; pick = bins[i]; }
        }
        return pick ? { r: pick.r, g: pick.g, b: pick.b, oklab: pick.oklab } : c;
    });
    assignAll();
    const counts = new Array(kk).fill(0);
    let errSum = 0, total = 0;
    for (let i = 0; i < n; i++) {
        counts[assign[i]] += bins[i].count;
        errSum += bins[i].count * colorDistanceOklab(bins[i].oklab, cents[assign[i]].oklab);
        total += bins[i].count;
    }
    emit(maxIter, true, counts);

    // error: mean OKLab distance from each pixel to its reported colour (lower = more faithful)
    return { centroids: cents.map(c => ({ r: c.r, g: c.g, b: c.b })), assign, counts, error: errSum / total };
}

// ---- Role assignment ----
function toLch({ r, g, b }) {
    const ok = rgbToOklab(r, g, b);
    return { L: ok.L, C: Math.sqrt(ok.a * ok.a + ok.b * ok.b), H: Math.atan2(ok.b, ok.a) };
}

// 0..1 hue distance, damped when either colour is near-grey (atan2 is noise there)
function hueDistance(c1, c2) {
    let d = Math.abs(c1.H - c2.H);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return (d / Math.PI) * Math.min(1, Math.min(c1.C, c2.C) / 0.06);
}

// Search order: bg and text first so pairwise terms can reference them.
const ROLE_SEARCH_ORDER = ['bg', 'text', 'primary', 'accent', 'highlight', 'surface', 'muted', 'secondary'];

// Named score terms of colour c in a role; a role's score is their sum.
// `a` maps already-placed roles to colours. Kept as terms so the gallery can
// show why a colour won.
const area = c => Math.log(c.share + 1e-4);
const ROLE_TERMS = {
    bg:        (c)    => ({ area: area(c), chroma: -8 * c.C, extreme: 1.5 * Math.abs(c.L - 0.5) }),
    text:      (c, a) => ({ contrast: 1.5 * Math.log(contrastRatio(c, a.bg)), chroma: -2 * c.C }),
    primary:   (c)    => ({ chroma: 8 * c.C, area: 0.2 * area(c) }),
    accent:    (c, a) => ({ chroma: 2 * c.C, hue: 3 * (a.primary ? hueDistance(c, a.primary) : 0) }),
    highlight: (c)    => ({ chroma: 2 * c.C, light: 3 * c.L }),
    surface:   (c, a) => ({ nearBg: -4 * Math.abs(c.L - a.bg.L), chroma: -3 * c.C, area: 0.3 * area(c) }),
    muted:     (c)    => ({ chroma: -4 * c.C, midL: 2 * (1 - 2 * Math.abs(c.L - 0.5)) }),
    secondary: (c)    => ({ area: 0.5 * area(c) })
};

function roleScore(role, c, placed) {
    const terms = ROLE_TERMS[role](c, placed);
    let s = 0;
    for (const t in terms) s += terms[t];
    return s;
}

// Exhaustive search over role→colour permutations (k ≤ 8 → ≤ 40320 leaves).
// colors: [{ r, g, b, share }]; returns colour index per entry of `keys`.
function assignRoles(colors, keys) {
    const cs = colors.map(c => Object.assign({}, c, toLch(c)));
    const roles = ROLE_SEARCH_ORDER.filter(r => keys.includes(r));
    const placed = {};
    const cur = [];
    let best = null, bestS = -Infinity;

    (function rec(i, used, s) {
        if (i === roles.length) {
            if (s > bestS) { bestS = s; best = cur.slice(); }
            return;
        }
        for (let c = 0; c < cs.length; c++) {
            if (used & (1 << c)) continue;
            cur[i] = c;
            placed[roles[i]] = cs[c];
            rec(i + 1, used | (1 << c), s + roleScore(roles[i], cs[c], placed));
        }
        delete placed[roles[i]];
    })(0, 0, 0);

    return keys.map(key => best[roles.indexOf(key)]);
}

// ---- Contrast repair ----
// Move L in OKLCH (keeping hue, and chroma if possible) until rgb reaches
// `target` contrast against `against`. Tries both directions, prefers the
// smaller change; second pass bleeds chroma so the extremes become pure
// black/white, one of which always clears 4.58:1.
function repairContrast(rgb, against, target) {
    if (contrastRatio(rgb, against) >= target) return { rgb, changed: false };
    const ok = rgbToOklab(rgb.r, rgb.g, rgb.b);
    const C0 = Math.sqrt(ok.a * ok.a + ok.b * ok.b), H = Math.atan2(ok.b, ok.a);
    const bgL = rgbToOklab(against.r, against.g, against.b).L;
    const dirs = ok.L >= bgL ? [1, 0] : [0, 1];

    for (const keepChroma of [true, false]) {
        for (const end of dirs) {
            for (let t = 0.01; t <= 1.0001; t += 0.01) {
                const L = ok.L + (end - ok.L) * t;
                const out = lchToRgb(L, keepChroma ? C0 : C0 * (1 - t), H);
                if (contrastRatio(out, against) >= target) return { rgb: out, changed: true };
            }
        }
    }
    return { rgb, changed: false };
}

// When the image has fewer distinct colours than k, derive the missing ones
// from what is there (tints/shades of the dominant colour, an ink colour, the
// complement of the most chromatic one) instead of padding with black.
function generateFills(cols, missing) {
    if (missing <= 0) return [];
    const lch = cols.map(c => Object.assign({ share: c.share }, toLch(c)));
    const dom = lch.reduce((m, c) => c.share > m.share ? c : m, lch[0]);
    const vivid = lch.reduce((m, c) => c.C > m.C ? c : m, lch[0]);
    const clampL = L => Math.min(0.97, Math.max(0.08, L));

    const candidates = [
        [dom.L > 0.5 ? 0.2 : 0.94, dom.C * 0.3, dom.H],        // ink for TEXT
        [clampL(dom.L + (dom.L > 0.5 ? -0.08 : 0.08)), dom.C, dom.H], // SURFACE-ish
        [vivid.L, vivid.C, vivid.H + Math.PI],                   // complement
        [clampL(vivid.L + 0.15), vivid.C * 0.8, vivid.H],
        [clampL(vivid.L - 0.15), vivid.C, vivid.H]
    ];
    for (let step = 1; step <= 9; step++) {
        candidates.push([clampL(dom.L + 0.1 * step), dom.C * 0.6, dom.H], [clampL(dom.L - 0.1 * step), dom.C * 0.6, dom.H]);
    }

    const taken = cols.map(c => rgbToOklab(c.r, c.g, c.b));
    const fills = [];
    for (const [L, C, H] of candidates) {
        if (fills.length === missing) break;
        const rgb = lchToRgb(L, C, H);
        const ok = rgbToOklab(rgb.r, rgb.g, rgb.b);
        if (taken.some(t => colorDistanceOklab(t, ok) < 0.05)) continue;
        taken.push(ok);
        fills.push({ r: rgb.r, g: rgb.g, b: rgb.b, share: 0, generated: true });
    }
    while (fills.length < missing) fills.push({ r: 0, g: 0, b: 0, share: 0, generated: true });
    return fills;
}

// centroids/counts from kmeans → { theme, coverage, adjusted, generated, lowChroma, scores }
function buildPalette(centroids, counts, k) {
    const total = counts.reduce((s, n) => s + n, 0) || 1;
    const cols = centroids.map((c, i) => ({ r: c.r, g: c.g, b: c.b, share: counts[i] / total }));
    if (cols.length === 0) cols.push({ r: 128, g: 128, b: 128, share: 1 });
    const lowChroma = Math.max(...cols.map(c => toLch(c).C)) < LOW_CHROMA;
    cols.push(...generateFills(cols, k - cols.length));

    const keys = ROLE_KEYS[k];
    const order = assignRoles(cols, keys);
    const theme = {}, generated = {};
    keys.forEach((key, i) => {
        theme[key] = rgbToHex(cols[order[i]]);
        if (cols[order[i]].generated) generated[key] = true;
    });

    // Per-role score terms of the winning assignment (before contrast repair)
    const cs = cols.map(c => Object.assign({}, c, toLch(c)));
    const placed = {}, scores = {};
    for (const role of ROLE_SEARCH_ORDER.filter(r => keys.includes(r))) {
        placed[role] = cs[order[keys.indexOf(role)]];
        scores[role] = ROLE_TERMS[role](placed[role], placed);
    }

    // adjusted: role → original extracted hex, so the UI can say what changed
    const adjusted = {};
    for (const role of ['text', 'primary']) {
        const fix = repairContrast(hexToRgb(theme[role]), hexToRgb(theme.bg), MIN_CONTRAST[role]);
        if (fix.changed) { adjusted[role] = theme[role]; theme[role] = rgbToHex(fix.rgb); }
    }

    const coverage = Math.round((1 - cols[order[keys.indexOf('bg')]].share) * 100);
    return { theme, coverage, adjusted, generated, lowChroma, scores };
}

// Synchronous end-to-end extraction (gallery + tests; the app uses the worker)
function extractPalette(data, width, height, k, opts) {
    opts = opts || {};
    const hist = buildHistogram(data, width, height, opts.rect);
    const km = kmeans(hist.bins, k, { seed: opts.seed, maxIter: opts.maxIter });
    return Object.assign(buildPalette(km.centroids, km.counts, k), { seed: opts.seed || 1, error: km.error });
}

// ---- Theme derivatives for export ----
function isDarkTheme(theme) {
    return toLch(hexToRgb(theme.bg)).L < 0.5;
}

// Opposite-mode version: neutral roles get new lightness (hue/chroma kept),
// brand roles keep their colour unless they'd lose contrast on the new BASE.
// Lightness is remapped linearly so BASE lands on a proper dark/light value
// and TEXT on the opposite end, whatever mid-tones the source had.
const NEUTRAL_ROLES = ['bg', 'surface', 'secondary', 'muted', 'text'];
const MODE_L = { dark: { bg: 0.2, text: 0.93 }, light: { bg: 0.97, text: 0.22 } };
function invertTheme(theme) {
    const target = isDarkTheme(theme) ? MODE_L.light : MODE_L.dark;
    const bgL = toLch(hexToRgb(theme.bg)).L, textL = toLch(hexToRgb(theme.text)).L;
    const slope = Math.abs(textL - bgL) > 0.05 ? (target.text - target.bg) / (textL - bgL) : -1;
    const out = {};
    for (const [key, hex] of Object.entries(theme)) {
        if (!NEUTRAL_ROLES.includes(key)) { out[key] = hex; continue; }
        const { L, C, H } = toLch(hexToRgb(hex));
        const L2 = Math.min(0.98, Math.max(0.05, target.bg + (L - bgL) * slope));
        out[key] = rgbToHex(lchToRgb(L2, C, H));
    }
    const bg = hexToRgb(out.bg);
    for (const key of Object.keys(out)) {
        if (key === 'bg' || (NEUTRAL_ROLES.includes(key) && key !== 'text')) continue;
        out[key] = rgbToHex(repairContrast(hexToRgb(out[key]), bg, key === 'text' ? 4.5 : 3).rgb);
    }
    return out;
}

// Tailwind-style 50…950 ramp in OKLCH; chroma tapers toward the extremes
const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const SCALE_L = [0.97, 0.93, 0.87, 0.79, 0.71, 0.63, 0.55, 0.47, 0.39, 0.31, 0.24];
function tonalScale(hex) {
    const { C, H } = toLch(hexToRgb(hex));
    const scale = {};
    SCALE_STEPS.forEach((step, i) => {
        const L = SCALE_L[i];
        const taper = Math.max(0.15, 1 - Math.pow(Math.abs(L - 0.6) / 0.45, 2));
        scale[step] = rgbToHex(lchToRgb(L, C * taper, H));
    });
    return scale;
}

function oklchString(hex) {
    const { L, C, H } = toLch(hexToRgb(hex));
    const hue = C < 0.002 ? 0 : ((H * 180 / Math.PI) + 360) % 360;
    return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${hue.toFixed(1)})`;
}

// ---- Colour-vision deficiency (Machado et al. 2009, severity 1.0, linear sRGB) ----
const CVD_MATRICES = {
    protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
    deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
    tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900]
};

function simulateCvd({ r, g, b }, type) {
    const m = CVD_MATRICES[type];
    const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
    return {
        r: linearToSrgb(m[0] * lr + m[1] * lg + m[2] * lb),
        g: linearToSrgb(m[3] * lr + m[4] * lg + m[5] * lb),
        b: linearToSrgb(m[6] * lr + m[7] * lg + m[8] * lb)
    };
}

// Role pairs that are distinct normally but collapse under a deficiency
const CVD_PAIRS = [['primary', 'accent'], ['primary', 'secondary'], ['accent', 'highlight'], ['primary', 'highlight']];
function cvdWarnings(theme) {
    const warnings = [];
    for (const type of Object.keys(CVD_MATRICES)) {
        for (const [a, b] of CVD_PAIRS) {
            if (!theme[a] || !theme[b]) continue;
            const ca = hexToRgb(theme[a]), cb = hexToRgb(theme[b]);
            const lab = c => rgbToOklab(c.r, c.g, c.b);
            if (colorDistanceOklab(lab(ca), lab(cb)) < 0.08) continue;
            if (colorDistanceOklab(lab(simulateCvd(ca, type)), lab(simulateCvd(cb, type))) < 0.05) {
                warnings.push({ type, a, b });
            }
        }
    }
    return warnings;
}

// ---- APCA (W3 0.0.98G-4g) — signed Lc of text on bg ----
function apcaContrast(text, bg) {
    const y = ({ r, g, b }) => {
        const Y = 0.2126729 * Math.pow(r / 255, 2.4) + 0.7151522 * Math.pow(g / 255, 2.4) + 0.0721750 * Math.pow(b / 255, 2.4);
        return Y > 0.022 ? Y : Y + Math.pow(0.022 - Y, 1.414);
    };
    const yt = y(text), yb = y(bg);
    if (Math.abs(yb - yt) < 0.0005) return 0;
    let out;
    if (yb > yt) {
        const sapc = (Math.pow(yb, 0.56) - Math.pow(yt, 0.57)) * 1.14;
        out = sapc < 0.1 ? 0 : sapc - 0.027;
    } else {
        const sapc = (Math.pow(yb, 0.65) - Math.pow(yt, 0.62)) * 1.14;
        out = sapc > -0.1 ? 0 : sapc + 0.027;
    }
    return out * 100;
}

// ---- Worker bootstrap ----
function workerMain() {
    self.onmessage = function (e) {
        const { bins, k, seed, maxIter } = e.data;
        kmeans(bins, k, {
            seed, maxIter,
            onFrame(f) { self.postMessage(f, [f.assign.buffer]); }
        });
    };
}

const WORKER_FUNCTIONS = [srgbToLinear, linearToSrgb, rgbToOklab, oklabToLinearRgb, oklabToRgb, colorDistanceOklab,
    mulberry32, initKMeansPP, kmeans];

function createKMeansWorker() {
    const src = WORKER_FUNCTIONS.map(f => f.toString()).join('\n') + '\n(' + workerMain.toString() + ')();';
    return new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
}

if (typeof module === 'object' && module.exports) {
    module.exports = {
        ROLE_NAMES, ROLE_KEYS, MIN_CONTRAST, LOW_CHROMA, SCALE_STEPS,
        rgbToOklab, oklabToRgb, lchToRgb, colorDistanceOklab, rgbToHex, hexToRgb,
        relativeLuminance, contrastRatio, inkOn, mulberry32,
        buildHistogram, initKMeansPP, kmeans, toLch, hueDistance, assignRoles,
        repairContrast, generateFills, buildPalette, extractPalette,
        isDarkTheme, invertTheme, tonalScale, oklchString,
        simulateCvd, cvdWarnings, apcaContrast
    };
}
