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
let starred = JSON.parse(localStorage.getItem('starredPalettes') || '[]');

const loadingOverlay = document.getElementById('loading-overlay');
const btnExportTailwind = document.getElementById('btn-export-tailwind');
const btnExportCss = document.getElementById('btn-export-css');
const btnExportFigma = document.getElementById('btn-export-figma');
const btnExportImage = document.getElementById('btn-export-image');
const btnStarCurrent = document.getElementById('btn-star-current');
const kSlider = document.getElementById('k-slider');

let isSelecting = false;
let wasDragging = false;
let startX, startY;
let selectionRectDom = null;
const kValue = document.getElementById('k-value');
const historyContainer = document.getElementById('history-container');
const favoritesContainer = document.getElementById('favorites-container');
const a11yMatrix = document.getElementById('a11y-matrix');

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

const workerCode = `
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

self.onmessage = function(e) {
    const { rawPixels, k, MAX_ITER = 15 } = e.data;
    
    if (!rawPixels || rawPixels.length === 0) {
        self.postMessage({ type: 'done' });
        return;
    }

    const pixels = rawPixels.map(p => {
        const oklab = rgbToOklab(p.r, p.g, p.b);
        const chroma = Math.sqrt(oklab.a * oklab.a + oklab.b * oklab.b);
        const weight = 1 + Math.min(chroma * 10, 5); 
        return { r: p.r, g: p.g, b: p.b, oklab, weight, index: p.index };
    });
    
    let centroids = initializeCentroidsKMeansPlusPlus(pixels, Math.min(k, pixels.length));
    
    let iter = 0;
    
    function runNext() {
        const clusters = Array.from({ length: k }, () => []);
        const pixelAssignments = new Uint8Array(pixels.length);
        
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
        
        const cLen = centroids.length;
        if (iter < MAX_ITER - 2 && cLen > 1) {
            let merged = false;
            for (let a = 0; a < cLen && !merged; a++) {
                for (let b = a + 1; b < cLen && !merged; b++) {
                    if (colorDistanceOklab(centroids[a].oklab, centroids[b].oklab) < 0.07) {
                        const toReplace = clusters[a].length < clusters[b].length ? a : b;
                        let maxScore = -1; let bestPixel = null;
                        
                        for (let i = 0; i < pixels.length; i += 7) {
                            const pixel = pixels[i];
                            let minDistToCentroids = Infinity;
                            for (let cIdx = 0; cIdx < cLen; cIdx++) {
                                if (cIdx === toReplace) continue;
                                const d = colorDistanceOklab(pixel.oklab, centroids[cIdx].oklab);
                                if (d < minDistToCentroids) minDistToCentroids = d;
                            }
                            
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
        
        self.postMessage({
            type: 'frame',
            iter,
            MAX_ITER,
            centroids: centroids.map(c => ({r: c.r, g: c.g, b: c.b})),
            pixelAssignments: pixelAssignments.buffer
        }, [pixelAssignments.buffer]);
        
        iter++;
        if (iter < MAX_ITER) {
            setTimeout(runNext, 0);
        } else {
            self.postMessage({ type: 'done' });
        }
    }
    
    runNext();
};
`;

const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
const worker = new Worker(URL.createObjectURL(workerBlob));

let currentTheme = {};
let currentRawColors = null;

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

