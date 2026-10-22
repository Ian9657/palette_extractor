// Magazine layer over main.js + register.js: writes the feature opener
// (headline, standfirst, caption) from the catalogued data, and runs the lens
// in Fig. 1 — the original photo, with its extracted twin visible inside it.
const mag = id => document.getElementById(id);
const dropZoneEl = mag('drop-zone');
const originalEl = mag('fig-original');
const canvasEl = mag('preview-canvas');
const lensEl = mag('fig-lens');
const lensReadoutEl = mag('fig-lens-readout');
const lensChipEl = mag('fig-lens-chip');

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const dateLine = d => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
mag('mast-date').textContent = dateLine(new Date());

// ---- Feature opener ----
const colourName = hex => ntc.name(hex)[1];

function writeFeature(p, fromStorage) {
    const { theme } = p;
    const k = Object.keys(theme).length;
    mag('feature-headline').textContent = colourName(theme.primary);
    mag('headline-rule').style.setProperty('--headline-colour', theme.primary);
    mag('feature-kicker').textContent = `ACCESSION — ${mag('acc-no').textContent}`;

    if (fromStorage || !currentImgEl) {
        mag('feature-standfirst').textContent = `${k} colours, retrieved from storage. The source image was not kept.`;
        return;
    }
    const w = currentImgEl.naturalWidth, h = currentImgEl.naturalHeight;
    let text = `${k} colours drawn from ${w} × ${h} pixels on ${dateLine(new Date())}.`;
    if (p.coverage != null) text += ` ${p.coverage}% of the surface is not ${colourName(theme.bg)}.`;
    mag('feature-standfirst').textContent = text;
    mag('fig1-cap').textContent = `Source, ${w} × ${h} px. Inside the frame, the same image in its ${k} catalogued colours.`;
}

// ---- Hooks (wrapping the register.js wrappers) ----
const prevProcessImage = processImage;
processImage = function (file) {
    if (isExtracting) { prevProcessImage(file); return; }   // main.js queues it
    dropZoneEl.classList.remove('lensed');
    originalEl.src = URL.createObjectURL(file);
    prevProcessImage(file);
};

const prevExtract = extractColorsVisualized;
extractColorsVisualized = function (...args) {
    if (isExtracting) { prevExtract(...args); return; }   // main.js queues it
    dropZoneEl.classList.remove('lensed');   // let the clustering play out full-frame
    prevExtract(...args);
    if (isExtracting) startScan();
};

// On a worker failure main.js ends the extraction; clear the scan here
worker.addEventListener('error', () => {
    endScan();
    dropZoneEl.classList.toggle('lensed', !!currentImgEl);
});

// ---- Scan development ----
// While k-means runs, a signal line sweeps down the photo: above it the image
// is already in its clustered colours (the frames main.js paints), below it
// still the original. Timed to main.js's playback: MAX_ITER frames at FRAME_MS.
const scanEl = mag('fig-scan');
const scanLabelEl = mag('fig-scan-label');
let scanStart = 0, scanRaf = null;

function startScan() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    cancelAnimationFrame(scanRaf);
    scanStart = performance.now();
    dropZoneEl.classList.add('scanning');
    scanRaf = requestAnimationFrame(scanFrame);
}

function scanFrame(t) {
    const duration = (MAX_ITER + 1) * FRAME_MS;
    const p = Math.min(1, (t - scanStart) / duration);
    const r = imageRect();
    const y = r.y + p * r.h;
    const st = dropZoneEl.style;
    st.setProperty('--scan-y', y + 'px');
    st.setProperty('--scan-x', r.x + 'px');
    st.setProperty('--scan-w', r.w + 'px');
    st.setProperty('--scan-rest', (r.H - y) + 'px');
    const iter = Math.min(MAX_ITER, Math.floor(p * MAX_ITER) + 1);
    scanLabelEl.textContent = `ITER ${String(iter).padStart(2, '0')} / ${MAX_ITER}`;
    if (p < 1 && isExtracting) scanRaf = requestAnimationFrame(scanFrame);
    else endScan();
}

function endScan() {
    cancelAnimationFrame(scanRaf);
    dropZoneEl.classList.remove('scanning');
}

// ---- Press marks: specimen strip + OKLCH under each swatch ----
function renderStrip(theme) {
    const colors = Object.values(theme);
    mag('specimen-strip-chips').innerHTML = colors.map(c => `<span style="background:${c}"></span>`).join('');
    mag('specimen-strip-label').textContent = `${mag('acc-no').textContent} · ${colors.length}`;
    mag('specimen-strip').hidden = false;
}

