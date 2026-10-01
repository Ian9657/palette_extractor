// DOM + UI. Colour logic lives in color.js (loaded first, exposes globals).
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const previewCanvas = document.getElementById('preview-canvas');
const dropContent = document.getElementById('drop-content');
const paletteContainer = document.getElementById('palette-container');
const paletteNotes = document.getElementById('palette-notes');
const root = document.documentElement;

const MAX_ITER = 15;
const FRAME_MS = 60;

let isExtracting = false;
let currentK = 5;
let currentSeed = 1;
let currentImgEl = null;
const loadJSON = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
let history = loadJSON('paletteHistory', []);
let starred = loadJSON('starredPalettes', []);
let revCount = parseInt(localStorage.getItem('proofRevCount') || '0') || 0;

// The one piece of app state: { theme, coverage, adjusted, lowChroma, seed }.
// History, favourites and edits all pass this object around.
let palette = null;

const loadingOverlay = document.getElementById('loading-overlay');
const btnExportTailwind = document.getElementById('btn-export-tailwind');
const btnExportCss = document.getElementById('btn-export-css');
const btnExportFigma = document.getElementById('btn-export-figma');
const btnExportImage = document.getElementById('btn-export-image');
const btnStarCurrent = document.getElementById('btn-star-current');
const btnReroll = document.getElementById('btn-reroll');
const btnInvert = document.getElementById('btn-invert');
const btnContrastModel = document.getElementById('btn-contrast-model');
const btnCopyLink = document.getElementById('btn-copy-link');
const kSlider = document.getElementById('k-slider');

let isSelecting = false;
let wasDragging = false;
let startX, startY;
let selectionRectDom = null;
const kValue = document.getElementById('k-value');
const historyContainer = document.getElementById('history-container');
const favoritesContainer = document.getElementById('favorites-container');
const a11yMatrix = document.getElementById('a11y-matrix');
const cvdPanel = document.getElementById('cvd-panel');

const worker = createKMeansWorker();

// ---- Event Listeners for Drag & Drop ----
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    document.body.addEventListener(eventName, (e) => e.preventDefault());
    dropZone.addEventListener(eventName, (e) => e.preventDefault());
});

['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'));
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'));
});

dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
        processImage(file);
    }
});

// ---- Clipboard Paste Support ----
document.addEventListener('paste', (e) => {
    if (isExtracting) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
                dropZone.classList.add('paste-flash');
                dropZone.addEventListener('animationend', () => {
                    dropZone.classList.remove('paste-flash');
                }, { once: true });
                processImage(file);
            }
            break;
        }
    }
});

dropZone.addEventListener('click', (e) => {
    if (wasDragging) return;
    if (currentImgEl && selectionRectDom) {
        const selBox = document.getElementById('selection-box');
        if (selBox) selBox.style.display = 'none';
        selectionRectDom = null;
        extractColorsVisualized(currentImgEl);
        return;
    }
    fileInput.click();
});

dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
    }
});

// ---- Region selection (mouse, pen, touch) ----
// Pointer capture keeps move/up on dropZone even when the pointer leaves the window.
dropZone.addEventListener('pointerdown', (e) => {
    if (!currentImgEl || isExtracting || e.button !== 0) return;
    dropZone.setPointerCapture(e.pointerId);
    isSelecting = true;
    wasDragging = false;
    const rect = dropZone.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;

    let selBox = document.getElementById('selection-box');
    if (!selBox) {
        selBox = document.createElement('div');
        selBox.id = 'selection-box';
        selBox.className = 'selection-box';
        dropZone.appendChild(selBox);
    }
    selBox.style.display = 'block';
    selBox.style.left = startX + 'px';
    selBox.style.top = startY + 'px';
    selBox.style.width = '0px';
    selBox.style.height = '0px';
});

dropZone.addEventListener('pointermove', (e) => {
    if (!isSelecting) return;
    const rect = dropZone.getBoundingClientRect();
    let currentX = e.clientX - rect.left;
    let currentY = e.clientY - rect.top;
    // A few px of finger jitter is still a tap, not a drag
    if (Math.abs(currentX - startX) > 4 || Math.abs(currentY - startY) > 4) wasDragging = true;

    currentX = Math.max(0, Math.min(currentX, rect.width));
    currentY = Math.max(0, Math.min(currentY, rect.height));

    const selBox = document.getElementById('selection-box');
    if (selBox) {
        selBox.style.left = Math.min(startX, currentX) + 'px';
        selBox.style.top = Math.min(startY, currentY) + 'px';
        selBox.style.width = Math.abs(currentX - startX) + 'px';
        selBox.style.height = Math.abs(currentY - startY) + 'px';
    }
});

