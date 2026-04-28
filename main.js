const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const previewCanvas = document.getElementById('preview-canvas');
const dropContent = document.getElementById('drop-content');
const paletteContainer = document.getElementById('palette-container');
const root = document.documentElement;

let isExtracting = false;
let currentK = 5;
let currentImgEl = null;
let history = JSON.parse(localStorage.getItem('paletteHistory') || '[]');

const loadingOverlay = document.getElementById('loading-overlay');
const btnExportTailwind = document.getElementById('btn-export-tailwind');
const btnExportCss = document.getElementById('btn-export-css');
const btnExportFigma = document.getElementById('btn-export-figma');
const kSlider = document.getElementById('k-slider');
const kValue = document.getElementById('k-value');
const historyContainer = document.getElementById('history-container');

const roleNames = {
    3: ['BASE', 'PRIMARY', 'TEXT'],
    4: ['BASE', 'SECOND', 'PRIMARY', 'TEXT'],
    5: ['BASE', 'SECOND', 'PRIMARY', 'ACCENT', 'TEXT'],
    6: ['BASE', 'SURFACE', 'SECOND', 'PRIMARY', 'ACCENT', 'TEXT'],
    7: ['BASE', 'SURFACE', 'SECOND', 'PRIMARY', 'ACCENT', 'HILITE', 'TEXT'],
    8: ['BASE', 'SURFACE', 'SECOND', 'MUTED', 'PRIMARY', 'ACCENT', 'HILITE', 'TEXT']
};

const roleKeys = {
    3: ['bg', 'primary', 'text'],
    4: ['bg', 'secondary', 'primary', 'text'],
    5: ['bg', 'secondary', 'primary', 'accent', 'text'],
    6: ['bg', 'surface', 'secondary', 'primary', 'accent', 'text'],
    7: ['bg', 'surface', 'secondary', 'primary', 'accent', 'highlight', 'text'],
    8: ['bg', 'surface', 'secondary', 'muted', 'primary', 'accent', 'highlight', 'text']
};

function rgbToOklab(r, g, b) {
    let r_l = (r / 255); let g_l = (g / 255); let b_l = (b / 255);
    r_l = r_l > 0.04045 ? Math.pow((r_l + 0.055) / 1.055, 2.4) : r_l / 12.92;
    g_l = g_l > 0.04045 ? Math.pow((g_l + 0.055) / 1.055, 2.4) : g_l / 12.92;
    b_l = b_l > 0.04045 ? Math.pow((b_l + 0.055) / 1.055, 2.4) : b_l / 12.92;
    let l = 0.4122214708 * r_l + 0.5363325363 * g_l + 0.0514459929 * b_l;
    let m = 0.2119034982 * r_l + 0.6806995451 * g_l + 0.1073969566 * b_l;
    let s = 0.0883024619 * r_l + 0.2817188376 * g_l + 0.6299787005 * b_l;
    let l_ = Math.cbrt(Math.max(0, l)); let m_ = Math.cbrt(Math.max(0, m)); let s_ = Math.cbrt(Math.max(0, s));
    return {
        L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    };
}

function colorDistanceOklab(c1, c2) {
    return Math.sqrt(Math.pow(c1.L - c2.L, 2) + Math.pow(c1.a - c2.a, 2) + Math.pow(c1.b - c2.b, 2));
}

function initializeCentroidsKMeansPlusPlus(pixels, k) {
    const centroids = [pixels[Math.floor(Math.random() * pixels.length)]];
    for (let i = 1; i < k; i++) {
        let maxDist = -1; let nextCentroid = null;
        for (const pixel of pixels) {
            let minDistToCentroids = Math.min(...centroids.map(c => colorDistanceOklab(pixel.oklab, c.oklab)));
            if (minDistToCentroids > maxDist) { maxDist = minDistToCentroids; nextCentroid = pixel; }
        }
        centroids.push(nextCentroid);
    }
    return centroids;
}

let currentTheme = {};

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

dropZone.addEventListener('click', () => {
    fileInput.click();
});

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
        currentImgEl = img;
        extractColorsVisualized(img);
    };
    img.src = URL.createObjectURL(file);
}

