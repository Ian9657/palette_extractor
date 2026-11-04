// The pixels a palette is read from, the same in every browser.
//
// Browsers disagree twice: drawImage downscales differently (up to 198 levels
// on one channel between Chromium and WebKit), and their JPEG decoders do too
// (0.2 levels on average, up to 70). That is enough to change a palette, and
// its roles. So JPEGs are decoded here in integer arithmetic and every image
// is downscaled here by area averaging: the same file gives the same bytes,
// hence the same record, whichever browser reads it.
//
// PNG decoders already agree, so other formats still decode in the browser.
// Anything this decoder does not handle (CMYK, 12-bit, arithmetic coding, LUT
// colour profiles, a corrupt stream) returns null and takes that route too.
//
// Pure: no DOM except readPixels at the bottom. Node tests require this file.

const ZIGZAG = new Uint8Array([
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63
]);

// ---- Huffman tables ----
// fast: the next 9 bits → length << 8 | symbol, or −1 for a longer code
function buildHuffman(counts, symbols) {
    const fast = new Int16Array(512).fill(-1);
    const maxCode = new Int32Array(18), valOffset = new Int32Array(17);
    let code = 0, k = 0;
    for (let len = 1; len <= 16; len++) {
        valOffset[len] = k - code;
        for (let i = 0; i < counts[len - 1]; i++, k++, code++) {
            if (len <= 9) {
                const low = code << (9 - len), n = 1 << (9 - len);
                for (let j = 0; j < n; j++) fast[low + j] = len << 8 | symbols[k];
            }
        }
        maxCode[len] = code << (16 - len);
        code <<= 1;
    }
    return { fast, maxCode, valOffset, symbols };
}

// ---- One scan's entropy-coded data ----
// Past the end of the data (a marker or the end of a truncated file) it reads
// zeros, as libjpeg does, so a damaged image still gives pixels.
function bitReader(data, start) {
    let pos = start, buf = 0, cnt = 0;
    const fill = () => {
        while (cnt <= 16) {
            let byte = 0;
            if (pos < data.length) {
                byte = data[pos];
                if (byte === 0xFF) {
                    if (data[pos + 1] === 0) pos += 2;
                    else byte = 0;   // a marker: stay on it
                } else pos++;
            }
            buf = (buf << 8 | byte) & 0x3FFFFFF;
            cnt += 8;
        }
    };
    const bits = n => {
        if (n === 0) return 0;
        if (cnt < n) fill();
        cnt -= n;
        return (buf >>> cnt) & ((1 << n) - 1);
    };
    return {
        bits,
        huff(t) {
            if (cnt < 16) fill();
            const look = (buf >>> (cnt - 9)) & 511, f = t.fast[look];
            if (f >= 0) { cnt -= f >> 8; return f & 255; }
            const top = (buf >>> (cnt - 16)) & 0xFFFF;
            for (let len = 10; len <= 16; len++) {
                if (top < t.maxCode[len]) {
                    cnt -= len;
                    return t.symbols[(top >>> (16 - len)) + t.valOffset[len]];
                }
            }
            cnt -= 16;
            return 0;
        },
        // Drop what is buffered and step over the next restart marker, if any
        restart() {
            buf = 0; cnt = 0;
            while (pos + 1 < data.length) {
                if (data[pos] === 0xFF && data[pos + 1] !== 0 && data[pos + 1] !== 0xFF) {
                    if (data[pos + 1] >= 0xD0 && data[pos + 1] <= 0xD7) { pos += 2; return true; }
                    return false;
                }
                pos++;
            }
            return false;
        },
        get pos() { return pos; }
    };
}

const extend = (v, n) => (n && v < (1 << (n - 1)) ? v - (1 << n) + 1 : v);

// Next marker at or after pos (entropy data and restart markers are skipped)
function nextMarker(data, pos) {
    while (pos + 1 < data.length) {
        if (data[pos] === 0xFF) {
            const m = data[pos + 1];
            if (m !== 0 && m !== 0xFF && !(m >= 0xD0 && m <= 0xD7)) return pos;
        }
        pos++;
    }
    return data.length;
}

