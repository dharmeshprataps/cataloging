import { deflateSync } from 'node:zlib';

/**
 * Minimal PNG encoder used to build real, byte-valid fixtures.
 *
 * Tests must exercise the actual header-sniffing code path, so fixtures have to
 * be genuinely valid images rather than placeholders. Hand-rolling this avoids
 * adding an image library as a dependency.
 */

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i]!;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);

  const out = new Uint8Array(8 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body), false);
  return out;
}

export function makePng(width = 256, height = 256, rgb: [number, number, number] = [200, 120, 90]): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline is prefixed with a filter-type byte (0 = none).
  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 3;
      raw[px] = rgb[0];
      raw[px + 1] = rgb[1];
      raw[px + 2] = rgb[2];
    }
  }

  const idat = new Uint8Array(deflateSync(raw));
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/** A 1x1 PNG with 8-bit greyscale — used to prove dimensions parse correctly. */
export function makeTinyPng(): Uint8Array {
  return makePng(1, 1, [0, 0, 0]);
}

/**
 * A minimal, structurally valid JPEG containing just the marker segments needed
 * to reach the SOF0 frame header (plus an EOI).
 *
 * Gemini returns image/jpeg by default, so JPEG header parsing is the path that
 * runs in production — it must be covered even though a real encoder would be
 * overkill for a dimension check.
 */
export function makeJpegHeader(width = 320, height = 480): Uint8Array {
  const bytes: number[] = [0xff, 0xd8]; // SOI

  // APP0 / JFIF segment: marker + length(16) + 14 bytes payload.
  const app0 = [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  bytes.push(0xff, 0xe0, 0x00, 0x10, ...app0);

  // SOF0: marker + length(17) + precision(8) + height(16) + width(16) + components(3)
  bytes.push(0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03);
  bytes.push(0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01);

  // SOS then EOI, so a parser that keeps walking finds a clean stop.
  bytes.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00);
  bytes.push(0xff, 0xd9);

  return new Uint8Array(bytes);
}