if (kSlider) {
    kSlider.addEventListener('input', (e) => {
        currentK = parseInt(e.target.value);
        if (kValue) kValue.textContent = currentK;
    });
    kSlider.addEventListener('change', () => {
        if (currentImgEl) extractColorsVisualized(currentImgEl);
    });
}

// ---- K-Means Color Extraction Visualized ----
function extractColorsVisualized(imgEl) {
    isExtracting = true;
    
    loadingOverlay.hidden = false;
    loadingOverlay.style.background = 'transparent';
    
    const ctx = previewCanvas.getContext('2d', { willReadFrequently: true });
    
    const MAX_SIZE = 200; 
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
    
    const imageDataObj = ctx.getImageData(0, 0, width, height);
    const data = imageDataObj.data;
    
    const rawPixels = [];
    for (let i = 0; i < data.length; i += 4) {
        rawPixels.push({ r: data[i], g: data[i + 1], b: data[i + 2], index: i });
    }

    const k = currentK;
    const pixels = rawPixels.map(p => {
        const oklab = rgbToOklab(p.r, p.g, p.b);
        // Strategy 2: Weighted sampling by saturation (chroma)
        const chroma = Math.sqrt(oklab.a * oklab.a + oklab.b * oklab.b);
        const weight = 1 + Math.min(chroma * 10, 5); 
        return { r: p.r, g: p.g, b: p.b, oklab, weight, index: p.index };
    });
    let centroids = initializeCentroidsKMeansPlusPlus(pixels, k);
    
    let iter = 0;
    const MAX_ITER = 15;
    
    function runFrame() {
        const clusters = Array.from({ length: k }, () => []);
        const pixelAssignments = new Array(pixels.length);
        
        for (let pIdx = 0; pIdx < pixels.length; pIdx++) {
            const pixel = pixels[pIdx];
            let minDist = Infinity; let clusterIdx = 0;
            for (let j = 0; j < k; j++) {
                const dist = colorDistanceOklab(pixel.oklab, centroids[j].oklab);
                if (dist < minDist) { minDist = dist; clusterIdx = j; }
            }
            clusters[clusterIdx].push(pixel);
            pixelAssignments[pIdx] = clusterIdx;
        }
        
        centroids = clusters.map((cluster, j) => {
            if (cluster.length === 0) return centroids[j];
            let sumR = 0, sumG = 0, sumB = 0, sumW = 0;
            for (const p of cluster) {
                sumR += p.r * p.weight;
                sumG += p.g * p.weight;
                sumB += p.b * p.weight;
                sumW += p.weight;
            }
            const r = Math.round(sumR / sumW);
            const g = Math.round(sumG / sumW);
            const b = Math.round(sumB / sumW);
            return { r, g, b, oklab: rgbToOklab(r, g, b) };
        });
        
        // Strategy 3: In-flight deduplication
        if (iter < MAX_ITER - 2) {
            let merged = false;
            for (let a = 0; a < k && !merged; a++) {
                for (let b = a + 1; b < k && !merged; b++) {
                    if (colorDistanceOklab(centroids[a].oklab, centroids[b].oklab) < 0.07) {
                        const toReplace = clusters[a].length < clusters[b].length ? a : b;
                        let maxScore = -1; let bestPixel = null;
                        
                        // Sample pixels (step by 7) to avoid isolated 1-px noise
                        for (let i = 0; i < pixels.length; i += 7) {
                            const pixel = pixels[i];
                            let minDistToCentroids = Infinity;
                            for (let cIdx = 0; cIdx < k; cIdx++) {
                                if (cIdx === toReplace) continue;
                                const d = colorDistanceOklab(pixel.oklab, centroids[cIdx].oklab);
                                if (d < minDistToCentroids) minDistToCentroids = d;
                            }
                            
                            // Score blends distance with capped vividness
                            let score = minDistToCentroids * Math.min(pixel.weight, 3);
                            if (score > maxScore) { maxScore = score; bestPixel = pixel; }
                        }
                        if (bestPixel) {
                            centroids[toReplace] = { r: bestPixel.r, g: bestPixel.g, b: bestPixel.b, oklab: bestPixel.oklab };
                            merged = true;
                        }
                    }
                }
            }
        }
        
        const newImageData = new ImageData(width, height);
        newImageData.data.fill(255); 
        for (let pIdx = 0; pIdx < pixels.length; pIdx++) {
            const cIdx = pixelAssignments[pIdx];
            const color = centroids[cIdx];
            const dataIdx = pixels[pIdx].index;
            newImageData.data[dataIdx] = color.r;
            newImageData.data[dataIdx+1] = color.g;
            newImageData.data[dataIdx+2] = color.b;
        }
        ctx.putImageData(newImageData, 0, 0);
        
        iter++;
        if (iter < MAX_ITER) {
            setTimeout(() => requestAnimationFrame(runFrame), 50);
        } else {
            let finalCentroids = centroids.map(c => ({r: c.r, g: c.g, b: c.b}));
            finalCentroids.sort((a, b) => getBrightness(a) - getBrightness(b));
            
            const theme = {};
            const keys = roleKeys[k];
            keys.forEach((key, i) => {
                theme[key] = rgbToHex(finalCentroids[i]);
            });
            
            updateUI(theme, finalCentroids, true);
            
            loadingOverlay.hidden = true;
            isExtracting = false;
        }
    }
    
    setTimeout(() => requestAnimationFrame(runFrame), 600);
}

