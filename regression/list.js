// Real-world regression images for gallery.html, paths relative to this folder.
// Canvas can't read pixels of file:// images, so serve the repo first:
//   npm run serve   →   /regression/gallery.html
// Photos: picsum.photos (Unsplash licence), id in brackets. The last two were made locally.
window.REGRESSION_IMAGES = [
    'neon-city.jpg',              // [274] dark, many vivid small lights
    'concert-dark-blue.jpg',      // [452] near-black with one coloured light
    'black-dog-wood.jpg',         // [237] dark subject on textured mid-tone
    'dark-desert-gradient.jpg',   // [184] smooth dark gradient
    'white-minimal-desk.jpg',     // [119] light, almost no chroma
    'daisy-bright.jpg',           // [798] white field, small yellow centre
    'bw-keyboard.jpg',            // [366] true monochrome
    'golden-fog-mono.jpg',        // [943] single warm hue, low contrast
    'jellyfish-tiny-accent.jpg',  // [1069] blue field, tiny orange accent
    'strawberries-one-hue.jpg',   // [1080] one dominant saturated hue
    'canyon-warm.jpg',            // [564] saturated warm gradient
    'yellow-garage.jpg',          // [133] flat vivid blocks + photo detail
    'pastel-blossom.jpg',         // [82] pastel pink / teal bokeh
    'flat-illustration.png',      // flat vector art, exact colours
    'ui-screenshot-light.png',    // this app's own UI: light zine page
];
