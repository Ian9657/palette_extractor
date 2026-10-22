// Night-city layer: HUD clock and the scanner lens. The lens follows the
// pointer; when idle (or on touch) it drifts on its own so the page always
// shows a window into the virtual side.
const clockEl = document.getElementById('hud-clock');
const lens = document.getElementById('lens');
const lensReadout = document.getElementById('lens-readout');

const editionEl = document.getElementById('hud-edition');

function tickClock() {
    const d = new Date();
    clockEl.textContent = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
    if (editionEl) editionEl.textContent = d.getHours() >= 6 && d.getHours() < 18 ? 'DAY EDITION' : 'NIGHT EDITION';
}
tickClock();
setInterval(tickClock, 1000);

// Colour of whatever is painted under the lens centre (first opaque background up the tree)
function colourAt(x, y) {
    let el = document.elementFromPoint(x, y);
    if (el && el.tagName === 'CANVAS' && el.width) {
        // Preview canvas is drawn with object-fit: contain
        const r = el.getBoundingClientRect();
        const scale = Math.min(r.width / el.width, r.height / el.height);
        const px = Math.floor((x - r.left - (r.width - el.width * scale) / 2) / scale);
        const py = Math.floor((y - r.top - (r.height - el.height * scale) / 2) / scale);
        if (px >= 0 && py >= 0 && px < el.width && py < el.height) {
            const [r8, g8, b8] = el.getContext('2d', { willReadFrequently: true }).getImageData(px, py, 1, 1).data;
            return rgbToHex({ r: r8, g: g8, b: b8 });
        }
        el = el.parentElement;
    }
    while (el && el !== document.documentElement) {
        const bg = getComputedStyle(el).backgroundColor;
        const m = bg.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/);
        if (m && (m[4] === undefined || +m[4] > 0.5)) return rgbToHex({ r: +m[1], g: +m[2], b: +m[3] });
        el = el.parentElement;
    }
    return '#07080D';
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let lensX = innerWidth * 0.5, lensY = innerHeight * 0.3;
let aimLX = lensX, aimLY = lensY;
let lastPointer = -Infinity;
const IDLE_MS = 2500;

window.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    aimLX = e.clientX; aimLY = e.clientY;
    lastPointer = performance.now();
});

let lastReadout = 0;
function lensLoop(t) {
    if (t - lastPointer > IDLE_MS && !reduceMotion) {
        // Slow Lissajous wander over the viewport
        const s = t / 1000;
        aimLX = innerWidth * (0.5 + 0.32 * Math.sin(s * 0.23));
        aimLY = innerHeight * (0.45 + 0.28 * Math.sin(s * 0.31 + 1.2));
    }
    const ease = t - lastPointer > IDLE_MS ? 0.03 : 0.22;
    lensX += (aimLX - lensX) * ease;
    lensY += (aimLY - lensY) * ease;
    lens.style.left = lensX + 'px';
    lens.style.top = lensY + 'px';
    lens.classList.toggle('flip', lensX > innerWidth * 0.6);   // keep the readout on screen

    if (t - lastReadout > 120) {
        lastReadout = t;
        const hex = colourAt(lensX, lensY);   // the lens is pointer-events: none, so hit-testing skips it
        lensReadout.textContent = `VIRTUAL · X${String(Math.round(lensX)).padStart(4, '0')} Y${String(Math.round(lensY)).padStart(4, '0')} · ${hex}`;
    }
    requestAnimationFrame(lensLoop);
}
requestAnimationFrame(lensLoop);
