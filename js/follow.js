// Delayed cursor follow, shared by every floating element on the page.
// Each element eases toward the pointer with  pos += (target - pos) / delay,
// so a larger delay trails further behind. One rAF loop drives them all.
// No dependencies; desktop pointers only (touch has no hover to follow).
const Follow = (() => {
    const DELAY = { slow: 12, mid: 7, fast: 5 };
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const items = [];
    let mx = innerWidth / 2, my = innerHeight / 2, running = false;

    window.addEventListener('pointermove', e => {
        if (e.pointerType !== 'mouse') return;
        mx = e.clientX; my = e.clientY;
        if (!running) { running = true; requestAnimationFrame(tick); }
    });

    function tick() {
        let moving = false;
        for (const it of items) {
            const d = still ? 1 : it.delay;
            it.x += (mx - it.x) / d;
            it.y += (my - it.y) / d;
            it.el.style.translate = `${it.x.toFixed(1)}px ${it.y.toFixed(1)}px`;
            if (Math.abs(mx - it.x) + Math.abs(my - it.y) > 0.3) moving = true;
        }
        running = moving;
        if (moving) requestAnimationFrame(tick);
    }

    // Start at the pointer so a newly shown element doesn't fly in from a corner
    function track(el, delay = DELAY.slow) {
        items.push({ el, delay, x: mx, y: my });
    }
    function snap() {
        for (const it of items) { it.x = mx; it.y = my; }
    }

    return { DELAY, enabled: fine, track, snap };
})();
