// worker.js
function rgbToOklab(r, g, b) {
    // Convert to linear sRGB
    let r_l = (r / 255);
    let g_l = (g / 255);
    let b_l = (b / 255);
    
    r_l = r_l > 0.04045 ? Math.pow((r_l + 0.055) / 1.055, 2.4) : r_l / 12.92;
    g_l = g_l > 0.04045 ? Math.pow((g_l + 0.055) / 1.055, 2.4) : g_l / 12.92;
    b_l = b_l > 0.04045 ? Math.pow((b_l + 0.055) / 1.055, 2.4) : b_l / 12.92;

    let l = 0.4122214708 * r_l + 0.5363325363 * g_l + 0.0514459929 * b_l;
    let m = 0.2119034982 * r_l + 0.6806995451 * g_l + 0.1073969566 * b_l;
    let s = 0.0883024619 * r_l + 0.2817188376 * g_l + 0.6299787005 * b_l;

    let l_ = Math.cbrt(Math.max(0, l));
    let m_ = Math.cbrt(Math.max(0, m));
    let s_ = Math.cbrt(Math.max(0, s));

    return {
        L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    };
}

function colorDistanceOklab(c1, c2) {
    return Math.sqrt(
        Math.pow(c1.L - c2.L, 2) +
        Math.pow(c1.a - c2.a, 2) +
        Math.pow(c1.b - c2.b, 2)
    );
}

function initializeCentroidsKMeansPlusPlus(pixels, k) {
    const centroids = [pixels[Math.floor(Math.random() * pixels.length)]];
    for (let i = 1; i < k; i++) {
        let maxDist = -1;
        let nextCentroid = null;
        for (const pixel of pixels) {
            let minDistToCentroids = Math.min(...centroids.map(c => colorDistanceOklab(pixel.oklab, c.oklab)));
            if (minDistToCentroids > maxDist) {
                maxDist = minDistToCentroids;
                nextCentroid = pixel;
            }
        }
        centroids.push(nextCentroid);
    }
    return centroids;
}

self.onmessage = function(e) {
    const { pixels: rawPixels, k, iterations = 15 } = e.data;
    
    // Precompute Oklab for all pixels
    const pixels = rawPixels.map(p => ({
        r: p.r, g: p.g, b: p.b,
        oklab: rgbToOklab(p.r, p.g, p.b)
    }));

    let centroids = initializeCentroidsKMeansPlusPlus(pixels, k);
    
    for (let iter = 0; iter < iterations; iter++) {
        const clusters = Array.from({ length: k }, () => []);
        
        for (const pixel of pixels) {
            let minDist = Infinity;
            let clusterIdx = 0;
            for (let j = 0; j < k; j++) {
                const dist = colorDistanceOklab(pixel.oklab, centroids[j].oklab);
                if (dist < minDist) {
                    minDist = dist;
                    clusterIdx = j;
                }
            }
            clusters[clusterIdx].push(pixel);
        }
        
        centroids = clusters.map((cluster, j) => {
            if (cluster.length === 0) return centroids[j];
            const sum = cluster.reduce((acc, p) => ({
                r: acc.r + p.r,
                g: acc.g + p.g,
                b: acc.b + p.b
            }), { r: 0, g: 0, b: 0 });
            const r = Math.round(sum.r / cluster.length);
            const g = Math.round(sum.g / cluster.length);
            const b = Math.round(sum.b / cluster.length);
            return {
                r, g, b, oklab: rgbToOklab(r, g, b)
            };
        });
    }
    
    self.postMessage(centroids.map(c => ({r: c.r, g: c.g, b: c.b})));
};
