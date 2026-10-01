// Side-by-side image → palette for every regression case. Refresh after each
// algorithm change; "Save as baseline" freezes the current output so the next
// refresh outlines every role whose colour moved.
const MAX_SIZE = 400;
const BASELINE_KEY = 'galleryBaseline';
const kSelect = document.getElementById('k');
const seedInput = document.getElementById('seed');
const rowsEl = document.getElementById('rows');
const dropEl = document.getElementById('drop');

for (let k = 3; k <= 8; k++) kSelect.add(new Option(k, k, k === 5, k === 5));

const loadBaseline = () => { try { return JSON.parse(localStorage.getItem(BASELINE_KEY)) || {}; } catch { return {}; } };

// ---- Synthetic cases: known structure, no files needed ----
const rect = (ctx, color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
const textLines = (ctx, color, x, y, n, w) => { for (let i = 0; i < n; i++) rect(ctx, color, x, y + i * 12, w - (i % 3) * 25, 5); };

const SYNTHETIC = [
    ['three blocks on white', (ctx, w, h) => {
        rect(ctx, '#FFFFFF', 0, 0, w, h);
        rect(ctx, '#D62828', 20, 30, 45, 100); rect(ctx, '#2A9D8F', 78, 30, 45, 100); rect(ctx, '#264653', 136, 30, 45, 100);
    }],
    ['dark UI', (ctx, w, h) => {
        rect(ctx, '#121212', 0, 0, w, h); rect(ctx, '#1E1E1E', 10, 10, w - 20, 40);
        textLines(ctx, '#E0E0E0', 20, 65, 6, 150); rect(ctx, '#BB86FC', 20, 135, 60, 16);
    }],
    ['light docs page', (ctx, w, h) => {
        rect(ctx, '#FAFAF7', 0, 0, w, h); rect(ctx, '#EDEDE8', 0, 0, 40, h);
        textLines(ctx, '#222222', 55, 20, 9, 130); rect(ctx, '#0B63CE', 55, 132, 50, 14);
    }],
    ['grey gradient', (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#000'); g.addColorStop(1, '#FFF');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }],
    ['sepia photo', (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7);
        g.addColorStop(0, '#E8DCC8'); g.addColorStop(0.6, '#A08C70'); g.addColorStop(1, '#3A3026');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }],
    ['hue sweep', (ctx, w, h) => {
        for (let x = 0; x < w; x++) rect(ctx, `hsl(${x / w * 360}, 80%, 55%)`, x, 0, 1, h);
    }],
    ['sunset', (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#1B1B3A'); g.addColorStop(0.45, '#C33C54'); g.addColorStop(0.7, '#F49D37'); g.addColorStop(1, '#2B1D14');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }],
    ['tiny accent on beige', (ctx, w, h) => {
        rect(ctx, '#EFE6D2', 0, 0, w, h); rect(ctx, '#1F2A44', 30, 40, 40, 30); rect(ctx, '#E63946', 150, 120, 10, 10);
    }],
    ['mid-grey bg, mid-grey text', (ctx, w, h) => {
        rect(ctx, '#808080', 0, 0, w, h); textLines(ctx, '#9A9A9A', 20, 20, 10, 160); rect(ctx, '#7A8FB0', 20, 140, 40, 10);
    }],
    ['noisy blobs', (ctx, w, h) => {
        const rand = mulberry32(42);
        rect(ctx, '#2E4A3A', 0, 0, w, h);
        const cols = ['#6B8F4E', '#D9C27E', '#8C4A2F', '#A7C4D9', '#F2EFE6'];
        for (let i = 0; i < 160; i++) {
            ctx.fillStyle = cols[i % cols.length]; ctx.globalAlpha = 0.6;
            ctx.beginPath(); ctx.arc(rand() * w, rand() * h, 3 + rand() * 12, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
    }]
];

// ---- Pipeline ----
function toCanvas(source) {
    let w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
    const s = Math.min(1, MAX_SIZE / Math.max(w, h));
    w = Math.max(1, Math.floor(w * s)); h = Math.max(1, Math.floor(h * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(source, 0, 0, w, h);
    return c;
}

function syntheticCanvas(draw) {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 160;
    draw(c.getContext('2d'), c.width, c.height);
    return c;
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('could not load ' + src));
        img.src = src;
    });
}

// ---- Rendering ----
const fmt = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
function scoreTip(terms) {
    if (!terms) return '';
    const lines = Object.entries(terms).map(([t, v]) => `${t.padEnd(9)}${fmt(v)}`);
    const total = Object.values(terms).reduce((a, b) => a + b, 0);
    return '\n' + lines.join('\n') + `\n${'= score'.padEnd(9)}${fmt(total)}`;
}

function strip(theme, k, className, diffAgainst, scores) {
    const el = document.createElement('div');
    el.className = 'strip ' + (className || '');
    ROLE_KEYS[k].forEach((key, i) => {
        const hex = theme[key];
        const sw = document.createElement('div');
        sw.className = 'sw' + (diffAgainst && diffAgainst[key] !== hex ? ' diff' : '');
        sw.style.background = hex;
        sw.style.color = inkOn(hex);
        sw.title = `${ROLE_NAMES[k][i]} ${hex}` + scoreTip(scores && scores[key]);
        if (!className) sw.innerHTML = `<b>${ROLE_NAMES[k][i]}</b>${hex}`;
        el.appendChild(sw);
    });
    return el;
}

function renderRow(name, canvas, k, seed, baseline) {
    const row = document.createElement('div');
    row.className = 'row';
    const info = document.createElement('div');

    let result;
    try {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        result = extractPalette(data, canvas.width, canvas.height, k, { seed });
        row.appendChild(canvas);
    } catch (err) {
        const e = document.createElement('div');
        e.className = 'err';
        e.textContent = location.protocol === 'file:'
            ? 'Canvas is blocked on file://. Run: python3 -m http.server'
            : err.message;
        row.appendChild(e);
        row.appendChild(info);
        info.innerHTML = `<div class="name">${name}</div>`;
        return { row };
    }

    const base = baseline[`${name}|k${k}|s${seed}`];
    const changed = base && ROLE_KEYS[k].some(key => base.theme[key] !== result.theme[key]);
    // Reconstruction error vs baseline: lower is more faithful to the image
    let errTag = `<span class="tag" title="Mean OKLab distance from each pixel to its palette colour">ERR ${result.error.toFixed(4)}</span>`;
    if (base && base.error != null) {
        const delta = result.error - base.error;
        const rel = base.error > 0 ? delta / base.error : 0;
        if (Math.abs(rel) >= 0.02) {
            errTag += `<span class="tag ${rel > 0 ? 'changed' : 'better'}">${rel > 0 ? '▲' : '▼'} ${Math.abs(rel * 100).toFixed(0)}%</span>`;
        }
    }
    const tags = [
        `<span class="tag">COV ${result.coverage}%</span>`,
        errTag,
        ...Object.keys(result.adjusted).map(r => `<span class="tag" title="was ${result.adjusted[r]}">ADJ ${r.toUpperCase()}</span>`),
        ...Object.keys(result.generated).map(r => `<span class="tag" title="not in the image">GEN ${r.toUpperCase()}</span>`),
        result.lowChroma ? '<span class="tag">LOW CHROMA</span>' : '',
        changed ? '<span class="tag changed">CHANGED</span>' : ''
    ].join('');
    info.innerHTML = `<div class="name">${name}${tags}</div>`;
    info.appendChild(strip(result.theme, k, '', base && base.theme, result.scores));
    if (base && changed) info.appendChild(strip(base.theme, k, 'baseline'));
    row.appendChild(info);
    return { row, result };
}

// ---- Driver ----
let extraFiles = []; // dropped this session: [{ name, src }]
let lastResults = {};

async function run() {
    const k = parseInt(kSelect.value), seed = Math.max(1, parseInt(seedInput.value) || 1);
    const baseline = loadBaseline();
    rowsEl.innerHTML = '';
    lastResults = {};

    const add = (name, canvas) => {
        const { row, result } = renderRow(name, canvas, k, seed, baseline);
        rowsEl.appendChild(row);
        if (result) lastResults[`${name}|k${k}|s${seed}`] = { theme: result.theme, error: result.error };
    };

    for (const [name, draw] of SYNTHETIC) add('synthetic: ' + name, syntheticCanvas(draw));

    const files = [...(window.REGRESSION_IMAGES || []).map(src => ({ name: src, src })), ...extraFiles];
    for (const f of files) {
        try {
            add(f.name, toCanvas(await loadImage(f.src)));
        } catch (err) {
            const row = document.createElement('div');
            row.className = 'row';
            row.innerHTML = `<div class="err">${err.message}</div><div class="name">${f.name}</div>`;
            rowsEl.appendChild(row);
        }
    }
}

document.getElementById('save-baseline').addEventListener('click', () => {
    localStorage.setItem(BASELINE_KEY, JSON.stringify({ ...loadBaseline(), ...lastResults }));
    run();
});
document.getElementById('clear-baseline').addEventListener('click', () => {
    localStorage.removeItem(BASELINE_KEY);
    run();
});
kSelect.addEventListener('change', run);
seedInput.addEventListener('change', run);

['dragenter', 'dragover'].forEach(ev => dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => dropEl.addEventListener(ev, e => { e.preventDefault(); dropEl.classList.remove('over'); }));
dropEl.addEventListener('drop', e => {
    for (const file of e.dataTransfer.files) {
        if (file.type.startsWith('image/')) extraFiles.push({ name: 'dropped: ' + file.name, src: URL.createObjectURL(file) });
    }
    run();
});

run();
