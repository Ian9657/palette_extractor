// Real-world regression images for gallery.html, paths relative to the project root.
// Canvas can't read pixels of file:// images, so serve the folder first:
//   python3 -m http.server   →   http://localhost:8000/gallery.html
// Photos: picsum.photos (Unsplash licence), id in brackets. The last two were made locally.
window.REGRESSION_IMAGES = [
    'regression/neon-city.jpg',              // [274] dark, many vivid small lights
    'regression/concert-dark-blue.jpg',      // [452] near-black with one coloured light
    'regression/black-dog-wood.jpg',         // [237] dark subject on textured mid-tone
    'regression/dark-desert-gradient.jpg',   // [184] smooth dark gradient
    'regression/white-minimal-desk.jpg',     // [119] light, almost no chroma
    'regression/daisy-bright.jpg',           // [798] white field, small yellow centre
    'regression/bw-keyboard.jpg',            // [366] true monochrome
    'regression/golden-fog-mono.jpg',        // [943] single warm hue, low contrast
    'regression/jellyfish-tiny-accent.jpg',  // [1069] blue field, tiny orange accent
    'regression/strawberries-one-hue.jpg',   // [1080] one dominant saturated hue
    'regression/canyon-warm.jpg',            // [564] saturated warm gradient
    'regression/yellow-garage.jpg',          // [133] flat vivid blocks + photo detail
    'regression/pastel-blossom.jpg',         // [82] pastel pink / teal bokeh
    'regression/flat-illustration.png',      // flat vector art, exact colours
    'regression/ui-screenshot-light.png',    // this app's own UI: light zine page
];
