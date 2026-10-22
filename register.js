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

// Cursor tilts the object: the stack leans away from the pointer
let tiltX = 0, tiltY = 0, aimX = 0, aimY = 0, tiltRaf = null;
function applyTilt() {
    const step = DEPTH / platesEl.children.length;
    objectEl.style.setProperty('--dx', `${(step * (1 - tiltX * 0.5)).toFixed(2)}px`);
    objectEl.style.setProperty('--dy', `${(step * (1 - tiltY * 0.5)).toFixed(2)}px`);
}
function tiltLoop() {
    tiltX += (aimX - tiltX) * 0.2;
    tiltY += (aimY - tiltY) * 0.2;
    applyTilt();
    tiltRaf = Math.abs(aimX - tiltX) + Math.abs(aimY - tiltY) > 0.002 ? requestAnimationFrame(tiltLoop) : null;
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