function decodeScan(data, start, frame, scanComps, ss, se, ah, al, restartInterval) {
    const r = bitReader(data, start);
    const dcOnly = frame.dcOnly;
    let eobrun = 0;

    function block(c, row, col) {
        const at = row * c.stride + col;
        const o = dcOnly ? at : at * 64;
        const coef = c.coef;
        if (!frame.progressive) {
            const t = r.huff(c.dcTable);
            c.pred += t ? extend(r.bits(t), t) : 0;
            coef[o] = c.pred;
            for (let k = 1; k < 64;) {
                const rs = r.huff(c.acTable), s = rs & 15, z = rs >> 4;
                if (!s) { if (z < 15) break; k += 16; continue; }
                k += z;
                const v = extend(r.bits(s), s);
                if (!dcOnly && k < 64) coef[o + ZIGZAG[k]] = v;
                k++;
            }
        } else if (ss === 0) {
            if (ah === 0) {
                const t = r.huff(c.dcTable);
                c.pred += t ? extend(r.bits(t), t) : 0;
                coef[o] = c.pred * (1 << al);
            } else if (r.bits(1)) coef[o] |= 1 << al;
        } else if (ah === 0) {
            if (eobrun > 0) { eobrun--; return; }
            for (let k = ss; k <= se;) {
                const rs = r.huff(c.acTable), s = rs & 15, z = rs >> 4;
                if (!s) {
                    if (z < 15) { eobrun = (1 << z) - 1 + r.bits(z); break; }
                    k += 16;
                    continue;
                }
                k += z;
                const v = extend(r.bits(s), s);
                if (k < 64) coef[o + ZIGZAG[k]] = v * (1 << al);
                k++;
            }
        } else {
            const p1 = 1 << al, m1 = -1 << al;
            const refine = q => {
                if (r.bits(1) && (coef[q] & p1) === 0) coef[q] += coef[q] >= 0 ? p1 : m1;
            };
            let k = ss;
            if (eobrun === 0) {
                for (; k <= se; k++) {
                    const rs = r.huff(c.acTable), s = rs & 15;
                    let z = rs >> 4, val = 0;
                    if (s) val = r.bits(1) ? p1 : m1;
                    else if (z < 15) { eobrun = (1 << z) + r.bits(z); break; }
                    for (; k <= se; k++) {
                        const q = o + ZIGZAG[k];
                        if (coef[q] !== 0) refine(q);
                        else if (--z < 0) break;
                    }
                    if (val && k <= se) coef[o + ZIGZAG[k]] = val;
                }
            }
            if (eobrun > 0) {
                for (; k <= se; k++) {
                    const q = o + ZIGZAG[k];
                    if (coef[q] !== 0) refine(q);
                }
                eobrun--;
            }
        }
    }

    const single = scanComps.length === 1;
    const c0 = scanComps[0];
    const total = single ? c0.blocksX * c0.blocksY : frame.mcusX * frame.mcusY;
    const perRow = single ? c0.blocksX : frame.mcusX;
    for (let m = 0; m < total; m++) {
        if (restartInterval && m > 0 && m % restartInterval === 0) {
            if (!r.restart()) break;
            eobrun = 0;
            for (const c of scanComps) c.pred = 0;
        }
        const row = Math.floor(m / perRow), col = m % perRow;
        if (single) block(c0, row, col);
        else for (const c of scanComps) {
            for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) block(c, row * c.v + v, col * c.h + h);
        }
    }
    return r.pos;
}

