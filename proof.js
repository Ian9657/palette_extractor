// Proof: the deposited photo re-rendered as one cel of anime, using only the
// palette (DESIGN.md §6.2), then pulled apart as colour separations — one
// plate per extracted ink, plus a K plate for the line work, the way the
// cel would go to press. EJECT shows the plates:
//
//   ink plates  everything printed in that ink: its flat cels, the shadows
//               it gives the next lighter cel, the screen tone, the glow and
//               the Sandevistan echoes or fringes that use it
//   K plate     ink lines on cel boundaries (heavier on silhouettes) and on
//               strong edges inside cels that form a stroke
//
// Every pixel is on exactly one plate, so seated they are the cel. Stacked
// by area: the plate covering most at the bottom, the sparsest near the top,
// K last — so looking down the stack every plate shows. Tags are short
// (P1… K) so eight inks still read.
//
// The cel itself: the 16:9 cut follows the photo's saliency; patches under
// MIN_CEL merge into the cel around them; one hard shadow step in the next
// darker ink; screen-tone dots where a gradient would have been; chromatic
// fringes on the brightest cel, tone glow around the most vivid one, and
// afterimages trailing the main subject into the open side.
//
// Resolution follows the screen: the cut is drawn at the frame's device
// pixels (960 to 1920 wide), and every size below is set at 960 and scaled
// by S, so a cel looks the same at any resolution, only sharper.
//
// Static: nothing animates. Taking it apart (EJECT ⇄ INSTALL, or drag) moves in steps.
(() => {
    const stage0 = document.getElementById('proof-stage');
    const W = Math.round(Math.min(1920, Math.max(960, stage0.clientWidth * (window.devicePixelRatio || 1))) / 16) * 16;
    const H = W / 16 * 9;
    const S = W / 960;
    const px = v => Math.max(1, Math.round(v * S));
    const STEPS = 6;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const $ = id => document.getElementById(id);
    const stage = $('proof-stage'), rig = $('proof-rig');

    // One layer per plate; the count follows the palette (K inks + the K plate)
    const plates = [];
    function setPlateCount(n) {
        while (plates.length < n) {
            const wrap = document.createElement('div');
            wrap.className = 'proof-layer';
            const c = document.createElement('canvas');
            c.width = W; c.height = H;
            const tag = document.createElement('span');
            tag.className = 'proof-tag';
            wrap.append(c, tag);
            rig.appendChild(wrap);
            plates.push({ ctx: c.getContext('2d'), tag, text: '' });
        }
        while (plates.length > n) rig.lastChild.remove(), plates.pop();
        plates.forEach((P, i) => P.tag.parentNode.style.setProperty('--i', i));
        sizeDepth();
    }

    // ---- Analysis: depends on the image and the extracted palette only ----
    let cache = { img: null, key: '', a: null };
    const labDist = (p, q) => {   // chroma counts double so hue boundaries survive
        const dL = p.L - q.L, da = (p.a - q.a) * 2, db = (p.b - q.b) * 2;
        return dL * dL + da * da + db * db;
    };

    const MIN_CEL = Math.round(W * H * 0.0004);   // smallest patch kept as its own cel
    const SHADE = 0.07;                             // one hard shadow step, in OKLab lightness
    const GF_EPS = 0.0025;                          // guided filter: lightness steps above ~0.05 are edges
    const DOG_T = 0.012;                            // DoG depth that inks a line

    // Guided filter (He, Sun & Tang 2010) with one guide for several
    // channels, in place: O(n) with box means, edge-preserving, no halos
    function guided(I, chans, r, eps) {
        const n = W * H, mI = Float32Array.from(I), II = new Float32Array(n);
        for (let p = 0; p < n; p++) II[p] = I[p] * I[p];
        boxBlur(mI, W, H, r); boxBlur(II, W, H, r);
        const guide = Float32Array.from(I);
        for (const P of chans) {
            const mP = Float32Array.from(P), IP = new Float32Array(n);
            for (let p = 0; p < n; p++) IP[p] = guide[p] * P[p];
            boxBlur(mP, W, H, r); boxBlur(IP, W, H, r);
            const a = new Float32Array(n), b = new Float32Array(n);
            for (let p = 0; p < n; p++) {
                a[p] = (IP[p] - mI[p] * mP[p]) / (II[p] - mI[p] * mI[p] + eps);
                b[p] = mP[p] - a[p] * mI[p];
            }
            boxBlur(a, W, H, r); boxBlur(b, W, H, r);
            for (let p = 0; p < n; p++) P[p] = a[p] * guide[p] + b[p];
        }
    }

    // Framing: slide a 16:9 window over the photo to hold the most saliency,
    // so the shot is composed around its subject instead of cut from the middle
    function frameCut(img) {
        const sw = img.naturalWidth, sh = img.naturalHeight;
        const g = 96 / Math.max(sw, sh);                 // small working copy
        const gw = Math.max(16, Math.round(sw * g)), gh = Math.max(16, Math.round(sh * g));
        const c = document.createElement('canvas');
        c.width = gw; c.height = gh;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, gw, gh);
        const sal = saliencyMap(x.getImageData(0, 0, gw, gh).data, gw, gh);
        const I = new Float64Array((gw + 1) * (gh + 1));   // integral image
        for (let y = 0; y < gh; y++) for (let xx = 0; xx < gw; xx++) {
            I[(y + 1) * (gw + 1) + xx + 1] = sal[y * gw + xx] + I[y * (gw + 1) + xx + 1] + I[(y + 1) * (gw + 1) + xx] - I[y * (gw + 1) + xx];
        }
        const sum = (x0, y0, w, h) => I[(y0 + h) * (gw + 1) + x0 + w] - I[y0 * (gw + 1) + x0 + w] - I[(y0 + h) * (gw + 1) + x0] + I[y0 * (gw + 1) + x0];
        const best = () => {
            const s = Math.max(W / sw, H / sh);   // cover the 16:9 frame
            const w = Math.min(gw, Math.round(W / s * g)), h = Math.min(gh, Math.round(H / s * g));
            let top = { v: -1, x: 0, y: 0 };
            for (let y0 = 0; y0 + h <= gh; y0++) for (let x0 = 0; x0 + w <= gw; x0++) {
                const v = sum(x0, y0, w, h);
                if (v > top.v) top = { v, x: x0, y: y0 };
            }
            return { v: top.v, x: top.x / g, y: top.y / g, w: W / s, h: H / s };
        };
        // Slide only (no zoom: a tighter cut lost the crowd around a stage),
        // and only halfway from the centre: the subject leads, the scene stays
        const cut = best();
        cut.x = (cut.x + (sw - cut.w) / 2) / 2;
        cut.y = (cut.y + (sh - cut.h) / 2) / 2;
        return cut;
    }

    // Merge every 4-connected patch smaller than min into the label that
    // borders it most; two passes catch patches that only become small
    // neighbours after the first
    function mergeSmall(label, nLabels, min) {
        const n = W * H, comp = new Int32Array(n), stack = [], members = [];
        const votes = new Int32Array(nLabels);
        for (let pass = 0; pass < 2; pass++) {
            comp.fill(-1);
            let id = 0;
            for (let p0 = 0; p0 < n; p0++) {
                if (comp[p0] >= 0) continue;
                const l = label[p0];
                members.length = 0;
                comp[p0] = id; stack.push(p0);
                while (stack.length) {
                    const p = stack.pop(); members.push(p);
                    const xx = p % W;
                    if (xx > 0 && comp[p - 1] < 0 && label[p - 1] === l) { comp[p - 1] = id; stack.push(p - 1); }
                    if (xx < W - 1 && comp[p + 1] < 0 && label[p + 1] === l) { comp[p + 1] = id; stack.push(p + 1); }
                    if (p >= W && comp[p - W] < 0 && label[p - W] === l) { comp[p - W] = id; stack.push(p - W); }
                    if (p < n - W && comp[p + W] < 0 && label[p + W] === l) { comp[p + W] = id; stack.push(p + W); }
                }
                if (members.length < min) {
                    votes.fill(0);
                    for (const p of members) {
                        const xx = p % W;
                        if (xx > 0 && label[p - 1] !== l) votes[label[p - 1]]++;
                        if (xx < W - 1 && label[p + 1] !== l) votes[label[p + 1]]++;
                        if (p >= W && label[p - W] !== l) votes[label[p - W]]++;
                        if (p < n - W && label[p + W] !== l) votes[label[p + W]]++;
                    }
                    let m = 0, mi = l;
                    for (let j = 0; j < nLabels; j++) if (votes[j] > m) { m = votes[j]; mi = j; }
                    for (const p of members) label[p] = mi;
                }
                id++;
            }
        }
    }

    // Clear 8-connected runs of a mask shorter than min pixels: stray specks
    // of edge are noise, a stroke is a line
    function keepStrokes(mask, min) {
        const n = W * H, seen = new Uint8Array(n), stack = [], members = [];
        for (let p0 = 0; p0 < n; p0++) {
            if (!mask[p0] || seen[p0]) continue;
            members.length = 0; seen[p0] = 1; stack.push(p0);
            while (stack.length) {
                const p = stack.pop(); members.push(p);
                const x = p % W;
                for (let dy = -W; dy <= W; dy += W) for (let dx = -1; dx <= 1; dx++) {
                    const q = p + dy + dx;
                    if (q < 0 || q >= n || (dx === -1 && x === 0) || (dx === 1 && x === W - 1)) continue;
                    if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
                }
            }
            if (members.length < min) for (const p of members) mask[p] = 0;
        }
    }

    function analyse(img, theme) {
        const key = Object.values(theme).join('');
        if (cache.img === img && cache.key === key) return cache.a;

        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d', { willReadFrequently: true });
        const crop = frameCut(img);
        x.imageSmoothingQuality = 'high';   // a large photo shrinks without aliasing
        x.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
        const data = x.getImageData(0, 0, W, H).data;
        const n = W * H;

        const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
        for (let p = 0; p < n; p++) {
            const ok = rgbToOklab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
            L[p] = ok.L; A[p] = ok.a; B[p] = ok.b;
        }
        // The cels are decided on an edge-preserving smooth (guided filter,
        // He et al. 2010, guided by lightness): flat areas go flat, but a
        // window frame or a sign's edge stays where it is instead of melting
        const Ls = Float32Array.from(L), As = Float32Array.from(A), Bs = Float32Array.from(B);
        for (let k = 0; k < 2; k++) guided(Ls, [Ls, As, Bs], px(5), GF_EPS);
        // detail L for tone and lines: two radius-1 passes at 960; the
        // spread grows with S², so more passes when sharper
        const passes = Math.round(2 * S * S);
        for (const ch of [L, A, B]) for (let k = 0; k < passes; k++) boxBlur(ch, W, H, 1);

        const keys = Object.keys(theme);
        const pal = keys.map(k => { const ok = rgbToOklab(...Object.values(hexToRgb(theme[k]))); return ok; });

        // Nearest palette colour per pixel, then every patch smaller than
        // MIN_CEL is merged into the cel around it: cels are big flat areas
        let label = new Uint8Array(n);
        for (let p = 0; p < n; p++) {
            const q = { L: Ls[p], a: As[p], b: Bs[p] };
            let best = Infinity, bi = 0;
            for (let j = 0; j < pal.length; j++) { const d = labDist(q, pal[j]); if (d < best) { best = d; bi = j; } }
            label[p] = bi;
        }
        mergeSmall(label, pal.length, MIN_CEL);

        // Shadow and tone: how far each pixel sits below its cel's own lightness
        const below = new Float32Array(n);
        for (let p = 0; p < n; p++) below[p] = pal[label[p]].L - L[p];
        // The shadow shape itself comes from the smoothed lightness and is
        // cleaned like the cels, so it reads as one hard-edged shape
        const shade = new Uint8Array(n);
        for (let p = 0; p < n; p++) shade[p] = pal[label[p]].L - Ls[p] > SHADE ? 1 : 0;
        mergeSmall(shade, 2, MIN_CEL);

        // Light tone: where a pixel sits well above its cel — a dim poster,
        // lit windows on a dark façade — it is printed as a halftone of the
        // lighter ink it leans towards; `lift` is how far of the way there
        const up = new Int8Array(n).fill(-1), lift = new Float32Array(n);
        for (let p = 0; p < n; p++) {
            const own = pal[label[p]];
            if (Ls[p] - own.L < 0.03) continue;
            const q = { L: Ls[p], a: As[p], b: Bs[p] };
            let best = Infinity, bi = -1;
            for (let j = 0; j < pal.length; j++) {
                if (pal[j].L < own.L + 0.05) continue;
                const d = labDist(q, pal[j]);
                if (d < best) { best = d; bi = j; }
            }
            if (bi < 0) continue;
            up[p] = bi; lift[p] = (Ls[p] - own.L) / (pal[bi].L - own.L);
        }
        // only whole lit areas take the tone: specks of glow are noise
        const lit = new Uint8Array(n);
        for (let p = 0; p < n; p++) lit[p] = up[p] >= 0 && lift[p] > 0.2 ? 1 : 0;
        mergeSmall(lit, 2, MIN_CEL);
        for (let p = 0; p < n; p++) if (!lit[p]) up[p] = -1;

        // Detail lines: difference of Gaussians on lightness (the line half
        // of XDoG, Winnemöller 2011) — negative on the dark side of an
        // edge, so strokes come out whole and on one side, like inking
        const g1 = Float32Array.from(L), g2 = Float32Array.from(L);
        for (let k = 0; k < 3; k++) { boxBlur(g1, W, H, px(1)); boxBlur(g2, W, H, px(2)); }
        const dog = new Float32Array(n);
        for (let p = 0; p < n; p++) dog[p] = g1[p] - g2[p];

        // Salient shapes for the afterimages: top 5% of saliency, outside the darkest cel
        const sal = saliencyMap(data, W, H);
        const sorted = Float32Array.from(sal).sort();
        const cut = sorted[Math.floor(n * 0.95)];
        const darkest = pal.reduce((m, q, j) => (q.L < pal[m].L ? j : m), 0);
        // close the scattered salient pixels into shapes, then keep the two biggest
        const blob = new Float32Array(n);
        for (let p = 0; p < n; p++) blob[p] = sal[p] >= cut && label[p] !== darkest ? 1 : 0;
        boxBlur(blob, W, H, px(6)); boxBlur(blob, W, H, px(6));
        const comp = new Int32Array(n).fill(-1), sizes = [];
        const stack = [];
        for (let p0 = 0; p0 < n; p0++) {
            if (blob[p0] < 0.3 || comp[p0] >= 0) continue;
            const id = sizes.length; let size = 0;
            comp[p0] = id; stack.push(p0);
            while (stack.length) {
                const p = stack.pop(); size++;
                const x = p % W;
                for (const q of [p - 1, p + 1, p - W, p + W]) {
                    if (q < 0 || q >= n || (q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
                    if (comp[q] < 0 && blob[q] >= 0.3) { comp[q] = id; stack.push(q); }
                }
            }
            sizes.push(size);
        }
        const keep = sizes.map((sz, id) => [sz, id]).sort((u, v) => v[0] - u[0]).slice(0, 1)
            .filter(([sz]) => sz > n * 0.004).map(([, id]) => id);
        const salient = new Uint8Array(n);
        for (let p = 0; p < n; p++) salient[p] = comp[p] >= 0 && keep.includes(comp[p]) ? 1 : 0;

        const a = { label, below, shade, up, lift, dog, salient, keys, pal, crop, srcW: img.naturalWidth, srcH: img.naturalHeight };
        cache = { img, key, a };
        return a;
    }

    // ---- Drawing ----
    const rgbOf = hex => hexToRgb(hex);
    function paintPixels(ctx, colourAt) {
        const out = ctx.createImageData(W, H), d = out.data;
        for (let p = 0; p < W * H; p++) {
            const c = colourAt(p);
            if (!c) continue;
            d[p * 4] = c.r; d[p * 4 + 1] = c.g; d[p * 4 + 2] = c.b; d[p * 4 + 3] = 255;
        }
        ctx.putImageData(out, 0, 0);
    }

    // A screen-tone or glow dot, as hard pixels on one plate
    function dot(out, cx, cy, r, j) {
        const R = Math.ceil(r);
        for (let y = Math.floor(cy) - R; y <= Math.floor(cy) + R; y++) {
            if (y < 0 || y >= H) continue;
            for (let x = Math.floor(cx) - R; x <= Math.floor(cx) + R; x++) {
                if (x < 0 || x >= W) continue;
                const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
                if (dx * dx + dy * dy <= r * r) out[y * W + x] = j;
            }
        }
        out[Math.floor(cy) * W + Math.floor(cx)] = j;   // the smallest dot still prints
    }

    function render(theme) {
        const img = currentImgEl || keptThumb();
        const keys = Object.keys(palette.theme);
        setPlateCount(keys.length + 1);
        plates.forEach(P => P.ctx.clearRect(0, 0, W, H));
        stage.classList.toggle('empty', !img);
        if (!img) { renderEmpty(); return; }
        const a = analyse(img, palette.theme);           // cels come from the extracted colours…
        const ink = a.keys.map(k => rgbOf(theme[k]));    // …printed in the shown theme (or its opposite)
        const byL = a.keys.map((k, j) => j).sort((i, j) => toLch(ink[i]).L - toLch(ink[j]).L);
        const darkest = byL[0], lightest = byL[byL.length - 1];
        const darker = j => byL[Math.max(0, byL.indexOf(j) - 1)];
        const vivid = a.keys.map((k, j) => j).filter(j => j !== darkest && j !== lightest)
            .sort((i, j) => toLch(ink[j]).C - toLch(ink[i]).C);
        const { label, below, shade, up, lift, dog, salient, pal } = a;
        const n = W * H;

        // Which ink each pixel prints in, built up in the order the cel is
        // made: colour, shadow, tone, line, composite
        const out = Uint8Array.from(label);

        // Shadow: one hard step, as whole shapes
        for (let p = 0; p < n; p++) if (shade[p] && label[p] !== darkest) out[p] = darker(label[p]);

        // Tone: dots where the pixel is a little below its cel but not yet in shadow
        const G = 6 * S;
        for (let y = G / 2; y < H; y += G) {
            for (let x = G / 2 + (Math.round(y / G - 0.5) % 2) * G / 2; x < W; x += G) {
                const p = Math.floor(y) * W + Math.floor(x);
                const t = (below[p] - 0.015) / (SHADE - 0.015);
                if (t > 0 && t < 1 && !shade[p] && label[p] !== darkest) {
                    dot(out, x, y, (0.4 + t * 6 * 0.42) * S, darkest);
                }
            }
        }

        // Light tone: a finer halftone screen; the dot's share of its cell
        // is the lift, capped so the cel underneath still reads as itself
        const GL = 4 * S;
        for (let y = GL / 2; y < H; y += GL) {
            for (let x = GL / 2 + (Math.round(y / GL - 0.5) % 2) * GL / 2; x < W; x += GL) {
                const p = Math.floor(y) * W + Math.floor(x);
                if (up[p] < 0 || shade[p]) continue;
                dot(out, x, y, GL * Math.sqrt(Math.min(0.5, lift[p]) / Math.PI), up[p]);
            }
        }

        // Line (K): every cel boundary, plus strong edges inside cels where
        // they form a stroke (≥ MIN_STROKE px); 2 px on silhouettes, where
        // the two cels are far apart in lightness
        const T = DOG_T, MIN_STROKE = 30 * S, LW = px(1);
        const line = new Uint8Array(n), detail = new Uint8Array(n);
        const pen = (x, y, w) => {   // a square nib of w px, down and right of (x, y)
            for (let j = 0; j < w && y + j < H; j++) for (let i = 0; i < w && x + i < W; i++) line[(y + j) * W + x + i] = 1;
        };
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                const p = y * W + x;
                const q = label[p] !== label[p + 1] ? p + 1 : label[p] !== label[p + W] ? p + W : -1;
                if (q >= 0) pen(x, y, Math.abs(pal[label[p]].L - pal[label[q]].L) > 0.25 ? 2 * LW : LW);
                else if (dog[p] < -T) detail[p] = 1;
            }
        }
        keepStrokes(detail, MIN_STROKE);
        for (let p = 0; p < n; p++) if (detail[p]) pen(p % W, Math.floor(p / W), LW);

        // Composite, printed over the line: echoes of the one main subject,
        // trailing towards the side of the frame with more room, far ones first
        const echoInks = vivid.length ? vivid.concat(lightest) : [lightest];
        const ECHOES = 3;
        let sx = 0, sCount = 0, minX = W, maxX = 0;
        for (let p = 0; p < n; p++) if (salient[p]) { const x = p % W; sx += x; sCount++; if (x < minX) minX = x; if (x > maxX) maxX = x; }
        const dir = sCount && sx / sCount > W / 2 ? 1 : -1;            // subject on the right → echoes trail left
        const GAP = Math.max(px(14), Math.round((maxX - minX) * 0.12));
        for (let k = ECHOES; k >= 1 && sCount; k--) {
            const j = echoInks[(k - 1) % echoInks.length];
            const dx = k * GAP * dir, dy = -k * px(2);
            for (let y = 0; y < H; y++) {
                const sy = y - dy;
                if (sy < 0 || sy >= H) continue;
                for (let x = 0; x < W; x++) {
                    const ox = x + dx;
                    if (ox < 0 || ox >= W) continue;
                    const p = y * W + x;
                    if (salient[sy * W + ox] && !salient[p]) { out[p] = j; line[p] = 0; }
                }
            }
        }
        // Chromatic fringe on the brightest cel's edges
        if (vivid.length) {
            const left = vivid[0], right = vivid[1] ?? vivid[0], F = px(3);
            for (let y = 0; y < H; y++) {
                for (let x = F; x < W - F; x++) {
                    const p = y * W + x;
                    if (label[p] === lightest) continue;
                    if (label[p + F] === lightest) { out[p] = left; line[p] = 0; }
                    else if (label[p - F] === lightest) { out[p] = right; line[p] = 0; }
                }
            }
        }
        // Tone glow around the most vivid cel, in its own ink
        if (vivid.length) {
            const v = vivid[0], mask = new Float32Array(n);
            for (let p = 0; p < n; p++) mask[p] = label[p] === v ? 1 : 0;
            boxBlur(mask, W, H, px(10)); boxBlur(mask, W, H, px(10));
            const before = Uint8Array.from(out);
            const D = 8 * S;
            for (let y = D / 2; y < H; y += D) {
                for (let x = D / 2 + (Math.round(y / D - 0.5) % 2) * D / 2; x < W; x += D) {
                    const p = Math.floor(y) * W + Math.floor(x);
                    if (label[p] === v) continue;
                    const m = mask[p];
                    if (m < 0.06 || m > 0.9) continue;
                    dot(out, x, y, (0.6 + m * 2.6) * S, v);
                }
            }
            for (let p = 0; p < n; p++) if (out[p] !== before[p]) line[p] = 0;
        }

        // Separate: the plate covering most at the bottom, K on top
        const count = new Int32Array(a.keys.length);
        let lineCount = 0;
        for (let p = 0; p < n; p++) line[p] ? lineCount++ : count[out[p]]++;
        const pct = c => `${(Math.round(c / n * 1000) / 10).toFixed(1)}%`;
        a.keys.map((k, j) => j).sort((i, j) => count[j] - count[i]).forEach((j, i) => {
            paintPixels(plates[i].ctx, p => (out[p] === j && !line[p] ? ink[j] : null));
            plates[i].text = `P${i + 1}`;
        });
        const K = plates[plates.length - 1];
        paintPixels(K.ctx, p => (line[p] ? ink[darkest] : null));
        K.text = 'K';
        if (explode > 0) plates.forEach(P => { P.tag.textContent = P.text; });

        $('proof-source').textContent = `${a.srcW} × ${a.srcH}`;
        $('proof-line').textContent = pct(lineCount);
    }

    // No image (default palette, or retrieved without a thumbnail): a blank
    // field guide, the sheet a cut is drawn on — in interface ink, since
    // there is no data to print yet (DESIGN.md §6.1)
    const FIELDS = [12, 10, 8, 6, 4];   // field sizes, outermost = the full frame
    function renderEmpty() {
        const f = plates[0].ctx;
        const css = getComputedStyle(document.documentElement);
        const ink = css.getPropertyValue('--text-color').trim() || '#F5F0E8';
        const signal = css.getPropertyValue('--signal').trim() || '#00E5FF';
        f.save();
        f.strokeStyle = ink;
        f.lineWidth = S;
        f.globalAlpha = 0.22;
        f.beginPath(); f.moveTo(0, 0); f.lineTo(W, H); f.moveTo(W, 0); f.lineTo(0, H); f.stroke();
        f.font = `600 ${11 * S}px "IBM Plex Mono", monospace`;
        f.fillStyle = ink;
        FIELDS.forEach((n, i) => {
            const k = n / FIELDS[0], w = W * k, h = H * k, x = (W - w) / 2, y = (H - h) / 2;
            f.globalAlpha = i === 0 ? 0 : (i === 1 ? 0.55 : 0.28);   // 12F is the frame itself
            f.strokeRect(x + S / 2, y + S / 2, w - S, h - S);
            f.globalAlpha = 0.55;
            f.fillText(`${n}F`, x + 8 * S, y + 18 * S);
        });
        // Centre cross, in signal: the one mark a cut is registered on
        f.globalAlpha = 1;
        f.strokeStyle = signal;
        f.lineWidth = 2 * S;
        f.beginPath(); f.moveTo(W / 2 - 18 * S, H / 2); f.lineTo(W / 2 + 18 * S, H / 2);
        f.moveTo(W / 2, H / 2 - 18 * S); f.lineTo(W / 2, H / 2 + 18 * S); f.stroke();
        f.beginPath(); f.arc(W / 2, H / 2, 8 * S, 0, Math.PI * 2); f.stroke();
        f.restore();
        $('proof-empty-tag').textContent = palette.isDefault ? 'NO CUT — AWAITING DEPOSIT' : 'NO CUT — SOURCE NOT KEPT';
        $('proof-source').textContent = '—';
        $('proof-line').textContent = '—';
        plates.forEach((P, i) => {
            P.text = i === plates.length - 1 ? 'K' : `P${i + 1}`;
            if (explode > 0) P.tag.textContent = P.text;
        });
    }

    function keptThumb() {
        if (typeof thumbs !== 'object' || !palette) return null;
        const t = thumbs[Object.values(palette.theme).join('')];
        if (!t) return null;
        if (!t.img) { t.img = new Image(); t.img.onload = () => applyMockupTheme(); t.img.src = t.src; }
        return t.img.complete && t.img.naturalWidth ? t.img : null;
    }

    // The proof follows the theme main.js shows in it (extracted, or its derived opposite)
    const prevApplyMockup = applyMockupTheme;
    applyMockupTheme = function () {
        prevApplyMockup();
        if (!palette) return;
        $('mockup-badge').textContent = palette.coverage == null ? '—' : `${palette.coverage}%`;
        render(proofInverted ? invertTheme(palette.theme) : palette.theme);
    };

    // ---- Take apart / install ----
    let explode = 0;
    function setExplode(n) {
        n = Math.max(0, Math.min(STEPS, n));
        if (n === explode) return;
        const opening = explode === 0 && n > 0;
        explode = n;
        stage.style.setProperty('--e', (n / STEPS).toFixed(3));
        stage.classList.toggle('apart', n > 0);
        FX.split(rig, 120);
        if (opening) plates.forEach((P, i) => setTimeout(() => FX.decode(P.tag, P.text, 260), i * 70));
        if (n === 0) { stage.classList.remove('locked'); void stage.offsetWidth; stage.classList.add('locked'); }
        syncEject();
    }
    function runTo(target) {
        const dir = Math.sign(target - explode);
        if (!dir) return;
        if (still) { setExplode(target); return; }
        const step = () => { setExplode(explode + dir); if (explode !== target) setTimeout(step, 90); };
        step();
    }
    // Depth scales with the frame and the plate count, so the stack stays
    // inside it at any width (tuned at 819 px wide: 224 px from bottom to
    // top plate, 1800 px perspective)
    function sizeDepth() {
        const w = stage.clientWidth;
        stage.style.setProperty('--z-step', (w * 0.272 / Math.max(1, plates.length - 1)).toFixed(1) + 'px');
        stage.style.setProperty('--persp', (w * 2.2).toFixed(0) + 'px');
    }
    new ResizeObserver(sizeDepth).observe(stage);

    // One control: EJECT takes it apart, the same button seats it again
    const ejectBtn = $('proof-eject');
    const syncEject = () => {
        const apart = explode > 0;
        ejectBtn.textContent = apart ? 'INSTALL' : 'EJECT PLATES';
        ejectBtn.setAttribute('aria-pressed', apart);
    };
    ejectBtn.addEventListener('click', () => runTo(explode > 0 ? 0 : STEPS));

    let drag = null;
    stage.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        drag = { x: e.clientX, start: explode };
        stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => { if (drag) setExplode(drag.start + Math.round((e.clientX - drag.x) / 50)); });
    stage.addEventListener('pointerup', () => { drag = null; });
    stage.addEventListener('pointercancel', () => { drag = null; });

    applyMockupTheme();
})();