function oklchLine(hex) {
    const { L, C, H } = toLch(hexToRgb(hex));
    const hue = C < 0.002 ? '—' : `${Math.round(((H * 180 / Math.PI) + 360) % 360)}°`;
    return `L ${L.toFixed(2)}  C ${C.toFixed(2)}  H ${hue}`;
}

// renderSwatches is also called on its own (swap mode), so decorate there, not in setPalette
const prevRenderSwatches = renderSwatches;
renderSwatches = function () {
    prevRenderSwatches();
    const keys = ROLE_KEYS[Object.keys(palette.theme).length];
    paletteContainer.querySelectorAll('.swatch').forEach((swatch, i) => {
        const line = document.createElement('div');
        line.className = 'swatch-oklch';
        line.textContent = oklchLine(palette.theme[keys[i]]);
        line.title = oklchString(palette.theme[keys[i]]);
        swatch.querySelector('.swatch-footer').appendChild(line);
    });
};

const prevSetPaletteMag = setPalette;
setPalette = function (next, saveToHistory = false) {
    prevSetPaletteMag(next, saveToHistory);
    if (next.isDefault) return;
    renderStrip(next.theme);
    writeFeature(next, !saveToHistory && !currentImgEl);
    if (saveToHistory && currentImgEl) startLens();
};

// ---- Fig. 1 lens ----
const reduceMotionMag = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let lensCX = 0.5, lensCY = 0.5;           // lens centre, as a fraction of the image
let aimCX = 0.5, aimCY = 0.5;
let lensPointerAt = -Infinity, lensRunning = false, lensReadAt = 0;

// Where the contained image actually sits inside the drop zone
function imageRect() {
    const W = dropZoneEl.clientWidth, H = dropZoneEl.clientHeight;
    const s = Math.min(W / canvasEl.width, H / canvasEl.height);
    const w = canvasEl.width * s, h = canvasEl.height * s;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h, W, H };
}

dropZoneEl.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || !dropZoneEl.classList.contains('lensed')) return;
    const r = imageRect(), b = dropZoneEl.getBoundingClientRect();
    aimCX = (e.clientX - b.left - r.x) / r.w;
    aimCY = (e.clientY - b.top - r.y) / r.h;
    lensPointerAt = performance.now();
});

function nearestRole(hex) {
    const c = hexToRgb(hex), keys = Object.keys(palette.theme);
    const names = ROLE_NAMES[keys.length];
    let best = 0, bestD = Infinity;
    keys.forEach((key, i) => {
        const t = hexToRgb(palette.theme[key]);
        const d = (t.r - c.r) ** 2 + (t.g - c.g) ** 2 + (t.b - c.b) ** 2;
        if (d < bestD) { bestD = d; best = i; }
    });
    return names[best];
}

function lensFrame(t) {
    if (!dropZoneEl.classList.contains('lensed')) { lensRunning = false; return; }
    if (t - lensPointerAt > 2500 && !reduceMotionMag) {
        const s = t / 1000;
        aimCX = 0.5 + 0.3 * Math.sin(s * 0.21);
        aimCY = 0.5 + 0.28 * Math.sin(s * 0.29 + 1.1);
    }
    const ease = t - lensPointerAt > 2500 ? 0.03 : 1 / Follow.DELAY.mid;   // same feel as the floating previews
    lensCX += (aimCX - lensCX) * ease;
    lensCY += (aimCY - lensCY) * ease;

    const r = imageRect();
    const lw = Math.max(90, r.w * 0.36), lh = lw * 2 / 3;
    const cx = r.x + Math.min(1, Math.max(0, lensCX)) * r.w;
    const cy = r.y + Math.min(1, Math.max(0, lensCY)) * r.h;
    const lx = Math.min(r.x + r.w - lw, Math.max(r.x, cx - lw / 2));
    const ly = Math.min(r.y + r.h - lh, Math.max(r.y, cy - lh / 2));

    const st = dropZoneEl.style;
    st.setProperty('--lw', lw + 'px'); st.setProperty('--lh', lh + 'px');
    st.setProperty('--lx', lx + 'px'); st.setProperty('--ly', ly + 'px');
    st.setProperty('--lt', ly + 'px'); st.setProperty('--ll', lx + 'px');
    st.setProperty('--lr', (r.W - lx - lw) + 'px'); st.setProperty('--lb', (r.H - ly - lh) + 'px');
    lensEl.classList.toggle('flip', ly + lh > r.H - 28);

    if (t - lensReadAt > 150) {
        lensReadAt = t;
        const px = Math.floor((lx + lw / 2 - r.x) / r.w * canvasEl.width);
        const py = Math.floor((ly + lh / 2 - r.y) / r.h * canvasEl.height);
        const [R, G, B] = canvasEl.getContext('2d', { willReadFrequently: true }).getImageData(px, py, 1, 1).data;
        const hex = rgbToHex({ r: R, g: G, b: B });
        const role = nearestRole(hex);
        // Coordinates in the source image's own pixels, not the 400px working canvas
        const sx = Math.round(px * currentImgEl.naturalWidth / canvasEl.width);
        const sy = Math.round(py * currentImgEl.naturalHeight / canvasEl.height);
        const reading = `${role} · ${hex} · X${String(sx).padStart(4, '0')} Y${String(sy).padStart(4, '0')}`;
        lensChipEl.style.background = hex;   // the true colour; the glass above shows its virtual negative
        if (role !== lensReadoutEl.dataset.role) {        // new role under the lens: lock on, decode it in
            lensReadoutEl.dataset.role = role;
            FX.decode(lensReadoutEl, reading, 220);
            lensEl.classList.remove('lock');
            void lensEl.offsetWidth;
            lensEl.classList.add('lock');
        } else if (reading !== lensReadoutEl.dataset.reading) {
            lensReadoutEl.textContent = reading;
        }
        lensReadoutEl.dataset.reading = reading;
    }
    requestAnimationFrame(lensFrame);
}

