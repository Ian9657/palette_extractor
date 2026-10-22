// Floating previews over the archive (source thumbnails) and the A11Y matrix
// (a type specimen of the hovered pair). Positioned by follow.js; desktop only.
//
// Thumbnails: each filed object keeps a small JPEG of its source in this
// browser only — localStorage key THUMBS_KEY, never uploaded. The archive
// shows what is stored and offers to clear it.
const THUMBS_KEY = 'palette.thumbs';
const THUMB_SIZE = 240;
const pv = id => document.getElementById(id);

const themeKey = theme => Object.values(theme).join('');
const loadThumbs = () => { try { return JSON.parse(localStorage.getItem(THUMBS_KEY)) || {}; } catch { return {}; } };
let thumbs = loadThumbs();

function saveThumbs() {
    try {
        if (Object.keys(thumbs).length) localStorage.setItem(THUMBS_KEY, JSON.stringify(thumbs));
        else localStorage.removeItem(THUMBS_KEY);
        return true;
    } catch { return false; }   // quota full or storage blocked: previews just fall back
}

// Keep only thumbnails some archived or starred palette still points to
function pruneThumbs() {
    const live = new Set([...history, ...starred].map(p => themeKey(p.theme)));
    for (const k of Object.keys(thumbs)) if (!live.has(k)) delete thumbs[k];
}

function makeThumb(img) {
    const s = Math.min(1, THUMB_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
}

function renderThumbNote() {
    const n = Object.keys(thumbs).length;
    const kb = Math.round(Object.values(thumbs).reduce((s, t) => s + t.src.length, 0) / 1024);
    const note = pv('thumb-note');
    note.innerHTML = n
        ? `THUMBNAILS — ${n} KEPT · ${kb} KB · stored only in this browser (localStorage › <code>${THUMBS_KEY}</code>), never uploaded. <button type="button" id="thumb-clear">CLEAR</button>`
        : `THUMBNAILS — none kept. Filing an image stores a ${THUMB_SIZE}px copy in this browser only (localStorage › <code>${THUMBS_KEY}</code>).`;
    const btn = pv('thumb-clear');
    if (btn) btn.addEventListener('click', () => { thumbs = {}; saveThumbs(); renderThumbNote(); });
}

// File a thumbnail whenever an object is catalogued (also on reroll / colour count)
const prevSetPalettePv = setPalette;
setPalette = function (next, saveToHistory = false) {
    prevSetPalettePv(next, saveToHistory);
    if (next.isDefault) return;
    if (saveToHistory && currentImgEl) {
        thumbs[themeKey(next.theme)] = {
            src: makeThumb(currentImgEl),
            no: pv('acc-no').textContent,
            name: ntc.name(next.theme.primary)[1]
        };
        pruneThumbs();
        pv('acc-thumb').textContent = saveThumbs()
            ? `SAVED IN THIS BROWSER (localStorage › ${THUMBS_KEY})`
            : 'NOT SAVED — BROWSER STORAGE UNAVAILABLE';
    } else if (!saveToHistory) {
        pv('acc-thumb').textContent = thumbs[themeKey(next.theme)] ? 'KEPT IN THIS BROWSER' : 'NONE KEPT';
    }
    renderThumbNote();
};

// Starring keeps a thumbnail alive even after it leaves the 8-item archive
pv('btn-star-current').addEventListener('click', () => { pruneThumbs(); saveThumbs(); renderThumbNote(); });

renderThumbNote();

// ---- Floating previews ----
if (Follow.enabled) {
    const archivePreview = pv('archive-preview');
    const archiveTrack = pv('archive-track');
    const archiveCaption = pv('archive-caption');
    const specimen = pv('specimen-preview');
    Follow.track(archivePreview, Follow.DELAY.slow);
    Follow.track(specimen, Follow.DELAY.mid);

    // Archive: one track of frames per list, slid to the hovered item
    function frameFor(item) {
        const t = thumbs[themeKey(item.theme)];
        if (t) return `<div class="fp-frame"><img src="${t.src}" alt=""></div>`;
        const bars = Object.values(item.theme).map(c => `<span style="background:${c}"></span>`).join('');
        return `<div class="fp-frame fp-empty"><div class="fp-bars">${bars}</div><span>NO IMAGE KEPT</span></div>`;
    }
    function captionFor(item) {
        const t = thumbs[themeKey(item.theme)];
        return `${t ? t.no : '—'} · ${(t ? t.name : ntc.name(item.theme.primary)[1]).toUpperCase()}`;
    }

    [[pv('history-container'), () => history], [pv('favorites-container'), () => starred]].forEach(([box, list]) => {
        let current = -1;
        box.addEventListener('mouseover', e => {
            const el = e.target.closest('.history-item');
            if (!el) return;
            const items = list();
            const i = [...box.querySelectorAll('.history-item')].indexOf(el);
            if (i < 0 || !items[i]) return;
            if (!archivePreview.classList.contains('active')) {
                archiveTrack.innerHTML = items.map(frameFor).join('');
                archiveTrack.style.setProperty('--count', items.length);
            }
            const opening = !archivePreview.classList.contains('active');
            if (i !== current) {
                current = i;
                archiveTrack.style.setProperty('--index', i);
                FX.decode(archiveCaption, captionFor(items[i]));
                FX.split(archiveTrack, opening ? 360 : 600);   // signal drops while the strip slides
            }
            archivePreview.classList.add('active');
        });
        box.addEventListener('mouseleave', () => { archivePreview.classList.remove('active'); current = -1; });
    });

    // Matrix: the hovered pair set as text (row) on background (column)
    const a11y = pv('a11y-matrix');
    let specimenCaption = '';
    a11y.addEventListener('mouseover', e => {
        const td = e.target.closest('td.a11y-cell');
        if (!td || td.classList.contains('a11y-cell--self')) { specimen.classList.remove('active'); return; }
        const tr = td.parentElement;
        const row = [...tr.parentElement.children].indexOf(tr) - 1;   // first row is the header
        const col = [...tr.children].indexOf(td) - 1;                  // first cell is the row label
        const colors = Object.values(palette.theme);
        const names = ROLE_NAMES[colors.length];
        const sheet = pv('specimen-sheet');
        sheet.style.background = colors[col];
        sheet.style.color = colors[row];
        const ratio = td.querySelector('.a11y-cell-ratio').textContent;
        const grade = td.querySelector('.a11y-cell-badge').textContent;
        const unit = contrastModel === 'apca' ? `Lc ${ratio}` : `${ratio}:1`;
        const caption = `${names[row]} ON ${names[col]} · ${unit} · ${grade}`;
        if (caption !== specimenCaption) {
            specimenCaption = caption;
            FX.decode(pv('specimen-caption'), caption, 240);
        }
        specimen.classList.add('active');
    });
    a11y.addEventListener('mouseleave', () => { specimen.classList.remove('active'); specimenCaption = ''; });

    // The specimen replaces the cells' native tooltips on desktop
    const prevRenderA11y = renderA11yMatrix;
    renderA11yMatrix = function () {
        prevRenderA11y();
        a11y.querySelectorAll('td[title]').forEach(td => td.removeAttribute('title'));
    };
    renderA11yMatrix();
}
