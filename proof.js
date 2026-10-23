// Proof: the deposited photo re-rendered as one cel of anime, using only the
// palette (DESIGN.md §6.2). The five layers are the stages a cel goes through,
// so EJECT shows how the frame is built:
//
//   L1 COLOUR    flat fills — every area takes its nearest palette colour
//   L2 SHADOW    one hard shadow step, in the next darker palette colour
//   L3 TONE      screen-tone dots where a gradient would have been
//   L4 LINE      ink lines from cel boundaries and strong edges
//   L5 COMPOSITE chromatic fringes on the brightest cel, tone glow around the
//                most vivid one, and Sandevistan afterimages trailing the
//                most salient shapes — one palette colour per echo
//
// Static: nothing animates. Taking it apart (EJECT ⇄ INSTALL, or drag) moves in steps.
(() => {
    const W = 960, H = 540;
    const STEPS = 6;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const $ = id => document.getElementById(id);
    const stage = $('proof-stage'), rig = $('proof-rig');

    const LAYERS = [
        { key: 'fill', name: 'L1 COLOUR' },
        { key: 'shadow', name: 'L2 SHADOW' },
        { key: 'tone', name: 'L3 TONE' },
        { key: 'line', name: 'L4 LINE' },
        { key: 'fx', name: 'L5 COMPOSITE' }
    ];
    LAYERS.forEach((L, i) => {
        const wrap = document.createElement('div');
        wrap.className = 'proof-layer';
        wrap.style.setProperty('--i', i);
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const tag = document.createElement('span');
        tag.className = 'proof-tag';
        wrap.append(c, tag);
        rig.appendChild(wrap);
        L.ctx = c.getContext('2d'); L.tag = tag;
    });
    const ctxOf = key => LAYERS.find(L => L.key === key).ctx;

    // ---- Analysis: depends on the image and the extracted palette only ----
    let cache = { img: null, key: '', a: null };
    const labDist = (p, q) => {   // chroma counts double so hue boundaries survive
        const dL = p.L - q.L, da = (p.a - q.a) * 2, db = (p.b - q.b) * 2;
        return dL * dL + da * da + db * db;
    };

    function analyse(img, theme) {
        const key = Object.values(theme).join('');
        if (cache.img === img && cache.key === key) return cache.a;

        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d', { willReadFrequently: true });
        const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);   // cover the 16:9 frame
        const w = img.naturalWidth * s, h = img.naturalHeight * s;
        x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
        const data = x.getImageData(0, 0, W, H).data;
        const n = W * H;

        const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
        for (let p = 0; p < n; p++) {
            const ok = rgbToOklab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
            L[p] = ok.L; A[p] = ok.a; B[p] = ok.b;
        }
        // detail L for tone/lines; heavily smoothed copies decide the cels
        const Ls = Float32Array.from(L), As = Float32Array.from(A), Bs = Float32Array.from(B);
        for (const ch of [L, A, B]) { boxBlur(ch, W, H, 1); boxBlur(ch, W, H, 1); }
        for (const ch of [Ls, As, Bs]) { boxBlur(ch, W, H, 4); boxBlur(ch, W, H, 4); }

        const keys = Object.keys(theme);
        const pal = keys.map(k => { const ok = rgbToOklab(...Object.values(hexToRgb(theme[k]))); return ok; });

        // Nearest palette colour per pixel, then three 5×5 majority passes to flatten speckle into cels
        let label = new Uint8Array(n);
        for (let p = 0; p < n; p++) {
            const q = { L: Ls[p], a: As[p], b: Bs[p] };
            let best = Infinity, bi = 0;
            for (let j = 0; j < pal.length; j++) { const d = labDist(q, pal[j]); if (d < best) { best = d; bi = j; } }
            label[p] = bi;
        }
        const votes = new Uint8Array(pal.length);
        for (let pass = 0; pass < 3; pass++) {
            const next = new Uint8Array(label);
            for (let y = 2; y < H - 2; y++) {
                for (let xx = 2; xx < W - 2; xx++) {
                    votes.fill(0);
                    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) votes[label[(y + dy) * W + xx + dx]]++;
                    let m = 0, mi = label[y * W + xx];
                    for (let j = 0; j < votes.length; j++) if (votes[j] > m) { m = votes[j]; mi = j; }
                    next[y * W + xx] = mi;
                }
            }
            label = next;
        }

        // Shadow and tone: how far each pixel sits below its cel's own lightness
        const below = new Float32Array(n);
        for (let p = 0; p < n; p++) below[p] = pal[label[p]].L - L[p];

        // Edges: Sobel on lightness
        const edge = new Float32Array(n);
        for (let y = 1; y < H - 1; y++) {
            for (let xx = 1; xx < W - 1; xx++) {
                const i = y * W + xx;
                const gx = L[i - W + 1] + 2 * L[i + 1] + L[i + W + 1] - L[i - W - 1] - 2 * L[i - 1] - L[i + W - 1];
                const gy = L[i + W - 1] + 2 * L[i + W] + L[i + W + 1] - L[i - W - 1] - 2 * L[i - W] - L[i - W + 1];
                edge[i] = Math.sqrt(gx * gx + gy * gy);
            }
        }

        // Salient shapes for the afterimages: top 5% of saliency, outside the darkest cel
        const sal = saliencyMap(data, W, H);
        const sorted = Float32Array.from(sal).sort();
        const cut = sorted[Math.floor(n * 0.95)];
        const darkest = pal.reduce((m, q, j) => (q.L < pal[m].L ? j : m), 0);
        // close the scattered salient pixels into shapes, then keep the two biggest
        const blob = new Float32Array(n);
        for (let p = 0; p < n; p++) blob[p] = sal[p] >= cut && label[p] !== darkest ? 1 : 0;
        boxBlur(blob, W, H, 6); boxBlur(blob, W, H, 6);
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
        const keep = sizes.map((sz, id) => [sz, id]).sort((u, v) => v[0] - u[0]).slice(0, 2)
            .filter(([sz]) => sz > n * 0.004).map(([, id]) => id);
        const salient = new Uint8Array(n);
        for (let p = 0; p < n; p++) salient[p] = comp[p] >= 0 && keep.includes(comp[p]) ? 1 : 0;

        const a = { label, below, edge, salient, keys, pal, srcW: img.naturalWidth, srcH: img.naturalHeight };
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

    function render(theme) {
        const img = currentImgEl || keptThumb();
        LAYERS.forEach(Lr => Lr.ctx.clearRect(0, 0, W, H));
        stage.classList.toggle('empty', !img);
        if (!img) { renderEmpty(); return; }
        const a = analyse(img, palette.theme);           // cels come from the extracted colours…
        const ink = a.keys.map(k => rgbOf(theme[k]));    // …painted in the shown theme (or its opposite)
        const inkHex = a.keys.map(k => theme[k]);
        const byL = a.keys.map((k, j) => j).sort((i, j) => toLch(ink[i]).L - toLch(ink[j]).L);
        const darkest = byL[0], lightest = byL[byL.length - 1];
        const darker = j => byL[Math.max(0, byL.indexOf(j) - 1)];
        const vivid = a.keys.map((k, j) => j).filter(j => j !== darkest && j !== lightest)
            .sort((i, j) => toLch(ink[j]).C - toLch(ink[i]).C);
        const { label, below, edge, salient } = a;

        // L1 colour
        paintPixels(ctxOf('fill'), p => ink[label[p]]);

        // L2 shadow: one hard step
        const SHADE = 0.07;
        paintPixels(ctxOf('shadow'), p => (below[p] > SHADE && label[p] !== darkest ? ink[darker(label[p])] : null));

        // L3 tone: dots where the pixel is a little below its cel but not yet in shadow
        const tctx = ctxOf('tone');
        tctx.fillStyle = inkHex[darkest];
        const G = 6;
        for (let y = G / 2; y < H; y += G) {
            for (let x = G / 2 + ((y / G) % 2) * G / 2; x < W; x += G) {
                const p = (y | 0) * W + (x | 0);
                const t = (below[p] - 0.015) / (SHADE - 0.015);
                if (t <= 0 || t >= 1 || label[p] === darkest) continue;
                tctx.beginPath(); tctx.arc(x, y, 0.4 + t * G * 0.42, 0, Math.PI * 2); tctx.fill();
            }
        }

        // L4 line: cel boundaries plus strong edges, heavier where the edge is strong
        const T = 0.42;
        const line = new Uint8Array(W * H);
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                const p = y * W + x;
                const boundary = label[p] !== label[p + 1] || label[p] !== label[p + W];
                if (boundary || edge[p] > T) {
                    line[p] = 1;
                    // heavier ink where a cel boundary meets a strong edge: weighted line, like a pen
                    if (boundary && edge[p] > T * 0.6) { line[p + 1] = 1; line[p + W] = 1; }
                }
            }
        }
        let lineCount = 0;
        paintPixels(ctxOf('line'), p => (line[p] ? (lineCount++, ink[darkest]) : null));

        // L5 composite
        const fx = new Array(W * H).fill(null);
        // Sandevistan: echoes trail left of the salient shapes, far ones first
        const echoInks = vivid.length ? vivid.concat(lightest) : [lightest];
        const ECHOES = 4, GAP = 18;
        for (let k = ECHOES; k >= 1; k--) {
            const c = ink[echoInks[(k - 1) % echoInks.length]];
            const dx = k * GAP, dy = -k * 2;
            for (let y = 0; y < H; y++) {
                const sy = y - dy;
                if (sy < 0 || sy >= H) continue;
                for (let x = 0; x < W - dx; x++) {
                    if (salient[sy * W + x + dx] && !salient[y * W + x]) fx[y * W + x] = c;
                }
            }
        }
        // Chromatic fringe on the brightest cel's edges
        if (vivid.length) {
            const left = ink[vivid[0]], right = ink[vivid[1] ?? vivid[0]];
            for (let y = 0; y < H; y++) {
                for (let x = 3; x < W - 3; x++) {
                    const p = y * W + x;
                    if (label[p] === lightest) continue;
                    if (label[p + 3] === lightest) fx[p] = left;
                    else if (label[p - 3] === lightest) fx[p] = right;
                }
            }
        }
        paintPixels(ctxOf('fx'), p => fx[p]);
        // Tone glow around the most vivid cel, in its own ink
        if (vivid.length) {
            const v = vivid[0], mask = new Float32Array(W * H);
            for (let p = 0; p < W * H; p++) mask[p] = label[p] === v ? 1 : 0;
            boxBlur(mask, W, H, 10); boxBlur(mask, W, H, 10);
            const g = ctxOf('fx');
            g.fillStyle = inkHex[v];
            for (let y = 4; y < H; y += 8) {
                for (let x = 4 + ((y / 8) % 2) * 4; x < W; x += 8) {
                    const p = y * W + x;
                    if (label[p] === v) continue;
                    const m = mask[p];
                    if (m < 0.06 || m > 0.9) continue;
                    g.beginPath(); g.arc(x, y, 0.6 + m * 2.6, 0, Math.PI * 2); g.fill();
                }
            }
        }

        $('proof-source').textContent = `${a.srcW} × ${a.srcH}`;
        $('proof-line').textContent = `${Math.round(lineCount / (W * H) * 1000) / 10}%`;
        const used = {
            fill: a.keys.map(k => k.toUpperCase() === 'BG' ? 'BASE' : k.toUpperCase()).length + ' INKS',
            shadow: 'ONE STEP DARKER', tone: inkHex[darkest], line: inkHex[darkest],
            fx: `${ECHOES} ECHOES · FRINGE · GLOW`
        };
        LAYERS.forEach(Lr => {
            Lr.text = `${Lr.name} · ${used[Lr.key]}`;
            if (explode > 0) Lr.tag.textContent = Lr.text;
        });
    }

    // No image (default palette, or retrieved without a thumbnail): a blank
    // field guide, the sheet a cut is drawn on — in interface ink, since
    // there is no data to print yet (DESIGN.md §6.1)
    const FIELDS = [12, 10, 8, 6, 4];   // field sizes, outermost = the full frame
    function renderEmpty() {
        const f = ctxOf('fill');
        const css = getComputedStyle(document.documentElement);
        const ink = css.getPropertyValue('--text-color').trim() || '#F5F0E8';
        const signal = css.getPropertyValue('--signal').trim() || '#00E5FF';
        f.save();
        f.strokeStyle = ink;
        f.lineWidth = 1;
        f.globalAlpha = 0.22;
        f.beginPath(); f.moveTo(0, 0); f.lineTo(W, H); f.moveTo(W, 0); f.lineTo(0, H); f.stroke();
        f.font = '600 11px "IBM Plex Mono", monospace';
        f.fillStyle = ink;
        FIELDS.forEach((n, i) => {
            const k = n / FIELDS[0], w = W * k, h = H * k, x = (W - w) / 2, y = (H - h) / 2;
            f.globalAlpha = i === 0 ? 0 : (i === 1 ? 0.55 : 0.28);   // 12F is the frame itself
            f.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
            f.globalAlpha = 0.55;
            f.fillText(`${n}F`, x + 8, y + 18);
        });
        // Centre cross, in signal: the one mark a cut is registered on
        f.globalAlpha = 1;
        f.strokeStyle = signal;
        f.lineWidth = 2;
        f.beginPath(); f.moveTo(W / 2 - 18, H / 2); f.lineTo(W / 2 + 18, H / 2);
        f.moveTo(W / 2, H / 2 - 18); f.lineTo(W / 2, H / 2 + 18); f.stroke();
        f.beginPath(); f.arc(W / 2, H / 2, 8, 0, Math.PI * 2); f.stroke();
        f.restore();
        $('proof-empty-tag').textContent = palette.isDefault ? 'NO CUT — AWAITING DEPOSIT' : 'NO CUT — SOURCE NOT KEPT';
        $('proof-source').textContent = '—';
        $('proof-line').textContent = '—';
        LAYERS.forEach(Lr => { Lr.text = `${Lr.name} · NO SOURCE`; if (explode > 0) Lr.tag.textContent = Lr.text; });
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
        if (opening) LAYERS.forEach((Lr, i) => setTimeout(() => FX.decode(Lr.tag, Lr.text, 260), i * 70));
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
    // Depth scales with the frame, so the stack stays inside it at any width
    // (tuned at 819 px wide: 56 px between layers, 1800 px perspective)
    new ResizeObserver(() => {
        const w = stage.clientWidth;
        stage.style.setProperty('--z-step', (w * 0.068).toFixed(1) + 'px');
        stage.style.setProperty('--persp', (w * 2.2).toFixed(0) + 'px');
    }).observe(stage);

    // One control: EJECT takes it apart, the same button seats it again
    const ejectBtn = $('proof-eject');
    const syncEject = () => {
        const apart = explode > 0;
        ejectBtn.textContent = apart ? 'INSTALL' : 'EJECT LAYERS';
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