function startLens() {
    const wasScanning = dropZoneEl.classList.contains('scanning');
    endScan();
    if (wasScanning) FX.split(dropZoneEl, 320);   // registration shift: the plates land, slip, settle
    dropZoneEl.classList.add('lensed');
    if (!lensRunning) { lensRunning = true; requestAnimationFrame(lensFrame); }
}

// main.js and register.js rendered once before these wrappers existed
renderSwatches();
if (!palette.isDefault) { renderStrip(palette.theme); writeFeature(palette, true); }

// ---- Editions (Phase 3) ----
// The theme attribute is set before paint in <head>; this keeps the label and
// switch in step and remembers an explicit choice. Only UI tokens change —
// photos, swatches and every computed value stay exactly as extracted.
function showEdition() {
    mag('edition-name').textContent = document.documentElement.dataset.theme === 'night' ? 'NIGHT EDITION' : 'DAY EDITION';
}
function setEdition(edition) {
    if (document.documentElement.dataset.theme === edition) return;
    try { localStorage.setItem('edition', edition); } catch (e) {}
    const apply = () => { document.documentElement.dataset.theme = edition; showEdition(); };
    if (document.startViewTransition) document.startViewTransition(apply);
    else apply();
}
document.querySelectorAll('.edition-switch button').forEach(btn => {
    btn.addEventListener('click', () => setEdition(btn.dataset.edition));
});
showEdition();

// The default palette is a real palette too: show it in the plates and the strip
if (palette.isDefault) {
    renderPlates(palette.theme);
    renderStrip(palette.theme);
    mag('specimen-strip-label').textContent = `DEFAULT · ${Object.keys(palette.theme).length}`;
    mag('headline-rule').style.setProperty('--headline-colour', palette.theme.primary);
}

// ---- Compact empty states ----
// The accession record stays folded until there is something to record, and
// FAVORITES shrinks to one line while it is empty.
const recordCard = document.querySelector('.accession-card');
recordCard.classList.toggle('collapsed', palette.isDefault);
const prevSetPaletteFold = setPalette;
setPalette = function (next, saveToHistory = false) {
    prevSetPaletteFold(next, saveToHistory);
    if (!next.isDefault) recordCard.classList.remove('collapsed');
};
// processImage fills the record before the palette lands; open it then too
const prevProcessFold = processImage;
processImage = function (file) {
    recordCard.classList.remove('collapsed');
    prevProcessFold(file);
};

const favoritesBlock = mag('favorites-block');
const prevRenderFavorites = renderFavorites;
renderFavorites = function () {
    prevRenderFavorites();
    favoritesBlock.classList.toggle('is-empty', starred.length === 0);
};
renderFavorites();

// EXPORT menu: close after a choice, on Escape and on any click outside
const exportMenu = mag('export-menu');
exportMenu.querySelectorAll('.export-menu-list button').forEach(btn =>
    btn.addEventListener('click', () => setTimeout(() => { exportMenu.open = false; }, 900)));
document.addEventListener('click', e => { if (!exportMenu.contains(e.target)) exportMenu.open = false; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') exportMenu.open = false; });