// ---- Inverse DCT ----
// Fixed point (the Loeffler factorisation, constants × 4096), so no rounding
// depends on the engine's floats.
function idct(coef, o, q, out, stride, at, tmp) {
    for (let i = 0; i < 8; i++) {
        const s0 = coef[o + i] * q[i], s1 = coef[o + 8 + i] * q[8 + i], s2 = coef[o + 16 + i] * q[16 + i], s3 = coef[o + 24 + i] * q[24 + i];
        const s4 = coef[o + 32 + i] * q[32 + i], s5 = coef[o + 40 + i] * q[40 + i], s6 = coef[o + 48 + i] * q[48 + i], s7 = coef[o + 56 + i] * q[56 + i];
        let p1 = (s2 + s6) * 2217, t2 = p1 + s6 * -7567, t3 = p1 + s2 * 3135;
        let t0 = (s0 + s4) * 4096, t1 = (s0 - s4) * 4096;
        const x0 = t0 + t3 + 512, x3 = t0 - t3 + 512, x1 = t1 + t2 + 512, x2 = t1 - t2 + 512;
        t0 = s7; t1 = s5; t2 = s3; t3 = s1;
        let p3 = t0 + t2, p4 = t1 + t3, p2 = t1 + t2;
        p1 = t0 + t3;
        const p5 = (p3 + p4) * 4816;
        t0 *= 1223; t1 *= 8410; t2 *= 12586; t3 *= 6149;
        p1 = p5 + p1 * -3685; p2 = p5 + p2 * -10497; p3 *= -8034; p4 *= -1597;
        t3 += p1 + p4; t2 += p2 + p3; t1 += p2 + p4; t0 += p1 + p3;
        tmp[i] = (x0 + t3) >> 10; tmp[56 + i] = (x0 - t3) >> 10;
        tmp[8 + i] = (x1 + t2) >> 10; tmp[48 + i] = (x1 - t2) >> 10;
        tmp[16 + i] = (x2 + t1) >> 10; tmp[40 + i] = (x2 - t1) >> 10;
        tmp[24 + i] = (x3 + t0) >> 10; tmp[32 + i] = (x3 - t0) >> 10;
    }
    for (let i = 0; i < 8; i++) {
        const j = i * 8, a = at + i * stride;
        const s0 = tmp[j], s1 = tmp[j + 1], s2 = tmp[j + 2], s3 = tmp[j + 3], s4 = tmp[j + 4], s5 = tmp[j + 5], s6 = tmp[j + 6], s7 = tmp[j + 7];
        let p1 = (s2 + s6) * 2217, t2 = p1 + s6 * -7567, t3 = p1 + s2 * 3135;
        let t0 = (s0 + s4) * 4096, t1 = (s0 - s4) * 4096;
        const bias = 65536 + (128 << 17);
        const x0 = t0 + t3 + bias, x3 = t0 - t3 + bias, x1 = t1 + t2 + bias, x2 = t1 - t2 + bias;
        t0 = s7; t1 = s5; t2 = s3; t3 = s1;
        let p3 = t0 + t2, p4 = t1 + t3, p2 = t1 + t2;
        p1 = t0 + t3;
        const p5 = (p3 + p4) * 4816;
        t0 *= 1223; t1 *= 8410; t2 *= 12586; t3 *= 6149;
        p1 = p5 + p1 * -3685; p2 = p5 + p2 * -10497; p3 *= -8034; p4 *= -1597;
        t3 += p1 + p4; t2 += p2 + p3; t1 += p2 + p4; t0 += p1 + p3;
        out[a] = (x0 + t3) >> 17; out[a + 7] = (x0 - t3) >> 17;
        out[a + 1] = (x1 + t2) >> 17; out[a + 6] = (x1 - t2) >> 17;
        out[a + 2] = (x2 + t1) >> 17; out[a + 5] = (x2 - t1) >> 17;
        out[a + 3] = (x3 + t0) >> 17; out[a + 4] = (x3 - t0) >> 17;
    }
}

// ---- Metadata ----
function exifOrientation(d, o, end) {
    if (end - o < 14 || String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]) !== 'Exif') return 1;
    const t = o + 6, le = d[t] === 0x49;
    const u16 = p => (le ? d[p] | d[p + 1] << 8 : d[p] << 8 | d[p + 1]);
    const u32 = p => (le ? (d[p] | d[p + 1] << 8 | d[p + 2] << 16 | d[p + 3] << 24) : (d[p] << 24 | d[p + 1] << 16 | d[p + 2] << 8 | d[p + 3])) >>> 0;
    const ifd = t + u32(t + 4);
    if (ifd + 2 > end) return 1;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > end) return 1;
        if (u16(e) === 0x112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
    }
    return 1;
}

// sRGB primaries adapted to D50, the space ICC profiles state theirs in
const SRGB_D50 = [[0.4360747, 0.3850649, 0.1430804], [0.2225045, 0.7168786, 0.0606169], [0.0139322, 0.0971045, 0.7141733]];
const D50_TO_SRGB = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.0334540], [0.0719453, -0.2289914, 1.4052427]];

