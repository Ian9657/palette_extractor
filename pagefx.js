// Page-wide effects in the Edgerunners idiom: short, hard, and only on an
// event. At rest the page is unchanged (DESIGN.md §3.3, §7).
//   Title card  — each entry, the first time it scrolls in: the numeral
//                 decodes, the heading is cut in on a yellow card
//   Sandevistan — a new palette arrives in COLOR BAR in steps, leaving one
//                 afterimage per colour, which then drop out one by one
//   Fringe      — a hard RGB split on the control that was pressed
(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const root = document.documentElement;
    root.classList.add('fx-cards');

    // ---- Title cards ----
    const entries = [...document.querySelectorAll('.register > .entry')];
    const cards = new IntersectionObserver(seen => {
        for (const s of seen) {
            if (!s.isIntersecting) continue;
            cards.unobserve(s.target);
            playCard(s.target);
        }
    }, { rootMargin: '0px 0px -15% 0px' });
    entries.forEach(e => cards.observe(e));

    function playCard(entry) {
        const no = entry.querySelector('.entry-no');
        const label = entry.querySelector('.entry-label');
        const heading = entry.querySelector('.entry-body > .section-header h2');
        entry.classList.add('carded');
        if (no) { FX.decode(no, no.textContent, 260); FX.split(no, 240); }
        if (label) setTimeout(() => FX.decode(label, label.textContent, 300), 60);
        if (heading) heading.classList.add('card');
    }

    // ---- Sandevistan: COLOR BAR ----
    const bar = document.getElementById('palette-container');
    const STEP = 40, GAP = 18, MAX_ECHOES = 4;
    let echoTimer = null, lastTheme = '';

    // The most vivid colours make the clearest afterimages
    const chroma = hex => toLch(hexToRgb(hex)).C;

    // Echoes sit beside the bar (not inside it), so they stay where it was
    function sandevistan(theme) {
        clearInterval(echoTimer);
        document.querySelectorAll('.echo').forEach(e => e.remove());
        bar.style.translate = '';
        const host = bar.offsetParent || document.body;
        const inks = Object.values(theme).sort((a, b) => chroma(b) - chroma(a));
        const n = Math.min(MAX_ECHOES, inks.length);
        const echoes = inks.slice(0, n).map((c, i) => {
            const e = document.createElement('span');
            e.className = 'echo';
            e.setAttribute('aria-hidden', 'true');
            Object.assign(e.style, {
                background: c,
                left: bar.offsetLeft - (n - i) * GAP + 'px',
                top: bar.offsetTop + 'px',
                width: bar.offsetWidth + 'px',
                height: bar.offsetHeight + 'px',
            });
            e.hidden = true;
            host.appendChild(e);
            return e;
        });
        // Frames 0..n: the bar moves in a GAP at a time, leaving an echo where
        // it was; frames n+1..2n: the echoes drop out, farthest first
        let f = 0;
        const frame = () => {
            if (f <= n) {
                bar.style.translate = `${-(n - f) * GAP}px 0`;
                if (f > 0) echoes[f - 1].hidden = false;
            } else if (f <= 2 * n) {
                echoes[f - n - 1].remove();
            } else {
                clearInterval(echoTimer);
                bar.style.translate = '';
            }
            f++;
        };
        frame();
        echoTimer = setInterval(frame, STEP);
    }

    // ---- Plates: re-inked one at a time, front to back ----
    // Each plate keeps its old ink until its turn, then takes the new one in a
    // hard cut and kicks out for two frames, like a press laying down a plate.
    const platesEl = document.querySelector('.plates');
    let inkTimers = [];

    function inkPlates(oldInks) {
        inkTimers.forEach(clearTimeout);
        const plates = [...platesEl.children];
        plates.forEach((p, i) => {
            p.classList.remove('kick');
            if (oldInks[i]) p.style.background = oldInks[i];
            inkTimers.push(setTimeout(() => {
                p.style.background = '';
                p.classList.add('kick');
            }, i * STEP));
            inkTimers.push(setTimeout(() => p.classList.remove('kick'), i * STEP + 2 * STEP));
        });
    }

    const prevSetPaletteFx = setPalette;
    setPalette = function (next, saveToHistory = false) {
        const oldInks = [...platesEl.children].map(p => p.style.getPropertyValue('--plate'));
        prevSetPaletteFx(next, saveToHistory);
        const key = Object.values(next.theme).join();
        if (!next.isDefault && key !== lastTheme) {
            sandevistan(next.theme);
            inkPlates(oldInks);
        }
        lastTheme = key;
    };
    lastTheme = Object.values(palette.theme).join();

    // ---- Fringe on pressed controls ----
    document.addEventListener('click', e => {
        const btn = e.target.closest && e.target.closest('.btn-export');
        if (btn) FX.split(btn, 200);
    });
    const kLabel = document.querySelector('label[for="k-slider"]');
    document.getElementById('k-slider').addEventListener('change', () => FX.split(kLabel, 200));
})();
