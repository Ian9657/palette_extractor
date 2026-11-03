// Screen-signal effects for the "virtual" objects only (lens, scan, floating
// previews). The printed page never uses these.
//   decode(el, text) — glyphs resolve left to right into the text
//   split(el)        — a brief RGB channel split (needs the #rgb-split SVG filter)
const FX = (() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const GLYPHS = '01#%&*+=/<>[]';
    const jobs = new WeakMap();

    function decode(el, text, ms = 320) {
        cancelAnimationFrame(jobs.get(el));
        if (still) { el.textContent = text; return; }
        const start = performance.now();
        const step = t => {
            const p = Math.min(1, (t - start) / ms);
            const fixed = Math.floor(p * text.length);
            let out = text.slice(0, fixed);
            for (let i = fixed; i < text.length; i++) {
                out += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
            }
            el.textContent = out;
            if (p < 1) jobs.set(el, requestAnimationFrame(step));
        };
        jobs.set(el, requestAnimationFrame(step));
    }

    const timers = new WeakMap();
    function split(el, ms = 280) {
        if (still) return;
        el.classList.remove('fx-split');
        void el.offsetWidth;   // restart the animation
        el.classList.add('fx-split');
        clearTimeout(timers.get(el));
        timers.set(el, setTimeout(() => el.classList.remove('fx-split'), ms));
    }

    return { decode, split };
})();