dropZone.addEventListener('mousedown', (e) => {
    if (!currentImgEl || isExtracting) return;
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

document.addEventListener('mousemove', (e) => {
    if (!isSelecting) return;
    wasDragging = true;
    const rect = dropZone.getBoundingClientRect();
    let currentX = e.clientX - rect.left;
    let currentY = e.clientY - rect.top;
    
    currentX = Math.max(0, Math.min(currentX, rect.width));
    currentY = Math.max(0, Math.min(currentY, rect.height));

    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);
    
    const selBox = document.getElementById('selection-box');
    if (selBox) {
        selBox.style.left = x + 'px';
        selBox.style.top = y + 'px';
        selBox.style.width = w + 'px';
        selBox.style.height = h + 'px';
    }
});

document.addEventListener('mouseup', (e) => {
    if (!isSelecting) return;
    isSelecting = false;
    setTimeout(() => { if(!isSelecting) wasDragging = false; }, 0);
    
    const selBox = document.getElementById('selection-box');
    if (!selBox) return;

    const w = parseInt(selBox.style.width);
    const h = parseInt(selBox.style.height);
    
    if (w > 10 && h > 10) {
        const x = parseInt(selBox.style.left);
        const y = parseInt(selBox.style.top);
        selectionRectDom = {x, y, w, h};
        extractColorsVisualized(currentImgEl, selectionRectDom);
    } else {
        selBox.style.display = 'none';
        selectionRectDom = null;
    }
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
        const selBox = document.getElementById('selection-box');
        if (selBox) selBox.style.display = 'none';
        selectionRectDom = null;
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
        if (currentImgEl) extractColorsVisualized(currentImgEl, selectionRectDom);
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
    isExtracting = true;
    
    loadingOverlay.hidden = false;
    loadingOverlay.style.display = 'flex';
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
    
    let extractRect = { x: 0, y: 0, w: width, h: height };
    if (selDomRect) {
        extractRect = mapDomRectToCanvas(selDomRect, previewCanvas, dropZone);
        if (extractRect.w <= 0 || extractRect.h <= 0) {
            extractRect = { x: 0, y: 0, w: width, h: height };
        }
    }

    const imageDataObj = ctx.getImageData(0, 0, width, height);
    const data = imageDataObj.data;
    const originalData = new Uint8ClampedArray(data);
    
    const rawPixels = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (x >= extractRect.x && x < extractRect.x + extractRect.w &&
                y >= extractRect.y && y < extractRect.y + extractRect.h) {
                
                let i = (y * width + x) * 4;
                if (data[i + 3] > 0) {
                    rawPixels.push({ r: data[i], g: data[i + 1], b: data[i + 2], index: i });
                }
            }
        }
    }
    
    if (rawPixels.length === 0) {
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] > 0) {
                rawPixels.push({ r: data[i], g: data[i + 1], b: data[i + 2], index: i });
            }
        }
        selDomRect = null;
    }

    const currentK_snapshot = currentK;

    worker.onmessage = function(e) {
        if (e.data.type === 'frame') {
            const { iter, MAX_ITER, centroids, pixelAssignments: paBuffer } = e.data;
            const pixelAssignments = new Uint8Array(paBuffer);
            
            const newImageData = new ImageData(new Uint8ClampedArray(originalData), width, height);
            
            if (selDomRect) {
                for (let i = 0; i < newImageData.data.length; i += 4) {
                    let x = (i / 4) % width;
                    let y = Math.floor((i / 4) / width);
                    if (!(x >= extractRect.x && x < extractRect.x + extractRect.w &&
                          y >= extractRect.y && y < extractRect.y + extractRect.h)) {
                        let r = newImageData.data[i], g = newImageData.data[i+1], b = newImageData.data[i+2];
                        let luma = r * 0.299 + g * 0.587 + b * 0.114;
                        newImageData.data[i] = luma * 0.3;
                        newImageData.data[i+1] = luma * 0.3;
                        newImageData.data[i+2] = luma * 0.3;
                    }
                }
            }
            
            for (let pIdx = 0; pIdx < rawPixels.length; pIdx++) {
                const cIdx = pixelAssignments[pIdx];
                const color = centroids[cIdx];
                const dataIdx = rawPixels[pIdx].index;
                newImageData.data[dataIdx] = color.r;
                newImageData.data[dataIdx+1] = color.g;
                newImageData.data[dataIdx+2] = color.b;
            }
            ctx.putImageData(newImageData, 0, 0);
            
            if (iter === MAX_ITER - 1) {
                let finalCentroids = [...centroids];
                while (finalCentroids.length < currentK_snapshot) {
                    finalCentroids.push({r:0, g:0, b:0});
                }
                finalCentroids.sort((a, b) => getBrightness(a) - getBrightness(b));
                
                const theme = {};
                const keys = roleKeys[currentK_snapshot];
                keys.forEach((key, i) => {
                    theme[key] = rgbToHex(finalCentroids[i]);
                });
                
                updateUI(theme, finalCentroids, true);
                
                loadingOverlay.hidden = true;
                loadingOverlay.style.display = 'none';
                isExtracting = false;
            }
        }
    };

    worker.postMessage({
        rawPixels: rawPixels.map(p => ({ r: p.r, g: p.g, b: p.b, index: p.index })),
        k: currentK_snapshot,
        MAX_ITER: 15
    });
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
if (btnExportImage) btnExportImage.addEventListener('click', exportToImage);

