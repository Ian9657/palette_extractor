// Proof: the current palette rendered as a night-city frame, one layer per
// role, that can be taken apart like a cyberware install (DESIGN.md §3.3 —
// the proof is a screen, so it carries signal; §6.2 — every pixel is a data
// colour, nothing else).
//
//   L1 BACKLIGHT  a blown-out glass façade, ordered-dithered in three tones
//   L2 STRUCTURE  mullions, beams and the slab edge
//   L3 CITY       window bands; the lit share is the palette's coverage
//   L4 RUNNERS    two silhouettes mid-leap — the only figures that move
//   L5 SIGNAL     neon signs and rain; a sign holds steady only if its colour
//                 really clears 3:1 against its plate, otherwise it faults
//
// Drag the frame to separate the layers (stepped, never smooth); EJECT and
// INSTALL run the same steps automatically.
(() => {
    const W = 960, H = 540;
    const STEPS = 6;                        // explode positions between assembled and apart
    const TICK = 83;                        // ~12 fps for rain, flicker and runners
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const $ = id => document.getElementById(id);
    const stage = $('proof-stage'), rig = $('proof-rig');

    const LAYERS = [
        { key: 'backlight', name: 'L1 BACKLIGHT' },
        { key: 'structure', name: 'L2 STRUCTURE' },
        { key: 'city', name: 'L3 CITY' },
        { key: 'runners', name: 'L4 RUNNERS' },
        { key: 'signal', name: 'L5 SIGNAL' }
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
        L.wrap = wrap; L.canvas = c; L.ctx = c.getContext('2d'); L.tag = tag;
    });
    const layer = key => LAYERS.find(L => L.key === key);

    // ---- Colours: picked from the palette by job, never invented ----
    let inks = null;
    function pickInks(theme) {
        const keys = ROLE_KEYS[Object.keys(theme).length];
        const names = ROLE_NAMES[keys.length];
        const all = keys.map((key, i) => {
            const rgb = hexToRgb(theme[key]);
            return { key, role: names[i], hex: theme[key], rgb, ...toLch(rgb) };
        });
        const byL = all.slice().sort((a, b) => a.L - b.L);
        const dark = byL[0], light = byL[byL.length - 1];
        const rest = all.filter(c => c !== dark && c !== light);
        const byC = rest.slice().sort((a, b) => b.C - a.C);
        const neonA = byC[0] || light;
        const neonB = byC[1] || neonA;
        // the glow's second tone: the lightest remaining colour, so the dither reads as falloff
        const mid = rest.slice().sort((a, b) => b.L - a.L).find(c => c !== neonA) || neonA;
        return { dark, light, mid, neonA, neonB };
    }

    // ---- L1: backlight, three-tone Bayer dither around a hotspot ----
    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
    const FACADE_BOTTOM = 0.7 * H;
    function drawBacklight(ctx) {
        const img = ctx.createImageData(W, H);
        const d = img.data;
        const B = 3;                                  // dither cell in px: visible, screen-like
        const { light, mid, dark } = inks;
        const hx = 0.56 * W, hy = 0.34 * H;
        for (let y = 0; y < H; y += B) {
            for (let x = 0; x < W; x += B) {
                let c = dark.rgb;
                if (y < FACADE_BOTTOM) {
                    const dx = (x - hx) / W, dy = (y - hy) / FACADE_BOTTOM;
                    const r = Math.sqrt(dx * dx * 1.3 + dy * dy * 0.9);
                    // 2 = blown out, 1 = mid tone, 0 = dark; the wall stays lit to its edges
                    let v = Math.max(0.15, 2.2 - r * 2.6);
                    const t = BAYER[((y / B) % 4) * 4 + ((x / B) % 4)];
                    c = v > 1 ? (v - 1 > t ? light.rgb : mid.rgb) : (v > t ? mid.rgb : dark.rgb);
                }
                for (let yy = y; yy < Math.min(H, y + B); yy++) {
                    for (let xx = x; xx < Math.min(W, x + B); xx++) {
                        const i = (yy * W + xx) * 4;
                        d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b; d[i + 3] = 255;
                    }
                }
            }
        }
        ctx.putImageData(img, 0, 0);
    }

    // ---- L2: structure — skewed mullion grid, three beams, slab edge ----
    function drawStructure(ctx) {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = ctx.strokeStyle = inks.dark.hex;
        const skew = 0.22;                             // the façade leans: verticals drift right as they rise
        ctx.lineWidth = 7;
        for (let i = -2; i <= 9; i++) {
            const x0 = i * W / 7;
            ctx.beginPath(); ctx.moveTo(x0, FACADE_BOTTOM); ctx.lineTo(x0 + skew * FACADE_BOTTOM, 0); ctx.stroke();
        }
        ctx.lineWidth = 4;
        for (let j = 1; j < 5; j++) {
            const y = FACADE_BOTTOM * j / 5;
            ctx.beginPath(); ctx.moveTo(0, y + 10); ctx.lineTo(W, y - 10); ctx.stroke();
        }
        const beam = (x1, y1, x2, y2, w) => {
            const a = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(a) * w / 2, ny = Math.cos(a) * w / 2;
            ctx.beginPath();
            ctx.moveTo(x1 + nx, y1 + ny); ctx.lineTo(x2 + nx, y2 + ny); ctx.lineTo(x2 - nx, y2 - ny); ctx.lineTo(x1 - nx, y1 - ny);
            ctx.fill();
        };
        beam(-40, 0.08 * H, 0.46 * W, FACADE_BOTTOM, 34);
        beam(0.62 * W, -20, W + 40, 0.52 * H, 28);
        beam(0.18 * W, FACADE_BOTTOM, 0.98 * W, 0.12 * H, 18);
        ctx.fillRect(0, FACADE_BOTTOM - 4, W, 22);    // the slab the runners cross
    }

    // ---- L3: city — window bands lit in proportion to coverage ----
    function windows(ctx, rand, x0, y0, w, h, cw, ch, lit) {
        for (let y = y0; y + ch <= y0 + h; y += ch) {
            for (let x = x0; x + cw <= x0 + w; x += cw) {
                if (rand() > lit) continue;
                ctx.fillStyle = rand() < 0.86 ? inks.neonA.hex : inks.light.hex;
                ctx.fillRect(x + 1, y + 1, cw - 3, ch - 3);
            }
        }
    }
    function drawCity(ctx, lit) {
        ctx.clearRect(0, 0, W, H);
        const rand = mulberry32(7);
        const top = FACADE_BOTTOM + 18;
        // the building's lower floors: a dense grid of small windows
        ctx.fillStyle = inks.dark.hex;
        ctx.fillRect(0, top, W, H - top);
        windows(ctx, rand, 0, top + 6, W, H - top - 6, 9, 8, lit);
        // floor slabs every few rows read as storeys
        ctx.fillStyle = inks.dark.hex;
        for (let y = top + 6 + 32; y < H; y += 32) ctx.fillRect(0, y - 2, W, 4);
        // two towers in front, cut against the glow, with their own sparse windows
        const towers = [[0, 0.46 * H, 0.13 * W], [0.83 * W, 0.4 * H, 0.17 * W]];
        for (const [x, y, w] of towers) {
            ctx.fillStyle = inks.dark.hex;
            ctx.fillRect(x, y, w, H - y);
            ctx.fillRect(x + w * 0.3, y - 26, 3, 26);        // antenna
            windows(ctx, rand, x + 6, y + 10, w - 12, H - y - 16, 8, 11, lit * 0.6);
        }
    }

    // ---- L4: runners — two angular silhouettes, two-frame stride ----
    // Joints as [x, y] in a 100-unit box; limbs are thick strokes.
    // Mid-leap, leaning hard into the run: front leg reaching, back leg trailing high.
    const POSES = [
        { head: [70, 10], neck: [64, 19], hip: [44, 46], hand1: [92, 22], hand2: [30, 18], knee1: [66, 56], foot1: [84, 74], knee2: [26, 54], foot2: [4, 40] },
        { head: [71, 12], neck: [65, 21], hip: [45, 48], hand1: [86, 36], hand2: [36, 12], knee1: [62, 62], foot1: [78, 82], knee2: [30, 50], foot2: [10, 52] }
    ];
    function drawRunner(ctx, ox, oy, s, pose, flip) {
        const P = ([x, y]) => [ox + (flip ? 100 - x : x) * s, oy + y * s];
        const limb = (a, b, w) => { ctx.lineWidth = w * s; ctx.beginPath(); ctx.moveTo(...P(a)); ctx.lineTo(...P(b)); ctx.stroke(); };
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        limb(pose.neck, pose.hip, 13);
        limb(pose.neck, pose.hand1, 5); limb(pose.neck, pose.hand2, 5);
        limb(pose.hip, pose.knee1, 7); limb(pose.knee1, pose.foot1, 5);
        limb(pose.hip, pose.knee2, 7); limb(pose.knee2, pose.foot2, 5);
        const [hx, hy] = P(pose.head);
        ctx.beginPath(); ctx.arc(hx, hy, 7 * s, 0, Math.PI * 2); ctx.fill();
        // a coat tail trailing the stride
        ctx.beginPath(); ctx.moveTo(...P(pose.hip)); ctx.lineTo(...P([pose.hip[0] - 22, pose.hip[1] + 6])); ctx.lineTo(...P([pose.hip[0] - 6, pose.hip[1] - 14])); ctx.fill();
    }
    function drawRunners(ctx, frame) {
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = ctx.strokeStyle = inks.dark.hex;
        const lift = frame % 2 ? -3 : 0;
        drawRunner(ctx, 0.36 * W, 0.3 * H + lift, 1.7, POSES[frame % 2], false);
        drawRunner(ctx, 0.53 * W, 0.2 * H - lift, 1.55, POSES[(frame + 1) % 2], false);
    }

    // ---- L5: signal — neon signs that fault below 3:1, stepped rain ----
    let signs = [];
    function measureSigns() {
        const { dark, neonA, neonB } = inks;
        signs = [
            { ink: neonA, x: 0.035 * W, y: 0.08 * H, ratio: contrastRatio(neonA.rgb, dark.rgb) },
            { ink: neonB, x: 0.9 * W, y: 0.16 * H, ratio: contrastRatio(neonB.rgb, dark.rgb) }
        ];
        signs.forEach(s => { s.ok = s.ratio >= 3; s.text = s.ink.hex.slice(1); });
        $('proof-signs').textContent = signs.map((s, i) => `${'AB'[i]} ${s.ratio.toFixed(1)}:1${s.ok ? '' : ' FAULT'}`).join(' · ');
    }
    function drawSignal(ctx, frame) {
        ctx.clearRect(0, 0, W, H);
        const rand = mulberry32(1000 + frame);
        for (const s of signs) {
            const glyph = 30, pad = 10, h = s.text.length * glyph + pad * 2;
            ctx.fillStyle = inks.dark.hex;
            ctx.fillRect(s.x, s.y, glyph + pad * 2, h);
            ctx.font = `700 ${glyph}px "IBM Plex Mono", monospace`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            [...s.text].forEach((ch, i) => {
                // a failing sign has dead letters and drops out on random frames
                const dead = !s.ok && (i % 3 === 1 || rand() < 0.35);
                if (dead) return;
                ctx.fillStyle = s.ink.hex;
                ctx.fillText(ch, s.x + pad + glyph / 2, s.y + pad + i * glyph);
            });
            ctx.strokeStyle = s.ink.hex; ctx.lineWidth = 2;
            if (s.ok || rand() > 0.4) ctx.strokeRect(s.x + 2, s.y + 2, glyph + pad * 2 - 4, h - 4);
        }
        // rain: short diagonal strokes, solid light ink, stepping down each tick
        ctx.strokeStyle = inks.light.hex; ctx.lineWidth = 1;
        const drops = mulberry32(3);
        ctx.beginPath();
        for (let i = 0; i < 90; i++) {
            const x = drops() * W, y = (drops() * H + frame * 38) % H;
            ctx.moveTo(x, y); ctx.lineTo(x - 7, y + 22);
        }
        ctx.stroke();
    }

    // ---- Render ----
    let frame = 0, timer = null;
    function render(theme, coverage) {
        inks = pickInks(theme);
        const lit = coverage == null ? 0.35 : Math.max(0.05, Math.min(0.95, coverage / 100));
        $('mockup-badge').textContent = coverage == null ? '—' : `${coverage}%`;
        measureSigns();
        drawBacklight(layer('backlight').ctx);
        drawStructure(layer('structure').ctx);
        drawCity(layer('city').ctx, lit);
        drawRunners(layer('runners').ctx, frame);
        drawSignal(layer('signal').ctx, frame);
        const used = { backlight: [inks.light, inks.mid], structure: [inks.dark], city: [inks.neonA, inks.dark], runners: [inks.dark], signal: [inks.neonA, inks.neonB] };
        LAYERS.forEach(L => {
            L.text = `${L.name} · ${used[L.key].map(c => `${c.role} ${c.hex}`).join(' + ')}`;
            if (explode > 0) L.tag.textContent = L.text;
        });
        if (!still && !timer) timer = setInterval(tick, TICK);
    }
    function tick() {
        if (document.hidden || !inks) return;
        frame++;
        if (frame % 3 === 0) drawRunners(layer('runners').ctx, frame / 3);
        drawSignal(layer('signal').ctx, frame);
    }

    // The proof follows the theme main.js shows in the proof (extracted or its derived opposite)
    const prevApplyMockup = applyMockupTheme;
    applyMockupTheme = function () {
        prevApplyMockup();
        if (!palette) return;
        render(proofInverted ? invertTheme(palette.theme) : palette.theme, palette.coverage);
    };

    // ---- Take apart / install ----
    let explode = 0;                      // 0 … STEPS
    function setExplode(n, quiet) {
        n = Math.max(0, Math.min(STEPS, n));
        if (n === explode) return;
        const opening = explode === 0 && n > 0;
        explode = n;
        stage.style.setProperty('--e', (n / STEPS).toFixed(3));
        stage.classList.toggle('apart', n > 0);
        if (!quiet) FX.split(rig, 120);
        if (opening) LAYERS.forEach((L, i) => setTimeout(() => FX.decode(L.tag, L.text, 260), i * 70));
        if (n === 0) {
            stage.classList.remove('locked'); void stage.offsetWidth; stage.classList.add('locked');
        }
    }
    function runTo(target) {
        const dir = Math.sign(target - explode);
        if (!dir) return;
        if (still) { setExplode(target); return; }
        const step = () => { setExplode(explode + dir); if (explode !== target) setTimeout(step, 90); };
        step();
    }
    $('proof-eject').addEventListener('click', () => runTo(STEPS));
    $('proof-install').addEventListener('click', () => runTo(0));

    // Drag horizontally to separate; the value snaps to whole steps
    let drag = null;
    stage.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        drag = { x: e.clientX, start: explode };
        stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
        if (!drag) return;
        setExplode(drag.start + Math.round((e.clientX - drag.x) / 50));
    });
    const endDrag = () => { drag = null; };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    applyMockupTheme();
})();
