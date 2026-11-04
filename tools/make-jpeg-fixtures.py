#!/usr/bin/env python3
# Regenerates test/fixtures/*.jpg, the JPEG variants js/decode.js must read:
#   python3 tools/make-jpeg-fixtures.py   (needs Pillow)
# The image is a smooth colour field plus a marker block in the top-left corner,
# so a test can compute what each pixel should be and see where the corner went.
import struct
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'test' / 'fixtures'
W, H = 96, 64

def field():
    im = Image.new('RGB', (W, H))
    for y in range(H):
        for x in range(W):
            im.putpixel((x, y), (40 + x * 2, 200 - y * 2, 60 + (x + y)))
    for y in range(16):
        for x in range(16):
            im.putpixel((x, y), (230, 30, 30))
    return im

def exif(orientation):
    ifd = struct.pack('<H', 1) + struct.pack('<HHIHH', 0x112, 3, 1, orientation, 0) + struct.pack('<I', 0)
    return b'Exif\0\0II*\0' + struct.pack('<I', 8) + ifd

def icc(primaries):
    # A minimal matrix-shaper profile: three XYZ colorants and the sRGB curve
    def xyz(v):
        return b'XYZ \0\0\0\0' + b''.join(struct.pack('>i', round(c * 65536)) for c in v)
    g, a, b, c, d = 2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045
    para = b'para\0\0\0\0' + struct.pack('>HH', 3, 0) + b''.join(struct.pack('>i', round(p * 65536)) for p in (g, a, b, c, d))
    tags = [(b'rXYZ', xyz(primaries[0])), (b'gXYZ', xyz(primaries[1])), (b'bXYZ', xyz(primaries[2])),
            (b'rTRC', para), (b'gTRC', para), (b'bTRC', para), (b'wtpt', xyz((0.9642, 1.0, 0.8249)))]
    table, body, offset = b'', b'', 128 + 4 + 12 * len(tags)
    for sig, data in tags:
        table += sig + struct.pack('>II', offset + len(body), len(data))
        body += data + b'\0' * (-len(data) % 4)
    size = offset + len(body)
    head = struct.pack('>I', size) + b'\0\0\0\0' + bytes([4, 0x40, 0, 0]) + b'mntrRGB XYZ ' + b'\0' * 12 + b'acsp' + b'\0' * 28
    head += struct.pack('>iii', 63190, 65536, 54061)   # D50
    head += b'\0' * (128 - len(head))
    return head + struct.pack('>I', len(tags)) + table + body

DISPLAY_P3 = ((0.5151, 0.2412, -0.0011), (0.2920, 0.6922, 0.0419), (0.1571, 0.0666, 0.7841))
ADOBE_RGB = ((0.6097, 0.3111, 0.0195), (0.2053, 0.6257, 0.0609), (0.1492, 0.0632, 0.7446))
SRGB = ((0.4360747, 0.2225045, 0.0139322), (0.3850649, 0.7168786, 0.0971045), (0.1430804, 0.0606169, 0.7141733))

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    im = field()
    q = dict(quality=92)
    im.save(OUT / 'baseline-420.jpg', subsampling=2, **q)
    im.save(OUT / 'baseline-422.jpg', subsampling=1, **q)
    im.save(OUT / 'baseline-444.jpg', subsampling=0, **q)
    im.save(OUT / 'progressive-420.jpg', progressive=True, subsampling=2, **q)
    im.save(OUT / 'progressive-444.jpg', progressive=True, subsampling=0, **q)
    im.save(OUT / 'restart.jpg', subsampling=2, restart_marker_blocks=2, **q)
    im.save(OUT / 'progressive-restart.jpg', progressive=True, subsampling=2, restart_marker_blocks=2, **q)
    im.convert('L').save(OUT / 'grey.jpg', **q)
    for o in range(2, 9):
        # The file's pixels are stored so that applying the tag brings back `field`
        undo = {2: Image.FLIP_LEFT_RIGHT, 3: Image.ROTATE_180, 4: Image.FLIP_TOP_BOTTOM, 5: Image.TRANSPOSE,
                6: Image.ROTATE_90, 7: Image.TRANSVERSE, 8: Image.ROTATE_270}[o]
        im.transpose(undo).save(OUT / f'orientation-{o}.jpg', subsampling=0, exif=exif(o), **q)
    im.save(OUT / 'icc-display-p3.jpg', subsampling=0, icc_profile=icc(DISPLAY_P3), **q)
    im.save(OUT / 'icc-adobe-rgb.jpg', subsampling=0, icc_profile=icc(ADOBE_RGB), **q)
    im.save(OUT / 'icc-srgb.jpg', subsampling=0, icc_profile=icc(SRGB), **q)
    im.convert('CMYK').save(OUT / 'cmyk.jpg', **q)
    data = (OUT / 'baseline-420.jpg').read_bytes()
    (OUT / 'truncated.jpg').write_bytes(data[:len(data) * 2 // 3])

if __name__ == '__main__':
    main()