// ---- Helpers & A11y ----
function getBrightness(c) {
    return (c.r * 299 + c.g * 587 + c.b * 114) / 1000;
}

function getLuminance(r, g, b) {
    const a = [r, g, b].map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function getContrastRatio(c1, c2) {
    const lum1 = getLuminance(c1.r, c1.g, c1.b);
    const lum2 = getLuminance(c2.r, c2.g, c2.b);
    const brightest = Math.max(lum1, lum2);
    const darkest = Math.min(lum1, lum2);
    return (brightest + 0.05) / (darkest + 0.05);
}

function rgbToHex({r, g, b}) {
    return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1).toUpperCase();
}

// ---- Export Capabilities ----
function exportToFigma(e) {
    if (!currentTheme.bg) return;
    const tokens = { "Palette": {} };
    Object.entries(currentTheme).forEach(([key, value]) => {
        tokens.Palette[key] = { "value": value, "type": "color" };
    });
    const content = JSON.stringify(tokens, null, 2);
    downloadConfig(content, 'figma-tokens.json', e.target);
}

if (btnExportFigma) btnExportFigma.addEventListener('click', exportToFigma);

function exportToTailwind(e) {
    if (!currentTheme.bg) return;
    const colors = {};
    Object.entries(currentTheme).forEach(([key, value]) => {
        colors[key === 'text' ? 'foreground' : (key === 'bg' ? 'background' : key)] = value;
    });
    const config = { theme: { extend: { colors } } };
    const content = `module.exports = ${JSON.stringify(config, null, 2)};`;
    downloadConfig(content, 'tailwind.config.js', e.target);
}

