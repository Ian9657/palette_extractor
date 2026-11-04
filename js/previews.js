// Previews of the archive (source thumbnails) and the A11Y matrix (a type
// specimen of a pair). With a fine pointer they float by the cursor,
// positioned by follow.js. On touch there is no hover to separate looking from
// choosing, so a tap opens them on a small screen fixed to the bottom of the
// viewport, with the same signal effects; RETRIEVE is what restores a palette.
//
// Thumbnails: each filed object keeps a small JPEG of its source in this
// browser only — localStorage key THUMBS_KEY, never uploaded. The archive
// shows what is stored and offers to clear it.
const THUMBS_KEY = 'palette.thumbs';
const THUMB_SIZE = 480;
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

// Retrieved from storage with no live image: show the kept thumbnail in Fig. 1
// (a deposit replaces it). With a live image on the page, Fig. 1 keeps that.
function showArchivedSource(kept) {
    const zone = pv('drop-zone'), img = pv('fig-original');
    if (currentImgEl) return;
    zone.classList.toggle('archived', !!kept);
    if (kept) {
        img.src = kept.src;
        pv('acc-no').textContent = kept.no;
        pv('feature-kicker').textContent = `ACCESSION — ${kept.no}`;
        pv('feature-standfirst').textContent = `${Object.keys(palette.theme).length} colours, retrieved from storage. Only a ${THUMB_SIZE}px thumbnail of the source was kept, in this browser.`;
        pv('fig1-cap').textContent = `${kept.no}, as archived — a ${THUMB_SIZE}px thumbnail. Drop, paste or click to deposit a new image.`;
    }
}

// File a thumbnail whenever an object is catalogued (also on reroll / colour count)
const prevSetPalettePv = setPalette;
setPalette = function (next, saveToHistory = false) {
    prevSetPalettePv(next, saveToHistory);
    if (next.isDefault) return;
    if (saveToHistory && currentImgEl) {
        pv('drop-zone').classList.remove('archived');
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
        const kept = thumbs[themeKey(next.theme)];
        pv('acc-thumb').textContent = kept ? 'KEPT IN THIS BROWSER' : 'NONE KEPT';
        showArchivedSource(kept);
    }
    renderThumbNote();
};

// Starring keeps a thumbnail alive even after it leaves the 8-item archive
pv('btn-star-current').addEventListener('click', () => { pruneThumbs(); saveThumbs(); renderThumbNote(); });

renderThumbNote();
// A shared or reloaded link (#p=…) opens a stored palette before this script ran
if (!palette.isDefault && !currentImgEl) {
    const kept = thumbs[themeKey(palette.theme)];
    pv('acc-thumb').textContent = kept ? 'KEPT IN THIS BROWSER' : 'NONE KEPT';
    showArchivedSource(kept);
}

// ---- Previews ----
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
const archiveLists = [[pv('history-container'), () => history], [pv('favorites-container'), () => starred]];
const itemIndex = (box, el) => [...box.querySelectorAll('.history-item')].indexOf(el);

// Matrix cell → { bg, fg, caption } of the pair it stands for; null for the diagonal
const a11y = pv('a11y-matrix');
function pairFor(td) {
    if (!td || td.classList.contains('a11y-cell--self')) return null;
    const tr = td.parentElement;
    const row = [...tr.parentElement.children].indexOf(tr) - 1;   // first row is the header
    const col = [...tr.children].indexOf(td) - 1;                  // first cell is the row label
    const colors = Object.values(palette.theme);
    const names = ROLE_NAMES[colors.length];
    const ratio = td.querySelector('.a11y-cell-ratio').textContent;
    const grade = td.querySelector('.a11y-cell-badge').textContent;
    const unit = contrastModel === 'apca' ? `Lc ${ratio}` : `${ratio}:1`;
    return { bg: colors[col], fg: colors[row], caption: `${names[row]} ON ${names[col]} · ${unit} · ${grade}` };
}