// An ICC profile → null if it is effectively sRGB, a function converting RGBA
// in place if it is a matrix-shaper (Display P3, Adobe RGB), false otherwise
function iccConverter(p) {
    if (p.length < 132 || String.fromCharCode(p[16], p[17], p[18], p[19]) !== 'RGB ') return false;
    const u32 = o => (p[o] << 24 | p[o + 1] << 16 | p[o + 2] << 8 | p[o + 3]) >>> 0;
    const s15 = o => (u32(o) | 0) / 65536;
    const tags = {};
    for (let i = 0, n = u32(128); i < n && 144 + i * 12 <= p.length; i++) {
        const e = 132 + i * 12;
        tags[String.fromCharCode(p[e], p[e + 1], p[e + 2], p[e + 3])] = u32(e + 4);
    }
    if (tags.rXYZ === undefined || tags.gXYZ === undefined || tags.bXYZ === undefined || tags.rTRC === undefined) return false;
    const col = t => [s15(t + 8), s15(t + 12), s15(t + 16)];
    const cols = [col(tags.rXYZ), col(tags.gXYZ), col(tags.bXYZ)];
    let near = true;
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) if (Math.abs(cols[c][r] - SRGB_D50[r][c]) > 0.003) near = false;
    if (near) return null;

    const curve = t => {
        const type = String.fromCharCode(p[t], p[t + 1], p[t + 2], p[t + 3]);
        const lut = new Float64Array(256);
        if (type === 'curv') {
            const n = u32(t + 8);
            for (let i = 0; i < 256; i++) {
                const x = i / 255;
                if (n === 0) lut[i] = x;
                else if (n === 1) lut[i] = Math.pow(x, (p[t + 12] << 8 | p[t + 13]) / 256);
                else {
                    const f = x * (n - 1), a = Math.min(n - 2, Math.floor(f)), w = f - a;
                    const at = j => (p[t + 12 + j * 2] << 8 | p[t + 13 + j * 2]) / 65535;
                    lut[i] = at(a) * (1 - w) + at(a + 1) * w;
                }
            }
            return lut;
        }
        if (type !== 'para') return null;
        const fn = p[t + 8] << 8 | p[t + 9];
        if (fn > 4) return null;
        const v = i => s15(t + 12 + i * 4);
        const g = v(0), a = fn ? v(1) : 1, b = fn ? v(2) : 0, c = fn >= 2 ? v(3) : 0, d = fn >= 3 ? v(4) : (fn ? -b / a : 0);
        const e = fn === 4 ? v(5) : 0, f = fn === 4 ? v(6) : 0;
        for (let i = 0; i < 256; i++) {
            const x = i / 255;
            let y;
            if (fn === 0) y = Math.pow(x, g);
            else if (fn === 1) y = x >= d ? Math.pow(a * x + b, g) : 0;
            else if (fn === 2) y = x >= d ? Math.pow(a * x + b, g) + c : c;
            else if (fn === 3) y = x >= d ? Math.pow(a * x + b, g) : c * x;
            else y = x >= d ? Math.pow(a * x + b, g) + e : c * x + f;
            lut[i] = y;
        }
        return lut;
    };
    const trc = [curve(tags.rTRC), curve(tags.gTRC ?? tags.rTRC), curve(tags.bTRC ?? tags.rTRC)];
    if (trc.some(t => !t)) return false;
    const m = D50_TO_SRGB.map(row => [0, 1, 2].map(c => row[0] * cols[c][0] + row[1] * cols[c][1] + row[2] * cols[c][2]));
    const encode = new Uint8Array(4097);
    for (let i = 0; i <= 4096; i++) {
        const x = i / 4096;
        encode[i] = Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
    }
    const out = x => encode[x <= 0 ? 0 : x >= 1 ? 4096 : Math.round(x * 4096)];
    return data => {
        for (let i = 0; i < data.length; i += 4) {
            const r = trc[0][data[i]], g = trc[1][data[i + 1]], b = trc[2][data[i + 2]];
            data[i] = out(m[0][0] * r + m[0][1] * g + m[0][2] * b);
            data[i + 1] = out(m[1][0] * r + m[1][1] * g + m[1][2] * b);
            data[i + 2] = out(m[2][0] * r + m[2][1] * g + m[2][2] * b);
        }
    };
}

