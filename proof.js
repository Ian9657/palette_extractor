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

    // The worker develops the cut; the page only reads the photo and lays
    // the plates it returns. While a cut develops the last one stays up.
    const worker = new Worker('proof-worker.js');
    let job = 0, sent = { img: null, key: '' }, imgIds = new WeakMap(), nextImg = 0;
    function render(theme) {
        const img = currentImgEl || keptThumb();
        stage.classList.toggle('empty', !img);
        if (!img) {
            job++;                                    // a cut still developing is dropped
            setPlateCount(Object.keys(palette.theme).length + 1);
            plates.forEach(P => P.ctx.clearRect(0, 0, W, H));
            renderEmpty();
            return;
        }
        const key = Object.values(palette.theme).join('');
        const msg = { id: ++job, W, H, theme: palette.theme, shown: theme }, move = [];
        if (sent.img !== img || sent.key !== key) {
            // Working size: the source's own detail, 480 wide at least, the frame at most
            if (!imgIds.has(img)) imgIds.set(img, ++nextImg);
            const crop = frameCut(img);
            const w = Math.round(Math.min(W, Math.max(480, crop.w)) / 16) * 16, h = w / 16 * 9;
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const x = c.getContext('2d', { willReadFrequently: true });
            x.imageSmoothingQuality = 'high';   // a large photo shrinks without aliasing
            x.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
            const data = x.getImageData(0, 0, w, h).data;
            msg.src = { imgId: imgIds.get(img), data, w, h, soft: w / crop.w, crop, srcW: img.naturalWidth, srcH: img.naturalHeight };
            move.push(data.buffer);
            sent = { img, key };
        }
        worker.postMessage(msg, move);
    }
    worker.onmessage = e => {
        const r = e.data;
        if (r.id !== job) return;                     // a newer cut is on its way
        setPlateCount(r.plates.length);
        r.plates.forEach((buf, i) => {
            plates[i].ctx.putImageData(new ImageData(new Uint8ClampedArray(buf), W, H), 0, 0);
            plates[i].text = i === r.plates.length - 1 ? 'K' : `P${i + 1}`;
        });
        if (explode > 0) plates.forEach(P => { P.tag.textContent = P.text; });
        $('proof-source').textContent = `${r.srcW} × ${r.srcH}`;
        $('proof-line').textContent = `${(Math.round(r.lineShare * 1000) / 10).toFixed(1)}%`;
    };

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