function endSelection(cancelled) {
    if (!isSelecting) return;
    isSelecting = false;
    setTimeout(() => { if (!isSelecting) wasDragging = false; }, 0);

    const selBox = document.getElementById('selection-box');
    if (!selBox) return;

    const w = parseInt(selBox.style.width);
    const h = parseInt(selBox.style.height);

    if (!cancelled && w > 10 && h > 10) {
        selectionRectDom = { x: parseInt(selBox.style.left), y: parseInt(selBox.style.top), w, h };
        extractColorsVisualized(currentImgEl, selectionRectDom);
    } else {
        selBox.style.display = 'none';
        selectionRectDom = null;
    }
}

dropZone.addEventListener('pointerup', () => endSelection(false));
dropZone.addEventListener('pointercancel', () => endSelection(true));

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        processImage(file);
    }
});

// ---- Image Processing ----
function processImage(file) {
    if (isExtracting) return;

    const img = new Image();
    img.onload = () => {
        if (dropContent) dropContent.hidden = true;
        dropZone.classList.add('has-image');
        currentImgEl = img;
        currentSeed = 1;
        const selBox = document.getElementById('selection-box');
        if (selBox) selBox.style.display = 'none';
        selectionRectDom = null;
        extractColorsVisualized(img);
    };
    img.onerror = () => { isExtracting = false; alert('IMAGE LOAD FAILED'); };
    img.src = URL.createObjectURL(file);
}

if (kSlider) {
    kSlider.addEventListener('input', (e) => {
        currentK = parseInt(e.target.value);
        if (kValue) kValue.textContent = currentK;
    });
    kSlider.addEventListener('change', () => {
        if (currentImgEl) extractColorsVisualized(currentImgEl, selectionRectDom);
    });
}

// Randomness is opt-in: same image + same seed always gives the same palette
if (btnReroll) {
    btnReroll.addEventListener('click', () => {
        if (!currentImgEl || isExtracting) return;
        currentSeed++;
        extractColorsVisualized(currentImgEl, selectionRectDom);
    });
}

function mapDomRectToCanvas(domRect, canvas, dropZone) {
    const dzRect = dropZone.getBoundingClientRect();
    const canvasAspect = canvas.width / canvas.height;
    const dzAspect = dzRect.width / dzRect.height;

    let renderWidth, renderHeight, offsetX = 0, offsetY = 0;
    if (canvasAspect > dzAspect) {
        renderWidth = dzRect.width;
        renderHeight = dzRect.width / canvasAspect;
        offsetY = (dzRect.height - renderHeight) / 2;
    } else {
        renderHeight = dzRect.height;
        renderWidth = dzRect.height * canvasAspect;
        offsetX = (dzRect.width - renderWidth) / 2;
    }

    const scaleX = canvas.width / renderWidth;
    const scaleY = canvas.height / renderHeight;

    let cx = (domRect.x - offsetX) * scaleX;
    let cy = (domRect.y - offsetY) * scaleY;
    let cw = domRect.w * scaleX;
    let ch = domRect.h * scaleY;

    let right = Math.min(canvas.width, cx + cw);
    let bottom = Math.min(canvas.height, cy + ch);
    cx = Math.max(0, cx);
    cy = Math.max(0, cy);
    cw = right - cx;
    ch = bottom - cy;

    return { x: cx, y: cy, w: cw, h: ch };
}