// EXIF orientation 2–8 applied to RGBA; returns { data, width, height }
function orient(src, w, h, o) {
    if (o === 1) return { data: src, width: w, height: h };
    const swap = o >= 5, W = swap ? h : w, H = swap ? w : h;
    const out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let X, Y;
            if (o === 2) { X = w - 1 - x; Y = y; }
            else if (o === 3) { X = w - 1 - x; Y = h - 1 - y; }
            else if (o === 4) { X = x; Y = h - 1 - y; }
            else if (o === 5) { X = y; Y = x; }
            else if (o === 6) { X = h - 1 - y; Y = x; }
            else if (o === 7) { X = h - 1 - y; Y = w - 1 - x; }
            else { X = y; Y = w - 1 - x; }
            const a = (y * w + x) * 4, b = (Y * W + X) * 4;
            out[b] = src[a]; out[b + 1] = src[a + 1]; out[b + 2] = src[a + 2]; out[b + 3] = src[a + 3];
        }
    }
    return { data: out, width: W, height: H };
}

// ---- The decoder ----
// bytes: Uint8Array of a JPEG. target: the longest side wanted afterwards; from
// 8× that size up, each 8×8 block's DC term stands in for its pixels, which is
// the block's mean and costs a fraction of the time and memory.
// → { data (RGBA), width, height, scale } after orientation and colour
// conversion, or null if this file should go to the browser instead.
function decodeJpeg(bytes, target) {
    try { return decodeJpegUnsafe(bytes, target || 0); } catch { return null; }
}

