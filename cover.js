// SAVE IMG for the magazine edition: renders the current object as a 4:5
// magazine cover in the current edition's inks (day or night) and downloads
// it. Replaces main.js's classic card on this page only.
const COVER_W = 1200, COVER_H = 1500, COVER_M = 72;

function coverTokens() {
    const css = getComputedStyle(document.documentElement);
    const v = name => css.getPropertyValue(name).trim();
    return {
        paper: v('--bg-color'), ink: v('--text-color'), signal: v('--signal'),
        signalInk: v('--signal-ink'), alert: v('--alert'), alertInk: v('--alert-ink'),
        night: document.documentElement.dataset.theme === 'night'
    };
}

// Source for Fig. 1: the live image, else the archived thumbnail, else nothing
function coverSource() {
    if (currentImgEl) return Promise.resolve(currentImgEl);
    const t = typeof thumbs === 'object' && thumbs[Object.values(palette.theme).join('')];
    if (!t) return Promise.resolve(null);
    const img = new Image();
    img.src = t.src;
    return img.decode().then(() => img, () => null);
}

function wrapLines(ctx, text, maxWidth) {
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
        else line = test;
    }
    if (line) lines.push(line);
    return lines;
}

function track(ctx, em) { if ('letterSpacing' in ctx) ctx.letterSpacing = em; }