// ---- K-Means Color Extraction Visualized ----
function extractColorsVisualized(imgEl, selDomRect = null) {
    if (isExtracting) return;
    isExtracting = true;

    loadingOverlay.hidden = false;
    loadingOverlay.style.display = 'flex';
    loadingOverlay.style.background = 'transparent';

    const ctx = previewCanvas.getContext('2d', { willReadFrequently: true });

    const MAX_SIZE = 400;
    let width = imgEl.naturalWidth;
    let height = imgEl.naturalHeight;

    if (width > height) {
        if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
    } else {
        if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
    }

    width = Math.floor(width);
    height = Math.floor(height);

    previewCanvas.width = width;
    previewCanvas.height = height;

    ctx.drawImage(imgEl, 0, 0, width, height);
    previewCanvas.classList.add('visible');

    let extractRect = null;
    if (selDomRect) {
        extractRect = mapDomRectToCanvas(selDomRect, previewCanvas, dropZone);
        if (extractRect.w <= 0 || extractRect.h <= 0) extractRect = null;
    }

    const originalData = ctx.getImageData(0, 0, width, height).data;
    let hist = buildHistogram(originalData, width, height, extractRect);
    if (hist.total === 0 && extractRect) {
        hist = buildHistogram(originalData, width, height);
        extractRect = null;
    }

    if (hist.total === 0) {
        isExtracting = false;
        loadingOverlay.hidden = true;
        loadingOverlay.style.display = 'none';
        return;
    }

    // Dim everything outside the selection once; frames paint clusters on top
    const baseData = new Uint8ClampedArray(originalData);
    if (extractRect) {
        for (let i = 0; i < baseData.length; i += 4) {
            const x = (i / 4) % width;
            const y = Math.floor((i / 4) / width);
            if (!(x >= extractRect.x && x < extractRect.x + extractRect.w &&
                  y >= extractRect.y && y < extractRect.y + extractRect.h)) {
                const luma = (baseData[i] * 0.299 + baseData[i + 1] * 0.587 + baseData[i + 2] * 0.114) * 0.3;
                baseData[i] = baseData[i + 1] = baseData[i + 2] = luma;
            }
        }
    }

    const k = currentK;
    const seed = currentSeed;

    function paint({ final, centroids, counts, assign }) {
        const frame = new ImageData(new Uint8ClampedArray(baseData), width, height);
        for (let p = 0; p < hist.offsets.length; p++) {
            const color = centroids[assign[hist.pixelBins[p]]];
            const i = hist.offsets[p];
            frame.data[i] = color.r;
            frame.data[i + 1] = color.g;
            frame.data[i + 2] = color.b;
        }
        ctx.putImageData(frame, 0, 0);

        if (final) {
            setPalette({ ...buildPalette(centroids, counts, k), seed }, true);
            loadingOverlay.hidden = true;
            loadingOverlay.style.display = 'none';
            isExtracting = false;
        }
    }

    // The worker finishes in a few ms and posts every iteration at once;
    // play them back at a fixed pace so the convergence is actually visible.
    const queue = [];
    let lastPaint = 0, playing = false;
    function play(ts) {
        if (ts - lastPaint >= FRAME_MS) {
            lastPaint = ts;
            paint(queue.shift());
        }
        if (queue.length) requestAnimationFrame(play);
        else playing = false;
    }
    worker.onmessage = function (e) {
        queue.push(e.data);
        if (!playing) { playing = true; requestAnimationFrame(play); }
    };

    worker.postMessage({ bins: hist.bins, k, seed, maxIter: MAX_ITER });
}

// ---- Export Capabilities ----
// Extracted theme plus its opposite-mode twin, labelled 'light' / 'dark'
function themeModes() {
    const base = palette.theme, other = invertTheme(base);
    return isDarkTheme(base) ? { light: other, dark: base } : { light: base, dark: other };
}

function exportToFigma(e) {
    if (!palette) return;
    const { light, dark } = themeModes();
    const tokens = {};
    for (const [mode, theme] of [['Palette', palette.theme], ['Palette/light', light], ['Palette/dark', dark]]) {
        tokens[mode] = {};
        Object.entries(theme).forEach(([key, value]) => {
            tokens[mode][key] = { "value": value, "type": "color" };
        });
    }
    const content = JSON.stringify(tokens, null, 2);
    downloadConfig(content, 'figma-tokens.json', e.target);
}

if (btnExportFigma) btnExportFigma.addEventListener('click', exportToFigma);

// Each role becomes a full 50…950 ramp; DEFAULT is the extracted colour itself
function exportToTailwind(e) {
    if (!palette) return;
    const colors = {};
    Object.entries(palette.theme).forEach(([key, value]) => {
        colors[key === 'text' ? 'foreground' : (key === 'bg' ? 'background' : key)] = { DEFAULT: value, ...tonalScale(value) };
    });
    const config = { theme: { extend: { colors } } };
    const content = `module.exports = ${JSON.stringify(config, null, 2)};`;
    downloadConfig(content, 'tailwind.config.js', e.target);
}

function exportToCSS(e) {
    if (!palette) return;
    const { light, dark } = themeModes();
    const block = (selector, theme, toValue) =>
        `${selector} {\n` + Object.entries(theme).map(([key, v]) => `  --${key}-color: ${toValue(v)};\n`).join('') + '}\n';
    const indent = str => str.replace(/^(?=.)/gm, '  ');
    const modes = toValue =>
        block(':root', light, toValue) +
        block(':root[data-theme="dark"]', dark, toValue) +
        `@media (prefers-color-scheme: dark) {\n${indent(block(':root:not([data-theme="light"])', dark, toValue))}}\n`;
    // Hex first; browsers with OKLCH support override with identical selectors
    const content = `/* Extracted: ${isDarkTheme(palette.theme) ? 'dark' : 'light'} mode. The other mode is derived. */\n` +
        modes(v => v) +
        `@supports (color: oklch(0% 0 0)) {\n${indent(modes(oklchString))}}\n`;
    downloadConfig(content, 'theme.css', e.target);
}