function exportToCSS(e) {
    if (!currentTheme.bg) return;
    let content = `:root {\n`;
    Object.entries(currentTheme).forEach(([key, value]) => {
        content += `  --${key === 'bg' ? 'bg' : key}-color: ${value};\n`;
    });
    content += `}\n`;
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

// ---- UI Updates ----
function updateUI(theme, rawColors, saveToHistory = false) {
    currentTheme = theme;
    
    // 1. Update CSS Variables
    root.style.setProperty('--secondary-color', theme.secondary || theme.bg);
    root.style.setProperty('--primary-color', theme.primary);
    root.style.setProperty('--accent-color', theme.accent || theme.primary);
    
    // 2. Render color swatches
    paletteContainer.innerHTML = '';
    const k = Object.keys(theme).length;
    const names = roleNames[k];
    const keys = roleKeys[k];
    
    Object.values(theme).forEach((color, index) => {
        const swatch = document.createElement('div');
        swatch.className = 'swatch';
        swatch.style.backgroundColor = color;
        
        let textColor = '#F5F0E8';
        if (rawColors && rawColors[index]) {
            const brightness = getBrightness(rawColors[index]);
            if (brightness > 128) {
                textColor = '#1a1a1a';
            }
        }
        swatch.style.color = textColor;
        
        let ratingText = '';
        if (rawColors && rawColors[index] && rawColors[0] && index > 0) {
            const contrast = getContrastRatio(rawColors[index], rawColors[0]);
            let rating = contrast >= 7 ? 'AAA' : (contrast >= 4.5 ? 'AA' : 'FAIL');
            ratingText = `<div class="swatch-rating">R: ${contrast.toFixed(1)} [${rating}]</div>`;
        } else if (index === 0) {
            ratingText = `<div class="swatch-rating">BASE PAPER</div>`;
        }
        
        swatch.innerHTML = `
            <div class="swatch-content">
                <div class="swatch-header">${names[index]}</div>
                <div class="swatch-footer mono-text">
                    <div class="swatch-hex">${color}</div>
                    ${ratingText}
                </div>
            </div>
        `;
        
        const editWrapper = document.createElement('div');
        editWrapper.className = 'color-input-wrapper';
        editWrapper.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg><input type="color" value="${color}">`;
        
        const colorInput = editWrapper.querySelector('input');
        colorInput.addEventListener('input', (e) => {
            e.stopPropagation();
            const newColor = e.target.value;
            const newTheme = { ...currentTheme };
            newTheme[keys[index]] = newColor;
            
            const newRawColors = [...rawColors];
            const hex = newColor.replace('#', '');
            newRawColors[index] = {
                r: parseInt(hex.substring(0,2), 16),
                g: parseInt(hex.substring(2,4), 16),
                b: parseInt(hex.substring(4,6), 16)
            };
            updateUI(newTheme, newRawColors, false);
        });
        
        colorInput.addEventListener('click', e => e.stopPropagation());
        swatch.appendChild(editWrapper);
        
        swatch.addEventListener('click', () => {
            navigator.clipboard.writeText(color);
            const hexEl = swatch.querySelector('.swatch-hex');
            const originalText = hexEl.innerText;
            hexEl.innerText = `COPIED`;
            setTimeout(() => { hexEl.innerText = originalText; }, 1000);
        });
        paletteContainer.appendChild(swatch);
    });

    if (saveToHistory) {
        addToHistory(theme, rawColors);
    }

    const badge = document.getElementById('mockup-badge');
    const progress = document.getElementById('mockup-progress');
    if (badge && progress) {
        progress.style.width = '0%';
        badge.textContent = '0%';
        
        const targetProgress = Math.floor(Math.random() * 40) + 40; 
        const targetBadge = Math.floor(Math.random() * 20) + 5;
        
        setTimeout(() => {
            progress.style.width = `${targetProgress}%`;
            let currentBadge = 0;
            const badgeInterval = setInterval(() => {
                currentBadge++;
                badge.textContent = `${currentBadge}%`;
                if (currentBadge >= targetBadge) clearInterval(badgeInterval);
            }, 30);
        }, 100);
    }
}

function addToHistory(theme, rawColors) {
    if (history.length > 0 && JSON.stringify(history[0].theme) === JSON.stringify(theme)) return;
    history.unshift({ theme, rawColors });
    if (history.length > 8) history.pop();
    localStorage.setItem('paletteHistory', JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    if (!historyContainer) return;
    historyContainer.innerHTML = '';
    history.forEach((item) => {
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
            if(kSlider) { kSlider.value = currentK; kValue.textContent = currentK; }
            updateUI(item.theme, item.rawColors, false);
        });
        historyContainer.appendChild(div);
    });
}

// Initial default render
const defaultTheme = {
    bg: '#1a1a1a',
    secondary: '#333333',
    primary: '#ef4444',
    accent: '#3b82f6',
    text: '#F5F0E8'
};
const defaultRaw = [
    {r: 26, g: 26, b: 26},
    {r: 51, g: 51, b: 51},
    {r: 239, g: 68, b: 68},
    {r: 59, g: 130, b: 246},
    {r: 245, g: 240, b: 232}
];
updateUI(defaultTheme, defaultRaw, false);
renderHistory();
