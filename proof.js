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
// The analysis runs at the source's own detail (480 wide at least): a small
// image is not blown up and read as if its soft edges were detail. Its cels
// are cleaned there, then enlarged as shapes (each ink's coverage sampled
// smoothly, the strongest wins), so edges come out clean curves.
//
// The pixel work runs in proof-worker.js, so the page never freezes while a
// cut develops; this file frames the photo, lays the plates and runs the stack.
//
// Static: nothing animates. Taking it apart (EJECT ⇄ INSTALL, or drag) moves in steps.
(() => {
    const stage0 = document.getElementById('proof-stage');
    const W = Math.round(Math.min(1920, Math.max(960, stage0.clientWidth * (window.devicePixelRatio || 1))) / 16) * 16;
    const H = W / 16 * 9;
    const S = W / 960;
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

    // Framing (here: only the page can read the image): slide a 16:9 window over the photo to hold the most saliency,
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

    // Small sources (icons, logos) are objects, not scenes: shown whole
    const OBJECT_MAX = 480;    // longest side below this, in source pixels
    const OBJECT_FILL = 0.8;   // share of the frame's height (or width) it takes
    const ANALYSE_MAX = 1024;  // widest working size, whatever the frame

    // The ground an object stands on: the mean of its opaque border pixels,
    // or none where the border is mostly transparent
    function groundOf(img) {
        const sw = img.naturalWidth, sh = img.naturalHeight;
        const c = document.createElement('canvas');
        c.width = sw; c.height = sh;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, sw, sh).data;
        let r = 0, g = 0, b = 0, n = 0;
        const take = (px, py) => {
            const i = (py * sw + px) * 4;
            if (d[i + 3] < 128) return;
            r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        };
        for (let px = 0; px < sw; px++) { take(px, 0); take(px, sh - 1); }
        for (let py = 1; py < sh - 1; py++) { take(0, py); take(sw - 1, py); }
        if (n < (sw + sh)) return null;          // mostly transparent: a cut-out
        return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
    }

    // The worker develops the cut; the page only reads the photo and lays
    // the plates it returns. While a cut develops the last one stays up.
    const worker = new Worker('proof-worker.js');
    let job = 0, sent = { img: null, key: '' }, imgIds = new WeakMap(), nextImg = 0;
    function render(theme) {
        const img = currentImgEl || keptThumb();
        if (!img) {
            stage.classList.add('empty');
            job++;                                    // a cut still developing is dropped
            setPlateCount(Object.keys(palette.theme).length + 1);
            plates.forEach(P => P.ctx.clearRect(0, 0, W, H));
            if (explode > 0) setExplode(0);
            ejectBtn.disabled = true;
            renderEmpty(theme);
            return;
        }
        // the card stays up, and nothing can be taken apart, until the cut arrives
        if (stage.classList.contains('empty')) {
            const why = stage.querySelector('.proof-why');
            if (why) why.textContent = 'DEVELOPING';
        }
        const key = Object.values(palette.theme).join('');
        const msg = { id: ++job, W, H, theme: palette.theme, shown: theme }, move = [];
        if (sent.img !== img || sent.key !== key) {
            // Working size: the source's own detail, 480 wide at least, the frame at most
            if (!imgIds.has(img)) imgIds.set(img, ++nextImg);
            const sw = img.naturalWidth, sh = img.naturalHeight;
            const object = Math.max(sw, sh) < OBJECT_MAX;
            const crop = object ? { x: 0, y: 0, w: sw, h: sh } : frameCut(img);
            // (capped at ANALYSE_MAX: the cels are enlarged as shapes, so a finer
            // reading only costs time — a worker may run on a slow core)
            const w = object ? 480 : Math.round(Math.min(W, ANALYSE_MAX, Math.max(480, crop.w)) / 16) * 16, h = w / 16 * 9;
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const x = c.getContext('2d', { willReadFrequently: true });
            x.imageSmoothingQuality = 'high';   // a large photo shrinks without aliasing
            let soft = w / crop.w;
            if (object) {
                // An icon or logo is shown whole, centred on its own ground,
                // like an object on a plinth: never cropped to fill the frame.
                // A cut-out (transparent ground) stays cut out: the worker
                // prints nothing where it is transparent
                const k = Math.min(w * OBJECT_FILL / sw, h * OBJECT_FILL / sh);
                const ground = groundOf(img);
                if (ground) { x.fillStyle = ground; x.fillRect(0, 0, w, h); }
                x.drawImage(img, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k);
                soft = k;
            } else {
                x.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
            }
            const data = x.getImageData(0, 0, w, h).data;
            msg.src = { imgId: imgIds.get(img), data, w, h, soft, crop, object, srcW: sw, srcH: sh };
            move.push(data.buffer);
            sent = { img, key };
        }
        worker.postMessage(msg, move);
    }
    worker.onmessage = e => {
        const r = e.data;
        if (r.id !== job) return;                     // a newer cut is on its way
        stage.classList.remove('empty');
        ejectBtn.disabled = false;
        setPlateCount(r.plates.length);
        r.plates.forEach((buf, i) => {
            plates[i].ctx.putImageData(new ImageData(new Uint8ClampedArray(buf), W, H), 0, 0);
            plates[i].text = i === r.plates.length - 1 ? 'K' : `P${i + 1}`;
        });
        clean = plates.map(P => copyOf(P.ctx.canvas));
        if (explode > 0) plates.forEach(P => { P.tag.textContent = P.text; });
        $('proof-source').textContent = `${r.srcW} × ${r.srcH}`;
        $('proof-line').textContent = `${(Math.round(r.lineShare * 1000) / 10).toFixed(1)}%`;
    };

    // No image (default palette, or retrieved without a thumbnail): a test
    // card, like a set with no signal — SMPTE colour bars laid out in the
    // palette's own inks. As in SMPTE, the bars fall in lightness left to
    // right; each carries its hex. Nothing to take apart until a cut exists.
    function renderEmpty(theme) {
        const f = plates[0].ctx;
        const hex = Object.values(theme).slice()
            .sort((a, b) => toLch(hexToRgb(b)).L - toLch(hexToRgb(a)).L);
        const k = hex.length, bw = W / k;
        const darkest = hex[k - 1], lightest = hex[0];
        const byC = hex.slice().sort((a, b) => toLch(hexToRgb(b)).C - toLch(hexToRgb(a)).C);
        const H1 = Math.round(H * 0.67), H2 = Math.round(H * 0.075);
        const bar = (c, x, y, w, h) => { f.fillStyle = c; f.fillRect(Math.round(x), y, Math.ceil(w), h); };
        // top: the bars; middle: the reverse castellations, every other one dark
        hex.forEach((c, i) => {
            bar(c, i * bw, 0, bw, H1);
            const mirror = k - 1 - i === i ? (i + 1) % k : k - 1 - i;   // never the bar above
            bar(i % 2 ? darkest : hex[mirror], i * bw, H1, bw, H2);
        });
        // bottom, in SMPTE's proportions of the frame: the most vivid, the
        // lightest, the next vivid, dark ground, and a three-strip PLUGE
        // (dark, the next ink up, dark) where black level is checked
        const B = H1 + H2, q = W * 5 / 28, p = W / 21;
        bar(darkest, 0, B, W, H - B);
        bar(byC[0], 0, B, q, H - B);
        bar(lightest, q, B, q, H - B);
        bar(byC[1] || byC[0], 2 * q, B, q, H - B);
        bar(hex[k - 2], W * 5 / 7 + p, B, p, H - B);
        // each bar's hex, at its foot, in the ink that reads on it
        f.font = `600 ${10 * S}px "IBM Plex Mono", monospace`;
        f.textBaseline = 'bottom';
        hex.forEach((c, i) => {
            f.fillStyle = inkOn(c);
            f.fillText(c.toUpperCase(), i * bw + 8 * S, H1 - 8 * S);
        });
        const big = document.createElement('span'), why = document.createElement('span');
        big.className = 'proof-nosignal'; big.textContent = 'NO SIGNAL DETECTED';
        why.className = 'proof-why'; why.textContent = palette.isDefault ? 'AWAITING DEPOSIT' : 'SOURCE NOT KEPT';
        $('proof-empty-tag').replaceChildren(big, why);
        clean = [copyOf(f.canvas)];
        $('proof-source').textContent = '—';
        $('proof-line').textContent = '—';
        plates.forEach((P, i) => { P.text = i === plates.length - 1 ? 'K' : `P${i + 1}`; });
    }

    // The tear, the one glitch this frame has: a few horizontal bands of
    // every plate shift sideways together for three stepped frames, with a
    // channel split, then the frame is whole again. It marks the frame's
    // events (taking it apart, seating it) and, on the test card alone,
    // comes now and then like a dead channel. Never with reduced motion.
    let clean = [], tearing = false, glitchTimer = 0, onScreen = false;
    function copyOf(canvas) {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        c.getContext('2d').drawImage(canvas, 0, 0);
        return c;
    }
    function tear() {
        if (still || tearing || !clean.length) return;
        tearing = true;
        FX.split(stage, 220);
        let frame = 0;
        const step = () => {
            const bands = [];
            if (frame < 3) {
                for (let b = 0; b < 2 + (Math.random() * 3 | 0); b++) {
                    bands.push({
                        y: Math.random() * H | 0, h: (6 + Math.random() * 40) * S | 0,
                        dx: ((Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 70) * S) | 0
                    });
                }
            }
            clean.forEach((c, i) => {
                if (!c || !plates[i]) return;
                const f = plates[i].ctx;
                f.clearRect(0, 0, W, H);
                f.drawImage(c, 0, 0);
                for (const { y, h, dx } of bands) {
                    f.clearRect(0, y, W, h);
                    f.drawImage(c, 0, y, W, h, dx, y, W, h);
                    f.drawImage(c, 0, y, W, h, dx - Math.sign(dx) * W, y, W, h);   // wraps round
                }
            });
            if (frame++ < 3) setTimeout(step, 70); else tearing = false;
        };
        step();
    }
    function scheduleTear() {
        clearTimeout(glitchTimer);
        if (still || !onScreen) return;
        glitchTimer = setTimeout(() => {
            if (stage.classList.contains('empty') && explode === 0) tear();
            scheduleTear();
        }, 2200 + Math.random() * 3800);
    }
    new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; scheduleTear(); }).observe(stage);

    // Seated again: the set reports it, an OSD plate for half a second
    const lock = document.createElement('span');
    lock.className = 'proof-lock';
    lock.textContent = 'SIGNAL LOCKED';
    stage.appendChild(lock);

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
        if (opening) {
            tear();
            plates.forEach((P, i) => setTimeout(() => FX.decode(P.tag, P.text, 260), i * 70));
        }
        if (n === 0) {
            tear();
            lock.classList.remove('show'); void lock.offsetWidth; lock.classList.add('show');
        }
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
        if (e.button !== 0 || stage.classList.contains('empty')) return;
        drag = { x: e.clientX, start: explode };
        stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => { if (drag) setExplode(drag.start + Math.round((e.clientX - drag.x) / 50)); });
    stage.addEventListener('pointerup', () => { drag = null; });
    stage.addEventListener('pointercancel', () => { drag = null; });

    applyMockupTheme();
})();