async function renderCover() {
    await Promise.all([
        document.fonts.load('700 100px "Space Grotesk"'),
        document.fonts.load('500 100px "Space Grotesk"'),
        document.fonts.load('600 20px "IBM Plex Mono"'),
        document.fonts.load('400 20px "IBM Plex Mono"')
    ]);
    const T = coverTokens();
    const theme = palette.theme;
    const keys = ROLE_KEYS[Object.keys(theme).length];
    const names = ROLE_NAMES[keys.length];
    const accNo = document.getElementById('acc-no').textContent;
    const filed = accNo && accNo !== '—';
    const date = document.getElementById('mast-date').textContent;
    const issue = document.getElementById('reg-total').textContent;
    const W = COVER_W, H = COVER_H, M = COVER_M;

    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = T.paper;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';

    // Registration mark, top-left: ink with the signal plate a hair off register
    const reg = (x, y, col, dx) => {
        ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x + dx, y + dx, 9, 0, Math.PI * 2);
        ctx.moveTo(x - 16 + dx, y + dx); ctx.lineTo(x + 16 + dx, y + dx);
        ctx.moveTo(x + dx, y - 16 + dx); ctx.lineTo(x + dx, y + 16 + dx); ctx.stroke();
    };
    reg(40, 40, T.signal, 1.5); reg(40, 40, T.ink, 0);

    // Masthead line
    ctx.fillStyle = T.ink;
    ctx.font = '600 17px "IBM Plex Mono"'; track(ctx, '0.12em');
    ctx.fillText(`VOL. 01 — ${T.night ? 'NIGHT' : 'DAY'} EDITION`, M, 104);
    ctx.textAlign = 'center'; ctx.fillText(`ISSUE ${issue}`, W / 2, 104); ctx.textAlign = 'left';
    ctx.textAlign = 'right'; ctx.fillText(date, W - M, 104); ctx.textAlign = 'left';
    ctx.fillRect(M, 122, W - 2 * M, 1);

    // Nameplate with the off-register plate, sized to leave room for EXTRACTOR
    const sideW = 260;
    let plate = 262;
    track(ctx, '-0.065em');
    ctx.font = `700 ${plate}px "Space Grotesk"`;
    while (ctx.measureText('PALETTE').width > W - 2 * M - sideW - 24 && plate > 120) {
        plate -= 4;
        ctx.font = `700 ${plate}px "Space Grotesk"`;
    }
    ctx.fillStyle = T.signal; ctx.fillText('PALETTE', M - 6 + plate * 0.035, 352 + plate * 0.025);
    ctx.fillStyle = T.ink; ctx.fillText('PALETTE', M - 6, 352);
    ctx.textAlign = 'right';
    ctx.font = '700 46px "Space Grotesk"'; track(ctx, '-0.03em');
    ctx.fillText('EXTRACTOR', W - M, 318);
    ctx.font = '600 15px "IBM Plex Mono"'; track(ctx, '0.12em');
    ctx.fillText('A REGISTER OF COLOUR', W - M, 348);
    ctx.textAlign = 'left';
    ctx.fillRect(M, 384, W - 2 * M, 7);
    ctx.fillRect(M, 397, W - 2 * M, 1.5);

    // Fig. 1 — the source, contained, with signal corner brackets
    const box = { x: M, y: 440, w: 620, h: 620 };
    const img = await coverSource();
    ctx.fillStyle = T.night ? 'rgba(245,240,232,0.05)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    let r = box;
    if (img) {
        const s = Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight);
        const w = img.naturalWidth * s, h = img.naturalHeight * s;
        r = { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
        ctx.drawImage(img, r.x, r.y, w, h);
    } else {
        // No image kept: the palette itself, as vertical bands
        keys.forEach((key, i) => {
            ctx.fillStyle = theme[key];
            ctx.fillRect(box.x + (box.w / keys.length) * i, box.y, box.w / keys.length + 1, box.h);
        });
    }
    ctx.strokeStyle = T.signal; ctx.lineWidth = 3;
    const arm = 30, pad = -8;
    [[r.x + pad, r.y + pad, 1, 1], [r.x + r.w - pad, r.y + pad, -1, 1], [r.x + pad, r.y + r.h - pad, 1, -1], [r.x + r.w - pad, r.y + r.h - pad, -1, -1]]
        .forEach(([x, y, sx, sy]) => { ctx.beginPath(); ctx.moveTo(x + sx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * arm); ctx.stroke(); });
    ctx.font = '600 15px "IBM Plex Mono"'; track(ctx, '0.04em');
    ctx.fillStyle = T.signalInk; ctx.fillText('FIG. 1', M, box.y + box.h + 34);
    ctx.fillStyle = T.ink;
    ctx.fillText(img && currentImgEl ? `Source, ${currentImgEl.naturalWidth} × ${currentImgEl.naturalHeight} px.` : img ? 'Source, as archived.' : 'No image kept — the palette as bands.', M + 72, box.y + box.h + 34);

    // Opener column: kicker, colour rule, headline, standfirst
    const colX = box.x + box.w + 48, colW = W - M - colX;
    let y = box.y + 14;
    ctx.font = '600 16px "IBM Plex Mono"'; track(ctx, '0.12em');
    ctx.fillStyle = T.signalInk; ctx.fillText(filed ? `ACCESSION — ${accNo}` : 'DEFAULT PALETTE', colX, y);
    y += 30;
    ctx.fillStyle = theme.primary; ctx.fillRect(colX, y, 84, 12);
    y += 30;
    const headline = ntc.name(theme.primary)[1].toUpperCase();
    ctx.fillStyle = T.ink; track(ctx, '-0.05em');
    let size = 92;
    ctx.font = `700 ${size}px "Space Grotesk"`;
    let lines = wrapLines(ctx, headline, colW);
    while (lines.length > 3 && size > 54) { size -= 6; ctx.font = `700 ${size}px "Space Grotesk"`; lines = wrapLines(ctx, headline, colW); }
    for (const line of lines) { y += size * 0.9; ctx.fillText(line, colX, y); }
    y += 40;
    ctx.font = '500 23px "Space Grotesk"'; track(ctx, '-0.01em');
    const stand = document.getElementById('feature-standfirst').textContent;
    for (const line of wrapLines(ctx, stand, colW)) { y += 32; ctx.fillText(line, colX, y); }

    // Spec rows, ruled
    y = box.y + box.h - 4 * 40;
    const spec = [
        ['RECEIVED', document.getElementById('acc-date').textContent],
        ['MEDIUM', document.getElementById('acc-medium').textContent],
        ['CONDITION', document.getElementById('acc-condition').textContent],
        ['STATUS', filed ? 'FILED' : 'DEFAULT']
    ];
    ctx.font = '600 14px "IBM Plex Mono"'; track(ctx, '0.08em');
    for (const [k, val] of spec) {
        ctx.fillStyle = T.ink; ctx.globalAlpha = 0.25; ctx.fillRect(colX, y, colW, 1); ctx.globalAlpha = 1;
        ctx.globalAlpha = 0.55; ctx.fillText(k, colX, y + 26); ctx.globalAlpha = 1;
        ctx.fillText(val, colX + 132, y + 26);
        y += 40;
    }

    // Specimen: the palette as plates
    const sy = 1140, sh = 250, sw = (W - 2 * M) / keys.length;
    keys.forEach((key, i) => {
        const hex = theme[key], x = M + sw * i;
        ctx.fillStyle = hex; ctx.fillRect(x, sy, sw, sh);
        const on = inkOn(hex);
        ctx.fillStyle = on;
        ctx.font = '700 26px "Space Grotesk"'; track(ctx, '-0.01em');
        ctx.fillText(names[i], x + 20, sy + 44);
        ctx.fillRect(x + 20, sy + 58, sw - 40, 2);
        ctx.font = '600 24px "IBM Plex Mono"'; track(ctx, '0');
        ctx.fillText(hex, x + 20, sy + sh - 74);
        ctx.font = '400 15px "IBM Plex Mono"';
        ctx.fillText(ntc.name(hex)[1].toUpperCase().slice(0, 18), x + 20, sy + sh - 46);
        ctx.font = '400 13px "IBM Plex Mono"';
        ctx.fillText(oklchLine(hex), x + 20, sy + sh - 22);
    });
    ctx.strokeStyle = T.ink; ctx.lineWidth = 2;
    ctx.strokeRect(M, sy, W - 2 * M, sh);
    for (let i = 1; i < keys.length; i++) ctx.fillRect(M + sw * i - 1, sy, 2, sh);

    // Footer
    ctx.fillStyle = T.ink;
    ctx.font = '600 15px "IBM Plex Mono"'; track(ctx, '0.12em');
    ctx.fillText('PALETTE.ETARC.NET', M, H - 52);
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.6;
    ctx.fillText('OKLAB · SALIENCY · SUBMODULAR SELECTION', W - M, H - 52);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
    return { canvas: c, name: `palette-${filed ? accNo : 'default'}-${T.night ? 'night' : 'day'}.png` };
}

// Take over SAVE IMG before main.js's own listener sees the click
document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('#btn-export-image');
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    const label = btn.textContent;
    btn.textContent = 'PRINTING…';
    renderCover().then(({ canvas, name }) => {
        canvas.toBlob(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            btn.textContent = 'SAVED';
            setTimeout(() => { btn.textContent = label; }, 1600);
        }, 'image/png');
    }, () => { btn.textContent = label; });
}, true);
