// Accession-register layer over main.js: records each deposited image as an
// object and reveals §02–§05 once it is catalogued. main.js is unchanged; its
// top-level functions are wrapped here (classic scripts share one global scope).
const accEl = id => document.getElementById(id);
const entries = [...document.querySelectorAll('.entry.pending')];
let accessionCount = parseInt(localStorage.getItem('accessionCount') || '0') || 0;
let pendingSource = null;   // { name, received } of the image being catalogued

const pad = (n, w) => String(n).padStart(w, '0');
const stamp = d => `${d.toISOString().slice(0, 10)} ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`;

function setStatus(text) { accEl('acc-status').textContent = text; }

function renderTotal() {
    accEl('reg-total').textContent = pad(accessionCount, 3);
}

// Stagger §02–§05 into view, top to bottom
function openEntries() {
    entries.forEach((entry, i) => {
        if (!entry.classList.contains('pending')) return;
        setTimeout(() => entry.classList.remove('pending'), 180 * i);
    });
}

function renderCondition(p) {
    const adj = Object.keys(p.adjusted || {}).length;
    const gen = Object.keys(p.generated || {}).length;
    const parts = [];
    if (adj) parts.push(`${adj} RESTORED (ADJ)`);
    if (gen) parts.push(`${gen} RECONSTRUCTED (GEN)`);
    if (p.lowChroma) parts.push('FADED');
    return parts.length ? parts.join(' · ') : 'INTACT';
}

const originalProcessImage = processImage;
processImage = function (file) {
    if (isExtracting) return;
    accessionCount++;
    localStorage.setItem('accessionCount', accessionCount);
    pendingSource = { name: file.name && file.name !== 'image.png' ? file.name : 'PASTED FROM CLIPBOARD', received: new Date() };
    accEl('acc-no').textContent = `PE-${pendingSource.received.getFullYear()}-${pad(accessionCount, 4)}`;
    accEl('acc-date').textContent = stamp(pendingSource.received);
    accEl('acc-source').textContent = pendingSource.name.toUpperCase();
    accEl('acc-dims').textContent = '—';
    accEl('acc-medium').textContent = '—';
    accEl('acc-condition').textContent = '—';
    setStatus('CATALOGUING');
    renderTotal();
    originalProcessImage(file);
};

const originalSetPalette = setPalette;
setPalette = function (next, saveToHistory = false) {
    originalSetPalette(next, saveToHistory);
    if (next.isDefault) return;
    renderPlates(next.theme);
    applyTilt();

    const k = Object.keys(next.theme).length;
    accEl('acc-medium').textContent = `LIGHT · ${k} COLOURS`;
    accEl('acc-condition').textContent = renderCondition(next);

    if (saveToHistory && currentImgEl) {
        accEl('acc-dims').textContent = `${currentImgEl.naturalWidth} × ${currentImgEl.naturalHeight} PX`;
        setStatus('FILED');
    } else if (!pendingSource) {
        // Opened from the archive, favourites or a shared link: no intake record
        accEl('acc-no').textContent = 'FROM STORAGE';
        setStatus('RETRIEVED');
    } else {
        setStatus('AMENDED');
    }
    openEntries();
};

// ---- Colour plates under the register ----
// One plate per role, front to back in role order; total depth stays the same
// whatever k is, so more colours means thinner plates.
const objectEl = accEl('object');
const platesEl = objectEl.querySelector('.plates');
// Total stack depth in px; a page can set --plate-depth on .object to override
const DEPTH = parseFloat(getComputedStyle(objectEl).getPropertyValue('--plate-depth'))
    || (window.matchMedia('(max-width: 600px)').matches ? 18 : 40);

function renderPlates(theme) {
    const colors = Object.values(theme);
    if (platesEl.children.length !== colors.length) {
        platesEl.innerHTML = colors.map(() => '<div class="plate"></div>').join('');
    }
    [...platesEl.children].forEach((plate, i) => {
        plate.style.setProperty('--n', i + 1);
        plate.style.zIndex = colors.length - i;
        plate.style.transitionDelay = `${i * 0.12}s`;
        plate.style.setProperty('--plate', colors[i]);
    });
    objectEl.dataset.plates = colors.length;
}

// Cursor tilts the object: the stack leans away from the pointer. Each plate
// eases on its own, the front one fastest and the back one slowest, so the
// stack fans out slightly as it moves. Rates are spread by relative position
// (front = FRONT_RATE, back = BACK_RATE), so 3 or 8 plates feel the same.
const FRONT_RATE = 0.585, BACK_RATE = 0.39;
let aimX = 0, aimY = 0, tiltRaf = null;
let plateTilt = [];   // per plate: [x, y]

function plateRate(i, n) {
    return n <= 1 ? FRONT_RATE : FRONT_RATE + (BACK_RATE - FRONT_RATE) * i / (n - 1);
}
function applyTilt() {
    const plates = [...platesEl.children];
    const step = DEPTH / plates.length;
    while (plateTilt.length < plates.length) plateTilt.push([aimX, aimY]);
    plates.forEach((plate, i) => {
        const [x, y] = plateTilt[i];
        plate.style.setProperty('--dx', `${(step * (1 - x * 0.5)).toFixed(2)}px`);
        plate.style.setProperty('--dy', `${(step * (1 - y * 0.5)).toFixed(2)}px`);
    });
}
function tiltLoop() {
    const n = platesEl.children.length;
    let moving = false;
    for (let i = 0; i < n; i++) {
        const t = plateTilt[i] || (plateTilt[i] = [aimX, aimY]);
        const r = plateRate(i, n);
        t[0] += (aimX - t[0]) * r;
        t[1] += (aimY - t[1]) * r;
        if (Math.abs(aimX - t[0]) + Math.abs(aimY - t[1]) > 0.002) moving = true;
    }
    applyTilt();
    tiltRaf = moving ? requestAnimationFrame(tiltLoop) : null;
}
const canTilt = window.matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)').matches;
if (canTilt) {
    window.addEventListener('pointermove', e => {
        aimX = (e.clientX / innerWidth) * 2 - 1;
        aimY = (e.clientY / innerHeight) * 2 - 1;
        if (!tiltRaf) tiltRaf = requestAnimationFrame(tiltLoop);
    });
}

renderTotal();
applyTilt();
// A shared link (#p=…) already carries a catalogued palette
if (!palette.isDefault) setPalette(palette, false);
