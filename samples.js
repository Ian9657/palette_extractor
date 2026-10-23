// Sample objects under Fig. 1: six Unsplash photographs (via Lorem Picsum),
// kept at 1920 × 1440 in samples/ so the proof has detail to draw from,
// that can be deposited with one click, exactly as if dropped.
(() => {
    const row = document.getElementById('samples');
    let picked = null;   // the sample being deposited; any other deposit clears the mark
    const prevProcess = processImage;
    processImage = function (file) {
        row.querySelectorAll('.sample').forEach(b => b.classList.toggle('current', b === picked));
        picked = null;
        prevProcess(file);
    };
    row.querySelectorAll('.sample').forEach(btn => {
        const { src, thumb, id, name } = btn.dataset;
        btn.style.backgroundImage = `url("${thumb || src}")`;   // small copy; the full size loads on deposit
        btn.title = `${name} — Unsplash, Picsum ${id}`;
        btn.setAttribute('aria-label', `Deposit sample: ${name}`);
        btn.addEventListener('click', async () => {
            const blob = await (await fetch(src)).blob();
            picked = btn;
            processImage(new File([blob], src.split('/').pop(), { type: blob.type }));
        });
    });
})();
