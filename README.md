# Palette Extractor

**Photo in, usable UI theme out.** Drop or paste an image and get a palette where every colour has a job — background, text, primary, accent — with contrast already checked.

Live: [palette.etarc.net](https://palette.etarc.net)

<!-- TODO: add a screenshot or GIF here -->

## What makes it different

- **Roles, not just swatches.** Colours are assigned to roles (BASE, TEXT, PRIMARY, ACCENT…) by scoring every possible assignment, so the background is the largest calm colour and the primary is the most vivid one.
- **Contrast repair.** If TEXT or PRIMARY is too faint against BASE, only its lightness is moved (hue kept), and the swatch says it was adjusted.
- **Real colours only.** Clusters are computed in OKLab, then snapped to the nearest colour that actually exists in the image — no averaged mud.
- **Accessibility built in.** WCAG 2.1 and APCA contrast matrix, protan/deutan/tritan simulation with collision warnings, one-click light/dark theme.
- **Reproducible.** Seeded k-means: same image + seed = same palette. REROLL tries the next seed.

## Features

- Drag & drop, paste (⌘/Ctrl+V), or drag a box on the image to extract from a region
- 3–8 colours, with the k-means iterations animated live
- Export: CSS variables (light + dark, hex with OKLCH fallback), Tailwind config with 50–950 scales, Figma tokens, PNG
- Shareable link, history and favourites (stored in your browser)

## Run locally

No build step, no dependencies.

```sh
python3 -m http.server
# open http://localhost:8000
```

## Tests

```sh
node --test test/color.test.js   # unit tests for the colour logic
```

`gallery.html` runs the extractor over 15 hard real-world images (`regression/`) plus synthetic cases. Save a baseline, change the algorithm, refresh — every role whose colour moved is outlined.

## Files

| File | Purpose |
| --- | --- |
| `color.js` | All colour logic (OKLab, k-means, roles, contrast, CVD, APCA). No DOM. |
| `main.js` | The app UI |
| `gallery.html` / `gallery.js` | Regression gallery |
| `ntc.js` | Colour naming ("Name that Color") |
