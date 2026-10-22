// Proof: the current palette as a still frame of Night City, in five layers
// that can be taken apart like a cyberware install. The language is borrowed
// from Edgerunners (season 1), not its imagery: flat cel colour with hard
// two-step shading, screen-tone dots instead of gradients, a low angle up
// converging megabuildings, a flat moon, chromatic fringes on the brightest
// edges, and Sandevistan-style afterimages — one per palette colour.
// Every pixel is a palette colour (DESIGN.md §6.2). Nothing animates; the
// only motion is taking it apart (EJECT / INSTALL / drag), in steps.
//
//   L1 SKY          night, moon, screen-tone halo
//   L2 MEGABUILDING two towers rising to a vanishing point above the frame
//   L3 NEON         signs and hard light planes; a sign whose colour fails 3:1
//                   against its plate is drawn with dead segments
//   L4 AFTERIMAGE   an elevated train and its trail, one colour per echo
//   L5 RAIN         straight, still strokes
(() => {
    const W = 960, H = 540;
    const STEPS = 6;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const $ = id => document.getElementById(id);
    const stage = $('proof-stage'), rig = $('proof-rig');

    const LAYERS = [
        { key: 'sky', name: 'L1 SKY' },
        { key: 'mega', name: 'L2 MEGABUILDING' },
        { key: 'neon', name: 'L3 NEON' },
        { key: 'after', name: 'L4 AFTERIMAGE' },
        { key: 'rain', name: 'L5 RAIN' }
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

    // ---- Inks: chosen from the palette by job ----
    let inks;
    function pickInks(theme) {
        const keys = ROLE_KEYS[Object.keys(theme).length];
        const names = ROLE_NAMES[keys.length];
        const all = keys.map((key, i) => {
            const rgb = hexToRgb(theme[key]);
            return { key, role: names[i], hex: theme[key], rgb, ...toLch(rgb) };
        });
        const byL = all.slice().sort((a, b) => a.L - b.L);
        const night = byL[0], moon = byL[byL.length - 1];
        const rest = all.filter(c => c !== night && c !== moon);
        const vivid = rest.slice().sort((a, b) => b.C - a.C);
        const neonA = vivid[0] || moon, neonB = vivid[1] || neonA;
        // the towers' lit face: the darkest colour that isn't the night
        const face = rest.slice().sort((a, b) => a.L - b.L)[0] || neonB;
        return { all, night, moon, neonA, neonB, face };
    }

    // ---- Geometry: a low angle; verticals converge on a point above the frame ----
    const VP = { x: 0.5 * W, y: -1.6 * H };
    const toward = (x, y, t) => [x + (VP.x - x) * t, y + (VP.y - y) * t];
    function poly(ctx, pts, fill) {
        ctx.fillStyle = fill;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
    }
    // Screen-tone: dots on a grid, radius set by f(x, y) in 0..1
    function tone(ctx, colour, x0, y0, x1, y1, f, step = 7) {
        ctx.fillStyle = colour;
        for (let y = y0; y < y1; y += step) {
            for (let x = x0 + ((y / step) % 2) * step / 2; x < x1; x += step) {
                const r = f(x, y) * step * 0.55;
                if (r < 0.6) continue;
                ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
            }
        }
    }

    // ---- L1: sky — flat night, flat moon with a chromatic fringe, tone halo ----
    const MOON = { x: 0.5 * W, y: 0.3 * H, r: 0.21 * H };
    function drawSky(ctx) {
        ctx.fillStyle = inks.night.hex;
        ctx.fillRect(0, 0, W, H);
        tone(ctx, inks.face.hex, 0, 0, W, H, (x, y) => {
            const d = Math.hypot(x - MOON.x, y - MOON.y) - MOON.r;
            return d < 0 ? 0 : Math.max(0, 1 - d / (0.5 * H));
        }, 8);
        const disc = (dx, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(MOON.x + dx, MOON.y, MOON.r, 0, Math.PI * 2); ctx.fill(); };
        disc(-5, inks.neonB.hex);
        disc(5, inks.neonA.hex);
        disc(0, inks.moon.hex);
    }

    // ---- L2: megabuildings — two towers, two flat tones, rim light, window grid ----
    function tower(ctx, xL, xR, height, litSide) {
        const top = height;                                      // fraction of the way to the VP
        const bl = [xL, H], br = [xR, H];
        const tl = toward(xL, H, top * 0.62), tr = toward(xR, H, top * 0.62);
        poly(ctx, [bl, br, tr, tl], inks.face.hex);
        // the shadow half: a hard two-step shade, no gradient
        const ml = [xL + (xR - xL) * (litSide === 'right' ? 0 : 0.58), H];
        const mr = [xL + (xR - xL) * (litSide === 'right' ? 0.42 : 1), H];
        const mtl = toward(ml[0], H, top * 0.62), mtr = toward(mr[0], H, top * 0.62);
        poly(ctx, [ml, mr, mtr, mtl], inks.night.hex);
        // windows: perspective columns and floors that crowd together as they rise
        ctx.fillStyle = inks.night.hex;
        const cols = 16, floors = 34;
        for (let f = 0; f < floors; f++) {
            const t0 = top * 0.62 * (1 - Math.pow(1 - f / floors, 1.6));
            const t1 = top * 0.62 * (1 - Math.pow(1 - (f + 0.55) / floors, 1.6));
            for (let c = 0; c < cols; c++) {
                const xa = xL + (xR - xL) * (c + 0.2) / cols, xb = xL + (xR - xL) * (c + 0.75) / cols;
                const q = [toward(xa, H, t0), toward(xb, H, t0), toward(xb, H, t1), toward(xa, H, t1)];
                poly(ctx, q, (f * 7 + c * 3) % 11 === 0 ? inks.moon.hex : inks.night.hex);
            }
        }
        // rim light: one hard edge on the side facing the moon
        ctx.strokeStyle = inks.moon.hex;
        ctx.lineWidth = 3;
        const edge = litSide === 'right' ? [br, tr] : [bl, tl];
        ctx.beginPath(); ctx.moveTo(...edge[0]); ctx.lineTo(...edge[1]); ctx.stroke();
        return { tl, tr };
    }
    function drawMega(ctx) {
        ctx.clearRect(0, 0, W, H);
        // the far tower first, cut against the moon; the near towers frame it
        tower(ctx, 0.44 * W, 0.56 * W, 0.4, 'left');
        tower(ctx, -0.34 * W, 0.2 * W, 0.62, 'right');
        tower(ctx, 0.8 * W, 1.34 * W, 0.6, 'left');
    }

    // ---- L3: neon — signs on the towers, hard light planes ----
    let signs = [];
    function measureSigns() {
        const plate = inks.night;
        signs = [
            { ink: inks.neonA, x: 0.2 * W, y: 0.12 * H, ratio: contrastRatio(inks.neonA.rgb, plate.rgb) },
            { ink: inks.neonB, x: 0.76 * W, y: 0.18 * H, ratio: contrastRatio(inks.neonB.rgb, plate.rgb) }
        ];
        signs.forEach(s => { s.ok = s.ratio >= 3; s.text = s.ink.hex.slice(1); });
        $('proof-signs').textContent = signs.map((s, i) => `${'AB'[i]} ${s.ratio.toFixed(1)}:1${s.ok ? '' : ' FAULT'}`).join(' · ');
    }
    function drawNeon(ctx) {
        ctx.clearRect(0, 0, W, H);
        // glow: a screen-tone halo in the sign's own ink, not a gradient
        for (const s of signs) {
            const cx = s.x + 21, cy = s.y + 90;
            tone(ctx, s.ink.hex, cx - 110, cy - 150, cx + 110, cy + 150,
                (x, y) => Math.max(0, 0.8 - Math.hypot((x - cx) / 110, (y - cy) / 150)), 6);
        }
        for (const s of signs) {
            const glyph = 26, pad = 8, w = glyph + pad * 2, h = s.text.length * glyph + pad * 2;
            ctx.fillStyle = inks.night.hex;
            ctx.fillRect(s.x, s.y, w, h);
            ctx.strokeStyle = s.ink.hex; ctx.lineWidth = 3;
            ctx.strokeRect(s.x + 3, s.y + 3, w - 6, h - 6);
            ctx.font = `700 ${glyph}px "IBM Plex Mono", monospace`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            [...s.text].forEach((ch, i) => {
                if (!s.ok && i % 2 === 1) return;          // a failing sign has dead segments
                ctx.fillStyle = s.ink.hex;
                ctx.fillText(ch, s.x + w / 2, s.y + pad + i * glyph);
            });
        }
    }

    // ---- L4: afterimage — elevated rail, a train, one echo per palette colour ----
    function drawAfter(ctx) {
        ctx.clearRect(0, 0, W, H);
        const railY = 0.78 * H, slope = -0.06;
        const y = x => railY + (x - W / 2) * slope;
        // the rail deck
        poly(ctx, [[0, y(0)], [W, y(W)], [W, y(W) + 26], [0, y(0) + 26]], inks.night.hex);
        ctx.fillStyle = inks.night.hex;
        for (let x = 40; x < W; x += 150) ctx.fillRect(x, y(x) + 20, 16, H - y(x));
        // the train, then its echoes trailing back to the left
        const car = (x0, len, col, h = 44) => poly(ctx, [[x0, y(x0) - h], [x0 + len, y(x0 + len) - h], [x0 + len, y(x0 + len)], [x0, y(x0)]], col);
        const echoes = inks.all.filter(c => c !== inks.night);
        const head = 0.58 * W, len = 330;
        echoes.forEach((c, i) => car(head - (echoes.length - i) * 64, len, c.hex, 44 - (echoes.length - i) * 3));
        car(head, len, inks.night.hex);
        // the train's own windows and a hard rim along its roof
        for (let x = head + 14; x < head + len - 20; x += 26) {
            poly(ctx, [[x, y(x) - 34], [x + 16, y(x + 16) - 34], [x + 16, y(x + 16) - 18], [x, y(x) - 18]], inks.moon.hex);
        }
        ctx.strokeStyle = inks.moon.hex; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(head, y(head) - 44); ctx.lineTo(head + len, y(head + len) - 44); ctx.stroke();
    }

    // ---- L5: rain — still straight strokes ----
    function drawRain(ctx) {
        ctx.clearRect(0, 0, W, H);
        ctx.strokeStyle = inks.moon.hex; ctx.lineWidth = 1.5;
        const r = mulberry32(3);
        ctx.beginPath();
        for (let i = 0; i < 120; i++) {
            const x = r() * W, y = r() * H, l = 18 + r() * 26;
            ctx.moveTo(x, y); ctx.lineTo(x - l * 0.28, y + l);
        }
        ctx.stroke();
    }

    // ---- Render ----
    function render(theme, coverage) {
        inks = pickInks(theme);
        $('mockup-badge').textContent = coverage == null ? '—' : `${coverage}%`;
        measureSigns();
        drawSky(ctxOf('sky'));
        drawMega(ctxOf('mega'));
        drawNeon(ctxOf('neon'));
        drawAfter(ctxOf('after'));
        drawRain(ctxOf('rain'));
        const used = {
            sky: [inks.night, inks.moon],
            mega: [inks.face, inks.night],
            neon: [inks.neonA, inks.neonB],
            after: inks.all.filter(c => c !== inks.night),
            rain: [inks.moon]
        };
        LAYERS.forEach(L => {
            L.text = `${L.name} · ${used[L.key].map(c => c.role).join(' + ')}`;
            if (explode > 0) L.tag.textContent = L.text;
        });
    }

    // The proof follows the theme main.js shows in the proof (extracted or its derived opposite)
    const prevApplyMockup = applyMockupTheme;
    applyMockupTheme = function () {
        prevApplyMockup();
        if (palette) render(proofInverted ? invertTheme(palette.theme) : palette.theme, palette.coverage);
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
        if (opening) LAYERS.forEach((L, i) => setTimeout(() => FX.decode(L.tag, L.text, 260), i * 70));
        if (n === 0) { stage.classList.remove('locked'); void stage.offsetWidth; stage.classList.add('locked'); }
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