if (Follow.enabled) {
    const archivePreview = pv('archive-preview');
    const archiveTrack = pv('archive-track');
    const archiveCaption = pv('archive-caption');
    const specimen = pv('specimen-preview');
    Follow.track(archivePreview, Follow.DELAY.slow);
    Follow.track(specimen, Follow.DELAY.mid);

    // Archive: one track of frames per list, slid to the hovered item
    archiveLists.forEach(([box, list]) => {
        let current = -1;
        box.addEventListener('mouseover', e => {
            const el = e.target.closest('.history-item');
            if (!el) return;
            const items = list();
            const i = itemIndex(box, el);
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
    let specimenCaption = '';
    a11y.addEventListener('mouseover', e => {
        const pair = pairFor(e.target.closest('td.a11y-cell'));
        if (!pair) { specimen.classList.remove('active'); return; }
        const sheet = pv('specimen-sheet');
        sheet.style.background = pair.bg;
        sheet.style.color = pair.fg;
        if (pair.caption !== specimenCaption) {
            specimenCaption = pair.caption;
            FX.decode(pv('specimen-caption'), pair.caption, 240);
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
} else {
    const tv = document.createElement('div');
    tv.className = 'tap-screen';
    tv.hidden = true;
    tv.innerHTML = `
        <div class="fp-window ts-window">
            <div class="fp-track"></div>
            <div class="fs-sheet">${pv('specimen-sheet').innerHTML}</div>
        </div>
        <div class="ts-side">
            <div class="fp-bars ts-bars"></div>
            <div class="fp-caption mono-text"></div>
            <button type="button" class="btn-export ts-retrieve">RETRIEVE</button>
        </div>
        <button type="button" class="ts-close" aria-label="Close preview">×</button>`;
    document.body.appendChild(tv);
    const part = sel => tv.querySelector(sel);
    const track = part('.fp-track'), sheet = part('.fs-sheet'), caption = part('.fp-caption');

    let open = null;   // what is on screen: { mark, box, index } (box only for the archive)
    let shutTimer = 0;
    const unmark = () => { if (open && open.mark) open.mark.classList.remove('tapped'); };
    function closeScreen() {
        if (tv.hidden || !open) return;
        unmark();
        open = null;
        if (REDUCED_MOTION) { tv.hidden = true; return; }
        tv.classList.remove('ts-in');
        tv.classList.add('ts-out');
        shutTimer = setTimeout(() => { tv.hidden = true; tv.classList.remove('ts-out'); }, 160);
    }
    // On a first show it cuts in; while open it stays and the signal drops instead
    function show(mode, mark, extra) {
        const switching = !!open;
        unmark();
        clearTimeout(shutTimer);
        open = { mark, ...extra };
        mark.classList.add('tapped');
        tv.dataset.mode = mode;
        tv.hidden = false;
        tv.classList.remove('ts-out');
        // Comparing colour pairs means many tips in a row, so the specimen doesn't shake
        if (switching) { if (mode === 'archive') FX.split(tv, 360); }
        else {
            tv.classList.remove('ts-in');
            void tv.offsetWidth;   // restart the cut-in
            tv.classList.add('ts-in');
        }
        // Whatever was tapped stays in view above the screen
        const over = mark.getBoundingClientRect().bottom + 12 - tv.getBoundingClientRect().top;
        if (over > 0) window.scrollBy({ top: over, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
    }

    archiveLists.forEach(([box, list]) => {
        // Capture, and stop there: a tap only looks. The item's own click, which
        // restores the palette, is left for RETRIEVE.
        box.addEventListener('click', e => {
            const el = e.target.closest('.history-item');
            if (!el || el.dataset.retrieving) return;
            e.stopPropagation();
            const i = itemIndex(box, el), items = list();
            if (i < 0 || !items[i]) return;
            if (open && open.box === box && open.index === i) { closeScreen(); return; }
            if (!open || open.box !== box) {
                track.innerHTML = items.map(frameFor).join('');
                track.style.setProperty('--count', items.length);
            }
            track.style.setProperty('--index', i);
            part('.ts-bars').innerHTML = Object.values(items[i].theme).map(c => `<span style="background:${c}"></span>`).join('');
            show('archive', el, { box, index: i });
            FX.decode(caption, captionFor(items[i]));
            FX.split(track, 600);
        }, true);
    });

    part('.ts-retrieve').addEventListener('click', () => {
        if (!open || !open.mark) return;
        const el = open.mark;
        el.dataset.retrieving = '1';
        el.click();
        delete el.dataset.retrieving;
        closeScreen();
    });
    part('.ts-close').addEventListener('click', closeScreen);

    a11y.addEventListener('click', e => {
        const td = e.target.closest('td.a11y-cell');
        const pair = pairFor(td);
        if (!pair || (open && open.mark === td)) { closeScreen(); return; }
        sheet.style.background = pair.bg;
        sheet.style.color = pair.fg;
        show('specimen', td, {});
        FX.decode(caption, pair.caption, 120);
    });

    // A tap anywhere else puts the screen away
    document.addEventListener('click', e => {
        if (!open || tv.contains(e.target) || e.target.closest('.history-item, td.a11y-cell')) return;
        closeScreen();
    });

    // A new palette redraws the matrix and shifts the archive under it
    const prevSetPaletteTap = setPalette;
    setPalette = function (next, saveToHistory = false) {
        prevSetPaletteTap(next, saveToHistory);
        closeScreen();
    };
    const prevRenderA11y = renderA11yMatrix;
    renderA11yMatrix = function () {
        if (open && tv.dataset.mode === 'specimen') closeScreen();
        prevRenderA11y();
    };
}