function exportToImage(e) {
    if (!currentTheme.bg) return;
    
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
    
    ctx.fillStyle = currentTheme.primary || '#ef4444';
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
    
    const k = Object.keys(currentTheme).length;
    const names = roleNames[k];
    const swatchH = Math.min(100, 660 / k - 20);
    
    Object.values(currentTheme).forEach((color, i) => {
        const y = paletteY + i * (swatchH + 20);
        
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(paletteX + 8, y + 8, swatchW, swatchH);
        
        ctx.fillStyle = color;
        ctx.fillRect(paletteX, y, swatchW, swatchH);
        ctx.lineWidth = 4;
        ctx.strokeRect(paletteX, y, swatchW, swatchH);
        
        const hex = color.replace('#', '');
        const r = parseInt(hex.substring(0,2), 16);
        const g = parseInt(hex.substring(2,4), 16);
        const b = parseInt(hex.substring(4,6), 16);
        const brightness = getBrightness({r, g, b});
        ctx.fillStyle = brightness > 128 ? '#1a1a1a' : '#F5F0E8';
        
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
function updateUI(theme, rawColors, saveToHistory = false) {
    currentTheme = theme;
    currentRawColors = rawColors;
    
    updateStarButtonUI();
    
    // 1. Update Global CSS Variables (Accents only)
    root.style.setProperty('--secondary-color', theme.secondary || theme.bg);
    root.style.setProperty('--primary-color', theme.primary);
    root.style.setProperty('--accent-color', theme.accent || theme.primary);
    
    // 2. Update UI Mockup specific variables (so it previews the full theme without breaking the main page)
    const mockup = document.getElementById('ui-mockup');
    if (mockup) {
        mockup.style.setProperty('--bg-color', theme.bg);
        mockup.style.setProperty('--text-color', theme.text);
        mockup.style.setProperty('--border-color', theme.text);
    }
    
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
        
        // Use ntc.js to name the color
        const ntcMatch = ntc.name(color);
        const colorName = ntcMatch[1].toUpperCase();
        let ratingText = `<div class="swatch-rating"><span>${colorName}</span></div>`;
        
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
        editWrapper.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg><input type="color" value="${color}">`;
        
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

    // Render A11Y contrast matrix
    renderA11yMatrix(theme, rawColors, k, names);

    const badge = document.getElementById('mockup-badge');
    const progress = document.getElementById('mockup-progress');
    if (badge && progress) {
        progress.style.width = '0%';
        badge.textContent = '0%';
        
        const targetProgress = Math.floor(Math.random() * 40) + 40; 
        
        setTimeout(() => {
            progress.style.width = `${targetProgress}%`;
            let currentBadge = 0;
            const intervalTime = Math.max(10, 500 / targetProgress);
            const badgeInterval = setInterval(() => {
                currentBadge++;
                badge.textContent = `${currentBadge}%`;
                if (currentBadge >= targetProgress) clearInterval(badgeInterval);
            }, intervalTime);
        }, 100);
    }
}

// ---- A11Y Contrast Matrix ----
function renderA11yMatrix(theme, rawColors, k, names) {
    if (!a11yMatrix) return;
    
    const colors = Object.values(theme);
    const n = colors.length;
    
    // Parse hex to RGB
    const rgbs = colors.map(hex => {
        const h = hex.replace('#', '');
        return {
            r: parseInt(h.substring(0, 2), 16),
            g: parseInt(h.substring(2, 4), 16),
            b: parseInt(h.substring(4, 6), 16)
        };
    });
    
    // Build table
    let html = '<table>';
    
    // Header row
    html += '<tr><th></th>';
    for (let i = 0; i < n; i++) {
        html += `<th><div style="width:14px;height:14px;background:${colors[i]};border:1px solid var(--border-color);margin:0 auto 3px;"></div>${names[i]}</th>`;
    }
    html += '</tr>';
    
    // Data rows
    let aaCount = 0;
    let totalPairs = 0;
    
    for (let row = 0; row < n; row++) {
        html += `<tr><th><div style="width:14px;height:14px;background:${colors[row]};border:1px solid var(--border-color);margin:0 auto 3px;"></div>${names[row]}</th>`;
        
        for (let col = 0; col < n; col++) {
            if (row === col) {
                html += '<td class="a11y-cell a11y-cell--self">—</td>';
            } else {
                const ratio = getContrastRatio(rgbs[row], rgbs[col]);
                const ratioStr = ratio.toFixed(1);
                totalPairs++;
                
                let cellClass = 'a11y-cell--fail';
                let badge = 'FAIL';
                
                if (ratio >= 7) {
                    cellClass = 'a11y-cell--aaa';
                    badge = 'AAA';
                    aaCount++;
                } else if (ratio >= 4.5) {
                    cellClass = 'a11y-cell--aa';
                    badge = 'AA';
                    aaCount++;
                } else if (ratio >= 3) {
                    cellClass = 'a11y-cell--aa-large';
                    badge = 'AA 18+';
                }
                
                html += `<td class="a11y-cell ${cellClass}" title="${names[row]} on ${names[col]}: ${ratioStr}:1">`;
                html += `<div class="a11y-cell-ratio">${ratioStr}</div>`;
                html += `<div class="a11y-cell-badge">${badge}</div>`;
                html += '</td>';
            }
        }
        html += '</tr>';
    }
    
    html += '</table>';
    
    // Legend
    const pairCount = totalPairs / 2; // Each pair counted twice in matrix
    const passRate = Math.round((aaCount / totalPairs) * 100);
    
    html += '<div class="a11y-legend">';
    html += `<span class="a11y-legend-item"><span class="a11y-legend-swatch" style="background:#1a1a1a;"></span> AAA ≥7:1</span>`;
    html += `<span class="a11y-legend-item"><span class="a11y-legend-swatch" style="background:#3b6;"></span> AA ≥4.5:1</span>`;
    html += `<span class="a11y-legend-item"><span class="a11y-legend-swatch" style="background:#e8c840;"></span> AA 18pt+ ≥3:1</span>`;
    html += `<span class="a11y-legend-item" style="margin-left:auto; opacity:0.6;">PASS RATE: ${passRate}%</span>`;
    html += '</div>';
    
    a11yMatrix.innerHTML = html;
}

function addToHistory(theme, rawColors) {
    const themeStr = JSON.stringify(theme);
    // Deduplicate against ALL history entries, not just the most recent
    const existingIdx = history.findIndex(item => JSON.stringify(item.theme) === themeStr);
    if (existingIdx !== -1) {
        // Remove the old duplicate so we can re-insert at position 0
        history.splice(existingIdx, 1);
    }
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

function isCurrentStarred() {
    if (!currentTheme.bg) return false;
    const themeStr = JSON.stringify(currentTheme);
    return starred.some(item => JSON.stringify(item.theme) === themeStr);
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
        if (!currentTheme.bg) return;
        const themeStr = JSON.stringify(currentTheme);
        if (isCurrentStarred()) {
            starred = starred.filter(item => JSON.stringify(item.theme) !== themeStr);
        } else {
            starred.unshift({ theme: currentTheme, rawColors: currentRawColors });
        }
        localStorage.setItem('starredPalettes', JSON.stringify(starred));
        updateStarButtonUI();
        renderFavorites();
    });
}

function renderFavorites() {
    if (!favoritesContainer) return;
    favoritesContainer.innerHTML = '';
    if (starred.length === 0) {
        favoritesContainer.innerHTML = '<div class="mono-text" style="opacity:0.4; font-size:0.85rem; padding: 2rem 0; color: var(--secondary-color);">NO STARRED PALETTES YET.</div>';
        return;
    }
    starred.forEach((item) => {
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
        favoritesContainer.appendChild(div);
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
renderFavorites();