function decodeJpegUnsafe(d, target) {
    if (d[0] !== 0xFF || d[1] !== 0xD8) return null;
    const qt = [], dcT = [], acT = [];
    let frame = null, restartInterval = 0, orientation = 1, adobe = -1, sawScan = false;
    const iccParts = [];
    let pos = 2;
    while (pos + 1 < d.length) {
        pos = nextMarker(d, pos);
        if (pos + 1 >= d.length) break;
        const m = d[pos + 1];
        pos += 2;
        if (m === 0xD9) break;
        if (m === 0xD8) continue;
        const len = d[pos] << 8 | d[pos + 1], end = pos + len;
        if (m === 0xE1 && orientation === 1) orientation = exifOrientation(d, pos + 2, end);
        else if (m === 0xE2 && len > 16 && String.fromCharCode(...d.subarray(pos + 2, pos + 13)) === 'ICC_PROFILE') {
            iccParts[d[pos + 14]] = d.subarray(pos + 16, end);
        } else if (m === 0xEE && len >= 14 && String.fromCharCode(...d.subarray(pos + 2, pos + 7)) === 'Adobe') adobe = d[pos + 13];
        else if (m === 0xDB) {
            for (let o = pos + 2; o < end;) {
                const pt = d[o++], t = new Int32Array(64);
                for (let i = 0; i < 64; i++) {
                    if (pt >> 4) { t[ZIGZAG[i]] = d[o] << 8 | d[o + 1]; o += 2; } else t[ZIGZAG[i]] = d[o++];
                }
                qt[pt & 15] = t;
            }
        } else if (m === 0xC4) {
            for (let o = pos + 2; o < end;) {
                const th = d[o++], counts = d.subarray(o, o + 16);
                o += 16;
                let n = 0;
                for (let i = 0; i < 16; i++) n += counts[i];
                const table = buildHuffman(counts, d.subarray(o, o + n));
                o += n;
                (th >> 4 ? acT : dcT)[th & 15] = table;
            }
        } else if (m === 0xDD) restartInterval = d[pos + 2] << 8 | d[pos + 3];
        else if (m === 0xC0 || m === 0xC1 || m === 0xC2) {
            if (frame || d[pos + 2] !== 8) return null;
            const height = d[pos + 3] << 8 | d[pos + 4], width = d[pos + 5] << 8 | d[pos + 6], n = d[pos + 7];
            if (!width || !height || (n !== 1 && n !== 3)) return null;
            const comps = [];
            let hMax = 1, vMax = 1;
            for (let i = 0; i < n; i++) {
                const o = pos + 8 + i * 3, h = d[o + 1] >> 4, v = d[o + 1] & 15;
                if (!h || !v) return null;
                comps.push({ id: d[o], h, v, tq: d[o + 2], pred: 0 });
                hMax = Math.max(hMax, h); vMax = Math.max(vMax, v);
            }
            if (n === 1) { comps[0].h = comps[0].v = 1; hMax = vMax = 1; }
            const dcOnly = target > 0 && Math.max(width, height) >= 8 * target;
            frame = { progressive: m === 0xC2, width, height, comps, hMax, vMax, dcOnly };
            frame.mcusX = Math.ceil(width / (8 * hMax));
            frame.mcusY = Math.ceil(height / (8 * vMax));
            for (const c of comps) {
                c.blocksX = Math.ceil(Math.ceil(width * c.h / hMax) / 8);
                c.blocksY = Math.ceil(Math.ceil(height * c.v / vMax) / 8);
                c.stride = frame.mcusX * c.h;
                const blocks = c.stride * frame.mcusY * c.v;
                c.coef = new Int16Array(dcOnly ? blocks : blocks * 64);
            }
        } else if (m >= 0xC3 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return null;
        else if (m === 0xDA) {
            if (!frame) return null;
            const ns = d[pos + 2], scan = [];
            for (let i = 0; i < ns; i++) {
                const id = d[pos + 3 + i * 2], tables = d[pos + 4 + i * 2];
                const c = frame.comps.find(x => x.id === id);
                if (!c) return null;
                c.dcTable = dcT[tables >> 4];
                c.acTable = acT[tables & 15];
                c.pred = 0;
                scan.push(c);
            }
            const o = pos + 3 + ns * 2;
            const ss = d[o], se = d[o + 1], ah = d[o + 2] >> 4, al = d[o + 2] & 15;
            sawScan = true;
            pos = end;
            // Only DC is wanted: a progressive file's AC scans can be stepped over
            if (!(frame.dcOnly && frame.progressive && ss > 0)) {
                pos = decodeScan(d, pos, frame, scan, ss, se, ah, al, restartInterval);
            }
            continue;
        }
        pos = end;
    }
    if (!frame || !sawScan) return null;

    // Blocks → one 8-bit plane per component, in this decode's own scale
    const { width, height, comps, hMax, vMax, dcOnly } = frame;
    const unit = dcOnly ? 1 : 8;
    const outW = dcOnly ? Math.ceil(width / 8) : width, outH = dcOnly ? Math.ceil(height / 8) : height;
    const tmp = new Int32Array(64);
    for (const c of comps) {
        const q = qt[c.tq];
        if (!q) return null;
        const rows = frame.mcusY * c.v;
        c.planeW = c.stride * unit;
        c.plane = new Uint8ClampedArray(c.planeW * rows * unit);
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < c.stride; col++) {
                const b = row * c.stride + col;
                if (dcOnly) c.plane[b] = ((c.coef[b] * q[0] + 4) >> 3) + 128;
                else idct(c.coef, b * 64, q, c.plane, c.planeW, row * 8 * c.planeW + col * 8, tmp);
            }
        }
        c.coef = null;
        c.scaledX = c.h / hMax; c.scaledY = c.v / vMax;
    }

    // Chroma that was subsampled is read between its samples, in 1/256ths
    const sampler = c => {
        const { plane, planeW, scaledX, scaledY } = c;
        if (scaledX === 1 && scaledY === 1) return (x, y) => plane[y * planeW + x];
        const maxX = Math.ceil(outW * scaledX) - 1, maxY = Math.ceil(outH * scaledY) - 1;
        const nx = Math.round(scaledX * 256), ny = Math.round(scaledY * 256);
        return (x, y) => {
            const fx = Math.max(0, (2 * x + 1) * nx - 256), fy = Math.max(0, (2 * y + 1) * ny - 256);
            const x0 = Math.min(maxX, fx >> 9), y0 = Math.min(maxY, fy >> 9);
            const x1 = Math.min(maxX, x0 + 1), y1 = Math.min(maxY, y0 + 1);
            const ax = (fx >> 1) & 255, ay = (fy >> 1) & 255;
            const top = plane[y0 * planeW + x0] * (256 - ax) + plane[y0 * planeW + x1] * ax;
            const bot = plane[y1 * planeW + x0] * (256 - ax) + plane[y1 * planeW + x1] * ax;
            return (top * (256 - ay) + bot * ay + 32768) >> 16;
        };
    };

    const rgba = new Uint8ClampedArray(outW * outH * 4);
    if (comps.length === 1) {
        const c = comps[0];
        for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
            const i = (y * outW + x) * 4, v = c.plane[y * c.planeW + x];
            rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
            rgba[i + 3] = 255;
        }
    } else {
        const isRgb = adobe === 0 || (adobe < 0 && comps[0].id === 0x52 && comps[1].id === 0x47 && comps[2].id === 0x42);
        const s0 = sampler(comps[0]), s1 = sampler(comps[1]), s2 = sampler(comps[2]);
        for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
            const i = (y * outW + x) * 4, a = s0(x, y), b = s1(x, y), c = s2(x, y);
            if (isRgb) { rgba[i] = a; rgba[i + 1] = b; rgba[i + 2] = c; }
            else {
                // BT.601 in 16.16 fixed point
                const cb = b - 128, cr = c - 128;
                rgba[i] = a + ((91881 * cr + 32768) >> 16);
                rgba[i + 1] = a - ((22554 * cb + 46802 * cr + 32768) >> 16);
                rgba[i + 2] = a + ((116130 * cb + 32768) >> 16);
            }
            rgba[i + 3] = 255;
        }
    }

    if (iccParts.length) {
        let n = 0;
        for (const part of iccParts) if (part) n += part.length;
        const profile = new Uint8Array(n);
        let o = 0;
        for (const part of iccParts) if (part) { profile.set(part, o); o += part.length; }
        if (comps.length === 3) {
            const convert = iccConverter(profile);
            if (convert === false) return null;
            if (convert) convert(rgba);
        }
    }
    const out = orient(rgba, outW, outH, orientation);
    out.scale = dcOnly ? 8 : 1;
    return out;
}