function downloadConfig(content, filename, btn) {
    const blob = new Blob([content], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    if (btn) {
        const originalText = btn.textContent;
        btn.textContent = 'SAVED';
        setTimeout(() => { btn.textContent = originalText; }, 2000);
    }
}

btnExportTailwind.addEventListener('click', exportToTailwind);
btnExportCss.addEventListener('click', exportToCSS);
if (btnExportImage) btnExportImage.addEventListener('click', exportToImage);

function exportToImage(e) {
    if (!palette) return;
    const theme = palette.theme;

    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1200;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#F5F0E8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(26, 26, 26, 0.15)';
    for (let i = 40; i < canvas.width; i += 40) {
        for (let j = 40; j < canvas.height; j += 40) {
            ctx.beginPath();
            ctx.arc(i, j, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    ctx.lineWidth = 6;
    ctx.strokeStyle = '#1a1a1a';
    ctx.strokeRect(60, 60, 1080, 1080);

    ctx.font = 'bold 80px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText('PALETTE EXTRACTOR', 100, 160);

    ctx.font = 'bold 24px "IBM Plex Mono", monospace';
    ctx.fillText('ZINE EDITION // SYSTEM EXPORT // ' + new Date().toISOString().split('T')[0], 100, 210);

    ctx.beginPath();
    ctx.moveTo(60, 260);
    ctx.lineTo(1140, 260);
    ctx.stroke();

    const imgSize = 460;
    const imgX = 100;
    const imgY = 320;

    let dw = imgSize;
    let dh = imgSize;
    if (currentImgEl) {
        const imgAspect = currentImgEl.naturalWidth / currentImgEl.naturalHeight;
        if (imgAspect > 1) {
            dw = imgSize; dh = imgSize / imgAspect;
        } else {
            dh = imgSize; dw = imgSize * imgAspect;
        }
    }

    ctx.fillStyle = theme.primary || '#ef4444';
    ctx.fillRect(imgX + 16, imgY + 16, dw, dh);

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(imgX, imgY, dw, dh);

    if (currentImgEl) {
        ctx.drawImage(currentImgEl, imgX, imgY, dw, dh);
    } else {
        ctx.fillStyle = '#F5F0E8';
        ctx.fillRect(imgX + 4, imgY + 4, dw - 8, dh - 8);
        ctx.fillStyle = '#1a1a1a';
        ctx.font = 'bold 24px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('NO SOURCE', imgX + dw / 2, imgY + dh / 2);
        ctx.textAlign = 'left';
    }
    ctx.strokeRect(imgX, imgY, dw, dh);

    ctx.lineWidth = 4;
    ctx.beginPath();
    const l = 20;
    ctx.moveTo(imgX - l, imgY); ctx.lineTo(imgX, imgY);
    ctx.moveTo(imgX, imgY - l); ctx.lineTo(imgX, imgY);
    ctx.moveTo(imgX + dw + l, imgY); ctx.lineTo(imgX + dw, imgY);
    ctx.moveTo(imgX + dw, imgY - l); ctx.lineTo(imgX + dw, imgY);
    ctx.moveTo(imgX - l, imgY + dh); ctx.lineTo(imgX, imgY + dh);
    ctx.moveTo(imgX, imgY + dh + l); ctx.lineTo(imgX, imgY + dh);
    ctx.moveTo(imgX + dw + l, imgY + dh); ctx.lineTo(imgX + dw, imgY + dh);
    ctx.moveTo(imgX + dw, imgY + dh + l); ctx.lineTo(imgX + dw, imgY + dh);
    ctx.stroke();

    const paletteX = 620;
    const paletteY = 320;
    const swatchW = 480;

    const k = Object.keys(theme).length;
    const names = ROLE_NAMES[k];
    const swatchH = Math.min(100, 660 / k - 20);

    Object.values(theme).forEach((color, i) => {
        const y = paletteY + i * (swatchH + 20);

        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(paletteX + 8, y + 8, swatchW, swatchH);

        ctx.fillStyle = color;
        ctx.fillRect(paletteX, y, swatchW, swatchH);
        ctx.lineWidth = 4;
        ctx.strokeRect(paletteX, y, swatchW, swatchH);

        ctx.fillStyle = inkOn(color);

        ctx.font = 'bold 28px "Space Grotesk", sans-serif';
        ctx.fillText(names[i], paletteX + 24, y + swatchH / 2 + 10);

        ctx.font = 'bold 24px "IBM Plex Mono", monospace';
        ctx.fillText(color.toUpperCase(), paletteX + swatchW - 140, y + swatchH / 2 + 8);
    });

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(60, 1020, 1080, 120);
    ctx.fillStyle = '#F5F0E8';
    ctx.font = 'bold 40px "Space Grotesk", sans-serif';
    ctx.fillText('PROCESS COMPLETE', 100, 1090);

    ctx.font = 'bold 24px "IBM Plex Mono", monospace';
    ctx.fillText('INK COVERAGE SIMULATION', 740, 1085);

    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'palette-card.png';
    a.click();

    if (e && e.target) {
        const btn = e.target;
        const originalText = btn.textContent;
        btn.textContent = 'SAVED';
        setTimeout(() => { btn.textContent = originalText; }, 2000);
    }
}

// ---- UI Updates ----
let swapFrom = null;        // role key picked as the first half of a swap
let proofInverted = false;  // PRINT PROOF previews the derived opposite-mode theme
let contrastModel = localStorage.getItem('contrastModel') === 'apca' ? 'apca' : 'wcag';
let coverageTimers = [];    // count-up animation of the previous palette, cancelled on change

function setPalette(next, saveToHistory = false) {
    palette = next;
    swapFrom = null;
    const { theme } = palette;

    updateStarButtonUI();

    // 1. Update Global CSS Variables (Accents only)
    root.style.setProperty('--secondary-color', theme.secondary || theme.bg);
    root.style.setProperty('--primary-color', theme.primary);
    root.style.setProperty('--accent-color', theme.accent || theme.primary);

    // 2. Proof metadata
    if (saveToHistory) {
        revCount++;
        localStorage.setItem('proofRevCount', revCount);
    }
    const k = Object.keys(theme).length;
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('proof-rev', String(revCount).padStart(3, '0'));
    setText('proof-date', new Date().toISOString().split('T')[0]);
    setText('proof-k', k);
    setText('proof-iter', MAX_ITER);
    setText('proof-seed', palette.seed ?? '—');

    applyMockupTheme();
    renderSwatches();
    renderA11yMatrix();
    renderCvdPanel();

    if (saveToHistory) {
        addToHistory(palette);
    }
    updateHash();

    const badge = document.getElementById('mockup-badge');
    const progress = document.getElementById('mockup-progress');
    coverageTimers.forEach(clearTimeout);  // clearTimeout also clears intervals
    coverageTimers = [];
    if (badge && progress) {
        progress.style.width = '0%';
        badge.textContent = '0%';

        // No coverage known (default, shared link, BASE swapped by hand): say so, don't invent one
        if (palette.coverage == null) {
            badge.textContent = '—';
            return;
        }
        const targetProgress = palette.coverage;

        coverageTimers.push(setTimeout(() => {
            progress.style.width = `${targetProgress}%`;
            let currentBadge = 0;
            const intervalTime = Math.max(10, 500 / Math.max(1, targetProgress));
            const badgeInterval = setInterval(() => {
                currentBadge = Math.min(targetProgress, currentBadge + 1);
                badge.textContent = `${currentBadge}%`;
                if (currentBadge >= targetProgress) clearInterval(badgeInterval);
            }, intervalTime);
            coverageTimers.push(badgeInterval);
        }, 100));
    }
}

// PRINT PROOF: extracted theme, or its derived opposite mode
function applyMockupTheme() {
    const theme = proofInverted ? invertTheme(palette.theme) : palette.theme;
    const mockup = document.getElementById('ui-mockup');
    if (mockup) {
        mockup.style.setProperty('--bg-color', theme.bg);
        mockup.style.setProperty('--text-color', theme.text);
        mockup.style.setProperty('--border-color', theme.text);
        mockup.style.setProperty('--primary-color', theme.primary);
        mockup.style.setProperty('--accent-color', theme.accent || theme.primary);
        mockup.style.setProperty('--secondary-color', theme.secondary || theme.bg);
    }

    const strip = document.getElementById('proof-strip');
    if (strip) {
        strip.innerHTML = '';
        Object.values(theme).forEach(color => {
            const div = document.createElement('div');
            div.className = 'proof-strip-color';
            div.style.backgroundColor = color;
            strip.appendChild(div);
        });
    }

    if (btnInvert) {
        btnInvert.textContent = `◐ ${isDarkTheme(theme) ? 'DARK' : 'LIGHT'}${proofInverted ? ' · DERIVED' : ''}`;
        btnInvert.title = proofInverted ? 'Showing the derived opposite mode; click for the extracted theme'
                                        : 'Showing the extracted theme; click to preview the derived opposite mode';
    }
}

if (btnInvert) {
    btnInvert.addEventListener('click', () => {
        proofInverted = !proofInverted;
        if (palette) applyMockupTheme();
    });
}

// Swap two roles by hand; flags travel with the colour they describe.
// Coverage is "everything but BASE", so it is unknown once BASE changes.
function swapRoles(a, b) {
    const theme = { ...palette.theme };
    [theme[a], theme[b]] = [theme[b], theme[a]];
    const moveFlags = (flags = {}) => {
        const out = { ...flags };
        delete out[a]; delete out[b];
        if (a in flags) out[b] = flags[a];
        if (b in flags) out[a] = flags[b];
        return out;
    };
    setPalette({
        ...palette,
        theme,
        adjusted: moveFlags(palette.adjusted),
        generated: moveFlags(palette.generated),
        scores: null,
        isDefault: false,
        coverage: a === 'bg' || b === 'bg' ? null : palette.coverage
    }, false);
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && swapFrom) { swapFrom = null; renderSwatches(); }
});

function renderSwatches() {
    const { theme } = palette;
    const adjusted = palette.adjusted || {};
    const generated = palette.generated || {};
    const k = Object.keys(theme).length;
    const names = ROLE_NAMES[k];
    const keys = ROLE_KEYS[k];

    paletteContainer.innerHTML = '';
    paletteContainer.classList.toggle('swapping', !!swapFrom);

    keys.forEach((key, index) => {
        const color = theme[key];
        const swatch = document.createElement('div');
        swatch.className = 'swatch' + (swapFrom === key ? ' swap-source' : '');
        swatch.tabIndex = 0;
        swatch.setAttribute('role', 'button');
        swatch.addEventListener('keydown', e => {
            if (e.target !== swatch) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); swatch.click(); }
        });
        swatch.style.backgroundColor = color;
        swatch.style.color = inkOn(color);

        // Use ntc.js to name the color
        const colorName = ntc.name(color)[1].toUpperCase();
        let badges = '';
        if (adjusted[key]) badges += `<span class="swatch-adj" title="Lightness shifted from ${adjusted[key]} (hue kept) for contrast on BASE">ADJ</span>`;
        if (generated[key]) badges += `<span class="swatch-adj" title="Not in the image: derived because it has fewer than ${k} distinct colours">GEN</span>`;

        swatch.innerHTML = `
            <div class="swatch-content">
                <div class="swatch-header">${names[index]}${badges}</div>
                <div class="swatch-footer mono-text">
                    <div class="swatch-hex">${color}</div>
                    <div class="swatch-rating"><span>${colorName}</span></div>
                </div>
            </div>
        `;

        const editWrapper = document.createElement('div');
        editWrapper.className = 'color-input-wrapper';
        editWrapper.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg><input type="color" value="${color}">`;

        const colorInput = editWrapper.querySelector('input');
        colorInput.addEventListener('change', (e) => {
            e.stopPropagation();
            // A hand-picked colour is neither an automatic adjustment nor generated
            const { [key]: _a, ...restAdjusted } = adjusted;
            const { [key]: _g, ...restGenerated } = generated;
            setPalette({
                ...palette,
                theme: { ...palette.theme, [key]: e.target.value.toUpperCase() },
                adjusted: restAdjusted,
                generated: restGenerated,
                scores: null,
                isDefault: false
            }, false);
        });

        colorInput.addEventListener('click', e => e.stopPropagation());
        swatch.appendChild(editWrapper);

        const swapBtn = document.createElement('button');
        swapBtn.className = 'swatch-swap';
        swapBtn.type = 'button';
        swapBtn.textContent = '⇄';
        swapBtn.title = 'Swap this role with another';
        swapBtn.setAttribute('aria-label', `Swap ${names[index]} with another role`);
        swapBtn.addEventListener('click', e => {
            e.stopPropagation();
            if (swapFrom && swapFrom !== key) { swapRoles(swapFrom, key); return; }
            swapFrom = swapFrom === key ? null : key;
            renderSwatches();
        });
        swatch.appendChild(swapBtn);

        swatch.addEventListener('click', () => {
            // In swap mode the whole swatch is the target, so touch users needn't hit the small button
            if (swapFrom) {
                if (swapFrom === key) { swapFrom = null; renderSwatches(); }
                else swapRoles(swapFrom, key);
                return;
            }
            navigator.clipboard.writeText(color).catch(() => {});
            const hexEl = swatch.querySelector('.swatch-hex');
            const originalText = hexEl.innerText;
            hexEl.innerText = `COPIED`;
            setTimeout(() => { hexEl.innerText = originalText; }, 1000);
        });
        paletteContainer.appendChild(swatch);
    });

    // Notes under the colour bar: say when the tool generated rather than extracted
    if (paletteNotes) {
        const notes = [];
        if (swapFrom) notes.push(`SWAP: PICK A ROLE TO TRADE WITH ${names[keys.indexOf(swapFrom)]} (ESC TO CANCEL)`);
        if (palette.lowChroma) notes.push('LOW-CHROMA IMAGE — PRIMARY / ACCENT ROLES ARE NOMINAL');
        if (Object.keys(adjusted).length) notes.push('ADJ = LIGHTNESS SHIFTED (HUE KEPT) TO MEET WCAG: TEXT 4.5:1, PRIMARY 3:1 ON BASE');
        if (Object.keys(generated).length) notes.push(`GEN = NOT IN THE IMAGE; DERIVED BECAUSE IT HAS FEWER THAN ${k} DISTINCT COLOURS`);
        paletteNotes.innerHTML = notes.map(n => `<div>${n}</div>`).join('');
        paletteNotes.hidden = notes.length === 0;
    }
}

// ---- A11Y Contrast Matrix ----
// WCAG 2 ratio is symmetric; APCA Lc is text-on-background, so rows are text, columns are bg.
const CONTRAST_MODELS = {
    wcag: {
        label: 'WCAG 2.1',
        measure: (fg, bg) => contrastRatio(fg, bg),
        format: v => v.toFixed(1),
        grade: v => v >= 7 ? ['aaa', 'AAA', true] : v >= 4.5 ? ['aa', 'AA', true] : v >= 3 ? ['aa-large', 'AA 18+', false] : ['fail', 'FAIL', false],
        legend: ['AAA ≥7:1', 'AA ≥4.5:1', 'AA 18pt+ ≥3:1'],
        tip: (row, col, v) => `${row} on ${col}: ${v}:1`
    },
    apca: {
        label: 'APCA',
        measure: (fg, bg) => Math.abs(apcaContrast(fg, bg)),
        format: v => v.toFixed(0),
        grade: v => v >= 75 ? ['aaa', 'BODY', true] : v >= 60 ? ['aa', 'TEXT', true] : v >= 45 ? ['aa-large', 'LARGE', false] : ['fail', v >= 30 ? 'UI ONLY' : 'FAIL', false],
        legend: ['Lc 75 BODY TEXT', 'Lc 60 CONTENT TEXT', 'Lc 45 LARGE / HEADLINES'],
        tip: (row, col, v) => `${row} text on ${col}: Lc ${v}`
    }
};

if (btnContrastModel) {
    btnContrastModel.addEventListener('click', () => {
        contrastModel = contrastModel === 'wcag' ? 'apca' : 'wcag';
        localStorage.setItem('contrastModel', contrastModel);
        renderA11yMatrix();
    });
}

function renderA11yMatrix() {
    if (!a11yMatrix) return;
    const model = CONTRAST_MODELS[contrastModel];
    if (btnContrastModel) btnContrastModel.textContent = `${model.label} ⇄`;

    const colors = Object.values(palette.theme);
    const names = ROLE_NAMES[colors.length];
    const n = colors.length;
    const rgbs = colors.map(hexToRgb);

    // Build table
    let html = '<table>';

    // Header row
    html += '<tr><th></th>';
    for (let i = 0; i < n; i++) {
        html += `<th><div style="width:14px;height:14px;background:${colors[i]};border:1px solid var(--border-color);margin:0 auto 3px;"></div>${names[i]}</th>`;
    }
    html += '</tr>';

    // Data rows
    let passCount = 0;
    let totalPairs = 0;

    for (let row = 0; row < n; row++) {
        html += `<tr><th><div style="width:14px;height:14px;background:${colors[row]};border:1px solid var(--border-color);margin:0 auto 3px;"></div>${names[row]}</th>`;

        for (let col = 0; col < n; col++) {
            if (row === col) {
                html += '<td class="a11y-cell a11y-cell--self">—</td>';
            } else {
                const value = model.measure(rgbs[row], rgbs[col]);
                const valueStr = model.format(value);
                const [cellClass, badge, passes] = model.grade(value);
                totalPairs++;
                if (passes) passCount++;

                html += `<td class="a11y-cell a11y-cell--${cellClass}" title="${model.tip(names[row], names[col], valueStr)}">`;
                html += `<div class="a11y-cell-ratio">${valueStr}</div>`;
                html += `<div class="a11y-cell-badge">${badge}</div>`;
                html += '</td>';
            }
        }
        html += '</tr>';
    }

    html += '</table>';

    const passRate = Math.round((passCount / totalPairs) * 100);
    const [l1, l2, l3] = model.legend;

    html += '<div class="a11y-legend">';
    html += `<span class="a11y-legend-item"><span class="a11y-legend-swatch" style="background:#1a1a1a;"></span> ${l1}</span>`;
    html += `<span class="a11y-legend-item"><span class="a11y-legend-swatch" style="background:#3b6;"></span> ${l2}</span>`;
    html += `<span class="a11y-legend-item"><span class="a11y-legend-swatch" style="background:#e8c840;"></span> ${l3}</span>`;
    html += `<span class="a11y-legend-item" style="margin-left:auto; opacity:0.6;">PASS RATE: ${passRate}%</span>`;
    html += '</div>';

    a11yMatrix.innerHTML = html;
}

// ---- Colour-vision deficiency preview ----
const CVD_LABELS = { protan: 'PROTAN', deutan: 'DEUTAN', tritan: 'TRITAN' };

function renderCvdPanel() {
    if (!cvdPanel) return;
    const { theme } = palette;
    const names = ROLE_NAMES[Object.keys(theme).length];
    const keys = Object.keys(theme);
    const rows = [['NORMAL', hex => hex], ...Object.entries(CVD_LABELS).map(([type, label]) =>
        [label, hex => rgbToHex(simulateCvd(hexToRgb(hex), type))])];

    let html = '';
    for (const [label, sim] of rows) {
        html += `<div class="cvd-row"><span class="cvd-label">${label}</span><div class="cvd-strip">`;
        keys.forEach((key, i) => {
            const hex = sim(theme[key]);
            html += `<div style="background:${hex}" title="${names[i]} ${hex}"></div>`;
        });
        html += '</div></div>';
    }

    const warnings = cvdWarnings(theme);
    const roleName = key => names[keys.indexOf(key)];
    html += warnings.length
        ? warnings.map(w => `<div class="cvd-warning">⚠ ${roleName(w.a)} ≈ ${roleName(w.b)} UNDER ${CVD_LABELS[w.type]}</div>`).join('')
        : '<div class="cvd-ok">BRAND ROLES STAY DISTINCT UNDER ALL THREE SIMULATIONS</div>';
    cvdPanel.innerHTML = html;
}

// ---- Shareable link: #p=HEX-HEX-… in role order ----
function updateHash() {
    if (palette.isDefault) return;
    const hexes = ROLE_KEYS[Object.keys(palette.theme).length].map(k => palette.theme[k].slice(1));
    window.history.replaceState(null, '', '#p=' + hexes.join('-'));
}

function paletteFromHash() {
    const m = location.hash.match(/^#p=((?:[0-9a-fA-F]{6}-?){3,8})$/);
    if (!m) return null;
    const hexes = m[1].split('-').filter(Boolean);
    const keys = ROLE_KEYS[hexes.length];
    if (!keys) return null;
    const theme = {};
    keys.forEach((key, i) => { theme[key] = '#' + hexes[i].toUpperCase(); });
    return { theme, coverage: null, adjusted: {}, generated: {}, lowChroma: false, seed: null };
}

if (btnCopyLink) {
    btnCopyLink.addEventListener('click', () => {
        navigator.clipboard.writeText(location.href).catch(() => {});
        const originalText = btnCopyLink.textContent;
        btnCopyLink.textContent = 'COPIED';
        setTimeout(() => { btnCopyLink.textContent = originalText; }, 1500);
    });
}

// ---- History & Favourites ----
// Stored items are palette objects; older entries also carry a now-unused rawColors.
const sameTheme = (a, b) => JSON.stringify(a.theme) === JSON.stringify(b.theme);
const storable = ({ theme, coverage, adjusted, generated, lowChroma, seed }) => ({ theme, coverage, adjusted, generated, lowChroma, seed });

function addToHistory(p) {
    history = history.filter(item => !sameTheme(item, p));
    history.unshift(storable(p));
    if (history.length > 8) history.pop();
    localStorage.setItem('paletteHistory', JSON.stringify(history));
    renderSwatchList(historyContainer, history);
}

function renderSwatchList(container, items, emptyText) {
    if (!container) return;
    container.innerHTML = '';
    if (items.length === 0 && emptyText) {
        container.innerHTML = `<div class="mono-text" style="opacity:0.4; font-size:0.85rem; padding: 2rem 0; color: var(--secondary-color);">${emptyText}</div>`;
        return;
    }
    items.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        Object.values(item.theme).forEach(color => {
            const colorDiv = document.createElement('div');
            colorDiv.className = 'history-color';
            colorDiv.style.backgroundColor = color;
            div.appendChild(colorDiv);
        });
        div.addEventListener('click', () => {
            currentK = Object.keys(item.theme).length;
            if (kSlider) { kSlider.value = currentK; kValue.textContent = currentK; }
            setPalette({ adjusted: {}, generated: {}, lowChroma: false, coverage: null, seed: null, ...item }, false);
        });
        container.appendChild(div);
    });
}

function renderFavorites() {
    renderSwatchList(favoritesContainer, starred, 'NO STARRED PALETTES YET.');
}

function isCurrentStarred() {
    return !!palette && starred.some(item => sameTheme(item, palette));
}

function updateStarButtonUI() {
    if (!btnStarCurrent) return;
    if (isCurrentStarred()) {
        btnStarCurrent.textContent = '★ STARRED';
        btnStarCurrent.style.color = 'var(--bg-color)';
        btnStarCurrent.style.background = 'var(--text-color)';
    } else {
        btnStarCurrent.textContent = '☆ STAR';
        btnStarCurrent.style.color = '';
        btnStarCurrent.style.background = '';
    }
}

if (btnStarCurrent) {
    btnStarCurrent.addEventListener('click', () => {
        if (!palette) return;
        if (isCurrentStarred()) {
            starred = starred.filter(item => !sameTheme(item, palette));
        } else {
            starred.unshift(storable(palette));
        }
        localStorage.setItem('starredPalettes', JSON.stringify(starred));
        updateStarButtonUI();
        renderFavorites();
    });
}

// Initial render: a shared link wins over the default palette
setPalette(paletteFromHash() || {
    theme: {
        bg: '#1A1A1A',
        secondary: '#333333',
        primary: '#EF4444',
        accent: '#3B82F6',
        text: '#F5F0E8'
    },
    coverage: null,
    adjusted: {},
    generated: {},
    lowChroma: false,
    seed: null,
    isDefault: true
}, false);
if (palette.isDefault === undefined) {
    currentK = Object.keys(palette.theme).length;
    if (kSlider) { kSlider.value = currentK; kValue.textContent = currentK; }
}
renderSwatchList(historyContainer, history);
renderFavorites();