// ---- Downscale ----
// Area average, weighted by alpha so transparent pixels lend no colour.
function areaDownscale(src, W, H, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    const sx = W / w, sy = H / h;
    for (let y = 0; y < h; y++) {
        const y0 = y * sy, y1 = (y + 1) * sy;
        const jEnd = Math.min(H, Math.ceil(y1));
        for (let x = 0; x < w; x++) {
            const x0 = x * sx, x1 = (x + 1) * sx;
            const iEnd = Math.min(W, Math.ceil(x1));
            let r = 0, g = 0, b = 0, a = 0, area = 0;
            for (let j = Math.floor(y0); j < jEnd; j++) {
                const wy = Math.min(j + 1, y1) - Math.max(j, y0);
                for (let i = Math.floor(x0); i < iEnd; i++) {
                    const c = wy * (Math.min(i + 1, x1) - Math.max(i, x0));
                    const p = (j * W + i) * 4, al = src[p + 3] * c;
                    r += src[p] * al; g += src[p + 1] * al; b += src[p + 2] * al;
                    a += al; area += c;
                }
            }
            const q = (y * w + x) * 4;
            if (a > 0) { out[q] = r / a; out[q + 1] = g / a; out[q + 2] = b / a; }
            out[q + 3] = a / area;
        }
    }
    return out;
}

// The size a source is read at: longest side at most `max`, never upscaled
function readingSize(W, H, max) {
    const s = Math.min(1, max / Math.max(W, H));
    return { width: Math.max(1, Math.floor(W * s)), height: Math.max(1, Math.floor(H * s)) };
}

// FNV-1a of the pixels, as 8 hex digits: the record's check that two browsers read the same thing
function pixelChecksum(data) {
    let h = 0x811C9DC5;
    for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 0x01000193);
    return (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

// ---- Browser side ----
// img: a loaded <img>. bytes: its file as a Uint8Array, if known.
// → { data, width, height, decoder: 'own' | 'browser' }
const BROWSER_READ_MAX = 3200;   // canvases are capped on phones; 8× the reading size is plenty
function readPixels(img, bytes, max) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const { width, height } = readingSize(W, H, max);
    const decoded = bytes ? decodeJpeg(bytes, max) : null;
    // The browser's size is the truth for layout; a file it reads otherwise isn't ours to read
    if (decoded && Math.abs(decoded.width / decoded.height - W / H) < 0.02) {
        return { data: areaDownscale(decoded.data, decoded.width, decoded.height, width, height), width, height, decoder: 'own' };
    }
    const fit = Math.min(1, BROWSER_READ_MAX / Math.max(W, H));
    const cw = Math.max(1, Math.round(W * fit)), ch = Math.max(1, Math.round(H * fit));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, cw, ch);
    return { data: areaDownscale(x.getImageData(0, 0, cw, ch).data, cw, ch, width, height), width, height, decoder: 'browser' };
}

if (typeof module === 'object' && module.exports) {
    module.exports = { decodeJpeg, areaDownscale, readingSize, pixelChecksum, iccConverter, orient };
}
